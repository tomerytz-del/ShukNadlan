/**
 * ?src=link על דף הבית: דפדפן פנימי בלי referrer שומר את הסינון.
 *
 * הקטע רץ מתוך assets/home.js מול location מזויף. בלי דפדפן ובלי רשת.
 *
 *     node scripts/home_src_link_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'home.js'),
  'utf8',
);
const start = SRC.indexOf('  let viaLink = false;');
const endMark = '  initSentenceDock();\n';
const end = SRC.indexOf(endMark, start);
if (start < 0 || end < 0) throw new Error('הקטע של הסינון מהכתובת לא נמצא');
const slice = SRC.slice(start, end + endMark.length);

function run(opts){
  let href = opts.href;
  const store = new Map(Object.entries(opts.storage || {}));
  const applied = [];
  const sandbox = {
    URL,
    URLSearchParams,
    Date,
    JSON,
    decodeURIComponent,
    isReload: () => !!opts.reload,
    landingSearchType: () => opts.landingType || '',
    document: { referrer: opts.referrer || '' },
    history: {
      state: { kept: 1 },
      replaceState(state, _title, url){
        sandbox.history.state = state;
        href = new URL(url, href).href;
      },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      removeItem: (k) => store.delete(k),
    },
    sentence: {
      setFromParams(params){ applied.push(params.toString()); },
    },
  };
  Object.defineProperty(sandbox, 'location', {
    value: {
      get href(){ return href; },
      get origin(){ return new URL(href).origin; },
      get pathname(){ return new URL(href).pathname; },
      get search(){ return new URL(href).search; },
    },
  });
  const code = `
    const params = new URLSearchParams(location.search);
    const known = ['deal', 'ptype', 'type', 'rooms', 'minPrice', 'maxPrice', 'q', 'hoods', 'city', 'ai'];
    const landing = ${opts.landing ? 'true' : 'false'};
    const QUICK_NAV_KEY = 'sk_qs_nav';
    let quickNavArrived = false;
    let deepLinkParams = null;
    let sentenceDeepLink = false;
    let searchHasRun = false;
    function initSentenceDock(){}
    ${slice}
    ({ sentenceDeepLink, searchHasRun, quickNavArrived, href: location.href, viaLink });
  `;
  const out = runInNewContext(code, sandbox);
  return { ...out, applied, href };
}

const HOME = 'https://shuknadlan.co.il/?deal=sale&rooms=4&src=link';

test('in-app browser with src=link keeps the filters and drops the marker', () => {
  const r = run({ href: HOME, referrer: '' });
  assert.equal(r.sentenceDeepLink, true);
  assert.equal(r.viaLink, true);
  assert.equal(r.applied.length, 1);
  assert.match(r.applied[0], /deal=sale/);
  assert.match(r.applied[0], /rooms=4/);
  const url = new URL(r.href);
  assert.equal(url.searchParams.get('src'), null);
  assert.equal(url.searchParams.get('deal'), 'sale');
  assert.equal(url.searchParams.get('rooms'), '4');
});

test('a reload still opens clean', () => {
  const r = run({ href: HOME, referrer: '', reload: true });
  assert.equal(r.sentenceDeepLink, false);
  assert.equal(r.applied.length, 0);
  const url = new URL(r.href);
  assert.equal(url.searchParams.get('deal'), null);
  assert.equal(url.searchParams.get('rooms'), null);
});

test('the address after the marker was removed opens clean when restored', () => {
  const first = run({ href: HOME, referrer: '' });
  const restored = run({ href: first.href, referrer: '' });
  assert.equal(restored.sentenceDeepLink, false);
  assert.equal(new URL(restored.href).searchParams.get('deal'), null);
});

test('no referrer and no marker drops filters', () => {
  const r = run({ href: 'https://shuknadlan.co.il/?deal=sale&rooms=4', referrer: '' });
  assert.equal(r.sentenceDeepLink, false);
  assert.equal(new URL(r.href).searchParams.get('deal'), null);
});

test('another src value is not the distributed-link marker', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=sale&src=home_views',
    referrer: '',
  });
  assert.equal(r.viaLink, false);
  assert.equal(r.sentenceDeepLink, false);
  assert.equal(SRC.includes("if (src) q.set('src', src)"), true);
});

test('an external referrer still counts without the marker', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=sale',
    referrer: 'https://l.facebook.com/',
  });
  assert.equal(r.viaLink, true);
  assert.equal(r.sentenceDeepLink, true);
});

test('the homepage as referrer does not count as a link', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=sale',
    referrer: 'https://shuknadlan.co.il/',
  });
  assert.equal(r.viaLink, false);
  assert.equal(r.sentenceDeepLink, false);
});

test('a property page referrer still counts', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=rent&rooms=3',
    referrer: 'https://shuknadlan.co.il/property?id=1',
  });
  assert.equal(r.viaLink, true);
  assert.equal(r.sentenceDeepLink, true);
});

test('a fresh quick-nav mark still counts', () => {
  const href = 'https://shuknadlan.co.il/?deal=sale&rooms=4';
  const r = run({
    href,
    referrer: '',
    storage: {
      sk_qs_nav: JSON.stringify({ href: '/?deal=sale&rooms=4', t: Date.now() }),
    },
  });
  assert.equal(r.viaLink, true);
  assert.equal(r.sentenceDeepLink, true);
  assert.equal(r.quickNavArrived, true);
});
