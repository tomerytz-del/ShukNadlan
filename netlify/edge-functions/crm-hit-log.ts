/* ============================================================================
   יומן כניסות ל-/crm — זמני, לזיהוי הריצה האוטומטית של 09:00
   ----------------------------------------------------------------------------
   ‏GA4 ראה 37-39 סשנים ביום עבודה (09:00 שעון ישראל) על אותן 18-19 כתובות של
   ‏/crm, דרך מאגר פרוקסים. ‏Supabase לא רואה אותם: הם לא מתחברים, ולכן לא
   נוגעים בממשק. ‏Log Drains זמין רק ב-Enterprise, ובלי לוג גישה אין דרך לדעת
   מי מבקש את ה-HTML. הפונקציה הזו כותבת שורת JSON אחת לכל בקשה אל
   ‏console.log, שרואים ב-Logs & metrics > Edge functions. הפרטים והסיכום:
   ‏docs/crm-hit-log.md.

   ‏**מעבירה את התשובה כמו שהיא ולא נוגעת בה.** ‏`context.next()` מחזירה את
   הדף, וכל כשל בכתיבת היומן נבלע: אי אפשר שהיומן יפיל את ה-CRM.

   ‏**מה נרשם ומה לא (פרטיות):**
   • ‏לא נרשמים ערכי פרמטרים. ‏`wc`, ‏`token`, מזהי נכסים ולידים הם הרשאה, ולכן
     נרשמים רק **שמות** הפרמטרים ושם היעד (`goto`) אם הוא מהצורה `accXxx`.
   • ‏ה-IP נחתך (‏/24 ב-IPv4, ‏/48 ב-IPv6): מספיק כדי לספור רשתות שונות, לא כדי
     לזהות אדם.
   • ‏ההפניה (referer) נרשמת כשם מארח בלבד.

   ‏**זמני.** מסירים אחרי שהריצה זוהתה (או אחרי שבועיים בלי ממצא).
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const GOTO_RE = /^acc[A-Za-z]{1,40}$/;

function coarseIp(ip: string | undefined): string {
  if (!ip) return "";
  /* ‏IPv4, וגם IPv4 בתוך IPv6 (‏::ffff:1.2.3.4): /24 */
  const v4 = ip.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(":")) return "";
  /* ‏IPv6 דחוס (‏2001::1234:5678) נפרש לשמונה קבוצות לפני החיתוך ל-/48 */
  const [head, tail] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return groups.length === 8 ? groups.slice(0, 3).join(":") + "::/48" : "";
}

/* ‏שמות פרמטרים מוכרים של ה-CRM בלבד. שם אחר (‏מפתח בלי ערך שמכיל טוקן, למשל
   ‏/crm?abc123) נרשם כ-"other", כדי שהיומן לא ידלוף מה שבתוך המפתח. */
const KNOWN_PARAMS = new Set([
  "goto", "client", "property", "lead", "focus", "agenda", "agreement", "review",
  "filter", "status", "import", "tab", "demand", "mortgage", "plan_city",
  "plan_street", "plan_num", "plan_gush", "plan_helka", "wc", "wt", "share",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "fbclid", "token",
]);

function refererHost(ref: string | null): string {
  if (!ref) return "";
  try { return new URL(ref).hostname.slice(0, 80); } catch { return ""; }
}

function logHit(req: Request, context: Context, status: number): void {
  try {
    const url = new URL(req.url);
    const goto = url.searchParams.get("goto") || "";
    const h = req.headers;
    console.log(JSON.stringify({
      crm_hit: 1,
      ts: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      goto: GOTO_RE.test(goto) ? goto : goto ? "other" : "",
      params: [...url.searchParams.keys()].slice(0, 12).map((k) => (KNOWN_PARAMS.has(k) ? k : "other")),
      status,
      ua: (h.get("user-agent") || "").slice(0, 200),
      ch_ua: (h.get("sec-ch-ua") || "").slice(0, 120),
      ch_mobile: h.get("sec-ch-ua-mobile") || "",
      ch_platform: h.get("sec-ch-ua-platform") || "",
      lang: (h.get("accept-language") || "").slice(0, 40),
      dest: h.get("sec-fetch-dest") || "",
      site: h.get("sec-fetch-site") || "",
      ref: refererHost(h.get("referer")),
      country: context.geo?.country?.code || "",
      city: (context.geo?.city || "").slice(0, 40),
      ip24: coarseIp(context.ip),
    }));
  } catch {
    /* היומן לעולם לא מפיל את הדף */
  }
}

export default async (req: Request, context: Context) => {
  const res = await context.next();
  /* ‏מתג כיבוי בלי דיפלוי: משתנה הסביבה CRM_HIT_LOG=off ב-Netlify */
  if (Deno.env.get("CRM_HIT_LOG") !== "off") logHit(req, context, res.status);
  return res;
};

export const config: Config = {
  path: ["/crm", "/crm/", "/crm.html"],
};
