import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 2 §5 — מנגנון התאמה/הפצה ללידי בעל-נכס (owner_inbound).
// רץ עם service_role — צריך לקרוא חוצי-סוכנים (agent_lead_preferences של כל הסוכנים
// המתאימים, לא רק של הקורא), משהו RLS פר-שורה רגיל חוסם (מודול 6 §2.1).

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

// קלט חופשי מדף הבית — גוזרים אורך וזורקים ערכים לא-טקסטואליים, כדי שלא
// ייכנס ל-raw_message זבל שיישלח בהמשך ב-SMS/התראה לסוכן.
function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

// מפרט הנכס שהאשף בדף הבית אוסף: חדרים, מצב, ומאפיינים (ממ\"ד/מרפסת/מעלית).
// נשמר בנפרד מהכתובת כי הוא לא מזהה את בעל הנכס — הסוכן רואה אותו גם בליד מוסתר.
function buildPropertyDetails(rooms: unknown, condition: unknown, features: unknown): string | null {
  const parts: string[] = [];
  const roomsText = cleanText(String(rooms ?? ""), 10);
  if (roomsText) parts.push(`${roomsText} חדרים`);
  const conditionText = cleanText(condition, 40);
  if (conditionText) parts.push(conditionText);
  if (Array.isArray(features)) {
    const clean = features.map((f) => cleanText(f, 30)).filter(Boolean).slice(0, 8);
    if (clean.length > 0) parts.push(clean.join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

async function getConfigValue(supabase: any, key: string, fallback: number) {
  const { data } = await supabase.from("pricing_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? fallback;
}

async function findCandidateAgentIds(
  supabase: any,
  neighborhoodId: string | null,
  propertyType: string,
  dealType: string,
): Promise<string[]> {
  const { data: eligibleAgents, error: e1 } = await supabase
    .from("agency_members")
    .select("id")
    .in("tier", ["mid", "premium"])
    .eq("active", true);
  if (e1) throw e1;
  const eligibleIds: string[] = (eligibleAgents ?? []).map((a: any) => a.id);
  if (eligibleIds.length === 0) return [];

  const { data: prefs, error: e2 } = await supabase
    .from("agent_lead_preferences")
    .select("agent_id, preferred_neighborhoods")
    .eq("active", true)
    .in("agent_id", eligibleIds)
    .contains("preferred_property_types", [propertyType])
    .contains("preferred_deal_types", [dealType]);
  if (e2) throw e2;

  if (neighborhoodId) {
    return (prefs ?? [])
      .filter((p: any) => (p.preferred_neighborhoods ?? []).includes(neighborhoodId))
      .map((p: any) => p.agent_id);
  }
  return (prefs ?? []).map((p: any) => p.agent_id);
}

// סדר התור של המועמדים.
//
// עד היום זה היה `.sort()` על ה-UUID — כלומר סדר אקראי לחלוטין. עכשיו הסדר
// נקבע לפי composite_score (הדירוג המשוקלל מ-agent_rankings), דרך
// order_lead_candidates ב-DB.
//
// חשוב מה זה *לא* עושה: אף סוכן/ת לא מסונן/ת ואף אחד לא מקבל יותר לידים.
// הרוטציה למטה עדיין עוברת מועמד-מועמד במחזור מלא, כך שעל פני מחזור כולם
// מקבלים אותה כמות — הדירוג קובע רק מי ראשון בתור. זה שובר-שוויון, לא תחרות.
//
// אם הקריאה נכשלת חוזרים למיון הישן: עדיף חלוקה בסדר שרירותי מאשר ליד שנתקע.
async function orderCandidates(supabase: any, candidateIds: string[]): Promise<string[]> {
  const unique = [...new Set(candidateIds)];
  try {
    const { data, error } = await supabase.rpc("order_lead_candidates", { p_agent_ids: unique });
    if (error) throw error;
    // שמירת רשת: אם ה-RPC החזיר רשימה חלקית מסיבה כלשהי, לא מאבדים מועמדים
    if (Array.isArray(data) && data.length === unique.length) return data;
    console.warn("order_lead_candidates returned unexpected shape, falling back to id sort");
  } catch (err) {
    console.warn("order_lead_candidates failed, falling back to id sort:", String(err));
  }
  return unique.sort();
}

async function pickViaRotation(
  supabase: any,
  neighborhoodId: string | null,
  propertyType: string,
  tierLabel: string,
  candidateIds: string[],
): Promise<string | null> {
  if (candidateIds.length === 0) return null;
  if (candidateIds.length === 1) return candidateIds[0];

  const sorted = await orderCandidates(supabase, candidateIds);

  const { data: rotationRow } = await supabase
    .from("lead_distribution_rotation")
    .select("last_agent_id")
    .eq("neighborhood_id", neighborhoodId)
    .eq("property_type", propertyType)
    .eq("tier", tierLabel)
    .maybeSingle();

  let nextIndex = 0;
  const lastAgentId = rotationRow?.last_agent_id;
  if (lastAgentId) {
    const lastIdx = sorted.indexOf(lastAgentId);
    nextIndex = (lastIdx + 1) % sorted.length;
  }
  const chosen = sorted[nextIndex];

  await supabase.from("lead_distribution_rotation").upsert(
    {
      neighborhood_id: neighborhoodId,
      property_type: propertyType,
      tier: tierLabel,
      last_agent_id: chosen,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "neighborhood_id,property_type,tier" },
  );

  return chosen;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { city, neighborhood_id, property_type, deal_type, address, rooms, condition, features, name, phone } = body;

  if (!city || !property_type || !deal_type || !name || !phone) {
    return json({ error: "missing_fields", required: ["city", "property_type", "deal_type", "name", "phone"] }, 400);
  }
  if (!["sale", "rent"].includes(deal_type)) {
    return json({ error: "invalid_deal_type" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    let matchedAgentId: string | null = null;
    let matchType: "neighborhood" | "fallback" | "none" = "none";

    // שלב 1: התאמה שכונתית מדויקת (מודול 2 §5, שלב 3a)
    if (neighborhood_id) {
      const candidates = await findCandidateAgentIds(supabase, neighborhood_id, property_type, deal_type);
      if (candidates.length > 0) {
        matchedAgentId = await pickViaRotation(supabase, neighborhood_id, property_type, "mid_or_premium", candidates);
        matchType = "neighborhood";
      }
    }

    // שלב 2: fallback — אותו סוג-עסקה/נכס, כל שכונה אחרת (שלב 3b)
    if (!matchedAgentId) {
      const fallbackCandidates = await findCandidateAgentIds(supabase, null, property_type, deal_type);
      if (fallbackCandidates.length > 0) {
        matchedAgentId = await pickViaRotation(supabase, null, property_type, "fallback", fallbackCandidates);
        matchType = "fallback";
      }
    }

    let matchedAgencyId: string | null = null;
    if (matchedAgentId) {
      const { data: agentRow } = await supabase
        .from("agency_members")
        .select("agency_id")
        .eq("id", matchedAgentId)
        .single();
      matchedAgencyId = agentRow?.agency_id ?? null;
    }

    const exclusivityHours = await getConfigValue(supabase, "owner_lead_exclusivity_hours", 12);

    // הכתובת המדויקת היא PII של הליד ולכן נכנסת ל-raw_message (נחשף רק בפתיחה),
    // בעוד מפרט הנכס נשמר בנפרד ומוצג לסוכן כבר בליד המוסתר.
    const cleanAddress = cleanText(address, 160);
    const propertyDetails = buildPropertyDetails(rooms, condition, features);
    const rawMessage = [cleanAddress, propertyDetails].filter(Boolean).join(" · ") || null;

    // שלב 4: הליד הוד-מוסתר תמיד (גם ל-Premium) — מודול 2 §6
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .insert({
        lead_type: "owner_inbound",
        deal_type,
        agent_id: matchedAgentId,
        agency_id: matchedAgencyId,
        status: "masked",
        raw_name: name,
        raw_phone: phone,
        raw_message: rawMessage,
        property_details: propertyDetails,
        city,
        neighborhood_id: neighborhood_id ?? null,
        property_type,
      })
      .select()
      .single();

    if (leadErr) return json({ error: "db_error", detail: leadErr.message }, 500);

    // TODO שלב המשך: חיבור notification_service (Push+CRM→SMS→WhatsApp, מודול 6 §4)
    // כרגע רק יוצר את הליד ומשיב מי שובץ, ללא שליחת התראה בפועל.

    return json({
      success: true,
      lead_id: lead.id,
      match_type: matchType,
      matched_agent_id: matchedAgentId,
      exclusivity_hours: exclusivityHours,
      note: matchedAgentId
        ? "הליד שויך ונשמר במצב מוסתר (masked). שליחת התראה בפועל עדיין לא מוטמעת בשלב זה"
        : "לא נמצא סוכן Mid/Premium מתאים כרגע — הליד נשמר ללא שיוך",
    });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
