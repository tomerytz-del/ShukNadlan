import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// רכישת ליד מחפש/ת דירה ממדף הסוכן החכם.
//
// אותה תבנית בדיוק כמו rss-lead-purchase ו-mortgage-lead-purchase: זו פעולה
// שמעבירה כסף, ולכן verify_jwt נשאר דלוק והסוכן/ת הפועל/ת נגזר/ת מה-JWT
// המאומת בלבד — לעולם לא מה-body. ‏purchase_saved_search_lead נעולה
// ל-service_role, כך שאין דרך לעקוף את הנתיב הזה ולקבל את פרטי הקשר בלי
// לשלם, או לחייב סוכן/ת אחר/ת.
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
  const { search_id } = body;
  if (!search_id) return json({ error: "missing_search_id" }, 400);

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
    .select("id, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (agentErr || !agentRow) {
    return json({ error: "no_matching_agent_profile", detail: "המשתמש מחובר אך אין לו פרופיל סוכן משויך" }, 403);
  }
  if (!agentRow.active) return json({ error: "agent_inactive" }, 403);

  // שלב 3: הרכישה — טרנזקציה אחת ב-DB (ניכוי, סימון כנמכר, יומן חיובים)
  const { data: result, error: rpcErr } = await serviceClient.rpc("purchase_saved_search_lead", {
    p_search_id: search_id,
    p_agent_id: agentRow.id,
  });

  if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);

  const statusMap: Record<string, number> = {
    lead_not_found: 404,
    lead_not_available: 410,
    lead_already_sold: 409,
    agent_not_found: 403,
    insufficient_balance: 402,
  };

  if (result?.error) return json(result, statusMap[result.error] ?? 400);
  return json(result, 200);
});
