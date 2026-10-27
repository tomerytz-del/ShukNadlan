// שמירה מפני התפרצות: התקרות, המפסק, ובקשת תמונות. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_burst_guard_test.ts

import { readFileSync } from "node:fs";
import {
  BURST_DEFAULTS,
  burstAction,
  burstBucket,
  burstCaps,
  burstDigestItem,
  burstText,
  breakerShouldPause,
  collapseForSend,
  overBurstCap,
  photoRequestKeep,
  shouldMarkSiteOnly,
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

check("תקרה כללית מעל 7 בשעה ו-18 ביום", BURST_DEFAULTS.hourCap > 7 && BURST_DEFAULTS.dayCap > 18);
check("יום של 18 ושעה של 7 לא עוברים את התקרה", !overBurstCap(7, 18, burstCaps("general")));
check("שעה 12 כבר מעליה", overBurstCap(12, 3, burstCaps("general")));
check("ליד אמיתי לא נתפס בתקרה הכללית", !overBurstCap(3, 3, burstCaps("lead")));
check("סיור לא נתפס בתקרה הכללית", !overBurstCap(2, 2, burstCaps("showing")));
check("בקשת תמונות היא תקרה כללית", burstBucket([{ type: "new_lead", source: "photo_request" }]) === "general");
check("ליד בלי מקור הוא תקרת לידים", burstBucket([{ type: "new_lead" }]) === "lead");
check("ערבוב ליד וסיור הוא כללי", burstBucket([{ type: "new_lead" }, { type: "showcase_meeting" }]) === "general");

check("דגל כבוי, quiet hold, לא נסגר", !shouldMarkSiteOnly({
  ageHours: 30, digestOn: false, priority: false, kept: false, quietHold: true, suppress: false,
}));
check("דגל כבוי, 13 שעות בלי quiet, נסגר", shouldMarkSiteOnly({
  ageHours: 13, digestOn: false, priority: false, kept: true, quietHold: false, suppress: false,
}));
check("דגל כבוי, שעתיים, נשלח", !shouldMarkSiteOnly({
  ageHours: 2, digestOn: false, priority: false, kept: false, quietHold: false, suppress: false,
}));
check("עדיפות בתוך 72 נשלחת", !shouldMarkSiteOnly({
  ageHours: 20, digestOn: false, priority: true, kept: true, quietHold: false, suppress: false,
}));
check("עדיפות אחרי 72 נסגרת", shouldMarkSiteOnly({
  ageHours: 80, digestOn: false, priority: true, kept: true, quietHold: false, suppress: false,
}));
check("תקציר דלוק, סוג רגיל אחרי 12 נשאר באתר", shouldMarkSiteOnly({
  ageHours: 13, digestOn: true, priority: false, kept: false, quietHold: true, suppress: false,
}));
check("תקציר דלוק, מוגן בתוך 72 נשלח", !shouldMarkSiteOnly({
  ageHours: 20, digestOn: true, priority: false, kept: true, quietHold: false, suppress: false,
}));
check("suppress תמיד באתר", shouldMarkSiteOnly({
  ageHours: 1, digestOn: false, priority: true, kept: true, quietHold: true, suppress: true,
}));

check("31 ממתינות לסוכן/ת מדליקות מפסק מקומי", breakerShouldPause({
  manual: false, pending: 31, created: 20, globalSends: 10,
}).agent);
check("30 ממתינות עדיין לא", !breakerShouldPause({
  manual: false, pending: 30, created: 20, globalSends: 10,
}).agent && !breakerShouldPause({
  manual: false, pending: 30, created: 20, globalSends: 10,
}).global);
check("301 ב-15 דקות הוא מפסק גלובלי", breakerShouldPause({
  manual: false, pending: 1, created: 301, globalSends: 10,
}).global);
check("72 שליחות בשעה, המקסימום שנמדד, לא מפסק", !breakerShouldPause({
  manual: false, pending: 1, created: 20, globalSends: 72,
}).global);
check("131 שליחות בשעה הוא מפסק", breakerShouldPause({
  manual: false, pending: 1, created: 20, globalSends: 131,
}).global);
check("השהיה ידנית היא מפסק גם ביום שקט", breakerShouldPause({
  manual: true, pending: 0, created: 0, globalSends: 0,
}).global);

check("מעל תקרה בלי תקציר השעה: תקציר אחד", burstAction({
  paused: false, overCap: true, digestAlreadyThisHour: false, itemCount: 3,
}) === "digest");
check("מעל תקרה אחרי תקציר: רק באתר", burstAction({
  paused: false, overCap: true, digestAlreadyThisHour: true, itemCount: 3,
}) === "site_only");
check("18 פריטים עדיין הודעה רגילה", burstAction({
  paused: false, overCap: false, digestAlreadyThisHour: false, itemCount: 18,
}) === "send");
check("25 פריטים נהיים תקציר", burstAction({
  paused: false, overCap: false, digestAlreadyThisHour: false, itemCount: 25,
}) === "digest");
check("מפסק לא שולח", burstAction({
  paused: true, overCap: false, digestAlreadyThisHour: false, itemCount: 1,
}) === "site_only");

const folded = collapseForSend([
  { type: "open_demand", title: "א" },
  { type: "open_demand", title: "ב" },
  ...Array.from({ length: 23 }, (_, i) => ({ type: "system", title: String(i) })),
]);
check("קריסה מעל 24", folded.length === 1 && folded[0].type === "burst_digest" && folded[0].count === 25);
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
