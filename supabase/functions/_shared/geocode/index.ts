// ============================================================================
// ‏geocodeAddress — המעטפת שמחליטה אם התשובה קבילה
//
// חלוקת התפקידים: **הספק עונה, המעטפת פוסלת.** ספק מחזיר את מה שהשכבה
// אמרה; כאן נבדק אם מותר להאמין לו.
//
// ## אין כאן "אין ספק לעיר", ובכוונה
//
// מפתה להוסיף מצב שלישי (`'no_provider'`) לערך המוחזר. זה היה שובר את
// החוזה שכל `geocode_attempts` נשען עליו - ראו types.ts - כי כל קורא היה
// צריך לזכור להבדיל אותו מ-`null`, ומי שישכח יסמן נכס כ"אין כתובת כזו"
// רק מפני שאין לנו שכבה בעיר שלו.
//
// במקום זה: **אין ספק ⇒ לא קוראים לכאן בכלל.** ‏`loadCitySource` מחזירה
// `null`, והקורא מחזיר תשובה משלו. כך `{lat,lng} | null | throw` נשאר
// בדיוק כפי שהוא, ובלי יוצא מן הכלל.
//
// ## אין fallback בין ספקים
//
// ספק א' שהחזיר `null` וספק ב' שנשאל אחריו הופכים "תשובה סופית"
// לחצי-סופית, והמונה מפסיק להיות כן.
// ============================================================================

import { municipalWfsProvider } from "./providers/municipal-wfs.ts";
import type { GeoBox, GeoHit, GeocodeProvider, GeoSource } from "./types.ts";

const PROVIDERS: Record<string, GeocodeProvider> = {
  municipal_wfs: municipalWfsProvider,
};

/**
 * רמות דיוק שמותר לשמור כפין.
 *
 * ‏`locality` ו-`street` **אינן כאן**: מרכז יישוב או אמצע רחוב נראים כמו
 * הצלחה מושלמת - קואורדינטה תקינה, בתוך התיבה, בעיר הנכונה - ורק הם
 * שגויים במאות מטרים עד קילומטר. ‏docs/property-map.md אוסר אותם.
 */
const ACCEPTED_PRECISION = new Set(["rooftop", "parcel"]);

export function insideCityBox(box: GeoBox | null, lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // תיבה חסרה אינה פוסלת. ספק פעיל **חייב** תיבה (אילוץ ב-
  // city_geocode_sources), ולכן המצב הזה אינו אמור לקרות - ואם בכל זאת,
  // עדיף פין לא מאומת על פני פסילה גורפת של כל העיר בשקט.
  if (!box) return true;
  return lat >= box.latMin && lat <= box.latMax
      && lng >= box.lngMin && lng <= box.lngMax;
}

/**
 * מחזירה `{lat, lng}` או `null` כשאין התאמה. זורקת **רק** על תקלת
 * תקשורת או תצורה - ההבחנה שבראש types.ts.
 */
export async function geocodeAddress(
  source: GeoSource,
  street: string,
  houseNumber: string,
): Promise<{ lat: number; lng: number } | null> {
  const provider = PROVIDERS[source.kind];
  if (!provider) {
    // סוג ספק שאין לו מימוש הוא תקלת תצורה, לא "אין כתובת כזו".
    throw new Error("אין מימוש לספק מסוג " + source.kind + " (" + source.cityName + ")");
  }

  const hit: GeoHit | null = await provider.lookup(source, {
    street: String(street || "").trim(),
    houseNumber: String(houseNumber || "").trim(),
  });
  if (!hit) return null;

  if (!ACCEPTED_PRECISION.has(hit.precision)) {
    console.warn(
      `geocode: נדחה בגלל דיוק ${hit.precision} [${source.cityName} ${street} ${houseNumber}]`,
    );
    return null;
  }

  if (!insideCityBox(source.box, hit.lat, hit.lng)) {
    console.warn(
      `geocode: נדחה מחוץ לתיבה [${source.cityName} ${street} ${houseNumber}] -> ${hit.lat},${hit.lng}`,
    );
    return null;
  }

  return { lat: hit.lat, lng: hit.lng };
}

export { loadCitySource } from "./source.ts";
export { itmToWgs84, wgs84ToItm } from "./itm.ts";
export { MAX_VARIANTS, streetVariants } from "./street-variants.ts";
export type { GeoBox, GeoHit, GeoPrecision, GeoQuery, GeoSource } from "./types.ts";
