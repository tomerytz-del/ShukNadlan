import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 3 §8.2 — קידום ₪20/חודש. נוגעת ב-credit_balance, לכן חוצה לעבור דרך
// Edge Function עם service_role (אחרת הטריגר החדש שחוסם כל כתיבה ישירה ל-agency_members
// שאינה מגיעה מ-service_role) — אותה הארכיטקטורה כמו lead-claim.

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
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { property_id } = body;
  if (!property_id) return json({ error: "missing_property_id" }, 400);

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: agentRow, error: agentErr } = await supabase
    .from("agency_members").select("id, active").eq("user_id", userData.user.id).maybeSingle();
  if (agentErr || !agentRow) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agentRow.active) return json({ error: "agent_inactive" }, 403);

  const { data: result, error: rpcErr } = await supabase.rpc("promote_property", {
    p_property_id: property_id,
    p_agent_id: agentRow.id,
  });
  if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);

  const statusMap: Record<string, number> = {
    not_your_property: 403,
    already_promoted: 409,
    insufficient_balance: 402,
  };
  if (result?.error) return json(result, statusMap[result.error] ?? 400);
  return json(result, 200);
});
