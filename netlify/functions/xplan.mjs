// ============================================================================
// ממסר ל-XPlan של מינהל התכנון - ייעוד ותוכניות לנקודה, לגבריאלה
//
// ## למה זה כאן ולא ב-Supabase
//
// ‏ags.iplan.gov.il מציע רק צפנים ישנים. ‏Deno (כל Edge Function, וגם
// netlify/edge-functions) נכשל שם ב-HandshakeFailure ואין לו דרך לשנות את
// זה; Node כן. נבדק מ-GitHub ב-22.10.2026 (‏scripts/iplan_probe.py).
//
// ## שני כללים
//
// - **מורידים את רמת הצופן, לעולם לא את אימות התעודה.** ‏SECLEVEL=1 בלבד.
//   בלי אימות, כל מי שבאמצע מחליף את התשובה - והיא מגיעה לסוכן/ת כעובדה.
// - **סגור בלי הסוד.** ‏XPLAN_RELAY_TOKEN מוגדר גם כאן (משתני הסביבה של
//   האתר ב-Netlify) וגם בסודות של Supabase. בלעדיו הפונקציה עונה 503, והבוט
//   נופל לקישור לכלי ב-CRM - כמו לפני שהיא נבנתה. אחרת כל אחד יכול להפעיל
//   אותה, וכל הפעלה עולה קרדיטים.
//
// ## מה חוזר
//
// בדיוק הצורה של שכבות 203/14 ב-GovMap (‏{layers: {'203': [...], '14': [...]}}),
// עם תאריכים כמחרוזת ISO: XPlan מחזיר epoch במילישניות, GovMap מחרוזת. כך
// הניקוי (‏cleanPlanLayers) זהה באתר ובבוט. ‏docs/parcels-open.md.
// ============================================================================

import https from "node:https";
import { timingSafeEqual } from "node:crypto";

const XPLAN = "https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan_6991/MapServer";
const USER_AGENT = "shuknadlan.co.il planning";

// שכבה 1 = קווים כחולים (המקבילה ל-203 ב-GovMap), שכבה 4 = ייעודי קרקע (14)
const LAYERS = {
  "203": { id: 1, fields: ["pl_number", "pl_name", "entity_subtype_desc", "depositing_date", "pl_date_8",
    "plan_charactor_name", "pl_url"] },
  "14": { id: 4, fields: ["mavat_name", "mavat_code", "pl_number"] },
};
const DATE_FIELDS = new Set(["depositing_date", "pl_date_8"]);

const agent = new https.Agent({ ciphers: "DEFAULT:@SECLEVEL=1", keepAlive: true });

/** epoch במילישניות -> ISO, כמו ש-GovMap מחזיר. ערך אחר עובר כמו שהוא. */
export function toGovmapAttributes(attrs) {
  const out = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    out[k] = DATE_FIELDS.has(k) && typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString() : v;
  }
  return out;
}

/** ‏lat/lng בתוך ישראל, או null. */
export function parsePoint(params) {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 29.3 || lat > 33.5 || lng < 34.2 || lng > 35.9) return null;
  return { lat, lng };
}

export function tokenOk(given, expected) {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, timeout: 9000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("XPlan " + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("XPlan timeout")));
    req.on("error", reject);
  });
}

async function layerAt(layer, point) {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ x: point.lng, y: point.lat }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: layer.fields.join(","),
    returnGeometry: "false",
    f: "json",
  });
  const data = await getJson(`${XPLAN}/${layer.id}/query?${params}`);
  if (data && data.error) throw new Error("XPlan error " + JSON.stringify(data.error).slice(0, 200));
  return ((data && data.features) || []).map((f) => ({ attributes: toGovmapAttributes(f.attributes) }));
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async (req) => {
  const expected = process.env.XPLAN_RELAY_TOKEN || "";
  if (!expected) return json(503, { error: "not_configured" });
  if (!tokenOk(req.headers.get("x-relay-token"), expected)) return json(401, { error: "unauthorized" });
  const point = parsePoint(new URL(req.url).searchParams);
  if (!point) return json(400, { error: "bad_point" });
  try {
    const [plans, landUse] = await Promise.all([layerAt(LAYERS["203"], point), layerAt(LAYERS["14"], point)]);
    return json(200, { layers: { "203": plans, "14": landUse } });
  } catch (err) {
    console.warn("xplan relay:", err && err.message);
    return json(502, { error: "xplan_unavailable" });
  }
};
