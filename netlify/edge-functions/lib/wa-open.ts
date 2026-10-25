/* ============================================================================
   פתיחת וואטסאפ עם הודעה מוכנה - משותף ל-/w/ (showcase-send.ts) ול-/wa/
   (wa-share.ts).
   ----------------------------------------------------------------------------
   ‏עד 12.10.2026 שתיהן החזירו ‏302 ל-wa.me. ‏באנדרואיד הכפתור בוואטסאפ פותח
   את הקישור בדפדפן הפנימי, ו-wa.me נעצר שם על דף "צ'אט ב-WhatsApp" עם כפתור
   "פתיחת האפליקציה" - שפותח את וואטסאפ **הרגיל**, בזמן שהסוכנים עובדים מוואטסאפ
   **ביזנס**.

   ‏לכן באנדרואיד מוחזר דף קטן שמנווט מיד ל-`intent://` עם
   ‏`package=com.whatsapp.w4b` - וואטסאפ ביזנס ישירות. ‏`browser_fallback_url` הוא
   wa.me, כך שמי שאין לו/ה ביזנס מגיע/ה לוואטסאפ הרגיל. בדף עצמו שני כפתורים,
   למקרה שהדפדפן חסם את הניווט בלי לחיצה. ‏באייפון אין דרך לבחור בין שתי
   האפליקציות מקישור (שתיהן רושמות את אותו `whatsapp://`), ולכן שם - כפתור
   ל-`whatsapp://send` ו-wa.me כגיבוי. ‏מחשב - ‏302 ל-wa.me כמו קודם.

   ‏הדף אינו נסרק (noindex) ואינו נשמר (no-store): הוא נושא את ההודעה ללקוח/ה.
   ========================================================================== */

const BUSINESS = "com.whatsapp.w4b";
const PERSONAL = "com.whatsapp";

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** wa.me - הכתובת הרגילה, וגם הגיבוי של כל השאר. */
export function waMeUrl(to: string, text: string): string {
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

function intentUrl(to: string, text: string, pkg: string): string {
  const q = `${to ? `phone=${to}&` : ""}text=${encodeURIComponent(text)}`;
  return `intent://send?${q}#Intent;scheme=whatsapp;package=${pkg};` +
    `S.browser_fallback_url=${encodeURIComponent(waMeUrl(to, text))};end`;
}

/**
 * התשובה ל-/w/ ול-/wa/. ‏`to` - ספרות בלבד או מחרוזת ריקה (בורר הצ'אטים).
 */
export function waOpenResponse(req: Request, to: string, text: string): Response {
  const ua = req.headers.get("user-agent") || "";
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const fallback = waMeUrl(to, text);

  if (!android && !ios) {
    return new Response(null, { status: 302, headers: { Location: fallback, "Cache-Control": "no-store" } });
  }

  const primary = android
    ? intentUrl(to, text, BUSINESS)
    : `whatsapp://send?${to ? `phone=${to}&` : ""}text=${encodeURIComponent(text)}`;
  const buttons = android
    ? `<a class="b" href="${escAttr(primary)}">פתיחה ב-WhatsApp Business</a>
<a class="s" href="${escAttr(intentUrl(to, text, PERSONAL))}">פתיחה ב-WhatsApp רגיל</a>`
    : `<a class="b" href="${escAttr(primary)}">פתיחה ב-WhatsApp</a>
<a class="s" href="${escAttr(fallback)}">לא נפתח? דרך wa.me</a>`;

  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>פותח את WhatsApp</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#f6f4ee;color:#1f2a24;
display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:360px;width:100%;padding:24px 16px;text-align:center}
p{margin:0 0 20px;font-size:17px}
a{display:block;padding:14px;border-radius:12px;text-decoration:none;font-size:17px;margin:10px 0}
.b{background:#25d366;color:#08331a;font-weight:700}
.s{background:#fff;color:#1f2a24;border:1px solid #d6d2c4}
</style></head><body><main>
<p>פותח את WhatsApp עם ההודעה מוכנה...</p>
${buttons}
</main>
<script>setTimeout(function(){location.href=${JSON.stringify(primary).replace(/</g, "\\u003c")};},50);</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
