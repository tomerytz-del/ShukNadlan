import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callClaude } from "./agent.ts";

// ============================================================================
// הבוט הציבורי: מי שכתב למספר ואינו סוכן/ת רשום/ה.
//
// ‏`agent.ts` הוא העוזר של הסוכנים — עשרים וארבעה כלים שרצים ב-service_role
// ויוצרים נכסים, קוראים את קובץ הלקוחות, את ההסכמים ואת הלידים. **הפונה
// הציבורי לא נכנס לשם, והקובץ הזה קיים כדי שהגבול יהיה קובץ ולא תנאי.**
//
// הסיבה פשוטה: מספר טלפון אינו אימות. כל אדם בעולם יכול לכתוב למספר העסקי
// ולטעון שהוא מי שירצה. לסוכן/ת יש שורה ב-agency_members שמישהו יצר בכוונה,
// ולכן מותר לפעול בשמו/ה; לאלמוני אין דבר — ולכן כאן **אין אף כלי שכותב**.
// ארבעת הכלים קוראים בלבד, ומה שהם קוראים הוא מה שממילא פתוח באתר.
//
// ---------------------------------------------------------------------------
// שני גבולות שנשמרים בכוונה
// ---------------------------------------------------------------------------
//
// **מיסוך הכתובת.** דף הנכס הציבורי מציג רחוב ושכונה ולא מספר בית, אבל
// המיסוך הזה חי ב-JavaScript של `property.html` — מי שקורא ישר מהמסד מקבל
// את `house_number` ואת הכתובת המלאה. בוט שמדקלם אותם בוואטסאפ פורץ בשקט
// מדיניות שהאתר מקפיד עליה, בלי ששום דבר ייראה שבור. לכן `house_number`
// נשלף כאן **רק כדי להימחק** מהכותרת ומהרחוב, ולא יוצא מהפונקציות האלה.
// הפרטים: `docs/property-address-privacy.md`.
//
// **טלפונים לא נמסרים, קישורים כן.** לנכס יש דף, ולמשרד יש דף, ובשניהם
// יושבים כפתורי "וואטסאפ לסוכן" ו"חייגו" שנמדדים ב-GTM. בוט שמכתיב מספר
// טלפון גוזל מהסוכן/ת את הקליק ומהדוחות את הפנייה, ומרוויח בתמורה שורה אחת
// פחות. לכן כל תשובה כאן נגמרת בקישור. הפרטים: `docs/analytics-events.md`.
// ============================================================================

const MODEL = "claude-opus-5";
// ארבעה ולא שמונה: הזרימה כאן היא "להבין מה מחפשים → כלי אחד → לנסח".
// אין כאן שרשרת של מצא-הצלב-עדכן כמו אצל הסוכנים.
const MAX_TOOL_ITERATIONS = 4;
// קצר מהחלון של הסוכנים. שיחה ציבורית היא בדרך כלל כמה שאלות על אותו חיפוש,
// והיסטוריה ארוכה כאן היא בעיקר עלות.
const HISTORY_LIMIT = 10;
// כמה נכסים מותר להחזיר בבת אחת. יותר מזה אינו נקרא בוואטסאפ ממילא.
const MAX_RESULTS = 8;

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

const DEAL_TYPES = ["sale", "rent"];
const CATEGORIES = ["residential", "commercial"];

