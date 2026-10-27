// שמירה מפני התפרצות: התקרות, המפסק, ובקשת תמונות. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_burst_guard_test.ts

import { readFileSync } from "node:fs";
import {
  BURST_DEFAULTS,
  burstBucket,
  burstCaps,
  burstDigestItem,
  burstText,
  collapseForSend,
  isBurstExempt,
  overBurstCap,
  photoRequestKeep,
} from "../supabase/functions/notification-push/burst-guard.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const sql = readFileSync(
  new URL("../supabase/migrations/20271028140000_gabriela_burst_guard.sql", import.meta.url),
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

check("תקרה כללית מעל 7 בשעה ו-18 ביום", BURST_DEFAULTS.hourCap > 7 && BURST_DEFAULTS.dayCap > 18);
check("יום של 18 ושעה של 7 לא עוברים את התקרה", !overBurstCap(7, 18, burstCaps("general")));
check("שעה 12 כבר מעליה", overBurstCap(12, 3, burstCaps("general")));
check("ליד אמיתי לא נתפס בתקרה הכללית", !overBurstCap(3, 3, burstCaps("lead")));
check("סיור לא נתפס בתקרה הכללית", !overBurstCap(2, 2, burstCaps("showing")));
check("בקשת תמונות היא תקרה כללית", burstBucket([{ type: "new_lead", source: "photo_request" }]) === "general");
check("ליד בלי מקור הוא תקרת לידים", burstBucket([{ type: "new_lead" }]) === "lead");
check("ערבוב ליד וסיור הוא כללי", burstBucket([{ type: "new_lead" }, { type: "showcase_meeting" }]) === "general");

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
check("השהיה ידנית מדליקה את אותו דגל", prep.includes("v_manual = 1 or v_created > v_created_max"));
check("מתג כבוי יוצא לפני המפסק ומכבה אותו", prep.includes("if v_guard = 0 then") && prep.includes("notification_burst_guard_enabled"));
check("מתג הכיבוי נולד דלוק", sql.includes("('notification_burst_guard_enabled', 1,"));

check("ליד אמיתי מוגן, בקשת תמונות לא", isBurstExempt({ type: "new_lead" })
  && isBurstExempt({ type: "new_lead", source: "swipe" })
  && !isBurstExempt({ type: "new_lead", source: "photo_request" }));
check("תזכורת, סיור, ליד לא משויך ואבטחה מוגנים", [
  "agenda_reminder", "showcase_meeting", "lead_unrouted", "security_alert", "budget_alert", "ops_alert",
].every((type) => isBurstExempt({ type })));
check("system ו-open_demand אינם מוגנים", !isBurstExempt({ type: "system" }) && !isBurstExempt({ type: "open_demand" }));

check("מפסק: מוגן יוצא בפרטים, ובלי מוגן אין שליחה", claim.includes("if v_pause then")
  && claim.includes("v_items := v_ex_items")
  && claim.includes("if coalesce(array_length(v_ex_ids, 1), 0) = 0 then"));
check("ה-claim לא רושם skipped", !claim.includes("'skipped'") && !claim.includes("burst cap; site only"));
check("גלישה נדחית לתקציר הבא", claim.includes("overflow_defer") && claim.includes("v_hold_general and v_digest_sent"));
check("תקציר נרשם רק על הלא-מוגן", claim.includes("v_ids := v_gen_ids"));
check("תור סוכן מעל 30 דוחה לא-מוגן ולא מוחק אותו", claim.includes("v_gen_n, 0) > v_pending_max"));
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

const keep = photoRequestKeep([
  { id: "a", createdAt: 1 },
  { id: "b", createdAt: 2 },
], false);
check("נשארת בקשת התמונות החדשה", keep?.id === "b");
check("אחרי שכבר נשלחה לא נשלחת עוד", photoRequestKeep([{ id: "a", createdAt: 1 }], true) === null);

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
