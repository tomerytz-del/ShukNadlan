/* ============================================================================
   יומן בקשות ל-/crm - מי פותח את האזור האישי
   ----------------------------------------------------------------------------
   ‏GA4 רואה רק מי שמריץ JavaScript, ובלי IP. כאן נרשמת כל בקשה ל-/crm כפי
   שהיא הגיעה (IP, user-agent, referer, נתיב ו-query) דרך ‏supabase/functions/
   crm-request-log, ונשמרת 30 יום. ‏docs/crm-request-log.md.

   ‏**הרישום אינו חלק מהתשובה.** הדף יוצא כמו שהוא: הקריאה רצה ב-waitUntil,
   ובכל כשל (סוד חסר, timeout, מסד שלא ענה) נבלעת. בלי CRM_LOG_SECRET ב-Netlify
   הפונקציה אינה עושה כלום - ‏fail-closed גם מהצד הזה.

   ‏**לא נוגעים בתשובה:** ‏context.next() מוחזר כמות שהוא, בלי כותרות חדשות
   ובלי עטיפה, כדי שהמטמון וה-CSP של /crm יישארו בדיוק כפי שהיו.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { blockReason, safeQuery, safeReferer } from "./lib/crm-guard.ts";

const LOG_URL = "https://obookujgolazrwycsiyn.supabase.co/functions/v1/crm-request-log";
const LOG_TIMEOUT_MS = 2500;

function env(name: string): string {
  try {
    return (globalThis as { Netlify?: { env?: { get(k: string): string | undefined } } })
      .Netlify?.env?.get(name) || "";
  } catch {
    return "";
  }
}
const secret = () => env("CRM_LOG_SECRET");

async function send(token: string, entry: Record<string, unknown>): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOG_TIMEOUT_MS);
  try {
    await fetch(LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-crm-log-secret": token },
      body: JSON.stringify(entry),
      signal: ctrl.signal,
    });
  } catch {
    /* הרישום אופציונלי. הדף כבר יצא. */
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request, context: Context) => {
  let res: Response | null = null;
  let failure: unknown = null;
  /* חסימה לפני הדף: כלי סריקה, ואם CRM_GEO_ALLOW מוגדר - גם מדינות שאינן ברשימה.
     החסימה נרשמת ביומן (סטטוס 403) כמו כל בקשה. */
  const blocked = blockReason({
    userAgent: req.headers.get("user-agent"),
    country: context.geo?.country?.code,
    geoAllow: env("CRM_GEO_ALLOW"),
  });
  if (blocked) {
    res = new Response("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } else {
    try {
      res = await context.next();
    } catch (e) {
      failure = e;
    }
  }
  const token = secret();
  if (token) record(req, context, token, res ? res.status : 0);
  if (failure) throw failure;
  return res as Response;
};

function record(req: Request, context: Context, token: string, status: number): void {
  try {
    const url = new URL(req.url);
    const h = req.headers;
    const job = send(token, {
      ip: context.ip,
      country: context.geo?.country?.code,
      city: context.geo?.city,
      method: req.method,
      path: url.pathname,
      query: safeQuery(url.search),
      status,
      user_agent: h.get("user-agent"),
      referer: safeReferer(h.get("referer")),
      accept_lang: h.get("accept-language"),
      sec_fetch: [h.get("sec-fetch-site"), h.get("sec-fetch-mode"), h.get("sec-fetch-dest")]
        .filter(Boolean).join(","),
      ch_mobile: h.get("sec-ch-ua-mobile"),
      ch_platform: h.get("sec-ch-ua-platform"),
    });
    try {
      context.waitUntil(job);
    } catch {
      /* בלי waitUntil הרישום רץ עד שה-isolate נסגר. התשובה לא מחכה. */
    }
  } catch {
    /* כל כשל בבניית הרישום נבלע: התשובה כבר מוכנה. */
  }
}

export const config: Config = {
  path: ["/crm", "/crm.html", "/crm/*"],
};
