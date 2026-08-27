import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// רכישת ליד ייעוץ משכנתאות — ₪50 מיתרת הארנק.
//
// עותק של rss-lead-purchase: זו פעולה שמעבירה כסף, ולכן verify_jwt=true
// והיועצ/ת הפועל/ת נגזר/ת מה-JWT המאומת בלבד — לעולם לא מה-body. פונקציית
// ה-DB ‏purchase_mortgage_lead נעולה ל-service_role, כך שאין דרך לעקוף את
// הנתיב הזה ולחייב חשבון אחר או לקבל את פרטי הפונה בלי לשלם.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { lead_id } = body;
  if (!lead_id) return json({ error: "missing_lead_id" }, 400);

  // שלב 1: מי המשתמש/ת המאומת/ת? מתוך ה-JWT בכותרת, לא מה-body
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized", detail: "invalid or expired session" }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // שלב 2: מיפוי user_id -> agency_members.id
  const { data: agentRow, error: agentErr } = await serviceClient
    .from("agency_members")
    .select("id, active, is_mortgage_advisor")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (agentErr || !agentRow) {
    return json({ error: "no_matching_agent_profile", detail: "המשתמש מחובר אך אין לו פרופיל משויך" }, 403);
  }
  if (!agentRow.active) {
    return json({ error: "agent_inactive" }, 403);
  }
  // הבדיקה חוזרת גם ב-purchase_mortgage_lead (שם היא הקובעת, בתוך הטרנזקציה).
  // כאן היא רק כדי להחזיר 403 מוקדם בלי לגעת בליד.
  if (!agentRow.is_mortgage_advisor) {
    return json({ error: "not_a_mortgage_advisor" }, 403);
  }

  // שלב 3: הרכישה עצמה — טרנזקציה אחת ב-DB (ניכוי, סימון כנמכר, יומן חיובים)
  const { data: result, error: rpcErr } = await serviceClient.rpc("purchase_mortgage_lead", {
    p_lead_id: lead_id,
    p_agent_id: agentRow.id,
  });

  if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);

  const statusMap: Record<string, number> = {
    lead_not_found: 404,
    lead_not_available: 410,
    lead_already_sold: 409,
    agent_not_found: 403,
    not_a_mortgage_advisor: 403,
    insufficient_balance: 402,
  };

  if (result?.error) {
    return json(result, statusMap[result.error] ?? 400);
  }
  return json(result, 200);
});
