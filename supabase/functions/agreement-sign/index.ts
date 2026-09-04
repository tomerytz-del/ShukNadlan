import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail, PLATFORM_CONTACT_EMAIL } from "../_shared/platform-mail-client.ts";

// ============================================================================
// חתימת הסכמי תיווך — ידנית ומרחוק
//
// ‏חמש פעולות בנקודת קצה אחת, בשני מסלולי הרשאה שונים לגמרי:
//
//   ציבורי, לפי אסימון (אין חשבון, אין JWT):
//     • open       — החותם/ת פותח/ת את הקישור ורואה את המסמך
//     • otp_send   — שליחה/שליחה חוזרת של הקוד החד-פעמי
//     • otp_verify — הזנת הקוד, ורק אחריה גוף ההסכם מוחזר
//     • sign       — החותם/ת שולח/ת תמונת חתימה
//     • view       — צפייה בעותק החתום מהקישור הקבוע שבמייל
//
//   מאומת, לפי ה-JWT של הסוכן/ת:
//     • send     — שליחת קישורי חתימה לחותמים
//     • finalize — אחרי החתמה ידנית: שליחת העותק החתום לכל הצדדים
//
// ‏verify_jwt=false, אבל שום דבר כאן אינו פתוח: המסלול הציבורי מחייב אסימון
// של 48 תווים אקראיים ופועל על שורה **אחת** שנמצאת לפיו, והמסלול המאומת
// מוודא שהסוכן/ת אכן בעל/ת ההסכם לפני כל פעולה.
//
// ‏**מה החותם/ת יכול/ה לשלוח: תמונת PNG בלבד.** גוף המסמך נכתב בדפדפן של
// הסוכן/ת ונחסם לשינוי במסד (‏agreements_freeze_body). זו לא החמרה מיותרת:
// אילו החותם/ת היה/הייתה שולח/ת HTML, כל אחד שקיבל קישור היה יכול להזריק
// תוכן למסמך שנשלח אחר כך במייל לצד השני ולסוכן/ת.
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

/* ---------------------------------------------------------------------------
 * עזרי טקסט — עותק מכוון של assets/agreement-doc.js
 *
 * ‏Deno אינו יכול לייבא את קובץ הדפדפן (הוא IIFE שיושב מחוץ לתיקיית
 * הפונקציה, ופריסת Supabase אורזת רק אותה). שלושים שורות משוכפלות עדיפות
 * כאן על צימוד בין תהליך הפריסה של הפונקציות לבין תיקיית assets.
 * ------------------------------------------------------------------------- */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SIGNATURE_RE = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/;
const MAX_SIGNATURE_CHARS = 400_000;   // ‏~300KB אחרי base64 — הרבה מעל חתימה סבירה

function validSignature(src: unknown): src is string {
  return typeof src === "string"
    && src.length > 120
    && src.length <= MAX_SIGNATURE_CHARS
    && SIGNATURE_RE.test(src);
}

interface SignerRow {
  id: string; ord: number; party: string; full_name: string; id_number: string | null;
  id_kind: string | null; phone: string | null; email: string | null;
  signature: string | null; signed_at: string | null; method: string | null;
}

function signatureBlockHtml(signers: SignerRow[]): string {
  const cards = signers.map((s) => {
    const img = validSignature(s.signature)
      ? `<img src="${s.signature}" alt="חתימת ${esc(s.full_name)}" style="max-width:100%;max-height:110px;display:block;margin:0 auto">`
      : `<div style="color:#8a8f96;font-size:12px;text-align:center;padding:34px 0">טרם נחתם</div>`;
    const meta = s.signed_at
      ? `נחתם ב-${esc(new Date(s.signed_at).toLocaleString("he-IL"))}` +
        (s.method === "remote" ? " · חתימה מרחוק" : " · חתימה במעמד הסוכן/ת")
      : "";
    return `<div style="border:1px dashed #9aa0a6;border-radius:8px;padding:10px;margin:0 0 14px">` +
      `<div style="font-weight:700;font-size:13.5px;margin-bottom:6px">${esc(s.full_name)}` +
      `${s.id_number ? ` · ${s.id_kind === "passport" ? "דרכון" : "ת.ז."} ${esc(s.id_number)}` : ""}` +
      `, חתום כאן:</div>` +
      `<div style="min-height:110px;text-align:center">${img}</div>` +
      (meta ? `<div style="font-size:10.5px;color:#565c63;margin-top:6px">${meta}</div>` : "") +
      `</div>`;
  }).join("");

  return `<div dir="rtl" style="direction:rtl;text-align:right;font-family:Heebo,Arial,sans-serif;` +
    `max-width:820px;margin:0 auto;padding:0 24px 26px;color:#1B1F26">` +
    `<p style="font-size:13px;font-weight:600;margin:0 0 12px">בחתימתי, אני מאשר בזאת כי קראתי את ההסכם.</p>` +
    cards + `</div>`;
}

