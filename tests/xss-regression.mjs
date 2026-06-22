import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const setup = String.raw`
window.__xssHits = [];
const hit = name => "window.__xssHits.push('" + name + "')";
const payload = name => '<img src=x onerror="' + hit(name) + '">';
localStorage.setItem('groqKey', 'gsk_test');
localStorage.setItem('uSet', JSON.stringify({ name: payload('name'), pin: '2007', accent: 'blue' }));
localStorage.setItem('mem', JSON.stringify([payload('mem')]));
localStorage.setItem('todos', JSON.stringify([{ id: 'todo-id");window.__xssHits.push("todo-id");//', text: payload('todo'), p: 'high', done: false }]));
localStorage.setItem('schedule', JSON.stringify({ "1": [{ id: 'sch-id");window.__xssHits.push("sch-id");//', time: payload('sch-time'), title: payload('sch-title'), sub: payload('sch-sub') }] }));
localStorage.setItem('uCls', JSON.stringify([{ code: payload('class-code'), name: payload('class-name'), time: payload('class-time'), days: payload('class-days') }]));
localStorage.setItem('savedVis', JSON.stringify([{
  type: 'mindmap',
  label: payload('saved-label'),
  notes: payload('saved-notes'),
  html: '<div onclick="' + hit('saved-click') + '"><img src=x onerror="' + hit('saved-img') + '"><a href="javascript:' + hit('saved-href') + '">bad</a><scr' + 'ipt>' + hit('saved-script') + '</scr' + 'ipt><span style="color:red">safe</span></div>',
  date: payload('saved-date')
}]));
window.fetch = async url => {
  if (String(url).includes('corsproxy.io')) {
    return { json: async () => ({ quoteResponse: { result: [{ symbol: "BAD');window.__xssHits.push('market');//", regularMarketPrice: 10, regularMarketChangePercent: 1, regularMarketChange: 1 }] } }) };
  }
  return { json: async () => ({ choices: [{ message: { content: '<div onclick="' + hit('generated-click') + '"><img src=x onerror="' + hit('generated-img') + '"><a href="javascript:' + hit('generated-href') + '">bad</a><scr' + 'ipt>' + hit('generated-script') + '</scr' + 'ipt><p>**bold**</p></div>' } }] }) };
};
`;

const verify = String.raw`
(async () => {
  const payload = name => '<img src=x onerror="window.__xssHits.push(\'' + name + '\')">';
  try {
    initSettings();
    renderTodos();
    schDay = 1;
    renderSch();
    parseICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:' + payload('ics') + '\nDTSTART:20990101T090000\nDTEND:20990101T100000\nEND:VEVENT\nEND:VCALENDAR');
    calSelected = new Date('2099-01-01T12:00:00');
    renderCalEvs();
    document.getElementById('evTitle').value = payload('personal');
    document.getElementById('evDate').value = '2099-01-01';
    document.getElementById('evTime').value = '10:30';
    addCalEv();
    appendMsg('user', payload('ai-user'));
    appendMsg('assistant', '**ok**\n\n' + payload('ai-assistant'));
    document.getElementById('ddBox').innerHTML = formatDD('**header**\n\n- ' + payload('dd'));
    document.getElementById('ddFollowIn').value = payload('dd-question');
    ddContext = payload('context');
    await sendDDFollow();
    loadVis(0);
    document.getElementById('studyIn').value = 'safe notes';
    await genVis();
    await loadMarkets();
    await new Promise(resolve => setTimeout(resolve, 250));
    const dangerous = [];
    document.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (/__xssHits|javascript:/i.test(attr.value)) dangerous.push(el.tagName.toLowerCase() + '[' + attr.name + '=' + attr.value + ']');
      });
    });
    const result = { ok: window.__xssHits.length === 0 && dangerous.length === 0, hits: window.__xssHits, dangerous };
    const pre = document.createElement('pre');
    pre.id = 'xss-result';
    pre.textContent = 'XSS_RESULT:' + JSON.stringify(result);
    document.body.appendChild(pre);
  } catch (error) {
    const pre = document.createElement('pre');
    pre.id = 'xss-result';
    pre.textContent = 'XSS_RESULT:' + JSON.stringify({ ok: false, error: String(error && error.stack || error) });
    document.body.appendChild(pre);
  }
})();
`;

const firstScript = app.indexOf('<script>');
if (firstScript === -1) throw new Error('Could not find app script');
let html = app.slice(0, firstScript) + `<script>${setup}</script>` + app.slice(firstScript);
const bodyEnd = html.lastIndexOf('</body>');
if (bodyEnd === -1) throw new Error('Could not find body end');
html = html.slice(0, bodyEnd) + `<script>${verify}</script>` + html.slice(bodyEnd);

const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(dir, 'harness.html');
const userDataDir = join(dir, 'chrome-profile');
writeFileSync(htmlPath, html);

const chrome = spawnSync('timeout', [
  '--kill-after=2s',
  '15s',
  '/usr/local/bin/google-chrome',
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--virtual-time-budget=5000',
  `--user-data-dir=${userDataDir}`,
  `file://${htmlPath}`,
  '--dump-dom'
], { encoding: 'utf8' });

try {
  const output = `${chrome.stdout || ''}\n${chrome.stderr || ''}`;
  const match = output.match(/XSS_RESULT:({.*})/);
  if (!match) {
    console.error(output);
    throw new Error(`Chrome did not emit XSS_RESULT (status ${chrome.status})`);
  }
  const result = JSON.parse(match[1]);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