// ---------------------------------------------------------------------------
// קטלוג ההתמחויות — פורט מ-assets/specialties.js
//
// הקטלוג שם רץ בדפדפן, והגזירה האוטומטית (Specialties.derive) איתו. לבוט
// שרץ ב-Deno אין גישה אליו, ומשרד שלא סימן תחומים היה נראה לו חסר התמחות
// לגמרי — כלומר נעלם מכל המלצה. לכן הקטלוג והגזירה משוכפלים כאן, באותה
// תבנית שבה אוצר המילים של הנכסים משוכפל מ-crm.html ב-agent.ts.
//
// **תחום שנוסף ל-assets/specialties.js צריך להיווסף גם כאן**, אחרת הבוט
// יתעלם ממנו. הרשימה חייבת להישאר זהה גם ל-agencies_specialties_check במסד.
// ---------------------------------------------------------------------------
const SPECIALTY_LABELS: Record<string, string> = {
  residential_sale: "קנייה ומכירה של נכסים פרטיים",
  residential_rent: "השכרת דירות ובתים",
  commercial: "נכסים מסחריים",
  income: "נכסים מניבים ולהשקעה",
  land: "קרקעות ומגרשים",
  urban_renewal: "פינוי בינוי והתחדשות עירונית",
  new_projects: "פרויקטים חדשים מקבלן",
  luxury: "נכסי יוקרה ווילות",
  industrial: "מבני תעשייה ולוגיסטיקה",
  property_management: "ניהול נכסים",
};
const SPECIALTY_IDS = Object.keys(SPECIALTY_LABELS);

const LAND_RE = /מגרש|קרקע|נחל|משק|חקלא/;
const INDUSTRIAL_RE = /תעשי|מחסן|לוגיסט|אחסנ/;
const DERIVE_LIMIT = 4;

interface DerivableProperty {
  category?: string | null;
  deal_type?: string | null;
  property_type?: string | null;
}

/** ‏Specialties.deriveIds — אותה לוגיקה, אותו סדר, אותה תקרה. */
function deriveSpecialties(properties: DerivableProperty[]): string[] {
  const counts: Record<string, number> = {};
  const bump = (id: string) => { counts[id] = (counts[id] || 0) + 1; };

  for (const p of properties) {
    const type = p?.property_type || "";
    // סוג הנכס גובר על ה-category: מגרש שסומן מסחרי הוא עדיין קרקע
    if (LAND_RE.test(type)) { bump("land"); continue; }
    if (INDUSTRIAL_RE.test(type)) { bump("industrial"); continue; }

    if (p?.category === "commercial") {
      bump("commercial");
      // מסחרי להשכרה הוא בהגדרה נכס מניב — זה מה שקונים בו
      if (p?.deal_type === "rent") bump("income");
      continue;
    }
    bump(p?.deal_type === "rent" ? "residential_rent" : "residential_sale");
  }

  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, DERIVE_LIMIT);
}

// ---------------------------------------------------------------------------
// מיסוך הכתובת — פורט מ-property.html ‏(maskHouseNumber / publicAddressText)
// ---------------------------------------------------------------------------

/**
 * מוחקת מספר בית מטקסט חופשי. דורשת גבול ספרה משני הצדדים כדי ש-"52" לא
 * ייחתך מתוך "152" ולא מתוך "128 מ״ר" שבאותה כותרת.
 */
function maskHouseNumber(text: string | null, houseNumber: string | null): string {
  const t = String(text || "");
  const hn = String(houseNumber ?? "").trim();
  if (!t || !hn) return t;

  const re = new RegExp(
    "(^|[^\\d])" + hn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d)",
    "g",
  );
  return t.replace(re, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([,·])/g, "$1")
    .replace(/^[\s,·—–-]+|[\s,·—–-]+$/g, "")
    .trim();
}

