import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const sourcePath = path.join(root, 'index.html');
const html = readFileSync(sourcePath, 'utf8');

const payload = `<img src=x onerror="window.__xssHit('img')"><svg onload="window.__xssHit('svg')"></svg><strong>safe markdown</strong>`;
const attrPayload = `" autofocus onfocus="window.__xssHit('attr')" x="`;
const visualPayload = `<div onclick="window.__xssHit('visual-click')" style="color:red;background:url(javascript:window.__xssHit('css'))"><img src=x onerror="window.__xssHit('visual-img')"><script>window.__xssHit('visual-script')</script><svg onload="window.__xssHit('visual-svg')"></svg><p>Allowed text</p><a href="javascript:window.__xssHit('href')">link text</a></div>`;
const today = new Date().getDay();

const seed = {
  payload,
  visualPayload,
  attrPayload,
  storage: {
    groqKey: 'gsk_test_key',
    uSet: JSON.stringify({ name: payload, pin: '2007', accent: 'blue' }),
    mem: JSON.stringify([payload]),
    uCls: JSON.stringify([{ code: attrPayload, name: attrPayload, time: attrPayload, days: attrPayload }]),
    todos: JSON.stringify([{ id: 1, text: payload, p: 'high', done: false }]),
    schedule: JSON.stringify({ [today]: [{ id: 2, time: payload, title: payload, sub: payload }] }),
    savedVis: JSON.stringify([{ type: 'summary', label: payload, notes: payload, html: visualPayload, date: payload }]),
  },
};

const jsData = JSON.stringify(seed).replace(/</g, '\\u003C');
const prelude = `<script>
window.__xssHits = [];
window.__xssHit = label => window.__xssHits.push(label);
window.__seed = ${jsData};
window.__xssPayload = window.__seed.payload;
window.__visualPayload = window.__seed.visualPayload;
localStorage.clear();
for (const [key, value] of Object.entries(window.__seed.storage)) localStorage.setItem(key, value);
window.fetch = async () => ({ json: async () => ({ quoteResponse: { result: [
  { symbol: 'AAPL', regularMarketChangePercent: 1.2, regularMarketPrice: 123.45, regularMarketChange: 1.5 },
  { symbol: window.__xssPayload, regularMarketChangePercent: 2, regularMarketPrice: 10, regularMarketChange: 1 }
] } }) });
</script>`;

const harness = `<script data-test-script>
(async () => {
  const issues = [];
  const run = async (name, fn) => {
    try { await fn(); } catch (error) { issues.push(name + ': ' + error.message); }
  };
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10);
  const compactDate = ymd.replaceAll('-', '') + 'T120000';

  await run('settings render', () => initSettings());
  await run('ai chat render', () => {
    appendMsg('user', window.__xssPayload);
    appendMsg('assistant', window.__xssPayload);
  });
  await run('ics render', () => {
    parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:' + window.__xssPayload + '\\nDTSTART:' + compactDate + '\\nDTEND:' + compactDate + '\\nEND:VEVENT\\nEND:VCALENDAR');
    renderCal();
  });
  await run('personal calendar render', () => {
    document.getElementById('evTitle').value = window.__xssPayload;
    document.getElementById('evDate').value = ymd;
    document.getElementById('evTime').value = window.__xssPayload;
    addCalEv();
  });
  await run('saved visual render', () => loadVis(0));
  await run('deep dive format', () => {
    document.getElementById('ddBox').innerHTML = formatDD(window.__xssPayload);
  });
  await run('generated visual render', async () => {
    window.fetch = async () => ({ json: async () => ({ choices: [{ message: { content: window.__visualPayload } }] }) });
    document.getElementById('studyIn').value = 'malicious visual test';
    await genVis();
  });
  await run('deep dive follow-up render', async () => {
    window.fetch = async () => ({ json: async () => ({ choices: [{ message: { content: window.__xssPayload } }] }) });
    document.getElementById('ddFollowIn').value = window.__xssPayload;
    await sendDDFollow();
  });

  await new Promise(resolve => setTimeout(resolve, 250));

  const containers = ['greet', 'memChips', 'clsSettings', 'todoList', 'shiftList', 'schSlots', 'calEvents', 'aiMsgs', 'visBox', 'savedList', 'ddBox'];
  const forbiddenSelector = 'script,iframe,object,embed,link,meta,base,form,input:not(.field):not(.si),button[onclick*="__xssHit"],svg,math,img,[onload],[onerror],[onclick*="__xssHit"],[srcdoc],[href^="javascript:"],[style*="javascript"],[style*="expression"],[style*="url("]';
  const surviving = [];
  for (const id of containers) {
    const el = document.getElementById(id);
    if (!el) continue;
    const matches = el.querySelectorAll(forbiddenSelector);
    if (matches.length) surviving.push(id + ':' + Array.from(matches).map(node => node.tagName + ':' + Array.from(node.attributes).map(attr => attr.name + '=' + attr.value).join('|')).join(','));
  }

  const result = {
    ok: window.__xssHits.length === 0 && surviving.length === 0 && issues.length === 0,
    hits: window.__xssHits,
    surviving,
    issues,
  };
  const pre = document.createElement('pre');
  pre.id = 'xss-result';
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
  document.title = 'XSS_TEST_DONE';
})();
</script>`;

const mainScriptIndex = html.indexOf('<script>\n// SETTINGS');
if (mainScriptIndex === -1) throw new Error('Could not find dashboard script insertion point');
const bodyCloseIndex = html.lastIndexOf('</body>');
if (bodyCloseIndex === -1) throw new Error('Could not find body close insertion point');

const instrumented = html.slice(0, mainScriptIndex) + prelude + html.slice(mainScriptIndex, bodyCloseIndex) + harness + html.slice(bodyCloseIndex);
const tempDir = mkdtempSync(path.join(tmpdir(), 'mikel-xss-'));
const tempHtml = path.join(tempDir, 'index.html');
const profileDir = path.join(tempDir, 'chrome-profile');
writeFileSync(tempHtml, instrumented);

const chrome = process.env.CHROME_BIN || '/usr/local/bin/google-chrome';
const result = spawnSync(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--user-data-dir=${profileDir}`,
  '--virtual-time-budget=5000',
  '--dump-dom',
  pathToFileURL(tempHtml).href,
], { encoding: 'utf8', timeout: 15000 });

try {
  if (result.error) throw result.error;
  const output = result.stdout || '';
  const match = output.match(/<pre id="xss-result">([^]*?)<\/pre>/);
  if (!match) {
    throw new Error(`Browser did not emit xss-result. exit=${result.status} stderr=${result.stderr}`);
  }
  const parsed = JSON.parse(match[1]);
  if (!parsed.ok) {
    throw new Error(`XSS regression failed: ${JSON.stringify(parsed, null, 2)}`);
  }
  console.log('XSS regression passed:', JSON.stringify(parsed));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
