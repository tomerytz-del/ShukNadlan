import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 3 §3.4 — הגשת ביקורת מאומתת. האימות האמיתי נאכף כאן,
// בצד השרת — לא טופס פתוח בעמוד: צריך lead_id שהוא (1) קיים, (2) status='unlocked'
// (הוכחה שהיה קשר אמתי עם הסוכן, לא רק מוסתר), (3) ללא כבר יש לו ביקורת
// (unique constraint ב-DB כ-fallback אחרון, אבל בודקים גם כאן מראש לקבל הודה ברורה).

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

// דירוג אופציונלי: null כשלא נשלח, מספר תקין כשנשלח, ו-undefined כשנשלח משהו
// שאינו דירוג — כדי שהקורא יוכל להבדיל בין "לא ענו" לבין "שלחו זבל".
function optionalRating(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return undefined;
  return n;
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

  const { lead_id, rating, agency_rating, text, reviewer_display_name } = body;
  if (!lead_id || !rating) return json({ error: "missing_fields", required: ["lead_id", "rating"] }, 400);
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return json({ error: "invalid_rating" }, 400);
  }

  // הדירוג הישיר של המשרד. שאלה נפרדת ואופציונלית בטופס, ולכן היעדרו תקין
  // לגמרי — אבל ערך לא חוקי הוא באג בצד הלקוח וראוי להיכשל עליו במפורש.
  const agencyRatingNum = optionalRating(agency_rating);
  if (agencyRatingNum === undefined) return json({ error: "invalid_agency_rating" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, status, agency_id, agent_id")
      .eq("id", lead_id)
      .single();

    if (leadErr || !lead) return json({ error: "lead_not_found" }, 404);
    if (lead.status !== "unlocked") {
      return json({ error: "lead_not_eligible", detail: "ניתן לבקש ביקורת רק על ליד שהיה בו קשר בפועל" }, 403);
    }

    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("linked_lead_id", lead_id)
      .maybeSingle();
    if (existing) return json({ error: "review_already_submitted" }, 409);

    const basePayload = {
      agency_id: lead.agency_id,
      agent_id: lead.agent_id,
      linked_lead_id: lead_id,
      rating: ratingNum,
      text: text ?? null,
      reviewer_display_name: reviewer_display_name || "לקוח מאומת",
      status: "pending",
    };

    const insert = (payload: Record<string, unknown>) =>
      supabase.from("reviews").insert(payload).select().single();

    // ‏Edge Functions נפרסות ידנית, ואילו המיגרציות רצות מ-GitHub Actions על
    // מיזוג ל-main — כלומר שני המסלולים לא מסונכרנים, ויש חלון שבו הפונקציה
    // כבר מכירה את agency_rating והעמודה עוד לא קיימת. בלי הנפילה לאחור כאן
    // ביקורת שכללה דירוג משרד הייתה נכשלת לגמרי בחלון הזה, במקום פשוט לאבד
    // את השדה האופציונלי. 42703/PGRST204 = "העמודה לא קיימת".
    let { data: review, error: reviewErr } =
      agencyRatingNum === null
        ? await insert(basePayload)
        : await insert({ ...basePayload, agency_rating: agencyRatingNum });

    if (reviewErr && (reviewErr.code === "42703" || reviewErr.code === "PGRST204") && agencyRatingNum !== null) {
      console.warn("agency_rating column missing — inserting review without it");
      ({ data: review, error: reviewErr } = await insert(basePayload));
    }

    if (reviewErr) {
      // unique constraint race — שני submits כמעט-במקביל על אותו ליד
      if (reviewErr.code === "23505") return json({ error: "review_already_submitted" }, 409);
      return json({ error: "db_error", detail: reviewErr.message }, 500);
    }

    return json({ success: true, review_id: review.id, status: review.status });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
