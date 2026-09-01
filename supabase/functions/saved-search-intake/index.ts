import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { audienceSize, logLeadRouting, normalizeSource } from "../_shared/lead-routing.ts";

// ============================================================================
// שמירת חיפוש של מחפש/ת דירה — "הסוכן החכם".
//
// אותה תבנית כמו mortgage-lead-intake ו-owner-lead-intake: הקורא/ת הוא
// מבקר/ת אנונימי/ת באתר עם ה-anon key, והכתיבה נעשית ב-service_role כי
// ‏saved_searches סגורה ל-anon לגמרי (שם, טלפון ואימייל של אדם פרטי).
//
// ‏שלושה דברים שהפונקציה אחראית עליהם ואי אפשר לסמוך על הדפדפן בהם:
//
//   ‏1. ולידציה של הקריטריונים — לא רק של פרטי הקשר. חיפוש עם max_price=0
//      או עם 200 סוגי נכס הוא חיפוש שיפגיז את התור, ואלה נתונים שמגיעים
//      מדפדפן שאפשר לערוך בו כל שדה.
//   ‏2. תקרה למספר החיפושים לאותו טלפון. בלעדיה כל אחד יכול לפתוח מאה
//      חיפושים ולהפוך את שרת ההתראות לתור אינסופי.
//   ‏3. ‏consent_agent_contact נכתב מהסימון בטופס בלבד, ולעולם לא כברירת
//      מחדל. זה ההבדל בין ליד שמותר למכור לבין ליד שאסור.
//
// ‏החזרה על אותו חיפוש בדיוק אינה שגיאה: המחפש/ת חושב/ת שהוא/היא נרשמ/ה,
// ובאמת נרשמ/ה. מחזירים success עם duplicate=true, בדיוק כמו ב-intake של
// לידי המשכנתאות.
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

/** מספר לא-שלילי בתוך תקרה שפויה, או null. */
function num(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}
function int(value: unknown, min: number, max: number): number | null {
  const n = num(value, Number.MAX_SAFE_INTEGER);
  if (n === null) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

/**
 * רשימת מחרוזות נקייה: בלי ריקים, בלי כפילויות, בתקרת אורך ובתקרת כמות.
 * המיון וההסרה החוזרת של כפילויות נעשים שוב בטריגר saved_searches_normalize —
 * כאן זה בלם גודל, שם זו נורמליזציה.
 */
function strList(value: unknown, maxItems: number, maxLen = 60): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (s && s.length <= maxLen) out.add(s);
    if (out.size >= maxItems) break;
  }
  return [...out];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidList(value: unknown, maxItems: number): string[] {
  return strList(value, maxItems, 36).filter((s) => UUID_RE.test(s));
}

