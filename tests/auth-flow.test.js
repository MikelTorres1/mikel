const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) throw new Error('Could not find inline script');

const script = scriptMatch[1];
new Function(script);

const elements = new Map();
class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(value) {
    this.values.add(value);
  }
  remove(value) {
    this.values.delete(value);
  }
  contains(value) {
    return this.values.has(value);
  }
}

function getElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      style: {},
      classList: new FakeClassList(),
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener() {},
      focus() {
        this.focused = true;
      },
      remove() {
        this.removed = true;
      },
      scrollIntoView() {},
    });
  }
  return elements.get(id);
}

const store = {
  groqKey: 'gsk_test',
  uSet: JSON.stringify({ name: 'Mikel', pin: '2007', accent: 'blue' }),
};

global.localStorage = {
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  },
  setItem(key, value) {
    store[key] = String(value);
  },
  removeItem(key) {
    delete store[key];
  },
};

global.document = {
  documentElement: { style: { setProperty() {} } },
  body: getElement('body'),
  getElementById: getElement,
  querySelectorAll: () => [],
  createElement: () => getElement(`created-${Math.random()}`),
};
global.window = { navigator: { standalone: true }, open() {}, _curVis: null };
global.navigator = { userAgent: 'node' };
global.fetch = async () => {
  throw new Error('network disabled for test');
};
global.setInterval = () => 0;
global.setTimeout = (fn) => {
  fn();
  return 0;
};

const app = new Function(`${script}\nreturn {tryProtected,dashUnlock,saveProfile,initSettings};`)();

const settingsButton = getElement('settingsButton');
app.tryProtected('settings', settingsButton);

if (getElement('lockTitle').textContent !== 'Settings') {
  throw new Error('Settings should show the protected lock prompt');
}
if (getElement('page-settings').classList.contains('on')) {
  throw new Error('Settings opened before the PIN was entered');
}

getElement('dashPw').value = '2007';
app.dashUnlock();
if (!getElement('page-settings').classList.contains('on')) {
  throw new Error('Settings did not open after the correct PIN');
}

app.initSettings();
if (getElement('sPin').value !== '') {
  throw new Error('Existing PIN should not be prefilled in Settings');
}

getElement('sName').value = 'Mikel';
getElement('sPin').value = '';
app.saveProfile();
let savedSettings = JSON.parse(store.uSet);
if (savedSettings.pin !== '2007') {
  throw new Error('Blank PIN save should preserve the existing PIN');
}

getElement('sPin').value = '12ab';
app.saveProfile();
savedSettings = JSON.parse(store.uSet);
if (savedSettings.pin !== '2007') {
  throw new Error('Invalid PIN should not be saved');
}

getElement('sPin').value = '1234';
app.saveProfile();
savedSettings = JSON.parse(store.uSet);
if (savedSettings.pin !== '1234') {
  throw new Error('Valid PIN update was not saved');
}

console.log('auth flow regression test passed');
