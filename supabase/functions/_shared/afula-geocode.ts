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
// שמוכר לו/ה. שלוש ההיסטות שנצפו בפועל, וכל אחת היא ציר בפני עצמו:
//
//   1. **ה"א פותחת** — "העליה" מול "עלייה". זו ההיסטה שהתגלתה בסבב הראשון
//      של ‏geocode-backfill: מודעה 1090 נרשמה "עלייה 20" ונפתרה, ומודעה
//      1106 נרשמה "העליה 5" ולא נפתרה. אותו רחוב, ה"א אחת הפרידה.
//   2. **ה"א סופית** — "הגלבוע" מול "הגלבועה".
//   3. **יו"ד כפולה** — "הרצליה" מול "הרצלייה".
//
// שלושת הצירים בלתי תלויים, ולכן הם **מצטרפים**: "העליה" -> "עלייה" דורש
// גם הורדת ה"א פותחת וגם הכפלת יו"ד. גרסה שבודקת כל ציר בנפרד הייתה
// מפספסת בדיוק את המקרה שבגללו זה נכתב.
//
// הצירוף מסודר לפי **מספר השינויים**: הצורה כפי שנכתבה ראשונה, אחריה כל
// מה ששונה בשינוי אחד, ורק בסוף צירופים. ‏MAX_VARIANTS חוסם את הזנב — כל
// וריאציה היא קריאת רשת, ווריאציה שלישית-רביעית-חמישית היא כבר ניחוש.
//
// השוואה מדויקת (‏PropertyIsEqualTo) ולא like: "הרצל 5" חייבת להחזיר את
// הרצל 5 ולא את הרצל 51.
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

// כמה צורות כתיב נבדקות לכל היותר לפני ויתור. כל אחת היא קריאת WFS, ולכן
// זה גם תקציב הזמן של נכס בודד בסבב של הסורק.
export const MAX_VARIANTS = 8;

// הורדת ה"א פותחת תמיד מותרת; **הוספה** רק לשם של מילה אחת. "משה שרת"
// לעולם לא נכתב "המשה שרת", ווריאציה כזו היא קריאת רשת שבוודאות תחטיא.
const flipLeadingHe = (s: string) =>
  s.startsWith("ה") ? s.slice(1) : (s.includes(" ") ? null : "ה" + s);

// ואסור להוסיף ה"א אחרי אות סופית: "הגן" -> "הגןה" אינה מילה בעברית, והיא
// קריאת רשת שנדע מראש שתחטיא.
const FINAL_LETTERS = /[םןץףך]$/;
const flipTrailingHe = (s: string) =>
  s.endsWith("ה") ? s.slice(0, -1) : (FINAL_LETTERS.test(s) ? null : s + "ה");

// הצורה ה"כפולה" נבנית מהצורה המנורמלת ולא מהמקור: ‏replace(/י/g,"יי") על
// מחרוזת שכבר כתובה בכפול מייצר "יייי", כלומר וריאציה שאיננה מילה.
//
// ויו"ד בראש מילה אינה נכפלת לעולם — "יצירה" ולא "ייצירה". הכפלה היא
// תופעה של יו"ד עיצורית באמצע מילה ("הרצליה"/"הרצלייה"), ובלי הסייג הזה
// כל רחוב שמתחיל ביו"ד היה מבזבז שתי קריאות על צורה שלא קיימת.
const yodForms = (s: string) => {
  const single = s.replace(/יי/g, "י");
  return [s, single.replace(/(?<=[^\s])י/g, "יי"), single];
};

export function streetVariants(street: string): string[] {
  const base = String(street || "").trim();
  if (!base) return [];

  // לכל צורה נשמר המחיר הנמוך ביותר שבו הגענו אליה (כמה צירים שונו), וזה
  // גם סדר הבדיקה. אותה צורה יכולה להיווצר בשני מסלולים — למשל כשאין בשם
  // אף יו"ד — ואז המסלול הזול קובע.
  const cost = new Map<string, number>();
  const leads: [string, number][] = [[base, 0]];
  const flipped = flipLeadingHe(base);
  if (flipped) leads.push([flipped, 1]);

  for (const [lead, cLead] of leads) {
    const tails: [string, number][] = [[lead, 0]];
    const flippedTail = flipTrailingHe(lead);
    if (flippedTail) tails.push([flippedTail, 1]);

    for (const [tail, cTail] of tails) {
      yodForms(tail).forEach((form, i) => {
        const c = cLead + cTail + (i === 0 ? 0 : 1);
        if (!cost.has(form) || (cost.get(form) as number) > c) cost.set(form, c);
      });
    }
  }

  // ‏sort יציב ב-JS, ולכן צורות באותו מחיר נשארות בסדר שבו נוצרו — מה
  // שמעדיף הורדת ה"א פותחת (ההיסטה השכיחה) על פני הוספת ה"א סופית.
  return Array.from(cost.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_VARIANTS)
    .map(([form]) => form);
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
