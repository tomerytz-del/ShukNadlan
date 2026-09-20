// ============================================================================
// החוזה של הגאוקוד
//
// **‏`null` מול `throw` הוא הנכס היקר ביותר במערכת הזו, ולא פרט מימוש.**
//
// כל הלוגיקה של `geocode_attempts` נשענת עליו (`docs/geocoding.md`): נכס
// מקבל שלושה ניסיונות, ואחריהם הוא יוצא מהתור. אם "לא הצלחנו לשאול"
// ייספר כמו "אין כתובת כזו", אז ביום שבו שרת העירייה למטה **כל** הנכסים
// בתור ישרפו את שלושת הניסיונות שלהם ויסומנו סופית כחסרי כתובת.
// ‏20261107090000_geocode_requeue_not_found.sql קיימת כי כבר שילמנו על זה.
//
//   null   = תשובה **סופית**. השכבה ענתה, ואין שם בית כזה.
//   throw  = תשובה **זמנית**. לא הצלחנו לשאול, שווה לנסות שוב.
//
// ספק שאינו מבחין בין השניים אינו כשיר, ואין לרשום אותו כאן.
// ============================================================================

/** התיבה שמחוצה לה תוצאה נפסלת. מגיעה מ-city_geocode_sources, לא מקבוע. */
export interface GeoBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/**
 * תצורת הספק לעיר אחת, כפי ש-`city_geocode_source(p_city)` מחזירה.
 * ‏`box` הוא `null` רק לשורה שאינה פעילה, והיא ממילא אינה מוחזרת.
 */
export interface GeoSource {
  cityKey: string;
  cityName: string;
  kind: "municipal_wfs" | "govmap";
  baseUrl: string;
  referer: string | null;
  addressLayer: string | null;
  parcelLayer: string | null;
  box: GeoBox | null;
}

/**
 * רמת הדיוק של התוצאה.
 *
 * **‏`locality` הוא המסוכן שבהם**, ולכן הוא מופרד: מרכז יישוב אינו פין.
 * הוא נראה כמו הצלחה מושלמת - קואורדינטה תקינה, בתוך התיבה, בעיר הנכונה -
 * ורק הוא שגוי בקילומטר. ‏docs/property-map.md אוסר אותו במפורש.
 *
 * שכבת נקודות כתובות עירונית מחזירה תמיד `rooftop`; ספק ארצי מבוסס חיפוש
 * יחזיר `locality` בשמחה, וזו הסיבה שהשדה קיים לפני שיש ספק כזה.
 */
export type GeoPrecision = "rooftop" | "parcel" | "street" | "locality" | "unknown";

export interface GeoHit {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  /** הצורה שבה השם נמצא בפועל. שימושי ליומן כשהכתיב שונה מהמוזן. */
  matchedStreet?: string;
}

export interface GeoQuery {
  street: string;
  houseNumber: string;
}

/**
 * ספק גאוקוד אחד. `lookup` מחזירה `null` לתשובה סופית וזורקת לתשובה זמנית,
 * בדיוק לפי החוזה שבראש הקובץ.
 */
export interface GeocodeProvider {
  kind: GeoSource["kind"];
  lookup(source: GeoSource, query: GeoQuery): Promise<GeoHit | null>;
}
