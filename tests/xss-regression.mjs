import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const indexPath = join(root, 'index.html');
const source = readFileSync(indexPath, 'utf8');

const escapeScriptJSON = value =>
  JSON.stringify(value).replace(/<\/script/gi, '<\\/script');

const payload = label =>
  `<img src=x onerror="document.body.setAttribute('data-xss',(document.body.getAttribute('data-xss')||'')+'${label},')">`;

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, '0');
const d = String(today.getDate()).padStart(2, '0');
const icsDate = `${y}${m}${d}`;

const dangerousVisual =
  `<div style="color:red;background-image:url(javascript:alert(1))" onclick="document.body.setAttribute('data-xss','visual-click')">Safe visual` +
  `<img src=x onerror="document.body.setAttribute('data-xss','visual-img')">` +
  `<script>document.body.setAttribute('data-xss','visual-script')</script>` +
  `<span style="color:blue;position:absolute">Kept text</span></div>`;

const prelude = `
<script>
window.__xssHits = [];
window.alert = value => window.__xssHits.push(String(value));
window.open = () => ({
  document: {
    write(html) { window.__lastPrintHTML = html; },
    close() {}
  }
});
window.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : {};
  if (String(url).includes('groq.com')) {
    return { json: async () => ({ choices: [{ message: { content: ${escapeScriptJSON(dangerousVisual)} } }] }) };
  }
  return { json: async () => ({ quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 1, regularMarketChangePercent: 0, regularMarketChange: 0 }] } }) };
};
localStorage.clear();
localStorage.setItem('groqKey', 'gsk_test');
localStorage.setItem('uSet', ${escapeScriptJSON(JSON.stringify({ name: payload('profile'), pin: '2007', accent: 'blue' }))});
localStorage.setItem('mem', ${escapeScriptJSON(JSON.stringify([payload('memory')]))});
localStorage.setItem('todos', ${escapeScriptJSON(JSON.stringify([{ id: 1, text: payload('todo'), p: 'high', done: false }]))});
localStorage.setItem('schedule', ${escapeScriptJSON(JSON.stringify({ [today.getDay()]: [{ id: 2, time: payload('schedule-time'), title: payload('schedule-title'), sub: payload('schedule-sub') }] }))});
localStorage.setItem('uCls', ${escapeScriptJSON(JSON.stringify([{ code: payload('class-code'), name: payload('class-name'), time: payload('class-time'), days: payload('class-days') }]))});
localStorage.setItem('savedVis', ${escapeScriptJSON(JSON.stringify([{ type: 'mindmap', label: payload('saved-label'), notes: payload('saved-notes'), date: payload('saved-date'), html: dangerousVisual }]))});
</script>`;

const verifier = `
<script>
(async () => {
  const failures = [];
  const assert = (condition, message) => { if (!condition) failures.push(message); };

  initSettings();
  renderTodos();
  renderSch();
  parseICS(${escapeScriptJSON(`BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:${payload('ics-summary')}
DTSTART:${icsDate}T090000
DTEND:${icsDate}T100000
END:VEVENT
END:VCALENDAR`)});
  document.getElementById('evTitle').value = ${escapeScriptJSON(payload('calendar-title'))};
  document.getElementById('evDate').value = ${escapeScriptJSON(todayISO)};
  document.getElementById('evTime').value = ${escapeScriptJSON(payload('calendar-time'))};
  addCalEv();
  appendMsg('user', ${escapeScriptJSON(payload('ai-user'))});
  appendMsg('assistant', '**Bold** ' + ${escapeScriptJSON(payload('ai-assistant'))});
  document.getElementById('ddBox').innerHTML = formatDD('**Deep** ' + ${escapeScriptJSON(payload('deep-dive'))});
  loadVis(0);
  document.getElementById('studyIn').value = 'topic';
  await genVis();
  await new Promise(resolve => setTimeout(resolve, 250));

  const xss = document.body.getAttribute('data-xss') || '';
  assert(xss === '', 'payload executed: ' + xss);
  assert(window.__xssHits.length === 0, 'alert executed: ' + window.__xssHits.join(','));
  assert(!document.querySelector('#greet img'), 'profile payload parsed as image');
  assert(!document.querySelector('#memChips img'), 'memory payload parsed as image');
  assert(!document.querySelector('#todoList img'), 'todo payload parsed as image');
  assert(!document.querySelector('#schSlots img'), 'schedule payload parsed as image');
  assert(!document.querySelector('#shiftList img'), 'ICS payload parsed as image');
  assert(!document.querySelector('#calEvents img'), 'calendar payload parsed as image');
  assert(!document.querySelector('#aiMsgs img'), 'AI payload parsed as image');
  assert(!document.querySelector('#ddBox img'), 'Deep Dive payload parsed as image');
  assert(!document.querySelector('#savedList img'), 'saved visual metadata payload parsed as image');
  assert(!document.querySelector('#visBox img,#visBox script,#visBox [onclick],#visBox [onerror],#visBox [onload]'), 'unsafe generated visual markup survived');
  assert(!/url\\s*\\(/i.test(document.getElementById('visBox').innerHTML), 'unsafe CSS url survived');
  assert(document.getElementById('visBox').textContent.includes('Safe visual'), 'safe generated visual text was removed');
  assert(document.getElementById('visBox').textContent.includes('Kept text'), 'safe nested visual text was removed');

  const result = document.createElement('pre');
  result.id = 'xss-regression-result';
  result.textContent = JSON.stringify({ ok: failures.length === 0, failures });
  document.body.setAttribute('data-test-status', failures.length === 0 ? 'pass' : 'fail');
  document.body.appendChild(result);
})();
</script>`;

const withPrelude = source.replace('<script>', `${prelude}<script>`);
const bodyClose = withPrelude.lastIndexOf('</body>');
if (bodyClose === -1) {
  throw new Error('closing body tag not found');
}
const html = `${withPrelude.slice(0, bodyClose)}${verifier}${withPrelude.slice(bodyClose)}`;
const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const harnessPath = join(dir, 'harness.html');
const profilePath = join(dir, 'chrome-profile');
writeFileSync(harnessPath, html);

const chrome = process.env.CHROME_BIN || '/usr/local/bin/google-chrome';
let output = '';
try {
  output = execFileSync('timeout', [
    '--kill-after=2s',
    '12s',
    chrome,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profilePath}`,
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=3000',
    '--dump-dom',
    harnessPath,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
} catch (error) {
  output = error.stdout || '';
  if (error.status !== 124 || !output) {
    throw error;
  }
}

const match = output.match(/<pre id="xss-regression-result">([^<]+)<\/pre>/);
if (!match) {
  throw new Error('XSS regression result marker was not found in Chrome output');
}

const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (!result.ok) {
  throw new Error(`XSS regression failed:\\n${result.failures.join('\\n')}`);
}

console.log('XSS regression passed');
