/**
 * העוזרים המשותפים ב-assets/crm.js: כותרות וקריאה ל-Edge Function, שמירת
 * לקוח אחת עם גיבויי סכימה, ובורר נכס פעיל.
 *
 * הקוד נקרא מהקובץ ורץ על גלובלים מדומים - בלי דפדפן ובלי רשת. כל קטע נמצא
 * לפי סימן; אם הוא זז, הבדיקה נכשלת בקול ולא עוברת על כלום.
 *
 *     node scripts/crm_edge_helpers_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const src = readFileSync(join(root, 'crm.js'), 'utf8');

function grab(re, name) {
  const m = src.match(re);
  if (!m) throw new Error(name + ' לא נמצא ב-crm.js');
  return m[0];
}
const edgeHeadersSrc = grab(/function edgeHeaders\(session\)\{[\s\S]*?\n\}/, 'edgeHeaders');
const edgeCallSrc = grab(/async function edgeCall\(url, payload\)\{[\s\S]*?\n\}/, 'edgeCall');
const pickerSrc = grab(/function bindActivePropertyPicker\([\s\S]*?\n\}\n/, 'bindActivePropertyPicker');
const wrapperSrc = {
  callJoinAgency: grab(/function callJoinAgency\(payload\)\{[^\n]*\}/, 'callJoinAgency'),
  callCloseAccount: grab(/function callCloseAccount\(payload\)\{[^\n]*\}/, 'callCloseAccount'),
  callLicenseAppealApi: grab(/function callLicenseAppealApi\(payload\)\{[^\n]*\}/, 'callLicenseAppealApi'),
};
const windowSrc = grab(/function clientTabsWindow\(rows, expanded, shown, chunk\)\{[\s\S]*?\n\}/, 'clientTabsWindow');
const persistStart = src.indexOf('  let error, savedId = editingClientId;\n  // אותה שמירה');
const persistEnd = src.indexOf('  btn.disabled = false; btn.textContent = original;\n\n  if (error){');
if (persistStart < 0 || persistEnd < persistStart) throw new Error('בלוק השמירה של agent_clients לא נמצא ב-crm.js');
const persistSrc = src.slice(persistStart, persistEnd);

/* ---------- edgeHeaders / edgeCall ---------- */
function edgeEnv({ session = { access_token: 'T' }, response } = {}) {
  const seen = [];
  const ctx = {
    SUPABASE_ANON_KEY: 'anon-key',
    session,
    response: response || { ok: true, json: async () => ({ a: 1 }) },
    seen,
  };
  const make = new Function('ctx', `
    const SUPABASE_ANON_KEY = ctx.SUPABASE_ANON_KEY;
    const sb = { auth: { getSession: async () => ({ data: { session: ctx.session } }) } };
    const fetch = async (url, opts) => { ctx.seen.push([url, opts]); return ctx.response; };
    ${edgeHeadersSrc}
    ${edgeCallSrc}
    return { edgeHeaders, edgeCall };
  `);
  return { ...make(ctx), seen };
}

test('edgeHeaders: שלוש הכותרות, עם הטוקן של הסשן', () => {
  const { edgeHeaders } = edgeEnv();
  assert.deepEqual(edgeHeaders({ access_token: 'abc' }), {
    'Content-Type': 'application/json',
    apikey: 'anon-key',
    Authorization: 'Bearer abc',
  });
});

test('edgeCall: POST עם כותרות, גוף JSON ו-ok כשהכול תקין', async () => {
  const { edgeCall, seen } = edgeEnv();
  const r = await edgeCall('https://x/fn', { p: 1 });
  assert.deepEqual(r, { ok: true, data: { a: 1 } });
  assert.equal(seen[0][0], 'https://x/fn');
  assert.equal(seen[0][1].method, 'POST');
  assert.equal(seen[0][1].headers.Authorization, 'Bearer T');
  assert.equal(seen[0][1].body, JSON.stringify({ p: 1 }));
});

