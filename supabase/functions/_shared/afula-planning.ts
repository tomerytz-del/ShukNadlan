// ============================================================================
// המידע התכנוני של עפולה — שליפה מ-WFS של העירייה
//
// **הלוגיקה יושבת כאן ולא ב-Edge Function אחת**, כי שני צרכנים שונים
// צריכים אותה בדיוק: ‏afula-planning-lookup, שרצה עבור סוכן/ת מחובר/ת עם
// מסלול Mid/Premium, ו-planning-backfill, שרצה מ-cron כ-service_role בלי
// שום משתמש/ת. ההרשאות שונות — השליפה זהה.
//
// זה לא סגנון. היום הזה כבר לימד פעמיים מה קורה להעתק שנשאר מאחור: תיקון
// נכנס לקובץ אחד, וההעתק ממשיך להחזיר "לא נמצא" על אותה כתובת בדיוק.
// ראו docs/geocoding.md, "ארבעה צרכנים, קובץ אחד".
//
// מה **לא** כאן: אימות, בדיקת מסלול, מטמון וכתיבה למסד. אלה שייכים לקורא,
// והם שונים בין השניים.
// ============================================================================

import proj4 from "npm:proj4@2.9.0";
import { streetVariants } from "./afula-geocode.ts";

const WFS_URL = "https://layers.intertown.co.il/opengis/wfs";
const WFS_REFERER = "https://up.intertown.co.il/afl/public";

const ITM_DEF = "+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs";
const WGS84_DEF = "+proj=longlat +datum=WGS84 +no_defs";

function itmToWgs84(x, y) {
  return proj4(ITM_DEF, WGS84_DEF, [x, y]);
}

function convertGeometryToWgs84(geometry) {
  if (!geometry) return null;
  const convertRing = (ring) => ring.map(([x, y]) => itmToWgs84(x, y));
  try {
    if (geometry.type === "Polygon") {
      return { type: "Polygon", coordinates: geometry.coordinates.map(convertRing) };
    }
    if (geometry.type === "MultiPolygon") {
      return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map(convertRing)) };
    }
  } catch (e) {}
  return null;
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

// ‏label הוא מה שמופיע בלוג כשהשכבה מסרבת. בלי זה חזר לסוכן/ת
// "WFS request failed: 400" ותו לא — בלי איזו שאילתה, בלי איזו צורת כתיב,
// ובלי ההסבר של השרת עצמו, שיושב בגוף התשובה ולכן נרשם כאן.
async function wfsQuery(xmlBody, label) {
  const res = await fetch(WFS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", "Referer": WFS_REFERER },
    body: xmlBody,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`WFS ${res.status} [${label}]: ${body.slice(0, 500)}`);
    throw new Error("WFS request failed: " + res.status + " [" + label + "]");
  }
  return await res.json();
}

async function addressToCoords(street, houseNumber) {
  let lastError = null;
  for (const variant of streetVariants(street)) {
    const xml = '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" outputFormat="application/json" count="5">' +
      '<wfs:Query typeNames="afl_bld:afl_bld-Address_Points_1">' +
      '<fes:Filter><fes:And>' +
      '<fes:PropertyIsEqualTo><fes:ValueReference>שם_רחוב</fes:ValueReference><fes:Literal>' + variant + '</fes:Literal></fes:PropertyIsEqualTo>' +
      '<fes:PropertyIsEqualTo><fes:ValueReference>מספר_בית</fes:ValueReference><fes:Literal>' + houseNumber + '</fes:Literal></fes:PropertyIsEqualTo>' +
      '</fes:And></fes:Filter></wfs:Query></wfs:GetFeature>';
    let data;
    try {
      data = await wfsQuery(xml, "address:" + variant);
    } catch (err) {
      // צורה שנכשלה אינה מפילה את החיפוש: 400 על הצורה החמישית לא ימחק
      // התאמה שמחכה בשישית. הכשל נשמר ומוכרע רק בסוף.
      lastError = err;
      continue;
    }
    const feature = data && data.features && data.features[0];
    if (feature && feature.properties && feature.properties.X && feature.properties.Y) {
      return { x: feature.properties.X, y: feature.properties.Y };
    }
  }

  // אף התאמה. אם כל הקריאות הצליחו — אין בשכבה בית כזה, וזו תשובה סופית
  // שתחזור כ-404 מנומק. אם קריאה כלשהי נכשלה — ייתכן שדווקא היא הייתה
  // מוצאת, ולכן זורקים: "לא נמצא" ו-"לא הצלחנו לבדוק" אינם אותה תשובה,
  // ואסור להציג לסוכן/ת "הכתובת לא קיימת" כשהשכבה פשוט סירבה לענות.
  if (lastError) throw lastError;
  return null;
}

