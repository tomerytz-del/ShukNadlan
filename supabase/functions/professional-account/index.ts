import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { announceProfessionalAccount } from "../_shared/platform-signup-alert.ts";

// ============================================================================
// פתיחת חשבון כניסה לבעל/ת מקצוע שכבר יש לו/ה כרטיסייה
//
// ## הבעיה
// בעלי מקצוע (עו"ד, יועץ משכנתאות, שמאי) נרשמים בכרטיסייה ונכנסים לעריכה בקישור עם
// אסימון (professional-manage), בלי התחברות ובלי ארנק. מדף הלידים של עורכי הדין צריך
// ארנק, וחשבון CRM דורש מספר רישיון תיווך שלעו"ד אין. לכן חשבון נפרד, professional_accounts
// (docs/professional-accounts.md), כמו שליזמים יש developers ולא agency_members.
//
// ## ההרשאה: האסימון שבקישור העריכה
// מי שמחזיק/ה באסימון הוא/היא בעל/ת הכרטיסייה, ולכן רשאי/ת לפתוח לה חשבון. האסימון
// בגוף הבקשה (UUID שאי אפשר לנחש), והחיפוש רק מול ad_placement_access ב-service_role.
// כתובת הכניסה היא ה-contact_email שנרשם בכרטיסייה ולא כתובת שהוקלדה כאן: טעות הקלדה
// הייתה יוצרת חשבון בלי דרך לאפס סיסמה.
//
// ## אימות המייל: הזמנה, לא סיסמה שמוקלדת כאן
// האסימון מוחזר לטופס ההרשמה ולא רק נשלח למייל, ולכן מי שהגיש/ה כרטיסייה עם כתובת של אדם אחר
// מחזיק/ה בו. לכן אין כאן `email_confirm: true` וסיסמה שהוא/היא בחר/ה (כמו שעושים agency-signup
// ו-developer-signup, שם הכתובת היא של מי שמקליד/ה): המשתמש נוצר ב-`inviteUserByEmail`, המייל נשלח
// לכתובת שבכרטיסייה, והסיסמה נקבעת רק אחרי הלחיצה על הקישור (professional-crm). בלי לחיצה אי אפשר
// להיכנס, ולכן אין ארנק ואין מדף. כתובת שלא אושרה לא נשארת תפוסה: בקשה חוזרת (אחרי דקה) מוחקת את
// המשתמש שלא אושר (אי אפשר היה להיכנס אליו, ואין בו יתרה) ושולחת הזמנה חדשה.
//
// ## מה נוצר, ומה לא
// נוצרים משתמש (auth), ושורת professional_accounts עם kind מהכרטיסייה, עיר מ-target_region
// וארנק ריק. **shelf_enabled נשאר false:** מי שרשאי/ת לראות ולקנות לידים נקבע על ידי מנהל/ת
// הפלטפורמה, וההתראה אליו/ה אומרת זאת. חשבון אחד לכרטיסייה (unique(card_id)).
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
// הבקשה החוזרת לא תשלח מייל נוסף לכתובת לפני שעברה דקה מההזמנה האחרונה (גם מגבלת המייל של Supabase)
const RESEND_AFTER_MS = 60_000;

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ‏manage_link: חשבון מחובר מקבל את קישור עריכת הכרטיסייה שלו, כדי שלא יצטרך לשמור את
  // הקישור המקורי. האסימון יושב ב-ad_placement_access (נגיש ל-service_role בלבד), ולכן
  // הוא יוצא רק לבעל החשבון, לפי ה-JWT ולא לפי גוף הבקשה.
  if (body.action === "manage_link") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_authorization" }, 401);
    const authed = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const { data: acct } = await supabase
      .from("professional_accounts").select("card_id").eq("user_id", userData.user.id).maybeSingle();
    if (!acct?.card_id) return json({ error: "no_card" }, 404);
    const { data: acc } = await supabase
      .from("ad_placement_access").select("manage_token").eq("placement_id", acct.card_id).maybeSingle();
    if (!acc) return json({ error: "no_card" }, 404);
    return json({ url: "/professional-manage?token=" + encodeURIComponent(acc.manage_token) });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!UUID_RE.test(token)) return json({ error: "invalid_token" }, 400);
  // התנאים נאכפים בשרת ולא בתיבת סימון בדפדפן (כמו בשאר ההרשמות)
  if (body.terms_accepted !== true) {
    return json({ error: "terms_not_accepted", detail: "פתיחת החשבון מותנית באישור תנאי השימוש" }, 400);
  }

  const { data: access } = await supabase
    .from("ad_placement_access").select("placement_id").eq("manage_token", token).maybeSingle();
  if (!access) return json({ error: "invalid_token" }, 404);

  const { data: card } = await supabase
    .from("ad_placements")
    .select("id, advertiser_name, business_name, advertiser_type, contact_email, phone_e164, target_region, status, placement_type")
    .eq("id", access.placement_id).maybeSingle();
  if (!card) return json({ error: "card_not_found" }, 404);
  // רק כרטיסיית בעל מקצוע חיה או ממתינה לאישור: אסימון של כרטיסייה שהוסרה או שאינה של בעל מקצוע
  // אינו פותח ארנק
  if (card.placement_type !== "professional_card" || !["active", "pending_approval"].includes(card.status)) {
    return json({ error: "card_not_active", detail: "הכרטיסייה אינה פעילה" }, 409);
  }
  if (!card.contact_email) return json({ error: "card_without_email" }, 409);

  const { data: existing } = await supabase
    .from("professional_accounts").select("id, user_id, erased_at").eq("card_id", card.id).maybeSingle();
  if (existing) {
    // חשבון שאושר (או שנמחק) נשאר כמות שהוא. חשבון שההזמנה אליו לא נלחצה: שולחים הזמנה חדשה
    const stale = existing.user_id && !existing.erased_at
      ? (await supabase.auth.admin.getUserById(existing.user_id)).data?.user
      : null;
    if (!stale || stale.email_confirmed_at) {
      return json({ error: "account_exists", detail: "כבר נפתח חשבון לכרטיסייה הזו. אפשר להתחבר, או לאפס סיסמה." }, 409);
    }
    const sentAt = Date.parse(stale.invited_at || stale.created_at || "");
    if (Number.isFinite(sentAt) && Date.now() - sentAt < RESEND_AFTER_MS) {
      return json({ error: "resend_too_soon", detail: "שלחנו הזמנה לפני רגע. אפשר לבקש שוב בעוד דקה." }, 429);
    }
    // אי אפשר היה להיכנס אליו, ולכן אין בו יתרה, הזמנות או לידים. ה-cascade מוחק גם את שורת החשבון
    const { error: delErr } = await supabase.auth.admin.deleteUser(stale.id);
    if (delErr) {
      console.error("professional account: deleting unconfirmed user failed", delErr.message);
      return json({ error: "auth_error", detail: delErr.message }, 500);
    }
  }

  // העיר: לפי שם האזור שנרשם בכרטיסייה. בלי התאמה city_id ריק, ומנהל/ת משלים/ה לפני אישור המדף
  let cityId: string | null = null;
  if (card.target_region) {
    const { data: cities } = await supabase
      .from("cities").select("id").eq("name", String(card.target_region).trim()).limit(2);
    // התאמה יחידה בלבד: שם שמשותף לשתי ערים, או אזור שאינו עיר, משאירים ריק (ההתראה למנהל/ת
    // אומרת להשלים) ולא בוחרים עיר באקראי, כי העיר קובעת אילו לידים עו"ד רואה
    cityId = cities && cities.length === 1 ? cities[0].id : null;
  }

  const email = String(card.contact_email).trim().toLowerCase();
  const displayName = String(card.advertiser_name || card.business_name || "").trim();

  // מייל ההזמנה הוא ההוכחה שהכתובת של מי שפותח/ת את החשבון. רק הלחיצה עליו מאשרת את הכתובת
  const { data: authUser, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName, account_type: "professional" },
    redirectTo: `${siteBaseUrl}/professional-crm`,
  });
  if (authErr || !authUser?.user) {
    // כתובת שכבר רשומה (למשל סוכן/ת שהוא/היא גם בעל/ת מקצוע): לא מחברים חשבון קיים לפי אסימון
    if (/already|registered|exists/i.test(authErr?.message || "")) {
      return json({
        error: "email_in_use",
        detail: "הכתובת שבכרטיסייה כבר רשומה באתר. כתבו לנו ונחבר את החשבון.",
      }, 409);
    }
    // ‏429 של מגבלת המיילים של Supabase, או SMTP שנפל: אין משתמש (ההזמנה נכשלה לפני שנשלחה), ואפשר לנסות שוב
    console.error("professional account invite failed", authErr?.message);
    return json({
      error: "invite_failed",
      detail: "לא הצלחנו לשלוח את מייל האימות. נסו שוב בעוד רגע.",
    }, 502);
  }

  const { data: account, error: insErr } = await supabase
    .from("professional_accounts")
    .insert({
      user_id: authUser.user.id,
      card_id: card.id,
      kind: card.advertiser_type,
      display_name: displayName.length >= 2 ? displayName : "בעל/ת מקצוע",
      phone: card.phone_e164 ?? null,
      city_id: cityId,
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr || !account) {
    // לא משאירים משתמש בלי חשבון: ניסיון חוזר היה נתקע על "הכתובת כבר רשומה"
    await supabase.auth.admin.deleteUser(authUser.user.id);
    console.error("professional account insert failed", insErr?.message);
    return json({ error: "db_error", detail: insErr?.message ?? "insert_failed" }, 500);
  }

  await announceProfessionalAccount(supabase, account.id);

  return json({ success: true, verification_sent: true, login_email: email, login_url: "/professional-crm" });
});
