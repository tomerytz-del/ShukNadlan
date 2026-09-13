import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail, PLATFORM_CONTACT_EMAIL } from "../_shared/platform-mail-client.ts";
import { normalizeLicense } from "../_shared/broker-registry.ts";

// ============================================================================
// ערעור על חסימת כניסה — צילום רישיון ואישור ידני
//
// זו הדלת שמונעת מהשער להיות חומה. מאגר המתווכים ב-data.gov.il מתעדכן אחת
// לשלושה חודשים, ולכן מי שקיבל/ה רישיון החודש פשוט אינו/ה שם. מולו עומד
// אדם עם תעודה ביד, וכאן הוא/היא שולח/ת אותה.
//
// ---------------------------------------------------------------------------
// שני קהלים לאותה נקודת קצה, ולכן ‏verify_jwt=false והאימות עצמי:
//
//   ‏submit  — מי שנחסם/ה. **אין לו/ה חשבון בכלל**: הוא/היא נחסם/ה בטופס
//              פתיחת המשרד, לפני שנוצר משתמש. לכן זו פנייה אנונימית, ולכן
//              כל הבלמים שלמטה.
//   ‏list / decide — הנהלת הפלטפורמה, עם JWT, אחרי בדיקת is_platform_admin
//              בתוך הפונקציה.
//
// ‏verify_jwt=true היה חוסם את הראשון לגמרי — כלומר מבטל את הערעור.
// ---------------------------------------------------------------------------
// הבלמים על המסלול האנונימי, לפי סדר ההפעלה:
//
//   1. מספר רישיון בן 3–8 ספרות בלבד.
//   2. אימייל שנראה כמו אימייל, ושם שאינו ריק.
//   3. סוג הקובץ מתוך רשימה סגורה, ולפי **תוכן ההצהרה ולפי הדלי גם יחד** —
//      הדלי עצמו מוגדר עם allowed_mime_types, ולכן קובץ שאינו תמונה/PDF
//      נדחה גם אם ה-MIME שהוצהר שקרי.
//   4. עד 5MB. צילום רישיון, לא ארכיון.
//   5. ערעור פתוח אחד לכל מספר רישיון — אינדקס ייחודי במסד. רענון של
//      הטופס אינו מייצר תור בקשות זהות.
//   6. ‏submit **אינו מאשר כלום**. הוא יוצר שורת pending ושולח מייל. כל
//      ההשפעה על מי שנכנס/ת למערכת עוברת דרך decide, שדורש מנהל/ת פלטפורמה.
// ---------------------------------------------------------------------------
//
// **שורה מאושרת כאן היא ההיתר עצמו.** אין טבלת allowlist נפרדת: השער
// (‏_shared/broker-license-gate.ts) שואל את broker_license_appeals לפני
// שהוא פונה ל-data.gov.il. כך "אישרתי את הערעור" ו"אפשרתי לפתוח משרד" הם
// אותה פעולה, ולא שתיים שיכולות להיפרד.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "broker-licenses";
const MAX_BYTES = 5 * 1024 * 1024;

/** חייב להישאר זהה ל-allowed_mime_types של הדלי במיגרציה. */
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** כמה דקות הקישור לצפייה במסמך תקף. מסמך מזהה — חלון קצר. */
const SIGNED_URL_SECONDS = 600;

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

/** שם, אימייל והערה נכנסים לגוף מייל — טקסט שהפונה שולט/ת בו. */
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const trimmed = (raw: unknown, max: number) => String(raw ?? "").trim().slice(0, max);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/**
 * פענוח הקובץ מ-data URL.
 *
 * הבדיקה על **הגודל המפוענח** ולא על אורך המחרוזת: base64 מנפח בשליש, ולכן
 * חסימה לפי אורך המחרוזת הייתה פוסלת קובץ תקין של 4MB.
 */
