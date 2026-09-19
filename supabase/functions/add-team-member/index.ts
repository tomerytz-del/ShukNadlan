import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";
import { sendWhatsappInvite, toWhatsappMsisdn } from "../_shared/whatsapp-invite.ts";
import { freeAgentSlug } from "../_shared/agent-slug.ts";

// ============================================================================
// הוספת סוכן/ת לצוות המשרד — בהזמנה, לא בסיסמה שממציאים עבורו/ה
//
// מודול 4 §2.4: רק מנהל/ת יכול/ה להכניס סוכן/ת למשרד שלו/ה, ואין הרשמה
// עצמאית. האכיפה היא מול המשתמש/ת המאומת/ת (JWT) ולא מה-body — אחרת סוכן
// כלשהו היה יכול להתחזות למנהל ולהכניס אנשים למשרד שאינו שלו.
//
// מה השתנה, ולמה: הגרסה הקודמת ביקשה מהמנהל/ת אימייל **וסיסמה זמנית**, יצרה
// חשבון auth על הכתובת שהוקלדה וקשרה אליו מיד את שורת ה-agency_members.
// בפועל הוקלדה כתובת עם אות אחת עודפת, השורה נקשרה לחשבון שאיש לא ייכנס
// אליו, והסוכנת האמיתית — שנכנסה עם הכתובת שלה — נראתה למערכת כמשתמשת חדשה
// לגמרי וקיבלה את מסך "עדיין לא פתחת משרד תיווך". לא הייתה שום נקודה שבה
// מישהו יכול היה לגלות את הטעות.
//
// עכשיו: השורה נוצרת עם user_id ריק, ונשלחת הזמנה. החיבור בין החשבון
// לשורה קורה בכניסה של הסוכן/ת עצמו/ה (join-agency), ולכן:
//   • כתובת שגויה אינה קושרת כלום — היא רק לא מגיעה, וזה מצב שרואים במסך.
//   • הקישור מוחזר גם לממשק, כדי שאפשר יהיה לשלוח אותו בוואטסאפ.
//   • אף אחד לא ממציא סיסמה עבור אדם אחר.
//
// ---------------------------------------------------------------------------
// מה הטופס מבקש היום, ולמה כל כך מעט
//
// **אימייל ונייד. זה הכול.** שני פרטי קשר, ושניהם של מי שמזמינים.
//
//   · **מספר רישיון התיווך ירד מהטופס.** הוא נבדק מול רשם המתווכים לפני
//     שההזמנה בכלל יצאה — כלומר מנהל/ת המשרד הקליד/ה מספר של אדם אחר,
//     וספרה שגויה חסמה את ההזמנה כולה. גרוע מכך היה מסלול הערעור: הוא דורש
//     **צילום תעודת הרישיון**, שאינו בידי מי שמילא/ה את הטופס. המספר עבר
//     למסך הפתיחה של הסוכן/ת עצמו/ה, שם גם התעודה נמצאת. השער החוקי לא זז
//     מילימטר: ‏join-agency אינו מקשר חשבון לכרטיס עד שהמספר נמסר ונבדק.
//   · **שם מלא נשאר, אופציונלי.** הוא רק הפתיח של ההודעה ושם השורה ברשימת
//     הצוות; מי שמשאיר/ה אותו ריק מקבל/ת "שלום", והסוכן/ת ממלא/ת את שמו/ה
//     בכניסה הראשונה. אין סיבה לחסום הזמנה בגללו.
//   · **הנייד הפך לחובה**, והסיבה היא ההודעה עצמה: ההזמנה יוצאת בשני ערוצים.
//
// ---------------------------------------------------------------------------
// שני ערוצים, לא אחד
//
// מייל שנחת בספאם נראה בדיוק כמו מייל שלא נשלח — זו הייתה ההערה כאן מהיום
// הראשון, והמסקנה שלה הייתה כפתור וואטסאפ *ידני* למנהל/ת. עכשיו ההזמנה יוצאת
// בוואטסאפ מעצמה, לצד המייל. הכפתור הידני נשאר: הוא הרשת האחרונה כשהשליחה
// האוטומטית נכשלת, והיא עלולה — ראו `_shared/whatsapp-invite.ts` על תבניות
// מאושרות ועל חלון 24 השעות.
//
// **אף אחד משני הערוצים אינו מפיל את ההוספה.** הכרטיס וההזמנה נוצרים, מה
// שנכשל נרשם (`send_error` / `wa_error`), והקישור חוזר לממשק.
//
// פעולות: invite (ברירת מחדל) · resend (כולל תיקון הכתובת) · set_phone · revoke.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

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
const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** ‏gmail.con, שתי נקודות, רווח בסוף — התקלות שבאמת קורות בהקלדה ידנית. */
function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * הטלפון הנייד של הסוכן/ת המוזמן/ת — **שדה חובה בהזמנה**, כי ההזמנה יוצאת
 * אליו בוואטסאפ. שלושה דברים נוספים תלויים בו: זה המספר שדף הסוכן/ת מחייג
 * אליו, זה מה שכפתור הוואטסאפ הידני פותח, וזה גם המספר שהעוזר בוואטסאפ מזהה
 * לפיו (‏whatsapp-webhook מחפש את הכרטיס לפי phone_e164). בלעדיו הסוכן/ת
 * נוחת/ת במערכת עם דף בלי כפתור חיוג ועם בוט שעונה "איני מזהה את מספר
 * הטלפון שלך".
 *
 * המספר מוחזר כספרות בלבד בצורה המקומית (‏0521112222) — אותה צורה בדיוק
 * ש-‏localPhone ב-CRM מייצרת, כך שכל הצרכנים קוראים אותו הדבר. ‏phone_e164
 * נגזרת ממנו במסד (עמודה מחושבת) ואין צורך לכתוב אותה.
 *
 * נייד בלבד, ולא מתוך קפדנות: ארבעת השימושים שלמעלה אינם עובדים על קו נייח,
 * ומספר נייח שהיה נכנס כאן היה נראה שמור ולא עובד באף אחד מהם.
 *
 * ‏null = לא הוזן. ‏false = הוזן משהו שאינו נייד ישראלי. בהזמנה חדשה שניהם
 * נדחים — המספר הוא ערוץ ההזמנה עצמו — וב-`set_phone` ריק עדיין מסיר מספר.
 */
