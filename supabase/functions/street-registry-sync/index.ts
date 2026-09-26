import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { DEFAULT_RESOURCE_ID, fetchAllRows, streetsByCity } from "./gov.ts";

// ============================================================================
// רשימת הרחובות של עפולה — סנכרון משכבת הכתובות של העירייה
//
// נקראת מ-pg_cron פעם ביום, ורק כשעברו ארבעה חודשים מאז הסנכרון המוצלח
// האחרון (‏street_registry_sync_due() בתנאי ה-cron; ראו המיגרציה
// ‏20261109090000_street_registry.sql).
//
// ## מה היא עושה
//
// סורקת את **כל** נקודות הכתובת של העיר בשכבה afl_bld-Address_Points_1 —
// אותה שכבה שהגיאוקוד והמידע התכנוני שואלים — ואוספת את ערכי שדה
// ‏"שם_רחוב" הייחודיים. רשימת השמות נמסרת ל-street_registry_absorb, שעושה
// את כל העבודה על הטבלה בפקודה אחת.
//
// ## למה סריקה מלאה ולא שאילתה חכמה
//
// ל-WFS 2.0 אין "distinct". ‏GetPropertyValue מחזיר ערך לכל פיצ'ר בלי
// כיווץ, כלומר בדיוק אותו נפח. לכן סורקים בעמודים, מכווצים ב-Set, ומשלמים
// את זה **פעם בארבעה חודשים**.
//
// ## הכלל שמחזיק את זה: סריקה חלקית אינה סנכרון
//
// כל יציאה מוקדמת — עמוד שנפל, תקציב זמן שנגמר, תשובה שאינה GeoJSON —
// היא **כישלון**, ולא "מה שהספקנו". הסיבה אינה קפדנות: ‏absorb מכבה
// הזרעות שהשכבה לא אישרה, ורשימה חלקית הייתה מכבה רחובות אמיתיים שפשוט
// היו בעמוד השלישי. הסבב הבא הוא מחר בלילה, וזו עלות אפס.
//
// אותו היגיון גם בכיוון השני: ‏absorb מסרבת לרשימה קצרה מדי (‏p_min_names).
// לעפולה יש מאות רחובות, ותשובה עם 30 שמות היא תקלה בשכבה ולא עיר
// שהתכווצה.
//
// ## מקור שני: data.gov.il (‏body: {"source":"gov"})
//
// לכל עיר בשווקים (cities.market_slug) - המאגר של רשות האוכלוסין: רחובות
// רשמיים ושמות נרדפים (street_registry_aliases, 20270114094000). ‏cron נפרד (street-registry-sync-gov), ואותו כלל: הורדה
// חלקית אינה סנכרון. עפולה מדולגת (יש לה gis). ‏gov.ts, והמיגרציה
// ‏20270114093000_street_registry_gov.sql.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WFS_URL = "https://layers.intertown.co.il/opengis/wfs";
const WFS_REFERER = "https://up.intertown.co.il/afl/public";
const LAYER = "afl_bld:afl_bld-Address_Points_1";
const STREET_FIELD = "שם_רחוב";

// העיר היחידה שיש לה שכבה. אותה מגבלה בדיוק כמו בגיאוקוד, ומאותה סיבה.
const CITY = "עפולה";

const PAGE = 4000;        // נקודות כתובת לעמוד
const MAX_PAGES = 25;     // תקרת ביטחון — 100 אלף נקודות, הרבה מעל עפולה

// תקציב זמן לסבב, מתחת ל-timeout_milliseconds של ה-cron (120 שניות).
const DEADLINE_MS = 90_000;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ‏PropertyName מצמצם את התשובה לשדה אחד. שרתי GeoServer מכבדים אותו,
// ומי שלא — מחזיר גם את הגאומטריה, וזה עדיין עובד (רק כבד יותר). לכן זו
// אופטימיזציה ולא תלות.
function pageXml(startIndex: number): string {
  return '<wfs:GetFeature service="WFS" version="2.0.0"' +
    ' xmlns:wfs="http://www.opengis.net/wfs/2.0"' +
    ' outputFormat="application/json" count="' + PAGE + '" startIndex="' + startIndex + '">' +
    '<wfs:Query typeNames="' + LAYER + '">' +
    '<wfs:PropertyName>' + STREET_FIELD + '</wfs:PropertyName>' +
    '</wfs:Query></wfs:GetFeature>';
}

