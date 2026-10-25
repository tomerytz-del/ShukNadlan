// ============================================================================
// cma-link - דף דוח ה-CMA (/cma?k=) מול המסד
//
// גבריאלה שולחת כפתור "📊 דוח CMA" עם קישור לדף שמציג את אותו דוח ממותג
// שב-CRM. הפונקציה הזו מחזירה לדף את הדוח (‏cma_link_open - נשמר כמו שהוא
// ברגע ההפקה) ואת המיתוג **של היום**: לוגו וצבעי המשרד, ופרטי הסוכן/ת.
//
// ‏**ההרשאה היא הקישור:** 32 תווים אקראיים, 30 יום. בלי חשבון - את הדוח
// שולחים לבעלים. ‏docs/cma.md, "הקישור לדוח".
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cmaBrand } from "./brand.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_BODY = 2_000;

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: cors() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }

  const k = String(body.k || "");
  if (!TOKEN_RE.test(k)) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase.rpc("cma_link_open", { p_id: k });
  if (error) return json({ error: "server", message: "תקלה זמנית. נסה/י שוב בעוד רגע." }, 500);
  if (!data) {
    return json({ error: "not_found", message: "הקישור לדוח פג תוקף או שאינו תקין. אפשר לבקש מגבריאלה דוח חדש." }, 404);
  }
  const link = data as { agent_id: string; report: Record<string, unknown>; created_at: string; expires_at: string };

  // המיתוג נכשל - הדוח עדיין מוצג, בלי לוגו (כמו loadCmaBrand ב-CRM)
  const { data: agent } = await supabase.from("agency_members")
    .select("display_name, photo_url, phone, email, license_number, agency_id")
    .eq("id", link.agent_id).maybeSingle();
  const { data: agency } = agent?.agency_id
    ? await supabase.from("agencies").select("name, logo_url, colors").eq("id", agent.agency_id).maybeSingle()
    : { data: null };

  return json({
    report: link.report,
    brand: cmaBrand(agent, agency),
    created_at: link.created_at,
    expires_at: link.expires_at,
  });
});
