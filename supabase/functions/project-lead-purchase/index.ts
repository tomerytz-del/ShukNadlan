import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/projects.ts";

// ============================================================================
// רכישת ליד ממדף מחפשי הפרויקטים החדשים
//
// אותה ארכיטקטורה של rss-lead-purchase ו-saved-search-lead-purchase: כל
// ההכרעה — היתרה, ה-unique שמונע מכירה כפולה, וההחזר למי שהפסיד/ה במרוץ —
// יושבת ב-RPC אחד שרץ בטרנזקציה. הפונקציה כאן רק מזהה מי הקונה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const leadId = typeof body.lead_id === "string" ? body.lead_id : null;
  if (!leadId) return json({ error: "missing_lead_id" }, 400);

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: developer } = await supabase
    .from("developers").select("id, status").eq("user_id", userData.user.id).maybeSingle();
  if (!developer) return json({ error: "no_developer_account" }, 403);
  if (developer.status !== "active") return json({ error: "developer_suspended" }, 403);

  const { data, error } = await supabase.rpc("project_lead_purchase", {
    p_lead_id: leadId, p_developer_id: developer.id,
  });
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const statusMap: Record<string, number> = {
    lead_not_found: 404, not_a_shelf_lead: 400, already_sold: 409, insufficient_balance: 402,
  };
  return json(data, data?.error ? (statusMap[data.error] ?? 400) : 200);
});
