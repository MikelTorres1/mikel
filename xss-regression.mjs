import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const app = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const payload = label => `<img data-xss="${label}" src=x onerror="window.__xssHit.push('${label}')">`;
const htmlPayload = label => `<div><strong>Safe ${label}</strong><img data-xss="${label}" src=x onerror="window.__xssHit.push('${label}')"><svg data-xss="${label}" onload="window.__xssHit.push('${label}-svg')"></svg><script data-xss="${label}">window.__xssHit.push('${label}-script')</script><span style="background:url(javascript:window.__xssHit.push('${label}-css'))">Styled</span></div>`;
const scriptSafeJson = value => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');

const seed = {
  mem: [payload('mem')],
  uSet: { name: payload('name'), pin: '2007', accent: 'blue' },
  todos: [{ id: "1);window.__xssHit.push('todo-id');//", text: payload('todo'), p: 'high', done: false }],
  schedule: { 1: [{ id: "2);window.__xssHit.push('schedule-id');//", time: payload('sch-time'), title: payload('sch-title'), sub: payload('sch-sub') }] },
  savedVis: [{ type: 'mindmap', label: payload('saved-label'), notes: payload('saved-notes'), html: htmlPayload('saved-html'), date: payload('saved-date') }],
  groqKey: 'gsk_test_key'
};

const setup = `
<script data-test-script>
window.__xssHit=[];
window.alert=msg=>window.__xssHit.push('alert:'+msg);
window.confirm=msg=>(window.__xssHit.push('confirm:'+msg),false);
window.prompt=msg=>(window.__xssHit.push('prompt:'+msg),'');
const seed=${scriptSafeJson(seed)};
for(const [key,value] of Object.entries(seed)){
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}
window.fetch=async (url, options={})=>{
  const text=String(url);
  if(text.includes('groq.com')){
    const body=JSON.parse(options.body||'{}');
    let content=${scriptSafeJson(payload('ai-reply'))};
    if(body.max_tokens===2500) content=${scriptSafeJson(htmlPayload('visual-reply'))};
    else if(body.messages?.[0]?.content?.includes('educational assistant')) content=${scriptSafeJson(payload('deep-dive'))};
    else if(body.messages?.[1]?.content?.includes('Follow-up question')) content=${scriptSafeJson(payload('deep-follow'))};
    return {json:async()=>({choices:[{message:{content}}]})};
  }
  return {json:async()=>({quoteResponse:{result:[
    {symbol:'AAPL',regularMarketPrice:123.45,regularMarketChangePercent:1.2,regularMarketChange:1.4},
    {symbol:${scriptSafeJson(payload('market-symbol'))},regularMarketPrice:99,regularMarketChangePercent:2,regularMarketChange:2}
  ]}})};
};
</script>`;

const verifier = `
<script data-test-script>
(async()=>{
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value;};
  const result={ok:false,hits:[],dangerous:[],error:null};
  try{
    await sleep(100);
    tick();
    initSettings();
    parseICS('BEGIN:VEVENT\\nSUMMARY:${payload('ics').replace(/'/g, "\\'")}\\nDTSTART:20990101T090000\\nDTEND:20990101T100000\\nEND:VEVENT');
    calSelected=new Date('2099-01-01T12:00:00');
    renderCal();
    set('evTitle',${scriptSafeJson(payload('calendar-title'))});
    set('evDate','2099-01-01');
    set('evTime',${scriptSafeJson(payload('calendar-time'))});
    addCalEv();
    await loadMarkets();
    set('aiIn',${scriptSafeJson(payload('ai-user'))});
    await sendAI();
    set('studyIn','topic');
    await genVis();
    saveVis();
    loadVis(0);
    set('ddIn','topic');
    await runDD();
    ddFollowUp();
    set('ddFollowIn',${scriptSafeJson(payload('deep-question'))});
    await sendDDFollow();
    await sleep(200);
    result.hits=[...window.__xssHit];
    result.dangerous=[...document.querySelectorAll('[data-xss],[onerror*="__xssHit"],[onload*="__xssHit"],[onclick*="__xssHit"],[style*="javascript:"],[style*="url("],script[data-xss],img[data-xss],svg[data-xss],iframe,object,embed,math,audio,video')].map(el=>({tag:el.tagName,id:el.id||'',data:el.getAttribute('data-xss')||'',html:el.outerHTML.slice(0,180)}));
    result.ok=result.hits.length===0&&result.dangerous.length===0;
  }catch(error){
    result.error=error&&error.stack||String(error);
  }
  const pre=document.createElement('pre');
  pre.id='xss-result';
  pre.textContent='XSS_RESULT:'+btoa(JSON.stringify(result));
  document.body.appendChild(pre);
})();
</script>`;

const harness = app.replace('<script>', `${setup}\n<script>`).replace(/<\/body>\s*<\/html>\s*$/i, `${verifier}\n</body></html>`);
const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const file = join(dir, 'harness.html');
writeFileSync(file, harness);

const chrome = process.env.CHROME_BIN || '/usr/local/bin/google-chrome';
const run = spawnSync('timeout', ['--kill-after=2s', '20s', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--virtual-time-budget=8000', '--dump-dom', `file://${file}`], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});

rmSync(dir, { recursive: true, force: true });

const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const match = output.match(/XSS_RESULT:([A-Za-z0-9+/=]+)/);
if (!match) {
  console.error(output);
  throw new Error(`Chrome did not emit XSS_RESULT (status ${run.status}, signal ${run.signal})`);
}

const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