/** מעטפת מייל אחת לשני סוגי ההודעות — אותו ראש, אותו פוטר, אותה כתובת קשר. */
function mailShell(title: string, inner: string): string {
  return `<div dir="rtl" style="direction:rtl;text-align:right;background:#f4f7fe;padding:20px 0;` +
    `font-family:Heebo,Arial,sans-serif;color:#1B1F26">` +
    `<div style="max-width:860px;margin:0 auto;background:#fff;border:1px solid #e3e8f4;border-radius:14px;overflow:hidden">` +
      `<div style="background:#0e2a6b;color:#fff;padding:16px 24px;font-size:16px;font-weight:700">${esc(title)}</div>` +
      inner +
      `<div style="padding:16px 24px;border-top:1px solid #e3e8f4;font-size:11px;color:#565c63">` +
        `נשלח משוק הנדל״ן של עפולה והסביבה · לשאלות: ` +
        `<a href="mailto:${esc(PLATFORM_CONTACT_EMAIL)}" style="color:#0e2a6b">${esc(PLATFORM_CONTACT_EMAIL)}</a>` +
      `</div>` +
    `</div></div>`;
}

const db = createClient(supabaseUrl, serviceRoleKey);

/* ---------------------------------------------------------------------------
 * הקוד החד-פעמי
 *
 * ‏שש ספרות מ-crypto.getRandomValues ולא מ-Math.random: זה מה שחוסם את
 * הקישור, ומחולל פסאודו-אקראי שאפשר לנחש את מצבו אינו חוסם דבר.
 *
 * ‏rejection sampling ולא ‎% 1000000‎ — חלוקה במודולו על טווח שאינו חזקה של
 * שתיים מטה את ההתפלגות לטובת הקודים הנמוכים.
 * ------------------------------------------------------------------------- */
const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 45;

function newOtpCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xFFFFFFFF / 1_000_000) * 1_000_000;
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

/** ‏מזהה החותם/ת נכנס ל-hash כמלח: אותו קוד אצל שניים לא ייתן אותו האש. */
async function hashOtp(code: string, signerId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${signerId}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** השוואה בזמן קבוע — השוואת מחרוזות רגילה מדליפה את אורך הקידומת הנכונה. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ‏a***@gmail.com — מספיק כדי לדעת לאן הקוד הלך, לא מספיק כדי לגלות למי. */
function maskEmail(email: string | null): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return "";
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}

async function issueOtp(signer: { id: string; full_name: string; email: string | null },
                        agreementTitle: string) {
  if (!signer.email) return { sent: false, error: "no_email" as const };

  const code = newOtpCode();
  const hash = await hashOtp(code, signer.id);
  const expires = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

  const inner =
    `<div style="padding:18px 24px;font-size:13px;line-height:1.75">` +
      `<p style="margin:0 0 10px">שלום ${esc(signer.full_name)},</p>` +
      `<p style="margin:0 0 14px">קוד האימות לצפייה ב<b>${esc(agreementTitle)}</b> ולחתימה עליו:</p>` +
      `<p style="margin:0 0 14px;text-align:center">` +
        `<span style="display:inline-block;background:#eaf0fb;color:#0e2a6b;border-radius:10px;` +
        `padding:14px 28px;font-size:30px;font-weight:800;letter-spacing:.22em">${esc(code)}</span></p>` +
      `<p style="margin:0;font-size:11.5px;color:#565c63">הקוד תקף ל-${OTP_TTL_MINUTES} דקות. ` +
      `אם לא ביקשתם לחתום על הסכם — התעלמו מההודעה ואל תמסרו את הקוד לאיש.</p>` +
    `</div>`;

  const result = await sendPlatformEmail({
    to: [signer.email],
    subject: `קוד אימות לחתימה — ${code}`,
    html: mailShell("קוד אימות לחתימה על הסכם", inner),
    text: `קוד האימות שלך לחתימה על "${agreementTitle}" הוא ${code}.\n` +
          `הקוד תקף ל-${OTP_TTL_MINUTES} דקות. אל תמסרו אותו לאיש.`,
  });

  // חותמת הזמן נכתבת גם כשהמייל נכשל: בלעדיה אין ‏cooldown, ולחיצות חוזרות
  // על "שליחה חוזרת" היו מייצרות קוד חדש בכל פעם ופוסלות את הקודם
  await db.from("agreement_signers").update({
    otp_hash: hash,
    otp_sent_at: new Date().toISOString(),
    otp_expires_at: expires,
    otp_attempts: 0,
  }).eq("id", signer.id);

  return { sent: result.sent, error: result.sent ? null : (result.error || "send_failed") };
}

