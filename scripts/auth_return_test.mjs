/**
 * יעד קישור ששורד כניסת Google.
 *
 * auth-return.js רץ בדפדפן. כאן הוא נטען מול window מזויף: אותה שמירה
 * ל-sessionStorage, אותה החזרה לכתובת, ואותה פסילה של נתיב שיוצא מהאתר.
 *
 *     node scripts/auth_return_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'auth-return.js'),
  'utf8',
);

function boot(startHref){
  let href = startHref;
  const store = new Map();
  const replaced = [];
  const history = {
    state: { exitGuard: 1 },
    replaceState(state, _title, url){
      history.state = state;
      href = new URL(url, href).href;
    },
  };
  const location = {
    get pathname(){ return new URL(href).pathname; },
    get search(){ return new URL(href).search; },
    get hash(){ return new URL(href).hash; },
    replace(next){
      href = new URL(next, href).href;
      replaced.push(href);
    },
  };
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const document = { currentScript: { hasAttribute(){ return false; } } };
  const window = {
    URLSearchParams,
    location,
    history,
    sessionStorage,
    document,
  };
  window.window = window;
  const context = createContext(window);
  runInContext(SRC, context, { filename: 'assets/auth-return.js' });
  return {
    auth: window.AuthReturn,
    store,
    replaced,
    history,
    href: () => href,
    params: () => new URL(href).searchParams,
  };
}

const LEAD = '11111111-1111-4111-8111-111111111111';

test('remember שומר את יעד הקישור, לא את תשובת Google', () => {
  const page = boot(
    'https://shuknadlan.co.il/crm?goto=accLeads&tab=demand&lead=' + LEAD
    + '&wc=a1b2c3d4e5f6&wt=new_lead&code=secret&evil=1&access_token=nope',
  );
  page.auth.remember();
  const saved = page.store.get('shuknadlan.auth_return_query');
  assert.equal(page.store.get('shuknadlan.auth_return'), '/crm');
  assert.match(saved, /goto=accLeads/);
  assert.match(saved, /tab=demand/);
  assert.match(saved, new RegExp('lead=' + LEAD));
  assert.match(saved, /wc=a1b2c3d4e5f6/);
  assert.match(saved, /wt=new_lead/);
  assert.doesNotMatch(saved, /code=/);
  assert.doesNotMatch(saved, /evil=/);
  assert.doesNotMatch(saved, /access_token/);
});

test('חזרה מדף הבית מעבירה את היעד יחד עם code, בלי לפתוח אתר אחר', () => {
  const page = boot('https://shuknadlan.co.il/crm?goto=accProperties&property=' + LEAD + '&status=active');
  page.auth.remember();
  page.store.set('shuknadlan.auth_return', '//evil.example');
  const landed = boot('https://shuknadlan.co.il/?code=oauth-code#kept');
  landed.store.set('shuknadlan.auth_return', page.store.get('shuknadlan.auth_return'));
  landed.store.set('shuknadlan.auth_return_query', page.store.get('shuknadlan.auth_return_query'));
  // הנתיב שנשמר נפסל כי הוא אינו לוכסן יחיד, והיעד נשאר /crm
  assert.equal(landed.auth.catchLanding(), true);
  assert.equal(landed.replaced.length, 1);
  const url = new URL(landed.replaced[0]);
  assert.equal(url.origin, 'https://shuknadlan.co.il');
  assert.equal(url.pathname, '/crm');
  assert.equal(url.searchParams.get('code'), 'oauth-code');
  assert.equal(url.searchParams.get('goto'), 'accProperties');
  assert.equal(url.searchParams.get('property'), LEAD);
  assert.equal(url.searchParams.get('status'), 'active');
  assert.equal(url.hash, '#kept');
});

test('חזרה ישר ל-CRM מחזירה את היעד בלי למחוק code ובלי לגעת בזקיף', () => {
  const page = boot('https://shuknadlan.co.il/crm?goto=accLeads&tab=demand&lead=' + LEAD);
  page.auth.remember();
  const back = boot('https://shuknadlan.co.il/crm?code=from-google');
  back.store.set('shuknadlan.auth_return', '/crm');
  back.store.set('shuknadlan.auth_return_query', page.store.get('shuknadlan.auth_return_query'));
  assert.equal(back.auth.restoreQuery(), true);
  assert.equal(back.params().get('code'), 'from-google');
  assert.equal(back.params().get('goto'), 'accLeads');
  assert.equal(back.params().get('tab'), 'demand');
  assert.equal(back.params().get('lead'), LEAD);
  assert.equal(back.history.state.exitGuard, 1);
  assert.equal(back.store.get('shuknadlan.auth_return_query'), undefined);
  // פעם שנייה אין מה להחזיר
  assert.equal(back.auth.restoreQuery(), false);
});

test('יעד שכבר בכתובת לא נדרס, וכניסה בלי יעד מוחקת שמירה ישנה', () => {
  const page = boot('https://shuknadlan.co.il/crm?goto=accClients&client=' + LEAD);
  page.auth.remember();
  const back = boot('https://shuknadlan.co.il/crm.html?goto=accProperties&code=1');
  back.store.set('shuknadlan.auth_return', '/crm');
  back.store.set('shuknadlan.auth_return_query', page.store.get('shuknadlan.auth_return_query'));
  assert.equal(back.auth.restoreQuery(), true);
  assert.equal(back.params().get('goto'), 'accProperties');
  assert.equal(back.params().get('client'), LEAD);
  const clean = boot('https://shuknadlan.co.il/crm');
  clean.store.set('shuknadlan.auth_return_query', 'goto=accLeads');
  clean.auth.remember();
  assert.equal(clean.store.get('shuknadlan.auth_return_query'), undefined);
});

test('ערך שהוא כתובת או סקריפט לא נשמר', () => {
  const page = boot('https://shuknadlan.co.il/crm?goto=javascript:alert(1)&tab=%2F%2Fevil.example&lead=' + LEAD);
  page.auth.remember();
  const saved = page.store.get('shuknadlan.auth_return_query') || '';
  assert.doesNotMatch(saved, /javascript/i);
  assert.doesNotMatch(saved, /evil/);
  assert.match(saved, new RegExp('lead=' + LEAD));
});
