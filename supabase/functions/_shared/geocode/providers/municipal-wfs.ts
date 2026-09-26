// ============================================================================
// ספק: שכבת WFS של עירייה
//
// זהו הקוד שהיה ב-_shared/afula-geocode.ts, בלי שינוי סמנטי אחד - רק
// שהכתובת, ה-referer ושם השכבה מגיעים מ-`GeoSource` במקום מקבועים.
//
// מקור כזה הוא **נקודת כתובת רשמית של העירייה ולא ניחוש של מנוע חיפוש**:
// או שיש שם בית עם המספר הזה, או שאין. זו ההבחנה ש-docs/geocoding.md נפתח
// בה, והיא מה שמצדיק להעדיף שכבה עירונית על ספק מסחרי גם כשהאחרון נוח יותר.
//
// השוואה מדויקת (PropertyIsEqualTo) ולא like: "הרצל 5" חייבת להחזיר את
// הרצל 5 ולא את הרצל 51.
// ============================================================================

import { itmToWgs84 } from "../itm.ts";
import { streetVariants } from "../street-variants.ts";
import { xmlLiteral } from "../../xml.ts";
import type { GeoHit, GeoQuery, GeocodeProvider, GeoSource } from "../types.ts";

// ‏label הוא מה שמופיע בלוג כשהשכבה מסרבת: בלעדיו נשאר "400" בלי לדעת על
// איזו צורת כתיב, ובדיוק זה קרה - 500 שחזר לסוכן/ת בלי דרך לשחזר אותו.
// גוף התשובה הוא ההסבר של שרת ה-WFS לסירוב, ולכן הוא נרשם ולא נזרק.
async function wfsQuery(source: GeoSource, xmlBody: string, label: string) {
  const headers: Record<string, string> = { "Content-Type": "application/xml" };
  if (source.referer) headers["Referer"] = source.referer;

  const res = await fetch(source.baseUrl, { method: "POST", headers, body: xmlBody });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`WFS ${res.status} [${source.cityName}/${label}]: ${body.slice(0, 500)}`);
    throw new Error("WFS request failed: " + res.status + " [" + label + "]");
  }
  return await res.json();
}

function addressXml(layer: string, street: string, houseNumber: string): string {
  return '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" outputFormat="application/json" count="5">' +
    '<wfs:Query typeNames="' + layer + '">' +
    '<fes:Filter><fes:And>' +
    '<fes:PropertyIsEqualTo><fes:ValueReference>שם_רחוב</fes:ValueReference><fes:Literal>' + xmlLiteral(street) + '</fes:Literal></fes:PropertyIsEqualTo>' +
    '<fes:PropertyIsEqualTo><fes:ValueReference>מספר_בית</fes:ValueReference><fes:Literal>' + xmlLiteral(houseNumber) + '</fes:Literal></fes:PropertyIsEqualTo>' +
    '</fes:And></fes:Filter></wfs:Query></wfs:GetFeature>';
}

export const municipalWfsProvider: GeocodeProvider = {
  kind: "municipal_wfs",

  async lookup(source: GeoSource, query: GeoQuery): Promise<GeoHit | null> {
    if (!source.addressLayer) {
      // שורה פעילה בלי שכבת כתובות חסומה באילוץ במסד, ולכן זה אינו אמור
      // לקרות. אם בכל זאת - זו תקלת תצורה ולא "אין כתובת כזו", ולכן זריקה.
      throw new Error("city_geocode_sources: אין address_layer ל-" + source.cityName);
    }

    // צורה שנכשלה אינה מפילה את החיפוש. קודם כל כשל בקריאה אחת הפיל את כל
    // הלולאה, כלומר 400 על הצורה החמישית מחק גם התאמה שהייתה מחכה בשישית -
    // וככל שיש יותר צורות, כך גדל הסיכוי שאחת מהן תקלקל את כולן.
    let lastError: unknown = null;

    for (const variant of streetVariants(query.street)) {
      let data;
      try {
        data = await wfsQuery(
          source,
          addressXml(source.addressLayer, variant, query.houseNumber),
          variant,
        );
      } catch (err) {
        lastError = err;
        continue;
      }

      const feature = data && data.features && data.features[0];
      if (feature && feature.properties && feature.properties.X && feature.properties.Y) {
        const [lng, lat] = itmToWgs84(Number(feature.properties.X), Number(feature.properties.Y));
        // שכבת נקודות כתובות מחזירה נקודת בית, ולכן תמיד rooftop. הפסילה
        // לפי תיבה נעשית ב-geocodeAddress ולא כאן: תפקיד הספק הוא לענות,
        // ותפקיד המעטפת הוא להחליט אם התשובה קבילה.
        return { lat, lng, precision: "rooftop", matchedStreet: variant };
      }
    }

    // כאן נגמרו הצורות בלי התאמה, ויש שתי משמעויות שונות לגמרי. אם אף קריאה
    // לא נכשלה - השכבה ענתה על כולן ואין בה בית כזה, וזו תשובה סופית (null).
    // אם קריאה כלשהי נכשלה - ייתכן שדווקא היא הייתה מוצאת, ולכן זורקים:
    // geocode-backfill מחזיר לתור את מי שנפל, ומסמן סופית רק את מי שלא נמצא.
    // בליעת הכשל כאן הייתה מסמנת "אין כתובת כזו" על תקלה רגעית בשרת העירייה.
    if (lastError) throw lastError;
    return null;
  },
};
