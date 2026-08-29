import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// פתיחת משרד חדש ("פתיחת משרד"). זו הדרך היחידה שמישהו נכנסת
// למערכת לראשונה (רובמנו) — אין הרשמה עצמאית לסוכן, רק למשרד.
// משתמש שיוצר משרד הוא אוטומטית role='manager' של המשרד החדש.
// גם למנהל המייסד נדרש מספר רישיון תיווך — סביר: מי שפותח משרד הוא כמעט תמיד גם סוכן/מתווך פעיל, וזה
// עקבי עם ה-CRM שכבר מאפשר למנהל לפעול כסוכן בעצמו (מודול 4 §2.1).

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// גרסת הקוד האתי שהטופס מציג. נשמרת יחד עם האישור, כדי שעדכון עתידי של
// הקוד יוכל לדרוש אישור מחדש בלי לאבד את התיעוד של האישור הקודם.
const ETHICS_CODE_VERSION = "2026-08";

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
function slugify(text: string) {
  return text.trim().toLowerCase()
    .replace(/[^\u0590-\u05FFa-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const { agency_name, manager_name, manager_email, manager_password, license_number } = body;
  if (!agency_name || !manager_name || !manager_email || !manager_password || !license_number) {
    return json({ error: "missing_fields", required: ["agency_name","manager_name","manager_email","manager_password","license_number"] }, 400);
  }
  if (String(manager_password).length < 8) {
    return json({ error: "weak_password", detail: "סיסמה צריכה להכיל לפחות 8 תווים" }, 400);
  }
  // אישור הקוד האתי הוא תנאי להצטרפות, ולכן הוא נבדק בשרת ולא רק בטופס:
  // תיבת סימון בדפדפן היא בקשה מנומסת, זו הדרישה עצמה.
  if (body.ethics_code_accepted !== true) {
    return json({ error: "ethics_not_accepted", detail: "ההצטרפות מותנית באישור הקוד האתי" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // slug יינו למשרד — בדיקת ייחוד עם fallback מספרי (מודול 3 §2.2)
    let baseSlug = slugify(agency_name) || "agency";
    let finalSlug = baseSlug;
    let attempt = 1;
    while (true) {
      const { data: existing } = await supabase.from("agencies").select("id").eq("slug", finalSlug).maybeSingle();
      if (!existing) break;
      attempt += 1;
      finalSlug = `${baseSlug}-${attempt}`;
    }

    const { data: agency, error: agencyErr } = await supabase
      .from("agencies")
      .insert({ slug: finalSlug, name: agency_name })
      .select()
      .single();
    if (agencyErr) return json({ error: "db_error", detail: agencyErr.message }, 500);

    // יצירת משתמש Auth אמתי דרך Admin API — לא INSERT ישיר ל-auth.users כמו שעשיתי
    // לצורכי בדיקה קודם — זהו ה-API הרשמי והיציב עליו (רץ מתוך Edge Function,
    // לא מה-sandbox של הסוכן שלי).
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: manager_email,
      password: manager_password,
      email_confirm: true,
      user_metadata: { full_name: manager_name },
    });
    if (authErr || !authUser?.user) {
      await supabase.from("agencies").delete().eq("id", agency.id); // rollback ידני
      return json({ error: "auth_error", detail: authErr?.message || "יצירת משתמש נכשלה" }, 400);
    }

    let memberSlug = slugify(manager_name) || "agent";
    let finalMemberSlug = memberSlug;
    let mAttempt = 1;
    while (true) {
      const { data: existing } = await supabase.from("agency_members").select("id").eq("slug", finalMemberSlug).maybeSingle();
      if (!existing) break;
      mAttempt += 1;
      finalMemberSlug = `${memberSlug}-${mAttempt}`;
    }

    const { data: member, error: memberErr } = await supabase
      .from("agency_members")
      .insert({
        user_id: authUser.user.id,
        agency_id: agency.id,
        slug: finalMemberSlug,
        role: "manager",
        active: true,
        display_name: manager_name,
        email: manager_email,
        license_number: license_number,
        tier: "free",
      })
      .select()
      .single();

    if (memberErr) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      await supabase.from("agencies").delete().eq("id", agency.id);
      return json({ error: "db_error", detail: memberErr.message }, 500);
    }

    // ---------------------------------------------------------------------
    // אישור הקוד האתי
    //
    // נכתב בעדכון נפרד אחרי ההוספה, ולא כעמודות בתוך ה-INSERT עצמו, בכוונה:
    // כך פונקציה שעלתה לפני שהמיגרציה של תו האיכות הורצה לא מפילה את פתיחת
    // המשרד כולה. במקרה כזה המשרד נפתח כרגיל, האישור פשוט לא נחתם, והמנהל/ת
    // מתבקש/ת לאשר בכניסה הראשונה ל-CRM — אותו מסלול שממילא קיים.
    //
    // ‏service_role עוקף את הטריגרים שנועלים את השדות האלה מול הדפדפן, ולכן
    // החותמת שנכתבת כאן היא זו שנשמרת.
    // ---------------------------------------------------------------------
    const acceptedAt = new Date().toISOString();
    const ethicsStamp = { ethics_code_accepted_at: acceptedAt, ethics_code_version: ETHICS_CODE_VERSION };

    const [memberEthics, agencyEthics] = await Promise.all([
      supabase.from("agency_members").update(ethicsStamp).eq("id", member.id),
      supabase.from("agencies").update(ethicsStamp).eq("id", agency.id),
    ]);
    const ethicsRecorded = !memberEthics.error && !agencyEthics.error;
    if (!ethicsRecorded) {
      console.error("ethics stamp failed", memberEthics.error ?? agencyEthics.error);
    }

    return json({ success: true, agency_slug: finalSlug, member_slug: finalMemberSlug, ethics_recorded: ethicsRecorded });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
