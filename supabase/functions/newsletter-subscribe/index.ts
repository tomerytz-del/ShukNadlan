import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// הרשמה לרשימת התפוצה — הטופס שבפוטר של דף הבית.
//
// אותה תבנית כמו saved-search-intake ו-mortgage-lead-intake: הקורא/ת הוא
// מבקר/ת אנונימי/ת עם ה-anon key, והכתיבה נעשית ב-service_role כי
// ‏newsletter_subscribers סגורה ל-anon לגמרי (אימייל של אדם פרטי).
//
// שלושה דברים שאי אפשר לסמוך על הדפדפן בהם:
//
//   1. **נרמול האימייל.** ‏`Tomer@X.com` ו-`tomer@x.com` הם אותו אדם. בלי
//      lower() היו שתי שורות, שני מיילים בכל דיוור, ו-CHECK שנופל.
//   2. **הרשמה חוזרת אינה שגיאה.** מבחינת הנרשם/ת הוא/היא רשום/ה — וזו
//      האמת. מחזירים success עם duplicate=true, כמו ב-intake של לידי
//      המשכנתאות, ולא 409 שמופיע בממשק כתקלה.
//   3. **בקשת הסרה קודמת להרשמה.** שורה עם unsubscribed_at לא מתאפסת כאן:
//      אדם שביקש לצאת לא חוזר לרשימה כי מישהו הקליד את הכתובת שלו שוב.
//      ביטול הסרה נעשה מקישור ההסרה שבמייל בלבד.
//
// אין כאן ניתוב לסוכן/ת, אין מדף ואין מה למכור: זו רשימת דיוור, לא ליד.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

// מקורות מוכרים בלבד. הערך מגיע מהדפדפן, והוא נכנס לדוחות — טקסט חופשי כאן
// היה מאפשר לזהם את העמודה מבחוץ.
const SOURCES = ["homepage_footer", "faq_page", "agency_page", "article_page"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  // אותה בדיקה כמו ה-CHECK במסד, כדי שכתובת פסולה תיעצר בהודעה מובנת ולא
  // בשגיאת אילוץ.
  if (email.length < 6 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }
  const source = SOURCES.includes(body.source) ? body.source : "homepage_footer";

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // בדיקה לפני ההכנסה ולא רק תפיסת שגיאת unique: כך אפשר להבדיל בין "כבר
  // רשום/ה" לבין "ביקש/ה להסיר את עצמו/ה", ולא לדרוס את השנייה.
  const { data: existing, error: readError } = await supabase
    .from("newsletter_subscribers")
    .select("id, unsubscribed_at")
    .eq("email", email)
    .maybeSingle();
  if (readError) {
    console.error("newsletter lookup failed", readError);
    return json({ error: "server_error" }, 500);
  }
  if (existing) return json({ success: true, duplicate: true });

  const { error } = await supabase
    .from("newsletter_subscribers")
    .insert({ email, source });

  if (error) {
    // מרוץ בין שתי לחיצות על אותה כתובת: השנייה מגיעה לכאן עם 23505, וזו
    // עדיין הרשמה מוצלחת מבחינת הנרשם/ת.
    if ((error as { code?: string }).code === "23505") {
      return json({ success: true, duplicate: true });
    }
    console.error("newsletter insert failed", error);
    return json({ error: "server_error" }, 500);
  }

  return json({ success: true, duplicate: false });
});
