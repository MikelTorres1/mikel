import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url);
const sourcePath = new URL('index.html', root);
const workDir = mkdtempSync(join(tmpdir(), 'mikel-xss-'));
const pagePath = join(workDir, 'index.html');
const profileDir = join(workDir, 'chrome-profile');

const scriptTag = (id, code) => `<scr` + `ipt id="${id}">\n${code}\n</scr` + `ipt>`;
const payload = (label) => `<img src=x onerror="window.__xss('${label}')">`;

const prelude = String.raw`
window.__xssHits = [];
window.__xss = label => window.__xssHits.push(label);
localStorage.setItem('groqKey','gsk_test');
localStorage.setItem('uSet', JSON.stringify({name:${JSON.stringify(payload('name'))}, pin:'2007', accent:'blue'}));
localStorage.setItem('mem', JSON.stringify([${JSON.stringify(payload('mem'))}]));
localStorage.setItem('uCls', JSON.stringify([{code:'"><img src=x onerror="window.__xss(\'class-code\')">',name:${JSON.stringify(payload('class-name'))},time:'8:00 AM',days:'Tue/Thu'}]));
localStorage.setItem('todos', JSON.stringify([{id:"1);window.__xss('todo-id');//",text:${JSON.stringify(payload('todo-text'))},p:'high',done:false}]));
localStorage.setItem('schedule', JSON.stringify({[new Date().getDay()]:[{id:"1);window.__xss('schedule-id');//",time:'9:00',title:${JSON.stringify(payload('schedule-title'))},sub:${JSON.stringify(payload('schedule-sub'))}}]}));
localStorage.setItem('savedVis', JSON.stringify([{
  type:'summary',
  label:${JSON.stringify(payload('saved-label'))},
  notes:${JSON.stringify(payload('saved-notes'))},
  html:'<div onclick="window.__xss(\\'saved-click\\')" style="background:url(javascript:window.__xss(\\'saved-style\\'));color:red"><img src=x onerror="window.__xss(\\'saved-img\\')"><strong>Saved visual</strong><script>window.__xss(\\'saved-script\\')</'+'script></div>',
  date:${JSON.stringify(payload('saved-date'))}
}]));
window.fetch = async (url) => {
  const u = String(url);
  if (u.includes('finance')) {
    return {json: async () => ({quoteResponse:{result:[{symbol:"BAD');window.__xss('market');//",regularMarketChangePercent:1.23,regularMarketPrice:42,regularMarketChange:0.5}]}})};
  }
  return {json: async () => ({choices:[{message:{content:'<div onclick="window.__xss(\\'ai-click\\')" style="background:url(javascript:window.__xss(\\'ai-style\\'));color:red"><img src=x onerror="window.__xss(\\'ai-img\\')"><strong>AI safe text</strong><script>window.__xss(\\'ai-script\\')</'+'script></div>'}}]})};
};
`;

const verifier = String.raw`
(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const activeAttrs = (rootNode) => Array.from(rootNode.querySelectorAll('*')).flatMap(el =>
    Array.from(el.attributes || [])
      .filter(attr => (/^on/i.test(attr.name) || /javascript:/i.test(attr.value)) && /__xss|javascript:/i.test(attr.value))
      .map(attr => `${el.tagName.toLowerCase()}[${attr.name}=${attr.value}]`)
  );
  const resultEl = document.createElement('pre');
  resultEl.id = '__xss_result';
  resultEl.style.display = 'none';
  document.body.appendChild(resultEl);
  const finish = result => {
    resultEl.textContent = JSON.stringify(result);
    document.body.setAttribute('data-xss-ok', String(result.ok));
  };
  try {
    await wait(50);
    initSettings();
    tick();
    renderTodos();
    renderSch();
    renderCal();
    parseICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:<img src=x onerror="window.__xss(\\'ics\\')">\nDTSTART:20990101T090000\nDTEND:20990101T100000\nEND:VEVENT\nEND:VCALENDAR');
    renderCal();
    appendMsg('user', '<img src=x onerror="window.__xss(\\'chat-user\\')"> **bold**');
    appendMsg('assistant', '<img src=x onerror="window.__xss(\\'chat-ai\\')"> **bold**');
    document.getElementById('ddBox').innerHTML = formatDD('**Header**\n\n- <img src=x onerror="window.__xss(\\'deep-dive\\')">');
    ddContext = 'context';
    document.getElementById('ddFollowIn').value = '<img src=x onerror="window.__xss(\\'follow-question\\')">';
    await sendDDFollow();
    loadVis(0);
    document.getElementById('studyIn').value = 'topic';
    await genVis();
    let printed = '';
    const oldOpen = window.open;
    window.open = () => ({document:{write: s => { printed += s; }, close(){}}, print(){}});
    document.getElementById('visLbl').textContent = '<img src=x onerror="window.__xss(\\'print-label\\')">';
    document.getElementById('visBox').innerHTML = safeInlineHTML('<div onclick="window.__xss(\\'print-click\\')"><img src=x onerror="window.__xss(\\'print-img\\')"><strong>Printable</strong></div>');
    printVis();
    window.open = oldOpen;
    const printedDoc = document.implementation.createHTMLDocument('');
    printedDoc.documentElement.innerHTML = printed;
    await wait(250);
    const active = activeAttrs(document).filter(item => !item.includes('__xss_result'));
    const printedActive = activeAttrs(printedDoc);
    const injectedScripts = Array.from(document.scripts)
      .filter(script => !['__xss_prelude','__xss_verifier'].includes(script.id))
      .filter(script => /__xss/.test(script.textContent))
      .map(script => script.textContent.slice(0, 80));
    const printedScripts = Array.from(printedDoc.scripts)
      .filter(script => /__xss/.test(script.textContent))
      .map(script => script.textContent.slice(0, 80));
    const issues = [...active, ...printedActive.map(item => `print:${item}`), ...injectedScripts.map(item => `script:${item}`), ...printedScripts.map(item => `print-script:${item}`)];
    finish({ok: window.__xssHits.length === 0 && issues.length === 0, hits: window.__xssHits, issues});
  } catch (error) {
    finish({ok:false, error:String(error && error.stack || error), hits:window.__xssHits || []});
  }
})();
`;

let html = readFileSync(sourcePath, 'utf8');
html = html.replace('<script>', scriptTag('__xss_prelude', prelude) + '\n<script>');
const bodyClose = html.lastIndexOf('</body>');
html = `${html.slice(0, bodyClose)}${scriptTag('__xss_verifier', verifier)}${html.slice(bodyClose)}`;
writeFileSync(pagePath, html);

const chrome = '/usr/local/bin/google-chrome';
const args = [
  '--kill-after=2s',
  '12s',
  chrome,
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--user-data-dir=${profileDir}`,
  '--virtual-time-budget=5000',
  '--run-all-compositor-stages-before-draw',
  '--dump-dom',
  pathToFileURL(pagePath).href,
];
const run = spawnSync('timeout', args, {encoding:'utf8', maxBuffer: 10 * 1024 * 1024});
const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const match = output.match(/<pre id="__xss_result"[^>]*>([^<]*)<\/pre>/);
if (!match) {
  console.error(output);
  throw new Error(`Could not find XSS harness result (status ${run.status})`);
}
const unescapeHTML = (value) => value
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const result = JSON.parse(unescapeHTML(match[1]));
console.log(JSON.stringify(result));
if (!result.ok) {
  process.exitCode = 1;
}
