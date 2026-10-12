/* ============================================================================
   קישור קצר לשליחת המיניסייט — ‏/w/<token>?n=<שם פרטי>&to=<טלפון>
   ----------------------------------------------------------------------------
   ‏גבריאלה נותנת לסוכן/ת קישור שפותח וואטסאפ עם הודעת הפתיחה מוכנה. עד
   12.10.2026 זה היה ‏wa.me/?text= עם כל ההודעה מקודדת — כ-1,500 תווים של
   ‏%D7%…, כי כל אות עברית היא שישה תווים בקידוד. וואטסאפ באייפון הפך ללחיץ
   רק את תחילת הכתובת, והלחיצה פתחה הודעה קטועה או כלום.

   ‏כאן הכתובת קצרה (כ-110 תווים), וההודעה נבנית בשרת ברגע הלחיצה. אין
   פנייה למסד: הטוקן הוא כל מה שצריך כדי לבנות את הקישור למיניסייט, השם
   הפרטי מגיע בפרמטר, וכך גם הטלפון של הלקוח/ה (בלעדיו — בורר הצ'אטים).

   ‏**הנוסח — אותו נוסח של showcaseMessage ב-whatsapp-webhook/agent.ts ושל
   renderShowcaseShare ב-assets/crm-showcase.js.** מי שמשנה אחד משנה את
   שלושתם.

   ‏no-store: הקישור נלחץ פעם או פעמיים, ואין סיבה שדפדפן ישמור אותו. מה שחוזר
   ‏(דף שפותח את וואטסאפ ביזנס באנדרואיד, ‏302 במחשב) - lib/wa-open.ts.
   ‏טוקן שאינו בצורה הנכונה מפנה לדף הבית. הפרטים: docs/client-showcase.md.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { waOpenResponse } from "./lib/wa-open.ts";

/** אותו נוסח של showcaseMessage ב-whatsapp-webhook/agent.ts. */
function showcaseMessage(firstName: string, link: string): string {
  return `היי ${firstName}, ריכזתי בשבילך עמוד אישי עם הנכסים שמתאימים למה שחיפשת:\n${link}\n\n` +
    "הקישור הזה שלך וזמין תמיד - אפשר לחזור אליו מתי שנוח, לראות את הנכסים שמעניינים אותך, " +
    "לסמן מה אהבת ומה לא, לשאול על כל נכס ולבקש סיור. נכסים חדשים שאמצא יתווספו לאותו עמוד.\n\n" +
    "רוצה להתייעץ? אפשר לשתף את העמוד עם בן/בת הזוג או המשפחה, והם יראו בדיוק את מה שאת/ה רואה.";
}

/** שם פרטי בלבד: אותיות, רווח, גרש ומקף, עד 30 תווים — כדי שהקישור לא
 *  ישמש לכתיבת טקסט שרירותי בתוך הודעה שנראית כמו שלנו. */
function cleanName(raw: string | null): string {
  return String(raw || "").replace(/[^\p{L}\s'׳"״-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
}

export default (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/w\/([0-9a-f]{32,64})\/?$/);
  if (!m) return Response.redirect(new URL("/", url), 302);

  const name = cleanName(url.searchParams.get("n"));
  const to = (url.searchParams.get("to") || "").replace(/\D/g, "");
  const link = `${url.origin}/showcase?t=${m[1]}`;
  const message = showcaseMessage(name, link).replace(/^היי , /, "היי, ");
  // אנדרואיד - וואטסאפ ביזנס ישירות, אייפון - whatsapp://, מחשב - wa.me (lib/wa-open.ts)
  return waOpenResponse(req, /^\d{9,15}$/.test(to) ? to : "", message);
};

export const config: Config = {
  path: "/w/*",
};
