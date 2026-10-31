import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cleanExternalRef, isInternalCaller, normalizeSource, socialSourceLabel } from "../_shared/lead-routing.ts";
import { writeVisitInsert } from "../_shared/visit-attr.ts";

// מודול 3 §4.2 — פנייה ישירה מדף פרופיל סוכן אישי. אין property_id
// (לא קשורה לנכס ספציפי) — הסוכן כבר ידוע, אז לא דורש מנגנון התאמה.
// אותו כלל auto-unlock כמו property_inquiry: Mid/Premium מידי, Free מוסתר.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { agent_id, name, phone, message } = body;
  if (!agent_id || !name || !phone) {
    return json({ error: "missing_fields", required: ["agent_id", "name", "phone"] }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // מקור ו-external_ref - כמו ב-property-inquiry-intake: מקור חברתי רק מקורא
  // פנימי, וכפילות לפי (source, external_ref) מחזירה את הליד הקיים.
  const trusted = isInternalCaller(req);
  // מקור כלשהו רק מקורא פנימי: עד היום הפונקציה לא כתבה source כלל, ובקרת
  // הלידים גוזרת agent_page_direct מסוג הליד - פנייה מהדף נשארת כך.
  const source = trusted ? normalizeSource(body.source, "", trusted) : "";
  const externalRef = trusted && source ? cleanExternalRef(body.external_ref) : null;
  async function existingLead(): Promise<string | null> {
    if (!externalRef) return null;
    const { data } = await supabase.from("leads").select("id")
      .eq("source", source).eq("external_ref", externalRef).maybeSingle();
    return data?.id ?? null;
  }

  try {
    const dup = await existingLead();
    if (dup) return json({ success: true, duplicate: true, lead_id: dup });

    const { data: agent, error: agentErr } = await supabase
      .from("agency_members")
      .select("id, agency_id, tier, active")
      .eq("id", agent_id)
      .single();

    if (agentErr || !agent) return json({ error: "agent_not_found" }, 404);
    if (!agent.active) return json({ error: "agent_inactive" }, 400);

    const autoUnlock = agent.tier === "mid" || agent.tier === "premium";

    const insertPayload: Record<string, unknown> = {
      lead_type: "agent_direct_inquiry",
      agency_id: agent.agency_id,
      agent_id: agent.id,
      raw_name: name,
      raw_phone: phone,
      raw_message: message ?? null,
    };
    if (source) insertPayload.source = source;
    const detail = socialSourceLabel(source);
    if (detail) insertPayload.source_detail = detail;
    if (externalRef) insertPayload.external_ref = externalRef;

    if (autoUnlock) {
      insertPayload.status = "unlocked";
      insertPayload.quota_source = "subscription_unlimited";
      insertPayload.unlocked_at = new Date().toISOString();
      insertPayload.unlocked_by = agent.id;
    } else {
      insertPayload.status = "masked";
    }

    const { data: lead, error: leadErr } = await writeVisitInsert(
      (payload) => supabase.from("leads").insert(payload).select().single(),
      insertPayload,
      body,
    );
    if (leadErr) {
      if ((leadErr as any).code === "23505") {
        const again = await existingLead();
        if (again) return json({ success: true, duplicate: true, lead_id: again });
      }
      return json({ error: "db_error", detail: leadErr.message }, 500);
    }

    return json({
      success: true,
      lead_id: lead.id,
      auto_unlocked: autoUnlock,
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
