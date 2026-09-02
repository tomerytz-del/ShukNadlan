import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// כלי בדיקה בלבד — החלפת מסלול (free/mid/premium) ותפקיד (agent/manager)
// של המשתמש המחובר, כדי לבדוק את המערכת מכל זווית בלי לפתוח חשבונות נפרדים.
//
// שדות tier/role נעולים בטריגר protect_sensitive_agency_member_fields, ולכן
// לא ניתן לשנות אותם מהדפדפן ישירות — השינוי חייב לעבור כאן, עם service_role.
// הגישה מוגבלת ל-is_platform_admin=true בלבד, כדי שסוכן רגיל לא יוכל
// לשדרג את עצמו למסלול בתשלום בחינם.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIERS = ["free", "mid", "premium"];
const ROLES = ["agent", "manager"];

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

  const tier = body.tier === undefined || body.tier === null ? null : String(body.tier);
  const role = body.role === undefined || body.role === null ? null : String(body.role);
  if (tier === null && role === null) return json({ error: "nothing_to_change" }, 400);
  if (tier !== null && !TIERS.includes(tier)) return json({ error: "invalid_tier" }, 400);
  if (role !== null && !ROLES.includes(role)) return json({ error: "invalid_role" }, 400);

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: agentRow, error: agentErr } = await supabase
    .from("agency_members")
    .select("id, tier, role, is_platform_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (agentErr || !agentRow) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agentRow.is_platform_admin) return json({ error: "not_platform_admin" }, 403);

  const changes: Record<string, string> = {};
  if (tier !== null) changes.tier = tier;
  if (role !== null) changes.role = role;

  const { data: updated, error: updErr } = await supabase
    .from("agency_members")
    .update(changes)
    .eq("id", agentRow.id)
    .select("tier, role")
    .single();
  if (updErr) return json({ error: "db_error", detail: updErr.message }, 500);

  return json({ ok: true, tier: updated.tier, role: updated.role, test_mode: true }, 200);
});
