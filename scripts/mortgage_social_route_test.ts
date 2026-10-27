/**
 * ליד משכנתא מערוץ חברתי - הדגל כבוי, בלי טלפון קשיח, בלי נגיעה
 * בשלוש הפונקציות המוגנות. לא מריץ SQL.
 *
 *   node --experimental-strip-types scripts/mortgage_social_route_test.ts
 */
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20271029100000_mortgage_social_route.sql",
  "utf8",
);
const crm = readFileSync("assets/crm.js", "utf8");
const html = readFileSync("crm.html", "utf8");
const push = readFileSync("supabase/functions/notification-push/index.ts", "utf8");
const intake = readFileSync("supabase/functions/mortgage-lead-intake/index.ts", "utf8");
const social = readFileSync("supabase/functions/social-lead-intake/index.ts", "utf8");

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log("ok  " + name);
  else {
    failed++;
    console.log("FAIL " + name);
  }
}

check("הדגל כבוי", /mortgage_social_route_enabled',\s*\n\s*0,/.test(sql));
check("יועץ לפי דגל", sql.includes("m.is_mortgage_advisor is true"));
check("חשבון פעיל ולא סגור", sql.includes("m.active is true") && sql.includes("m.closed_at is null"));
check("בלי טלפון קשיח", !/\+972|05\d{7,8}|phone_e164\s*=/.test(sql));
check("ההתראה בלי פרטי הפונה", !/new\.phone|new\.full_name|new\.email/.test(sql));
check("חינם", /0,\s*'success',\s*'social_route'/.test(sql));
check("סכום אפס", /select new\.id, m\.id, m\.agency_id, 0, 'success', 'social_route'/.test(sql));
check("ערוץ מפורש", sql.includes("channel in ('facebook', 'instagram')") && sql.includes("mortgage_lead_set_channel"));
check("היקף כרשימה", sql.includes("mortgage_free_route_sources") && sql.includes("'facebook_dm'") && sql.includes("'instagram_comment'"));
check("ספירת לידים חינם", sql.includes("'free_routed', v_count"));
check("קישור לליד", sql.includes("related_mortgage_lead_id") && sql.includes("&mortgage="));
check("בלי חיוב ארנק", !/credit_balance/.test(sql));
check("מונה", sql.includes("create table if not exists public.mortgage_social_routes"));
check("בדיקה אחרי 10 בלי לעצור", sql.includes("'review_after', 10") && sql.includes("v_count >= 10") && !/count\(\*\)\s*<\s*10/.test(sql));
check("סוג דרך notification_types_add", sql.includes("notification_types_add(array['mortgage_social'])"));
check(
  "לא מחליף את שלוש המוגנות",
  !/create or replace function public\.notify_agent_on_new_lead/.test(sql) &&
    !/create or replace function public\.notifications_apply_preferences/.test(sql) &&
    !/create or replace function[\s\S]{0,80}social.lead/.test(sql),
);
check("לא מחליף את purchase_mortgage_lead", !/create or replace function public\.purchase_mortgage_lead/.test(sql));
check("הרשאות הטבלה", sql.includes("revoke all on table public.mortgage_social_routes from public, anon, authenticated") && sql.includes("grant select on table public.mortgage_social_routes to authenticated, service_role"));
check("הרשאות הטריגר", sql.includes("revoke all on function public.mortgage_social_route() from public, anon, authenticated"));
check("הרשאות המונה", sql.includes("revoke all on function public.mortgage_social_route_stats() from public, anon") && sql.includes("grant execute on function public.mortgage_social_route_stats() to authenticated, service_role"));
check("שם פרטי בלבד בפירוט", sql.includes("split_part(coalesce(m.display_name, ''), ' ', 1)") && !/'phone'/.test(sql));
check("המונה במגירה", html.includes('id="mortgageSocialRouteCount"') && crm.includes("loadMortgageSocialRouteCount") && crm.includes("ההסכם לבדיקה"));
check("הכפתור לכרטיס הליד", push.includes('mortgage_social: "accLeadShelf"') && push.includes("&mortgage=${mortgage}") && crm.includes("openPurchasedMortgageFromParam"));
check("הפעמון לאותו ליד", crm.includes("type:'mortgage_social'") && crm.includes("related_mortgage_lead_id"));
check("הקליטה לא מנתבת", !intake.includes("mortgage_social_route") && !social.includes("mortgage_social_route") && intake.includes("mortgage_lead_set_channel"));

if (failed) {
  console.log("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall ok");
