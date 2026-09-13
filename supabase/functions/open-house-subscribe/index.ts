import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";

// ============================================================================
// הרשמה להתראות יריד הבתים הפתוחים — הטופס בדף היריד.
//
// אותה תבנית בדיוק של newsletter-subscribe: הקורא/ת הוא מבקר/ת אנונימי/ת עם
// ה-anon key, והכתיבה נעשית ב-service_role כי open_house_subscribers סגורה
// ל-anon לגמרי (אימייל של אדם פרטי).
//
// שלושת הכללים של רשימת דיוור, זהים לשם:
//
//   1. **נרמול האימייל** — ‏`Tomer@X.com` ו-`tomer@x.com` הם אותו אדם.
//   2. **הרשמה חוזרת אינה שגיאה** — מבחינת הנרשם/ת הוא/היא רשום/ה, וזו
//      האמת. ‏duplicate=true, לא 409 שמופיע בממשק כתקלה.
//   3. **בקשת הסרה קודמת להרשמה** — שורה עם unsubscribed_at לא מתאפסת כאן.
//      חזרה לרשימה נעשית מקישור ההסרה שבמייל בלבד.
//
// ומה שהוא **לא** משם: מייל אישור יוצא מיד. רשימת תפוצה שולחת סיכום
// תקופתי, וזו עשויה לשתוק שבועיים עד שנכס ייכנס ליריד — בלי אישור מיידי
// אין לנרשם/ת שום דרך לדעת שההרשמה נקלטה, ובלי קישור ההסרה שבתוכו אין לו/ה
// דרך לצאת. המייל נשלח **אחרי** שהשורה נשמרה ולא לפניה, וכישלון שלו אינו
// מכשיל את ההרשמה: אדם שנרשם/ה נשאר/ת ברשימה גם כשספק המייל נופל.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_BASE = `${supabaseUrl}/functions/v1`;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");

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

// אותו כלל של newsletter-subscribe: הערך מגיע מהדפדפן ונכנס לדוחות, ולכן
// הוא חסום לצורה אחת — אותיות קטנות וקו תחתון. רשימה סגורה של מקורות הייתה
// מחייבת פריסה מחדש בכל פעם שנוסף מקום שמציג את הטופס.
const SOURCE_RE = /^[a-z][a-z0-9_]{2,39}$/;
const DEFAULT_SOURCE = "open_house_page";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const unsubUrl = (token: string) =>
  `${FUNCTIONS_BASE}/open-house-manage?action=unsubscribe&token=${encodeURIComponent(token)}`;
const fairUrl = () => (SITE_BASE_URL ? `${SITE_BASE_URL}/open-house.html` : "");

/* מייל האישור. הוא אומר בדיוק שלושה דברים — מה נרשמת לקבל, מה קורה עכשיו,
   ואיך יוצאים — כי אלה שלושת הדברים שמי שרק מסר/ה כתובת רוצה לדעת. */
function welcomeEmail(liveCount: number, token: string) {
  const link = fairUrl();
  const now = liveCount > 0
    ? `כרגע יש ביריד ${liveCount === 1 ? "נכס אחד" : `${liveCount} נכסים`}.`
    : "כרגע היריד שקט — נעדכן אותך ברגע שייכנס אליו נכס.";

  const text = [
    "נרשמת לעדכוני יריד הבתים הפתוחים",
    "",
    "מעכשיו נעדכן אותך ברגע שמתווך/ת מכניס/ה נכס ליריד — כלומר מציע/ה אותו לקונים ללא עמלת תיווך, לתקופה קצובה.",
    now,
    link ? `לצפייה ביריד: ${link}` : "",
    "",
    `להסרה מהרשימה: ${unsubUrl(token)}`,
  ].filter(Boolean).join("\n");

  const html = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<body style="margin:0;background:#F5F3EF;font-family:Arial,Helvetica,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:22px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:#C8102E">יריד הבתים הפתוחים</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35">נרשמת — ותהיה/י מהראשונים לדעת</h1>
      <p style="margin:0 0 12px;color:#5A6675;font-size:15px;line-height:1.6">
        ברגע שמתווך/ת מכניס/ה נכס ליריד — כלומר מציע/ה אותו לקונים <b>ללא עמלת תיווך</b>
        לתקופה קצובה — יוצא אליך מייל. ${esc(now)}
      </p>
      ${link ? `<a href="${esc(link)}" style="display:inline-block;background:#C8102E;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:15px">לצפייה בנכסים שביריד</a>` : ""}
    </div>
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center">
      קיבלת את ההודעה כי נרשמת לעדכוני יריד הבתים הפתוחים בשוק נדל״ן.<br>
      <a href="${esc(unsubUrl(token))}" style="color:#98A2B0">הסרה מהרשימה</a>
    </p>
  </div>
</body></html>`;

  return { subject: "נרשמת לעדכוני יריד הבתים הפתוחים · שוק נדל״ן", html, text };
}

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
  // בשגיאת אילוץ
  if (email.length < 6 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }
  const rawSource = String(body.source ?? "");
  const source = SOURCE_RE.test(rawSource) ? rawSource : DEFAULT_SOURCE;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // בדיקה לפני ההכנסה ולא רק תפיסת שגיאת unique: כך אפשר להבדיל בין "כבר
  // רשום/ה" לבין "ביקש/ה להסיר את עצמו/ה", ולא לדרוס את השנייה
  const { data: existing, error: readError } = await supabase
    .from("open_house_subscribers")
    .select("id, unsubscribed_at")
    .eq("email", email)
    .maybeSingle();
  if (readError) {
    console.error("open house subscriber lookup failed", readError);
    return json({ error: "server_error" }, 500);
  }
  if (existing) return json({ success: true, duplicate: true });

  const { data: inserted, error: insertError } = await supabase
    .from("open_house_subscribers")
    .insert({ email, source })
    .select("unsubscribe_token")
    .single();

  if (insertError) {
    // מרוץ בין שתי לחיצות על אותו טופס — השנייה מגיעה לכאן אחרי שהראשונה
    // כבר הכניסה את השורה. מבחינת הנרשם/ת שתיהן הצליחו.
    if ((insertError as any).code === "23505") return json({ success: true, duplicate: true });
    console.error("open house subscribe failed", insertError);
    return json({ error: "server_error" }, 500);
  }

  // כמה נכסים ביריד *עכשיו* — אותו תנאי שהאתר בודק: דגל דלוק וחלון שמכיל
  // את הרגע הזה. ‏head:true, כלומר ספירה בלי שורות.
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("open_house", true)
    .lte("open_house_start", nowIso)
    .gt("open_house_end", nowIso);

  const mail = welcomeEmail(count ?? 0, String(inserted.unsubscribe_token));
  const result = await sendPlatformEmail({ to: [email], ...mail });
  // כישלון משלוח נרשם ואינו מוחזר כשגיאה: ההרשמה נקלטה, והעדכון הבא יצא
  // מ-open-house-notify בלי קשר למייל האישור הזה.
  if (!result.sent) console.error("open house welcome mail failed", result.error);

  return json({ success: true, duplicate: false, welcome_sent: result.sent });
});