async function wfsPage(startIndex: number): Promise<{ features: unknown[] }> {
  const res = await fetch(WFS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", "Referer": WFS_REFERER },
    body: pageXml(startIndex),
  });
  if (!res.ok) throw new Error("WFS request failed: " + res.status);
  // תשובת שגיאה של WFS היא XML גם כשביקשנו JSON, ואז json() זורקת. זה
  // הנתיב שמביא אותנו ל-catch, וזה בסדר: השגיאה נרשמת ביומן.
  const data = await res.json();
  if (!data || !Array.isArray(data.features)) {
    throw new Error("WFS returned a payload with no feature list");
  }
  return data;
}

// ‏סבב gov: כל הערים בשווקים, מהמאגר של רשות האוכלוסין. הורדה אחת לכל
// הערים; כישלון בהורדה - אף עיר לא נקלטת. כישלון בקליטה של עיר אחת נרשם
// לעיר הזו, והשאר ממשיכות.
async function syncGov(supabase: ReturnType<typeof createClient>): Promise<Response> {
  const startedAt = Date.now();
  try {
    const { data: cities, error: cErr } = await supabase
      .from("cities").select("name").not("market_slug", "is", null);
    if (cErr) throw new Error("cities: " + cErr.message);
    const names = (cities || []).map((c: { name: string }) => c.name);
    if (!names.length) throw new Error("no market cities");

    const resourceId = Deno.env.get("STREETS_RESOURCE_ID") || DEFAULT_RESOURCE_ID;
    const rows = await fetchAllRows(fetch, resourceId, startedAt + 110_000);
    const byCity = streetsByCity(rows, names);

    const results: unknown[] = [];
    for (const [city, { streets, aliases }] of byCity) {
      const { data, error } = await supabase.rpc("street_registry_absorb_gov", {
        p_city: city, p_names: streets, p_aliases: aliases,
      });
      if (error) {
        await supabase.rpc("street_registry_sync_failed_source", {
          p_city: city, p_error: "absorb: " + error.message, p_source: "gov",
        });
        results.push({ city, error: error.message });
      } else {
        results.push(data);
      }
    }
    return json({ ok: true, source: "gov", rows: rows.length, cities: results });
  } catch (err) {
    const detail = String((err && (err as Error).message) || err);
    const { error: logError } = await supabase.rpc("street_registry_sync_failed_source", {
      p_city: "*", p_error: detail, p_source: "gov",
    });
    if (logError) console.error("could not record gov sync failure:", logError.message);
    console.error("street-registry-sync (gov) failed:", detail);
    return json({ ok: false, source: "gov", error: "sync_failed", detail }, 500);
  }
}

Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  // בלי גוף, או כל מקור אחר - הסנכרון המקורי של עפולה, כמו עד היום.
  const body = await req.json().catch(() => ({})) as { source?: string };
  if (body && body.source === "gov") return await syncGov(supabase);

  const startedAt = Date.now();
  const names = new Set<string>();
  let pages = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        throw new Error("deadline_exceeded after " + pages + " pages - partial scan, not absorbing");
      }
      const data = await wfsPage(page * PAGE);
      pages++;
      for (const feature of data.features as Array<Record<string, unknown>>) {
        const props = (feature && feature.properties) as Record<string, unknown> | undefined;
        const raw = props ? props[STREET_FIELD] : undefined;
        if (typeof raw === "string") {
          const name = raw.replace(/\s+/g, " ").trim();
          if (name) names.add(name);
        }
      }
      // עמוד חלקי = הגענו לסוף השכבה. זו הדרך היחידה לסיים בהצלחה.
      if (data.features.length < PAGE) {
        const { data: summary, error } = await supabase.rpc("street_registry_absorb", {
          p_city: CITY,
          p_names: Array.from(names),
        });
        if (error) throw new Error("absorb failed: " + error.message);
        return json({ ok: true, pages, ...(summary as Record<string, unknown>) });
      }
    }
    throw new Error("page cap reached (" + MAX_PAGES + ") - layer larger than expected, not absorbing");
  } catch (err) {
    const detail = String((err && (err as Error).message) || err);
    // הכישלון נרשם ביומן ולא רק בלוג: בלי שורה בטבלה, שכבה שלא עונה
    // במשך חודשים נראית בדיוק כמו "אין מה לסנכרן".
    const { error: logError } = await supabase.rpc("street_registry_sync_failed", {
      p_city: CITY,
      p_error: detail,
    });
    if (logError) console.error("could not record sync failure:", logError.message);
    console.error("street-registry-sync failed:", detail);
    return json({ ok: false, error: "sync_failed", detail, pages, names_seen: names.size }, 500);
  }
});
