import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientIp, hashIp } from "../_shared/fair-contact.ts";
import { lawyerVerifyUrl } from "../_shared/lawyer-lead-wa.ts";

// ============================================================================
// קליטת "שאלה לעו"ד" מדף הנכס. ציבורית (verify_jwt = false): הגולש/ת אינו/ה מחובר/ת בהגדרה.
//
// שתי פעולות, ושתיהן אינן מחזירות מידע על אדם אחר:
//   submit {property_id, full_name, phone, email?, question}  -> ליד pending + קישור wa.me עם ההודעה המוכנה
//   status {lead_id}                                           -> {verified: boolean}, ותו לא
//
// **הליד אינו במדף עד שהטלפון אומת.** הפונה שולח/ת "אימות שאלה <קוד>" בוואטסאפ, ו-whatsapp-webhook מעלה אותו
// למדף ב-lawyer_lead_wa_verify (docs/lawyer-leads.md). כרטיס המדף אומר לעו"ד "טלפון מאומת בוואטסאפ", והקליטה עומדת בזה.
//
// כל הכללים (נייד ישראלי, אורכים, נכס פעיל, העיר מהנכס, ליד פתוח אחד לטלפון, בלם הצפה, ניקוי) ב-lawyer_lead_submit.
// כאן רק מה שהמסד אינו יכול לדעת: כתובת הגולש/ת (מגובבת עם מלח, לבלם בלבד) ואוצר המילים של התשובות.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY = 8192;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// שגיאות שהגולש/ת יכול/ה לתקן. כל השאר (db_error) אינו מחזיר את טקסט המסד.
const USER_ERRORS: Record<string, number> = {
  invalid_name: 400,
  invalid_phone: 400,
  invalid_email: 400,
  invalid_question: 400,
  property_not_found: 404,
  rate_limited: 429,
  try_again: 503,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "payload_too_large" }, 413);
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body?.action === "status") {
    const leadId = String(body.lead_id ?? "");
    if (!UUID_RE.test(leadId)) return json({ error: "invalid_lead" }, 400);
    const { data, error } = await supabase.rpc("lawyer_lead_verified", { p_lead_id: leadId });
    if (error) return json({ error: "db_error" }, 500);
    return json({ verified: data === true });
  }

  if (body?.action !== "submit") return json({ error: "unknown_action" }, 400);

  const propertyId = String(body.property_id ?? "");
  if (!UUID_RE.test(propertyId)) return json({ error: "property_not_found" }, 404);

  const ipHash = await hashIp(clientIp(req), Deno.env.get("FAIR_CONTACT_IP_SALT") || "");

  const { data, error } = await supabase.rpc("lawyer_lead_submit", {
    p_property_id: propertyId,
    p_full_name: String(body.full_name ?? ""),
    p_phone: String(body.phone ?? ""),
    p_email: body.email == null ? null : String(body.email),
    p_question: String(body.question ?? ""),
    p_ip_hash: ipHash,
  });

  if (error) {
    console.error("lawyer-lead-intake: submit failed", error.message);
    return json({ error: "db_error" }, 500);
  }
  if (data?.error) return json({ error: data.error }, USER_ERRORS[data.error] ?? 400);

  // כבר במדף (שאלה קודמת מאותו טלפון): הפנייה שלו/ה במערכת, ואין מה לאמת שוב
  if (data.verified === true) {
    return json({ success: true, lead_id: data.lead_id, verified: true, duplicate: !!data.duplicate });
  }

  if (!data.nonce) return json({ error: "db_error" }, 500);
  return json({
    success: true,
    lead_id: data.lead_id,
    verified: false,
    wa_url: lawyerVerifyUrl(String(data.nonce)),
  });
});
