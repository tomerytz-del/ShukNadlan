import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, email, int, json, phoneE164, safeUrl, slugify, text } from "../_shared/projects.ts";

// ============================================================================
// פתיחת חברה יזמית/קבלנית
//
// המקבילה של agency-signup לעולם הפרויקטים החדשים, ובכוונה פונקציה נפרדת
// ולא דגל בתוכה: פתיחת משרד תיווך חותמת על הקוד האתי, דורשת מספר רישיון
// תיווך ויוצרת שורת agency_members עם tier ומכסה. ליזם אין אף אחד מאלה —
// יש לו חברה, ארנק ופרויקטים. הזלגה של המסלולים זה לתוך זה הייתה מייצרת
// חשבון שהוא חצי סוכן וחצי יזם, ולא ברור לאיזה מסך הוא נכנס.
//
// אין כאן "פתיחת פרויקט": חברה נפתחת ריקה, והפרויקט הראשון נוצר מהדשבורד
// דרך project-manage — שם גם ממתין החיוב של 350 ₪ לחודש. פתיחת החברה
// עצמה חינם, וזו החלטה: יזם צריך לראות את המסך לפני שהוא משלם עליו.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const companyName = text(body.company_name, 120);
  const contactName = text(body.contact_name, 120);
  const contactEmail = email(body.contact_email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!companyName || !contactName || !contactEmail || !password) {
    return json({
      error: "missing_fields",
      required: ["company_name", "contact_name", "contact_email", "password"],
    }, 400);
  }
  if (password.length < 8) {
    return json({ error: "weak_password", detail: "סיסמה צריכה להכיל לפחות 8 תווים" }, 400);
  }
  // אותה דרישה כמו בפתיחת משרד תיווך, מאותה סיבה: התנאים נאכפים בשרת ולא
  // בתיבת סימון בדפדפן.
  if (body.terms_accepted !== true) {
    return json({ error: "terms_not_accepted", detail: "ההצטרפות מותנית באישור תנאי השימוש" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ‏slug ייחודי לחברה. אותה לולאה של agency-signup — היא רצה פעם אחת
    // כמעט תמיד, וכשהיא רצה פעמיים זה בדיוק המקרה שהיא נועדה לו.
    const baseSlug = slugify(companyName, "developer");
    let finalSlug = baseSlug;
    for (let attempt = 2; ; attempt++) {
      const { data: taken } = await supabase
        .from("developers").select("id").eq("slug", finalSlug).maybeSingle();
      if (!taken) break;
      finalSlug = `${baseSlug}-${attempt}`;
      if (attempt > 50) { finalSlug = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`; break; }
    }

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: contactEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: contactName, account_type: "developer" },
    });
    if (authErr || !authUser?.user) {
      return json({ error: "auth_error", detail: authErr?.message || "יצירת משתמש נכשלה" }, 400);
    }

    const { data: developer, error: devErr } = await supabase
      .from("developers")
      .insert({
        user_id: authUser.user.id,
        slug: finalSlug,
        name: companyName,
        legal_name: text(body.legal_name, 160),
        company_number: text(body.company_number, 40),
        tagline: text(body.tagline, 160),
        description: text(body.description, 4000),
        phone: text(body.phone, 40),
        phone_e164: phoneE164(body.phone),
        email: contactEmail,
        website: safeUrl(body.website),
        address: text(body.address, 200),
        city: text(body.city, 80),
        founded_year: int(body.founded_year, 1900, new Date().getFullYear()),
        projects_delivered: int(body.projects_delivered, 0, 5000),
      })
      .select("id, slug")
      .single();

    if (devErr) {
      // rollback ידני — בלי זה נשאר חשבון Auth שאין מאחוריו חברה, ומי
      // שינסה להיכנס איתו יראה דשבורד ריק בלי דרך לתקן.
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return json({ error: "db_error", detail: devErr.message }, 500);
    }

    return json({ success: true, developer_id: developer.id, developer_slug: developer.slug });
  } catch (err) {
    return json({ error: "unhandled", detail: String((err as Error)?.message ?? err) }, 500);
  }
});
