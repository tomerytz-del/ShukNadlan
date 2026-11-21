import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/morning.ts";
import { verifyUnsubToken } from "../_shared/onboarding-unsub.ts";

// ============================================================================
// הסרה מתזכורות מדריך ההתחלה (יזמים ובעלי מקצוע)
//
//   ‏POST {t}  → מסמן את שתי התזכורות כנשלחו ומחזיר {success:true}. JSON בלבד.
//
// **העמוד שהגולש/ת רואה הוא `reminders-off.html` באתר, לא עמוד של הפונקציה:** ‏Supabase מגישה HTML מהדומיין
// הרגיל כ-text/plain עם sandbox (נבדק מול open-house-manage החי), כך שעמוד אישור משם היה מוצג כקוד.
//
// **ההסרה ב-POST בלבד, בלחיצה על כפתור בעמוד:** סורקי קישורים של ספקי מייל פותחים כל כתובת שבהודעה, ו-GET
// שמסיר היה מסיר כל מי שההודעה שלו נסרקה, בלי שנגע בכלום. ‏GET כאן אינו עושה דבר.
//
// **ההרשאה היא חתימת hmac בטוקן** (‏_shared/onboarding-unsub.ts), בלי עמודת טוקן ובלי כניסה. הטוקן מזהה שורה
// אחת בלבד. פרוסה עם verify_jwt=false: הקורא/ת הוא אדם בדפדפן בלי חשבון (CORS פתוח, כמו שאר הפונקציות
// שנקראות מהדפדפן עם אסימון ולא עם עוגייה).
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { t?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const who = await verifyUnsubToken(typeof body.t === "string" ? body.t : "");
  if (!who) return json({ error: "invalid_token" }, 400);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  // מסמנים את שתי התזכורות כנשלחו (p_no = 2): אותו מנגנון שמסמן מי שהשלים את המדריך
  const { error } = who.kind === "developer"
    ? await sb.rpc("mark_developer_onboarding_reminder", { p_developer_id: who.id, p_no: 2 })
    : await sb.rpc("mark_professional_onboarding_reminder", { p_placement_id: who.id, p_no: 2 });
  if (error) {
    console.error("onboarding-reminders-unsubscribe failed", who.kind, error.message);
    return json({ error: "db_error" }, 500);
  }
  return json({ success: true });
});
