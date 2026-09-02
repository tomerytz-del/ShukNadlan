import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 1 §5.2 — פתיחת ליד (claim). בשונה מניגרת ל-owner-lead-intake:
// זו פעולה שמעבירה כסף — verify_jwt=true בכוונה. הסוכן הפועל נגזר
// מתוך ה-JWT המאומת של הקורא — אף פעם לא מתקבל מה-body. לכן הפונקציה
// הזאת לא ניתנת לבדיקה עד-ל-עד עד שייבנה מנגנון התחברות/כניסה
// של סוכנים אמיתי (Supabase Auth session) — זה מתוכנן, לא פער של ביצוע.

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

  // שלב 1: מי המשתמש המאומת? נגזרת מתוך ה-JWT שניתן בכותרת, לא מה-body
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized", detail: "invalid or expired session" }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // שלב 2: מיפוי user_id -> agency_members.id (הסוכן המייצג)
  const { data: agentRow, error: agentErr } = await serviceClient
    .from("agency_members")
    .select("id, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (agentErr || !agentRow) {
    return json({ error: "no_matching_agent_profile", detail: "המשתמש מחובר אך אין לו פרופיל סוכן משויך" }, 403);
  }
  if (!agentRow.active) {
    return json({ error: "agent_inactive" }, 403);
  }

  // שלב 3: קריאה לפונקציית ה-DB האטומית (מודול 1 §5.2) — היא לא נחשפת ל-anon/authenticated,
  // רק service_role יכול לקרוא לה — זו בדיוק שהפעולה עוברת דרך ה-Edge Function הזו בלבד,
  // לא ניתנת לקריאה ישירה מהפרונט בעקיפת עקיפה.
  const { data: result, error: rpcErr } = await serviceClient.rpc("claim_lead", {
    p_lead_id: lead_id,
    p_agent_id: agentRow.id,
  });

  if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);

  const statusMap: Record<string, number> = {
    lead_not_found: 404,
    already_unlocked: 200,
    claim_in_progress: 409,
    agent_not_found: 403,
    free_tier_not_eligible_owner_lead: 403,
    exclusive_to_another_agent: 403,
    not_your_lead: 403,
    lead_already_claimed_by_someone_else: 409,
    insufficient_balance: 402,
  };

  if (result?.error) {
    return json(result, statusMap[result.error] ?? 400);
  }
  return json(result, 200);
});
