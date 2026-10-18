// ============================================================================
// coach-ask — "שאל את המאמן"
//
// שאלה חופשית לאחד משלושת מאמני ה-AI (docs/coaches.md), מול הסיכום האחרון
// שלו והמספרים של 30 הימים האחרונים. **תשובה בלבד:** אין כאן כלים, אין
// כתיבה למסד מעבר ליומן השאלות, והמאמן לא מבצע שום פעולה.
//
// ‏verify_jwt = true, והקורא/ת נגזר/ת מה-JWT המאומת - לעולם לא מה-body.
// ההרשאה לכל מאמן היא אותה הרשאה של הסיכום שלו:
//   agent  - הסוכן/ת עצמו/ה
//   team   - מנהל/ת הצוות (agency_teams.lead_member_id)
//   office - מנהל/ת המשרד (role = 'manager')
//
// מה יוצא למודל: אותו צמצום של המאמנים (_shared/coach/payload.ts) - אגרגטים,
// ובצוות ובמשרד גם שמות סוכנים. לא טלפונים, לא שמות פונים ולא מזהים.
//
// מגבלה: COACH_ASK_DAILY שאלות ליום לחשבון (ברירת מחדל 10), לפי היום בישראל.
// כל שאלה נרשמת ב-coach_questions עם המודל והטוקנים.
//
// גוף הבקשה: { kind: 'agent' | 'team' | 'office', question: string }
// תשובה:     { answer, remaining }  או  { error }
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { askCoach } from "../_shared/coach/ask.ts";
import type { CoachKind, Row } from "../_shared/coach/payload.ts";

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

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // מי שואל/ת: מה-JWT בכותרת, לא מה-body
  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: me, error: meErr } = await service.from("agency_members")
    .select("id").eq("user_id", userData.user.id).maybeSingle();
  if (meErr) return json({ error: "db_error" }, 500);
  if (!me) return json({ error: "no_matching_agent_profile" }, 403);

  // הלוגיקה כולה ב-_shared/coach/ask.ts, משותפת עם גבריאלה בוואטסאפ
  const r = await askCoach(service, me.id as string, String(body.kind || "") as CoachKind, body.question);
  if ("error" in r) {
    return json({ error: r.error, ...(r.remaining != null ? { remaining: r.remaining } : {}) }, r.status);
  }
  return json(r);
});
