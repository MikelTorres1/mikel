import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const payload = '<img src=x onerror="window.__xssHits.push(\'img\')"><svg onload="window.__xssHits.push(\'svg\')"></svg><a href="javascript:window.__xssHits.push(\'href\')">link</a><script>window.__xssHits.push(\'script\')</script>';
const visualPayload = '<div style="color:#f59e0b" onclick="window.__xssHits.push(\'visual-click\')"><img src=x onerror="window.__xssHits.push(\'visual-img\')"><span style="background:url(javascript:window.__xssHits.push(\'style\'))">Visual</span><script>window.__xssHits.push(\'visual-script\')</script></div>';
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

const prelude = `
<script>
(() => {
  const payload = atob('${b64(payload)}');
  const visualPayload = atob('${b64(visualPayload)}');
  window.__xssPayload = payload;
  window.__xssHits = [];
  window.alert = (msg) => window.__xssHits.push('alert:' + msg);
  window.fetch = async (url, opts = {}) => {
    const body = String(opts.body || '');
    if (String(url).includes('finance')) {
      return { json: async () => ({ quoteResponse: { result: [
        { symbol: 'AAPL', regularMarketPrice: 123.45, regularMarketChangePercent: 1.2, regularMarketChange: 1.5 },
        { symbol: 'BAD\\');window.__xssHits.push(\\'market\\');//', regularMarketPrice: 10, regularMarketChangePercent: -2, regularMarketChange: -0.5 }
      ] } }) };
    }
    return { json: async () => ({ choices: [{ message: { content: body.includes('Create a visual') ? visualPayload : ('**Header**\\n\\n' + payload) } }] }) };
  };
  localStorage.setItem('groqKey', 'gsk_test');
  localStorage.setItem('uSet', JSON.stringify({ name: payload, pin: '2007', accent: 'blue' }));
  localStorage.setItem('mem', JSON.stringify([payload]));
  localStorage.setItem('uCls', JSON.stringify([{ code: payload, name: payload, time: payload, days: payload }]));
  localStorage.setItem('todos', JSON.stringify([{ id: '1);window.__xssHits.push("todo-id");//', text: payload, p: 'high', done: false }]));
  const today = String(new Date().getDay());
  localStorage.setItem('schedule', JSON.stringify({ [today]: [{ id: '1);window.__xssHits.push("schedule-id");//', time: payload, title: payload, sub: payload }] }));
  localStorage.setItem('savedVis', JSON.stringify([{ type: 'mindmap', label: payload, notes: payload, html: visualPayload, date: payload }]));
})();
</script>`;

const verifier = `
<script>
(async () => {
  const errors = [];
  const payload = window.__xssPayload;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
  try {
    applySaved();
    tick();
    renderMem();
    initSettings();
    renderTodos();
    renderSch();
    parseICS('BEGIN:VEVENT\\nSUMMARY:' + payload + '\\nDTSTART:20300101T120000\\nDTEND:20300101T130000\\nEND:VEVENT');
    calSelected = new Date('2030-01-01T12:00:00');
    renderCal();
    document.getElementById('evTitle').value = payload;
    document.getElementById('evDate').value = '2030-01-01';
    document.getElementById('evTime').value = payload;
    addCalEv();
    calSelected = new Date('2030-01-01T12:00:00');
    renderCal();
    appendMsg('user', payload);
    appendMsg('assistant', '**Bold**\\n\\n' + payload);
    document.getElementById('studyIn').value = 'topic';
    await genVis();
    saveVis();
    renderSaved();
    loadVis(0);
    document.getElementById('ddIn').value = 'topic';
    await runDD();
    document.getElementById('ddFollowIn').value = payload;
    await sendDDFollow();
    await loadMarkets();
    await pause();
  } catch (err) {
    errors.push(err && err.stack ? err.stack : String(err));
  }

  const scopes = ['greet', 'memChips', 'clsSettings', 'todoList', 'shiftList', 'schSlots', 'calEvents', 'aiMsgs', 'visBox', 'savedList', 'ddBox', 'mktGrid'];
  const dangerous = [];
  for (const id of scopes) {
    const root = document.getElementById(id);
    if (!root) continue;
    for (const el of root.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'iframe', 'object', 'embed', 'svg', 'img'].includes(tag)) {
        dangerous.push(id + ':' + el.outerHTML.slice(0, 180));
        continue;
      }
      for (const attr of el.attributes) {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        if (name.startsWith('on') && /__xssHits|alert|fetch|localStorage|javascript/i.test(value)) {
          dangerous.push(id + ':' + el.outerHTML.slice(0, 180));
        }
        if ((name === 'href' || name === 'src' || name === 'srcdoc') && /^\\s*javascript:/i.test(value)) {
          dangerous.push(id + ':' + el.outerHTML.slice(0, 180));
        }
        if (name === 'style' && /(url\\s*\\(|expression\\s*\\(|javascript:|data:)/i.test(value)) {
          dangerous.push(id + ':' + el.outerHTML.slice(0, 180));
        }
      }
    }
  }

  const result = { ok: window.__xssHits.length === 0 && dangerous.length === 0 && errors.length === 0, hits: window.__xssHits, dangerous, errors };
  const out = document.createElement('pre');
  out.id = 'xss-result';
  out.textContent = '__XSS_RESULT__' + JSON.stringify(result);
  document.body.appendChild(out);
})();
</script>`;

const firstScript = source.indexOf('<script>');
const lastBody = source.lastIndexOf('</body>');
if (firstScript === -1 || lastBody === -1) {
  throw new Error('index.html structure changed; test harness insertion failed');
}

const html = source.slice(0, firstScript) + prelude + source.slice(firstScript, lastBody) + verifier + source.slice(lastBody);
const tempDir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(tempDir, 'index.html');
const profileDir = join(tempDir, 'chrome-profile');
writeFileSync(htmlPath, html);

try {
  const chrome = process.env.CHROME_BIN || '/usr/local/bin/google-chrome';
  const args = [
    '--kill-after=2s',
    '20s',
    chrome,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--virtual-time-budget=5000',
    `--user-data-dir=${profileDir}`,
    '--dump-dom',
    `file://${htmlPath}`
  ];
  const run = spawnSync('timeout', args, { cwd: root.pathname, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const match = output.match(/__XSS_RESULT__(\{.*?\})/s);
  if (!match) {
    throw new Error(`XSS harness did not emit a result. exit=${run.status}\n${output.slice(-4000)}`);
  }
  const result = JSON.parse(match[1]);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
