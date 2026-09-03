import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  corsHeaders, email, freeList, intentScore, json, LEAD_PURPOSES, LEAD_TIMELINES,
  longText, num, numberList, oneOf, phoneE164, text,
} from "../_shared/projects.ts";

// ============================================================================
// קליטת ליד של מחפש/ת פרויקט חדש
//
// שני טפסים נכנסים לכאן ומייצרים שתי שורות שונות לגמרי:
//
//   * **פנייה מדף פרויקט** (‏project_slug מלא) — שייכת ליזם של אותו
//     פרויקט, מגיעה אליו מיד וחינם, ואינה נמכרת לאיש. גולש/ת שהשאיר/ה
//     פרטים בדף של פרויקט מסוים ביקש/ה לדבר עם מי שבנה אותו, ולא להיכנס
//     למאגר.
//   * **תיבת "מחפשים פרויקט חדש?"** בדף הפרויקטים (‏project_slug ריק) —
//     ליד גנרי שנכנס למדף ונמכר ליזם אחד.
//
// ‏anon נשלל מ-project_leads לגמרי, ולכן הכתיבה חייבת לעבור כאן:
// שם, טלפון ואימייל של אדם פרטי לא נכתבים ולא נקראים מהדפדפן.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** בלם הצפה: אותו טלפון לא פותח יותר מזה לידים ביממה. */
const MAX_LEADS_PER_PHONE_PER_DAY = 6;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const fullName = text(body.full_name, 120);
  const phone = text(body.phone, 40);
  const e164 = phoneE164(body.phone);

  if (!fullName || !phone) {
    return json({ error: "missing_fields", required: ["full_name", "phone"] }, 400);
  }
  if (!e164) return json({ error: "bad_phone", detail: "מספר הטלפון אינו תקין" }, 400);
  if (body.consent_contact === false) {
    return json({ error: "consent_required", detail: "השארת הפרטים מותנית בהסכמה ליצירת קשר" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("project_leads").select("id").eq("phone_e164", e164).gte("created_at", since);
    if ((recent?.length ?? 0) >= MAX_LEADS_PER_PHONE_PER_DAY) {
      return json({ error: "rate_limited", detail: "השארת יותר מדי פניות היום. נסו שוב מחר." }, 429);
    }

    // ‏slug ולא id: הדף הציבורי מכיר את הפרויקט לפי הכתובת שלו, ואין סיבה
    // לחשוף מזהים פנימיים בטופס. פרויקט שאינו חי לא מקבל פניות — הליד היה
    // נוחת אצל יזם שהדף שלו כבר לא באוויר.
    const projectSlug = text(body.project_slug, 120);
    let projectId: string | null = null;
    let developerId: string | null = null;
    if (projectSlug) {
      const { data: project } = await supabase
        .from("projects_public").select("id, developer_id").eq("slug", projectSlug).maybeSingle();
      if (!project) return json({ error: "project_not_found" }, 404);
      projectId = project.id;
      developerId = project.developer_id;
    }

    const cities = freeList(body.cities, 8, 60);
    const rooms = numberList(body.rooms, 1, 20, 8);
    const maxPrice = num(body.max_price, 0, 500_000_000);
    const timeline = oneOf(body.timeline, LEAD_TIMELINES);
    const message = longText(body.message, 2000);
    const leadEmail = email(body.email);

    const { data, error } = await supabase.from("project_leads").insert({
      project_id: projectId,
      developer_id: developerId,
      full_name: fullName,
      phone,
      phone_e164: e164,
      email: leadEmail,
      message,
      cities,
      rooms,
      min_price: num(body.min_price, 0, 500_000_000),
      max_price: maxPrice,
      timeline,
      purpose: oneOf(body.purpose, LEAD_PURPOSES),
      intent_score: intentScore({ timeline, max_price: maxPrice, rooms, cities, message, email: leadEmail }),
      consent_contact: true,
      source: text(body.source, 60) ?? (projectId ? "project_page" : "projects_page"),
    }).select("id").single();

    if (error) return json({ error: "db_error", detail: error.message }, 500);

    // התשובה לא מחזירה את הליד עצמו, רק שהוא נקלט: הדף הציבורי לא צריך
    // שום דבר ממנו, ומה שלא נשלח לא דולף.
    return json({
      success: true,
      lead_id: data.id,
      direct: !!projectId,
    });
  } catch (err) {
    return json({ error: "unhandled", detail: String((err as Error)?.message ?? err) }, 500);
  }
});
