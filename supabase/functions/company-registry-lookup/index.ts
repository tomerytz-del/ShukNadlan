import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { companyNumber, corsHeaders, json } from "../_shared/projects.ts";
import { registryMessage, verifyCompanyNumber } from "../_shared/company-registry.ts";
import { cachedLookup } from "../_shared/registry-cache.ts";

// ============================================================================
// בדיקת ח״פ מול רשם החברות — נקודת הקצה שהטופס קורא
//
// ציבורית (‏verify_jwt=false) כי היא נקראת מטופס ההרשמה, שם עדיין אין חשבון.
// זה בסדר: היא מחזירה מידע שממילא פומבי — שם התאגיד וסטטוסו כפי שהם
// מפורסמים ב-data.gov.il — ואינה כותבת דבר מלבד המטמון.
//
// שני בלמים מול שימוש לרעה, כי היא ציבורית וקוראת לשירות חיצוני:
//   * רק תשע ספרות מתקבלות. כל קלט אחר נדחה לפני שיוצאים לרשת.
//   * מטמון של 30 יום. הקלדה חוזרת של אותו מספר אינה מגיעה ל-data.gov.il.
//
// **התשובה כאן היא נוחות, לא סמכות.** מי שנרשם/ת יכול/ה לדלג עליה לגמרי
// ולשלוח את הטופס ישירות — ולכן developer-signup ו-create_developer
// מריצים את אותה בדיקה בעצמם ואינם סומכים על מה שהדפדפן מספר להם.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const number = companyNumber(body.company_number);
  if (!number) {
    return json({ error: "bad_company_number", detail: "מספר ח״פ צריך להיות בן תשע ספרות" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const result = await cachedLookup(supabase, number, verifyCompanyNumber);

  return json({
    success: true,
    company_number: number,
    status: result.status,
    name: result.name,
    entity_status: result.entity_status,
    registry: result.registry,
    message: registryMessage(result),
  });
});
