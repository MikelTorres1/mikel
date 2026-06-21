import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const pagePath = new URL('index.html', root);
const page = readFileSync(pagePath, 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(tmp, 'harness.html');
const profile = join(tmp, 'chrome-profile');
const payload = `<img src=x onerror="window.__xss('payload-img')"><svg onload="window.__xss('payload-svg')"></svg><span data-xss="payload">BADXSS</span>`;
const visualPayload = `<div style="color:#fff;background:url(javascript:window.__xss('css'))" onclick="window.__xss('click')"><img src=x onerror="window.__xss('visual-img')"><svg onload="window.__xss('visual-svg')"></svg><span>visual text</span></div>`;

const setup = `<script>
window.__hits=[];
window.__errors=[];
window.__xss=(label)=>window.__hits.push(label);
window.alert=(msg)=>window.__xss('alert:'+msg);
window.onerror=(msg)=>window.__errors.push(String(msg));
const payload=${JSON.stringify(payload)};
const visualPayload=${JSON.stringify(visualPayload)};
const day=new Date().getDay();
localStorage.clear();
localStorage.setItem('groqKey','gsk_test_key');
localStorage.setItem('uSet',JSON.stringify({name:payload,pin:'2007',accent:'blue'}));
localStorage.setItem('mem',JSON.stringify([payload]));
localStorage.setItem('uCls',JSON.stringify([{code:payload,name:payload,time:payload,days:payload}]));
localStorage.setItem('todos',JSON.stringify([{id:1,text:payload,p:'high',done:false}]));
localStorage.setItem('schedule',JSON.stringify({[day]:[{id:2,time:payload,title:payload,sub:payload}]}));
localStorage.setItem('savedVis',JSON.stringify([{type:'mindmap',label:payload,notes:payload,date:payload,html:visualPayload}]));
window.fetch=async (url)=>{
  const s=String(url);
  if(s.includes('query1.finance.yahoo.com')||s.includes('corsproxy.io')){
    return {json:async()=>({quoteResponse:{result:[{symbol:"AAPL<img src=x onerror=window.__xss('market')>",regularMarketChangePercent:1,regularMarketPrice:200,regularMarketChange:2}]}})};
  }
  return {json:async()=>({choices:[{message:{content:window.__nextAI||payload}}]})};
};
</script>`;

const checker = `<script type="module">
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const payload=${JSON.stringify(payload)};
const visualPayload=${JSON.stringify(visualPayload)};
const today=new Date();
const y=today.getFullYear(),m=String(today.getMonth()+1).padStart(2,'0'),d=String(today.getDate()).padStart(2,'0');
function riskyNodes(){
  const ids=['memChips','clsSettings','todoList','shiftList','schSlots','calEvents','mktGrid','aiMsgs','visBox','savedList','ddBox'];
  return ids.flatMap(id=>[...((document.getElementById(id)||document.createElement('div')).querySelectorAll('script,img,iframe,object,embed,svg,[onerror],[onload]'))].map(n=>id+':'+n.outerHTML.slice(0,120)));
}
async function exercise(){
  initSettings();
  parseICS('BEGIN:VCALENDAR\\\\nBEGIN:VEVENT\\\\nDTSTART:'+y+m+d+'T120000\\\\nDTEND:'+y+m+d+'T130000\\\\nSUMMARY:'+payload+'\\\\nEND:VEVENT\\\\nEND:VCALENDAR');
  renderCal();
  document.getElementById('evTitle').value=payload;
  document.getElementById('evDate').value=y+'-'+m+'-'+d;
  document.getElementById('evTime').value=payload;
  addCalEv();
  appendMsg('user',payload);
  appendMsg('assistant',payload);
  loadVis(0);
  document.getElementById('studyIn').value='notes';
  window.__nextAI=visualPayload;
  await genVis();
  saveVis();
  document.getElementById('ddIn').value=payload;
  window.__nextAI=payload;
  await runDD();
  document.getElementById('ddFollowIn').value=payload;
  window.__nextAI=payload;
  await sendDDFollow();
  await loadMarkets();
  await wait(500);
  const dangerous=riskyNodes();
  const result={ok:window.__hits.length===0&&dangerous.length===0&&window.__errors.length===0,hits:window.__hits,dangerous,errors:window.__errors};
  const pre=document.createElement('pre');
  pre.id='xss-result';
  pre.textContent=JSON.stringify(result);
  document.body.appendChild(pre);
}
exercise().catch(e=>{
  const pre=document.createElement('pre');
  pre.id='xss-result';
  pre.textContent=JSON.stringify({ok:false,hits:window.__hits||[],dangerous:[],errors:[String(e&&e.stack||e)]});
  document.body.appendChild(pre);
});
</script>`;

const bodyClose = page.lastIndexOf('</body>');
if (bodyClose === -1) throw new Error('Could not find closing body tag');
const harness = page.replace('<body>', `<body>${setup}`);
writeFileSync(htmlPath, harness.slice(0, bodyClose + setup.length) + checker + harness.slice(bodyClose + setup.length));

const chrome = process.env.CHROME_BIN || '/usr/local/bin/google-chrome';
const res = spawnSync('timeout', ['--kill-after=2s', '20s', chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=5000', `--user-data-dir=${profile}`, '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8' });
const output = `${res.stdout || ''}\n${res.stderr || ''}`;
const match = output.match(/<pre id="xss-result">([^<]+)<\/pre>/);
rmSync(tmp, { recursive: true, force: true });
if (!match) {
  throw new Error(`No XSS result found. status=${res.status}\n${output.slice(-2000)}`);
}
const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
if (!result.ok) {
  throw new Error(`XSS regression failed: ${JSON.stringify(result, null, 2)}`);
}
console.log(JSON.stringify(result));
