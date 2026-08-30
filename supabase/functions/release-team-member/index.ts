import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// השעיית סוכן/ת = ניתוק מהמשרד
//
// עד היום ההשעיה הייתה `active = false` בשורת update ישירה מהדפדפן, והיא לא
// חסמה שום דבר: אף מקום בקוד לא בדק את הדגל בכניסה. כאן היא הופכת לפעולה
// אמיתית עם משמעות אחת ברורה — הסוכן/ת יוצא/ת מהמשרד, ובכניסה הבאה מקבל/ת
// מסך שמסביר זאת ומציע לפתוח משרד משלו/ה. הנכסים עוברים איתו/ה, וזה קורה
// בפועל ב-create-own-agency: שורת ה-agency_members הקיימת **עוברת** למשרד
// החדש עם אותו id, ולכן כל מה שמפתח על agent_id ממשיך להצביע לאותו אדם.
//
// הפעולה עוברת דרך שרת ולא דרך update ישיר משתי סיבות שאי אפשר לאכוף בלקוח:
//   • אסור לנתק את המנהל/ת האחרון/ה — משרד בלי מנהל/ת הוא משרד נעול, שאף
//     אחד לא יכול להוסיף אליו סוכנים או לערוך את המיתוג שלו.
//   • אסור לנתק את עצמך. זו לא "יציאה מהמשרד" אלא נעילה של המשרד מבחוץ.
// שלוש עמודות הניתוק נעולות בטריגר לכתיבה מהשרת בלבד, ולכן זו הדרך היחידה.
//
// ‏undo קיים כל עוד הסוכן/ת עדיין לא פתח/ה משרד: ניתוק בטעות הוא בדיוק סוג
// הטעות שקורית בלחיצה אחת, ובלי חזרה ממנה כל התהליך מפחיד מדי מכדי להשתמש בו.
// ============================================================================

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

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: caller } = await supabase
    .from("agency_members")
    .select("id, agency_id, role, active, released_at")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!caller) return json({ error: "no_matching_agent_profile" }, 403);
  if (!caller.active || caller.released_at) return json({ error: "caller_inactive" }, 403);
  if (caller.role !== "manager") return json({ error: "managers_only" }, 403);

  const memberId = String(body?.member_id || "");
  if (!memberId) return json({ error: "missing_fields", required: ["member_id"] }, 400);

  const { data: member } = await supabase
    .from("agency_members")
    .select("id, agency_id, user_id, role, display_name, released_at")
    .eq("id", memberId)
    .maybeSingle();

  if (!member || member.agency_id !== caller.agency_id) return json({ error: "member_not_found" }, 404);
  if (member.id === caller.id) return json({ error: "cannot_release_self" }, 400);

  const action = body?.action === "undo" ? "undo" : "release";

  try {
    if (action === "undo") {
      if (!member.released_at) return json({ error: "not_released" }, 409);
      const { error } = await supabase
        .from("agency_members")
        .update({ released_at: null, released_from_agency_id: null, released_by: null, active: true })
        .eq("id", memberId);
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      return json({ success: true, undone: true });
    }

    if (member.released_at) return json({ error: "already_released" }, 409);

    // כרטיס שטרם חובר לחשבון אינו "סוכן/ת שעוזב/ת" — אין שם אדם שייכנס
    // ויראה מסך ניתוק. הפעולה הנכונה שם היא ביטול ההזמנה, שגם מוחק את הכרטיס.
    if (!member.user_id) return json({ error: "member_not_joined" }, 409);

    // משרד בלי מנהל/ת פעיל/ה הוא משרד נעול: אי אפשר להוסיף אליו סוכנים,
    // לאשר בקשות שיוך או לערוך מיתוג. הבדיקה כאן ולא בלקוח כי רק כאן היא
    // נעשית על המצב האמיתי ברגע הפעולה.
    if (member.role === "manager") {
      const { count } = await supabase
        .from("agency_members")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", caller.agency_id)
        .eq("role", "manager")
        .eq("active", true)
        .is("released_at", null);
      if ((count ?? 0) <= 1) return json({ error: "last_manager" }, 409);
    }

    const { error } = await supabase
      .from("agency_members")
      .update({
        released_at: new Date().toISOString(),
        released_from_agency_id: member.agency_id,
        released_by: caller.id,
        active: false,
        // תפקיד מנהל/ת שייך למשרד שממנו נותקו, לא לאדם. בלי האיפוס הזה,
        // ביטול ניתוק היה מחזיר אותם כמנהלים בלי שאיש החליט על כך שוב.
        role: "agent",
      })
      .eq("id", memberId);
    if (error) return json({ error: "db_error", detail: error.message }, 500);

    return json({ success: true, released: true, display_name: member.display_name });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
