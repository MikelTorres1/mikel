const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function extractFunction(name) {
  const start = script.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `missing ${name}`);
  const bodyStart = script.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < script.length; i++) {
    if (script[i] === '{') depth++;
    if (script[i] === '}') depth--;
    if (depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    dump() {
      return { ...store };
    },
  };
}

function runSnippet(storage, source) {
  vm.runInNewContext(
    [
      extractFunction('readJSON'),
      extractFunction('migrateStorageKey'),
      extractFunction('loadSavedVis'),
      source,
    ].join('\n'),
    { localStorage: storage }
  );
}

{
  const storage = makeStorage({ anthropic_api_key: 'gsk_legacy' });
  runSnippet(storage, "const groqKey=migrateStorageKey('groqKey','anthropic_api_key');");
  assert.strictEqual(storage.dump().groqKey, 'gsk_legacy');
}

{
  const legacy = [{ type: 'mindmap', label: 'Old visual', notes: 'legacy', date: '2026-05-24', html: '<div>old</div>' }];
  const current = [{ type: 'summary', label: 'New visual', notes: 'current', date: '2026-05-25', html: '<div>new</div>' }];
  const storage = makeStorage({
    savedVisuals: JSON.stringify(legacy),
    savedVis: JSON.stringify(current),
  });

  runSnippet(storage, 'const savedVis=loadSavedVis();');

  const migrated = JSON.parse(storage.dump().savedVis);
  assert.deepStrictEqual(
    migrated.map((v) => v.label),
    ['New visual', 'Old visual']
  );
}

console.log('storage migration tests passed');