/** כתובת ה-IP של הפונה, כפי שהפרוקסי מוסר אותה. חלק מהראיה, לא מזהה משתמש. */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  return first || req.headers.get("cf-connecting-ip") || null;
}

async function loadByToken(token: string) {
  const { data: signer } = await db
    .from("agreement_signers")
    .select("*")
    .eq("sign_token", token)
    .maybeSingle();
  if (!signer) return { error: "not_found" as const };

  const { data: agreement } = await db
    .from("agreements")
    .select("id, kind, title, status, document_html, verify_code, view_token, signed_at, " +
            "agent_id, agency_id, require_otp, allow_passport")
    .eq("id", signer.agreement_id)
    .maybeSingle();
  if (!agreement) return { error: "not_found" as const };

  return { signer, agreement };
}

async function signersOf(agreementId: string): Promise<SignerRow[]> {
  const { data } = await db
    .from("agreement_signers")
    .select("id, ord, party, full_name, id_number, id_kind, phone, email, signature, signed_at, method")
    .eq("agreement_id", agreementId)
    .order("ord", { ascending: true });
  return (data || []) as SignerRow[];
}

async function agentCard(agentId: string) {
  const { data } = await db
    .from("agency_members")
    .select("display_name, email, phone, agency_id, agencies(name)")
    .eq("id", agentId)
    .maybeSingle();
  const agency = (data as any)?.agencies;
  return {
    name: data?.display_name || "הסוכן/ת",
    email: data?.email || null,
    phone: data?.phone || null,
    agency: Array.isArray(agency) ? agency[0]?.name : agency?.name,
  };
}

/* ---------------------------------------------------------------------------
 * הודעה למנהל/ת המשרד על בלעדיות חדשה
 *
 * ‏רק על בלעדיות. הזמנת תיווך רגילה היא עניין של הסוכן/ת מול הלקוח/ה,
 * ובלעדיות היא התחייבות של המשרד: היא כובלת את הנכס לתקופה, מחייבת פעולות
 * שיווק בפועל, ומטילה על המשרד חשיפה אם הן לא בוצעו.
 *
 * ‏**ההודעה מכילה את מה שהמנהל/ת צריך/ה לדעת ולא יותר** — סוכן/ת, כתובת,
 * מחיר, בעל/ת הנכס ותקופת הבלעדיות. אין בה קישור למסמך עצמו: ה-RLS על
 * agreements מצומצמת לסוכן/ת בכוונה (הסכם הוא מסמך בין הלקוח/ה לסוכן/ת,
 * ומנהל/ת המשרד אינו/ה צד לו), וקישור לעותק המלא היה עוקף את ההחלטה הזו
 * ומוסר גם את ת״ז של הבעלים.
 * ------------------------------------------------------------------------- */
function isExclusive(kind: string): boolean {
  return kind === "exclusive_sell" || kind === "exclusive_landlord";
}

