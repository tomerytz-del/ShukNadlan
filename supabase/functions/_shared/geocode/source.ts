// ============================================================================
// תצורת הספק לעיר
//
// ## המודול אינו יוצר לקוח Supabase, וזו החלטה
//
// הוא מקבל אותו כפרמטר. שתי סיבות מעשיות:
//
// 1. ‏`whatsapp-webhook/geocode.ts` הוא עטיפה טהורה בלי לקוח משלה.
// 2. ‏`geocode-backfill` מריץ לולאה של 25 שורות. שליפה בתוך `geocodeAddress`
//    הייתה 25 הלוך-ושוב מיותרים לכל סבב.
//
// שלושת הקוראים מחזיקים ממילא לקוח `service_role` - הפונקציה במסד פתוחה
// לו בלבד - ולכן זו אינה עלות אלא רק הימנעות מתלות נסתרת.
// ============================================================================

import type { GeoSource } from "./types.ts";

// מטמון לכל isolate. ‏Edge Function חי דקות, ולכן שורה שכובתה
// (`active = false`) עשויה להמשיך להיות מוגשת עד לריענון - וזה מקובל:
// המחיר של דקה נוספת מול שכבה שהוצאה משירות הוא כמה קריאות מיותרות,
// והמחיר של ביטול המטמון הוא שליפה לכל נכס בסבב.
const cache = new Map<string, GeoSource | null>();

// deno-lint-ignore no-explicit-any
type SupabaseLike = { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> };

/**
 * מחזירה את תצורת הספק לעיר, או `null` כשאין לה ספק **פעיל**.
 *
 * **‏`null` כאן אינו "לא נמצאה כתובת".** הוא אומר "אין לנו איפה לחפש
 * בעיר הזו", וזו שאלה אחרת לגמרי. הקורא מטפל בה בעצמו ואינו מעביר אותה
 * ל-`geocodeAddress` - ראו ההסבר שם.
 */
export async function loadCitySource(
  supabase: SupabaseLike,
  city: string,
): Promise<GeoSource | null> {
  const key = String(city || "").trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const { data, error } = await supabase.rpc("city_geocode_source", { p_city: key });
  if (error) {
    // תקלת מסד אינה "אין ספק". לא ממטמנים, וזורקים - אחרת שגיאה רגעית
    // הייתה נצרבת ב-isolate ומשביתה את העיר עד לריענון.
    throw new Error("city_geocode_source failed: " + error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) { cache.set(key, null); return null; }

  const hasBox = row.bbox_lat_min != null && row.bbox_lat_max != null
              && row.bbox_lng_min != null && row.bbox_lng_max != null;

  const source: GeoSource = {
    cityKey: row.city_key,
    cityName: row.city_name,
    kind: row.kind,
    baseUrl: row.base_url,
    referer: row.referer ?? null,
    addressLayer: row.address_layer ?? null,
    parcelLayer: row.parcel_layer ?? null,
    box: hasBox
      ? {
        latMin: Number(row.bbox_lat_min),
        latMax: Number(row.bbox_lat_max),
        lngMin: Number(row.bbox_lng_min),
        lngMax: Number(row.bbox_lng_max),
      }
      : null,
  };

  cache.set(key, source);
  return source;
}

/** לניקוי המטמון בבדיקות. אין לו קורא בפרודקשן. */
export function clearCitySourceCache(): void {
  cache.clear();
}
