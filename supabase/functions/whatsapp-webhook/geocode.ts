import { afulaAddressToCoords } from "../_shared/afula-geocode.ts";
import { geocodeAddress, loadCitySource } from "../_shared/geocode/index.ts";

// גיאוקוד רחוב+מספר בית -> lat/lng לעפולה, מול שכבת נקודות הכתובות של העירייה.
//
// כאן ישב העתק מלא של הלוגיקה, עם ההערה "אם משנים כאן משהו — לעדכן גם שם".
// זה בדיוק מה שלא קרה כשוריאציות הכתיב שופרו, והוובהוק נשאר עם הצירים
// הישנים. ‏_shared/afula-geocode.ts הוא מודול רגיל ולא Edge Function, ולכן
// אין כאן את מגבלת ה-JWT שבגללה ההעתק נוצר מלכתחילה: אפשר פשוט לייבא.
//
// מה שנשאר כאן הוא העטיפה בלבד — ההבטחה ש**לעולם לא זורקים**. הוובהוק של
// וואטסאפ יוצר נכס בתוך שיחה חיה, ופין על המפה הוא נחמד-שיהיה ולא תנאי
// לפרסום: כתובת שלא נמצאה או WFS שנפל לא יפילו את יצירת הנכס.

/** מחזירה {lat, lng} או null אם הכתובת לא נמצאה / ה-WFS נפל. לעולם לא זורקת. */
export async function geocodeAfula(
  street: string,
  houseNumber: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    return await afulaAddressToCoords(street, houseNumber);
  } catch (err) {
    // פין על המפה זה נחמד-שיהיה, לא תנאי לפרסום הנכס
    console.warn("geocode failed", err);
    return null;
  }
}

/**
 * הגרסה שמכירה עיר, לשימוש כלים שאינם יוצרים נכס.
 *
 * ‏`geocodeAfula` שמעל נשארת כפי שהיא: שני הקוראים שלה יוצרים נכס בעפולה
 * בתוך שיחה, ושינוי שלהם הוא שינוי התנהגות שאינו שייך לכאן.
 *
 * ‏**אותה הבטחה בדיוק - לעולם לא זורקת.** ‏`loadCitySource` זורקת על תקלת
 * מסד ו-`geocodeAddress` זורקת על תקלת רשת או על סוג ספק שאין לו מימוש;
 * שתיהן נבלעות כאן ומוחזרות כ-`null`. זה מותר **רק** מפני שהקורא כאן אינו
 * מזין את `geocode_attempts` - הוא רק מחפש נקודה כדי לשאול עליה שאילתה,
 * ו"לא מצאנו" ו"לא הצלחנו לשאול" מובילים שניהם לאותה נפילה לאחור.
 * במסלול שכן מזין את המונה ההבחנה הזו קדושה; ראו docs/geocoding.md.
 */
// deno-lint-ignore no-explicit-any
export async function geocodeInCity(
  supabase: any,
  city: string,
  street: string,
  houseNumber: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const source = await loadCitySource(supabase, city);
    if (!source) return null;          // אין ספק לעיר - לא שאלה על הכתובת
    return await geocodeAddress(source, street, houseNumber);
  } catch (err) {
    console.warn("geocodeInCity failed", err);
    return null;
  }
}