function decodeDocument(raw: unknown): { bytes: Uint8Array; mime: string } | { error: string } {
  const value = String(raw ?? "");
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return { error: "bad_document" };

  const mime = match[1].toLowerCase().trim();
  if (!ALLOWED_MIME[mime]) return { error: "bad_mime" };

  let binary: string;
  try { binary = atob(match[2]); } catch { return { error: "bad_document" }; }
  if (binary.length === 0) return { error: "empty_document" };
  if (binary.length > MAX_BYTES) return { error: "too_large" };

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

/** מנהל/ת פלטפורמה מאחורי ה-JWT, או null. */
async function platformAdmin(req: Request, supabase: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await authed.auth.getUser();
  if (!userData?.user) return null;

  const { data: member } = await supabase
    .from("agency_members")
    .select("id, display_name, is_platform_admin, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!member?.active || !member.is_platform_admin) return null;
  return { userId: userData.user.id, memberId: member.id, name: member.display_name as string | null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const action = ["submit", "list", "decide"].includes(body?.action) ? body.action : "submit";

  try {
    // =====================================================================
    // submit — "יש לי רישיון, הנה הצילום"
    // =====================================================================
    if (action === "submit") {
      const license = normalizeLicense(body.license_number);
      if (!/^\d{3,8}$/.test(license)) {
        return json({ error: "bad_license_number", detail: "מספר רישיון תיווך צריך להיות בן 3 עד 8 ספרות" }, 400);
      }

      const name = trimmed(body.applicant_name, 120);
      const email = trimmed(body.applicant_email, 160).toLowerCase();
      const phone = trimmed(body.applicant_phone, 40) || null;
      const note = trimmed(body.note, 600) || null;
      const source = trimmed(body.source, 40) || null;

      if (!name) return json({ error: "missing_fields", detail: "יש להזין שם מלא" }, 400);
      if (!isEmail(email)) return json({ error: "bad_email", detail: "יש להזין כתובת אימייל תקינה" }, 400);

      const decoded = decodeDocument(body.document);
      if ("error" in decoded) {
        const details: Record<string, string> = {
          bad_document: "לא הצלחנו לקרוא את הקובץ. יש לצרף צילום או PDF.",
          bad_mime: "אפשר לצרף תמונה (JPG, PNG, WEBP, HEIC) או PDF בלבד.",
          empty_document: "הקובץ ריק.",
          too_large: "הקובץ גדול מ-5MB. אפשר לצלם מחדש או לדחוס.",
        };
        return json({ error: decoded.error, detail: details[decoded.error] ?? "הקובץ אינו תקין" }, 400);
      }

      // כבר אושר — אין טעם בערעור נוסף, והתשובה היא בשורה הטובה.
      const { data: already } = await supabase
        .from("broker_license_appeals")
        .select("id").eq("license_number", license).eq("status", "approved").limit(1).maybeSingle();
      if (already) {
        return json({
          status: "already_approved",
          detail: "מספר הרישיון הזה כבר אושר על ידי הנהלת הפלטפורמה. אפשר להמשיך בהרשמה.",
        });
      }

      const path = `${license}/${crypto.randomUUID()}.${ALLOWED_MIME[decoded.mime]}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, decoded.bytes, { contentType: decoded.mime, upsert: false });
      if (upErr) return json({ error: "upload_failed", detail: upErr.message }, 500);

      const { data: appeal, error: insErr } = await supabase
        .from("broker_license_appeals")
        .insert({
          license_number: license,
          applicant_name: name,
          applicant_email: email,
          applicant_phone: phone,
          source,
          document_path: path,
          document_mime: decoded.mime,
          note,
        })
        .select("id")
        .single();

      if (insErr) {
        // הקובץ כבר עלה, והשורה לא נוצרה — מוחקים אותו כדי שלא יישאר יתום
        // בדלי שאיש לא יראה.
        await supabase.storage.from(BUCKET).remove([path]);
        // ‏23505 = האינדקס הייחודי על ערעור פתוח אחד לכל מספר רישיון.
        if ((insErr as any).code === "23505") {
          return json({
            status: "already_pending",
            detail: "כבר נשלח ערעור על מספר הרישיון הזה והוא ממתין לבדיקה. נעדכן במייל.",
          }, 409);
        }
        return json({ error: "db_error", detail: insErr.message }, 500);
      }

      await sendPlatformEmail({
        to: [PLATFORM_CONTACT_EMAIL],
        subject: `ערעור רישיון תיווך ${license} — ${name.slice(0, 60)}`,
        html: `<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.7">
          <p><b>${esc(name)}</b> נחסם/ה בכניסה ושלח/ה צילום רישיון תיווך לבדיקה.</p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:2px 10px 2px 0;color:#666">מספר רישיון</td><td><b>${esc(license)}</b></td></tr>
            <tr><td style="padding:2px 10px 2px 0;color:#666">אימייל</td><td>${esc(email)}</td></tr>
            <tr><td style="padding:2px 10px 2px 0;color:#666">טלפון</td><td>${esc(phone || "—")}</td></tr>
            <tr><td style="padding:2px 10px 2px 0;color:#666">מסלול</td><td><code>${esc(source || "—")}</code></td></tr>
          </table>
          ${note ? `<p style="background:#f6f7fb;padding:10px;border-radius:8px">${esc(note)}</p>` : ""}
          <p>הצילום ממתין ב-<b>לוח הבקרה ← ערעורי רישיון</b>. אישור שם פותח את פתיחת המשרד;
             הקובץ עצמו נפתח שם בקישור חתום ואינו נשלח במייל.</p>
        </div>`,
        text: `${name} (${email}, ${phone || "ללא טלפון"}) שלח/ה צילום רישיון ${license}. ` +
          `לאישור: לוח הבקרה ← ערעורי רישיון.`,
      });

      return json({
        status: "received",
        appeal_id: appeal.id,
        detail: "הצילום התקבל והועבר להנהלת הפלטפורמה. נעדכן במייל ברגע שתתקבל החלטה, בדרך כלל תוך יום עסקים.",
      });
    }

    // =====================================================================
    // מכאן והלאה — הנהלת הפלטפורמה בלבד
    // =====================================================================
    const admin = await platformAdmin(req, supabase);
    if (!admin) return json({ error: "not_platform_admin" }, 403);

    // ---------------------------------------------------------------------
    // list — הערעורים, עם קישור חתום לכל מסמך
    // ---------------------------------------------------------------------
    if (action === "list") {
      const status = ["pending", "approved", "rejected"].includes(body?.status) ? body.status : "pending";
      const { data: rows, error } = await supabase
        .from("broker_license_appeals")
        .select("id, license_number, applicant_name, applicant_email, applicant_phone, source, note, " +
                "status, decision_note, document_path, document_mime, created_at, decided_at")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ error: "db_error", detail: error.message }, 500);

      // קישור חתום לכל שורה. הדלי פרטי, ולכן זו הדרך היחידה לראות את הצילום
      // — והוא פג אחרי עשר דקות.
      const withLinks = await Promise.all((rows ?? []).map(async (row: any) => {
        const { data: signed } = await supabase.storage
          .from(BUCKET).createSignedUrl(row.document_path, SIGNED_URL_SECONDS);
        const { document_path: _omit, ...rest } = row;
        return { ...rest, document_url: signed?.signedUrl ?? null };
      }));

      return json({ success: true, status, appeals: withLinks });
    }

    // ---------------------------------------------------------------------
    // decide — האישור עצמו
    //
    // ‏approve כאן הוא **גם** ההיתר לפתוח משרד: השער קורא את הטבלה הזו לפני
    // שהוא פונה למאגר. ולכן הוא גם משחרר שורת סוכן/ת קיימת שנחסמה — מי
    // שנחסם/ה אחרי שכבר נוצר לו/ה כרטיס (מסלול add-team-member) לא צריך/ה
    // להירשם מחדש.
    // ---------------------------------------------------------------------
    if (action === "decide") {
      const appealId = trimmed(body.appeal_id, 60);
      const decision = body?.decision === "approve" ? "approved"
        : body?.decision === "reject" ? "rejected" : null;
      if (!appealId || !decision) {
        return json({ error: "missing_fields", required: ["appeal_id", "decision"] }, 400);
      }
      const decisionNote = trimmed(body.decision_note, 600) || null;

      const { data: appeal, error: findErr } = await supabase
        .from("broker_license_appeals")
        .select("id, license_number, applicant_name, applicant_email, status")
        .eq("id", appealId)
        .maybeSingle();
      if (findErr) return json({ error: "db_error", detail: findErr.message }, 500);
      if (!appeal) return json({ error: "not_found" }, 404);
      if (appeal.status !== "pending") {
        return json({ error: "already_decided", detail: `הערעור כבר ${appeal.status === "approved" ? "אושר" : "נדחה"}.` }, 409);
      }

      const decidedAt = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("broker_license_appeals")
        .update({ status: decision, decision_note: decisionNote, decided_at: decidedAt, decided_by: admin.userId })
        .eq("id", appeal.id)
        .eq("status", "pending");
      if (updErr) return json({ error: "db_error", detail: updErr.message }, 500);

      // שחרור כרטיס קיים שנחסם על אותו מספר. ‏service_role עוקף את הטריגר
      // שנועל את שדות הרישיון מול הדפדפן, ולכן מה שנכתב כאן הוא מה שנשמר.
      let released = 0;
      if (decision === "approved") {
        const { data: freed } = await supabase
          .from("agency_members")
          .update({
            license_status: "manual",
            license_registry_name: appeal.applicant_name,
            license_checked_at: decidedAt,
            license_approved_at: decidedAt,
            license_approved_by: admin.userId,
          })
          .eq("license_number", appeal.license_number)
          .in("license_status", ["not_found", "inactive"])
          .select("id");
        released = (freed ?? []).length;
      }

      const approved = decision === "approved";
      await sendPlatformEmail({
        to: [appeal.applicant_email],
        subject: approved ? "רישיון התיווך אושר — אפשר להמשיך" : "בקשת אימות רישיון התיווך נדחתה",
        html: `<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.7">
          <p>שלום ${esc(appeal.applicant_name)},</p>
          ${approved
            ? `<p>בדקנו את צילום רישיון התיווך ששלחת (מספר <b>${esc(appeal.license_number)}</b>) ו<b>אישרנו אותו</b>.</p>
               <p>אפשר להמשיך בפתיחת המשרד באתר — הכניסה כבר פתוחה.</p>`
            : `<p>בדקנו את צילום רישיון התיווך ששלחת (מספר <b>${esc(appeal.license_number)}</b>), ולא הצלחנו לאשר אותו.</p>`}
          ${decisionNote ? `<p style="background:#f6f7fb;padding:10px;border-radius:8px">${esc(decisionNote)}</p>` : ""}
          <p style="color:#666;font-size:13px">לשאלות אפשר להשיב למייל הזה
             (<a href="mailto:${esc(PLATFORM_CONTACT_EMAIL)}" style="color:#0e2a6b">${esc(PLATFORM_CONTACT_EMAIL)}</a>).</p>
        </div>`,
        text: approved
          ? `רישיון ${appeal.license_number} אושר. אפשר להמשיך בפתיחת המשרד באתר.${decisionNote ? " " + decisionNote : ""}`
          : `בקשת אימות רישיון ${appeal.license_number} נדחתה.${decisionNote ? " " + decisionNote : ""}`,
      });

      return json({ success: true, status: decision, released_members: released });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
