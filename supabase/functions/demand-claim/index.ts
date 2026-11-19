// ============================================================================
// demand-claim - הלחיצה על פוסט בביקוש הפתוח (/demand?k=)
//
// גבריאלה שולחת לסוכן/ת קישור לפוסט של בעל נכס שמתאים ללקוח/ה. הקישור לא
// פותח את הפוסט ישירות: הוא עובר כאן, כדי ש**הלחיצה תסמן "אני פונה"** (תומר,
// 19.11.2026). הפונקציה קוראת ל-demand_claim_open, שקוראת ל-
// open_demand_claim_core: אותה תקרה יומית, אותה בלעדיות, אותו "לא משתחרר".
// ואז מחזירה את הקישור לפוסט, והדף מעביר אליו.
//
// **למה POST בלבד:** תצוגה מקדימה של קישור בוואטסאפ מבצעת GET על הדף. הדף
// עצמו סטטי, והתפיסה נעשית רק מ-JavaScript, ב-POST לכאן. בוט שאינו מריץ JS
// לא תופס כלום. כאן אין GET בכלל.
//
// **ההרשאה היא הקישור:** 32 תווים אקראיים, 7 ימים, לזוג (סוכן/ת, פוסט) אחד.
// בלי חשבון - אותו עיקרון של planning-link. מי שמחזיק/ה בקישור יכול/ה לתפוס
// את הפוסט הזה בשם הסוכן/ת, ולא יותר: התקרה היומית חלה גם עליו.
//
// docs/scraped-leads.md, "הלחיצה היא אני פונה"
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_BODY = 1_000;

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: cors() });
}

/** מה שהדף מציג. הקודים של המסד, בלי טקסט: הדף כותב את הנוסח בעברית. */
const ERRORS = new Set(["not_found", "taken", "daily_cap", "no_link"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const k = String(body.k || "");
  if (!TOKEN_RE.test(k)) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.rpc("demand_claim_open", { p_token: k });
  if (error) {
    console.warn("demand-claim:", error.message);
    return json({ error: "server" }, 500);
  }
  const res = (data || {}) as Record<string, unknown>;
  if (res.ok === true && typeof res.url === "string") {
    return json({
      ok: true,
      url: res.url,
      already_mine: res.already_mine === true,
      my_today: typeof res.my_today === "number" ? res.my_today : null,
      daily_cap: typeof res.daily_cap === "number" ? res.daily_cap : null,
    });
  }
  const code = typeof res.error === "string" && ERRORS.has(res.error) ? res.error : "not_found";
  return json({ error: code, daily_cap: typeof res.daily_cap === "number" ? res.daily_cap : null }, code === "not_found" ? 404 : 200);
});
