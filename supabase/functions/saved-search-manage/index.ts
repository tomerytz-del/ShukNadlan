import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// הקישורים שבתוך ההתראה — קליק והפסקת התראות.
//
// שתי פעולות שנראות שונות אבל הן אותו דבר: כתובת GET שמחפש/ת דירה לוחצ/ת
// עליה מתוך וואטסאפ או מייל, בלי חשבון ובלי התחברות. הטוקן הוא ההרשאה —
// הוא הגיע להם בהודעה ששלחנו אליהם.
//
//   ‏?action=click&token=…        → מונה קליק ומפנה לעמוד הנכס
//   ‏?action=unsubscribe&token=…  → עמוד אישור עם כפתור "עצירת ההתראות"
//   ‏(POST) action=unsubscribe|pause|resume → הביצוע בפועל
//
// ‏למה ביטול דורש POST ולא רק לחיצה על הקישור: סורקי קישורים של ספקי מייל
// ושל וואטסאפ פותחים כל URL שבהודעה כדי לייצר תצוגה מקדימה. ‏GET שמבטל היה
// מבטל את ההתראות של כל מי שההודעה שלו נסרקה, בלי שנגע/ה בכלום. ‏GET מציג
// עמוד, והכפתור שבו הוא ששולח את הפעולה.
//
// ‏פרוסה עם --no-verify-jwt: הקורא/ת הוא אדם בדפדפן בלי חשבון.
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

const ACTIONS = ["unsubscribe", "pause", "resume"];

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const token = url.searchParams.get("token") || "";

  if (!token) return page("קישור לא תקין", "<h1>קישור לא תקין</h1><p>חסר מזהה בכתובת.</p>", 400);

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // ---- קליק: ספירה והפניה -------------------------------------------------
  if (action === "click") {
    const { data: propertyId, error } = await sb.rpc("click_saved_search_alert", {
      p_token: token,
    });

    // ‏כישלון בספירה לא ימנע מאדם להגיע לנכס שרצה לראות. המדידה משרתת
    // אותנו, לא אותו/ה, ולכן היא זו שמוותרת.
    if (error) console.error("click count failed", error.message);

    if (!propertyId) {
      const home = SITE_BASE_URL || "/";
      return page("הנכס לא נמצא",
        `<h1>הנכס כבר לא זמין</h1><p>ייתכן שהמודעה הוסרה.</p>
         <a class="btn primary" href="${esc(home)}">לעמוד הבית</a>`, 404);
    }

    const target = SITE_BASE_URL
      ? `${SITE_BASE_URL}/property.html?id=${encodeURIComponent(String(propertyId))}`
      : `/property.html?id=${encodeURIComponent(String(propertyId))}`;
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": "no-store" },
    });
  }

  if (!ACTIONS.includes(action)) {
    return page("פעולה לא מוכרת", "<h1>פעולה לא מוכרת</h1><p>הקישור אינו תקין.</p>", 400);
  }

  // ---- GET: עמוד אישור, בלי לשנות דבר -------------------------------------
  if (req.method === "GET") {
    const labels: Record<string, [string, string, string]> = {
      unsubscribe: ["הפסקת ההתראות", "לא תקבלו יותר התראות על החיפוש הזה.", "עצירת ההתראות"],
      pause: ["השהיית ההתראות", "ההתראות יושהו עד שתחדשו אותן.", "השהיה"],
      resume: ["חידוש ההתראות", "נחזור לשלוח לכם נכסים שמתאימים לחיפוש.", "חידוש"],
    };
    const [title, sub, cta] = labels[action];
    return page(title, `
      <h1>${esc(title)}</h1>
      <p>${esc(sub)}</p>
      <form method="POST">
        <div class="row">
          <button class="primary" type="submit">${esc(cta)}</button>
          ${SITE_BASE_URL ? `<a class="btn ghost" href="${esc(SITE_BASE_URL)}">חזרה לאתר</a>` : ""}
        </div>
      </form>
      <p class="muted">הפעולה מתבצעת רק בלחיצה על הכפתור.</p>`);
  }

  if (req.method !== "POST") {
    return page("שיטה לא נתמכת", "<h1>שיטה לא נתמכת</h1>", 405);
  }

  // ---- POST: הביצוע --------------------------------------------------------
  const { data: result, error } = await sb.rpc("manage_saved_search", {
    p_token: token,
    p_action: action,
  });

  if (error) {
    return page("שגיאה", "<h1>משהו השתבש</h1><p>נסו שוב בעוד רגע.</p>", 500);
  }
  if (result?.error === "not_found") {
    return page("קישור לא תקין", "<h1>קישור לא תקין</h1><p>ייתכן שהחיפוש כבר נמחק.</p>", 404);
  }
  if (result?.error === "already_unsubscribed") {
    return page("ההתראות כבר הופסקו",
      "<h1>ההתראות כבר הופסקו</h1><p>לקבלת התראות שוב, שמרו חיפוש חדש באתר.</p>");
  }
  if (result?.error) {
    return page("שגיאה", "<h1>משהו השתבש</h1><p>נסו שוב בעוד רגע.</p>", 400);
  }

  const done: Record<string, [string, string]> = {
    unsubscribed: ["ההתראות הופסקו", "לא נשלח לכם יותר התראות על החיפוש הזה."],
    paused: ["ההתראות הושהו", "אפשר לחדש אותן בכל עת."],
    active: ["ההתראות חודשו", "נחזור לשלוח לכם נכסים שמתאימים."],
  };
  const [title, sub] = done[result.status] ?? ["בוצע", ""];
  return page(title, `
    <h1>${esc(title)}</h1>
    <p>${esc(sub)}</p>
    ${result.label ? `<p class="muted">${esc(result.label)}</p>` : ""}
    ${SITE_BASE_URL ? `<a class="btn primary" href="${esc(SITE_BASE_URL)}">חזרה לאתר</a>` : ""}`);
});