/** ‏dd/mm/yyyy — אותו פורמט שבו תקופת הבלעדיות מודפסת במסמך עצמו. */
function slashDate(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()}`;
}

function shekel(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || isNaN(n)) return "—";
  return "₪" + n.toLocaleString("he-IL");
}

async function notifyManagerOfExclusive(agreementId: string) {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, kind, title, agent_id, agency_id, snapshot, exclusive_from, exclusive_until, " +
            "signed_at, manager_notified_at")
    .eq("id", agreementId)
    .maybeSingle();

  if (!agreement || !isExclusive(agreement.kind)) return { sent: 0 };
  if (agreement.manager_notified_at) return { sent: 0, skipped: "already_notified" };
  if (!agreement.agency_id) return { sent: 0, skipped: "no_agency" };

  // מנהל/ת פעיל/ה במשרד, שאינו/ה הסוכן/ת עצמו/ה: סוכן/ת שהוא/היא גם
  // המנהל/ת כבר קיבל/ה את העותק החתום, והודעה שנייה על עצמו/ה היא רעש
  const { data: managers } = await db
    .from("agency_members")
    .select("id, display_name, email")
    .eq("agency_id", agreement.agency_id)
    .eq("role", "manager")
    .eq("active", true)
    .neq("id", agreement.agent_id);

  const to = (managers || []).map((m) => m.email).filter(Boolean) as string[];
  if (!to.length) return { sent: 0, skipped: "no_manager_email" };

  const agent = await agentCard(agreement.agent_id);
  const snap = (agreement.snapshot ?? {}) as Record<string, any>;
  const fields = (snap.properties?.[0]?.fields ?? {}) as Record<string, string>;

  const street = [fields.address || fields.street, fields.house_number].filter(Boolean).join(" ");
  const address = [street, fields.apartment_number ? "דירה " + fields.apartment_number : "", fields.city]
    .filter(Boolean).join(", ") || snap.property_line || "—";

  const signers = await signersOf(agreement.id);
  const owners = signers.filter((x) => x.party !== "agent").map((x) => x.full_name).filter(Boolean);

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(label)}</td>` +
    `<td style="padding:6px 0 6px 14px">${esc(value)}</td></tr>`;

  const inner =
    `<div style="padding:18px 24px;font-size:13px;line-height:1.75">` +
      `<p style="margin:0 0 12px"><b>${esc(agent.name)}</b> מהמשרד שלך החתים/ה בלעדיות חדשה.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px">` +
        row("סוג ההסכם", agreement.title) +
        row("כתובת הנכס", address) +
        row(agreement.kind === "exclusive_landlord" ? "דמי שכירות מבוקשים" : "מחיר מבוקש",
            shekel(fields.price)) +
        row(owners.length > 1 ? "בעלי הנכס" : "בעל/ת הנכס", owners.join(" · ") || "—") +
        row("תקופת הבלעדיות",
            `${slashDate(agreement.exclusive_from)} — ${slashDate(agreement.exclusive_until)}`) +
        row("נחתם ב-", agreement.signed_at ? new Date(agreement.signed_at).toLocaleString("he-IL") : "—") +
      `</table>` +
      `<p style="margin:14px 0 0;font-size:11.5px;color:#565c63">` +
        `ההודעה נשלחת אוטומטית על כל בלעדיות שנחתמת במשרד. ` +
        `העותק החתום המלא נשלח לצדדים להסכם ולסוכן/ת.</p>` +
    `</div>`;

  const result = await sendPlatformEmail({
    to,
    subject: `בלעדיות חדשה במשרד — ${address}`,
    html: mailShell("בלעדיות חדשה במשרד", inner),
    text: `${agent.name} מהמשרד שלך החתים/ה בלעדיות חדשה.\n` +
          `סוג ההסכם: ${agreement.title}\nכתובת: ${address}\n` +
          `מחיר מבוקש: ${shekel(fields.price)}\nבעל/ת הנכס: ${owners.join(" · ") || "—"}\n` +
          `תקופת הבלעדיות: ${slashDate(agreement.exclusive_from)} — ${slashDate(agreement.exclusive_until)}`,
  });

  // גם כשהשליחה נכשלה: ניסיון חוזר יקרה רק בשליחה חוזרת יזומה של העותק
  // החתום, ועדיף על הודעה כפולה בכל לחיצה
  if (result.sent) {
    await db.from("agreements")
      .update({ manager_notified_at: new Date().toISOString() })
      .eq("id", agreementId);
  }

  return { sent: result.sent ? to.length : 0, error: result.error };
}

/* ---------------------------------------------------------------------------
 * שליחת העותק החתום
 *
 * יוצאת לכל מי שיש לו/לה כתובת: החותמים והסוכן/ת. ‏שליחה שנכשלת אינה
 * מפילה את החתימה — החתימה כבר במסד, והמייל הוא העברת עותק בלבד.
 * ------------------------------------------------------------------------- */
