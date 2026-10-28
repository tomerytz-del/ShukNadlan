// שמירה מפני התפרצות: התקרות, המפסק, ובקשת תמונות. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_burst_guard_test.ts

import { readFileSync } from "node:fs";
import {
  burstDigestItem,
  burstText,
  collapseForSend,
  guardEnabled,
  isBurstExempt,
} from "../supabase/functions/notification-push/burst-guard.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const sql = readFileSync(
  new URL("../supabase/migrations/20271029140000_gabriela_burst_guard.sql", import.meta.url),
  "utf8",
);
const push = readFileSync(
  new URL("../supabase/functions/notification-push/index.ts", import.meta.url),
  "utf8",
);
const doc = readFileSync(new URL("../docs/notifications-center.md", import.meta.url), "utf8");

const claimStart = sql.indexOf("function public.notification_push_claim");
const claimEnd = sql.indexOf("comment on function public.notification_push_claim");
const claim = sql.slice(claimStart, claimEnd);
const prepStart = sql.indexOf("function public.notification_push_burst_prepare");
const prepEnd = sql.indexOf("comment on function public.notification_push_burst_prepare");
const prep = sql.slice(prepStart, prepEnd);
const guardSrc = readFileSync(
  new URL("../supabase/functions/notification-push/burst-guard.ts", import.meta.url),
  "utf8",
);

check("תקרות ב-SQL מעל מה שנמדד", sql.includes("('notif_burst_hour_cap', 12,")
  && sql.includes("('notif_burst_day_cap', 30,")
  && sql.includes("('notif_burst_lead_hour_cap', 20,")
  && sql.includes("('notif_burst_showing_hour_cap', 20,"));
check("מתג: 0 כבוי, כל ערך אחר דלוק", !guardEnabled(0) && guardEnabled(1) && guardEnabled(2) && !guardEnabled("no"));
check("השליחה משתמשת באותו מתג", push.includes("guardEnabled"));

check("ישן: quiet hold לא נסגר כשהתקציר כבוי", prep.includes(
  "not (v_digest_on = 0 and public.notification_push_quiet_hold",
));
check("ישן עדיין skipped", prep.includes("'stale; site only'"));
check("הספירה רק ממתינים לדחיפה, בלי נקרא ובלי שורה שכבר נרשמה", [
  "not n.read",
  "not n.suppress_push",
  "not public.notification_push_burst_exempt(n.type, ld.source)",
  "notification_push_log_holds",
].every((part) => prep.includes(part)));
const breaker = prep.slice(prep.indexOf("if v_guard = 0 then"));
check("המפסק הגלובלי לא כותב skipped", breaker.length > 0 && !breaker.includes("'skipped'") && !breaker.includes("burst breaker; site only"));
check("מפסק סוכן לא כותב skipped", !sql.includes("burst agent pending"));
check("301 בחלון מדליק את הדגל, 72 שליחות לא", prep.includes("v_created > v_created_max") && prep.includes("v_sends > v_global_max"));
check("השהיה ידנית מדליקה את אותו דגל", prep.includes("v_manual <> 0 or v_created > v_created_max"));
check("מתג כבוי יוצא לפני המפסק ומכבה אותו", prep.includes("if v_guard = 0 then") && prep.includes("notification_burst_guard_enabled"));
check("מתג הכיבוי נולד כבוי", sql.includes("('notification_burst_guard_enabled', 0,"));

check("ליד אמיתי מוגן, בקשת תמונות לא", isBurstExempt({ type: "new_lead" })
  && isBurstExempt({ type: "new_lead", source: "swipe" })
  && !isBurstExempt({ type: "new_lead", source: "photo_request" }));
check("תזכורת, סיור, ליד לא משויך ואבטחה מוגנים", [
  "agenda_reminder", "showcase_meeting", "lead_unrouted", "security_alert", "budget_alert", "ops_alert",
].every((type) => isBurstExempt({ type })));
check("system ו-open_demand אינם מוגנים", !isBurstExempt({ type: "system" }) && !isBurstExempt({ type: "open_demand" }));

