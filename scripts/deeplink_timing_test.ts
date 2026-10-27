// מדידת לחיצה: RPC, RLS, שמירה, וסקריפט קטן. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/deeplink_timing_test.ts

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { clickRecords, isSafeCrmPath, screenBundle, withClick } from "../supabase/functions/_shared/agent-deep-link.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const sql = readFileSync(
  new URL("../supabase/migrations/20271028200000_deeplink_timings.sql", import.meta.url),
  "utf8",
);
const js = readFileSync(new URL("../assets/deeplink-timing.js", import.meta.url), "utf8");
const crm = readFileSync(new URL("../assets/crm.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../crm.html", import.meta.url), "utf8");
const push = readFileSync(
  new URL("../supabase/functions/notification-push/index.ts", import.meta.url),
  "utf8",
);

const fnStart = sql.indexOf("function public.dl_add");
const fnEnd = sql.indexOf("comment on function public.dl_add");
const fn = sql.slice(fnStart, fnEnd);

check("הסקריפט מתחת לקילובייט", js.length < 1024, js.length);
check("רץ רק כשיש wc", js.includes('q.get("wc")') && js.includes("DEEPLINK_TIMING"));
check("שליחה עם keepalive על ה-fetch של supabase, וחזרה מיד", js.includes("sb.rest") && js.includes("keepalive:1") && js.includes("finally{c.fetch=f}"));
check("נטישה ב-pagehide וב-visibilitychange", js.includes('addEventListener("pagehide"') && js.includes('addEventListener("visibilitychange"'));
check("בלי user agent גולמי", !js.includes("p_ua:u") && js.includes('"w"') && js.includes('"i"') && js.includes('"c"'));
check("ה-CRM מסמן כניסה, ניתוב ויעד", ["dlMark('login')", "dlMark('auth')", "dlMark('route')", "dlMark('visible')", "dlMark('error')"].every((s) => crm.includes(s)));
const timingSrc = html.indexOf('src="assets/deeplink-timing.js"');
const crmSrc = html.indexOf('src="assets/crm.js"');
check("המדידה לפני crm.js", timingSrc > 0 && timingSrc < crmSrc);
const seenAt = crm.indexOf("var dlSeen = function");
const seen = crm.slice(seenAt, seenAt + 700);
check("יעד שאינו קטגוריה נמדד לפי האלמנט שנפתח", seenAt > 0 && ["createSheet", "coachSheet", "agrModal", "waShareModal", "licenseHoldCard", "bellPanel", "dashPanelOps"].every((id) => seen.includes(id)));
check("הדוח מקובץ לפי יעד", sql.includes("t.target") && sql.includes("group by 1, 2, 3"));
check("wc יורד מהכתובת אחרי הקריאה", crm.includes("'wc', 'wt'") || crm.includes("'wc', 'wt'".replace("'", "'")));

check("טבלה בלי קריאה ל-anon ול-authenticated", sql.includes("enable row level security")
  && sql.includes("revoke all on table public.deeplink_timings from public, anon, authenticated")
  && sql.includes("grant select, insert, update, delete on table public.deeplink_timings to service_role"));
check("אין policy של select לאנונימי", !/create policy[\s\S]{0,200}deeplink_timings[\s\S]{0,80}for select to anon/.test(sql));
check("ה-RPC קובע agent_id בעצמו", fn.includes("public.current_agent_id()") && !fn.includes("p_agent"));
check("הרשאת כתיבה לאנונימי ולמחובר, בלי public", sql.includes("revoke all on function public.dl_add(jsonb) from public, anon, authenticated")
  && sql.includes("grant execute on function public.dl_add(jsonb) to anon, authenticated"));
check("תקרת קצב", fn.includes("v_n >= 60") && fn.includes("v_n >= 120"));
check("שורה אחת ל-wc, ושדרוג עד reached", fn.includes("on conflict (wc) do update") && fn.includes("outcome = 'reached'"));
check("ארבע תוצאות", ["reached", "login_wall", "error", "abandoned"].every((o) => sql.includes(`'${o}'`)));
check("הדגל דולק כברירת מחדל", sql.includes("('deeplink_timing_enabled', 1,"));
check("היומן שומר את ה-wc", sql.includes("click_tokens jsonb") && push.includes("click_tokens"));
check("עמודה חסרה לא מוחקת את wa_message_id", push.includes("PGRST204") && push.includes("42703"));
check("תצוגה: p50 p90 נטישה ומסך כניסה", sql.includes("percentile_cont(0.5)") && sql.includes("percentile_cont(0.9)")
  && sql.includes("abandoned_pct") && sql.includes("login_wall_pct") && sql.includes("tap_pct"));
