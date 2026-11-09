import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import bridge from '../www/native-bridge.js';

function fakeWin(stored) {
  const store = stored == null ? {} : { [bridge.PIXEL_CONSENT_KEY]: stored };
  const inserted = [];
  const first = { parentNode: { insertBefore: (tag) => inserted.push(tag) } };
  return {
    store,
    inserted,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: {
      createElement: (tag) => ({ tagName: tag.toUpperCase() }),
      getElementsByTagName: () => [first],
    },
    dispatchEvent() {},
    CustomEvent: function CustomEvent() {},
  };
}

// קטע הפיקסל כפי שהוא ב-GTM (gtm/container.json), בלי ה-noscript.
function gtmPixelSnippet() {
  const container = JSON.parse(fs.readFileSync(new URL('../../gtm/container.json', import.meta.url), 'utf8'));
  const tags = (container.containerVersion || container).tag || [];
  const pixel = tags.find((t) => /meta pixel/i.test(t.name));
  const html = pixel.parameter.find((p) => p.key === 'html').value;
  return html.split('<script>')[1].split('</script>')[0];
}

function runSnippet(win) {
  const loaded = [];
  const doc = {
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (t) => loaded.push(t.src) } }],
  };
  const box = { window: win, document: doc, fbq: (...args) => win.fbq(...args) };
  vm.createContext(box);
  vm.runInContext(gtmPixelSnippet(), box);
  return loaded;
}

test('the GTM pixel snippet still bails out when fbq exists', () => {
  assert.match(gtmPixelSnippet(), /if\s*\(\s*f\.fbq\s*\)\s*return/);
});

test('before consent the pixel script is not loaded and calls are queued', () => {
  const win = fakeWin(null);
  assert.equal(bridge.installPixelGate(win), true);
  const loaded = runSnippet(win);
  assert.deepEqual(loaded, []);
  assert.equal(win.fbq.queue.length, 2);
  assert.equal(win.fbq.queue[0][0], 'init');
});

test('allow loads fbevents.js once and remembers the answer', () => {
  const win = fakeWin(null);
  bridge.installPixelGate(win);
  runSnippet(win);
  bridge.settlePixelGate(win, true);
  bridge.settlePixelGate(win, true);
  assert.equal(win.inserted.length, 1);
  assert.equal(win.inserted[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.equal(win.store[bridge.PIXEL_CONSENT_KEY], '1');
});

test('deny drops the queue and never loads the pixel', () => {
  const win = fakeWin(null);
  bridge.installPixelGate(win);
  runSnippet(win);
  bridge.publishTracking(win, false);
  assert.equal(win.fbq.queue.length, 0);
  assert.equal(win.inserted.length, 0);
  assert.equal(win.store[bridge.PIXEL_CONSENT_KEY], '0');
});

test('a remembered allow leaves the pixel to GTM, a remembered deny keeps it blocked', () => {
  const yes = fakeWin('1');
  assert.equal(bridge.installPixelGate(yes), false);
  assert.equal(yes.fbq, undefined);
  const no = fakeWin('0');
  assert.equal(bridge.installPixelGate(no), true);
  assert.deepEqual(runSnippet(no), []);
});