function pointFilter(typeName, spatialOp, x, y, propRef) {
  return '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" outputFormat="application/json" count="50">' +
    '<wfs:Query typeNames="' + typeName + '">' +
    '<fes:Filter><fes:' + spatialOp + '>' +
    '<fes:ValueReference>' + propRef + '</fes:ValueReference>' +
    '<gml:Point gml:id="p1" srsName="urn:ogc:def:crs:EPSG::2039"><gml:pos>' + x + ' ' + y + '</gml:pos></gml:Point>' +
    '</fes:' + spatialOp + '></fes:Filter></wfs:Query></wfs:GetFeature>';
}

// שם עמודת הגאומטריה אינו עקבי בין שכבות העירייה, ואין דרך לדעת אותו מראש:
// ‏afl_cadaster-parcel עונה ל-"Shape", ‏afl_yk_plans ל-"shape", ושכבת הייעוד
// דחתה את "shape" ב-‏400 "Illegal property name". לכן מנסים את שתי הצורות
// שנצפו, המוכרת לשכבה תחילה, והראשונה שעונה היא הנכונה.
// כששתי הצורות המוכרות נדחות, שואלים את השכבה עצמה. ‏DescribeFeatureType
// מחזירה את הסכימה שלה, ובה עמודת הגאומטריה מזוהה בכך שהטיפוס שלה הוא
// ‏gml:*PropertyType. זו קריאה אחת נוספת ורק במסלול הכישלון, והתשובה נשמרת
// ל-isolate — כך שגם אם נצטרך אותה, נשלם עליה פעם אחת.
//
// זה עדיף על עוד ועוד ניחושים: שלוש השכבות כאן כבר מדגימות שלוש מוסכמות
// שונות, ורשימת ניחושים ארוכה היא רק דרך איטית יותר להחטיא.
const geomPropCache = new Map();

async function describeGeometryProp(typeName) {
  if (geomPropCache.has(typeName)) return geomPropCache.get(typeName);
  try {
    const url = WFS_URL + "?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=" +
      encodeURIComponent(typeName);
    const res = await fetch(url, { headers: { "Referer": WFS_REFERER } });
    if (!res.ok) return null;
    const xml = await res.text();
    for (const tag of xml.match(/<[^>]*\belement\b[^>]*>/g) || []) {
      if (!/type="[^"]*\bgml:/.test(tag)) continue;
      const m = tag.match(/name="([^"]+)"/);
      if (m) {
        geomPropCache.set(typeName, m[1]);
        console.error("WFS geometry property discovered: " + typeName + " -> " + m[1]);
        return m[1];
      }
    }
  } catch (err) {
    console.error("WFS DescribeFeatureType failed for " + typeName + ": " + String(err));
  }
  return null;
}

async function spatialQuery(typeName, spatialOp, x, y, props, label) {
  let lastError = null;
  for (const prop of props) {
    try {
      return await wfsQuery(pointFilter(typeName, spatialOp, x, y, prop), label + ":" + prop);
    } catch (err) {
      lastError = err;
    }
  }

  // כל הניחושים נדחו — שואלים את השכבה ומנסים שוב עם השם האמיתי.
  const discovered = await describeGeometryProp(typeName);
  if (discovered && !props.includes(discovered)) {
    return await wfsQuery(pointFilter(typeName, spatialOp, x, y, discovered), label + ":" + discovered);
  }
  throw lastError;
}

async function coordsToParcel(x, y) {
  const data = await spatialQuery("afl_cadaster:afl_cadaster-parcel", "Contains", x, y, ["Shape", "shape"], "parcel");
  const f = data && data.features && data.features[0];
  return f ? { properties: f.properties, geometry: f.geometry } : null;
}
async function gushHelkaToParcel(gush, helka) {
  const xml = '<wfs:GetFeature service="WFS" version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" outputFormat="application/json" count="5">' +
    '<wfs:Query typeNames="afl_cadaster:afl_cadaster-parcel">' +
    '<fes:Filter><fes:And>' +
    '<fes:PropertyIsEqualTo><fes:ValueReference>גוש</fes:ValueReference><fes:Literal>' + gush + '</fes:Literal></fes:PropertyIsEqualTo>' +
    '<fes:PropertyIsEqualTo><fes:ValueReference>חלקה</fes:ValueReference><fes:Literal>' + helka + '</fes:Literal></fes:PropertyIsEqualTo>' +
    '</fes:And></fes:Filter></wfs:Query></wfs:GetFeature>';
  const data = await wfsQuery(xml, "gush-helka:" + gush + "/" + helka);
  return (data && data.features && data.features[0]) || null;
}
function polygonCentroid(geometry) {
  try {
    const coords = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
    let sx = 0, sy = 0;
    for (const c of coords) { sx += c[0]; sy += c[1]; }
    return { x: sx / coords.length, y: sy / coords.length };
  } catch (e) { return null; }
}
async function coordsToPlans(x, y) {
  const data = await spatialQuery("afl_yk:afl_yk_plans", "Intersects", x, y, ["shape", "Shape"], "plans");
  return (data && data.features ? data.features : []).map((f) => f.properties);
}
async function coordsToLandUse(x, y) {
  // ‏SHAPE באותיות גדולות — זה מה ש-DescribeFeatureType החזירה על השכבה הזו,
  // אחרי ש-"shape" ו-"Shape" נדחו שתיהן. מקובע כאן כדי לחסוך שתי קריאות
  // כושלות ועוד אחת של DescribeFeatureType בכל שליפה; אם השכבה תשנה שוב את
  // הסכימה, הגילוי עדיין שם ויתפוס.
  const data = await spatialQuery("afl_yk:afl_yk-ITown_yk_Lots_Compilation", "Intersects", x, y, ["SHAPE", "shape", "Shape"], "landuse");
  const f = data && data.features && data.features[0];
  return f ? f.properties : null;
}