async function sendSignedCopies(agreementId: string) {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, title, document_html, verify_code, view_token, signed_at, agent_id")
    .eq("id", agreementId)
    .maybeSingle();
  if (!agreement) return { sent: 0 };

  const signers = await signersOf(agreementId);
  const agent = await agentCard(agreement.agent_id);
  const viewUrl = `${SITE_BASE_URL}/agreement.html?t=${encodeURIComponent(agreement.view_token)}`;

  const inner =
    `<div style="padding:18px 24px;font-size:13px;line-height:1.7">` +
      `<p style="margin:0 0 10px">שלום,</p>` +
      `<p style="margin:0 0 10px">מצורף העותק החתום של <b>${esc(agreement.title)}</b>, ` +
      `שנחתם מול ${esc(agent.name)}${agent.agency ? " · " + esc(agent.agency) : ""}.</p>` +
      `<p style="margin:0 0 14px">אפשר לצפות בו בכל עת, ולהוריד אותו כקובץ PDF, בקישור הזה:<br>` +
      `<a href="${esc(viewUrl)}" style="color:#0e2a6b;font-weight:700">${esc(viewUrl)}</a></p>` +
      `<p style="margin:0;font-size:11.5px;color:#565c63">קוד אימות המסמך: ` +
      `<b style="letter-spacing:.08em">${esc(agreement.verify_code)}</b></p>` +
    `</div>` +
    `<div style="border-top:1px solid #e3e8f4">${agreement.document_html || ""}</div>` +
    signatureBlockHtml(signers);

  const html = mailShell("העתק חתום — " + agreement.title, inner);
  const text =
    `העותק החתום של "${agreement.title}" מצורף להודעה זו.\n` +
    `צפייה והורדה כ-PDF: ${viewUrl}\n` +
    `קוד אימות המסמך: ${agreement.verify_code}\n`;

  const recipients = new Set<string>();
  signers.forEach((s) => { if (s.email) recipients.add(s.email.trim().toLowerCase()); });
  if (agent.email) recipients.add(agent.email.trim().toLowerCase());

  if (recipients.size === 0) {
    await db.from("agreements")
      .update({ signed_copy_error: "no_recipients" })
      .eq("id", agreementId);
    return { sent: 0, error: "no_recipients" };
  }

  const result = await sendPlatformEmail({
    to: [...recipients],
    subject: `העתק חתום — ${agreement.title}`,
    html,
    text,
  });

  await db.from("agreements").update({
    signed_copy_sent_at: result.sent ? new Date().toISOString() : null,
    signed_copy_error: result.sent ? null : (result.error || "send_failed"),
  }).eq("id", agreementId);

  // בלעדיות מודיעה גם למנהל/ת המשרד. אינה תלויה בהצלחת העותק החתום ואינה
  // מפילה אותו: שתי ההודעות עצמאיות זו מזו.
  const managerNotice = await notifyManagerOfExclusive(agreementId);

  return {
    sent: result.sent ? recipients.size : 0,
    error: result.error,
    manager_notified: managerNotice.sent > 0,
  };
}

/* ---------------------------------------------------------------------------
 * שליחת קישורי חתימה
 * ------------------------------------------------------------------------- */
