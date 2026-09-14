import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";
import { blockedResponse, checkBrokerLicense } from "../_shared/broker-license-gate.ts";

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
// עכשיו: השורה נוצרת עם user_id ריק, ונשלחת הזמנה במייל. החיבור בין החשבון
// לשורה קורה בכניסה של הסוכן/ת עצמו/ה (join-agency), ולכן:
//   • כתובת שגויה אינה קושרת כלום — היא רק לא מגיעה, וזה מצב שרואים במסך.
//   • הקישור מוחזר גם לממשק, כדי שאפשר יהיה לשלוח אותו בוואטסאפ.
//   • אף אחד לא ממציא סיסמה עבור אדם אחר.
//
// פעולות: invite (ברירת מחדל) · resend (כולל תיקון הכתובת) · revoke.
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
function slugify(text: string) {
  return text.trim().toLowerCase()
    .replace(/[^\u0590-\u05FFa-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** ‏gmail.con, שתי נקודות, רווח בסוף — התקלות שבאמת קורות בהקלדה ידנית. */
function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * הטלפון הנייד של הסוכן/ת המוזמן/ת — אופציונלי, ובכל זאת שווה לבקש אותו כאן:
 * זה המספר שדף הסוכן/ת מחייג אליו, וזה גם המספר שהעוזר בוואטסאפ מזהה לפיו
 * (‏whatsapp-webhook מחפש את הכרטיס לפי phone_e164). בלעדיו הסוכן/ת נוחת/ת
 * במערכת עם דף בלי כפתור חיוג ועם בוט שעונה "איני מזהה את מספר הטלפון שלך".
 *
 * המספר מוחזר כספרות בלבד בצורה המקומית (‏0521112222) — אותה צורה בדיוק
 * ש-‏localPhone ב-CRM מייצרת, כך שכל הצרכנים קוראים אותו הדבר. ‏phone_e164
 * נגזרת ממנו במסד (עמודה מחושבת) ואין צורך לכתוב אותה.
 *
 * נייד בלבד, ולא מתוך קפדנות: שלושת השימושים — קישור ההזמנה בוואטסאפ, כפתור
 * הוואטסאפ בדף הסוכן/ת, והעוזר — כולם לא עובדים על קו נייח, ומספר נייח שהיה
 * נכנס כאן היה נראה שמור ולא עובד באף אחד מהם.
 *
 * ‏null = לא הוזן (חוקי). ‏false = הוזן משהו שאינו נייד ישראלי.
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
 * הקישור מוביל לדף המסלולים ולא ישר ל-CRM, וזה שינוי מכוון: הצטרפות מתחילה
 * בבחירת מסלול. ‏pricing.html קורא/ת את האסימון, מציג/ה את המסלולים, וכל CTA
 * שם מחזיר/ה ל-‎crm.html?invite=<token>&tier=<id>‎ — כלומר האסימון ממשיך הלאה
 * בדיוק כמו קודם, והתנהגות ה-CRM לא השתנתה. מי שיגיע/ה עם קישור ישן
 * ל-‎crm.html?invite=…‎ עדיין ייקלט/תיקלט: הבחירה פשוט תוצג לו/ה בשער המסלול
 * שאחרי ההתחברות.
 */
const inviteUrl = (token: string) =>
  `${SITE_BASE_URL}/pricing.html?invite=${encodeURIComponent(token)}`;

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

function inviteHtml(a: { name: string; agency: string; inviter: string; url: string }) {
  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#F5F2ED;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:26px">
      <p style="font-size:13px;color:#7A8899;margin:0 0 10px">הזמנה להצטרף לצוות</p>
      <h1 style="margin:0 0 12px;font-size:21px;line-height:1.35">
        ${esc(a.name)}, ${esc(a.inviter)} מזמין/ה אותך למשרד ${esc(a.agency)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3D4A5C">${esc(PITCH)}</p>
      <p style="margin:0 0 20px;padding:11px 13px;background:#F7F1E2;border:1px solid #E5C76A;border-radius:9px;font-size:14px;line-height:1.55;color:#3D4A5C">
        🎁 ${esc(PROMO_LINE)}
      </p>
      <a href="${esc(a.url)}"
         style="display:inline-block;background:#1B2A41;color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px;font-weight:bold">
        בחירת מסלול והצטרפות
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
    `${a.name}, ${a.inviter} מזמין/ה אותך להצטרף למשרד ${a.agency} בשוק נדל״ן.`,
    "",
    PITCH,
    "",
    PROMO_LINE,
    "",
    `לבחירת מסלול והצטרפות: ${a.url}`,
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
      const mail = await sendInviteEmail(email, { name: member.display_name || "", agency: agencyName, inviter: inviterName, url });
      await supabase.from("agency_invitations")
        .update({ sent_at: mail.sent ? new Date().toISOString() : null, send_error: mail.error })
        .eq("token", invite.token);

      return json({
        success: true, invite_url: url, email,
        email_sent: mail.sent, email_error: mail.error,
        // אותו טלפון ששמור על הכרטיס — כדי ששליחה חוזרת תוכל לצאת בוואטסאפ
        // ישירות אליו, בדיוק כמו ההזמנה הראשונה.
        phone: member.phone || null,
      });
    }

    // -----------------------------------------------------------------------
    // הזמנה חדשה
    // -----------------------------------------------------------------------
    const member_name = String(body?.member_name || "").trim();
    const license_number = String(body?.license_number || "").trim();
    const member_email = normalizeEmail(body?.member_email);
    if (!member_name || !member_email || !license_number) {
      return json({ error: "missing_fields", required: ["member_name", "member_email", "license_number"] }, 400);
    }
    if (!EMAIL_RE.test(member_email)) return json({ error: "invalid_email" }, 400);

    const member_phone = normalizeMobile(body?.member_phone);
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
    // אימות רישיון התיווך של הסוכן/ת המוזמן/ת
    //
    // כאן מי שמקליד/ה אינו/ה מי שנבדק/ת: מנהל/ת המשרד מזין/ה את פרטי
    // הסוכן/ת. זה לא משנה את הבדיקה — הרישיון הוא של הסוכן/ת — אבל כן משנה
    // את ההודעה, ולכן היא נוסחה כך שתיקרא נכון גם למנהל/ת שרואה אותה על
    // מישהו אחר.
    //
    // החסימה כאן חוסכת את המקרה הגרוע: הזמנה שנשלחת, סוכן/ת שנכנס/ת, ורק
    // אז מתגלה שאין רישיון.
    // -----------------------------------------------------------------------
    const licenseCheck = await checkBrokerLicense(supabase, license_number, {
      who: member_name,
      email: member_email,
      source: "add-team-member",
    });
    if (!licenseCheck.allowed) {
      return json(blockedResponse(licenseCheck, license_number), 403);
    }

    // ‏אין כאן יותר initial_tier. המסלול הוא החלטה של מי שמשלם עליו, והוא
    // נקבע אצל הסוכן/ת בכניסה הראשונה (מסך בחירת המסלול ב-CRM →
    // ‎join-agency/set_tier‎). השורה נוצרת על ברירת המחדל של העמודה, ‎free‎,
    // ומיד עם השיוך היא מקבלת את הטבת ההשקה. גוף בקשה ישן ששולח
    // ‎initial_tier‎ פשוט מתעלמים ממנו — לא נכשלים בגללו.
    let baseSlug = slugify(member_name) || "agent";
    let finalSlug = baseSlug;
    let attempt = 1;
    while (true) {
      const { data: existing } = await supabase
        .from("agency_members").select("id").eq("slug", finalSlug).maybeSingle();
      if (!existing) break;
      attempt += 1;
      finalSlug = `${baseSlug}-${attempt}`;
    }

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
        display_name: member_name,
        email: member_email,
        phone: member_phone,
        license_number,
        ...licenseCheck.columns,
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
    const mail = await sendInviteEmail(member_email, { name: member_name, agency: agencyName, inviter: inviterName, url });
    await supabase.from("agency_invitations")
      .update({ sent_at: mail.sent ? new Date().toISOString() : null, send_error: mail.error })
      .eq("token", invite.token);

    return json({
      success: true,
      member_slug: finalSlug,
      member_id: member.id,
      invite_url: url,
      email_sent: mail.sent,
      email_error: mail.error,
      // ‏הטלפון חוזר כדי שהממשק יוכל לפתוח את ההזמנה בוואטסאפ **אל הסוכן/ת**
      // ולא אל בורר אנשי הקשר. חוזר מנורמל, שלא יישלח מה שהוקלד.
      phone: member_phone,
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
