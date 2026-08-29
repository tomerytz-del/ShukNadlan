import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// עריכה עצמית של כרטיסיית בעל-מקצוע ושל עמוד הפרופיל שלה
// (professional-manage.html → professional.html).
//
// אין לבעלי מקצוע חשבון באתר — הם לא סוכנים ולא משרדים — ולכן ההרשאה כאן
// היא אסימון ולא JWT: הקישור שהתקבל בסיום ההרשמה מכיל manage_token, והוא
// המפתח לכרטיסייה *אחת*. האסימון יושב ב-ad_placement_access, טבלה שאין
// אליה גישה מהלקוח בשום מפתח ציבורי, ולכן כל קריאה אליה עוברת דרך כאן עם
// service_role. verify_jwt=false מסיבה זו בדיוק.
//
// שלושה מסלולים: load (טעינת הפרופיל למסך העריכה), save (שמירת מה שמותר
// לערוך) ו-upload (כתובת העלאה חתומה לתמונה). מה שנוגע לכסף ולתקופת
// הפרסום — status, monthly_price, starts_at/ends_at, test_mode — לא נגזר
// מהבקשה בשום מקרה, גם אם נשלח בגוף שלה.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// אותו bucket ציבורי של הנכסים; הנתיב מפריד בין נכסים לבעלי מקצוע, בדיוק
// כמו שתמונות הפרופיל של הסוכנים יושבות בו תחת קידומת משלהן.
const MEDIA_BUCKET = "property-images";
const MAX_GALLERY = 12;

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

const VALID_TYPES = ["mortgage_advisor","appraiser","architect","interior_designer","real_estate_lawyer","general"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// אותו סינון כמו בהרשמה: הכתובות נכנסות ל-href, ל-src ולמקורות של iframe
// בעמוד הציבורי, ולכן רק http/https נשמרים.
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function trimmedOrNull(value: unknown, maxLen = 400): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, maxLen) : null;
}

// רשימות טקסט (שירותים, אזורי פעילות) מגיעות כמערך מהמסך. ריקים יורדים,
// והאורך חסום כדי שלא ייכנס לכאן ספר.
function textList(value: unknown, maxItems: number, maxLen = 120): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((v) => (typeof v === "string" ? v.trim().slice(0, maxLen) : ""))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length ? out : null;
}

function urlList(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map(safeUrl).filter((u): u is string => !!u).slice(0, maxItems);
  return out.length ? out : null;
}

// ‏wa.me ו-tel: מצפים לספרות בלבד עם קידומת מדינה. הקלט מגיע איך שאנשים
// כותבים טלפון (050-1234567, ‎+972 50 …‎), ולכן הנרמול כאן ולא בתצוגה:
// מספר שגוי בעמוד הוא כפתור וואטסאפ שמוביל לשום מקום.
function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  else if (!digits.startsWith("972") && digits.length <= 10) digits = "972" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

function safeEmail(value: unknown): string | null {
  const v = trimmedOrNull(value, 254);
  return v && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : null;
}

function safeYears(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 0 && n <= 80 ? Math.trunc(n) : null;
}

// ‏[^\p{L}\p{N}]‎ משאיר אותיות עבריות ולועזיות וספרות ומחליף את השאר במקף.
// הסיומת מה-id היא מה שמבטיח ייחודיות בלי לולאת ניסיונות מול המסד, והיא
// גם הסיבה ש-slug נקבע פעם אחת ולא מתעדכן עם שינוי שם: קישור שכבר פורסם
// לא אמור להישבר כי מישהו תיקן ניסוח.
function buildSlug(name: string, id: string): string {
  const base = name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (base ? base + "-" : "") + id.slice(0, 6);
}

