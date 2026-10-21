// ============================================================================
// csm-workspace — אזור ההטמעה (/csm): מנטור ההטמעה וניתוח הקלטות שיחה
//
// ‏verify_jwt = true, ואשת הצוות נגזרת מה-JWT בלבד: ‏csm_staff.user_id, פעילה.
// מנהל/ת פלטפורמה שאינו/ה בצוות אינו/ה נכנס/ת לכאן - המנטור וההקלטות הם
// כלי עבודה של הצוות, והיומן שלהם רשום על איש/אשת צוות.
//
// פעולות (גוף הבקשה { action, ... }):
//   ask_mentor    { question }  → { answer, remaining }     (_shared/coach/csm.ts)
//   analyze_call  { call_id }   → { ok: true } מיד, והעבודה ממשיכה ברקע
//                                 (_shared/csm-call.ts). הדפדפן קורא את השורה
//                                 ב-csm_calls עד done/failed.
//
// כל השאר (הצנרת, הפגישות, המשוב) נכתב מהדפדפן ישירות, תחת RLS של
// current_is_csm(). docs/csm-adoption.md.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { askCsmMentor } from "../_shared/coach/csm.ts";
import { processCsmCall } from "../_shared/csm-call.ts";

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
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: staff, error: staffErr } = await service.from("csm_staff")
    .select("id").eq("user_id", userData.user.id).eq("active", true).maybeSingle();
  if (staffErr) return json({ error: "db_error" }, 500);
  if (!staff) return json({ error: "forbidden" }, 403);

  if (body.action === "ask_mentor") {
    const r = await askCsmMentor(service, staff.id as string, body.question, "web");
    if ("error" in r) return json({ error: r.error, ...(r.remaining != null ? { remaining: r.remaining } : {}) }, r.status);
    return json(r);
  }

  if (body.action === "analyze_call") {
    const id = String(body.call_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "missing_fields" }, 400);
    const { data: call } = await service.from("csm_calls").select("id, status").eq("id", id).maybeSingle();
    if (!call) return json({ error: "not_found" }, 404);
    if (call.status === "processing") return json({ ok: true, already: true });
    // תמלול של שעת שיחה וסיכום לוקחים יותר מבקשה סבירה - ממשיכים ברקע
    const work = processCsmCall(service, id).catch(async (err) => {
      console.error("csm call processing threw", err);
      await service.from("csm_calls").update({ status: "failed", error: "העיבוד נכשל. אפשר לנסות שוב." }).eq("id", id);
    });
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work);
    else await work;
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