const DEAL_TYPES = ["sale", "rent"];
const CATEGORIES = ["residential", "commercial"];
const CHANNELS = ["whatsapp", "email", "both"];
const CONDITIONS = [
  "new_from_contractor", "new", "renovated", "maintained", "needs_renovation",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ---- פרטי הקשר -----------------------------------------------------------
  const fullName = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  if (fullName.length < 2 || fullName.length > 80) return json({ error: "invalid_name" }, 400);
  if (phone && phone.replace(/\D/g, "").length < 9) return json({ error: "invalid_phone" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);

  let channel = CHANNELS.includes(body.contact_channel) ? body.contact_channel : "whatsapp";
  // ‏הערוץ מותאם למה שבאמת נמסר, ולא נדחה: מי שבחר/ה "וואטסאפ ומייל" ומילא/ה
  // רק טלפון התכוון/ה לקבל התראות, לא לקבל שגיאה. הצמצום כאן שומר על
  // האילוץ saved_searches_reachable מרוצה בלי להפיל את הבקשה.
  if (!phone && !email) return json({ error: "missing_contact" }, 400);
  if (!phone) channel = "email";
  if (!email) channel = "whatsapp";

  // ---- הקריטריונים ---------------------------------------------------------
  const dealType = DEAL_TYPES.includes(body.deal_type) ? body.deal_type : "sale";
  const category = CATEGORIES.includes(body.category) ? body.category : "residential";

  const minPrice = num(body.min_price, 500_000_000);
  const maxPrice = num(body.max_price, 500_000_000);
  const minRooms = num(body.min_rooms, 40);
  const maxRooms = num(body.max_rooms, 40);
  const minSize = num(body.min_size_sqm, 100_000);
  const maxSize = num(body.max_size_sqm, 100_000);
  const minFloor = int(body.min_floor, -5, 200);
  const maxFloor = int(body.max_floor, -5, 200);

  // טווח הפוך הוא תמיד באג בצד הקורא. במקום להחזיר שגיאה שהמחפש/ת לא יכול/ה
  // לתקן, מיישרים — ה-CHECK במסד היה דוחה את השורה כולה.
  const [pMin, pMax] = minPrice !== null && maxPrice !== null && minPrice > maxPrice
    ? [maxPrice, minPrice] : [minPrice, maxPrice];
  const [rMin, rMax] = minRooms !== null && maxRooms !== null && minRooms > maxRooms
    ? [maxRooms, minRooms] : [minRooms, maxRooms];
  const [sMin, sMax] = minSize !== null && maxSize !== null && minSize > maxSize
    ? [maxSize, minSize] : [minSize, maxSize];
  const [fMin, fMax] = minFloor !== null && maxFloor !== null && minFloor > maxFloor
    ? [maxFloor, minFloor] : [minFloor, maxFloor];

  // ‏חיפוש בלי שום קריטריון הוא מנוי לכל נכס שעולה באתר. זו לא בקשה
  // סבירה של מחפש/ת דירה, וזו הצפה ודאית של התור — ולכן נדחית.
  const cities = strList(body.cities, 10);
  const neighborhoodIds = uuidList(body.neighborhood_ids, 20);
  const propertyTypes = strList(body.property_types, 15);
  const features = strList(body.required_features, 20, 40);
  const hasCriteria = pMax !== null || pMin !== null || rMin !== null || rMax !== null ||
    sMin !== null || sMax !== null || fMin !== null || fMax !== null ||
    cities.length > 0 || neighborhoodIds.length > 0 || propertyTypes.length > 0 ||
    features.length > 0;
  if (!hasCriteria) return json({ error: "no_criteria" }, 400);

  const row = {
    full_name: fullName,
    phone: phone || null,
    email: email || null,
    contact_channel: channel,
    label: String(body.label ?? "").trim().slice(0, 200) || null,
    deal_type: dealType,
    category,
    cities,
    neighborhood_ids: neighborhoodIds,
    property_types: propertyTypes,
    min_price: pMin,
    max_price: pMax,
    min_rooms: rMin,
    max_rooms: rMax,
    min_size_sqm: sMin,
    max_size_sqm: sMax,
    min_floor: fMin,
    max_floor: fMax,
    required_features: features,
    condition: CONDITIONS.includes(body.condition) ? body.condition : null,
    free_text: String(body.free_text ?? "").trim().slice(0, 500) || null,
    // ההסכמה נכתבת מהסימון בלבד. ברירת המחדל היא "לא".
    consent_agent_contact: body.consent_agent_contact === true,
  };

  // ‏הכתיבה עצמה, התקרה לאותו טלפון וזיהוי הכפילות — הכול בטרנזקציה אחת
  // ב-create_saved_search. הן נשענות על criteria_hash ועל phone_e164
  // שהטריגר במסד מחשב, ולכן אינן יכולות לחיות כאן: כל ניסיון לספור מראש
  // מהקוד הזה היה מחייב לשכפל את normalize_msisdn ואת חישוב ה-hash.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: result, error } = await serviceClient.rpc("create_saved_search", {
    p_payload: row,
  });

  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const statusMap: Record<string, number> = {
    too_many_searches: 409,
    invalid_criteria: 400,
  };
  if (result?.error) return json(result, statusMap[result.error] ?? 400);

  /* רישום הניתוב.
     ‏חיפוש שמור נכנס למדף לידי מחפשי הדירה רק אם התקיימו *שני* תנאים: אישור
     מפורש ליצירת קשר, וציון התעניינות מעל הרף. הבדיקה כאן היא מול המדף עצמו
     ‏(saved_search_leads_public) ולא מול חישוב מקביל — מדף שמסנן אחרת מהבדיקה
     הוא בדיוק המצב שבו הליד נעלם בלי שאיש ידע.

     כפילות (‏duplicate) אינה נרשמת: לא נוצר ליד חדש, ואין מה לנתב. */
  if (result?.search_id) {
    const consent = row.consent_agent_contact;
    const agents = consent ? await audienceSize(serviceClient, "agent_buyer") : 0;
    let onShelf = false;
    if (consent && agents > 0) {
      const { data: shelfRow } = await serviceClient
        .from("saved_search_leads_public").select("id").eq("id", result.search_id).maybeSingle();
      onShelf = !!shelfRow;
    }

    await logLeadRouting(serviceClient, {
      source: normalizeSource(body.source, "homepage_search_agent"),
      lead_kind: "agent_buyer",
      lead_table: "saved_searches",
      lead_id: result.search_id,
      routing: !consent ? "no_consent" : onShelf ? "shelf" : "unrouted",
      recipients: Math.max(agents, 0),
      reason: !consent
        ? "visitor_declined_agent_contact"
        : onShelf
          ? null
          : agents > 0
            ? "below_min_intent"
            : "no_active_agents",
      summary: [row.label, dealType === "rent" ? "להשכרה" : "למכירה",
                category === "commercial" ? "מסחרי" : null].filter(Boolean).join(" · "),
      deal_type: dealType,
      city: cities[0] ?? null,
      neighborhood_id: neighborhoodIds[0] ?? null,
      property_type: propertyTypes[0] ?? null,
    });
  }

  return json(result, 200);
});