function normalizeMobile(raw: unknown): string | null | false {
  const typed = String(raw ?? "").trim();
  if (!typed) return null;

  let d = typed.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) d = "0" + d.slice(3).replace(/^0+/, "");
  else if (d.length === 9 && d.startsWith("5")) d = "0" + d;

  return /^05\d{8}$/.test(d) ? d : false;
}

/**
 * **הקישור מוביל ישר ל-CRM.** לזמן מה הוא עבר דרך `pricing.html`, כדי
 * שההצטרפות תתחיל בבחירת מסלול — אלא שבתקופת ההשקה אין שם מה לבחור: כל
 * המצטרפים מקבלים Elite, ושני המסלולים האחרים מוצגים נעולים. כלומר הדף
 * הזה היה עמוד שלם שכל תפקידו לחיצה אחת על האפשרות היחידה, לפני
 * ההתחברות. מה שההטבה שווה נאמר במכתב ההזמנה, ושוב ברצועת ההטבה
 * שבדשבורד.
 *
 * קישור ישן ל-`pricing.html?invite=…` ממשיך לעבוד כמו שעבד — הדף עדיין
 * קורא את האסימון ומעביר אותו הלאה.
 */
const inviteUrl = (token: string) =>
  `${SITE_BASE_URL}/crm.html?invite=${encodeURIComponent(token)}`;

