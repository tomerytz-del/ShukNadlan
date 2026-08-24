import proj4 from "npm:proj4@2.9.0";

// גיאוקוד רחוב+מספר בית -> lat/lng לעפולה, מול שכבת נקודות הכתובות של העירייה.
// זהו העתק מכוון של הלוגיקה ב-Edge Function ‏geocode-address: אותה פונקציה
// דורשת JWT של משתמש מחובר, ולוובהוק של וואטסאפ אין כזה (הקריאה מגיעה
// מ-Meta, לא מהדפדפן). אם משנים כאן משהו — לעדכן גם שם.

const WFS_URL = "https://layers.intertown.co.il/opengis/wfs";
const WFS_REFERER = "https://up.intertown.co.il/afl/public";

const ITM_DEF =
  "+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs";
const WGS84_DEF = "+proj=longlat +datum=WGS84 +no_defs";

function streetVariants(street: string): string[] {
  const variants = new Set([street]);
  if (street.endsWith("ה")) variants.add(street.slice(0, -1));
  else variants.add(street + "ה");
  variants.add(street.replace(/י/g, "יי"));
  variants.add(street.replace(/יי/g, "י"));
  return Array.from(variants);
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

/** מחזירה {lat, lng} או null אם הכתובת לא נמצאה / ה-WFS נפל. לעולם לא זורקת. */
export async function geocodeAfula(
  street: string,
  houseNumber: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    for (const variant of streetVariants(street)) {
      const xml =
        '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" outputFormat="application/json" count="5">' +
        '<wfs:Query typeNames="afl_bld:afl_bld-Address_Points_1">' +
        "<fes:Filter><fes:And>" +
        "<fes:PropertyIsEqualTo><fes:ValueReference>שם_רחוב</fes:ValueReference><fes:Literal>" +
        variant + "</fes:Literal></fes:PropertyIsEqualTo>" +
        "<fes:PropertyIsEqualTo><fes:ValueReference>מספר_בית</fes:ValueReference><fes:Literal>" +
        houseNumber + "</fes:Literal></fes:PropertyIsEqualTo>" +
        "</fes:And></fes:Filter></wfs:Query></wfs:GetFeature>";
      const data = await wfsQuery(xml);
      const feature = data?.features?.[0];
      if (feature?.properties?.X && feature?.properties?.Y) {
        const [lng, lat] = proj4(ITM_DEF, WGS84_DEF, [
          feature.properties.X,
          feature.properties.Y,
        ]);
        return { lat, lng };
      }
    }
  } catch (err) {
    // פין על המפה זה נחמד-שיהיה, לא תנאי לפרסום הנכס
    console.warn("geocode failed", err);
  }
  return null;
}