function cleanPlans(rawPlans) {
  return (rawPlans || []).map(function(p) {
    return {
      number: (p && p["מספר_תכנית"]) || null,
      description: (p && p["תיאור"]) || null,
      date: (p && p["תאריך_פרסום"]) || null,
      area_sqm: (p && p["שטח_תכנית_מחושב"]) || null,
    };
  }).filter(function(p) { return p.number || p.description; });
}

/**
 * שליפה מלאה לכתובת או לגוש/חלקה.
 *
 * מחזירה ‏`{ ok: true, record }` עם השדות כפי שהם נשמרים ב-planning_lookups,
 * או ‏`{ ok: false, error, status }` — ‏`address_not_found` ו-`parcel_not_found`
 * הם תשובה **סופית** (‏404), וכל השאר תקלה שאפשר לנסות שוב.
 */
export async function lookupPlanning(input) {
  const street = input.street, house_number = input.house_number;
  const gush = input.gush, helka = input.helka;
  if (!(street && house_number) && !(gush && helka)) {
    return { ok: false, error: "missing_fields", status: 400 };
  }

  const lookupKey = (gush && helka) ? (gush + ":" + helka) : (street + ":" + house_number);
  let x, y;
  let resolvedGush = gush, resolvedHelka = helka;
  let parcelArea = null, parcelStatus = null, parcelGeometry = null;

  if (gush && helka) {
    const parcelFeature = await gushHelkaToParcel(gush, helka);
    if (!parcelFeature) return { ok: false, error: "parcel_not_found", status: 404 };
    parcelArea = (parcelFeature.properties && parcelFeature.properties["שטח_חלקה"]) || null;
    parcelStatus = (parcelFeature.properties && parcelFeature.properties["סטטוס_חלקה"]) || null;
    parcelGeometry = parcelFeature.geometry;
    const centroid = polygonCentroid(parcelFeature.geometry);
    if (!centroid) return { ok: false, error: "could_not_compute_centroid", status: 500 };
    x = centroid.x; y = centroid.y;
  } else {
    const coords = await addressToCoords(street, house_number);
    if (!coords) {
      return { ok: false, error: "address_not_found", status: 404, detail: "לא נמצאה כתובת מתאימה" };
    }
    x = coords.x; y = coords.y;
    const parcel = await coordsToParcel(x, y);
    resolvedGush = (parcel && parcel.properties && parcel.properties["גוש"]) || null;
    resolvedHelka = (parcel && parcel.properties && parcel.properties["חלקה"]) || null;
    parcelArea = (parcel && parcel.properties && parcel.properties["שטח_חלקה"]) || null;
    parcelStatus = (parcel && parcel.properties && parcel.properties["סטטוס_חלקה"]) || null;
    parcelGeometry = (parcel && parcel.geometry) || null;
  }

  // תוכניות וייעוד הם **העשרה**: הגוש, החלקה, הסטטוס והגאומטריה כבר בידינו,
  // ושכבה אחת שנופלת לא אמורה למחוק את כולם.
  let rawPlans = [];
  try {
    rawPlans = await coordsToPlans(x, y);
  } catch (err) {
    console.error("planning: plans layer failed", String((err && err.message) || err));
  }

  let landUse = null;
  try {
    landUse = await coordsToLandUse(x, y);
  } catch (err) {
    console.error("planning: landuse layer failed", String((err && err.message) || err));
  }

  const landUseDesignation =
    (landUse && (landUse["יעוד_קרקע_בתכנית"] || landUse["יעוד_קרקע_מבאת"])) || null;
  const centerCoords = itmToWgs84(x, y);

  return {
    ok: true,
    record: {
      lookup_key: lookupKey,
      street: street || null, house_number: house_number || null,
      gush: resolvedGush, helka: resolvedHelka,
      parcel_area_sqm: parcelArea, parcel_status: parcelStatus,
      land_use_designation: landUseDesignation,
      applicable_plans: cleanPlans(rawPlans),
      lat: centerCoords[1], lng: centerCoords[0],
      geometry_wgs84: convertGeometryToWgs84(parcelGeometry),
      looked_up_at: new Date().toISOString(),
    },
  };
}
