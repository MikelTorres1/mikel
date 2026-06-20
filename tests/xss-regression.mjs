import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(repoRoot, 'index.html');
const source = readFileSync(indexPath, 'utf8');

const payload = label => `<img src=x onerror="__xss('${label}')">`;
const attrPayload = label => `" autofocus onfocus="__xss('${label}')" value="`;
const visualPayload = `<div style="color:red;background-image:url(javascript:__xss('vis-style'))" onclick="__xss('vis-click')"><img src=x onerror="__xss('vis-img')"><script>__xss('vis-script')</script><span>Visual text</span></div>`;

const seed = {
  groqKey: 'gsk_test_key',
  uSet: JSON.stringify({ name: payload('profile'), pin: '2007', accent: 'blue' }),
  mem: JSON.stringify([payload('memory')]),
  uCls: JSON.stringify([{ code: attrPayload('class-code'), name: attrPayload('class-name'), time: payload('class-time'), days: payload('class-days') }]),
  todos: JSON.stringify([{ id: 1, text: payload('todo'), p: 'high', done: false }]),
  schedule: JSON.stringify({ [new Date().getDay()]: [{ id: 2, time: payload('schedule-time'), title: payload('schedule-title'), sub: payload('schedule-sub') }] }),
  savedVis: JSON.stringify([{ type: 'mindmap', label: payload('saved-label'), notes: payload('saved-notes'), date: payload('saved-date'), html: visualPayload }])
};

const safeForScript = value => JSON.stringify(value).replace(/</g, '\\u003c');
const scriptTag = code => '<scr' + 'ipt>' + code + '</scr' + 'ipt>';

const seedScript = scriptTag(`
window.__xssHits = [];
window.__xss = label => window.__xssHits.push(label);
localStorage.clear();
const seed = ${safeForScript(seed)};
Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
const xssPayload = ${safeForScript(payload('ai-network'))};
const ddPayload = ${safeForScript(payload('deep-dive'))};
const followPayload = ${safeForScript(payload('deep-follow'))};
const visualPayload = ${safeForScript(visualPayload)};
window.open = () => ({ document: { write() {}, close() {} } });
window.fetch = async (url, opts = {}) => {
  if (!opts.body) {
    return { json: async () => ({ quoteResponse: { result: [{ symbol: "BAD' onmouseover='__xss(\\\\'market\\\\')", regularMarketPrice: 1, regularMarketChangePercent: 2, regularMarketChange: 3 }] } }) };
  }
  const body = JSON.parse(opts.body);
  const serialized = JSON.stringify(body.messages || []);
  let content = '**Reply**\\n\\n' + xssPayload;
  if (body.max_tokens === 2500 || serialized.includes('Create a visual')) content = visualPayload;
  if (body.max_tokens === 2000) content = '**Deep**\\n\\n' + ddPayload;
  if (body.max_tokens === 1000 && serialized.includes('Follow-up question')) content = '**Follow**\\n\\n' + followPayload;
  return { json: async () => ({ choices: [{ message: { content } }] }) };
};
`);

const exerciseScript = scriptTag(`
(async () => {
  const errors = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    tick();
    initSettings();
    renderTodos();
    renderSch();
    const icsSummary = ${safeForScript(payload('ics'))};
    parseICS('BEGIN:VCALENDAR\\nBEGIN:VEVENT\\nSUMMARY:' + icsSummary + '\\nDTSTART:' + ymd + 'T090000\\nDTEND:' + ymd + 'T100000\\nEND:VEVENT\\nEND:VCALENDAR');
    calToday();
    document.getElementById('evTitle').value = ${safeForScript(payload('calendar-title'))};
    document.getElementById('evDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('evTime').value = ${safeForScript(payload('calendar-time'))};
    addCalEv();
    appendMsg('user', ${safeForScript(payload('chat-user'))});
    appendMsg('assistant', '**Assistant**\\n\\n' + ${safeForScript(payload('chat-assistant'))});
    document.getElementById('aiIn').value = 'hello';
    await sendAI();
    document.getElementById('studyIn').value = 'notes';
    await genVis();
    renderSaved();
    loadVis(0);
    document.getElementById('ddIn').value = 'topic';
    await runDD();
    document.getElementById('ddFollowIn').value = ${safeForScript(payload('follow-question'))};
    await sendDDFollow();
    await loadMarkets();
    await wait(500);
  } catch (error) {
    errors.push(error && error.stack ? error.stack : String(error));
  }
  const scopes = ['greet', 'memChips', 'clsSettings', 'todoList', 'shiftList', 'schSlots', 'calEvents', 'aiMsgs', 'visBox', 'savedList', 'ddBox', 'mktGrid'];
  const dangerous = [];
  for (const id of scopes) {
    const root = document.getElementById(id);
    if (!root) continue;
    root.querySelectorAll('script,iframe,object,embed,svg,math,img,[onerror],[onload],[onfocus],[autofocus]').forEach(node => {
      dangerous.push(id + ':' + node.outerHTML.slice(0, 160));
    });
    root.querySelectorAll('[style]').forEach(node => {
      const style = node.getAttribute('style') || '';
      if (/javascript:|expression\\s*\\(|url\\s*\\(/i.test(style)) dangerous.push(id + ':style:' + style.slice(0, 160));
    });
  }
  const result = { ok: window.__xssHits.length === 0 && dangerous.length === 0 && errors.length === 0, hits: window.__xssHits, dangerous, errors };
  const pre = document.createElement('pre');
  pre.id = 'xss-result';
  pre.textContent = JSON.stringify(result);
  document.body.appendChild(pre);
})();
`);

const appScriptStart = source.indexOf('<script>\n// SETTINGS & MEMORY');
if (appScriptStart === -1) throw new Error('Could not locate app script');
const bodyEnd = source.lastIndexOf('</body>');
if (bodyEnd === -1) throw new Error('Could not locate closing body tag');
const html = source.slice(0, appScriptStart) + seedScript + source.slice(appScriptStart, bodyEnd) + exerciseScript + source.slice(bodyEnd);

const tmpRoot = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const htmlPath = join(tmpRoot, 'xss.html');
const userDataDir = join(tmpRoot, 'chrome-profile');
writeFileSync(htmlPath, html);

try {
  const chrome = process.env.CHROME || '/usr/local/bin/google-chrome';
  const run = spawnSync('timeout', ['--kill-after=2s', '20s', chrome, '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, '--virtual-time-budget=8000', '--dump-dom', htmlPath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  const output = run.stdout || '';
  const match = output.match(/<pre id="xss-result">([^<]*)<\/pre>/);
  if (!match) {
    console.error(output);
    console.error(run.stderr);
    throw new Error(`Chrome did not emit xss-result (status ${run.status})`);
  }
  const result = JSON.parse(match[1]);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
