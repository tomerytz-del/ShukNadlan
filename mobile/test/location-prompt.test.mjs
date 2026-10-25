import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import bridge from '../www/native-bridge.js';

const marketsSrc = fs.readFileSync(new URL('../../assets/markets.js', import.meta.url), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(marketsSrc, sandbox);
const markets = sandbox.ShukMarkets;

const plist = fs.readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
const privacy = fs.readFileSync(new URL('../../privacy.html', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

test('a live market is remembered and a point outside one is not', () => {
  const afula = bridge.pickLiveMarket(markets, 32.6078, 35.2897);
  assert.equal(afula && afula.slug, 'afula-emek');
  assert.equal(afula.live, true);

  // נוף הגליל אינו חי, והשוק החי הקרוב בטווח הוא עפולה.
  const near = bridge.pickLiveMarket(markets, 32.71, 35.33);
  assert.equal(near && near.slug, 'afula-emek');

  assert.equal(bridge.pickLiveMarket(markets, 32.805, 35.0), null);
  assert.equal(bridge.pickLiveMarket(markets, 32.0853, 34.7818), null);
  assert.equal(bridge.pickLiveMarket(null, 32.6, 35.3), null);
});

test('only a different market page is opened', () => {
  const afula = markets.bySlug('afula-emek');
  assert.equal(bridge.marketPathToOpen(markets, '/', afula), null);
  assert.equal(bridge.marketPathToOpen(markets, '/property', afula), null);
  const haifa = Object.assign({}, markets.bySlug('haifa'), { live: true });
  assert.equal(bridge.marketPathToOpen(markets, '/', haifa), '/haifa');
  assert.equal(bridge.marketPathToOpen(markets, '/haifa', haifa), null);
  assert.equal(bridge.marketPathToOpen(markets, '/', markets.bySlug('haifa')), null);
});

test('the screen shows once, and not on the privacy page', () => {
  assert.equal(bridge.shouldAutoShowLocation({ site: true, seen: false, path: '/' }), true);
  assert.equal(bridge.shouldAutoShowLocation({ site: true, seen: true, path: '/' }), false);
  assert.equal(bridge.shouldAutoShowLocation({ site: false, seen: false, path: '/' }), false);
  assert.equal(bridge.shouldAutoShowLocation({ site: true, seen: false, path: '/privacy' }), false);
});

test('the system prompt is approximate and only after the button', () => {
  assert.equal(bridge.LOC_GEO.enableHighAccuracy, false);
  assert.equal(bridge.LOC_COPY.allow, 'הפעלה');
  assert.equal(bridge.LOC_COPY.skip, 'אולי אחר כך');
  assert.match(bridge.LOC_COPY.more, /איך אתם משתמשים במיקום שלי/);
  assert.equal(bridge.LOC_COPY.privacyHref, 'https://shuknadlan.co.il/privacy');
  assert.equal(
    bridge.LOC_COPY.body,
    'נשתמש במיקום משוער רק כדי להציג את השוק המקומי ונכסים קרובים. המיקום לא נשמר בשרתים שלנו, ואפשר לשנות את האזור בכל רגע.',
  );
  assert.equal(bridge.LOC_COPY.body.includes('למשל'), false);
  assert.equal(bridge.LOC_COPY.moreBody.includes('למשל'), false);
  const text = JSON.stringify(bridge.LOC_COPY);
  assert.equal(text.includes('\u2014'), false);
  assert.equal(text.includes('\u2013'), false);
});

test('reopen looks for the region button, not every click', () => {
  const button = { nodeType: 1, classList: { contains: (name) => name === 'mkt-locate' }, parentNode: null };
  const child = { nodeType: 1, classList: { contains: () => false }, parentNode: button };
  assert.equal(bridge.isLocateControl(child), true);
  assert.equal(bridge.isLocateControl({ nodeType: 1, classList: { contains: () => false }, parentNode: null }), false);
});

test('iOS asks for approximate when-in-use location, and Android stays coarse', () => {
  assert.match(plist, /NSLocationDefaultAccuracyReduced/);
  assert.match(plist, /המיקום המשוער משמש במכשיר רק כדי לבחור את האזור/);
  assert.doesNotMatch(plist, /NSLocationAlwaysUsageDescription/);
  assert.match(manifest, /ACCESS_COARSE_LOCATION/);
  assert.doesNotMatch(manifest, /ACCESS_FINE_LOCATION/);
});

function fakeDocument() {
  function make(tag) {
    const node = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      style: {},
      children: [],
      hidden: false,
      disabled: false,
      textContent: '',
      attributes: {},
      parentNode: null,
      classList: { contains: () => false },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key]; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
      },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      listeners: {},
      click() { if (this.listeners.click) this.listeners.click(); },
      focus() {},
    };
    return node;
  }
  const body = make('body');
  const doc = {
    body,
    documentElement: body,
    readyState: 'complete',
    listeners: [],
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    createElement: make,
    createElementNS: (_ns, tag) => make(tag),
    getElementById(id) {
      const stack = [body];
      while (stack.length) {
        const node = stack.pop();
        if (node.id === id) return node;
        stack.push(...(node.children || []));
      }
      return null;
    },
    querySelectorAll() { return []; },
  };
  return doc;
}

