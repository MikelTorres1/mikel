import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(tmp, 'harness.html');
const profileDir = join(tmp, 'profile');

const prelude = `<script>
(() => {
  window.__xssHits = [];
  window.__xss = label => window.__xssHits.push(String(label));
  window.alert = msg => window.__xss('alert:' + msg);
  window.open = url => {
    window.__opened = String(url || '');
    return { document: { write() {}, close() {} } };
  };
  const scriptTag = '<scr' + 'ipt>__xss("saved-script")</scr' + 'ipt>';
  localStorage.clear();
  localStorage.setItem('groqKey', 'gsk_test_secret');
  localStorage.setItem('uSet', JSON.stringify({
    name: '<img src=x onerror=__xss("name")>',
    pin: '2007',
    accent: 'blue'
  }));
  localStorage.setItem('mem', JSON.stringify([
    '<img src=x onerror=__xss("memory")>'
  ]));
  localStorage.setItem('uCls', JSON.stringify([
    { code: '"><img src=x onerror=__xss("class-code")>', name: 'Bad', time: '9', days: 'Mon' }
  ]));
  localStorage.setItem('todos', JSON.stringify([
    { id: '1);__xss("todo-id");//', text: '<img src=x onerror=__xss("todo-text")>', p: 'high', done: false }
  ]));
  localStorage.setItem('schedule', JSON.stringify({
    4: [{ id: '1);__xss("schedule-id");//', time: '<img src=x onerror=__xss("schedule-time")>', title: '<img src=x onerror=__xss("schedule-title")>', sub: '<img src=x onerror=__xss("schedule-sub")>' }]
  }));
  localStorage.setItem('savedVis', JSON.stringify([
    {
      type: 'mindmap',
      label: '<img src=x onerror=__xss("saved-label")>',
      notes: '<img src=x onerror=__xss("saved-notes")>',
      html: '<div onclick=__xss("saved-click")><img src=x onerror=__xss("saved-img")><a href="javascript:__xss(\\'saved-href\\')">bad</a>' + scriptTag + '</div>',
      date: '<img src=x onerror=__xss("saved-date")>'
    }
  ]));
  const jsonResponse = data => Promise.resolve({ json: () => Promise.resolve(data) });
  window.fetch = (url, opts = {}) => {
    if (!opts.body) {
      return jsonResponse({
        quoteResponse: {
          result: [{
            symbol: "AAPL');__xss('market');//",
            regularMarketChangePercent: 1.23,
            regularMarketPrice: 123.45,
            regularMarketChange: 1.5
          }]
        }
      });
    }
    const body = JSON.parse(opts.body || '{}');
    const visual = '<div onclick=__xss("visual-click")><img src=x onerror=__xss("visual-img")><a href="javascript:__xss(\\'visual-href\\')">bad</a><div style="background:url(javascript:__xss(\\'visual-css\\'))">card</div>' + scriptTag + '</div>';
    const text = '**Header**\\n\\n<img src=x onerror=__xss("ai-or-dd")>';
    return jsonResponse({
      choices: [{ message: { content: body.max_tokens === 2500 ? visual : text } }]
    });
  };
})();
</script>`;

const verifier = `<script>
(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const dangerous = [];
  const recordDangerous = () => {
    const containerIds = ['greet', 'memChips', 'clsSettings', 'todoList', 'shiftList', 'schSlots', 'calEvents', 'mktGrid', 'aiMsgs', 'visBox', 'savedList', 'ddBox'];
    for (const id of containerIds) {
      const root = document.getElementById(id);
      if (!root) continue;
      root.querySelectorAll('script').forEach(el => dangerous.push(id + ':script'));
      root.querySelectorAll('*').forEach(el => {
        for (const attr of el.attributes) {
          const name = attr.name.toLowerCase();
          const value = attr.value || '';
          if ((name.startsWith('on') && value.includes('__xss')) || /^\\s*javascript:/i.test(value) || value.includes('javascript:__xss')) {
            dangerous.push(id + ':' + el.tagName.toLowerCase() + '[' + name + '=' + value + ']');
          }
        }
      });
    }
  };

  await wait(500);
  initSettings();
  parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:<img src=x onerror=__xss("ics")>\\nDTSTART:20260625T120000\\nDTEND:20260625T130000\\nEND:VEVENT\\nEND:VCALENDAR');
  calSelected = new Date('2026-06-25T12:00:00');
  renderCal();
  document.getElementById('evTitle').value = '<img src=x onerror=__xss("calendar-title")>';
  document.getElementById('evDate').value = '2026-06-25';
  document.getElementById('evTime').value = '<img src=x onerror=__xss("calendar-time")>';
  addCalEv();
  document.querySelector('#mktGrid [onclick]')?.click();
  document.getElementById('aiIn').value = '<img src=x onerror=__xss("ai-user")>';
  await sendAI();
  document.getElementById('studyIn').value = 'notes';
  await genVis();
  saveVis();
  renderSaved();
  loadVis(0);
  document.querySelector('#visBox [onclick]')?.click();
  document.querySelector('#visBox a[href^="javascript:"]')?.click();
  document.getElementById('ddIn').value = '<img src=x onerror=__xss("dd-input")>';
  await runDD();
  document.getElementById('ddFollowIn').value = '<img src=x onerror=__xss("follow-question")>';
  await sendDDFollow();
  await wait(750);
  recordDangerous();
  const result = { ok: window.__xssHits.length === 0 && dangerous.length === 0, hits: window.__xssHits, dangerous };
  const out = document.createElement('pre');
  out.id = '__xss_result__';
  out.textContent = btoa(JSON.stringify(result));
  document.body.appendChild(out);
})();
</script>`;

const firstScript = '<script>\n// SETTINGS';
const withPrelude = html.replace(firstScript, prelude + firstScript);
const bodyClose = withPrelude.lastIndexOf('</body>');
if (bodyClose === -1) {
  throw new Error('Could not inject verifier before </body>');
}
writeFileSync(htmlPath, withPrelude.slice(0, bodyClose) + verifier + withPrelude.slice(bodyClose));

try {
  const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
  const result = spawnSync('timeout', [
    '--kill-after=2s',
    '20s',
    chrome,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--virtual-time-budget=8000',
    `--user-data-dir=${profileDir}`,
    '--dump-dom',
    `file://${htmlPath}`
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

  const output = `${result.stdout || ''}\\n${result.stderr || ''}`;
  const match = output.match(/<pre id="__xss_result__">([^<]+)<\\/pre>/);
  if (!match) {
    throw new Error(`XSS regression harness did not produce a result. status=${result.status}\\n${output.slice(-4000)}`);
  }
  const report = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  if (!report.ok) {
    throw new Error(`XSS regression failed: ${JSON.stringify(report, null, 2)}`);
  }
  console.log(JSON.stringify(report));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
