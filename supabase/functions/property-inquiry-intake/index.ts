import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 1 (המנגנון המקורי) — פניית קונה/שוכר על נכס קיים.
// שונה מ-owner-lead-intake בנקודה אחת חשובה: אין כאן מנגנון התאמה/רוטציה
// (הסוכן ידוע מראש — property.agent_id) — אבל יש הבדל חשוב לפי tier:
// Mid/Premium מקבלים את הליד פתוח מידית (ללא צורך claim ידני בכלל) —
// זו בדיוק הכוונה המקורית של מודול 1 ("פתוח מלא, ללא הגבלה, ללא תשלום נוסף").
// Free מקבל מוסתר, וצריך לעשות claim בעצמו (מול מכסה/₪10) דרך ה-CRM.

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

  const { property_id, name, phone, message } = body;
  if (!property_id || !name || !phone) {
    return json({ error: "missing_fields", required: ["property_id", "name", "phone"] }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: property, error: propErr } = await supabase
      .from("properties")
      .select("id, agency_id, agent_id, city, property_type, deal_type, status, agency_members(tier)")
      .eq("id", property_id)
      .single();

    if (propErr || !property) return json({ error: "property_not_found" }, 404);
    if (property.status !== "active") return json({ error: "property_not_active" }, 400);

    const tier = (property as any).agency_members?.tier ?? "free";
    const autoUnlock = tier === "mid" || tier === "premium";

    const insertPayload: Record<string, unknown> = {
      lead_type: "property_inquiry",
      deal_type: property.deal_type,
      property_id: property.id,
      agency_id: property.agency_id,
      agent_id: property.agent_id,
      raw_name: name,
      raw_phone: phone,
      raw_message: message ?? null,
      city: property.city,
      property_type: property.property_type,
    };

    if (autoUnlock) {
      insertPayload.status = "unlocked";
      insertPayload.quota_source = "subscription_unlimited";
      insertPayload.unlocked_at = new Date().toISOString();
      insertPayload.unlocked_by = property.agent_id;
    } else {
      insertPayload.status = "masked";
    }

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select()
      .single();

    if (leadErr) return json({ error: "db_error", detail: leadErr.message }, 500);

    // TODO שלב המשך: חיבור notification_service (מודול 6 §4) — Push+CRM→SMS→WhatsApp

    return json({
      success: true,
      lead_id: lead.id,
      auto_unlocked: autoUnlock,
      note: autoUnlock
        ? "הסוכן במסלול פתוח/פרמיום — הליד נפתח מידית, ללא צורך פעולת claim"
        : "הליד נשמר מוסתר — הסוכן יפתח אותו דרך ה-CRM (מכסה חינמית או ₪10)",
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