test('skip never asks for location, and the screen stays dismissed', () => {
  const doc = fakeDocument();
  const store = {};
  const geo = [];
  const win = {
    document: doc,
    location: { hostname: 'shuknadlan.co.il', pathname: '/', href: 'https://shuknadlan.co.il/', protocol: 'https:' },
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
    },
    navigator: { geolocation: { getCurrentPosition: (_ok, _err, options) => { geo.push(options); } } },
    setTimeout(fn) { return fn(); },
  };
  bridge.install(win);
  const overlay = doc.getElementById('shukLocPrompt');
  assert.ok(overlay);
  const buttons = [];
  (function walk(node) {
    if (node.tagName === 'BUTTON') buttons.push(node);
    (node.children || []).forEach(walk);
  })(overlay);
  const allow = buttons.find((button) => button.textContent === 'הפעלה');
  const skip = buttons.find((button) => button.textContent === 'אולי אחר כך');
  assert.ok(allow);
  assert.ok(skip);
  skip.click();
  assert.equal(geo.length, 0);
  assert.equal(store.shuk_loc_onboard, '1');
  assert.equal(doc.getElementById('shukLocPrompt'), null);

  allowFromReopen(doc, win);
  const again = doc.getElementById('shukLocPrompt');
  assert.ok(again);
  const allow2 = [];
  (function walk(node) {
    if (node.tagName === 'BUTTON' && node.textContent === 'הפעלה') allow2.push(node);
    (node.children || []).forEach(walk);
  })(again);
  allow2[0].click();
  assert.equal(geo.length, 1);
  assert.equal(geo[0].enableHighAccuracy, false);
});

function allowFromReopen(doc, win) {
  const hooks = doc.listeners.filter((item) => item.type === 'click');
  const hook = hooks[hooks.length - 1];
  const button = { nodeType: 1, classList: { contains: (name) => name === 'mkt-locate' }, parentNode: null };
  hook.fn({
    target: button,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });
  assert.equal(typeof win.ShukNadlanApp.openLocationPrompt, 'function');
}

test('a browser without the bridge is unchanged', () => {
  assert.equal(typeof bridge.install, 'function');
  assert.equal(bridge.shouldAutoShowLocation({ site: false, seen: false, path: '/' }), false);
});

test('the location title is forced white and http failures have their own sentence', () => {
  const bridgeSrc = fs.readFileSync(new URL('../www/native-bridge.js', import.meta.url), 'utf8');
  const offline = fs.readFileSync(new URL('../www/offline.html', import.meta.url), 'utf8');
  const android = fs.readFileSync(new URL('../android/app/src/main/java/il/co/shuknadlan/app/ShellWebViewClient.java', import.meta.url), 'utf8');
  assert.match(bridgeSrc, /#shukLocPrompt h1\{color:#fff !important;-webkit-text-fill-color:#fff !important\}/);
  assert.match(bridgeSrc, /shuk-loc-allow/);
  assert.match(offline, /האתר לא נטען כרגע/);
  assert.match(offline, /slice\(-17\)/);
  assert.match(offline, /פנייה לתמיכה/);
  assert.match(offline, /https:\/\/wa\.me\/972546929991/);
  assert.doesNotMatch(offline, /מדיניות הפרטיות/);
  assert.match(android, /onReceivedHttpError/);
  assert.equal(offline.includes('\u2014'), false);
});

test('the privacy page says the point is used on the device and not stored', () => {
  assert.match(privacy, /מיקום משוער נשאל באפליקציה רק אחרי לחיצה על "הפעלה"/);
  assert.match(privacy, /אינו נשלח לשרת ואינו/);
  assert.match(privacy, /אתרו את האזור שלי/);
  const added = privacy.slice(privacy.indexOf('מיקום משוער נשאל'), privacy.indexOf('מיקום משוער נשאל') + 900);
  assert.equal(added.includes('\u2014'), false);
  assert.equal(added.includes('\u2013'), false);
});
