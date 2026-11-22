// מדידת השהיית ההקלדה בחיפוש של ה-CRM מול Supabase מדומה.
//
//   WHICH=props|clients CPU=4 GAP=120 EXPECT=<מספר תוצאות> [PROFILE=1] \
//     node typing_latency.mjs <תיקיית אתר> [agent|manager] [נכסים] [לקוחות]
//
// מריצים פעמיים - על עותק של main ועל הריפו - ומשווים (ראו "מדידה" ב-SKILL.md).
// הפלט: perKeyMs (משך ה-handler של כל הקשה, סינכרוני), syncTotalMs, longTasks
// (משימות מעל 50ms ומשך כולל), settleMs (מההקשה האחרונה עד שהרשימה מציגה את
// מספר התוצאות הסופי, EXPECT) ו-countTxt (שורת הספירה: הוכחה שהסינון באמת רץ).
//
// **שלוש מלכודות שכבר נתפסו כאן, ושלושתן מחזירות מספר סביר ושגוי:**
// 1. ‏fetch מדומה שמחזיר '{}' לכל בקשה שבר את הטעינה העצלה: crm-properties.js לא
//    נטען, ‏myPropertyRows נשאר ריק והמדידה הראתה 0-6ms להקשה. הסקריפט מעביר
//    קבצי .js ל-fetch האמיתי, ויוצא בשגיאה אם rowsTotal ריק.
// 2. ‏GAP=0 (הקשות בלי רווח) אינו הקלדה: נכס אחד נמדד 9-30ms להקשה ב-GAP=0 ו-
//    120-220ms ב-GAP=120 או 250, באותו קוד. מודדים תמיד גם GAP=120 ו-250.
// 3. ‏CPU=1 לא מראה בעיה שמופיעה במכשיר בינוני. ‏CPU=4 הוא הקירוב.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const root = process.argv[2];
const role = process.argv[3] || 'agent';
const DELAY = 20;
const NPROPS = Number(process.argv[4] || 1000);
const NCLIENTS = Number(process.argv[5] || 500);
if (!root) { console.error('usage: WHICH=props|clients CPU=4 GAP=120 EXPECT=<מספר תוצאות> node typing_latency.mjs <site dir> [agent|manager] [props] [clients]'); process.exit(2); }
if (!process.env.EXPECT) { console.error('חסר EXPECT: מספר התוצאות הסופי של השאילתה (בלעדיו settleMs יוצא -1)'); process.exit(2); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 412, height: 900 } });
await pg.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.hostname === 'x.test') return r.fulfill({ path: root + u.pathname }).catch(() => r.fulfill({ status: 404 }));
  return r.fulfill({ status: 200, body: '' });   // CDN, גופנים, אנליטיקס - לא חלק מהשאלה
});
await pg.addInitScript(({ DELAY, role, NPROPS, NCLIENTS }) => {
  window.__calls = 0;
  const manager = role === 'manager';
  const AGENT = {
    id: 'a1', agency_id: 'g1', slug: 't', display_name: 'בדיקה', role: manager ? 'manager' : 'agent',
    tier: 'premium', credit_balance: 100, is_platform_admin: manager, is_mortgage_advisor: false,
    ethics_code_accepted_at: '2026-01-01', ethics_code_version: 99, tier_selected_at: '2026-01-01',
    email: 'a@b.c', phone: '0500000000', license_number: '1', gallery: [], specialties: [],
  };
  const PROPS = [...Array(NPROPS)].map((_, i) => ({ id: 'p' + i, status: 'active', deal_type: i % 3 ? 'sale' : 'rent', price: 1e6 + i * 1000, rooms: 2 + (i % 4), size_sqm: 60 + (i % 50),
    agent_id: 'a1', agency_id: 'g1', created_at: '2026-10-01', features: [], images: [], title: 'דירה ברחוב ' + (['הרצל','ויצמן','העצמאות','הגפן'][i % 4]) + ' ' + i, city: 'עפולה', address: 'רחוב ' + i, neighborhood_id: 'n1', property_type: 'דירה', category: 'residential' }));
  const CLIENTS = [...Array(NCLIENTS)].map((_, i) => ({ id: 'c' + i, full_name: 'לקוח ' + i, status: 'active', created_at: '2026-10-01', client_kind: 'seeker', phone: '05000' + String(i).padStart(5,'0'), cities: ['עפולה'], notes: 'מחפש דירה ' + (i % 5) + ' חדרים' }));
  const user = { id: 'u1', email: 'a@b.c' };
  // שכונה אחת ועיר אחת: ‏ensureNeighborhoodsLoaded בודקת `allNeighborhoods.length`,
  // ורשימה ריקה גרמה לכל קורא לטעון אותה מחדש - סבב מדומה שאינו קיים באתר
  // (‏2.11.2026: ‏loadClients ישבה עליו, והוא נראה כחלק מהשרשרת).
  const HOODS = [{ id: 'n1', city: 'עפולה', name: 'מרכז', city_id: 'c1', is_planned: false, is_industrial: false }];
  const rows = t => t === 'properties' ? PROPS : t === 'agent_clients' ? CLIENTS
    : t === 'agency_members' ? [AGENT] : t === 'agencies' ? [{ id: 'g1', name: 'משרד' }]
    : t === 'neighborhoods' ? HOODS : t === 'market_cities_public' ? [{ city_id: 'c1', market_slug: 'afula' }] : [];
  // בונה שאילתה מדומה: כל שרשור מחזיר אותו, והבקשה "יוצאת" רק ב-then -
  // בדיוק כמו ב-supabase-js, ולכן גם המוקש של שאילתה שלא יצאה נמדד נכון
  function builder(table) {
    let single = false;
    const self = new Proxy(function () {}, {
      get(t, k) {
        if (k === 'then') {
          window.__calls++;
          const all = rows(table);
          const data = single ? (all[0] || null) : all;
          const P = new Promise(res => setTimeout(() => res({ data, error: null, count: 0 }), DELAY));
          return (a, c) => P.then(a, c);
        }
        if (k === 'single' || k === 'maybeSingle') return () => { single = true; return self; };
        if (k === 'catch' || k === 'finally') return f => Promise.resolve()[k](f);
        return () => self;
      },
      apply() { return self; },
    });
    return self;
  }
  const client = {
    from: t => builder(t), rpc: f => builder('rpc:' + f),
    auth: {
      getSession: async () => ({ data: { session: { user, access_token: 'x' } } }),
      getUser: async () => ({ data: { user } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    storage: { from: () => builder('storage') }, functions: { invoke: () => builder('fn') },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
  };
  Object.defineProperty(window, 'supabase', { value: { createClient: () => client }, writable: false });
  const realFetch = window.fetch.bind(window);
  window.fetch = (u, opt) => /\.js(\?|$)/.test(String(u)) ? realFetch(u, opt) : new Promise(res => setTimeout(() =>
    res(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })), DELAY));
}, { DELAY, role, NPROPS, NCLIENTS });

const errs = [];
pg.on('pageerror', e => errs.push(e.message));
const cdp = await pg.context().newCDPSession(pg);
await pg.goto('http://x.test/crm.html');
await pg.evaluate(async () => { await loadDashboard({ id: 'u1', email: 'a@b.c' }); });
await pg.waitForTimeout(1500);
const pre = await pg.evaluate(async () => { try { await crmNeed('properties', { fresh: true }); await loadProperties('a1', { fresh: true }); } catch (e) { return { err: String(e) }; } return { props: myPropertyRows.length, clients: typeof clientRows !== 'undefined' ? clientRows.length : 0 }; });
if (!pre.props || (process.env.WHICH === 'clients' && !pre.clients)) { console.error('הנתונים לא נטענו (myPropertyRows ריק):', JSON.stringify(pre)); await b.close(); process.exit(1); }
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU || 4) });
await pg.evaluate(e => { window.__EXPECT = e.x; window.__GAP = e.g; }, { x: process.env.EXPECT || '', g: Number(process.env.GAP || 0) });
if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
const res = await pg.evaluate(async ({ which }) => {
  const q = which === 'props' ? 'הרצל 12' : 'לקוח 12';
  const id = which === 'props' ? 'propSearch' : 'clientSearch';
  const panel = which === 'props' ? 'accProperties' : 'accClients';
  try { if (typeof showTab === 'function') showTab(panel); } catch (e) {}
  const el = document.getElementById(id);
  if (!el) return { err: 'no input ' + id };
  const long = []; const po = new PerformanceObserver(l => l.getEntries().forEach(e => long.push(e.duration))); try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const per = []; let total = 0;
  const rowsTotal = which === 'props' ? (window.myPropertyRows ? myPropertyRows.length : (typeof myPropertyRows !== 'undefined' ? myPropertyRows.length : -1)) : (typeof clientRows !== 'undefined' ? clientRows.length : -1);
  const n0 = document.querySelectorAll('#' + (which === 'props' ? 'propertiesList' : 'clientsList') + ' > *').length;
  const t0 = performance.now();
  for (const ch of q) {
    el.value += ch;
    const a = performance.now();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const d = performance.now() - a; per.push(Math.round(d)); total += d;
    await new Promise(r => setTimeout(r, window.__GAP || 0));
  }
  // זמן מההקשה האחרונה עד שהרשימה מציגה את התוצאה הסופית
  const tLast = performance.now(); const want = window.__EXPECT; let settle = -1;
  const cid = which === 'props' ? 'propFilterCount' : 'clientFilterCount';
  for (let i = 0; i < 300; i++) {
    const t = (document.getElementById(cid) || {}).textContent || '';
    if (new RegExp('מציג ' + want + ' מתוך').test(t)) { settle = Math.round(performance.now() - tLast); break; }
    await new Promise(r => setTimeout(r, 10));
  }
  await new Promise(r => setTimeout(r, 400));
  const wall = performance.now() - t0;
  po.disconnect();
  const countTxt = (document.getElementById(which === 'props' ? 'propFilterCount' : 'clientFilterCount') || {}).textContent || '';
  return { rowsTotal, countTxt: countTxt.slice(0, 60), settleMs: settle, chars: q.length, perKeyMs: per.join(','), syncTotalMs: Math.round(total), maxKeyMs: Math.max(...per), longTasks: long.length, longTaskMs: Math.round(long.reduce((a, b) => a + b, 0)), wallMs: Math.round(wall) };
}, { which: process.env.WHICH || 'props' });
if (process.env.PROFILE) {
  // פרופיל CPU של ההקלדה (PROFILE=1): מי אוכל את הזמן, לפי זמן עצמי וזמן כולל
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map(); profile.nodes.forEach(n => (n.children || []).forEach(c => parent.set(c, n.id)));
  const label = n => { const c = n.callFrame; return (c.functionName || '(anon)') + ' ' + c.url.replace('http://x.test/', '') + ':' + (c.lineNumber + 1); };
  const self = new Map(), incl = new Map(), dt = profile.timeDeltas;
  profile.samples.forEach((id, k) => {
    const t = dt[k] || 0, l = label(byId.get(id));
    self.set(l, (self.get(l) || 0) + t);
    const seen = new Set(); let cur = id;
    while (cur) { const x = label(byId.get(cur)); if (!seen.has(x)) { seen.add(x); incl.set(x, (incl.get(x) || 0) + t); } cur = parent.get(cur); }
  });
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => (Math.round(v / 100) / 10) + 'ms  ' + k);
  console.log('SELF top:\n' + top(self, 14).join('\n'));
  console.log('INCLUSIVE top:\n' + top(incl, 22).join('\n'));
}
console.log(JSON.stringify({ role, n: { props: NPROPS, clients: NCLIENTS }, cpu: Number(process.env.CPU || 4), which: process.env.WHICH || 'props', ...res, pageErrors: errs.slice(0, 3) }));
await b.close();