check("התצוגה סגורה, והדוח רק למנהל/ת", sql.includes("revoke all on table public.deeplink_timing_daily from public, anon, authenticated")
  && sql.includes("grant select on table public.deeplink_timing_daily to service_role")
  && sql.includes("current_is_platform_admin()")
  && sql.includes("revoke all on function public.deeplink_timing_report() from public, anon, authenticated")
  && sql.includes("grant execute on function public.deeplink_timing_report() to authenticated"));
check("90 יום בתוך data_retention_run", sql.includes("interval '90 days'")
  && sql.includes("delete from public.deeplink_timings")
  && sql.includes("elsif s.policy = 'deeplink_timings'"));
check("הניקוי הקודם נשמר", sql.includes("elsif s.policy = 'search_misses'")
  && sql.includes("elsif s.policy = 'whatsapp_pending_actions'"));

const calls: Array<Record<string, unknown>> = [];
const listeners = new Map<string, () => void>();
const originalFetch = function orig(_a: unknown, b?: Record<string, unknown>) {
  if (b) calls.push(b);
  return Promise.resolve(null);
};
const sb = {
  rest: { fetch: originalFetch },
  rpc(_name: string, args: { p: unknown[] }) {
    const captured = sb.rest.fetch;
    queueMicrotask(() => captured("https://example/rpc/dl_add", { method: "POST", body: args.p }));
    return Promise.resolve({ data: null, error: null });
  },
};
const sandbox = {
  window: {} as { DEEPLINK_TIMING?: boolean; dlMark?: (k: string) => void },
  location: { search: "?wc=a1b2c3d4e5f6&wt=new_lead&goto=accLeads" },
  URLSearchParams,
  performance: {
    getEntriesByType: () => [{ responseStart: 12 }],
    getEntriesByName: () => [{ startTime: 40 }],
    now: () => 80,
  },
  navigator: { userAgent: "Mozilla/5.0 Chrome" },
  document: { hidden: false },
  addEventListener: (name: string, fn: () => void) => { listeners.set(name, fn); },
  fetch: originalFetch,
  sb,
};
vm.createContext(sandbox);
vm.runInContext(js, sandbox);
check("dlMark קיים בלי לגעת ב-fetch של הדף", typeof sandbox.window.dlMark === "function" && sandbox.fetch === originalFetch);
sandbox.window.dlMark!("auth");
sandbox.window.dlMark!("route");
sandbox.window.dlMark!("visible");
await new Promise((r) => setTimeout(r, 0));
const sent = callsBody();
check("השורה יוצאת פעם אחת עם reached ו-keepalive", calls.length === 1 && sent[9] === "r" && sent[10] === "c"
  && calls[0].keepalive === 1 && sb.rest.fetch === originalFetch, sent);
check("הזמנים הם מתחילת הניווט", sent[3] === 12 && sent[4] === 40 && sent[5] === 80 && sent[6] === 80 && sent[7] === 80);
sandbox.document.hidden = true;
listeners.get("visibilitychange")!();
check("אחרי reached אין שורת נטישה", calls.length === 1);

function callsBody(): unknown[] {
  return (calls[0].body || []) as unknown[];
}

const path = withClick("/crm?goto=accLeads&lead=11111111-1111-4111-8111-111111111111", "new_lead");
check("הנתיב נשאר בטוח", isSafeCrmPath(path));
const plan = screenBundle([
  { type: "new_lead", path: "/crm?goto=accLeads&lead=11111111-1111-4111-8111-111111111111", title: "א" },
], () => "/crm?goto=accLeads");
check("כפתור יחיד נושא wc בלי PII", plan.kind === "single" && clickRecords(plan).length === 1
  && clickRecords(plan)[0].wt === "new_lead" && !path.includes("972"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
