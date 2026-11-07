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
   אותו מ-curl או מספריית HTTP. ה-User-Agent קל לשנות, ולכן זה עוצר רק את
   הסורקים הפשוטים - אבל אלה היו כל מה שנראה ביומן. headless Chrome אינו
   ברשימה בכוונה: הוא נרשם ביומן ולא נחסם, כי כך מזהים את מי שמריץ אותו.
   ‏**מי שמזדהה כ-ShukNadlan עובר:** הניטור (‏ShukNadlanOpsAgent,
   ‏ShukNadlan-uptime-monitor) ובדיקות ה-CI שלנו. */
const SCRAPER_UA =
  /^(python-(urllib|requests)|python-httpx|curl\/|wget\/|go-http-client|okhttp|libwww|scrapy|aiohttp|node-fetch|axios|apache-httpclient|postmanruntime|java\/)/i;

export type GuardInput = {
  userAgent: string | null;
  country: string | null | undefined;
  /* ‏CRM_GEO_ALLOW: רשימת קודי מדינה מופרדת בפסיקים. ריק או חסר = כבוי. */
  geoAllow: string | null | undefined;
};

export function blockReason(i: GuardInput): "scraper_ua" | "geo" | null {
  const ua = (i.userAgent || "").trim();
  if (/shuknadlan/i.test(ua)) return null;
  if (!ua || SCRAPER_UA.test(ua)) return "scraper_ua";
  const allow = String(i.geoAllow || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  /* מדינה לא ידועה עוברת: חסימה בגלל geo חסר הייתה נועלת גולש/ת לגיטימי/ת. */
  if (allow.length && i.country && !allow.includes(String(i.country).toUpperCase())) return "geo";
  return null;
}
