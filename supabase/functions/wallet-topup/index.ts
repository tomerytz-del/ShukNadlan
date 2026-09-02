import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// מודול 4 §5.1.1 — טעינת ארנק, dropdown סגור 100-500 בקפיצות 100.
// TEST MODE: אין עדיין ספק סליקה אמיתי מחובר (Morning/Tranzila/וכו') —
// הטעינה מאושרת מיידית לצורך בדיקה/הדגמה, מסומנת בבירור test_mode=true.
// כשיתחבר ספק אמיתי, רק ה-Edge Function הזו משתנה (קריאת API אמיתת
// לפני אישור הטעינה), הסכימה/ה-DB לא דורשים שינוי.

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
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const amount = Number(body.amount);
  if (![100,200,300,400,500].includes(amount)) {
    return json({ error: "invalid_amount" }, 400);
  }

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: agentRow, error: agentErr } = await supabase
    .from("agency_members").select("id, active").eq("user_id", userData.user.id).maybeSingle();
  if (agentErr || !agentRow) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agentRow.active) return json({ error: "agent_inactive" }, 403);

  const { data: result, error: rpcErr } = await supabase.rpc("process_wallet_topup", {
    p_agent_id: agentRow.id,
    p_amount: amount,
  });
  if (rpcErr) return json({ error: "db_error", detail: rpcErr.message }, 500);
  if (result?.error) return json(result, 400);
  return json({ ...result, test_mode: true }, 200);
});
