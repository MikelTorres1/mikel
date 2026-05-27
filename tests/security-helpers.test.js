const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// The inline dashboard script should remain syntactically valid.
new Function(script);

const escSource = script.slice(
  script.indexOf('function esc'),
  script.indexOf('function sanitizeHtml')
);
const esc = new Function(`${escSource}; return esc;`)();

assert.strictEqual(
  esc(`<img src=x onerror="steal()"> & 'key'`),
  '&lt;img src=x onerror=&quot;steal()&quot;&gt; &amp; &#39;key&#39;'
);

assert(script.includes('function sanitizeHtml(html)'), 'missing HTML sanitizer');
assert(script.includes('${esc(s.summary)}'), 'shift summaries must be escaped');
assert(script.includes('${esc(e.title)}'), 'calendar event titles must be escaped');
assert(script.includes('const safe=sanitizeHtml(html)'), 'AI visual HTML must be sanitized before rendering');
assert(script.includes('let html=esc(text)'), 'chat messages must escape model/user text before markdown formatting');
assert(!script.includes('${s.summary}</div>'), 'raw shift summary rendering regressed');
assert(!script.includes('${t.text}</span>'), 'raw todo text rendering regressed');

console.log('security helper checks passed');