// deno-lint-ignore no-explicit-any
function publicWhere(p: any): string {
  const hood = p.neighborhoods?.name || p.sales_area || "";
  const street = maskHouseNumber(p.address || p.street || "", p.house_number);
  return [street, hood && hood !== p.city ? hood : "", p.city]
    .filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// השדות שנשלפים מהמסד
//
// ‏select מפורש ולא `*`. ‏`properties` מחזיקה גם טלפון של סוכן/ת שני,
// גוש וחלקה, שדות סליקה ושדות פנימיים; `*` היה מגיש את כולם ל-LLM, ומשם
// לוואטסאפ של אדם זר. ‏`house_number` ברשימה כדי להימחק (ראו הכותרת).
// ---------------------------------------------------------------------------
const PROPERTY_FIELDS = [
  "id", "title", "property_type", "deal_type", "category", "price", "rooms",
  "size_sqm", "built_size_sqm", "garden_sqm", "floor", "total_floors", "city",
  "street", "address", "house_number", "sales_area", "features", "condition",
  "project_status", "images", "listing_number", "is_promoted", "bumped_at",
  "created_at", "has_virtual_tour", "video_url", "open_house",
  "open_house_start", "open_house_end", "neighborhoods(name)",
].join(", ");

function propertyUrl(id: string): string {
  return `${SITE_BASE}/property.html?id=${id}`;
}

/** הצורה שה-LLM רואה. כל מה שלא כאן — לא קיים מבחינתו. */
// deno-lint-ignore no-explicit-any
function publicProperty(p: any): Record<string, unknown> {
  return {
    id: p.id,
    listing_number: p.listing_number,
    title: maskHouseNumber(p.title, p.house_number),
    where: publicWhere(p),
    deal: p.deal_type === "rent" ? "השכרה" : "מכירה",
    property_type: p.property_type,
    price: p.price === null ? null : Number(p.price),
    rooms: p.rooms === null ? null : Number(p.rooms),
    size_sqm: p.size_sqm === null ? null : Number(p.size_sqm),
    floor: p.floor,
    total_floors: p.total_floors,
    condition: p.condition,
    features: p.features || [],
    photos: (p.images || []).length,
    has_virtual_tour: !!p.has_virtual_tour,
    has_video: !!p.video_url,
    open_house: p.open_house
      ? { start: p.open_house_start, end: p.open_house_end }
      : null,
    url: propertyUrl(p.id),
  };
}

// ---------------------------------------------------------------------------
// הכלים
// ---------------------------------------------------------------------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_properties",
    description:
      "מחפש נכסים פעילים במאגר הציבורי של האתר. זה הכלי לכל שאלה בסגנון " +
      "'יש דירת 4 חדרים בעפולה עד מיליון ושש?'. מחזיר עד " + MAX_RESULTS +
      " נכסים, המקודמים והמעודכנים קודם, כל אחד עם קישור לדף שלו. " +
      "אם לא נמצא דבר — להרחיב טווח ולנסות שוב, לא להמציא.",
    input_schema: {
      type: "object",
      properties: {
        deal_type: {
          type: "string",
          enum: DEAL_TYPES,
          description: "sale = למכירה, rent = להשכרה.",
        },
        category: { type: "string", enum: CATEGORIES },
        city: { type: "string", description: "שם עיר, התאמה חלקית." },
        area: {
          type: "string",
          description:
            "שכונה או אזור בתוך העיר (למשל 'גבעת המורה'). התאמה חלקית מול " +
            "שם השכונה או אזור המכירה של הנכס.",
        },
        property_types: {
          type: "array",
          items: { type: "string" },
          description: "סוגי נכס כפי שהם באתר ('דירה', 'בית פרטי/קוטג'', 'מגרש').",
        },
        min_price: { type: "number" },
        max_price: { type: "number" },
        min_rooms: { type: "number" },
        max_rooms: { type: "number" },
        min_size_sqm: { type: "number" },
        max_floor: { type: "integer" },
        features: {
          type: "array",
          items: { type: "string" },
          description:
            "מאפיינים שחייבים להימצא בנכס: parking, elevator, balcony, ac, " +
            "mamad, renovated_feature, furnished, storage, accessible, bars.",
        },
        limit: { type: "integer", description: `ברירת מחדל 5, מקסימום ${MAX_RESULTS}.` },
      },
      required: [],
    },
  },
  {
    name: "get_property",
    description:
      "מחזיר את פרטי הנכס המלאים (כולל התיאור) לפי מזהה או לפי מספר מודעה. " +
      "להשתמש כששואלים על נכס ספציפי שכבר עלה בשיחה, או כשמוסרים מספר מודעה.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "מזהה הנכס (UUID)." },
        listing_number: { type: "integer", description: "מספר המודעה כפי שמוצג באתר." },
      },
      required: [],
    },
  },
  {
    name: "find_agencies",
    description:
      "מחזיר משרדי תיווך לפי תחום התמחות ואזור פעילות, עם קישור לדף המשרד. " +
      "זה הכלי ל'מי מתמחה בפינוי בינוי?' או 'איזה משרד עובד בעפולה?'. " +
      "משרד שלא הצהיר על תחומים מקבל תחומים שנגזרים מהנכסים שלו בפועל.",
    input_schema: {
      type: "object",
      properties: {
        specialty: {
          type: "string",
          enum: SPECIALTY_IDS,
          description: "תחום ההתמחות המבוקש.",
        },
        area: { type: "string", description: "עיר או אזור פעילות, התאמה חלקית." },
        limit: { type: "integer", description: "ברירת מחדל 3." },
      },
      required: [],
    },
  },
  {
    name: "find_professionals",
    description:
      "מחזיר בעלי מקצוע שמפרסמים באתר — שמאים, עורכי דין, יועצי משכנתאות, " +
      "מעצבים, קבלני שיפוצים — עם קישור לכרטיס שלהם. להשתמש כששואלים את מי " +
      "לוקחים לעסקה, לא כדי לענות במקומם.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "תחום או מקצוע במילים ('שמאי', 'עורך דין', 'משכנתא').",
        },
        area: { type: "string", description: "אזור שירות, התאמה חלקית." },
        limit: { type: "integer", description: "ברירת מחדל 3." },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// מימוש הכלים
