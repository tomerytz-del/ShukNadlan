// ============================================================================
// כתובת בעפולה -> lat/lng   (עטיפה)
//
// **הלוגיקה עברה ל-`_shared/geocode/`.** הקובץ הזה נשאר כעטיפה דקה, בדיוק
// באותה תבנית שבה `share_property_with_partners` נשארה מעל
// `share_property_for_agent`: החתימה, ההרשאה וההתנהגות של הקוראים לא
// השתנו, והמנוע מתחת הוא עכשיו כללי.
//
// ארבעה קוראים תלויים בקובץ הזה, ואף אחד מהם לא נגע בשינוי:
//   - geocode-address/index.ts        המסלול הסינכרוני מה-CRM
//   - geocode-backfill/index.ts       הסורק
//   - whatsapp-webhook/geocode.ts     עטיפה שלעולם אינה זורקת
//   - _shared/afula-planning.ts       מייבא streetVariants
//
// ## למה ספק ספרותי ולא שליפה מהמסד
//
// ‏`city_geocode_sources` כבר מחזיקה את עפולה עם בדיוק הערכים שלמטה
// (מיגרציה 20261213090000). אבל שליפה משם דורשת לקוח `service_role`,
// ול-`whatsapp-webhook/geocode.ts` אין כזה - הוא עטיפה טהורה.
//
// לכן העטיפה בונה את המקור מאותם קבועים **שישבו כאן קודם**, מילה במילה.
// התוצאה: אפס שינוי התנהגות, והשוואה שורה-מול-שורה אפשרית. הקבוע הזה
// נמחק כשהקוראים יעברו ל-`loadCitySource`, והקובץ כולו נמחק אחריהם.
//
// ## מה שכן השתנה, וזה תיקון
//
// ‏`ITM_DEF` ישב כאן **וגם** ב-afula-planning.ts, בשני עותקים זהים. שבעה
// פרמטרי דאטום בשני מקומות פירושם שמי שיתקן אחד ולא את השני יקבל פינים
// שזזים במטרים רק באחד משני המסלולים. עכשיו יש עותק אחד, ב-geocode/itm.ts.
// ============================================================================

import { geocodeAddress, insideCityBox } from "./geocode/index.ts";
import type { GeoSource } from "./geocode/types.ts";

export { itmToWgs84 } from "./geocode/itm.ts";
export { MAX_VARIANTS, streetVariants } from "./geocode/street-variants.ts";

// הערכים שישבו כאן כקבועים, ושיושבים היום גם בשורת עפולה ב-
// city_geocode_sources. שני העותקים חייבים להישאר זהים עד שהעטיפה תימחק.
const AFULA_SOURCE: GeoSource = {
  cityKey: "עפולה",
  cityName: "עפולה",
  kind: "municipal_wfs",
  baseUrl: "https://layers.intertown.co.il/opengis/wfs",
  referer: "https://up.intertown.co.il/afl/public",
  addressLayer: "afl_bld:afl_bld-Address_Points_1",
  parcelLayer: "afl_cadaster:afl_cadaster-parcel",
  // תיבה גסה סביב עפולה. נקודה מחוץ לה פירושה שהתרגום קרס או שהשכבה
  // החזירה משהו אחר לגמרי, ופין באמצע הים גרוע מאין פין: המשתמש/ת רואה
  // מיקום ומאמין/ה לו. עדיף להחזיר null ושהנכס יישאר בלי מפה.
  box: { latMin: 32.55, latMax: 32.68, lngMin: 35.23, lngMax: 35.36 },
};

export function insideAfula(lat: number, lng: number): boolean {
  return insideCityBox(AFULA_SOURCE.box, lat, lng);
}

/**
 * מחזירה קואורדינטות WGS84 לכתובת בעפולה, או null כשאין התאמה בשכבה.
 * זורקת רק על תקלת תקשורת/שכבה — הבדל שחשוב לקורא: "לא נמצא" הוא תשובה
 * סופית, "נפל" הוא משהו לנסות שוב.
 */
export function afulaAddressToCoords(
  street: string,
  houseNumber: string,
): Promise<{ lat: number; lng: number } | null> {
  return geocodeAddress(AFULA_SOURCE, street, houseNumber);
}
