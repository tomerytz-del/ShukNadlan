import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// גרסת הקוד האתי שהמסך מציג. ראו supabase/functions/agency-signup/index.ts —
// שני מסלולי פתיחת המשרד חייבים להישאר על אותה גרסה.
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const { agency_name, manager_name, license_number, initial_tier } = body;
  if (!agency_name || !manager_name || !license_number) {
    return json({ error: "missing_fields", required: ["agency_name","manager_name","license_number"] }, 400);
  }
  // אישור הקוד האתי הוא תנאי לפתיחת משרד, בשני המסלולים במידה שווה — אחרת
  // המסלול הזה היה הדלת האחורית שעוקפת את הדרישה
  if (body.ethics_code_accepted !== true) {
    return json({ error: "ethics_not_accepted", detail: "פתיחת המשרד מותנית באישור הקוד האתי" }, 400);
  }
  const tier = ["free","mid","premium"].includes(initial_tier) ? initial_tier : "free";

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: existing } = await supabase
    .from("agency_members")
    .select("id, released_at, agencies(name)")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  // שורה קיימת שנותקה מהמשרד אינה "כבר יש לך משרד" — היא בדיוק מי שהמסך
  // הזה נועד לו/ה. במקרה כזה לא נוצרת שורה חדשה: הקיימת **עוברת** למשרד
  // שנפתח כאן, עם אותו id, ואיתה הנכסים. ראו adopt_released_member_into_agency.
  const releasedMember = existing?.released_at ? existing : null;
  if (existing && !releasedMember) {
    return json({ error: "already_has_agency", agency_name: (existing as any).agencies?.name ?? null }, 409);
  }

  try {
    let baseSlug = slugify(agency_name) || "agency";
    let finalSlug = baseSlug;
    let attempt = 1;
    while (true) {
      const { data: taken } = await supabase.from("agencies").select("id").eq("slug", finalSlug).maybeSingle();
      if (!taken) break;
      attempt += 1;
      finalSlug = `${baseSlug}-${attempt}`;
    }

    const { data: agency, error: agencyErr } = await supabase
      .from("agencies").insert({ slug: finalSlug, name: agency_name }).select().single();
    if (agencyErr) return json({ error: "db_error", detail: agencyErr.message }, 500);

    // ----------------------------------------------------------------------
    // מסלול הסוכן/ת שנותק/ה: מעבר במקום יצירה
    // ----------------------------------------------------------------------
    if (releasedMember) {
      const { data: moved, error: moveErr } = await supabase.rpc("adopt_released_member_into_agency", {
        p_member_id: releasedMember.id,
        p_agency_id: agency.id,
        p_display_name: manager_name,
        p_license_number: license_number,
      });

      if (moveErr) {
        // המשרד נמחק כדי שלא יישאר משרד ריק שאיש אינו מנהל שלו, והסוכן/ת
        // נשאר/ת במצב "מנותק/ת" — כלומר יכול/ה פשוט לנסות שוב.
        await supabase.from("agencies").delete().eq("id", agency.id);
        return json({ error: "db_error", detail: moveErr.message }, 500);
      }

      // חתימת הקוד האתי על המשרד החדש. שורת הסוכן/ת כבר חתומה מהמשרד הקודם,
      // והחתימה אישית ולא נמחקת במעבר.
      const { error: agencyEthicsErr } = await supabase
        .from("agencies")
        .update({ ethics_code_accepted_at: new Date().toISOString(), ethics_code_version: ETHICS_CODE_VERSION })
        .eq("id", agency.id);

      return json({
        success: true,
        adopted: true,
        agency_slug: finalSlug,
        member_slug: (moved as any)?.member_slug ?? null,
        tier: (moved as any)?.tier ?? null,
        moved: {
          properties: (moved as any)?.properties_moved ?? 0,
          leads: (moved as any)?.leads_moved ?? 0,
          clients: (moved as any)?.clients_moved ?? 0,
        },
        ethics_recorded: !agencyEthicsErr,
      });
    }

    let memberSlug = slugify(manager_name) || "agent";
    let finalMemberSlug = memberSlug;
    let mAttempt = 1;
    while (true) {
      const { data: taken } = await supabase.from("agency_members").select("id").eq("slug", finalMemberSlug).maybeSingle();
      if (!taken) break;
      mAttempt += 1;
      finalMemberSlug = `${memberSlug}-${mAttempt}`;
    }

    const { data: member, error: memberErr } = await supabase.from("agency_members").insert({
      user_id: userData.user.id,
      agency_id: agency.id,
      slug: finalMemberSlug,
      role: "manager",
      active: true,
      display_name: manager_name,
      email: userData.user.email,
      license_number: license_number,
      tier: tier,
    }).select().single();

    if (memberErr) {
      await supabase.from("agencies").delete().eq("id", agency.id);
      if (memberErr.code === "23505") {
        const { data: nowExisting } = await supabase
          .from("agency_members").select("agencies(name)").eq("user_id", userData.user.id).maybeSingle();
        return json({ error: "already_has_agency", agency_name: (nowExisting as any)?.agencies?.name ?? null }, 409);
      }
      return json({ error: "db_error", detail: memberErr.message }, 500);
    }

    // חתימת הקוד האתי — ראו ההסבר המלא ב-agency-signup: עדכון נפרד אחרי
    // ה-INSERT, כדי שכשל כאן לא יפיל את פתיחת המשרד כולה.
    const ethicsStamp = {
      ethics_code_accepted_at: new Date().toISOString(),
      ethics_code_version: ETHICS_CODE_VERSION,
    };
    const [memberEthics, agencyEthics] = await Promise.all([
      supabase.from("agency_members").update(ethicsStamp).eq("id", member.id),
      supabase.from("agencies").update(ethicsStamp).eq("id", agency.id),
    ]);
    const ethicsRecorded = !memberEthics.error && !agencyEthics.error;
    if (!ethicsRecorded) {
      console.error("ethics stamp failed", memberEthics.error ?? agencyEthics.error);
    }

    return json({ success: true, agency_slug: finalSlug, member_slug: finalMemberSlug, tier, ethics_recorded: ethicsRecorded });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