// ---------------------------------------------------------------------------

export interface PublicConversationState {
  history: Anthropic.MessageParam[];
  last_property_id: string | null;
}

interface PublicContext {
  supabase: SupabaseClient;
  conv: PublicConversationState;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.round(n), max);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s.slice(0, 80) : null;
}

/** התאמה חלקית ב-PostgREST. ‏% ו-_ בקלט של משתמש חייבים בריחה. */
function likeSafe(value: string): string {
  return `%${value.replace(/[%_\\]/g, "\\$&")}%`;
}

async function searchProperties(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 5, MAX_RESULTS);
  const area = text(args.area);

  let query = ctx.supabase
    .from("properties")
    .select(PROPERTY_FIELDS)
    .eq("status", "active");

  const dealType = text(args.deal_type);
  if (dealType && DEAL_TYPES.includes(dealType)) query = query.eq("deal_type", dealType);

  const category = text(args.category);
  if (category && CATEGORIES.includes(category)) query = query.eq("category", category);

  const city = text(args.city);
  if (city) query = query.ilike("city", likeSafe(city));

  if (Array.isArray(args.property_types)) {
    const types = args.property_types
      .map((t) => text(t))
      .filter((t): t is string => !!t)
      .slice(0, 6);
    if (types.length) query = query.in("property_type", types);
  }

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const minPrice = num(args.min_price);
  const maxPrice = num(args.max_price);
  const minRooms = num(args.min_rooms);
  const maxRooms = num(args.max_rooms);
  const minSize = num(args.min_size_sqm);
  const maxFloor = num(args.max_floor);
  if (minPrice !== null) query = query.gte("price", minPrice);
  if (maxPrice !== null) query = query.lte("price", maxPrice);
  if (minRooms !== null) query = query.gte("rooms", minRooms);
  if (maxRooms !== null) query = query.lte("rooms", maxRooms);
  if (minSize !== null) query = query.gte("size_sqm", minSize);
  if (maxFloor !== null) query = query.lte("floor", maxFloor);

  if (Array.isArray(args.features)) {
    const feats = args.features
      .map((f) => text(f))
      .filter((f): f is string => !!f)
      .slice(0, 8);
    if (feats.length) query = query.contains("features", feats);
  }

  // אותו סדר כמו באתר: מקודמים קודם, ואז מי שנדחף/עודכן לאחרונה.
  // כששוננים לפי אזור שולפים רחב יותר, כי הסינון עצמו נעשה אחרי השליפה.
  const { data, error } = await query
    .order("is_promoted", { ascending: false })
    .order("bumped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(area ? 60 : limit);

  if (error) return { error: "search_failed", detail: error.message };

  // השכונה יושבת בטבלה אחרת ואזור המכירה בעמודת טקסט חופשי; סינון על שתיהן
  // בשאילתה אחת דורש embed מסוג inner, שמפיל נכסים בלי שכונה משויכת.
  let rows = data || [];
  if (area) {
    const needle = area.toLowerCase();
    rows = rows.filter((p) => {
      // deno-lint-ignore no-explicit-any
      const hood = ((p as any).neighborhoods?.name || "").toLowerCase();
      // deno-lint-ignore no-explicit-any
      const sales = ((p as any).sales_area || "").toLowerCase();
      return hood.includes(needle) || sales.includes(needle);
    }).slice(0, limit);
  }

  return {
    count: rows.length,
    properties: rows.map(publicProperty),
    all_listings_url: `${SITE_BASE}/index.html`,
  };
}

