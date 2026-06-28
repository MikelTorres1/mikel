import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
const pagePath = resolve('index.html');
const page = await readFile(pagePath, 'utf8');

const marker = name => `<img src=x onerror="window.__xssMarker('${name}')">`;
const scriptPayload = name => `<script>window.__xssMarker('${name}')</script>`;
const visualPayload = [
  '<div style="color:#f59e0b" onclick="window.__xssMarker(\'visual-click\')">',
  'Visual',
  marker('visual-img'),
  '<a href="javascript:window.__xssMarker(\'visual-href\')">bad</a>',
  scriptPayload('visual-script'),
  '</div>'
].join('');
const scriptSafeJson = value => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');

const prelude = `
<script>
(function(){
  const marker = ${JSON.stringify(marker('__NAME__'))};
  const payload = name => marker.replace('__NAME__', name);
  const today = new Date();
  const todayKey = String(today.getDay());
  window.__xssHits = [];
  window.__xssMarker = function(name){
    window.__xssHits.push(name);
    try { window.__leakedGroqKey = localStorage.getItem('groqKey'); } catch (e) {}
  };
  window.alert = value => window.__xssMarker('alert:' + value);
  window.open = function(){ return { document: { write(){}, close(){} } }; };
  localStorage.clear();
  localStorage.setItem('groqKey','gsk_test_key');
  localStorage.setItem('uSet', JSON.stringify({name: payload('profile'), pin:'2007', accent:'blue'}));
  localStorage.setItem('mem', JSON.stringify([payload('memory')]));
  localStorage.setItem('todos', JSON.stringify([
    {id:1,text:payload('todo-text'),p:'high',done:false},
    {id:"2);window.__xssMarker('todo-id');//",text:'bad id',p:'low',done:false}
  ]));
  localStorage.setItem('schedule', JSON.stringify({
    [todayKey]: [{id:3,time:payload('schedule-time'),title:payload('schedule-title'),sub:payload('schedule-sub')}]
  }));
  localStorage.setItem('uCls', JSON.stringify([{
    code:'\\" autofocus onfocus="window.__xssMarker(\\'class-code\\')"',
    name:payload('class-name'),
    time:payload('class-time'),
    days:payload('class-days')
  }]));
  localStorage.setItem('savedVis', JSON.stringify([{
    type:'mindmap',
    label:payload('saved-label'),
    notes:payload('saved-notes'),
    html:${scriptSafeJson(visualPayload)},
    date:payload('saved-date')
  }]));
  window.fetch = async function(url, opts){
    if(String(url).includes('finance.yahoo.com')){
      return {json: async () => ({quoteResponse:{result:[{
        symbol:"AAPL');window.__xssMarker('market-symbol');//",
        regularMarketChangePercent:1.25,
        regularMarketPrice:123.45,
        regularMarketChange:1.5
      }]}})};
    }
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const max = body.max_tokens;
    const content = max === 2500
      ? ${scriptSafeJson(visualPayload)}
      : '**bold** ' + payload(max === 2000 ? 'deep-dive' : 'assistant');
    return {json: async () => ({choices:[{message:{content}}]})};
  };
})();
</script>`;

const verifier = `
<script>
(async function(){
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    tick();
    initSettings();
    renderTodos();
    renderSch();
    appendMsg('user', ${JSON.stringify(marker('ai-user'))});
    appendMsg('assistant', ${JSON.stringify(marker('ai-assistant'))});
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    const d = String(new Date().getDate()).padStart(2, '0');
    parseICS('BEGIN:VEVENT\\nSUMMARY:${marker('ics-summary').replace(/'/g, "\\'")}\\nDTSTART:' + y + m + d + 'T120000\\nDTEND:' + y + m + d + 'T130000\\nEND:VEVENT');
    document.getElementById('evTitle').value = ${JSON.stringify(marker('calendar-title'))};
    document.getElementById('evDate').value = y + '-' + m + '-' + d;
    document.getElementById('evTime').value = ${JSON.stringify(marker('calendar-time'))};
    addCalEv();
    await loadMarkets();
    loadVis(0);
    document.getElementById('studyIn').value = 'malicious visual';
    await genVis();
    document.getElementById('ddIn').value = 'malicious deep dive';
    await runDD();
    ddFollowUp();
    document.getElementById('ddFollowIn').value = ${JSON.stringify(marker('deep-follow-question'))};
    await sendDDFollow();
    await new Promise(resolve => setTimeout(resolve, 100));

    const scopes = ['greet','memChips','clsSettings','todoList','shiftList','schSlots','calEvents','mktGrid','aiMsgs','visBox','savedList','ddBox'];
    const dangerous = [];
    for (const id of scopes) {
      const root = document.getElementById(id);
      if (!root) continue;
      root.querySelectorAll('script,iframe,object,embed,svg,math').forEach(el => dangerous.push({id, tag: el.tagName, html: el.outerHTML}));
      root.querySelectorAll('*').forEach(el => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const value = attr.value;
          if (name.startsWith('on') || /^javascript:/i.test(value) || (/url\\s*\\(/i.test(value) && name === 'style')) {
            dangerous.push({id, tag: el.tagName, attr: attr.name, value});
          }
        }
      });
    }
    const result = {ok: window.__xssHits.length === 0 && dangerous.length === 0, hits: window.__xssHits, leaked: window.__leakedGroqKey || null, dangerous};
    document.body.setAttribute('data-xss-result', btoa(unescape(encodeURIComponent(JSON.stringify(result)))));
  } catch (error) {
    const result = {ok:false, error: String(error && error.stack || error)};
    document.body.setAttribute('data-xss-result', btoa(unescape(encodeURIComponent(JSON.stringify(result)))));
  }
})();
</script>`;

const scriptStart = page.indexOf('<script>\n// SETTINGS & MEMORY');
if (scriptStart === -1) throw new Error('Could not find application script start');
const withPrelude = page.slice(0, scriptStart) + prelude + page.slice(scriptStart);
const insertAt = withPrelude.lastIndexOf('</body>');
if (insertAt === -1) throw new Error('Could not find closing body tag');
const harness = withPrelude.slice(0, insertAt) + verifier + withPrelude.slice(insertAt);

const dir = await mkdtemp(join(tmpdir(), 'mikel-xss-'));
const harnessPath = join(dir, 'index.html');
await writeFile(harnessPath, harness);

const userDataDir = join(dir, 'chrome-profile');
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--user-data-dir=${userDataDir}`,
  '--virtual-time-budget=5000',
  '--dump-dom',
  `file://${harnessPath}`
];
const run = spawnSync('timeout', ['--kill-after=2s', '20s', chrome, ...args], {encoding:'utf8', maxBuffer: 10 * 1024 * 1024});
const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const match = output.match(/data-xss-result="([^"]+)"/);
if (!match) {
  console.error(output);
  throw new Error(`Chrome did not emit XSS result (exit ${run.status})`);
}

const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
