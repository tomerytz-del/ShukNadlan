import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyUnsubToken } from "../_shared/onboarding-unsub.ts";

// ============================================================================
// הסרה מתזכורות מדריך ההתחלה (יזמים ובעלי מקצוע) - הקישור בתחתית כל מייל תזכורת
//
//   ‏GET ?t=…   → עמוד אישור עם כפתור "להסרה מהתזכורות". לא משנה דבר.
//   ‏POST ?t=…  → הביצוע: מסמן את שתי התזכורות כנשלחו.
//
// **למה ההסרה דורשת POST ולא רק לחיצה:** סורקי קישורים של ספקי מייל פותחים כל כתובת שבהודעה. ‏GET
// שמסיר היה מסיר כל מי שההודעה שלו נסרקה, בלי שנגע בכלום. אותה החלטה כמו ב-open-house-manage.
//
// **ההרשאה היא חתימת HMAC בטוקן (hmac)** (‏_shared/onboarding-unsub.ts), בלי עמודת טוקן ובלי כניסה. הטוקן מזהה
// שורה אחת בלבד. פרוסה עם verify_jwt=false: הקורא/ת הוא אדם בדפדפן בלי חשבון.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function page(title: string, bodyHtml: string, status = 200) {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F3EF;
       font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1B2A41;padding:24px}
  .card{background:#fff;border:1px solid #E4DFD6;border-radius:16px;padding:28px;max-width:440px;width:100%;
        text-align:center;box-shadow:0 8px 28px rgba(27,42,65,.07)}
  h1{font-size:20px;margin:0 0 10px}
  p{color:#5A6675;line-height:1.6;margin:0 0 18px;font-size:15px}
  button,a.btn{display:inline-block;border:0;border-radius:10px;padding:13px 24px;font-size:15px;
        cursor:pointer;text-decoration:none;font-family:inherit}
  .primary{background:#1B2A41;color:#fff}
  .muted{font-size:13px;color:#98A2B0;margin-top:16px}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const who = await verifyUnsubToken(token);
  if (!who) {
    return page("קישור לא תקין", "<h1>קישור לא תקין</h1><p>ייתכן שהקישור נחתך. אפשר לכתוב לנו ונסיר ידנית.</p>", 400);
  }

  if (req.method === "GET") {
    return page("הסרה מתזכורות", `
      <h1>הסרה מתזכורות להשלמת העמוד</h1>
      <p>לא נשלח לכם יותר תזכורות על השלמת העמוד. אפשר להמשיך להשלים אותו בכל זמן.</p>
      <form method="POST"><button class="primary" type="submit">להסרה מהתזכורות</button></form>
      <p class="muted">ההסרה מתבצעת רק בלחיצה על הכפתור.</p>`);
  }
  if (req.method !== "POST") return page("שיטה לא נתמכת", "<h1>שיטה לא נתמכת</h1>", 405);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  // מסמנים את שתי התזכורות כנשלחו (p_no = 2): אותו מנגנון שמסמן מי שהשלים את המדריך
  const { error } = who.kind === "developer"
    ? await sb.rpc("mark_developer_onboarding_reminder", { p_developer_id: who.id, p_no: 2 })
    : await sb.rpc("mark_professional_onboarding_reminder", { p_placement_id: who.id, p_no: 2 });
  if (error) {
    console.error("onboarding-reminders-unsubscribe failed", who.kind, error.message);
    return page("שגיאה", "<h1>משהו השתבש</h1><p>נסו שוב בעוד רגע.</p>", 500);
  }
  return page("הוסרתם מהתזכורות", `
    <h1>הוסרתם מהתזכורות</h1>
    <p>לא נשלח לכם יותר תזכורות על השלמת העמוד.</p>
    <a class="btn primary" href="${esc(SITE_BASE_URL)}">לאתר</a>`);
});