async function getProperty(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const id = text(args.property_id);
  const listing = Number(args.listing_number);

  let query = ctx.supabase
    .from("properties")
    .select(`${PROPERTY_FIELDS}, description, marketing_description, agency_id, agent_id`)
    .eq("status", "active");

  if (id) query = query.eq("id", id);
  else if (Number.isFinite(listing)) query = query.eq("listing_number", Math.round(listing));
  else return { error: "missing_identifier", note: "צריך property_id או listing_number." };

  const { data, error } = await query.maybeSingle();
  if (error) return { error: "lookup_failed", detail: error.message };
  if (!data) return { found: false, note: "הנכס אינו פעיל באתר כרגע." };

  // deno-lint-ignore no-explicit-any
  const p = data as any;
  ctx.conv.last_property_id = p.id;

  // שם המשרד והסוכן/ת בשאילתות נפרדות ולא ב-embed: ‏PostgREST מחזיר PGRST201
  // על embed מ-properties ל-agencies מאז ש-property_shares מחזיקה שני מפתחות
  // זרים לאותה טבלה. אותה מלכודת שמתועדת ב-index.ts.
  let agency: { name?: string; slug?: string } | null = null;
  if (p.agency_id) {
    const { data: row } = await ctx.supabase
      .from("agencies").select("name, slug").eq("id", p.agency_id).maybeSingle();
    agency = row ?? null;
  }
  let agent: { display_name?: string; slug?: string } | null = null;
  if (p.agent_id) {
    const { data: row } = await ctx.supabase
      .from("agency_members").select("display_name, slug").eq("id", p.agent_id).maybeSingle();
    agent = row ?? null;
  }

  return {
    found: true,
    ...publicProperty(p),
    // התיאור השיווקי הוא הניסוח שהמשרד בחר לפרסם; התיאור הגולמי הוא הגיבוי.
    description: maskHouseNumber(
      p.marketing_description || p.description || "",
      p.house_number,
    ),
    agency: agency?.name
      ? {
        name: agency.name,
        url: agency.slug ? `${SITE_BASE}/agency.html?slug=${agency.slug}` : null,
      }
      : null,
    agent: agent?.display_name
      ? {
        name: agent.display_name,
        url: agent.slug ? `${SITE_BASE}/agent.html?slug=${agent.slug}` : null,
      }
      : null,
    contact_note:
      "יצירת הקשר נעשית בדף הנכס — שם יש כפתורי וואטסאפ וחיוג לסוכן/ת. " +
      "אין למסור מספרי טלפון בצ'אט.",
  };
}

