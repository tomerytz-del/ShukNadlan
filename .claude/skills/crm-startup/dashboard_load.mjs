// מדידת loadDashboard() של ה-CRM מול Supabase מדומה עם השהיה לכל בקשה.
//
//   node dashboard_load.mjs <תיקיית אתר> [agent|manager] [השהיה ב-ms]
//
// מריצים פעמיים - פעם על עותק של main ופעם על הריפו - ומשווים:
//   mkdir -p /tmp/crm-main && git archive origin/main | tar -x -C /tmp/crm-main
//   node dashboard_load.mjs /tmp/crm-main agent
//   node dashboard_load.mjs "$(git rev-parse --show-toplevel)" agent
//
// הפלט: ms (משך loadDashboard), calls (בקשות שיצאו עד סופה), nav (כמה
// בניות של refreshNavCounts ובכמה ms), kpi (מונה הנכסים הפעילים - סימן
// שהדשבורד באמת נבנה), ושגיאות דף. ‏calls שקפץ אחרי שינוי = טעינה כפולה.
//
// **למה השהיה ולא רשת אמיתית:** זמן הכניסה ל-CRM נשלט בסבבים לשרת ולא
// במהירות המכשיר. השהיה קבועה לכל בקשה מראה בדיוק כמה סבבים יש בטור -
// 25 סבבים של 150ms הם 3.75 שניות בכל מכשיר. זו השוואה יחסית בין גרסאות,
// לא מספר של "כמה זה לוקח באתר החי".
//
// **הנתונים המדומים חייבים לכלול נכסים ולקוחות.** בלי נכסים loadProperties
// יוצאת מוקדם (ענף "אין נכסים"), וכל מה שאחרי רשימת הנכסים פשוט לא נמדד -
// כך נראה פעם שיפור של 75% שבחצי ממנו הקוד ששונה לא רץ בכלל.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const root = process.argv[2];
const role = process.argv[3] || 'agent';
const DELAY = Number(process.argv[4] || 150);
if (!root) { console.error('usage: node dashboard_load.mjs <site dir> [agent|manager] [delay ms]'); process.exit(2); }

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 412, height: 900 } });
await pg.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.hostname === 'x.test') return r.fulfill({ path: root + u.pathname }).catch(() => r.fulfill({ status: 404 }));
  return r.fulfill({ status: 200, body: '' });   // CDN, גופנים, אנליטיקס - לא חלק מהשאלה
});
await pg.addInitScript(({ DELAY, role }) => {
  window.__calls = 0;
  const manager = role === 'manager';
  const AGENT = {
    id: 'a1', agency_id: 'g1', slug: 't', display_name: 'בדיקה', role: manager ? 'manager' : 'agent',
    tier: 'premium', credit_balance: 100, is_platform_admin: manager, is_mortgage_advisor: false,
    ethics_code_accepted_at: '2026-01-01', ethics_code_version: 99, tier_selected_at: '2026-01-01',
    email: 'a@b.c', phone: '0500000000', license_number: '1', gallery: [], specialties: [],
  };
  const PROPS = [...Array(20)].map((_, i) => ({ id: 'p' + i, status: 'active', deal_type: 'sale', price: 1e6,
    agent_id: 'a1', created_at: '2026-10-01', features: [], images: [], title: 'נכס ' + i, city: 'עפולה' }));
  const CLIENTS = [...Array(10)].map((_, i) => ({ id: 'c' + i, full_name: 'לקוח ' + i, status: 'active', created_at: '2026-10-01' }));
  const user = { id: 'u1', email: 'a@b.c' };
  const rows = t => t === 'properties' ? PROPS : t === 'agent_clients' ? CLIENTS
    : t === 'agency_members' ? [AGENT] : t === 'agencies' ? [{ id: 'g1', name: 'משרד' }] : [];
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
  window.fetch = () => new Promise(res => setTimeout(() =>
    res(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })), DELAY));
}, { DELAY, role });

const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://x.test/crm.html');
const r = await pg.evaluate(async () => {
  let navCalls = 0, navMs = 0;
  const orig = window.refreshNavCounts;
  window.refreshNavCounts = function () {
    const a = performance.now();
    try { return orig.apply(this, arguments); } finally { navCalls++; navMs += performance.now() - a; }
  };
  const t0 = performance.now(); let err = null;
  try { await loadDashboard({ id: 'u1', email: 'a@b.c' }); } catch (e) { err = String(e); }
  return { ms: Math.round(performance.now() - t0), calls: window.__calls, nav: navCalls + ' / ' + Math.round(navMs) + 'ms',
           kpi: document.querySelector('#kpiActiveValue')?.textContent, err };
});
console.log(JSON.stringify({ role, delay: DELAY, ...r, pageErrors: errs.slice(0, 5) }));
await b.close();
