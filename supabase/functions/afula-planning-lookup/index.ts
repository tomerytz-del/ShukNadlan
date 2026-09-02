import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import proj4 from "npm:proj4@2.9.0";

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

async function wfsQuery(xmlBody) {
  const res = await fetch(WFS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", "Referer": WFS_REFERER },
    body: xmlBody,
  });
  if (!res.ok) throw new Error("WFS request failed: " + res.status);
  return await res.json();
}

function streetVariants(street) {
  const variants = new Set([street]);
  if (street.endsWith("ה")) variants.add(street.slice(0, -1));
  else variants.add(street + "ה");
  variants.add(street.replace(/י/g, "יי"));
  variants.add(street.replace(/יי/g, "י"));
  return Array.from(variants);
}

async function addressToCoords(street, houseNumber) {
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
      return { x: feature.properties.X, y: feature.properties.Y };
    }
  }
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

async function coordsToParcel(x, y) {
  const data = await wfsQuery(pointFilter("afl_cadaster:afl_cadaster-parcel", "Contains", x, y, "Shape"));
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
  const data = await wfsQuery(xml);
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
  const data = await wfsQuery(pointFilter("afl_yk:afl_yk_plans", "Intersects", x, y, "shape"));
  return (data && data.features ? data.features : []).map((f) => f.properties);
}
async function coordsToLandUse(x, y) {
  const data = await wfsQuery(pointFilter("afl_yk:afl_yk-ITown_yk_Lots_Compilation", "Intersects", x, y, "shape"));
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

    const rawPlans = await coordsToPlans(x, y);
    const landUse = await coordsToLandUse(x, y);
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