async function findAgencies(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 3, 8);
  const specialty = text(args.specialty);
  const area = text(args.area);

  const { data: agencies, error } = await ctx.supabase
    .from("agencies")
    .select("id, name, slug, tagline, description, specialties, specialty_areas, address");
  if (error) return { error: "lookup_failed", detail: error.message };

  // שליפה אחת שמשרתת שני דברים: גזירת התחומים למי שלא הצהיר, וספירת הנכסים
  // הפעילים לכל משרד (שהיא גם דירוג הרלוונטיות). התקרה קיימת כדי שהכלי לא
  // ימשוך את כל הלוח ביום שבו יהיו בו עשרות אלפי נכסים.
  const { data: props } = await ctx.supabase
    .from("properties")
    .select("agency_id, category, deal_type, property_type")
    .eq("status", "active")
    .limit(4000);

  const byAgency = new Map<string, DerivableProperty[]>();
  for (const p of props || []) {
    // deno-lint-ignore no-explicit-any
    const key = (p as any).agency_id;
    if (!key) continue;
    if (!byAgency.has(key)) byAgency.set(key, []);
    byAgency.get(key)!.push(p as DerivableProperty);
  }

  const rows = (agencies || []).map((a) => {
    const owned = byAgency.get(a.id) || [];
    const declared: string[] = (a.specialties || []).filter((id: string) =>
      Object.hasOwn(SPECIALTY_LABELS, id)
    );
    const ids = declared.length ? declared : deriveSpecialties(owned);
    return {
      name: a.name,
      tagline: a.tagline || null,
      specialties: ids.map((id) => SPECIALTY_LABELS[id]),
      specialty_ids: ids,
      // "לפי הנכסים שבמשרד" מול הצהרה של המשרד — הבדל שהתשובה צריכה לכבד
      specialties_source: declared.length ? "declared" : "derived",
      areas: a.specialty_areas || [],
      active_properties: owned.length,
      url: a.slug ? `${SITE_BASE}/agency.html?slug=${a.slug}` : null,
    };
  });

  let filtered = rows;
  if (specialty) filtered = filtered.filter((r) => r.specialty_ids.includes(specialty));
  if (area) {
    const needle = area.toLowerCase();
    filtered = filtered.filter((r) =>
      (r.areas as string[]).some((x) => String(x).toLowerCase().includes(needle)) ||
      String(r.name || "").toLowerCase().includes(needle)
    );
  }

  filtered.sort((a, b) => b.active_properties - a.active_properties);

  return {
    count: filtered.length,
    agencies: filtered.slice(0, limit).map(({ specialty_ids: _ids, ...rest }) => rest),
    all_agencies_url: `${SITE_BASE}/agencies.html`,
    // בלי זה תשובה ל"מי מתמחה ב…" שלא מצאה כלום נראית כאילו אין משרדים בכלל
    note: filtered.length
      ? null
      : "לא נמצא משרד שמסומן בתחום הזה. אפשר להפנות לרשימת המשרדים המלאה.",
  };
}

async function findProfessionals(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 3, 8);
  const q = text(args.query);
  const area = text(args.area);

  // ה-view כבר מסנן לכרטיסים פעילים שבתוך חלון התאריכים שלהם
  const { data, error } = await ctx.supabase
    .from("professional_cards_public")
    .select(
      "slug, advertiser_name, business_name, advertiser_type, headline, " +
        "description, services, service_areas, target_region, years_experience",
    )
    .limit(60);
  if (error) return { error: "lookup_failed", detail: error.message };

  let rows = data || [];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => {
      // deno-lint-ignore no-explicit-any
      const p = r as any;
      const haystack = [
        p.advertiser_type, p.business_name, p.advertiser_name, p.headline,
        ...(p.services || []),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }
  if (area) {
    const needle = area.toLowerCase();
    rows = rows.filter((r) => {
      // deno-lint-ignore no-explicit-any
      const p = r as any;
      const areas = [...(p.service_areas || []), p.target_region || ""].join(" ").toLowerCase();
      return !areas.trim() || areas.includes(needle);
    });
  }

  return {
    count: rows.length,
    professionals: rows.slice(0, limit).map((r) => {
      // deno-lint-ignore no-explicit-any
      const p = r as any;
      return {
        name: p.business_name || p.advertiser_name,
        field: p.advertiser_type,
        headline: p.headline,
        services: p.services || [],
        areas: p.service_areas || [],
        years_experience: p.years_experience,
        url: p.slug ? `${SITE_BASE}/professional.html?slug=${p.slug}` : null,
      };
    }),
    all_professionals_url: `${SITE_BASE}/professionals.html`,
  };
}

