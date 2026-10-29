// העברה או העתקה של תמונות בין נכסים של אותו משרד. JWT חובה.
// הקובץ משוכפל. מחיקת קובץ המקור רק אחרי 20 שניות, ורק לכתובת שהועברה
// מהנכס ורק אם אין אליה הפניה. הסרה בטופס לא מוחקת קובץ.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { mfaGate } from "../_shared/mfa-gate.ts";
import { relocatePropertyPhotos, undoRelocation } from "../_shared/photo-relocate.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ ok: false, error: "אין גישה" }, 401);
  const gate = await mfaGate(auth);
  if (gate) return json({ ok: false, error: "צריך לאמת את הכניסה" }, gate.status);
  const { data: member } = await userClient.from("agency_members")
    .select("id").eq("user_id", userData.user.id).eq("active", true).maybeSingle();
  if (!member?.id) return json({ ok: false, error: "אין גישה" }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const admin = createClient(supabaseUrl, serviceKey);
  if (body.action === "undo") {
    const undone = await undoRelocation(admin, String(body.id || ""), member.id);
    return json(undone, undone.ok ? 200 : 409);
  }
  const positions = (Array.isArray(body.positions) ? body.positions : []).map(Number);
  const mode = body.mode === "copy" ? "copy" : "move";
  const place = body.place === "cover" ? "cover" : "end";
  const result = await relocatePropertyPhotos(admin, {
    actorId: member.id,
    fromId: String(body.from_id || ""),
    toId: String(body.to_id || ""),
    positions,
    mode,
    place,
    hash: null,
    baseUrl: supabaseUrl,
  });
  return json(result, result.ok ? 200 : 409);
});
