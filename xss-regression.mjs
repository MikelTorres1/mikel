import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = readFileSync('index.html', 'utf8');
const payload = `<img src=x onerror="window.__xssHits.push('img')"><svg onload="window.__xssHits.push('svg')"></svg><script>window.__xssHits.push('script')</script><a href="javascript:window.__xssHits.push('href')">x</a>`;
const scriptSafeJson = (value) => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
const openScript = '<script>';
const closeScript = '<' + '/script>';
const setup = `${openScript}
window.__xssHits=[];
window.alert=(msg)=>window.__xssHits.push('alert:'+msg);
window.print=()=>window.__xssHits.push('print');
window.open=(url)=>({document:{write(html){window.__printed=html;},close(){}},print(){}});
window.fetch=async(url,opts)=>({
  json:async()=>String(url).includes('groq.com')?
    {choices:[{message:{content:${scriptSafeJson(`**AI** ${payload}`)}}}]}:
    {quoteResponse:{result:[
      {symbol:'AAPL',regularMarketPrice:123.45,regularMarketChangePercent:1.23,regularMarketChange:1.5},
      {symbol:"BAD');window.__xssHits.push('market');//",regularMarketPrice:1,regularMarketChangePercent:1,regularMarketChange:1}
    ]}}
});
localStorage.clear();
localStorage.setItem('groqKey','gsk_test');
localStorage.setItem('uSet',${scriptSafeJson(JSON.stringify({name: payload, pin: '2007', accent: 'blue'}))});
localStorage.setItem('mem',${scriptSafeJson(JSON.stringify([payload]))});
localStorage.setItem('uCls',${scriptSafeJson(JSON.stringify([{code: payload, name: payload, time: payload, days: payload}]))});
localStorage.setItem('todos',${scriptSafeJson(JSON.stringify([{id: "1);window.__xssHits.push('todo');//", text: payload, p: 'high', done: false}]))});
const day=String(new Date().getDay());
localStorage.setItem('schedule',JSON.stringify({[day]:[{id:"2);window.__xssHits.push('schedule');//",time:${scriptSafeJson(payload)},title:${scriptSafeJson(payload)},sub:${scriptSafeJson(payload)}}]}));
localStorage.setItem('savedVis',${scriptSafeJson(JSON.stringify([{type:'mindmap',label:payload,notes:payload,date:payload,html:`<div onclick="window.__xssHits.push('vis')">Visual ${payload}</div>`}]))});
${closeScript}`;

const verify = `${openScript}
(async()=>{
  await new Promise(r=>setTimeout(r,100));
  initSettings();
  tick();
  renderTodos();
  parseICS(${scriptSafeJson(`BEGIN:VEVENT\nSUMMARY:${payload.replace(/\n/g, ' ')}\nDTSTART:20260702T120000\nDTEND:20260702T130000\nEND:VEVENT`)});
  renderSch();
  personalEvs.push({title:${scriptSafeJson(payload)},date:new Date(),time:${scriptSafeJson(payload)},type:'personal'});
  renderCal();
  appendMsg('user',${scriptSafeJson(payload)});
  appendMsg('assistant',${scriptSafeJson(`**Bold** ${payload}`)});
  loadVis(0);
  document.getElementById('ddBox').innerHTML=formatDD(${scriptSafeJson(`## Header\n- item ${payload}`)});
  await loadMarkets();
  await new Promise(r=>setTimeout(r,100));
  const ids=['greet','memChips','clsSettings','todoList','shiftList','schSlots','calEvents','aiMsgs','visBox','savedList','ddBox','mktGrid'];
  const dangerous=[];
  for(const id of ids){
    const root=document.getElementById(id);
    if(root?.querySelector('script,iframe,object,embed,svg,img,[onerror],[onload],[srcdoc],a[href^="javascript:"]')) dangerous.push(id);
  }
  const result={ok:window.__xssHits.length===0&&dangerous.length===0,hits:window.__xssHits,dangerous};
  const marker='__XSS_RESULT__'+btoa(JSON.stringify(result))+'__END__';
  document.body.insertAdjacentHTML('beforeend','<pre id="xss-result">'+marker+'</pre>');
  console.log(marker);
})();
${closeScript}`;

const html = source.replace('<script>\n// SETTINGS', `${setup}\n<script>\n// SETTINGS`);
const insertAt = html.search(/<\/body>\s*<\/html>\s*$/i);
if (insertAt === -1) throw new Error('Could not find final body close tag');
const harness = html.slice(0, insertAt) + verify + html.slice(insertAt);
const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const file = join(dir, 'index.html');
const userDataDir = join(dir, 'chrome-profile');
writeFileSync(file, harness);

try {
  const chrome = '/usr/local/bin/google-chrome';
  const run = spawnSync('timeout', ['--kill-after=2s', '20s', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${userDataDir}`, '--virtual-time-budget=5000', '--dump-dom', `file://${file}`], { encoding: 'utf8' });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const match = output.match(/__XSS_RESULT__([A-Za-z0-9+/=]+)__END__/);
  if (!match) {
    throw new Error(`No XSS result emitted. exit=${run.status}\n${output}`);
  }
  const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
