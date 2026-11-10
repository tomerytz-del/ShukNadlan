/* ============================================================================
   סנכרון ההוצאה היומית מגוגל (supabase/functions/_shared/google-channel-sync.ts)

   גוגל מחזירה שורת GAQL עם segments.date רק ליום שהיה בו impression.
   קמפיין מושהה בלי חשיפות נראה כמו סנכרון שעצר אם כותבים רק את מה שחזר.
   הבדיקה משחזרת את החלון של 8.11.2026 בלי רשת ובלי מסד.

       node --experimental-strip-types scripts/google_channel_sync_test.ts
   ========================================================================== */
import { readFileSync } from "node:fs";
import {
  enumerateDays,
  GOOGLE_CAMPAIGN_LIST_GAQL,
  googleChannelRecordsFromGaql,
  googleMetricGaql,
  googleSyncLogEntry,
  syncWindow,
} from "../supabase/functions/_shared/google-channel-sync.ts";

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`));
  if (!cond) fail++;
};

const BUYERS = "24350623422";
const syncedAt = "2026-11-08T00:25:09.970Z";

const paused = (status = "PAUSED", startDate = "2026-10-16") => ({
  campaign: { id: BUYERS, name: "buyers", status, startDateTime: `${startDate} 00:00:00` },
  customer: { currencyCode: "ILS" },
});

const metric = (day: string, costMicros: number, status = "PAUSED") => ({
  campaign: { id: BUYERS, name: "buyers", status },
  customer: { currencyCode: "ILS" },
  segments: { date: day },
  metrics: { impressions: "10", clicks: "1", costMicros: String(costMicros), conversions: "0" },
});

const nov8 = syncWindow(new Date(syncedAt), 3);
ok("חלון 8.11 ב-00:25 UTC הוא 6-8 בנובמבר", nov8.from === "2026-11-06" && nov8.to === "2026-11-08", nov8);

const nov2 = syncWindow(new Date("2026-11-02T00:25:01.930Z"), 3);
ok("חלון 2.11 עדיין כולל את 31.10", nov2.from === "2026-10-31" && nov2.to === "2026-11-02", nov2);

const empty = googleChannelRecordsFromGaql({
  metricRows: [],
  campaignRows: [paused()],
  from: nov8.from,
  to: nov8.to,
  syncedAt,
});
ok("קמפיין מושהה בלי שורות מגוגל מקבל שורה לכל יום בחלון", empty.records.length === 3 && empty.zeroRows === 3 && empty.metricRows === 0, empty);
ok("האפסים נושאים את זמן הסנכרון וסטטוס PAUSED", empty.records.every((r) =>
  r.channel === "google" && r.campaign_id === BUYERS && r.campaign_status === "PAUSED" &&
  r.spend === 0 && r.clicks === 0 && r.impressions === 0 && r.synced_at === syncedAt && r.currency === "ILS"));
ok("הימים הם בדיוק חלון הסנכרון", empty.records.map((r) => r.day).join(",") === "2026-11-06,2026-11-07,2026-11-08");

const kept = googleChannelRecordsFromGaql({
  metricRows: [metric("2026-10-31", 29_420_000)],
  campaignRows: [paused()],
  from: nov2.from,
  to: nov2.to,
  syncedAt: "2026-11-02T00:25:01.930Z",
});
const oct31 = kept.records.find((r) => r.day === "2026-10-31");
ok("הוצאה שגוגל החזירה נשמרת ולא נדרסת באפס", oct31?.spend === 29.42 && oct31?.impressions === 10 && oct31?.clicks === 1, oct31);
ok("הימים שאחרי היום האחרון עם הוצאה נכתבים כאפס", kept.records.filter((r) => r.spend === 0).map((r) => r.day).join(",") === "2026-11-01,2026-11-02", kept.records.map((r) => r.day));
ok("כל השורות בחלון, כולל היום עם הוצאה, מתעדכנות ב-synced_at של הריצה", kept.records.every((r) => r.synced_at === "2026-11-02T00:25:01.930Z"));

const gap = googleChannelRecordsFromGaql({
  metricRows: [
    metric("2026-10-26", 20_020_000, "ENABLED"),
    metric("2026-10-27", 40_770_000, "ENABLED"),
    metric("2026-10-29", 51_240_000, "ENABLED"),
    metric("2026-10-30", 32_110_000, "PAUSED"),
  ],
  campaignRows: [paused("ENABLED")],
  from: "2026-10-26",
  to: "2026-10-30",
  syncedAt: "2026-10-30T00:25:00.000Z",
});
const oct28 = gap.records.find((r) => r.day === "2026-10-28");
ok("יום בלי חשיפה באמצע רצף נכתב כאפס", oct28?.spend === 0 && oct28?.impressions === 0, oct28);
ok("ימי ההוצאה שסביבו נשארים", gap.records.find((r) => r.day === "2026-10-27")?.spend === 40.77);

const beforeStart = googleChannelRecordsFromGaql({
  metricRows: [],
  campaignRows: [paused("PAUSED", "2026-11-02")],
  from: "2026-11-01",
  to: "2026-11-03",
  syncedAt,
});
ok("אין אפס לפני תאריך ההתחלה", beforeStart.records.map((r) => r.day).join(",") === "2026-11-02,2026-11-03", beforeStart.records.map((r) => r.day));

const eur = googleChannelRecordsFromGaql({
  metricRows: [{
    campaign: { id: "9", name: "x", status: "ENABLED" },
    customer: { currencyCode: "EUR" },
    segments: { date: "2026-11-08" },
    metrics: { costMicros: "1000000", clicks: "1", impressions: "1", conversions: "0" },
  }],
  campaignRows: [{
    campaign: { id: "9", name: "x", status: "ENABLED", startDateTime: "2026-11-01 00:00:00" },
    customer: { currencyCode: "EUR" },
  }],
  from: "2026-11-08",
  to: "2026-11-08",
  syncedAt,
});
ok("מטבע שאינו שקל או דולר לא נכתב ומדווח", eur.records.length === 0 && eur.skippedCurrencies.join(",") === "EUR", eur.skippedCurrencies);

const usd = googleChannelRecordsFromGaql({
  metricRows: [],
  campaignRows: [{
    campaign: { id: "8", name: "usd", status: "PAUSED", startDateTime: "2026-11-08 00:00:00" },
    customer: { currencyCode: "USD" },
  }],
  from: "2026-11-08",
  to: "2026-11-08",
  syncedAt,
});
ok("דולר נשמר", usd.records.length === 1 && usd.records[0].currency === "USD" && usd.records[0].spend === 0);

const orphan = googleChannelRecordsFromGaql({
  metricRows: [metric("2026-11-06", 1_000_000)],
  campaignRows: [],
  from: nov8.from,
  to: nov8.to,
  syncedAt,
});
ok("שורת הוצאה בלי קמפיין ברשימה נשמרת ולא ממולאים לה אפסים", orphan.records.length === 1 && orphan.records[0].day === "2026-11-06" && orphan.zeroRows === 0);

const removed = googleChannelRecordsFromGaql({
  metricRows: [],
  campaignRows: [paused("REMOVED")],
  from: nov8.from,
  to: nov8.to,
  syncedAt,
});
ok("קמפיין שהוסר לא מקבל ימי אפס", removed.records.length === 0);

const blank = googleChannelRecordsFromGaql({
  metricRows: [{ campaign: { id: "", status: "ENABLED" }, segments: { date: "2026-11-08" }, metrics: {} }],
  campaignRows: [{ campaign: { id: "", status: "ENABLED" }, customer: { currencyCode: "ILS" } }],
  from: "2026-11-08",
  to: "2026-11-08",
  syncedAt,
});
ok("מזהה ריק נזרק", blank.records.length === 0);

ok("ימים כוללים את שני הקצוות", enumerateDays("2026-10-31", "2026-11-02").join(",") === "2026-10-31,2026-11-01,2026-11-02");
ok("טווח הפוך ריק", enumerateDays("2026-11-02", "2026-10-31").length === 0);

let threw = false;
try { googleMetricGaql("2026-11-06' OR 1=1 --", "2026-11-08"); } catch { threw = true; }
ok("תאריך שאינו יום לא נכנס לשאילתה", threw);
const metricSql = googleMetricGaql("2026-11-06", "2026-11-08");
ok("שאילתת הימים מוגבלת לחלון", metricSql.includes("BETWEEN '2026-11-06' AND '2026-11-08'") && metricSql.includes("segments.date"));
ok("רשימת הקמפיינים בלי segments.date, בלי קמפיין שהוסר", !GOOGLE_CAMPAIGN_LIST_GAQL.includes("segments.date") && GOOGLE_CAMPAIGN_LIST_GAQL.includes("campaign.status != 'REMOVED'"));

const entry = googleSyncLogEntry({
  ok: true, days: 3, from: nov8.from, to: nov8.to,
  rows: 3, zeroRows: 3, metricRows: 0, skippedCurrencies: [],
});
const dumped = JSON.stringify(entry);
ok("היומן הוא google_sync_insights בלי מזהה חשבון", entry.action === "google_sync_insights" && entry.object_type === "account" && entry.object_id === null && entry.ok);
ok("היומן לא נושא טוקן, שאילתה או מזהה קמפיין", !/token|query|SELECT|24350623422/i.test(dumped), dumped);
const longErr = googleSyncLogEntry({ ok: false, error: "x".repeat(500), code: "invalid_grant" });
ok("שגיאה נחתכת והקוד נשמר", longErr.error?.length === 300 && longErr.response.code === "invalid_grant" && longErr.ok === false);
const dirty = googleSyncLogEntry({ ok: false, from: "2026-11-06' OR", to: "nope" });
ok("תאריך פגום לא נכנס לבקשה שביומן", dirty.request.from === undefined && dirty.request.to === undefined);

const indexSrc = readFileSync(new URL("../supabase/functions/ads-admin/index.ts", import.meta.url), "utf8");
const fnStart = indexSrc.indexOf("async function actionGoogleSyncInsights");
const fnEnd = indexSrc.indexOf("async function actionGoogleKeywordIdeas");
const fn = indexSrc.slice(fnStart, fnEnd);
ok("הסנכרון משתמש במילוי האפסים", fn.includes("googleChannelRecordsFromGaql") && fn.includes("GOOGLE_CAMPAIGN_LIST_GAQL"));
ok("הצלחה, חוסר הגדרה וכשל נרשמים ביומן", fn.split("googleSyncLogEntry").length === 5, fn.split("googleSyncLogEntry").length);
ok("ה-cron מעביר את הקורא כדי שהיומן יסמן cron", indexSrc.includes("actionGoogleSyncInsights(sb, caller, body)"));

console.log(fail ? `\n✗ ${fail} נכשלו` : "\n✓ סנכרון גוגל: יום בלי חשיפה נשאר נראה, והיומן בלי סודות");
process.exit(fail ? 1 : 0);
