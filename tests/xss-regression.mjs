import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const indexPath = new URL('index.html', root);
const index = readFileSync(indexPath, 'utf8');
const workDir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const chrome = process.env.CHROME_BIN || '/usr/local/bin/google-chrome';

const prelude = String.raw`
<script>
window.__xssHits = [];
window.fetch = async () => ({ json: async () => ({ quoteResponse: { result: [] } }) });
const p = id => '<img src=x data-xss="' + id + '" onerror="window.__xssHits.push(\'' + id + '\')">';
localStorage.clear();
localStorage.setItem('groqKey', 'gsk_test_key');
localStorage.setItem('uSet', JSON.stringify({ name: p('profile-name'), pin: '2007', accent: 'blue' }));
localStorage.setItem('mem', JSON.stringify([p('memory')]));
localStorage.setItem('uCls', JSON.stringify([{ code: '"><img src=x data-xss="class-code" onerror="window.__xssHits.push(\'class-code\')">', name: p('class-name'), time: p('class-time'), days: p('class-days') }]));
localStorage.setItem('todos', JSON.stringify([{ id: 101, text: p('todo'), p: 'high', done: false }]));
localStorage.setItem('schedule', JSON.stringify({ 1: [{ id: 201, time: p('schedule-time'), title: p('schedule-title'), sub: p('schedule-sub') }] }));
localStorage.setItem('savedVis', JSON.stringify([{
  type: 'mindmap',
  label: p('saved-label'),
  notes: p('saved-notes'),
  date: p('saved-date'),
  html: '<div data-xss="visual-root" onclick="window.__xssHits.push(\'visual-click\')" style="background:url(javascript:alert(1));color:#fff;"><span>visual</span><img src=x data-xss="visual-img" onerror="window.__xssHits.push(\'visual-img\')"><script>window.__xssHits.push(\'visual-script\')</scr' + 'ipt></div>'
}]));
</script>
`;

const verifier = String.raw`
<script>
(function(){
  const p = id => '<img src=x data-xss="' + id + '" onerror="window.__xssHits.push(\'' + id + '\')">';
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, '0');
  const d = String(stamp.getDate()).padStart(2, '0');
  const icsDate = '' + y + m + d + 'T120000';
  try {
    initSettings();
    schDay = 1;
    renderSch();
    parseICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:' + p('ics-summary') + '\nDTSTART:' + icsDate + '\nDTEND:' + icsDate + '\nEND:VEVENT\nEND:VCALENDAR');
    personalEvs = [{ title: p('calendar-title'), date: new Date(stamp.toDateString()), time: p('calendar-time'), type: 'personal' }];
    calSelected = new Date(stamp.toDateString());
    renderCal();
    appendMsg('user', p('ai-user') + '\n\n**bold**');
    appendMsg('assistant', p('ai-assistant'));
    document.getElementById('ddBox').innerHTML = formatDD('# Header ' + p('deep-dive') + '\n\n- Item ' + p('deep-dive-list'));
    savedVis = JSON.parse(localStorage.getItem('savedVis'));
    renderSaved();
    loadVis(0);
    document.querySelectorAll('img').forEach(img => img.dispatchEvent(new Event('error')));
    const active = Array.from(document.querySelectorAll('[data-xss]')).filter(el => {
      const attrs = el.getAttributeNames();
      return attrs.some(name => /^on/i.test(name) || ['href', 'src', 'srcdoc', 'xlink:href', 'formaction'].includes(name.toLowerCase())) ||
        /url\s*\(|javascript:/i.test(el.getAttribute('style') || '');
    }).map(el => ({
      sink: el.getAttribute('data-xss'),
      tag: el.tagName.toLowerCase(),
      attrs: el.getAttributeNames().filter(name => /^on/i.test(name) || ['href', 'src', 'srcdoc', 'xlink:href', 'formaction', 'style'].includes(name.toLowerCase()))
    }));
    const result = { ok: window.__xssHits.length === 0 && active.length === 0, hits: window.__xssHits, active };
    document.body.setAttribute('data-xss-result', JSON.stringify(result));
    const out = document.createElement('pre');
    out.id = 'xss-result';
    out.textContent = JSON.stringify(result);
    document.body.appendChild(out);
  } catch (err) {
    const result = { ok: false, error: String(err && (err.stack || err.message || err)) };
    document.body.setAttribute('data-xss-result', JSON.stringify(result));
    const out = document.createElement('pre');
    out.id = 'xss-result';
    out.textContent = JSON.stringify(result);
    document.body.appendChild(out);
  }
})();
</script>
`;

try {
  const scriptIndex = index.indexOf('<script>');
  const bodyIndex = index.lastIndexOf('</body>');
  if (scriptIndex === -1 || bodyIndex === -1) {
    throw new Error('Could not locate script or body injection point');
  }
  const withPrelude = index.slice(0, scriptIndex) + prelude + index.slice(scriptIndex);
  const adjustedBodyIndex = bodyIndex + prelude.length;
  const harness = withPrelude.slice(0, adjustedBodyIndex) + verifier + withPrelude.slice(adjustedBodyIndex);
  const harnessPath = join(workDir, 'harness.html');
  const userDataDir = join(workDir, 'chrome-profile');
  writeFileSync(harnessPath, harness);

  const result = spawnSync('timeout', [
    '--kill-after=2s',
    '12s',
    chrome,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--virtual-time-budget=1000',
    `--user-data-dir=${userDataDir}`,
    '--dump-dom',
    `file://${harnessPath}`
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/<pre id="xss-result">([^<]+)<\/pre>/) || output.match(/data-xss-result="([^"]+)"/);
  if (!match) {
    throw new Error(`Could not find XSS result in Chrome output. exit=${result.status}\n${output.slice(-4000)}`);
  }
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const parsed = JSON.parse(decoded);
  if (!parsed.ok) {
    throw new Error(`XSS regression failed: ${JSON.stringify(parsed)}`);
  }
  console.log(`XSS regression passed: ${JSON.stringify(parsed)}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