async function sendSigningLinks(agreementId: string, signerIds?: string[]) {
  const { data: agreement } = await db
    .from("agreements")
    .select("id, title, agent_id, status")
    .eq("id", agreementId)
    .maybeSingle();
  if (!agreement) return { sent: 0, failed: 0 };

  const all = await db
    .from("agreement_signers")
    .select("id, full_name, email, sign_token, signed_at")
    .eq("agreement_id", agreementId)
    .order("ord", { ascending: true });

  let targets = (all.data || []).filter((s) => !s.signed_at && s.email);
  if (signerIds && signerIds.length) targets = targets.filter((s) => signerIds.includes(s.id));

  const agent = await agentCard(agreement.agent_id);
  let sent = 0, failed = 0;

  for (const s of targets) {
    const url = `${SITE_BASE_URL}/sign.html?t=${encodeURIComponent(s.sign_token)}`;
    const inner =
      `<div style="padding:18px 24px;font-size:13px;line-height:1.75">` +
        `<p style="margin:0 0 10px">שלום ${esc(s.full_name)},</p>` +
        `<p style="margin:0 0 10px">${esc(agent.name)}${agent.agency ? " · " + esc(agent.agency) : ""} ` +
        `מבקש/ת ממך לחתום על <b>${esc(agreement.title)}</b>.</p>` +
        `<p style="margin:0 0 6px">אפשר לקרוא את ההסכם המלא ולחתום עליו מהטלפון או מהמחשב, בקישור הזה:</p>` +
        `<p style="margin:0 0 16px">` +
          `<a href="${esc(url)}" style="display:inline-block;background:#0e2a6b;color:#fff;text-decoration:none;` +
          `padding:12px 26px;border-radius:8px;font-weight:700">קריאה וחתימה על ההסכם</a></p>` +
        `<p style="margin:0 0 10px;font-size:11.5px;color:#565c63;word-break:break-all">` +
        `אם הכפתור לא עובד, אפשר להעתיק את הכתובת: ${esc(url)}</p>` +
        `<p style="margin:0;font-size:11.5px;color:#565c63">הקישור אישי — אין להעביר אותו הלאה. ` +
        `אחרי החתימה יישלח אליך העותק החתום המלא.</p>` +
      `</div>`;

    const result = await sendPlatformEmail({
      to: [s.email as string],
      subject: `חתימה על ${agreement.title}`,
      html: mailShell("הסכם ממתין לחתימתך", inner),
      text: `${agent.name} מבקש/ת ממך לחתום על "${agreement.title}".\nקריאה וחתימה: ${url}\n` +
            `הקישור אישי — אין להעביר אותו הלאה.`,
    });

    await db.from("agreement_signers").update({
      mail_sent_at: result.sent ? new Date().toISOString() : null,
      mail_error: result.sent ? null : (result.error || "send_failed"),
    }).eq("id", s.id);

    if (result.sent) sent++; else failed++;
  }

  if (sent > 0 && agreement.status === "draft") {
    await db.from("agreements")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", agreementId);
  }

  return { sent, failed, candidates: targets.length };
}

/* ---------------------------------------------------------------------------
 * המסלול המאומת — הסוכן/ת בעל/ת ההסכם בלבד
 * ------------------------------------------------------------------------- */