test('edgeCall: בלי סשן מחזיר no_session ולא קורא לרשת', async () => {
  const { edgeCall, seen } = edgeEnv({ session: null });
  assert.deepEqual(await edgeCall('https://x/fn', {}), { ok: false, data: { error: 'no_session' } });
  assert.equal(seen.length, 0);
});

test('edgeCall: גוף ריק לא זורק, ו-res.ok מכריע', async () => {
  const bad = { ok: true, json: async () => { throw new Error('empty'); } };
  assert.deepEqual(await edgeEnv({ response: bad }).edgeCall('u', {}), { ok: true, data: {} });
  const notOk = { ok: false, json: async () => { throw new Error('empty'); } };
  assert.deepEqual(await edgeEnv({ response: notOk }).edgeCall('u', {}), { ok: false, data: {} });
});

test('edgeCall: שדה error בתשובה הופך ל-ok:false גם כש-HTTP תקין', async () => {
  const r = await edgeEnv({ response: { ok: true, json: async () => ({ error: 'bad' }) } }).edgeCall('u', {});
  assert.deepEqual(r, { ok: false, data: { error: 'bad' } });
});

test('שלוש העטיפות מאצילות ל-edgeCall עם הכתובת שלהן', () => {
  const calls = [];
  const make = new Function('calls', `
    const SUPABASE_URL = 'https://proj.supabase.co';
    const LICENSE_APPEAL_URL = 'https://proj.supabase.co/functions/v1/broker-license-appeal';
    const edgeCall = (url, payload) => { calls.push([url, payload]); return 'p'; };
    ${Object.values(wrapperSrc).join('\n')}
    return { callJoinAgency, callCloseAccount, callLicenseAppealApi };
  `);
  const w = make(calls);
  assert.equal(w.callJoinAgency({ a: 1 }), 'p');
  w.callCloseAccount({ b: 2 });
  w.callLicenseAppealApi({ c: 3 });
  assert.deepEqual(calls, [
    ['https://proj.supabase.co/functions/v1/join-agency', { a: 1 }],
    ['https://proj.supabase.co/functions/v1/close-account', { b: 2 }],
    ['https://proj.supabase.co/functions/v1/broker-license-appeal', { c: 3 }],
  ]);
});

/* ---------- שמירת לקוח: persist וגיבויי הסכימה ---------- */
async function runSave(editing, errors) {
  const log = [];
  const queue = errors.slice();
  const ctx = { editing, queue, log };
  const make = new Function('ctx', `
    let editingClientId = ctx.editing;
    const currentAgent = { id: 'A', agency_id: 'G' };
    const payload = { share_level: 'x', neighborhood_id: 'n', min_air_directions: 2 };
    const airLivingColumnMissing = e => !!e && /air/.test(e.message || '');
    const shareLevelSchemaMissing = e => !!e && /share_level/.test(e.message || '');
    const clientNeighborhoodColumnMissing = e => !!e && /hood/.test(e.message || '');
    const stripAirLiving = p => { delete p.min_air_directions; };
    const sb = { from: () => ({
      update: p => ({ eq: async () => { ctx.log.push(['update', Object.keys(p).join(',')]); return { error: ctx.queue.shift() || null }; } }),
      insert: p => ({ select: () => ({ single: async () => {
        ctx.log.push(['insert', Object.keys(p).join(',')]);
        const e = ctx.queue.shift() || null;
        return { data: e ? null : { id: 'NEW' }, error: e };
      } }) }),
    }) };
    return (async () => {
${persistSrc}
      return { error, savedId, neighborhoodDeferred };
    })();
  `);
  return { ...(await make(ctx)), log };
}

test('לקוח חדש: הוספה אחת, עם agent_id ו-agency_id', async () => {
  const r = await runSave(null, []);
  assert.equal(r.error, null);
  assert.equal(r.savedId, 'NEW');
  assert.equal(r.neighborhoodDeferred, false);
  assert.deepEqual(r.log, [['insert', 'share_level,neighborhood_id,min_air_directions,agent_id,agency_id']]);
});

