import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const appPath = new URL('../index.html', import.meta.url);
let html = readFileSync(appPath, 'utf8');

const attack = `<img src=x data-xss="img" onerror="window.__xssHit('img')"><svg data-xss="svg" onload="window.__xssHit('svg')"></svg><iframe data-xss="frame" srcdoc="x"></iframe>`;
const storage = {
  groqKey: 'gsk_test',
  uSet: JSON.stringify({ name: attack, pin: '2007', accent: 'blue' }),
  mem: JSON.stringify([attack]),
  uCls: JSON.stringify([{ code: attack, name: attack, time: attack, days: attack }]),
  todos: JSON.stringify([{ id: 1, text: attack, p: 'high', done: false }]),
  schedule: JSON.stringify({ 1: [{ id: 1, time: attack, title: attack, sub: attack }] }),
  savedVis: JSON.stringify([{ type: 'mindmap', label: attack, notes: attack, html: attack, date: attack }])
};

const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
const prelude = `<script>
(() => {
  const storage = JSON.parse(atob('${encode(storage)}'));
  Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, value));
  window.__xssHits = [];
  window.__xssHit = value => window.__xssHits.push(String(value));
  window.alert = value => window.__xssHit('alert:' + value);
  window.open = () => ({ document: { write() {}, close() {} } });
  window.fetch = async url => {
    if (String(url).includes('finance')) {
      return { json: async () => ({ quoteResponse: { result: [
        { symbol: 'AAPL', regularMarketPrice: 1, regularMarketChangePercent: 1, regularMarketChange: 1 },
        { symbol: "BAD');window.__xssHit('market');//", regularMarketPrice: 2, regularMarketChangePercent: -1, regularMarketChange: -1 }
      ] } }) };
    }
    return { json: async () => ({ choices: [{ message: { content: atob('${Buffer.from(attack, 'utf8').toString('base64')}') } }] }) };
  };
})();
</script>`;

const exercise = `<script>
(async () => {
  const attack = atob('${Buffer.from(attack, 'utf8').toString('base64')}');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    applySaved();
    tick();
    initSettings();
    renderTodos();
    schDay = 1;
    renderSch();
    parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:' + attack + '\\nDTSTART:20990101T120000Z\\nDTEND:20990101T130000Z\\nEND:VEVENT\\nEND:VCALENDAR');
    personalEvs = [{ title: attack, date: new Date(), time: attack, type: 'personal' }];
    calSelected = new Date();
    renderCalEvs();
    await loadMarkets();
    appendMsg('user', attack);
    appendMsg('assistant', attack);
    document.getElementById('visBox').innerHTML = safeInlineHTML(attack);
    savedVis = [{ type: 'mindmap', label: attack, notes: attack, html: attack, date: attack }];
    renderSaved();
    loadVis(0);
    document.getElementById('ddBox').innerHTML = formatDD(attack);
    document.getElementById('ddFollowIn').value = attack;
    await sendDDFollow();
    await wait(500);
    const roots = ['memChips','clsSettings','greet','todoList','shiftList','schSlots','calEvents','mktGrid','aiMsgs','visBox','savedList','ddBox']
      .map(id => document.getElementById(id)).filter(Boolean);
    const dangerous = roots.flatMap(root => [...root.querySelectorAll('script,iframe,svg,object,embed,img,[data-xss]')]
      .map(el => root.id + ':' + el.tagName.toLowerCase() + ':' + (el.getAttribute('data-xss') || '')));
    const result = { ok: window.__xssHits.length === 0 && dangerous.length === 0, hits: window.__xssHits, dangerous };
    const pre = document.createElement('pre');
    pre.id = 'xss-result';
    pre.textContent = JSON.stringify(result);
    document.body.appendChild(pre);
  } catch (error) {
    const pre = document.createElement('pre');
    pre.id = 'xss-result';
    pre.textContent = JSON.stringify({ ok: false, error: String(error && error.stack || error) });
    document.body.appendChild(pre);
  }
})();
</script>`;

const scriptNeedle = '<script>\n// SETTINGS & MEMORY';
html = html.replace(scriptNeedle, prelude + scriptNeedle);
const bodyEnd = html.lastIndexOf('</body>');
if (bodyEnd === -1) throw new Error('Could not find closing body tag');
html = html.slice(0, bodyEnd) + exercise + html.slice(bodyEnd);

const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const page = join(dir, 'index.html');
const profile = join(dir, 'profile');
writeFileSync(page, html);

const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
const result = spawnSync('timeout', [
  '--kill-after=2s',
  '20s',
  chrome,
  '--headless=new',
  '--no-sandbox',
  `--user-data-dir=${profile}`,
  '--disable-gpu',
  '--virtual-time-budget=5000',
  '--dump-dom',
  `file://${page}`
], { encoding: 'utf8' });

rmSync(dir, { recursive: true, force: true });

const output = `${result.stdout}\n${result.stderr}`;
const match = output.match(/<pre id="xss-result">([^<]+)<\/pre>/);
if (!match) {
  console.error(output);
  throw new Error(`No XSS result emitted (status ${result.status})`);
}

const decoded = match[1]
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');
const parsed = JSON.parse(decoded);
if (!parsed.ok) {
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
