/* ============================================================================
   ההגנה והסינון של /crm - פונקציות טהורות, בלי רשת ובלי תלות, כדי שאפשר
   לבדוק אותן ב-node (‏scripts/crm_guard_test.mjs). ‏docs/crm-request-log.md.
   ========================================================================== */

/* ‏**מה נשמר מה-query:** רק שמות ידועים מהקישורים העמוקים של האפליקציה
   (agent-deep-link.ts) ומקורות הכניסה. כל השאר - ‏code ו-state של OAuth,
   ‏k של /plan ו-/cma, טוקנים - נרשם כשם בלבד: "code=[x]". קישור שהוא גם
   הרשאה לא נשמר 30 יום במסד. ה-referer נשמר בלי query. */
const KEEP = new Set([
  "goto", "client", "property", "lead", "focus", "agenda", "agreement", "review",
  "filter", "status", "import", "tab", "demand", "plan_city", "plan_street", "plan_num",
  "plan_gush", "plan_helka", "wc", "wt", "src", "share",
]);

export function safeQuery(search: string): string {
  const out: string[] = [];
  try {
    new URLSearchParams(search).forEach((v, k) => {
      out.push(KEEP.has(k) ? `${k}=${v.slice(0, 80)}` : `${k.slice(0, 40)}=[x]`);
    });
  } catch {
    return "";
  }
  return out.join("&");
}

export function safeReferer(raw: string | null): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
}

/* ‏**כלי סריקה שאינם דפדפן.** ‏/crm הוא דף של דפדפן: אין לקוח לגיטימי שמושך
   אותו מ-curl או מספריית HTTP. ה-User-Agent **קל לשנות**, ולכן זה עוצר רק את
   הסורקים הפשוטים עם הזהות המובנית שלהם - אבל אלה היו כל מה שנראה ביומן.
   זו אינה הגנה מסורק שמתחזה לדפדפן; את זה עוצר רק אימות (‏2FA וה-RLS).
   headless Chrome אינו ברשימה בכוונה: הוא נרשם ביומן ולא נחסם.

   ‏**מי שעובר:** רק הזהויות המדויקות של הניטור שלנו (‏ShukNadlanOpsAgent,
   ‏ShukNadlan-uptime-monitor, ‏ShukNadlan-baseline-audit), לא כל UA שמכיל
   את השם - אחרת מספיקה מילה אחת כדי לעקוף. גם זו זהות שאפשר לזייף מי
   שמכיר/ה אותה, ולכן היא מקל על ניטור ולא נועלת דלת. */
const SCRAPER_UA =
  /(python-(urllib|requests|httpx)|^curl\/|libcurl|^wget|go-http-client|okhttp|libwww|scrapy|aiohttp|node-fetch|axios|apache-httpclient|postmanruntime|^java\/)/i;
const OWN_UA = /^(ShukNadlanOpsAgent\/|Mozilla\/5\.0 \(ShukNadlan-(uptime-monitor|baseline-audit)\)$)/;

export type GuardInput = {
  userAgent: string | null;
  country: string | null | undefined;
  /* ‏CRM_GEO_ALLOW: רשימת קודי מדינה מופרדת בפסיקים. ריק או חסר = כבוי. */
  geoAllow: string | null | undefined;
};

export function blockReason(i: GuardInput): "scraper_ua" | "geo" | null {
  const ua = (i.userAgent || "").trim();
  if (OWN_UA.test(ua)) return null;
  if (!ua || SCRAPER_UA.test(ua)) return "scraper_ua";
  const allow = String(i.geoAllow || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  /* מדינה לא ידועה עוברת: חסימה בגלל geo חסר הייתה נועלת גולש/ת לגיטימי/ת. */
  if (allow.length && i.country && !allow.includes(String(i.country).toUpperCase())) return "geo";
  return null;
}

/* ‏403 בעברית ועם דרך לבקש עזרה (‏CLAUDE.md, "הודעת שגיאה"). */
export const FORBIDDEN_HTML =
  '<!doctype html><meta charset="utf-8"><title>הגישה נחסמה</title>' +
  '<body dir="rtl" style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">' +
  "<h1>הגישה מכאן נחסמה</h1>" +
  "<p>האזור האישי זמין כרגע מישראל בלבד, ולכלים אוטומטיים אין גישה אליו.</p>" +
  '<p>אם זו טעות (למשל בחו"ל, או דרך VPN), פנו אלינו דרך <a href="/about">עמוד "אודות"</a> ונסדר.</p>';
