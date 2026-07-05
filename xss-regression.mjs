import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const chromeCandidates = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', 'google-chrome'];
const chrome = chromeCandidates.find(p => p === 'google-chrome' || existsSync(p));
const payload = '<img src=x onerror="window.__xssHits.push(\'payload\');localStorage.setItem(\'leaked\',localStorage.getItem(\'groqKey\'))">';
const visualPayload = '<div style="background:url(javascript:alert(1));color:#fff" onclick="window.__xssHits.push(\'visual-click\')"><img src=x onerror="window.__xssHits.push(\'visual-img\')"><svg onload="window.__xssHits.push(\'visual-svg\')"></svg><p>Visual body</p></div>';
const responsePayload = '**Header**\n\n<img src=x onerror="window.__xssHits.push(\'ai\')">\n<script>window.__xssHits.push(\'script\')</script>';

function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

const seededStorage = {
  groqKey: 'gsk_test_secret',
  uSet: JSON.stringify({ name: payload, pin: '2007', accent: 'blue' }),
  mem: JSON.stringify([payload]),
  uCls: JSON.stringify([{ code: payload, name: payload, time: payload, days: payload }]),
  todos: JSON.stringify([{ id: "1);window.__xssHits.push('todo-id');//", text: payload, p: 'high', done: false }]),
  schedule: JSON.stringify({ [new Date().getDay()]: [{ id: "2);window.__xssHits.push('schedule-id');//", time: payload, title: payload, sub: payload }] }),
  savedVis: JSON.stringify([{ type: 'summary', label: payload, notes: payload, html: visualPayload, date: payload }])
};

const setupScript = `
<script>
window.__xssHits=[];
const seeded=${scriptSafeJson(seededStorage)};
localStorage.clear();
for (const [key,value] of Object.entries(seeded)) localStorage.setItem(key,value);
window.fetch=async (url,opts={})=>{
  const body=opts.body?JSON.parse(opts.body):null;
  if(String(url).includes('finance.yahoo.com')||String(url).includes('corsproxy.io')){
    return {json:async()=>({quoteResponse:{result:[
      {symbol:'AAPL',regularMarketPrice:123.45,regularMarketChangePercent:1.23,regularMarketChange:1.5},
      {symbol:'BAD"><img src=x onerror="window.__xssHits.push(\\'market\\')">',regularMarketPrice:1,regularMarketChangePercent:1,regularMarketChange:1}
    ]}})};
  }
  if(body?.max_tokens===2500){
    return {json:async()=>({choices:[{message:{content:${scriptSafeJson(visualPayload)}}}]})};
  }
  return {json:async()=>({choices:[{message:{content:${scriptSafeJson(responsePayload)}}}]})};
};
</script>`;

const exerciseScript = `
<script>
(async()=>{
  await new Promise(r=>setTimeout(r,100));
  try{
    initSettings();
    parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:${payload.replace(/'/g, "\\'")}\\nDTSTART:20260706T090000\\nDTEND:20260706T170000\\nEND:VEVENT\\nEND:VCALENDAR');
    renderCal();
    appendMsg('assistant', ${scriptSafeJson(responsePayload)});
    document.getElementById('aiIn').value=${scriptSafeJson(payload)};
    await sendAI();
    document.getElementById('studyIn').value='biology notes';
    await genVis();
    saveVis();
    loadVis(0);
    document.getElementById('ddIn').value='deep dive notes';
    await runDD();
    ddFollowUp();
    document.getElementById('ddFollowIn').value=${scriptSafeJson(payload)};
    await sendDDFollow();
  }catch(e){
    window.__xssHarnessError=String(e&&e.stack||e);
  }
  await new Promise(r=>setTimeout(r,500));
  const scopes=['memChips','clsSettings','greet','todoList','shiftList','schSlots','calEvents','mktGrid','aiMsgs','visBox','savedList','ddBox'];
  const dangerous=[];
  const active=[];
  for (const id of scopes){
    const root=document.getElementById(id);
    if(!root) continue;
    root.querySelectorAll('script,img,svg,iframe,object,embed,math,audio,video').forEach(el=>dangerous.push(id+':'+el.tagName.toLowerCase()));
    root.querySelectorAll('*').forEach(el=>{
      for (const attr of el.attributes){
        if (/^on/i.test(attr.name)&&/(__xssHits|localStorage|alert|payload)/i.test(attr.value)) active.push(id+':'+el.tagName.toLowerCase()+'@'+attr.name+'='+attr.value);
        if (/javascript:|url\\s*\\(|expression\\s*\\(/i.test(attr.value)) active.push(id+':'+el.tagName.toLowerCase()+'@'+attr.name+'='+attr.value);
      }
    });
  }
  const result={ok:window.__xssHits.length===0&&!localStorage.getItem('leaked')&&!dangerous.length&&!active.length&&!window.__xssHarnessError,hits:window.__xssHits,leaked:localStorage.getItem('leaked'),dangerous,active,error:window.__xssHarnessError||null};
  const pre=document.createElement('pre');
  pre.id='xss-result';
  pre.textContent='XSS_RESULT '+btoa(JSON.stringify(result));
  document.body.appendChild(pre);
})();
</script>`;

const source = readFileSync('index.html', 'utf8');
const appScriptIndex = source.indexOf('<script>\n// SETTINGS');
if (appScriptIndex === -1) throw new Error('Could not locate app script');
const bodyCloseIndex = source.lastIndexOf('</body>');
if (bodyCloseIndex === -1) throw new Error('Could not locate body close');
let html = source.slice(0, appScriptIndex) + setupScript + source.slice(appScriptIndex);
const adjustedBodyClose = html.lastIndexOf('</body>');
html = html.slice(0, adjustedBodyClose) + exerciseScript + html.slice(adjustedBodyClose);

const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(dir, 'index.html');
const profilePath = join(dir, 'profile');
writeFileSync(htmlPath, html);

const args = [
  '--kill-after=2s',
  '20s',
  chrome,
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--virtual-time-budget=7000',
  `--user-data-dir=${profilePath}`,
  '--dump-dom',
  `file://${htmlPath}`
];
const run = spawnSync('timeout', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const match = output.match(/XSS_RESULT\s+([A-Za-z0-9+/=]+)/);
rmSync(dir, { recursive: true, force: true });

if (!match) {
  console.error(output);
  throw new Error(`Chrome did not emit XSS_RESULT (status ${run.status})`);
}

const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