check("מפסק: מוגן יוצא, ובלי מה לשלוח אין הודעה", claim.includes("v_pause or v_hold_general")
  && claim.includes("if coalesce(jsonb_array_length(v_items), 0) = 0 then"));
check("ה-claim לא רושם skipped", !claim.includes("'skipped'") && !claim.includes("burst cap; site only"));
check("גלישה נדחית לתקציר הבא", claim.includes("overflow_defer") && claim.includes("not v_digest_sent"));
check("תקציר נרשם רק על הלא-מוגן, ומשניים", claim.includes("v_ids := v_gen_ids")
  && claim.includes("coalesce(v_gen_n, 0) >= 2"));
check("תור סוכן מעל 30 דוחה לא-מוגן ולא מוחק אותו", claim.includes("v_gen_n, 0) > v_pending_max"));
check("תקרה לפי מסלול ועל כל פריט", claim.includes("notification_push_item_lane")
  && claim.includes("v_lead_over")
  && claim.includes("v_show_over")
  && !claim.includes("v_all_lead"));
check("עדיפות לא מדליקה את התקרה הכללית", claim.includes("notification_push_priority_types()")
  && claim.includes("photo_request"));
check("דחייה שורדת מעבר ל-12 שעות", claim.includes("push_deferred_at")
  && claim.includes("notification_push_mark_deferred"));
check("תקרה לפחות 1", claim.includes(
  "greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_hour_cap'), 12))",
) && claim.includes(
  "greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_hour_cap'), 20))",
));
check("התראת המפסק יוצאת למנהלים", /insert into public\.notifications \(agent_id, type, title, body, suppress_push\)[\s\S]{0,700}\bfalse\b/.test(prep));
check("סיכום בלי last_sent_at עדיין אתר בלבד", sql.includes("v_from is null or a.created_at > v_from")
  && !sql.includes("if v_from is not null"));
check("השליחה קוראת לקיפול ששומר על מוגן", guardSrc.includes("isBurstExempt")
  && push.includes("collapseForSend")
  && push.includes("digest.guardOn"));

const folded = collapseForSend([
  { type: "open_demand", title: "א" },
  { type: "open_demand", title: "ב" },
  ...Array.from({ length: 23 }, (_, i) => ({ type: "system", title: String(i) })),
]);
check("קריסה מעל 24", folded.length === 1 && folded[0].type === "burst_digest" && folded[0].count === 25);
check("ליד אמיתי לא נבלע בקריסה", collapseForSend([
  { type: "new_lead", source: "buyer" },
  ...Array.from({ length: 30 }, (_, i) => ({ type: "system", title: String(i) })),
]).some((it) => it.type === "new_lead"));
check("בקשת תמונות כן נבלעת מעל 24", collapseForSend([
  { type: "new_lead", source: "photo_request" },
  ...Array.from({ length: 30 }, () => ({ type: "system" })),
]).length === 1);
check("מתג כבוי לא מקפל", collapseForSend(
  Array.from({ length: 30 }, () => ({ type: "system" })),
  24,
  false,
).length === 30);
check("תקציר מהמסד לא נפרש", collapseForSend([burstDigestItem(9), { type: "system" }]).length === 1);
check("מתחת לסף נשאר", collapseForSend([{ type: "new_lead" }, { type: "system" }]).length === 2);

check("בקשת תמונות: החדשה נשארת", prep.includes("(n3.created_at, n3.id) > (n.created_at, n.id)"));
check("היסטרזיס 70 אחוז ו-30 דקות", prep.includes("notif_burst_hysteresis_pct")
  && prep.includes("v_rearm * 60") && prep.includes("v_below"));
check("ops לכל מנהל", prep.includes("n.agent_id = m.id"));
check("ready מודע למפסק", sql.includes("function public.notification_push_ready")
  && sql.includes("notification_push_has_backlog(true)")
  && sql.includes("notif_burst_checked_at"));

const text = burstText("דנה לוי", 12, "https://shuknadlan.co.il", "https://shuknadlan.co.il/crm?goto=accNotifPrefs");
check("נוסח התקציר", text.includes("דנה, יש לך 12 התראות חדשות באתר.") && text.includes("https://shuknadlan.co.il/crm"));
check("בלי מקף ארוך בנוסח", !text.includes("—") && !text.includes("–"));

