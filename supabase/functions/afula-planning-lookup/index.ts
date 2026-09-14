import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import proj4 from "npm:proj4@2.9.0";
import { streetVariants } from "../_shared/afula-geocode.ts";

// ניתוח שם הרחוב מגיע מ-_shared/afula-geocode.ts ולא מהעתק מקומי. כאן היה
// העתק, והוא נשאר מאחור כשהצירים של הכתיב שופרו: "העלייה 20" נכשלה כאן
// בזמן ש-geocode-address פתרה בדיוק את אותו רחוב. הפונקציה הזו עדיין
// שומרת addressToCoords משלה, כי היא צריכה את ה-X/Y ב-ITM להמשך השאילתות
// המרחביות ולא את ה-lat/lng ש-afulaAddressToCoords מחזירה.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400); }
  const street = body.street, house_number = body.house_number, gush = body.gush, helka = body.helka;
  if (!(street && house_number) && !(gush && helka)) {
    return json({ error: "missing_fields", detail: "צריך street+house_number או gush+helka" }, 400);
  }

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const authResult = await authedClient.auth.getUser();
  if (authResult.error || !authResult.data.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const agentResult = await supabase.from("agency_members").select("id, tier, active").eq("user_id", authResult.data.user.id).maybeSingle();
  const agentRow = agentResult.data;

  if (!agentRow || !agentRow.active) return json({ error: "no_matching_agent_profile" }, 403);
  if (agentRow.tier !== "mid" && agentRow.tier !== "premium") {
    return json({
      error: "upgrade_required",
      detail: "מידע תכנוני מלא זמין רק למנוי Mid/Premium",
      cta: "שדרג למנוי Mid או Premium כדי לקבל מידע על נכסים ללא הגבלה",
    }, 402);
  }

  const lookupKey = (gush && helka) ? (gush + ":" + helka) : (street + ":" + house_number);

  const cachedResult = await supabase.from("planning_lookups").select("*").eq("lookup_key", lookupKey).maybeSingle();
  const cached = cachedResult.data;
  if (cached && new Date(cached.looked_up_at).getTime() > Date.now() - 24 * 60 * 60 * 1000) {
    return json({ success: true, cached: true, data: cached });
  }

  try {
    let x, y;
    let resolvedGush = gush, resolvedHelka = helka, parcelArea = null, parcelStatus = null, parcelGeometry = null;

    if (gush && helka) {
      const parcelFeature = await gushHelkaToParcel(gush, helka);
      if (!parcelFeature) return json({ error: "parcel_not_found" }, 404);
      parcelArea = (parcelFeature.properties && parcelFeature.properties["שטח_חלקה"]) || null;
      parcelStatus = (parcelFeature.properties && parcelFeature.properties["סטטוס_חלקה"]) || null;
      parcelGeometry = parcelFeature.geometry;
      const centroid = polygonCentroid(parcelFeature.geometry);
      if (!centroid) return json({ error: "could_not_compute_centroid" }, 500);
      x = centroid.x; y = centroid.y;
    } else {
      const coords = await addressToCoords(street, house_number);
      if (!coords) return json({ error: "address_not_found", detail: "לא נמצאה כתובת מתאימה" }, 404);
      x = coords.x; y = coords.y;
      const parcel = await coordsToParcel(x, y);
      resolvedGush = (parcel && parcel.properties && parcel.properties["גוש"]) || null;
      resolvedHelka = (parcel && parcel.properties && parcel.properties["חלקה"]) || null;
      parcelArea = (parcel && parcel.properties && parcel.properties["שטח_חלקה"]) || null;
      parcelStatus = (parcel && parcel.properties && parcel.properties["סטטוס_חלקה"]) || null;
      parcelGeometry = (parcel && parcel.geometry) || null;
    }

    // תוכניות וייעוד הם **העשרה**: הגוש, החלקה, הסטטוס והגאומטריה כבר
    // בידינו, ושכבה אחת שנופלת לא אמורה למחוק את כולם. כך זה נראה כשזה
    // קורה — 400 על שכבת הייעוד החזיר "שגיאה" לסוכן/ת על נכס שכל שאר
    // המידע עליו נשלף בהצלחה, כולל הכתובת שנמצאה.
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
    const landUseDesignation = (landUse && (landUse["יעוד_קרקע_בתכנית"] || landUse["יעוד_קרקע_מבאת"])) || null;
    const centerCoords = itmToWgs84(x, y);
    const geometryWgs84 = convertGeometryToWgs84(parcelGeometry);

    const record = {
      lookup_key: lookupKey,
      street: street || null, house_number: house_number || null,
      gush: resolvedGush, helka: resolvedHelka,
      parcel_area_sqm: parcelArea, parcel_status: parcelStatus,
      land_use_designation: landUseDesignation,
      applicable_plans: cleanPlans(rawPlans),
      lat: centerCoords[1], lng: centerCoords[0],
      geometry_wgs84: geometryWgs84,
      looked_up_at: new Date().toISOString(),
    };

    const upsertResult = await supabase.from("planning_lookups").upsert(record, { onConflict: "lookup_key" }).select().single();
    if (upsertResult.error) return json({ error: "db_error", detail: upsertResult.error.message }, 500);

    return json({ success: true, cached: false, data: upsertResult.data });
  } catch (err) {
    return json({ error: "wfs_error", detail: String((err && err.message) || err) }, 500);
  }
});