const CARD_FIELDS = `id, slug, advertiser_name, business_name, advertiser_type, target_region,
  headline, description, services, creative_url, cover_url, gallery_urls, video_url,
  click_url, phone_e164, public_email, license_number, years_experience, service_areas,
  status, starts_at, ends_at`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!UUID_RE.test(token)) return json({ error: "invalid_token" }, 400);

  const action = ["save", "upload"].includes(body.action) ? body.action : "load";
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: access, error: accessErr } = await supabase
      .from("ad_placement_access")
      .select("placement_id")
      .eq("manage_token", token)
      .maybeSingle();

    if (accessErr) return json({ error: "db_error", detail: accessErr.message }, 500);
    // אותה תשובה בדיוק לאסימון לא קיים ולכרטיסייה שנמחקה — אין כאן מה
    // להסגיר על אסימונים של אחרים.
    if (!access) return json({ error: "not_found" }, 404);

    const { data: card, error: readErr } = await supabase
      .from("ad_placements")
      .select(CARD_FIELDS)
      .eq("id", access.placement_id)
      .maybeSingle();
    if (readErr) return json({ error: "db_error", detail: readErr.message }, 500);
    if (!card) return json({ error: "not_found" }, 404);

    if (action === "load") return json({ success: true, card });

    // ------------------------------------------------------------------
    // כתובת העלאה חתומה
    //
    // ה-bucket לא פתוח לכתיבה לאף תפקיד ציבורי, וגם לא צריך להיות: החתימה
    // נוצרת כאן רק אחרי שהאסימון אומת, והדפדפן מעלה איתה ישירות לאחסון.
    // הנתיב נגזר ממזהה הכרטיסייה, כך שאי אפשר לכתוב לתיקייה של מישהו אחר.
    // ------------------------------------------------------------------
    if (action === "upload") {
      const kind = ["cover", "photo", "gallery"].includes(body.kind) ? body.kind : "gallery";
      const path = `professionals/${access.placement_id}/${kind}-${crypto.randomUUID()}.jpg`;
      const { data: signed, error: signErr } = await supabase
        .storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
      if (signErr) return json({ error: "storage_error", detail: signErr.message }, 500);
      const publicUrl = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      return json({ success: true, path, signed_url: signed.signedUrl, token: signed.token, public_url: publicUrl });
    }

    // ------------------------------------------------------------------
    // שמירה
    // ------------------------------------------------------------------
    const advertiser_name = trimmedOrNull(body.advertiser_name, 120);
    if (!advertiser_name) return json({ error: "missing_fields", required: ["advertiser_name"] }, 400);
    if (body.advertiser_type !== undefined && !VALID_TYPES.includes(body.advertiser_type)) {
      return json({ error: "invalid_advertiser_type", allowed: VALID_TYPES }, 400);
    }

    const patch: Record<string, unknown> = {
      advertiser_name,
      business_name: trimmedOrNull(body.business_name, 120),
      headline: trimmedOrNull(body.headline, 160),
      description: trimmedOrNull(body.description, 4000),
      services: textList(body.services, 14),
      service_areas: textList(body.service_areas, 12, 60),
      creative_url: safeUrl(body.creative_url),
      cover_url: safeUrl(body.cover_url),
      gallery_urls: urlList(body.gallery_urls, MAX_GALLERY),
      video_url: safeUrl(body.video_url),
      click_url: safeUrl(body.click_url),
      phone_e164: normalizePhone(body.phone_e164),
      public_email: safeEmail(body.public_email),
      license_number: trimmedOrNull(body.license_number, 40),
      years_experience: safeYears(body.years_experience),
    };
    if (body.advertiser_type !== undefined) patch.advertiser_type = body.advertiser_type;
    if (body.target_region !== undefined) patch.target_region = trimmedOrNull(body.target_region, 80) ?? "עפולה";
    // ה-slug נקבע פעם אחת, בשמירה הראשונה שיש בה שם — ומאז לא זז.
    if (!card.slug) patch.slug = buildSlug(trimmedOrNull(body.business_name, 120) || advertiser_name, card.id);

    const { data: saved, error } = await supabase
      .from("ad_placements")
      .update(patch)
      .eq("id", access.placement_id)
      .select(CARD_FIELDS)
      .maybeSingle();

    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (!saved) return json({ error: "not_found" }, 404);
    return json({ success: true, card: saved });
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
