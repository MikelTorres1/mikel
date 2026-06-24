import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const source = readFileSync(join(root, 'index.html'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'mikel-xss-'));

const payload = `<img src=x onerror="window.__xssHits.push('img')">`;
const attrPayload = `"><img src=x onerror="window.__xssHits.push('attr')">`;
const visualPayload = `<div onclick="window.__xssHits.push('visual-click')" style="background:url(javascript:window.__xssHits.push('style'));color:red"><img src=x onerror="window.__xssHits.push('visual-img')"><scr` +
  `ipt>window.__xssHits.push('visual-script')</scr` +
  `ipt><iframe srcdoc="<script>window.__xssHits.push('frame')</script>"></iframe><span>safe visual text</span></div>`;

function scriptString(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

const seedScript = `
<script>
window.__xssHits = [];
window.__payload = ${scriptString(payload)};
window.__visualPayload = ${scriptString(visualPayload)};
localStorage.setItem('groqKey','gsk_test');
localStorage.setItem('uSet', JSON.stringify({name: window.__payload, pin: '2007', accent: 'blue'}));
localStorage.setItem('mem', JSON.stringify([window.__payload]));
localStorage.setItem('uCls', JSON.stringify([{code:${scriptString(attrPayload)},name:${scriptString(attrPayload)},time:${scriptString(attrPayload)},days:${scriptString(attrPayload)}}]));
localStorage.setItem('todos', JSON.stringify([{id:"1);window.__xssHits.push('todo-id');//",text:window.__payload,p:'high',done:false}]));
const schedule = {};
for (let i = 0; i < 7; i++) schedule[i] = [{id:"1);window.__xssHits.push('schedule-id');//",time:window.__payload,title:window.__payload,sub:window.__payload}];
localStorage.setItem('schedule', JSON.stringify(schedule));
localStorage.setItem('savedVis', JSON.stringify([{type:'summary',label:window.__payload,notes:window.__payload,date:window.__payload,html:window.__visualPayload}]));
window.fetch = async (url) => ({
  json: async () => String(url).includes('finance')
    ? {quoteResponse:{result:[
        {symbol:'AAPL',regularMarketPrice:1,regularMarketChangePercent:2,regularMarketChange:3},
        {symbol:"BAD');window.__xssHits.push('market');//",regularMarketPrice:1,regularMarketChangePercent:2,regularMarketChange:3}
      ]}}
    : {choices:[{message:{content:window.__visualPayload}}]}
});
</script>`;

const verifyScript = `
<script>
(async () => {
  try {
    await new Promise(r => setTimeout(r, 150));
    tick();
    renderTodos();
    initSettings();
    renderSch();
    parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:' + window.__payload + '\\nDTSTART:20990101T090000\\nDTEND:20990101T170000\\nEND:VEVENT\\nEND:VCALENDAR');
    calSelected = new Date('2099-01-01T12:00:00');
    document.getElementById('evTitle').value = window.__payload;
    document.getElementById('evDate').value = '2099-01-01';
    document.getElementById('evTime').value = window.__payload;
    addCalEv();
    appendMsg('user', window.__payload);
    appendMsg('assistant', window.__visualPayload);
    loadVis(0);
    document.getElementById('studyIn').value = 'notes';
    await genVis();
    document.getElementById('ddIn').value = 'topic';
    await runDD();
    document.getElementById('ddFollowIn').value = window.__payload;
    await sendDDFollow();
    await loadMarkets();
    await new Promise(r => setTimeout(r, 400));

    const scoped = ['todoList','memChips','clsSettings','shiftList','schSlots','calEvents','aiMsgs','visBox','savedList','ddBox','mktGrid']
      .map(id => document.getElementById(id))
      .filter(Boolean);
    const active = [];
    for (const root of scoped) {
      root.querySelectorAll('script,iframe,object,embed,svg,math').forEach(el => active.push(el.outerHTML));
      root.querySelectorAll('*').forEach(el => {
        for (const attr of el.attributes) {
          if ((attr.name.toLowerCase().startsWith('on') || attr.name.toLowerCase() === 'srcdoc' || /javascript:/i.test(attr.value)) && attr.value.includes('__xssHits')) {
            active.push(el.outerHTML);
          }
        }
      });
    }
    const result = {ok: window.__xssHits.length === 0 && active.length === 0, hits: window.__xssHits, active};
    const pre = document.createElement('pre');
    pre.id = 'xss-result';
    pre.textContent = '__RESULT__' + JSON.stringify(result) + '__END__';
    document.body.appendChild(pre);
  } catch (err) {
    const pre = document.createElement('pre');
    pre.id = 'xss-result';
    pre.textContent = '__RESULT__' + JSON.stringify({ok:false,error:String(err && err.stack || err)}) + '__END__';
    document.body.appendChild(pre);
  }
})();
</script>`;

const html = source.replace('<body>', `<body>${seedScript}`).replace(/<\/body>\s*<\/html>\s*$/, `${verifyScript}</body></html>`);
const htmlPath = join(tmp, 'harness.html');
const profile = join(tmp, 'chrome-profile');
writeFileSync(htmlPath, html);

try {
  const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
  const run = spawnSync('timeout', ['--kill-after=2s', '20s', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--virtual-time-budget=5000', '--dump-dom', `file://${htmlPath}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const matches = [...output.matchAll(/__RESULT__(.*?)__END__/gs)];
  if (!matches.length) {
    throw new Error(`XSS harness did not emit a result. status=${run.status} stderr=${run.stderr}`);
  }
  let result;
  for (const match of matches.reverse()) {
    try {
      result = JSON.parse(match[1]);
      break;
    } catch {
      // Ignore the verifier source in --dump-dom; the appended result is JSON.
    }
  }
  if (!result) {
    throw new Error(`XSS harness emitted no parseable result. status=${run.status}`);
  }
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