async function runTool(
  ctx: PublicContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case "search_properties":
        return await searchProperties(ctx, args);
      case "get_property":
        return await getProperty(ctx, args);
      case "find_agencies":
        return await findAgencies(ctx, args);
      case "find_professionals":
        return await findProfessionals(ctx, args);
      default:
        return { error: "unknown_tool", name };
    }
  } catch (err) {
    console.error("public tool failed", name, err);
    return { error: "tool_failed", detail: String((err as Error)?.message || err) };
  }
}

// ---------------------------------------------------------------------------
// ההוראות
// ---------------------------------------------------------------------------
function systemPrompt(conv: PublicConversationState): string {
  const lines = [
    "את/ה העוזר האוטומטי של שוק הנדל\"ן של עפולה והסביבה — אתר נדל\"ן מקומי " +
    "שבו משרדי תיווך מפרסמים נכסים. את/ה משוחח/ת בוואטסאפ עם גולש/ת שאינו/ה " +
    "רשומ/ה במערכת: בדרך כלל מי שמחפש/ת דירה, שוקל/ת למכור, או רוצה לדעת " +
    "לאיזה משרד לפנות.",
    "",
    "מה שאת/ה עושה: מוצא/ת נכסים במאגר, מסביר/ה על האזור ועל התהליך במילים " +
    "פשוטות, שולח/ת קישורים לדפי הנכסים, וממליץ/ה על משרדי תיווך ובעלי מקצוע " +
    "לפי התחום שמתאים לשאלה.",
    "",
    "שפה וסגנון:",
    "- עברית, גוף פונה ישיר, חם ולעניין. זו וואטסאפ ולא דוא\"ל.",
    "- תשובה קצרה: 2-5 שורות, ולא יותר מ-5 נכסים בהודעה אחת.",
    "- בלי טבלאות ובלי כותרות מעוצבות. רשימה קצרה עם מקף היא הפורמט.",
    "- כל נכס שמוזכר מגיע עם הקישור שלו מהכלי, כלשונו. בלי קישור אין טעם.",
    "",
    "כללים שאין לחרוג מהם:",
    "- **רק מה שחזר מהכלים.** אין להמציא נכס, מחיר, משרד או נתון. אם הכלי " +
      "החזיר ריק — לומר שלא נמצא, ולהציע להרחיב טווח או אזור.",
    "- **כתובת מדויקת לא נמסרת.** הנכסים מוצגים ברחוב ובשכונה, בלי מספר בית. " +
      "מי ששואל \"איפה בדיוק?\" מקבל: הפרטים המלאים אצל הסוכן/ת, דרך דף הנכס.",
    "- **מספרי טלפון לא נמסרים בצ'אט**, גם לא של סוכן/ת או משרד. בדף הנכס " +
      "ובדף המשרד יש כפתורי וואטסאפ וחיוג — לשם מפנים.",
    "- **אין ייעוץ משפטי, מיסויי, שמאי או פיננסי.** אפשר להסביר מושג באופן " +
      "כללי, ואז להפנות לבעל/ת המקצוע המתאים/ה דרך find_professionals.",
    "- **אין הערכת שווי לנכס** ואין אמירה אם מחיר הוא הזדמנות או יקר מדי. " +
      "אפשר לומר מה טווח המחירים של נכסים דומים שנמצאו במאגר, וזה הכול.",
    "- **אין התחייבות בשם אף משרד או סוכן/ת** — לא על זמינות, לא על עמלה ולא " +
      "על מחיר. את/ה מפנה, הם מסכמים.",
    "- אין לבקש תעודת זהות, פרטי תשלום או מסמכים. גם לא שם וטלפון: מי שכותב/ת " +
      "כבר נמצא/ת בקשר, והפרטים נמסרים לסוכן/ת ישירות.",
    "",
    "המלצה על משרדים:",
    "- ההמלצה היא **לפי התאמה לתחום ולאזור**, לא לפי העדפה. אין \"המשרד הכי " +
      "טוב\" — יש מי שמתמחה במה שנשאל.",
    "- כשהתחומים חזרו עם specialties_source = derived, הם נגזרו מהנכסים של " +
      "המשרד בפועל ולא מהצהרה שלו. לנסח בהתאם (\"לפי הנכסים שהוא מפרסם\").",
    "- להציע עד שלושה משרדים, עם מה שמייחד כל אחד ועם הקישור לדף שלו.",
    "",
    "גבולות התפקיד:",
    "- מי שרוצה לפרסם נכס, לפתוח משרד או להצטרף כסוכן/ת — להפנות ל-" +
      `${SITE_BASE}/pricing.html . אין לך דרך לרשום אותו/ה.`,
    "- מי שמבקש/ת לדבר עם אדם — להפנות לדף הנכס או המשרד הרלוונטי, ולומר " +
      "בפשטות שאת/ה עוזר/ת אוטומטי/ת ולא הסוכן/ת עצמו/ה.",
    "- מי שרוצה לקבל עדכון על נכסים חדשים שמתאימים לו/ה — להפנות ל\"הסוכן " +
      `החכם\" באתר: ${SITE_BASE}/index.html . אין לך דרך לרשום חיפוש מכאן.`,
  ];

  if (!conv.history.length) {
    lines.push(
      "",
      "**זו ההודעה הראשונה בשיחה.** לפתוח במשפט אחד קצר שאומר מי את/ה — " +
        "העוזר האוטומטי של שוק הנדל\"ן של עפולה והסביבה — ומיד לענות לגופו " +
        "של עניין. לא תפריט, לא ברכה ארוכה.",
    );
  }
  if (conv.last_property_id) {
    lines.push(
      "",
      `הנכס האחרון שהוצג בשיחה: ${conv.last_property_id}. ` +
        "אם נשאלת שאלה בלי לומר על מה (\"כמה חדרים יש בו?\") — זה הנכס.",
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
/**
 * מריץ תור אחד של שיחה ציבורית. ‏conv מתעדכן במקום ונשמר על ידי הקורא.
 */
export async function runPublicTurn(opts: {
  supabase: SupabaseClient;
  conv: PublicConversationState;
  userText: string;
}): Promise<string> {
  const { supabase, conv, userText } = opts;
  const ctx: PublicContext = { supabase, conv };

  const messages: Anthropic.MessageParam[] = [
    ...conv.history,
    { role: "user", content: userText },
  ];

  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 2048,
      // ‏low ולא medium: ארבעה כלים, וההחלטה ביניהם כמעט תמיד חד-משמעית
      // ("דירה בעפולה" → search, "מי מתמחה ב…" → agencies). זה גם הבלם
      // הראשון על עלות בערוץ שפתוח לכל העולם. אם יתברר שהבוט מפספס סינון
      // או בוחר כלי לא נכון — להעלות ל-medium, זו הידית הראשונה.
      output_config: { effort: "low" },
      system: systemPrompt(conv),
      tools: TOOLS,
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);

    const responseText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (responseText) finalText = responseText;

    if ((response.stop_reason as string) === "refusal") {
      finalText = "מצטער, לא אוכל לעזור בזה. אפשר לשאול אותי על נכסים באתר.";
      break;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUses.length) break;

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const result = await runTool(
        ctx,
        use.name,
        (use.input || {}) as Record<string, unknown>,
      );
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) {
    finalText = "לא הצלחתי למצוא תשובה לזה כרגע. אפשר לנסח אחרת, או לחפש ישירות באתר: " +
      `${SITE_BASE}/index.html`;
  }

  // כמו אצל הסוכנים: ההיסטוריה נשמרת כטקסט בלבד, בלי בלוקי הכלים. מספיק
  // כדי ש"והשני הזה?" יעבוד, ומונע tool_result יתום אחרי גזימה.
  conv.history = [
    ...conv.history,
    { role: "user", content: userText },
    { role: "assistant", content: finalText },
  ].slice(-HISTORY_LIMIT);

  return finalText;
}