async function requireOwningAgent(req: Request, agreementId: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "missing_authorization", status: 401 };

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return { error: "unauthorized", status: 401 };

  const { data: agent } = await db
    .from("agency_members").select("id, active").eq("user_id", userData.user.id).maybeSingle();
  if (!agent) return { error: "no_matching_agent_profile", status: 403 };
  if (!agent.active) return { error: "agent_inactive", status: 403 };

  const { data: agreement } = await db
    .from("agreements").select("id, agent_id").eq("id", agreementId).maybeSingle();
  if (!agreement) return { error: "agreement_not_found", status: 404 };
  if (agreement.agent_id !== agent.id) return { error: "not_your_agreement", status: 403 };

  return { agentId: agent.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = String(body?.action || "");

  // ------------------------------------------------------------------ open --
  if (action === "open") {
    const token = String(body?.token || "");
    if (!token) return json({ error: "missing_token" }, 400);

    const found = await loadByToken(token);
    if ("error" in found) return json({ error: "not_found" }, 404);
    const { signer, agreement } = found;

    if (agreement.status === "cancelled") return json({ error: "cancelled" }, 410);
    if (new Date(signer.token_expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);

    if (!signer.viewed_at) {
      await db.from("agreement_signers").update({ viewed_at: new Date().toISOString() }).eq("id", signer.id);
      if (agreement.status === "sent") {
        await db.from("agreements").update({ status: "viewed", viewed_at: new Date().toISOString() })
          .eq("id", agreement.id).eq("status", "sent");
      }
    }

    /* שער האימות. ‏document_html אינו יוצא מכאן לפני שהקוד הוזן — וזה כל
       העניין: פרטי הנכס בטופס הקונה הם המידע שמוגן, ולא רק החתימה. */
    if (agreement.require_otp && !signer.otp_verified_at && !signer.signed_at) {
      const fresh = signer.otp_sent_at &&
        (Date.now() - new Date(signer.otp_sent_at).getTime()) < OTP_TTL_MINUTES * 60_000;
      if (!fresh) await issueOtp(signer, agreement.title);
      return json({
        ok: true,
        locked: true,
        agreement: { title: agreement.title, kind: agreement.kind, status: agreement.status },
        agent: { name: (await agentCard(agreement.agent_id)).name },
        me: { full_name: signer.full_name, email_masked: maskEmail(signer.email), has_email: !!signer.email },
      });
    }

    const all = await signersOf(agreement.id);
    const agent = await agentCard(agreement.agent_id);

    return json({
      ok: true,
      agreement: {
        title: agreement.title,
        kind: agreement.kind,
        status: agreement.status,
        document_html: agreement.document_html,
        verify_code: agreement.verify_code,
        allow_passport: agreement.allow_passport,
        signed_at: agreement.signed_at,
        view_url: agreement.status === "signed"
          ? `${SITE_BASE_URL}/agreement.html?t=${encodeURIComponent(agreement.view_token)}` : null,
      },
      agent: { name: agent.name, agency: agent.agency, phone: agent.phone },
      me: {
        id: signer.id, full_name: signer.full_name, id_number: signer.id_number,
        party: signer.party, signed_at: signer.signed_at,
      },
      // רק שמות ומצב — לא טלפונים ולא כתובות של הצד השני
      signers: all.map((s) => ({
        full_name: s.full_name, id_kind: s.id_kind, party: s.party, is_me: s.id === signer.id,
        signed: !!s.signed_at, signature: s.signature, signed_at: s.signed_at, method: s.method,
      })),
    });
  }

  // -------------------------------------------------------------- otp_send --
  if (action === "otp_send") {
    const token = String(body?.token || "");
    if (!token) return json({ error: "missing_token" }, 400);

    const found = await loadByToken(token);
    if ("error" in found) return json({ error: "not_found" }, 404);
    const { signer, agreement } = found;

    if (agreement.status === "cancelled") return json({ error: "cancelled" }, 410);
    if (new Date(signer.token_expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);
    if (!signer.email) return json({ error: "no_email" }, 400);

    // ‏cooldown: בלעדיו כל לחיצה מייצרת קוד חדש ופוסלת את זה שכבר בדרך,
    // וגם מאפשרת להשתמש בנו כדי להציף תיבה זרה
    if (signer.otp_sent_at &&
        (Date.now() - new Date(signer.otp_sent_at).getTime()) < OTP_RESEND_SECONDS * 1000) {
      return json({ ok: true, throttled: true, retry_after: OTP_RESEND_SECONDS });
    }

    const out = await issueOtp(signer, agreement.title);
    if (!out.sent) return json({ error: "send_failed", detail: out.error }, 502);
    return json({ ok: true, email_masked: maskEmail(signer.email) });
  }

  // ------------------------------------------------------------ otp_verify --
  if (action === "otp_verify") {
    const token = String(body?.token || "");
    const code = String(body?.code || "").replace(/\D/g, "");
    if (!token) return json({ error: "missing_token" }, 400);
    if (code.length !== 6) return json({ error: "invalid_code" }, 400);

    const found = await loadByToken(token);
    if ("error" in found) return json({ error: "not_found" }, 404);
    const { signer } = found;

    if (!signer.otp_hash || !signer.otp_expires_at) return json({ error: "no_code" }, 409);
    if (new Date(signer.otp_expires_at).getTime() < Date.now()) return json({ error: "code_expired" }, 410);
    if ((signer.otp_attempts ?? 0) >= OTP_MAX_ATTEMPTS) return json({ error: "too_many_attempts" }, 429);

    const hash = await hashOtp(code, signer.id);
    if (!safeEqual(hash, signer.otp_hash)) {
      const attempts = (signer.otp_attempts ?? 0) + 1;
      await db.from("agreement_signers").update({ otp_attempts: attempts }).eq("id", signer.id);
      return json({
        error: "wrong_code",
        attempts_left: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
      }, 401);
    }

    // ‏הקוד וה-hash שלו נמחקים ברגע שהם מומשו — אימות הוא חד-פעמי
    await db.from("agreement_signers").update({
      otp_verified_at: new Date().toISOString(),
      otp_hash: null,
      otp_expires_at: null,
      otp_attempts: 0,
    }).eq("id", signer.id);

    return json({ ok: true });
  }

  // ------------------------------------------------------------------ sign --
  if (action === "sign") {
    const token = String(body?.token || "");
    if (!token) return json({ error: "missing_token" }, 400);
    if (!validSignature(body?.signature)) return json({ error: "invalid_signature" }, 400);

    const found = await loadByToken(token);
    if ("error" in found) return json({ error: "not_found" }, 404);
    const { signer, agreement } = found;

    if (agreement.status === "cancelled") return json({ error: "cancelled" }, 410);
    if (new Date(signer.token_expires_at).getTime() < Date.now()) return json({ error: "expired" }, 410);
    // חתימה חוזרת אינה שגיאה — היא לחיצה כפולה או רענון. לא דורסים חתימה.
    if (signer.signed_at) return json({ ok: true, already_signed: true });

    /* אותו שער כמו ב-open, ושוב בשרת: לקוח שדילג על מסך האימות וקרא ישר
       ל-sign היה חותם בלי שאומת מעולם. */
    if (agreement.require_otp && !signer.otp_verified_at) return json({ error: "otp_required" }, 403);

    const idNumber = typeof body?.id_number === "string" ? body.id_number.trim().slice(0, 20) : "";
    const idKind = body?.id_kind === "passport" ? "passport" : "id_card";

    const { error: updErr } = await db.from("agreement_signers").update({
      signature: body.signature,
      signed_at: new Date().toISOString(),
      signed_ip: clientIp(req),
      signed_ua: (req.headers.get("user-agent") || "").slice(0, 400),
      method: "remote",
      id_number: idNumber || signer.id_number,
      id_kind: idNumber ? idKind : null,
    }).eq("id", signer.id).is("signed_at", null);

    if (updErr) return json({ error: "db_error", detail: updErr.message }, 500);

    // הטריגר במסד כבר עדכן את סטטוס ההסכם; כאן רק בודקים אם נסגר המעגל
    const { data: after } = await db
      .from("agreements").select("status").eq("id", agreement.id).maybeSingle();

    let mail: { sent: number; error?: string | null } = { sent: 0 };
    if (after?.status === "signed") mail = await sendSignedCopies(agreement.id);

    return json({ ok: true, agreement_status: after?.status || "sent", copies_sent: mail.sent });
  }

  // ------------------------------------------------------------------ view --
  if (action === "view") {
    const token = String(body?.token || "");
    if (!token) return json({ error: "missing_token" }, 400);

    const { data: agreement } = await db
      .from("agreements")
      .select("id, title, kind, status, document_html, verify_code, signed_at, created_at, agent_id")
      .eq("view_token", token)
      .maybeSingle();
    if (!agreement) return json({ error: "not_found" }, 404);
    if (agreement.status === "cancelled") return json({ error: "cancelled" }, 410);

    const all = await signersOf(agreement.id);
    const agent = await agentCard(agreement.agent_id);

    return json({
      ok: true,
      agreement: {
        title: agreement.title, kind: agreement.kind, status: agreement.status,
        document_html: agreement.document_html, verify_code: agreement.verify_code,
        signed_at: agreement.signed_at, created_at: agreement.created_at,
      },
      agent: { name: agent.name, agency: agent.agency, phone: agent.phone },
      signers: all.map((s) => ({
        full_name: s.full_name, id_number: s.id_number, id_kind: s.id_kind, party: s.party,
        signature: s.signature, signed_at: s.signed_at, method: s.method,
      })),
    });
  }

  // ------------------------------------------------------------------ send --
  if (action === "send") {
    const agreementId = String(body?.agreement_id || "");
    if (!agreementId) return json({ error: "missing_agreement_id" }, 400);

    const guard = await requireOwningAgent(req, agreementId);
    if ("error" in guard) return json({ error: guard.error }, guard.status);

    const ids = Array.isArray(body?.signer_ids) ? body.signer_ids.map(String) : undefined;
    const result = await sendSigningLinks(agreementId, ids);
    return json({ ok: true, ...result });
  }

  // -------------------------------------------------------------- finalize --
  if (action === "finalize") {
    const agreementId = String(body?.agreement_id || "");
    if (!agreementId) return json({ error: "missing_agreement_id" }, 400);

    const guard = await requireOwningAgent(req, agreementId);
    if ("error" in guard) return json({ error: guard.error }, guard.status);

    const { data: agreement } = await db
      .from("agreements").select("status").eq("id", agreementId).maybeSingle();
    if (agreement?.status !== "signed") return json({ error: "not_fully_signed" }, 409);

    const mail = await sendSignedCopies(agreementId);
    return json({ ok: true, copies_sent: mail.sent, mail_error: mail.error ?? null });
  }

  return json({ error: "unknown_action" }, 400);
});
