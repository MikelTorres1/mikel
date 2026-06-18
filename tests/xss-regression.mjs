import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sourcePath = resolve('index.html');
const source = readFileSync(sourcePath, 'utf8');

const seed = String.raw`<script>
(() => {
  window.__xssHits = [];
  window.__xssHit = label => window.__xssHits.push(label);
  const payload = label => '<img src=x onerror="window.__xssHit(\'' + label + '\')">';
  const schedule = {};
  for (let day = 0; day < 7; day++) {
    schedule[day] = [{ id: day + 1, time: payload('scheduleTime'), title: payload('scheduleTitle'), sub: payload('scheduleSub') }];
  }
  const scriptTag = '<scr' + 'ipt>window.__xssHit("visualScript")</scr' + 'ipt>';
  const visualHtml = '<div style="color:red;background:url(javascript:alert(1))" onclick="window.__xssHit(\'visualClick\')">Visual</div><img src=x onerror="window.__xssHit(\'visualImg\')">' + scriptTag;
  localStorage.setItem('groqKey', 'gsk_test');
  localStorage.setItem('uSet', JSON.stringify({ name: payload('profileName'), pin: '2007', accent: 'blue' }));
  localStorage.setItem('mem', JSON.stringify([payload('memory')]));
  localStorage.setItem('uCls', JSON.stringify([{ code: '"><img src=x onerror="window.__xssHit(\'classCode\')">', name: payload('className'), time: payload('classTime'), days: payload('classDays') }]));
  localStorage.setItem('todos', JSON.stringify([{ id: 1, text: payload('todo'), p: 'high', done: false }]));
  localStorage.setItem('schedule', JSON.stringify(schedule));
  localStorage.setItem('savedVis', JSON.stringify([{ type: 'mindmap', label: payload('savedLabel'), notes: payload('savedNotes'), html: visualHtml, date: payload('savedDate') }]));
})();
</script>`;

const verifier = String.raw`<script>
(async () => {
  const result = { ok: false, hits: [], active: [], styleIssues: [], errors: [] };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const payload = label => '<img src=x onerror="window.__xssHit(\'' + label + '\')">';
  const containers = ['memChips', 'clsSettings', 'todoList', 'shiftList', 'schSlots', 'calEvents', 'aiMsgs', 'ddBox', 'savedList', 'visBox'];
  try {
    window.fetch = async () => ({ json: async () => ({ choices: [{ message: { content: payload('followAnswer') + '\n\n**ok**' } }] }) });
    goTab('settings', document.querySelector('button[onclick*="settings"]'));
    tick();
    renderTodos();
    renderSch();

    const today = new Date();
    const ymd = today.toISOString().slice(0, 10);
    document.getElementById('evTitle').value = payload('calendarTitle');
    document.getElementById('evTime').value = payload('calendarTime');
    document.getElementById('evDate').value = ymd;
    addCalEv();
    parseICS('BEGIN:VEVENT\nDTSTART:' + ymd.replace(/-/g, '') + 'T090000\nSUMMARY:' + payload('icsSummary') + '\nEND:VEVENT');
    renderShifts();
    renderCal();

    appendMsg('user', payload('chatUser') + '\n\n**bold**');
    appendMsg('assistant', payload('chatAssistant') + '\n\n**bold**');
    document.getElementById('ddBox').innerHTML = formatDD(payload('deepDive') + '\n\n- ' + payload('deepDiveList'));
    document.getElementById('ddFollowIn').value = payload('followQuestion');
    ddContext = 'context';
    await sendDDFollow();

    renderSaved();
    loadVis(0);
    document.getElementById('visBox').innerHTML = safeInlineHTML('<div onclick="window.__xssHit(\'directClick\')" style="background:url(javascript:alert(1));color:red">x</div><img src=x onerror="window.__xssHit(\'directImg\')"><iframe srcdoc="x"></iframe>');
    await wait(800);

    for (const id of containers) {
      const root = document.getElementById(id);
      if (!root) continue;
      root.querySelectorAll('[onerror],[onload],[onclick],[srcdoc],script,iframe,object,embed').forEach(el => {
        const tag = el.tagName.toLowerCase();
        const attrs = Array.from(el.attributes);
        const badEvent = attrs.some(attr => {
          const name = attr.name.toLowerCase();
          const value = attr.value || '';
          return ((name.startsWith('on') || name === 'srcdoc') && (/__xssHit|javascript:/i.test(value) || name === 'onerror' || name === 'onload')) || /javascript:/i.test(value);
        });
        if (badEvent || ['script', 'iframe', 'object', 'embed'].includes(tag)) result.active.push(el.outerHTML.slice(0, 300));
      });
      root.querySelectorAll('[style]').forEach(el => {
        const style = el.getAttribute('style') || '';
        if (/javascript:|expression\s*\(|url\s*\(|@import|-moz-binding|behavior\s*:/i.test(style)) result.styleIssues.push(el.outerHTML.slice(0, 300));
      });
    }
    result.hits = [...window.__xssHits];
  } catch (error) {
    result.errors.push(String(error && error.stack || error));
  }
  result.ok = result.hits.length === 0 && result.active.length === 0 && result.styleIssues.length === 0 && result.errors.length === 0;
  const pre = document.createElement('pre');
  pre.id = 'xssResult';
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
})();
</script>`;

const firstScript = source.indexOf('<script>');
if (firstScript === -1) throw new Error('Could not find dashboard script tag');
const withSeed = source.slice(0, firstScript) + seed + '\n' + source.slice(firstScript);
const bodyClose = withSeed.lastIndexOf('</body>');
if (bodyClose === -1) throw new Error('Could not find closing body tag');
const harnessed = withSeed.slice(0, bodyClose) + verifier + '\n' + withSeed.slice(bodyClose);

const dir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
try {
  const htmlPath = join(dir, 'index.html');
  writeFileSync(htmlPath, harnessed);
  const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
  let output = '';
  try {
    output = execFileSync('timeout', [
      '--kill-after=2s',
      '12s',
      chrome,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--dump-dom',
      `file://${htmlPath}`,
    ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
    if (!output.includes('xssResult')) throw error;
  }
  const match = output.match(/<pre id="xssResult">([\s\S]*?)<\/pre>/);
  if (!match) throw new Error(`XSS verifier did not emit a result. Output tail:\n${output.slice(-2000)}`);
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const result = JSON.parse(decoded);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
