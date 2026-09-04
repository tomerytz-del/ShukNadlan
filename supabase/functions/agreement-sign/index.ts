import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail, PLATFORM_CONTACT_EMAIL } from "../_shared/platform-mail-client.ts";

// ============================================================================
// חתימת הסכמי תיווך — ידנית ומרחוק
//
// ‏חמש פעולות בנקודת קצה אחת, בשני מסלולי הרשאה שונים לגמרי:
//
//   ציבורי, לפי אסימון (אין חשבון, אין JWT):
//     • open   — החותם/ת פותח/ת את הקישור ורואה את המסמך
//     • sign   — החותם/ת שולח/ת תמונת חתימה
//     • view   — צפייה בעותק החתום מהקישור הקבוע שבמייל
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
  phone: string | null; email: string | null;
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
      `${s.id_number ? " · ת.ז. " + esc(s.id_number) : ""}, חתום כאן:</div>` +
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
    .select("id, kind, title, status, document_html, verify_code, view_token, signed_at, agent_id, agency_id")
    .eq("id", signer.agreement_id)
    .maybeSingle();
  if (!agreement) return { error: "not_found" as const };

  return { signer, agreement };
}

async function signersOf(agreementId: string): Promise<SignerRow[]> {
  const { data } = await db
    .from("agreement_signers")
    .select("id, ord, party, full_name, id_number, phone, email, signature, signed_at, method")
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

  return { sent: result.sent ? recipients.size : 0, error: result.error };
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
        full_name: s.full_name, party: s.party, is_me: s.id === signer.id,
        signed: !!s.signed_at, signature: s.signature, signed_at: s.signed_at, method: s.method,
      })),
    });
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

    const idNumber = typeof body?.id_number === "string" ? body.id_number.trim().slice(0, 20) : "";

    const { error: updErr } = await db.from("agreement_signers").update({
      signature: body.signature,
      signed_at: new Date().toISOString(),
      signed_ip: clientIp(req),
      signed_ua: (req.headers.get("user-agent") || "").slice(0, 400),
      method: "remote",
      id_number: idNumber || signer.id_number,
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
        full_name: s.full_name, id_number: s.id_number, party: s.party,
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