// ---------------------------------------------------------------------------
// מכתב ההזמנה
// ---------------------------------------------------------------------------

/**
 * המשפט השיווקי הוא הסיבה היחידה שמישהו יקליק. הוא מדבר על מה שהסוכן/ת מקבל/ת
 * — נוכחות מול מחפשי דירה — ולא על "מערכת" ו"פלטפורמה".
 */
const PITCH = "כל הנכסים, הלידים והלקוחות שלך במקום אחד — ודף סוכן/ת אישי שמופיע מול כל מי שמחפש דירה בעפולה והעמק.";

/* הטבת ההשקה נאמרת כבר במכתב ההזמנה, ולא רק במסך שאחרי ההתחברות: היא הסיבה
   הטובה ביותר ללחוץ על הקישור היום ולא "מתישהו". הענקתה עצמה נעשית בשרת
   (‏grant_launch_promo) ברגע השיוך. */
const PROMO_LINE = "ההצטרפות עכשיו כוללת 6 חודשים במסלול Elite — המסלול המלא, ללא תשלום וללא כרטיס אשראי.";

/** שם מלא הוא שדה אופציונלי בטופס, ולכן הפתיח חייב לעבוד גם בלעדיו. */
const greet = (name: string) => (name || "").trim() || "שלום";

function inviteHtml(a: { name: string; agency: string; inviter: string; url: string }) {
  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#F5F2ED;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:26px">
      <p style="font-size:13px;color:#7A8899;margin:0 0 10px">הזמנה להצטרף לצוות</p>
      <h1 style="margin:0 0 12px;font-size:21px;line-height:1.35">
        ${esc(greet(a.name))}, ${esc(a.inviter)} מזמין/ה אותך למשרד ${esc(a.agency)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3D4A5C">${esc(PITCH)}</p>
      <p style="margin:0 0 20px;padding:11px 13px;background:#F7F1E2;border:1px solid #E5C76A;border-radius:9px;font-size:14px;line-height:1.55;color:#3D4A5C">
        🎁 ${esc(PROMO_LINE)}
      </p>
      <a href="${esc(a.url)}"
         style="display:inline-block;background:#1B2A41;color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px;font-weight:bold">
        הצטרפות למשרד
      </a>
      <p style="margin:20px 0 0;font-size:13px;color:#7A8899;line-height:1.6">
        הכניסה היא עם חשבון Google שלך או עם סיסמה שתגדיר/י בעצמך — אף אחד
        לא מגדיר לך סיסמה. הקישור אישי, ותקף 30 יום.
      </p>
    </div>
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center;line-height:1.6">
      אם הקישור לא נפתח, אפשר להעתיק אותו לדפדפן:<br>
      <span style="color:#7A8899;word-break:break-all">${esc(a.url)}</span>
    </p>
    <p style="font-size:12px;color:#98A2B0;margin:14px 0 0;text-align:center">
      קיבלת את ההודעה כי מנהל/ת המשרד הוסיף/ה אותך לצוות בשוק נדל״ן.<br>
      אם זו טעות, אפשר פשוט להתעלם.
    </p>
  </div>
</body></html>`;
}

function inviteText(a: { name: string; agency: string; inviter: string; url: string }) {
  return [
    `${greet(a.name)}, ${a.inviter} מזמין/ה אותך להצטרף למשרד ${a.agency} בשוק נדל״ן.`,
    "",
    PITCH,
    "",
    PROMO_LINE,
    "",
    `להצטרפות: ${a.url}`,
    "",
    "הכניסה היא עם חשבון Google שלך או עם סיסמה שתגדיר/י בעצמך. הקישור אישי ותקף 30 יום.",
  ].join("\n");
}

/**
 * שליחה שנכשלה איננה כישלון של ההוספה: הכרטיס וההזמנה כבר קיימים, והקישור
 * חוזר לממשק. לכן מוחזר סטטוס ולא נזרקת חריגה — המנהל/ת רואה "לא נשלח",
 * ויכול/ה לשלוח את הקישור בעצמו/ה. זה בדיוק מה שהיה חסר קודם.
 */
async function sendInviteEmail(to: string, a: { name: string; agency: string; inviter: string; url: string }) {
  // המשלוח דרך platform-mail, ולא ישירות: ההזמנה מגיעה מאותה כתובת שממנה
  // מגיע כל מייל אחר של הפלטפורמה — וזה חשוב דווקא כאן, כי סוכן/ת שמקבל/ת
  // הזמנה מכתובת לא מוכרת מסמן/ת אותה כספאם.
  const result = await sendPlatformEmail({
    to: [to],
    subject: `${a.inviter} מזמין/ה אותך להצטרף למשרד ${a.agency}`,
    html: inviteHtml(a),
    text: inviteText(a),
  });
  return { sent: result.sent, error: result.error };
}

type InviteDelivery = {
  email_sent: boolean;
  email_error: string | null;
  wa_sent: boolean;
  wa_error: string | null;
};

/**
 * שני הערוצים, ושליחה אחת.
 *
 * **הם נשלחים במקביל ולא בטור**, וזו לא אופטימיזציה: שני ספקים חיצוניים
 * בטור הם שני timeout אפשריים זה אחרי זה, בתוך בקשה שמנהל/ת המשרד מחכה
 * לתשובתה מול טופס פתוח.
 *
 * ‏`Promise.all` ולא `allSettled` כי שתי הפונקציות **אינן זורקות** —
 * שתיהן מחזירות סטטוס. זו כל הנקודה: כישלון ערוץ הוא נתון שנרשם, לא
 * חריגה שמפילה את ההוספה.
 */
async function sendInvite(
  a: { email: string; phone: string | null; name: string; agency: string; inviter: string; url: string },
): Promise<InviteDelivery> {
  const msisdn = toWhatsappMsisdn(a.phone);
  const [mail, wa] = await Promise.all([
    sendInviteEmail(a.email, a),
    msisdn
      ? sendWhatsappInvite(msisdn, { name: a.name, agency: a.agency, url: a.url })
      : Promise.resolve({ sent: false, error: "no_mobile" as string | null }),
  ]);
  return { email_sent: mail.sent, email_error: mail.error, wa_sent: wa.sent, wa_error: wa.error };
}

/** אותה רשומה, אותן ארבע עמודות — כדי שהרישום לא ייפרד בין שני מסלולי השליחה. */
function deliveryStamp(d: InviteDelivery) {
  const now = new Date().toISOString();
  return {
    sent_at: d.email_sent ? now : null,
    send_error: d.email_error,
    wa_sent_at: d.wa_sent ? now : null,
    wa_error: d.wa_error,
  };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: caller, error: callerErr } = await supabase
    .from("agency_members")
    .select("id, agency_id, role, active, display_name")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (callerErr || !caller) return json({ error: "no_matching_agent_profile" }, 403);
  if (!caller.active) return json({ error: "caller_inactive" }, 403);
  if (caller.role !== "manager") {
    return json({ error: "managers_only", detail: "רק מנהל משרד יכול להכניס סוכנים" }, 403);
  }

  const { data: agency } = await supabase
    .from("agencies").select("name").eq("id", caller.agency_id).maybeSingle();
  const agencyName = agency?.name || "המשרד";
  const inviterName = caller.display_name || "מנהל/ת המשרד";

  const action = ["invite", "resend", "revoke", "set_phone"].includes(body?.action) ? body.action : "invite";

  try {
    // -----------------------------------------------------------------------
    // ביטול הזמנה. הכרטיס נמחק יחד איתה רק אם מעולם לא חובר לחשבון — כרטיס
    // של סוכן/ת פעיל/ה לא ייעלם בגלל לחיצה על "ביטול הזמנה".
    // -----------------------------------------------------------------------
    if (action === "revoke") {
      const memberId = String(body?.member_id || "");
      if (!memberId) return json({ error: "missing_fields", required: ["member_id"] }, 400);

      const { data: member } = await supabase
        .from("agency_members").select("id, agency_id, user_id")
        .eq("id", memberId).maybeSingle();
      if (!member || member.agency_id !== caller.agency_id) return json({ error: "member_not_found" }, 404);
      if (member.user_id) return json({ error: "already_joined" }, 409);

      await supabase.from("agency_invitations")
        .update({ status: "revoked" }).eq("member_id", memberId).eq("status", "pending");
      const { error: delErr } = await supabase.from("agency_members").delete().eq("id", memberId);
      if (delErr) return json({ error: "db_error", detail: delErr.message }, 500);
      return json({ success: true, revoked: true });
    }

    // -----------------------------------------------------------------------
    // תיקון הנייד בידי המנהל/ת
    //
    // המקבילה של תיקון הכתובת ב-resend, ומאותה סיבה: את המספר מקליד/ה מי
    // שאינו/ה בעליו, וספרה שגויה לא מתגלה עד שמישהו מנסה לחייג. כל עוד
    // הכרטיס ממתין להזמנה אין אף אחד אחר שיכול לתקן — לסוכן/ת עדיין אין
    // חשבון. אחרי ההצטרפות שתי הדרכים פתוחות: המנהל/ת כאן, והסוכן/ת
    // מהאזור האישי.
    //
    // ‏member_phone ריק מסיר את המספר (null) — זו הדרך לחזור בה, ולא ערך
    // דמה. הנרמול והבדיקה הם אותם אלה של ההזמנה עצמה, כדי שלא ייווצר הבדל
    // בין מספר שנכנס בהוספה למספר שנכנס בתיקון.
    // -----------------------------------------------------------------------
    if (action === "set_phone") {
      const memberId = String(body?.member_id || "");
      if (!memberId) return json({ error: "missing_fields", required: ["member_id"] }, 400);

      const phone = normalizeMobile(body?.member_phone);
      if (phone === false) return json({ error: "invalid_phone" }, 400);

      const { data: member } = await supabase
        .from("agency_members").select("id, agency_id").eq("id", memberId).maybeSingle();
      if (!member || member.agency_id !== caller.agency_id) return json({ error: "member_not_found" }, 404);

      const { error: updErr } = await supabase
        .from("agency_members")
        .update({ phone, updated_at: new Date().toISOString() })
        .eq("id", memberId);

      if (updErr) {
        const errText = `${updErr.message || ""} ${updErr.details || ""}`;
        if (updErr.code === "23505" && /phone_e164/.test(errText)) {
          return json({ error: "phone_in_use" }, 409);
        }
        return json({ error: "db_error", detail: updErr.message }, 500);
      }
      return json({ success: true, phone });
    }

    // -----------------------------------------------------------------------
    // שליחה מחדש — ובעיקר: **תיקון הכתובת**. זו הדרך שבה טעות הקלדה נסגרת
    // בלי לגעת במסד, וזו הסיבה שהיא כאן ולא בגרסה נפרדת "מאוחר יותר".
    // -----------------------------------------------------------------------
    if (action === "resend") {
      const memberId = String(body?.member_id || "");
      if (!memberId) return json({ error: "missing_fields", required: ["member_id"] }, 400);

      const { data: member } = await supabase
        .from("agency_members").select("id, agency_id, user_id, display_name, email, phone")
        .eq("id", memberId).maybeSingle();
      if (!member || member.agency_id !== caller.agency_id) return json({ error: "member_not_found" }, 404);
      if (member.user_id) return json({ error: "already_joined" }, 409);

      let email = normalizeEmail(body?.member_email) || normalizeEmail(member.email);
      if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);

      if (email !== normalizeEmail(member.email)) {
        await supabase.from("agency_members").update({ email }).eq("id", memberId);
      }

      // אסימון חדש בכל שליחה: הישן עלול להיות בתיבה של הכתובת השגויה.
      await supabase.from("agency_invitations")
        .update({ status: "revoked" }).eq("member_id", memberId).eq("status", "pending");

      const { data: invite, error: invErr } = await supabase
        .from("agency_invitations")
        .insert({ agency_id: caller.agency_id, member_id: memberId, invited_by: caller.id, contact: email })
        .select("token").single();
      if (invErr || !invite) return json({ error: "db_error", detail: invErr?.message }, 500);

      const url = inviteUrl(invite.token);
      const delivery = await sendInvite({
        email, phone: member.phone || null,
        name: member.display_name || "", agency: agencyName, inviter: inviterName, url,
      });
      await supabase.from("agency_invitations")
        .update(deliveryStamp(delivery)).eq("token", invite.token);

      return json({
        success: true, invite_url: url, email, ...delivery,
        // אותו טלפון ששמור על הכרטיס — כדי ששליחה חוזרת תוכל לצאת בוואטסאפ
        // ישירות אליו, בדיוק כמו ההזמנה הראשונה.
        phone: member.phone || null,
      });
    }

    // -----------------------------------------------------------------------
    // הזמנה חדשה
    // -----------------------------------------------------------------------
    // ‏שם מלא — אופציונלי. שני שדות החובה הם שני ערוצי ההזמנה, וזהו.
    const member_name = String(body?.member_name || "").trim();
    const member_email = normalizeEmail(body?.member_email);
    if (!member_email) {
      return json({ error: "missing_fields", required: ["member_email", "member_phone"] }, 400);
    }
    if (!EMAIL_RE.test(member_email)) return json({ error: "invalid_email" }, 400);

    // ‏הנייד חובה כאן, בניגוד ל-set_phone: ההזמנה יוצאת אליו. ‏null (לא הוזן)
    // ו-false (הוזן משהו שאינו נייד) שניהם נדחים, ובשתי הודעות שונות —
    // "שכחת" ו"זה לא נייד" הן שתי בעיות שונות למי שממלא/ת את הטופס.
    const member_phone = normalizeMobile(body?.member_phone);
    if (member_phone === null) {
      return json({ error: "missing_fields", required: ["member_email", "member_phone"] }, 400);
    }
    if (member_phone === false) return json({ error: "invalid_phone" }, 400);

    // כתובת שכבר משויכת לכרטיס אחר היא כמעט תמיד הזמנה כפולה, לא סוכן/ת שני/ה.
    const { data: emailTaken } = await supabase
      .from("agency_members").select("id, agency_id")
      .ilike("email", member_email).limit(1).maybeSingle();
    if (emailTaken) {
      return json({
        error: "email_in_use",
        same_agency: emailTaken.agency_id === caller.agency_id,
      }, 409);
    }

    // -----------------------------------------------------------------------
    // ‏**אין כאן יותר אימות רישיון, כי אין כאן יותר מספר רישיון.**
    //
    // עד היום הבדיקה רצה כאן, על מספר שמנהל/ת המשרד הקליד/ה עבור אדם אחר.
    // היא נשמעה כמו זהירות והייתה בעיקר מכשול: ספרה שגויה חסמה הזמנה תקינה,
    // ומסלול הערעור דורש **צילום תעודת הרישיון** — מסמך שאינו בידי מי
    // שממלא/ת את הטופס. הבדיקה עברה לרגע שבו גם המספר וגם התעודה נמצאים
    // אצל בעליהם: מסך הפתיחה של הסוכן/ת (‏join-agency ← `bind`).
    //
    // מה **לא** השתנה: אי אפשר להיכנס בלי רישיון מאומת. הכרטיס נוצר כאן
    // ריק מרישיון (`license_number` הוא NULL מאז
    // ‎20261129090000_onboarding_simplify‎), ו-`bind` אינו מקשר אליו חשבון עד
    // שהמספר נמסר ועבר. כלומר הכרטיס הממתין אינו חשבון — הוא מקום שמור.
    // -----------------------------------------------------------------------

    // ‏אין כאן יותר initial_tier. המסלול הוא החלטה של מי שמשלם עליו, והוא
    // נקבע אצל הסוכן/ת בכניסה הראשונה (מסך בחירת המסלול ב-CRM →
    // ‎join-agency/set_tier‎). השורה נוצרת על ברירת המחדל של העמודה, ‎free‎,
    // ומיד עם השיוך היא מקבלת את הטבת ההשקה. גוף בקשה ישן ששולח
    // ‎initial_tier‎ פשוט מתעלמים ממנו — לא נכשלים בגללו.
    // ‏slug זמני כשאין שם: הוא אינו מתפרסם בשום מקום לפני ההצטרפות (הכרטיס
    // מוסתר מהדפים הציבוריים כל עוד `user_id` ריק), ו-`join-agency` נותן לו
    // את השם האמיתי ברגע שהסוכן/ת ממלא/ת אותו במסך הפתיחה.
    const finalSlug = await freeAgentSlug(supabase, member_name);

    // ‏user_id ריק בכוונה. הוא ייכתב בכניסה הראשונה של הסוכן/ת עצמו/ה
    // (join-agency), ורק אז — כי רק אז ידוע איזה חשבון באמת שייך לו/ה.
    const { data: member, error: memberErr } = await supabase
      .from("agency_members")
      .insert({
        user_id: null,
        agency_id: caller.agency_id,
        slug: finalSlug,
        role: "agent",
        active: true,
        display_name: member_name || null,
        email: member_email,
        phone: member_phone,
        license_number: null,
      })
      .select("id")
      .single();

    // מספר שכבר רשום אצל סוכן/ת אחר/ת נעצר על האינדקס הייחודי
    // ‏(agency_members_phone_e164_key) ולא בבדיקה מקדימה — כך יש כלל אחד
    // ולא שניים שעלולים להיפרד. השורה לא נוצרה, ולכן אין מה לנקות.
    if (memberErr) {
      // ‏PostgREST מפזר את שם האינדקס בין message ל-details לפי המקרה, ולכן
      // הבדיקה על שניהם — אחרת ההודעה הייתה מתחלפת ב-"db_error" הגנרי.
      const errText = `${memberErr.message || ""} ${memberErr.details || ""}`;
      if (memberErr.code === "23505" && /phone_e164/.test(errText)) {
        return json({ error: "phone_in_use" }, 409);
      }
      return json({ error: "db_error", detail: memberErr.message }, 500);
    }

    const { data: invite, error: invErr } = await supabase
      .from("agency_invitations")
      .insert({ agency_id: caller.agency_id, member_id: member.id, invited_by: caller.id, contact: member_email })
      .select("token").single();

    if (invErr || !invite) {
      await supabase.from("agency_members").delete().eq("id", member.id);
      return json({ error: "db_error", detail: invErr?.message }, 500);
    }

    const url = inviteUrl(invite.token);
    const delivery = await sendInvite({
      email: member_email, phone: member_phone,
      name: member_name, agency: agencyName, inviter: inviterName, url,
    });
    await supabase.from("agency_invitations")
      .update(deliveryStamp(delivery)).eq("token", invite.token);

    return json({
      success: true,
      member_slug: finalSlug,
      member_id: member.id,
      invite_url: url,
      ...delivery,
      // ‏הטלפון חוזר כדי שהממשק יוכל לפתוח את ההזמנה בוואטסאפ **אל הסוכן/ת**
      // ולא אל בורר אנשי הקשר. חוזר מנורמל, שלא יישלח מה שהוקלד.
      phone: member_phone,
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
