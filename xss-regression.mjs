import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname);
const indexPath = join(root, 'index.html');
const source = readFileSync(indexPath, 'utf8');

const script = source.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)?.[1];
if (!script) throw new Error('Could not find inline dashboard script');
new Function(script);

const payload = `<img src=x onerror="window.__xssHits=(window.__xssHits||[]).concat('img');localStorage.setItem('xss-hit',localStorage.getItem('groqKey'))">`;
const visualPayload = `<div style="color:#fff;background:url(javascript:alert(1));" onclick="window.__xssHits=(window.__xssHits||[]).concat('click')">Visual <svg onload="window.__xssHits=(window.__xssHits||[]).concat('svg')"></svg><span style="color:#f59e0b">safe text</span></div>`;

function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

const today = new Date().getDay();
const setup = `
<script>
window.__xssHits=[];
window.fetch=async()=>({json:async()=>({quoteResponse:{result:[
  {symbol:'AAPL',regularMarketPrice:123.45,regularMarketChangePercent:1.23,regularMarketChange:1.5},
  {symbol:'BAD"><img src=x onerror="window.__xssHits.push(\\'market\\')">',regularMarketPrice:1,regularMarketChangePercent:1,regularMarketChange:1}
]}})});
localStorage.clear();
localStorage.setItem('groqKey','gsk_test_secret');
localStorage.setItem('uSet',${scriptSafeJson(JSON.stringify({ name: payload, pin: '2007', accent: 'blue' }))});
localStorage.setItem('mem',${scriptSafeJson(JSON.stringify([payload]))});
localStorage.setItem('uCls',${scriptSafeJson(JSON.stringify([{ code: payload, name: payload, time: payload, days: payload }]))});
localStorage.setItem('todos',${scriptSafeJson(JSON.stringify([{ id: '1);window.__xssHits.push("todo-id");//', text: payload, p: 'high', done: false }]))});
localStorage.setItem('schedule',${scriptSafeJson(JSON.stringify({ [today]: [{ id: '2);window.__xssHits.push("schedule-id");//', time: payload, title: payload, sub: payload }] }))});
localStorage.setItem('savedVis',${scriptSafeJson(JSON.stringify([{ type: 'summary', label: payload, notes: payload, html: visualPayload, date: payload }]))});
</script>`;

const verifier = `
<script>
setTimeout(()=>{
  try {
    parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:${payload.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}\\nDTSTART:20990101T090000\\nDTEND:20990101T170000\\nEND:VEVENT\\nEND:VCALENDAR');
    initSettings();
    renderMem();
    renderTodos();
    renderSch();
    renderCal();
    appendMsg('user', ${scriptSafeJson(payload)});
    appendMsg('assistant', ${scriptSafeJson(`**Header**\\n\\n${payload}`)});
    document.getElementById('ddBox').innerHTML=formatDD(${scriptSafeJson(`## Deep\\n- ${payload}`)});
    document.getElementById('ddFollowIn').value=${scriptSafeJson(payload)};
    sendDDFollow();
    loadVis(0);

    setTimeout(()=>{
      const dynamicIds=['greet','memChips','clsSettings','todoList','shiftList','uofaList','schSlots','calEvents','mktGrid','aiMsgs','savedList','visBox','ddBox'];
      const containers=dynamicIds.map(id=>document.getElementById(id)).filter(Boolean);
      const dangerous=[];
      const active=[];
      for (const c of containers) {
        for (const el of c.querySelectorAll('script,img,svg,math,iframe,object,embed,link,meta,form,input,textarea,select,audio,video,source,picture,canvas')) {
          dangerous.push(c.id+':'+el.tagName.toLowerCase());
        }
        for (const el of c.querySelectorAll('*')) {
          for (const attr of el.attributes) {
            if ((/^on/i.test(attr.name) || /javascript:|data:|url\\s*\\(/i.test(attr.value)) && /__xssHits|xss-hit|gsk_test_secret/i.test(attr.value)) {
              active.push(c.id+':'+el.tagName.toLowerCase()+'['+attr.name+'='+attr.value+']');
            }
          }
        }
      }
      const hits=window.__xssHits||[];
      const leaked=localStorage.getItem('xss-hit');
      const result={ok:hits.length===0&&!leaked&&dangerous.length===0&&active.length===0,hits,leaked,dangerous,active};
      console.log('XSS_RESULT:'+btoa(unescape(encodeURIComponent(JSON.stringify(result)))));
    },250);
  } catch (err) {
    const result={ok:false,error:String(err&&err.stack||err)};
    console.log('XSS_RESULT:'+btoa(unescape(encodeURIComponent(JSON.stringify(result)))));
  }
},250);
</script>`;

const html = source.replace('<script>\n// SETTINGS & MEMORY', `${setup}\n<script>\n// SETTINGS & MEMORY`).replace(/<\/body>\s*<\/html>\s*$/, `${verifier}\n</body></html>`);
const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(dir, 'index.html');
writeFileSync(htmlPath, html);

const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
const result = spawnSync('timeout', [
  '--kill-after=2s',
  '20s',
  chrome,
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--user-data-dir=${join(dir, 'profile')}`,
  `file://${htmlPath}`,
], { encoding: 'utf8' });

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const match = output.match(/XSS_RESULT:([A-Za-z0-9+/=]+)/);
if (!match) {
  throw new Error(`No XSS_RESULT marker found. Exit ${result.status}.\n${output}`);
}

const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
if (!parsed.ok) {
  throw new Error(`XSS regression failed: ${JSON.stringify(parsed)}`);
}

console.log(JSON.stringify(parsed));
