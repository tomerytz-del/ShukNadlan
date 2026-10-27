import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { attachToOpenLead, metaAdsSourceLabel } from "../_shared/lead-dedupe.ts";
import {
  cleanExternalRef,
  isInternalCaller,
  logLeadRouting,
  normalizeSource,
  socialSourceLabel,
} from "../_shared/lead-routing.ts";

// מודול 1 (המנגנון המקורי) — פניית קונה/שוכר על נכס קיים.
// שונה מ-owner-lead-intake בנקודה אחת חשובה: אין כאן מנגנון התאמה/רוטציה
// (הסוכן ידוע מראש — property.agent_id) — אבל יש הבדל חשוב לפי tier:
// Mid/Premium מקבלים את הליד פתוח מידית (ללא צורך claim ידני בכלל) —
// זו בדיוק הכוונה המקורית של מודול 1 ("פתוח מלא, ללא הגבלה, ללא תשלום נוסף").
// Free מקבל מוסתר, וצריך לעשות claim בעצמו (מול מכסה או תשלום) דרך ה-CRM.

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
  // מקור מפורש רק מהאוצר הסגור של המסלולים (‏_shared/lead-routing.ts). בלעדיו
  // ‏leads.source נשאר null ובקרת הלידים גוזרת property_page_inquiry מסוג
  // הליד - כמו היום. ליד מטופס של מטא (ads-leads-webhook) נושא
  // meta_ads_property_form, ובלי זה היה נספר כפנייה מדף הנכס.
  //
  // מקור חברתי (‏facebook_dm...) ו-meta_ads_* ו-external_ref - רק מקורא
  // פנימי: ‏social-lead-intake ו-meta-leads (‏service role). מהדפדפן המקור
  // נופל. ‏external_ref של מטא הוא meta_lead_id. ‏docs/social-leads.md.
  const trusted = isInternalCaller(req);
  const source = normalizeSource(body?.source, "", trusted);
  const externalRef = trusted && source ? cleanExternalRef(body?.external_ref) : null;
  if (!property_id || !name || !phone) {
    return json({ error: "missing_fields", required: ["property_id", "name", "phone"] }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  /* אותה פנייה שנשלחת שוב (ניסיון חוזר של גבריאלה, webhook כפול) מחזירה את
     הליד הקיים ולא יוצרת שני. ‏unique (source, external_ref) במסד הוא השומר;
     הבדיקה כאן רק חוסכת את ה-insert שייכשל. */
  async function existingLead(): Promise<string | null> {
    if (!externalRef) return null;
    const { data } = await supabase.from("leads").select("id")
      .eq("source", source).eq("external_ref", externalRef).maybeSingle();
    return data?.id ?? null;
  }

  try {
    const dup = await existingLead();
    if (dup) return json({ success: true, duplicate: true, lead_id: dup });

    const { data: property, error: propErr } = await supabase
      .from("properties")
      // ‏שם המפתח הזר מפורש: ל-properties שני מפתחות ל-agency_members
      // ‏(agent_id ו-referred_by), ו-embed בלי רמז נכשל ב-PGRST201.
      .select("id, agency_id, agent_id, city, property_type, deal_type, status, agency_members!properties_agent_id_fkey(tier)")
      .eq("id", property_id)
      .single();

    if (propErr || !property) return json({ error: "property_not_found" }, 404);
    if (property.status !== "active") return json({ error: "property_not_active" }, 400);

    /* אותו טלפון, אותו נכס, ליד פתוח מ-30 הימים - לא ליד שני ולא התראה
       שנייה. ניסיון חוזר של אותו external_ref כבר חזר למעלה. */
    const merged = await attachToOpenLead(supabase, {
      phone,
      leadType: "property_inquiry",
      matchProperty: true,
      propertyId: property.id,
      source: source || null,
      externalRef,
      message: typeof message === "string" ? message : null,
      sourceLabel: socialSourceLabel(source) || metaAdsSourceLabel(source),
    });
    if (merged) return json({ success: true, duplicate: true, lead_id: merged.lead_id });

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
    if (source) insertPayload.source = source;
    // ‏source_detail מוצג לסוכן/ת בכרטיס - תווית קריאה, לא המזהה של הספק
    const detail = socialSourceLabel(source) || metaAdsSourceLabel(source);
    if (detail) insertPayload.source_detail = detail;
    if (externalRef) insertPayload.external_ref = externalRef;

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

    if (leadErr) {
      // מרוץ: שתי שליחות של אותה פנייה ביחד - השנייה נופלת על ה-unique
      if ((leadErr as any).code === "23505") {
        const again = await existingLead();
        if (again) return json({ success: true, duplicate: true, lead_id: again });
      }
      return json({ error: "db_error", detail: leadErr.message }, 500);
    }

    /* רישום הניתוב (‏docs/lead-routing.md). פנייה על נכס הולכת תמיד לסוכן/ת
       שמפרסם/ת אותו, ולכן assigned. ‏property_page_inquiry - אותו שם שבקרת
       הלידים גוזרת לליד בלי source. */
    await logLeadRouting(supabase, {
      source: source || "property_page_inquiry",
      lead_kind: "agent_buyer",
      lead_table: "leads",
      lead_id: lead.id,
      routing: property.agent_id ? "assigned" : "unrouted",
      recipients: property.agent_id ? 1 : 0,
      reason: property.agent_id ? null : "property_without_agent",
      summary: [property.deal_type === "rent" ? "להשכרה" : "למכירה", property.property_type, property.city]
        .filter(Boolean).join(" · "),
      city: property.city,
      deal_type: property.deal_type,
      property_type: property.property_type,
      assigned_agent_id: property.agent_id,
    });

    // המחיר מ-pricing_config (מה ש-claim_lead גובה בפועל), לא מספר בקוד
    let note = "הסוכן במסלול פתוח/פרמיום - הליד נפתח מידית, ללא צורך פעולת claim";
    if (!autoUnlock) {
      const { data: price } = await supabase.from("pricing_config")
        .select("value").eq("key", "ppl_price_buyer_renter").maybeSingle();
      const n = Number(price?.value);
      note = "הליד נשמר מוסתר - הסוכן יפתח אותו דרך ה-CRM (מכסה חינמית" +
        (Number.isFinite(n) && n > 0 ? ` או ₪${n})` : " או תשלום)");
    }

    return json({
      success: true,
      lead_id: lead.id,
      auto_unlocked: autoUnlock,
      note,
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
