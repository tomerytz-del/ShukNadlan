// ============================================================================
// planning-link - דף הבדיקה התכנונית (/plan?k=) מול המסד
//
// גבריאלה לא יכולה לשאול את GovMap מהשרת (מפ"י: צד לקוח בלבד), ולכן היא
// שולחת קישור לדף קטן שעושה את זה בדפדפן של הסוכן/ת. הפונקציה הזו:
//
//   open      - הכתובת של הקישור (‏planning_link_open). קישור לא תקין / שפג -> 404.
//   complete  - התוצאה מהדפדפן: נשמרת (‏planning_link_complete -> _govmap_address_store),
//               ומקבלת את סוג הבעלות מהטאבו (‏land_ownership_of) להצגה בדף.
//
// **אין הודעת וואטסאפ עם התוצאה** (תומר, 22.10.2026): הדף הוא המקום היחיד
// למידע תכנוני מגבריאלה - הוא מציג, משתף ומוריד. הסקיל planning-page.
//
// **ההרשאה היא הקישור:** 32 תווים אקראיים, 7 ימים, ותוצאה אחת. בלי חשבון -
// אחרת חזרנו להתחברות, וזו כל הסיבה לדף. ‏docs/govmap.md, "דף הבדיקה".
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { summarize, targetLabel } from "./summary.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_BODY = 60_000;

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
const gone = () =>
  json({ error: "not_found", message: "הקישור פג תוקף או שכבר אינו תקין. בקש/י מגבריאלה קישור חדש." }, 404);

const OWNERSHIP_LABEL: Record<string, string> = {
  P: "פרטית", S: "מדינה", L: "רשות מקומית", M: "מעורבת", O: "אחר",
};

/** סוג הבעלות בטאבו (docs/land-ownership.md). ‏null = אין במאגר - **לא** "פרטית". */
// deno-lint-ignore no-explicit-any
async function ownershipOf(supabase: any, gush: string | null, helka: string | null) {
  if (!gush || !helka) return null;
  const { data, error } = await supabase.rpc("land_ownership_of", { p_gush: gush, p_helka: helka });
  if (error || !data) return null;
  const row = data as { ownership: string; mixed_units: boolean; as_of: string | null };
  const type = OWNERSHIP_LABEL[row.ownership];
  return type ? { type, mixed_units: !!row.mixed_units, as_of: row.as_of ? String(row.as_of).slice(0, 10) : null } : null;
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

  if (body.action === "open") {
    const { data, error } = await supabase.rpc("planning_link_open", { p_id: k });
    if (error) return json({ error: "server", message: "תקלה זמנית. נסה/י שוב בעוד רגע." }, 500);
    return data ? json({ link: data }) : gone();
  }

  if (body.action === "complete") {
    const summary = summarize(body.record);
    const ownership = summary ? await ownershipOf(supabase, summary.gush, summary.helka) : null;
    const result = summary ? { ...summary, ownership } : null;
    const { data, error } = await supabase.rpc("planning_link_complete", {
      p_id: k, p_record: summary ? body.record : null, p_result: result,
    });
    if (error) {
      console.warn("planning-link complete:", error.message);
      // שדה שהמסד פסל (‏bad_gush וכו') - לא תקלה זמנית; הדף מציג את מה שמצא
      return json({ error: "rejected", message: "לא הצלחנו לשמור את התוצאה, אבל היא מוצגת כאן." }, 422);
    }
    if (!data) return gone();
    const row = data as Record<string, string>;
    console.log("planning-link:", targetLabel(row), row.status);
    return json({ ok: true, status: row.status, ownership });
  }

  return json({ error: "bad_action" }, 400);
});
