// ============================================================================
// כתובת בעפולה -> ‏lat/lng
//
// מקור האמת הוא שכבת נקודות הכתובות של עיריית עפולה
// (‏afl_bld:afl_bld-Address_Points_1 ב-WFS של intertown) — אותה שכבה
// ש-afula-planning-lookup שואלת עליה מידע תכנוני. זו נקודת כתובת רשמית של
// העירייה ולא ניחוש של מנוע חיפוש: או שיש שם בית עם המספר הזה, או שאין.
//
// ## למה קובץ משותף
//
// הלוגיקה הזו נכתבה במקור בתוך geocode-address, שנקראת ממסך הנכס ב-CRM
// בזמן שמירה. ‏geocode-backfill צריכה בדיוק אותה לוגיקה בלי בן אדם שממתין
// לתשובה, ושתי העתקות של אותו ניתוח כתובת היו נפרדות ביום שבו אחת מהן
// תתוקן — למשל ברשימת וריאציות הכתיב, שהיא בדיוק החלק ששובר התאמות.
//
// ## וריאציות הכתיב
//
// שכבת העירייה כותבת שמות רחובות בכתיב משלה, והסוכן/ת מקליד/ה את מה
// שמוכר לו/ה. שתי ההיסטות השכיחות הן ה"א סופית ("הגלבוע"/"הגלבועה") ויו"ד
// כפולה ("הרצליה"/"הרצלייה"), ולכן נבדקות עד ארבע צורות לפני ויתור. השוואה
// מדויקת (‏PropertyIsEqualTo) ולא like: "הרצל 5" חייבת להחזיר את הרצל 5
// ולא את הרצל 51.
// ============================================================================

import proj4 from "npm:proj4@2.9.0";

const WFS_URL = "https://layers.intertown.co.il/opengis/wfs";
const WFS_REFERER = "https://up.intertown.co.il/afl/public";

// רשת ישראל החדשה (ITM) — מה שהשכבה מחזירה — אל WGS84 שמפות Leaflet מבינות
const ITM_DEF = "+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs";
const WGS84_DEF = "+proj=longlat +datum=WGS84 +no_defs";

export function itmToWgs84(x: number, y: number): [number, number] {
  const [lng, lat] = proj4(ITM_DEF, WGS84_DEF, [x, y]);
  return [lng, lat];
}

// תיבה גסה סביב עפולה. נקודה מחוץ לה פירושה שהתרגום קרס או שהשכבה החזירה
// משהו אחר לגמרי, ופין באמצע הים גרוע מאין פין: המשתמש/ת רואה מיקום ומאמין/ה
// לו. עדיף להחזיר null ושהנכס יישאר בלי מפה.
const AFULA_BOX = { latMin: 32.55, latMax: 32.68, lngMin: 35.23, lngMax: 35.36 };

export function insideAfula(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= AFULA_BOX.latMin && lat <= AFULA_BOX.latMax
    && lng >= AFULA_BOX.lngMin && lng <= AFULA_BOX.lngMax;
}

async function wfsQuery(xmlBody: string) {
  const res = await fetch(WFS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", "Referer": WFS_REFERER },
    body: xmlBody,
  });
  if (!res.ok) throw new Error("WFS request failed: " + res.status);
  return await res.json();
}

export function streetVariants(street: string): string[] {
  const variants = new Set([street]);
  if (street.endsWith("ה")) variants.add(street.slice(0, -1));
  else variants.add(street + "ה");
  variants.add(street.replace(/י/g, "יי"));
  variants.add(street.replace(/יי/g, "י"));
  return Array.from(variants);
}

/**
 * מחזירה קואורדינטות WGS84 לכתובת בעפולה, או null כשאין התאמה בשכבה.
 * זורקת רק על תקלת תקשורת/שכבה — הבדל שחשוב לקורא: "לא נמצא" הוא תשובה
 * סופית, "נפל" הוא משהו לנסות שוב.
 */
export async function afulaAddressToCoords(
  street: string,
  houseNumber: string,
): Promise<{ lat: number; lng: number } | null> {
  for (const variant of streetVariants(street)) {
    const xml = '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" outputFormat="application/json" count="5">' +
      '<wfs:Query typeNames="afl_bld:afl_bld-Address_Points_1">' +
      '<fes:Filter><fes:And>' +
      '<fes:PropertyIsEqualTo><fes:ValueReference>שם_רחוב</fes:ValueReference><fes:Literal>' + variant + '</fes:Literal></fes:PropertyIsEqualTo>' +
      '<fes:PropertyIsEqualTo><fes:ValueReference>מספר_בית</fes:ValueReference><fes:Literal>' + houseNumber + '</fes:Literal></fes:PropertyIsEqualTo>' +
      '</fes:And></fes:Filter></wfs:Query></wfs:GetFeature>';
    const data = await wfsQuery(xml);
    const feature = data && data.features && data.features[0];
    if (feature && feature.properties && feature.properties.X && feature.properties.Y) {
      const [lng, lat] = itmToWgs84(Number(feature.properties.X), Number(feature.properties.Y));
      if (insideAfula(lat, lng)) return { lat, lng };
      return null;
    }
  }
  return null;
}