test('עריכה: update בלבד, ו-savedId נשאר המזהה הקיים', async () => {
  const r = await runSave('E1', []);
  assert.equal(r.savedId, 'E1');
  assert.deepEqual(r.log.map(l => l[0]), ['update']);
});

test('גיבויי הסכימה בסדר: אוויר, רמת שיתוף, שכונה - בעריכה', async () => {
  const r = await runSave('E1', [{ message: 'air' }, { message: 'share_level' }, { message: 'hood' }]);
  assert.equal(r.error, null);
  assert.equal(r.neighborhoodDeferred, true);
  assert.deepEqual(r.log, [
    ['update', 'share_level,neighborhood_id,min_air_directions'],
    ['update', 'share_level,neighborhood_id'],
    ['update', 'neighborhood_id'],
    ['update', ''],
  ]);
});

test('גיבויי הסכימה בהוספה: אותו סדר, ו-savedId מהניסיון האחרון', async () => {
  const r = await runSave(null, [{ message: 'air' }, { message: 'share_level' }, { message: 'hood' }]);
  assert.equal(r.savedId, 'NEW');
  assert.equal(r.neighborhoodDeferred, true);
  assert.deepEqual(r.log.map(l => l[1]), [
    'share_level,neighborhood_id,min_air_directions,agent_id,agency_id',
    'share_level,neighborhood_id,agent_id,agency_id',
    'neighborhood_id,agent_id,agency_id',
    'agent_id,agency_id',
  ]);
});

test('שגיאה שאינה של סכימה עוצרת בלי ניסיון נוסף ונשארת בתוצאה', async () => {
  const r = await runSave(null, [{ message: 'other' }]);
  assert.deepEqual(r.error, { message: 'other' });
  assert.equal(r.log.length, 1);
  assert.equal(r.neighborhoodDeferred, false);
});

/* ---------- בורר נכס פעיל ---------- */
function mkEl(tag, cls, text) {
  return {
    tag, cls, textContent: text || '', children: [], listeners: {}, hidden: false, value: '', type: '',
    appendChild(c) { this.children.push(c); },
    addEventListener(t, f) { this.listeners[t] = f; },
    set innerHTML(v) { this.children = []; },
    get innerHTML() { return ''; },
  };
}
function pickerEnv(rows, delay = 0) {
  const box = { rows, delay, queries: 0 };
  const make = new Function('box', 'admEl', `
    const dashPanelsMeasure = () => {};
    const sb = { from: () => ({ select: () => ({ eq: () => ({ or: () => ({ limit: async () => {
      box.queries++;
      await new Promise(r => setTimeout(r, box.delay));
      return { data: box.rows };
    } }) }) }) }) };
    ${pickerSrc}
    return bindActivePropertyPicker;
  `);
  return { bind: make(box, mkEl), box };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROW = [{ id: '1', title: 'דירה', city: 'עפולה' }];

test('בורר: שאילתה קצרה מ-2 תווים מסתירה את הרשימה ולא פונה למסד', async () => {
  const { bind, box } = pickerEnv(ROW);
  const input = mkEl('input'), list = mkEl('ul');
  bind(input, list, { onPick() {} });
  input.value = 'ד';
  input.listeners.input();
  await wait(300);
  assert.equal(list.hidden, true);
  assert.equal(box.queries, 0);
});

test('בורר: תוצאות, בחירה, ו-onPick מקבל את הנכס והתווית', async () => {
  const { bind } = pickerEnv(ROW);
  const input = mkEl('input'), list = mkEl('ul');
  const picked = [];
  bind(input, list, { onPick: (p, label) => picked.push([p.id, label]) });
  input.value = 'דירה';
  input.listeners.input();
  await wait(300);
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 1);
  list.children[0].children[0].listeners.click();
  assert.deepEqual(picked, [['1', 'דירה · עפולה']]);
  assert.equal(input.value, 'דירה · עפולה');
  assert.equal(list.hidden, true);
});