check("ה-claim לא מחזיר חלון של שבעה ימים", !claim.includes("24 * 7"));
check("quiet hold רק כשהתקציר כבוי", claim.includes("v_digest_on = 0 and public.notification_push_quiet_hold"));
check("תקרת המבט הקיימת לא מוחלפת", !sql.includes("function public.notification_push_due_agents"));
check("לא נוגעים בפונקציית הליד", !sql.includes("function public.notify_agent_on_new_lead"));
check("לא מחליפים את agent_works_city", !sql.includes("function public.agent_works_city"));
check("עדיין קוראים ל-agent_works_city", sql.includes("public.agent_works_city(m.id, r.city_id)"));
check("לא מחליפים את city_id_for_name", !sql.includes("function public.city_id_for_name"));
check("suppress_push", sql.includes("suppress_push boolean not null default false"));
check("בקשת תמונות", sql.includes("l.source = 'photo_request'"));
check("תקציר", sql.includes("'burst_digest'") && sql.includes("יש לך "));
check("skipped 25 שעות אחורה", sql.includes("now() - interval '25 hours'"));
check("ops_alert", sql.includes("'ops_alert'") && sql.includes("וואטסאפ לסוכנים הושהה"));
check("מיפוי ביקוש", sql.includes("function public.scraped_leads_mark_remap"));
check("14 יום", sql.includes("notif_burst_scraped_stale_days"));
const demandStart = sql.indexOf("function public.scraped_lead_notify_demand");
const demandEnd = sql.indexOf("comment on function public.scraped_lead_notify_demand");
const demand = sql.slice(demandStart, demandEnd);
function fanoutSplit(recipients: number, cap: number) {
  if (cap <= 0) return { push: recipients, bell: 0 };
  const push = Math.min(recipients, cap);
  return { push, bell: recipients - push };
}
const fanoutCap = Number(sql.match(/\('notif_burst_demand_fanout', (\d+),/)?.[1]);
check("תקרת הפצה 15, מתחת ל-51-54 שנמדדו, ואפס מבטל", fanoutCap === 15
  && fanoutCap < 51
  && demand.includes("where key = 'notif_burst_demand_fanout'), 15")
  && demand.includes("v_cap > 0 and s.rn > v_cap")
  && sql.includes("51 עד 54"));
check("54 סוכנים: 15 וואטסאפ ו-39 בפעמון", fanoutSplit(54, fanoutCap).push === 15
  && fanoutSplit(54, fanoutCap).bell === 39);
check("51 סוכנים: 15 וואטסאפ ו-36 בפעמון", fanoutSplit(51, fanoutCap).bell === 36);
check("אפס מבטל את התקרה על 54", fanoutSplit(54, 0).push === 54 && fanoutSplit(54, 0).bell === 0);
check("כולם נכנסים, אף אחד לא נמחק מההפצה", demand.includes("insert into public.notifications")
  && demand.includes("demand_notified_at = now()")
  && !demand.includes("limit ")
  && demand.includes("public.agent_works_city(m.id, r.city_id)")
  && demand.includes("public.agent_handles_type"));
check("דירוג: עיר המשרד, שכונה, ואז שיחה אחרונה", demand.includes("when a.city_id = r.city_id then 0")
  && demand.includes("preferred_neighborhoods")
  && demand.includes("w.last_message_at desc nulls last"));
check("פוסט ישן עדיין אתר לכולם", demand.includes("v_site or (v_cap > 0 and s.rn > v_cap)"));
check("תצוגת מעקב", sql.includes("notification_push_burst_status") && sql.includes("security_invoker"));
check("revoke ל-authenticated על התצוגה", sql.includes(
  "revoke all on table public.notification_push_burst_status from public, anon, authenticated",
));
check("השליחה קורסת גוף גדול", push.includes("collapseForSend"));
check("המלאי בתיעוד", [
  "scraped_lead_notify_demand",
  "share_property_for_agent",
  "client_match_digest_run",
  "notify_agent_on_new_lead",
  "property_offers_claim",
  "photo_request",
].every((name) => doc.includes(name)));

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ שמירה מפני התפרצות: כל הבדיקות עברו");
