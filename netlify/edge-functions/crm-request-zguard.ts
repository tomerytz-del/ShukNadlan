/* ============================================================================
   חסימת כלי סריקה (ומדינות, אם הוגדר) ב-/crm - פונקציה נפרדת מהיומן
   ----------------------------------------------------------------------------
   ‏**למה נפרדת:** ‏crm-request-log.ts היא יומן שאינו משנה את התשובה. חסימה היא
   החלטה אחרת, ותקלה בה אסור שתפיל את הרישום - ואם צריך לכבות אותה, מוחקים
   קובץ אחד. ‏**השם ‏zguard בכוונה:** ‏Netlify מריצה פונקציות לפי סדר השם,
   והיומן (‏crm-request-log) רץ ראשון ולכן רואה את ה-403 של החסימה. אם הסדר
   היה הפוך החסימות פשוט לא היו נרשמות - לא נשבר דבר.
   ‏**בכל כשל בבדיקה עצמה הדף עובר** (‏fail-open): קודם כול /crm נטען.
   ‏docs/crm-request-log.md, "חסימת סורקים".
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { blockReason, FORBIDDEN_HTML } from "./lib/crm-guard.ts";

function geoAllow(): string {
  try {
    return (globalThis as { Netlify?: { env?: { get(k: string): string | undefined } } })
      .Netlify?.env?.get("CRM_GEO_ALLOW") || "";
  } catch {
    return "";
  }
}

export default async (req: Request, context: Context) => {
  let reason: string | null = null;
  try {
    reason = blockReason({
      userAgent: req.headers.get("user-agent"),
      country: context.geo?.country?.code,
      geoAllow: geoAllow(),
    });
  } catch {
    reason = null;
  }
  if (!reason) return context.next();
  return new Response(FORBIDDEN_HTML, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config: Config = {
  path: ["/crm", "/crm.html", "/crm/*"],
};
