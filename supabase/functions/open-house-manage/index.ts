import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// הקישור שבתחתית כל מייל של יריד הבתים הפתוחים — הסרה וחזרה.
//
//   ‏?action=unsubscribe&token=…  → עמוד אישור עם כפתור "הסרה מהרשימה"
//   ‏?action=resubscribe&token=…  → הדרך היחידה לחזור לרשימה אחרי הסרה
//   ‏(POST) אותה פעולה            → הביצוע בפועל
//
// **למה ביטול דורש POST ולא רק לחיצה על הקישור:** סורקי קישורים של ספקי
// מייל פותחים כל URL שבהודעה כדי לייצר תצוגה מקדימה. ‏GET שמסיר היה מסיר את
// כל מי שההודעה שלו נסרקה, בלי שנגע בכלום. ‏GET מציג עמוד, והכפתור שולח.
// זו אותה החלטה בדיוק כמו ב-saved-search-manage.
//
// **הטוקן הוא ההרשאה.** אין כאן חשבון ואין התחברות — הוא הגיע לנרשם/ת
// בהודעה ששלחנו אליו/ה, והוא מזהה שורה אחת בלבד.
//
// ‏resubscribe קיים כאן ולא בטופס ההרשמה מסיבה אחת: ‏open-house-subscribe
// **לא** מחזיר לרשימה מי שביקש/ה לצאת, כדי שכתובת שמישהו הקליד לא תחזיר
// אדם שביקש לצאת. הדרך לחזור היא הקישור הזה, שנמצא רק אצלו/ה.
//
// ‏פרוסה עם verify_jwt=false: הקורא/ת הוא אדם בדפדפן בלי חשבון.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** עמוד עברית מינימלי — אין כאן אתר, רק תשובה קצרה למי שלחצ/ה. */
function page(title: string, bodyHtml: string, status = 200) {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
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
  .ghost{background:#fff;color:#1B2A41;border:1.5px solid #D9D3C8}
  .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  .muted{font-size:13px;color:#98A2B0;margin-top:16px}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const ACTIONS = ["unsubscribe", "resubscribe"];
const fairUrl = () => (SITE_BASE_URL ? `${SITE_BASE_URL}/open-house.html` : "");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const token = url.searchParams.get("token") || "";

  if (!token) return page("קישור לא תקין", "<h1>קישור לא תקין</h1><p>חסר מזהה בכתובת.</p>", 400);
  if (!ACTIONS.includes(action)) {
    return page("פעולה לא מוכרת", "<h1>פעולה לא מוכרת</h1><p>הקישור אינו תקין.</p>", 400);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // ---- GET: עמוד אישור, בלי לשנות דבר -------------------------------------
  if (req.method === "GET") {
    const labels: Record<string, [string, string, string]> = {
      unsubscribe: [
        "הסרה מעדכוני היריד",
        "לא נשלח אליך יותר עדכונים על נכסים שנכנסים ליריד הבתים הפתוחים.",
        "הסרה מהרשימה",
      ],
      resubscribe: [
        "חזרה לעדכוני היריד",
        "נחזור לעדכן אותך ברגע שנכס נכנס ליריד הבתים הפתוחים.",
        "חזרה לרשימה",
      ],
    };
    const [title, sub, cta] = labels[action];
    return page(title, `
      <h1>${esc(title)}</h1>
      <p>${esc(sub)}</p>
      <form method="POST">
        <div class="row">
          <button class="primary" type="submit">${esc(cta)}</button>
          ${fairUrl() ? `<a class="btn ghost" href="${esc(fairUrl())}">חזרה ליריד</a>` : ""}
        </div>
      </form>
      <p class="muted">הפעולה מתבצעת רק בלחיצה על הכפתור.</p>`);
  }

  if (req.method !== "POST") return page("שיטה לא נתמכת", "<h1>שיטה לא נתמכת</h1>", 405);

  // ---- POST: הביצוע --------------------------------------------------------
  const { data: row, error: readError } = await sb
    .from("open_house_subscribers")
    .select("id, email, unsubscribed_at")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (readError) {
    console.error("open house manage lookup failed", readError);
    return page("שגיאה", "<h1>משהו השתבש</h1><p>נסו שוב בעוד רגע.</p>", 500);
  }
  if (!row) {
    return page("קישור לא תקין", "<h1>קישור לא תקין</h1><p>ייתכן שההרשמה כבר נמחקה.</p>", 404);
  }

  if (action === "unsubscribe") {
    if (row.unsubscribed_at) {
      return page("כבר הוסרת", `
        <h1>כבר הוסרת מהרשימה</h1>
        <p>לא נשלחים אליך עדכוני יריד.</p>
        ${fairUrl() ? `<a class="btn ghost" href="${esc(fairUrl())}">חזרה ליריד</a>` : ""}`);
    }
    const { error } = await sb
      .from("open_house_subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      console.error("open house unsubscribe failed", error);
      return page("שגיאה", "<h1>משהו השתבש</h1><p>נסו שוב בעוד רגע.</p>", 500);
    }
    return page("הוסרת מהרשימה", `
      <h1>הוסרת מהרשימה</h1>
      <p>לא נשלח אליך יותר עדכונים על יריד הבתים הפתוחים. אפשר לחזור בכל רגע מהקישור הזה.</p>
      ${fairUrl() ? `<a class="btn primary" href="${esc(fairUrl())}">חזרה ליריד</a>` : ""}`);
  }

  // resubscribe — והסמן מתאפס לעכשיו: מי שחוזר/ת אינו/ה מקבל/ת את כל מה
  // שהיה ביריד בזמן שלא היה/תה ברשימה
  const { error } = await sb
    .from("open_house_subscribers")
    .update({ unsubscribed_at: null, last_notified_at: new Date().toISOString(), last_error: null })
    .eq("id", row.id);
  if (error) {
    console.error("open house resubscribe failed", error);
    return page("שגיאה", "<h1>משהו השתבש</h1><p>נסו שוב בעוד רגע.</p>", 500);
  }
  return page("חזרת לרשימה", `
    <h1>חזרת לרשימה</h1>
    <p>נעדכן אותך ברגע שנכס נכנס ליריד הבתים הפתוחים.</p>
    ${fairUrl() ? `<a class="btn primary" href="${esc(fairUrl())}">לצפייה ביריד</a>` : ""}`);
});
