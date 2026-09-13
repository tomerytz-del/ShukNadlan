import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { brokerMessage, normalizeLicense } from "../_shared/broker-registry.ts";
import { cachedBrokerLookup, brokerGateEnabled, manuallyApproved } from "../_shared/broker-license-gate.ts";

// ============================================================================
// בדיקת מספר רישיון תיווך מול רשם המתווכים — נקודת הקצה שהטופס קורא
//
// ציבורית (‏verify_jwt=false) כי היא נקראת מטופס פתיחת המשרד, שם עדיין אין
// חשבון. אותה תבנית של company-registry-lookup בדיוק.
//
// **התשובה כאן היא נוחות, לא סמכות.** מי שנרשם/ת יכול/ה לדלג עליה ולשלוח
// את הטופס ישירות — ולכן ארבעת מסלולי הכניסה מריצים את אותה בדיקה בעצמם,
// דרך ‎checkBrokerLicense‎, ואינם סומכים על מה שהדפדפן מספר להם. מה שמוחזר
// כאן משמש רק כדי שהחסימה לא תהיה הפתעה בסוף מילוי הטופס.
//
// שלושה בלמים מול שימוש לרעה, כי היא ציבורית וקוראת לשירות חיצוני:
//   * רק 3–8 ספרות מתקבלות. כל קלט אחר נדחה לפני שיוצאים לרשת.
//   * מטמון של 30 יום. הקלדה חוזרת של אותו מספר אינה מגיעה ל-data.gov.il.
//   * מה שחוזר הוא סטטוס ושם בלבד — לא הרשומה הגולמית מהמאגר, שעשויה
//     להכיל פרטים אישיים נוספים.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
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

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const license = normalizeLicense(body.license_number);
  if (!/^\d{3,8}$/.test(license)) {
    return json({ error: "bad_license_number", detail: "מספר רישיון תיווך צריך להיות בן 3 עד 8 ספרות" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // השער כבוי — אין מה להציג, ואין טעם לצאת לרשת.
  if (!(await brokerGateEnabled(supabase))) {
    return json({ success: true, license_number: license, status: "unverified", name: null, message: "" });
  }

  // אישור ידני גובר על המאגר, וגם כאן: מי שכבר אושר/ה צריך/ה לראות את זה
  // בטופס ולא לקבל "לא נמצא" שמוביל לערעור שני.
  const approved = await manuallyApproved(supabase, license);
  if (approved) {
    return json({
      success: true,
      license_number: license,
      status: "manual",
      name: approved.applicant_name ?? null,
      message: "הרישיון אושר ידנית על ידי הנהלת הפלטפורמה. אפשר להמשיך.",
    });
  }

  const result = await cachedBrokerLookup(supabase, license);

  return json({
    success: true,
    license_number: license,
    status: result.status,
    name: result.name,
    entity_status: result.entity_status,
    message: brokerMessage(result),
  });
});
