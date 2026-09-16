import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lookupPlanning } from "../_shared/afula-planning.ts";

// ============================================================================
// מידע תכנוני לסוכן/ת מחובר/ת — הכלי ב-CRM ובטופס הנכס
//
// השליפה עצמה יושבת ב-_shared/afula-planning.ts, כי planning-backfill צריכה
// אותה בדיוק והיא רצה מ-cron בלי משתמש/ת. כאן נשאר מה ששייך רק למסלול הזה:
// אימות, בדיקת מסלול Mid/Premium, מטמון של 24 שעות, וכתיבה ל-planning_lookups.
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
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400); }
  const street = body.street, house_number = body.house_number, gush = body.gush, helka = body.helka;
  if (!(street && house_number) && !(gush && helka)) {
    return json({ error: "missing_fields", detail: "צריך street+house_number או gush+helka" }, 400);
  }

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const authResult = await authedClient.auth.getUser();
  if (authResult.error || !authResult.data.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const agentResult = await supabase.from("agency_members").select("id, tier, active").eq("user_id", authResult.data.user.id).maybeSingle();
  const agentRow = agentResult.data;

  if (!agentRow || !agentRow.active) return json({ error: "no_matching_agent_profile" }, 403);
  if (agentRow.tier !== "mid" && agentRow.tier !== "premium") {
    return json({
      error: "upgrade_required",
      detail: "מידע תכנוני מלא זמין רק למנוי Mid/Premium",
      cta: "שדרג למנוי Mid או Premium כדי לקבל מידע על נכסים ללא הגבלה",
    }, 402);
  }

  const lookupKey = (gush && helka) ? (gush + ":" + helka) : (street + ":" + house_number);

  const cachedResult = await supabase.from("planning_lookups").select("*").eq("lookup_key", lookupKey).maybeSingle();
  const cached = cachedResult.data;
  if (cached && new Date(cached.looked_up_at).getTime() > Date.now() - 24 * 60 * 60 * 1000) {
    return json({ success: true, cached: true, data: cached });
  }

  try {
    const result = await lookupPlanning({ street, house_number, gush, helka });
    if (!result.ok) {
      return json({ error: result.error, detail: result.detail }, result.status);
    }

    const upsertResult = await supabase
      .from("planning_lookups")
      .upsert(result.record, { onConflict: "lookup_key" })
      .select().single();
    if (upsertResult.error) return json({ error: "db_error", detail: upsertResult.error.message }, 500);

    return json({ success: true, cached: false, data: upsertResult.data });
  } catch (err) {
    return json({ error: "wfs_error", detail: String((err && err.message) || err) }, 500);
  }
});
