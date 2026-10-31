/* ============================================================================
   קישור קצר לקליק - /go/<code>
   ----------------------------------------------------------------------------
   סוכן יצירת לידים מדביק את הקישור בתגובה בקבוצת פייסבוק. כל GET נרשם
   ב-link_clicks (בלי כתובת IP ובלי מחרוזת הדפדפן) ומפנה 302 לדף הבית עם
   UTM, כדי ש-GA4 יספור את אותו ביקור.

   ההפניה אינה מחכה למסד ואינה נכשלת איתו. היעד תמיד
   https://shuknadlan.co.il/ - פרמטר בכתובת אינו יכול להפוך את זה
   להפניה החוצה.

   קוד לא מוכר בפורמט תקין עדיין נרשם ומפנה הביתה, עם ברירת מחדל של UTM.
   קוד שאינו slug קצר מפנה הביתה בלי רישום.

   הפרטים: docs/click-tracking.md
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const RECORD_TIMEOUT_MS = 800;

/** slug קצר. דוגמה: seeker-e. בלי נקודה, בלי קו תחתון, בלי סלאש. */
export const GO_CODE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * מפה מפורשת. קוד שמתחיל ב-seeker / office / broker מקבל קמפיין גם בלי
 * שורה כאן. כל השאר: utm_campaign=group_comment ו-utm_content=הקוד.
 */
export const CODE_UTM: Record<string, { source: string; medium: string; campaign: string }> = {
  "seeker-e": { source: "facebook", medium: "group_comment", campaign: "seeker_link" },
};

export function utmForCode(code: string): { source: string; medium: string; campaign: string; content: string } {
  const mapped = CODE_UTM[code];
  if (mapped) return { ...mapped, content: code };
  let campaign = "group_comment";
  if (code.startsWith("seeker")) campaign = "seeker_link";
  else if (code.startsWith("office") || code.startsWith("broker")) campaign = "office_signup";
  return { source: "facebook", medium: "group_comment", campaign, content: code };
}

/** תצוגה מקדימה וסורק. נשמר רק הדגל, לא מחרוזת ה-UA. */
export function isBotUserAgent(ua: string): boolean {
  const s = ua.toLowerCase();
  if (!s) return false;
  return /bot|crawler|spider|slurp|facebookexternalhit|facebot|whatsapp|slackbot|telegrambot|linkedinbot|discordbot|embedly|iframely|preview|petalbot|applebot|pingdom|headless|wget|curl\/|python-requests|go-http-client/.test(s);
}

export function homeLocation(utm: { source: string; medium: string; campaign: string; content: string } | null): string {
  const url = new URL("/", SITE);
  if (utm) {
    url.searchParams.set("utm_source", utm.source);
    url.searchParams.set("utm_medium", utm.medium);
    url.searchParams.set("utm_campaign", utm.campaign);
    url.searchParams.set("utm_content", utm.content);
  }
  return url.toString();
}

function codeFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/go\/([a-z0-9][a-z0-9-]{0,31})\/?$/i);
  if (!m) return null;
  const code = m[1].toLowerCase();
  return GO_CODE.test(code) ? code : null;
}

function optionalSlug(value: string | null): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  return GO_CODE.test(slug) ? slug : null;
}

function optionalUuid(value: string | null): string | null {
  if (!value) return null;
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Netlify-CDN-Cache-Control": "no-store",
    },
  });
}

async function recordClick(body: {
  p_code: string;
  p_variant: string | null;
  p_scraped_lead_id: string | null;
  p_is_bot: boolean;
}): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RECORD_TIMEOUT_MS);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_link_click`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    /* הרישום אופציונלי. ההפניה כבר יצאה, או יוצאת בלי לחכות לכאן. */
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const code = codeFromPath(url.pathname);
  if (!code) return redirect(homeLocation(null));

  const location = homeLocation(utmForCode(code));
  if (req.method === "GET") {
    const job = recordClick({
      p_code: code,
      p_variant: optionalSlug(url.searchParams.get("v")),
      p_scraped_lead_id: optionalUuid(url.searchParams.get("sl")),
      p_is_bot: isBotUserAgent(req.headers.get("user-agent") || ""),
    });
    try {
      context.waitUntil(job);
    } catch {
      /* בלי waitUntil הרישום רץ עד שה-isolate נסגר. ההפניה לא מחכה. */
    }
  }
  return redirect(location);
};

export const config: Config = {
  path: ["/go", "/go/*"],
};
