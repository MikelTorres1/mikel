import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const payload = `<img src=x onerror="window.__xssProbe='payload'"><svg onload="window.__xssProbe='svg'"></svg><script>window.__xssProbe='script'</script><div onclick="window.__xssProbe='click'">click</div>`;
const scriptString = value => JSON.stringify(value).replace(/<\//g, '<\\/');
const visualPayload = `<div style="color:red;background-image:url(javascript:alert(1))" onclick="window.__xssProbe='vis'"><img src=x onerror="window.__xssProbe='vis-img'"><script>window.__xssProbe='vis-script'</script><strong>safe visual</strong></div>`;
const appPath = new URL('../index.html', import.meta.url);
const appHtml = readFileSync(appPath, 'utf8');
const seed = `<script>
window.__xssHits=[];
window.__xssErrors=[];
Object.defineProperty(window,'__xssProbe',{set(v){window.__xssHits.push(v);},get(){return false;}});
window.alert=v=>window.__xssHits.push('alert:'+v);
window.onerror=(msg)=>{window.__xssErrors.push(String(msg));return false;};
const payload=${scriptString(payload)};
const visualPayload=${scriptString(visualPayload)};
window.__payload=payload;
const today=new Date().getDay();
localStorage.clear();
localStorage.setItem('groqKey','gsk_test_key');
localStorage.setItem('uSet',JSON.stringify({name:payload,pin:'2007',accent:'blue'}));
localStorage.setItem('mem',JSON.stringify([payload]));
localStorage.setItem('todos',JSON.stringify([{id:101,text:payload,p:'high',done:false}]));
localStorage.setItem('schedule',JSON.stringify({[today]:[{id:202,time:payload,title:payload,sub:payload}]}));
localStorage.setItem('uCls',JSON.stringify([{code:payload,name:payload,time:payload,days:payload}]));
localStorage.setItem('savedVis',JSON.stringify([{type:'mindmap',label:payload,notes:payload,date:payload,html:payload}]));
const json=data=>Promise.resolve({json:()=>Promise.resolve(data)});
window.fetch=(url,opts={})=>{
  const body=opts.body?JSON.parse(opts.body):{};
  if(String(url).includes('finance'))return json({quoteResponse:{result:[{symbol:"AAPL');window.__xssProbe='market';('",regularMarketPrice:1,regularMarketChangePercent:2,regularMarketChange:3}]}});
  if(body.max_tokens===2500)return json({choices:[{message:{content:visualPayload}}]});
  if(body.max_tokens===2000)return json({choices:[{message:{content:'# Header '+payload}}]});
  if(body.max_tokens===1500)return json({choices:[{message:{content:'[{"q":"q","a":"a","hint":"h"}]'}}]});
  return json({choices:[{message:{content:'**Answer** '+payload}}]});
};
</script>`;
const verify = `<script>
(async()=>{
  const payload=window.__payload;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await wait(100);
  try{
    initSettings();
    parseICS('BEGIN:VEVENT\\nSUMMARY:'+payload+'\\nDTSTART:20260619T090000\\nEND:VEVENT');
    document.getElementById('evTitle').value=payload;
    document.getElementById('evDate').value=new Date().toISOString().slice(0,10);
    document.getElementById('evTime').value='10:00';
    addCalEv();
    appendMsg('user',payload);
    appendMsg('assistant',payload);
    document.getElementById('studyIn').value='notes';
    await genVis();
    loadVis(0);
    document.getElementById('ddIn').value='topic';
    await runDD();
    document.getElementById('ddFollowIn').value=payload;
    await sendDDFollow();
    await wait(300);
  }catch(e){
    window.__xssErrors.push(e && e.stack ? e.stack : String(e));
  }
  const checks=[
    '#greet','#memChips','#clsSettings','#todoList','#shiftList','#schSlots',
    '#calEvents','#aiMsgs','#savedList','#visBox','#ddBox','#mktGrid'
  ];
  const bad=[];
  for(const sel of checks){
    document.querySelectorAll(sel+' script,'+sel+' img,'+sel+' svg,'+sel+' iframe,'+sel+' object,'+sel+' embed,'+sel+' [onerror],'+sel+' [onload]').forEach(n=>bad.push(sel+':'+n.outerHTML.slice(0,160)));
  }
  document.querySelectorAll('#visBox [onclick],#visBox [style*="javascript"],#visBox [style*="url("]').forEach(n=>bad.push('#visBox-active:'+n.outerHTML.slice(0,160)));
  const result={ok:window.__xssHits.length===0&&bad.length===0&&window.__xssErrors.length===0,hits:window.__xssHits,bad,errors:window.__xssErrors};
  const pre=document.createElement('pre');
  pre.id='xss-result';
  pre.textContent=JSON.stringify(result);
  document.body.appendChild(pre);
})();
</script>`;

const firstScript = '<script>\n// SETTINGS & MEMORY';
if (!appHtml.includes(firstScript)) {
  throw new Error('Could not find app script insertion point');
}
let html = appHtml.replace(firstScript, seed + '\n' + firstScript);
const close = html.lastIndexOf('</body>');
if (close === -1) throw new Error('Could not find body close');
html = html.slice(0, close) + verify + html.slice(close);

const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const profile = join(dir, 'profile');
const htmlPath = join(dir, 'index.html');
writeFileSync(htmlPath, html);

try {
  const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
  let output = '';
  try {
    output = execFileSync('timeout', ['--kill-after=2s', '12s', chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--dump-dom', pathToFileURL(htmlPath).href], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    output = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const match = output.match(/<pre id="xss-result">([^<]+)<\\/pre>/);
  if (!match) {
    throw new Error('No XSS result found in Chrome output');
  }
  const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
