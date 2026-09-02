import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";

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

function inviteHtml(a: { name: string; agency: string; inviter: string; url: string }) {
  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#F5F2ED;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:26px">
      <p style="font-size:13px;color:#7A8899;margin:0 0 10px">הזמנה להצטרף לצוות</p>
      <h1 style="margin:0 0 12px;font-size:21px;line-height:1.35">
        ${esc(a.name)}, ${esc(a.inviter)} מזמין/ה אותך למשרד ${esc(a.agency)}
      </h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3D4A5C">${esc(PITCH)}</p>
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
    `${a.name}, ${a.inviter} מזמין/ה אותך להצטרף למשרד ${a.agency} בשוק נדל״ן.`,
    "",
    PITCH,
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

  const action = ["invite", "resend", "revoke"].includes(body?.action) ? body.action : "invite";

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
    // שליחה מחדש — ובעיקר: **תיקון הכתובת**. זו הדרך שבה טעות הקלדה נסגרת
    // בלי לגעת במסד, וזו הסיבה שהיא כאן ולא בגרסה נפרדת "מאוחר יותר".
    // -----------------------------------------------------------------------
    if (action === "resend") {
      const memberId = String(body?.member_id || "");
      if (!memberId) return json({ error: "missing_fields", required: ["member_id"] }, 400);

      const { data: member } = await supabase
        .from("agency_members").select("id, agency_id, user_id, display_name, email")
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

      return json({ success: true, invite_url: url, email, email_sent: mail.sent, email_error: mail.error });
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

    const tier = ["free", "mid", "premium"].includes(body?.initial_tier) ? body.initial_tier : "free";

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
        license_number,
        tier,
      })
      .select("id")
      .single();

    if (memberErr) return json({ error: "db_error", detail: memberErr.message }, 500);

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
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