test('בורר: emptyNote מוצגת רק כשהוגדרה ואין תוצאות', async () => {
  for (const [emptyNote, expected] of [['אין', 1], [undefined, 0]]) {
    const { bind } = pickerEnv([]);
    const input = mkEl('input'), list = mkEl('ul');
    bind(input, list, { onPick() {}, emptyNote });
    input.value = 'xx';
    input.listeners.input();
    await wait(300);
    assert.equal(list.children.length, expected);
    assert.equal(list.hidden, false);
  }
});

test('בורר: onInput נקראת בכל הקלדה', () => {
  const { bind } = pickerEnv(ROW);
  const input = mkEl('input'), list = mkEl('ul');
  let n = 0;
  bind(input, list, { onInput: () => { n++; }, onPick() {} });
  input.value = 'a'; input.listeners.input();
  input.value = 'ab'; input.listeners.input();
  assert.equal(n, 2);
});

test('בורר: תשובה מאוחרת אחרי מחיקת התיבה נזרקת', async () => {
  const { bind } = pickerEnv(ROW, 200);
  const input = mkEl('input'), list = mkEl('ul');
  bind(input, list, { onPick() {} });
  input.value = 'דירה';
  input.listeners.input();
  await wait(300);              // השאילתה יצאה והתשובה בדרך
  input.value = '';
  input.listeners.input();      // המשתמש מוחק
  await wait(300);
  assert.equal(list.hidden, true);
  assert.equal(list.children.length, 0);
});

/* ---------- רשימת הלקוחות במנות ---------- */
const clientTabsWindow = new Function(windowSrc + '\nreturn clientTabsWindow;')();
const mkRows = n => Array.from({ length: n }, (_, i) => ({ id: 'c' + i }));

test('clientTabsWindow: מנה ראשונה, ולא יותר משורות הרשימה', () => {
  assert.equal(clientTabsWindow(mkRows(500), new Set(), 0, 20), 20);
  assert.equal(clientTabsWindow(mkRows(7), new Set(), 0, 20), 7);
  assert.equal(clientTabsWindow([], new Set(), 0, 20), 0);
});

test('clientTabsWindow: מה שכבר הוצג נשמר גם כשאין פתוחים', () => {
  assert.equal(clientTabsWindow(mkRows(500), new Set(), 60, 20), 60);
  assert.equal(clientTabsWindow(mkRows(50), new Set(), 60, 20), 50);
});

test('clientTabsWindow: טאב פתוח שמחוץ למנה מרחיב עד אליו (קישור עמוק)', () => {
  const rows = mkRows(500);
  assert.equal(clientTabsWindow(rows, new Set(['c400']), 0, 20), 401);
  assert.equal(clientTabsWindow(rows, new Set(['c5']), 0, 20), 20);              // בתוך המנה: בלי שינוי
  assert.equal(clientTabsWindow(rows, new Set(['c30', 'c250', 'c90']), 0, 20), 251); // הרחוק מכולם
  assert.equal(clientTabsWindow(rows, new Set(['not-in-list']), 0, 20), 20);     // מזהה שכבר לא ברשימה
});

test('renderClients בונה את הרשימה דרך clientTabsWindow, ושינוי סינון חוזר למנה הראשונה', () => {
  const rc = grab(/function renderClients\(\)\{[\s\S]*?\n\}\n/, 'renderClients');
  assert.match(rc, /clientTabsWindow\(filtered, expandedClientIds, clientTabsShown/);
  assert.doesNotMatch(rc, /filtered\.forEach\(c => tabsWrap\.appendChild\(buildClientTab/, 'חזרה לבנייה של כל הלקוחות');
  const top = grab(/function renderClientsFromTop\(\)\{[\s\S]*?\n\}/, 'renderClientsFromTop');
  assert.match(top, /clientTabsShown = 0/);
  // כל מי שמשנה את הרשימה (חיפוש, סינון, מיון, ניקוי) חוזר דרכה
  assert.match(src, /setTimeout\(renderClientsFromTop, CLIENT_SEARCH_DEBOUNCE_MS\)/);
  assert.match(src, /'clientSort'\]\s*\n\s*\.forEach\(id => document\.getElementById\(id\)\.addEventListener\('change', renderClientsFromTop\)\)/);
});
