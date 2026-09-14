import { afulaAddressToCoords } from "../_shared/afula-geocode.ts";

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
