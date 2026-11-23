/**
 * סינון מדף הבית לפי הכתובת (initSentenceSearch).
 *
 * טעינה ראשונה עם פרמטרי חיפוש מחילה אותם, גם בלי referrer ובלי ?src=link.
 * רענון מנקה. עמוד חיפוש פופולרי (landing) עדיין מוסיף את סוג הנכס שלו.
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
    const landing = !isReload() && ${opts.landing ? 'true' : 'false'};
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

test('a direct open after the marker was removed still applies the filters', () => {
  const first = run({ href: HOME, referrer: '' });
  const again = run({ href: first.href, referrer: '' });
  assert.equal(again.sentenceDeepLink, true);
  assert.equal(again.viaLink, false);
  assert.equal(new URL(again.href).searchParams.get('deal'), 'sale');
  assert.equal(new URL(again.href).searchParams.get('src'), null);
});

test('a direct load with maxPrice=3800 applies the filter', () => {
  const href = 'https://shuknadlan.co.il/?city=' + encodeURIComponent('עפולה')
    + '&minPrice=2000&maxPrice=3800&rooms=3&type=apt';
  const r = run({ href, referrer: '' });
  assert.equal(r.viaLink, false);
  assert.equal(r.sentenceDeepLink, true);
  assert.equal(r.searchHasRun, true);
  assert.equal(r.applied.length, 1);
  const applied = new URLSearchParams(r.applied[0]);
  assert.equal(applied.get('maxPrice'), '3800');
  assert.equal(applied.get('minPrice'), '2000');
  assert.equal(applied.get('rooms'), '3');
  assert.equal(applied.get('type'), 'apt');
  assert.equal(applied.get('city'), 'עפולה');
  const url = new URL(r.href);
  assert.equal(url.searchParams.get('maxPrice'), '3800');
  assert.equal(url.searchParams.get('city'), 'עפולה');
});

test('a reload of a shared search link clears the filters', () => {
  const href = 'https://shuknadlan.co.il/?city=' + encodeURIComponent('עפולה') + '&maxPrice=3800';
  const r = run({ href, referrer: '', reload: true });
  assert.equal(r.sentenceDeepLink, false);
  assert.equal(r.applied.length, 0);
  const url = new URL(r.href);
  assert.equal(url.searchParams.get('maxPrice'), null);
  assert.equal(url.searchParams.get('city'), null);
});

test('another src value is not the distributed-link marker', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=sale&src=home_views',
    referrer: '',
  });
  assert.equal(r.viaLink, false);
  assert.equal(r.sentenceDeepLink, true);
  assert.equal(new URL(r.href).searchParams.get('src'), 'home_views');
  assert.equal(new URL(r.href).searchParams.get('deal'), 'sale');
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

test('the homepage as referrer does not count as a link, and the search params still apply', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=sale',
    referrer: 'https://shuknadlan.co.il/',
  });
  assert.equal(r.viaLink, false);
  assert.equal(r.sentenceDeepLink, true);
  assert.match(r.applied[0], /deal=sale/);
});

test('a property page referrer still counts', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=rent&rooms=3',
    referrer: 'https://shuknadlan.co.il/property?id=1',
  });
  assert.equal(r.viaLink, true);
  assert.equal(r.sentenceDeepLink, true);
});

test('an SEO landing page still injects its type and keeps the address', () => {
  const href = 'https://shuknadlan.co.il/?deal=sale&rooms=4';
  const r = run({ href, referrer: '', landing: true, landingType: 'flats' });
  assert.equal(r.sentenceDeepLink, true);
  const applied = new URLSearchParams(r.applied[0]);
  assert.equal(applied.get('deal'), 'sale');
  assert.equal(applied.get('rooms'), '4');
  assert.equal(applied.get('type'), 'flats');
  const url = new URL(r.href);
  assert.equal(url.searchParams.get('deal'), 'sale');
  assert.equal(url.searchParams.get('rooms'), '4');
  assert.equal(url.searchParams.get('type'), null);
});

test('an SEO landing page that already names a type does not override it', () => {
  const href = 'https://shuknadlan.co.il/?deal=sale&ptype=' + encodeURIComponent('דירת גן');
  const r = run({ href, referrer: '', landing: true, landingType: 'flats' });
  const applied = new URLSearchParams(r.applied[0]);
  assert.equal(applied.has('type'), false);
  assert.equal(applied.get('ptype'), 'דירת גן');
  assert.equal(new URL(r.href).searchParams.get('ptype'), 'דירת גן');
});

test('a reload of an SEO landing page still opens clean', () => {
  const r = run({
    href: 'https://shuknadlan.co.il/?deal=sale&rooms=4',
    referrer: 'https://www.google.com/',
    reload: true,
    landing: true,
    landingType: 'flats',
  });
  assert.equal(r.viaLink, false);
  assert.equal(r.sentenceDeepLink, false);
  assert.equal(r.applied.length, 0);
  const url = new URL(r.href);
  assert.equal(url.searchParams.get('deal'), null);
  assert.equal(url.searchParams.get('rooms'), null);
});

test('an arbitrary maxPrice is not added to the closed SEARCH_PAGES list', () => {
  const pages = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'netlify', 'edge-functions', 'search-pages.ts'),
    'utf8',
  );
  const start = pages.indexOf('export const SEARCH_PAGES');
  const end = pages.indexOf('/* ---------- עזרים', start);
  assert.ok(start > 0 && end > start);
  const list = pages.slice(start, end);
  assert.equal(list.includes('3800'), false);
  assert.match(list, /deal=sale&maxPrice=1500000/);
  assert.match(list, /deal=rent&maxPrice=4000/);
  assert.equal(pages.includes('canonical'), true);
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
