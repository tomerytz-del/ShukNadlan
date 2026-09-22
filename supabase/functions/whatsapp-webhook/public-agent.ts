import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callClaude, COMMERCIAL_PTYPES, RESIDENTIAL_PTYPES } from "./agent.ts";
import { sendImage } from "./whatsapp.ts";
import {
  LEAD_PURPOSES,
  LEAD_TIMELINES,
  PROJECT_PROPERTY_TYPES,
  PROJECT_STAGES,
} from "../_shared/projects.ts";

// ============================================================================
// הבוט הציבורי: מי שכתב למספר ואינו סוכן/ת רשום/ה.
//
// ‏`agent.ts` הוא העוזר של הסוכנים — עשרים וארבעה כלים שרצים ב-service_role
// ויוצרים נכסים, קוראים את קובץ הלקוחות, את ההסכמים ואת הלידים. **הפונה
// הציבורי לא נכנס לשם, והקובץ הזה קיים כדי שהגבול יהיה קובץ ולא תנאי.**
//
// הסיבה פשוטה: מספר טלפון אינו אימות. כל אדם בעולם יכול לכתוב למספר העסקי
// ולטעון שהוא מי שירצה. לסוכן/ת יש שורה ב-agency_members שמישהו יצר בכוונה,
// ולכן מותר לפעול בשמו/ה; לאלמוני אין דבר.
//
// ---------------------------------------------------------------------------
// ארבעה כלים שקוראים, ושניים שפותחים ליד
// ---------------------------------------------------------------------------
//
// ארבעת כלי החיפוש קוראים בלבד, ומה שהם קוראים פתוח ממילא באתר.
//
// שני כלי הלידים כותבים — אבל **לא למסד**: הם קוראים ל-`saved-search-intake`
// ול-`owner-lead-intake`, אותן שתי נקודות קליטה שהטפסים באתר קוראים להן
// מהדפדפן של גולש/ת אנונימי/ת (‏`verify_jwt = false` ב-`config.toml`). כלומר
// הבוט יכול בדיוק מה שדפדפן פתוח באתר יכול, לא יותר — וכל הוולידציה,
// ההתאמה, הרוטציה, התקרות, רישום הניתוב וההתראה למנהל/ת הפלטפורמה נשארים
// במקום אחד. שכפול שלהם כאן היה מתפצל מהם תוך חודש, והליד מוואטסאפ היה
// מתנהג אחרת מהליד מהאתר בלי שאיש ישים לב.
//
// **ההסכמה אינה נגזרת מהשיחה.** ‏`consent_agent_contact` הוא ההבדל בין ליד
// שמותר למכור לבין ליד שאסור, ולכן הוא פרמטר מפורש בכלי — לא ברירת מחדל,
// ולא מסקנה מכך שמישהו טרח לכתוב. מי שרוצה התראות בלבד מקבל התראות בלבד.
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

// המודל כסוד, כמו בבוט של הסוכנים. **הבוט הציבורי הוא המועמד החזק יותר
// למודל זול**: הוא נפח גבוה, חשוף לכל מי שראה את המספר, והמשימה שלו
// (חיפוש והפניה) צרה מזו של העוזר. ברירת המחדל נשארת Opus עד שתימדד
// איכות, והמתג נפרד כדי שאפשר יהיה להחליף כאן בלי לגעת בערוץ העבודה
// של הסוכנים.
const MODEL = Deno.env.get("WHATSAPP_PUBLIC_BOT_MODEL") || "claude-opus-5";
// שישה: הזרימות כאן קצרות, אבל כבר לא תמיד כלי אחד — "חפש → שלח כרטיסים →
// סכם" ו"חשב משכנתא → פתח ליד" הן שתיים ושלוש קריאות באותו תור.
const MAX_TOOL_ITERATIONS = 6;
// קצר מהחלון של הסוכנים. שיחה ציבורית היא בדרך כלל כמה שאלות על אותו חיפוש,
// והיסטוריה ארוכה כאן היא בעיקר עלות.
const HISTORY_LIMIT = 10;
// כמה נכסים מותר להחזיר בבת אחת. יותר מזה אינו נקרא בוואטסאפ ממילא.
const MAX_RESULTS = 8;

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

// נקודות הקליטה נקראות דרך הכתובת הפנימית של הפרויקט — אותה כתובת שהדפדפן
// קורא לה, רק בלי לצאת החוצה.
const FUNCTIONS_BASE = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "")}/functions/v1`;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// תקרת הלידים לפונה. שלושה ביממה זה יותר ממה שאדם אמיתי צריך (חיפוש אחד,
// אולי שניים, ואולי נכס למכירה), ומעט מספיק כדי שמי שמשעמם לו לא יזרים
// לידים מזויפים למדף שסוכנים משלמים עליו.
const LEAD_DAILY_CAP = 3;
const LEAD_WINDOW_HOURS = 24;

// כמה כרטיסי תמונה מותר לשלוח בתור אחד. וואטסאפ הוא ערוץ אישי, וארבע
// תמונות ברצף הן הצפה ולא שירות.
const MAX_CARDS_PER_TURN = 3;

const DEAL_TYPES = ["sale", "rent"];
const CATEGORIES = ["residential", "commercial"];
const CONTACT_CHANNELS = ["whatsapp", "email", "both"];
const PROPERTY_TYPES = [...new Set([...RESIDENTIAL_PTYPES, ...COMMERCIAL_PTYPES])];

// ---------------------------------------------------------------------------
// מחשבון המשכנתא — פורט מ-index.html ‏(updateCalculator)
//
// **אותה נוסחה ואותם ברירות מחדל, ובכוונה.** מחשבון שמחזיר בצ'אט מספר אחר
// מזה שבאתר על אותם נתונים הוא לא "הבדל בעיגול" — הוא סיבה לא להאמין לאף
// אחד משניהם. שינוי כאן מחייב שינוי שם, ולהפך.
// ---------------------------------------------------------------------------
const DEFAULT_RATE_PCT = 4.8;
const DEFAULT_YEARS = 25;
/** תקרות המימון המקובלות, כמו ב-index.html. מודול 2 §5.5. */
const LTV_THRESHOLDS: Record<string, number> = {
  single: 0.75,
  replacement: 0.70,
  investment: 0.50,
};
const BUYER_KINDS = Object.keys(LTV_THRESHOLDS);

const DISCLAIMER =
  "החישוב הוא הערכה כללית בלבד, לפי ריבית קבועה ומסלול אחד. התנאים בפועל " +
  "נקבעים מול הבנק ותלויים בהכנסה, בהיסטוריית האשראי ובתמהיל המסלולים - " +
  "ולכן מומלץ להיוועץ באופן פרטני עם יועץ/ת משכנתאות מוסמך/ת.";

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
// ‏`מחסנים` אינו מיותר לצד `מחסן`: הנו"ן הסופית אינה אותו תו, ולכן "מחסן"
// אינו תת-מחרוזת של "מחסנים". בלעדיו משרד שמפרסם מחסנים היה נגזר כאן
// כ-commercial וב-assets/specialties.js כ-industrial — אותו משרד, שתי
// תשובות. הרשימה זהה לזו שבקטלוג, תו בתו.
const INDUSTRIAL_RE = /תעשי|מחסן|מחסנים|לוגיסט|אחסנ/;
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

/**
 * מספר בית כשהעמודה `house_number` ריקה.
 *
 * ‏`maskHouseNumber` דורשת את הערך המדויק מהעמודה, ולכן כשהיא ריקה היא
 * **לא עושה כלום** — וסוכן/ת שהקליד/ה "הרצל 25" לתוך `street` בלי למלא את
 * השדה הנפרד מדליף/ה את מספר הבית למרות כל המיסוך. שתי מודעות פעילות הן
 * כרגע במצב הזה.
 *
 * הגיזום מעוגן לסוף המחרוזת או לפסיק, כי שם יושב מספר בית — וכך "רחוב 60"
 * הוא המחיר היחיד ששולמים, במקום לחתוך "3 חדרים" או "120 מ״ר" מכל טקסט.
 */
function stripTrailingStreetNumber(text: string): string {
  return String(text || "")
    .replace(/\s+\d{1,4}\s*(?=,|$)/g, "")
    .trim();
}

/**
 * ניקוי טקסט חופשי שיוצא לאדם זר.
 *
 * ‏**הכללים האלה היו עד עכשיו הוראות בפרומפט בלבד** — "כתובת מדויקת לא
 * נמסרת", "מספרי טלפון לא נמסרים בצ'אט" — והטקסט החופשי של המודעה עבר
 * מתחתיהן בלי בדיקה. הוראה היא בקשה מהמודל; זו הגנת פרטיות, ומקומה בקוד.
 *
 * ‏**וזו לא הייתה תיאוריה:** מודעה 1142 מסתיימת ב-"052-8616550 ציון חנו"
 * בתוך `marketing_description`, והבוט היה מדקלם את המספר הזה לכל שואל.
 *
 * מה נמחק וממה:
 *
 *   ‏· **גוש וחלקה** — ראו למטה.
 *
 * ‏**טלפונים של סוכנים ומשרדים אינם נמחקים.** זו הייתה החלטה קודמת והיא
 * התהפכה במפורש: הבוט **אמור** לחבר בין מתעניין/ת לסוכן/ת, וזו כל תכליתו.
 * מה שנשמר הוא ההפרדה בין *מי מפרסם* לבין *מה מפרסמים עליו*: הטלפון של
 * הסוכן/ת הוא ערוץ שהוא/היא בחר/ה לפרסם, והכתובת המדויקת של הנכס היא מידע
 * פנימי של הנכס. ‏`contact_agent` הוא הכלי שנותן את הראשון.
 *
 * ‏(מה שכן נמחק לפי מסלול הוא טלפון **בתוך התיאור** במסלול Pay&GO, וזה קורה
 * בטריגר במסד — ‏`docs/public-text-policy.md` — ולא כאן.)
 *   ‏· **גוש וחלקה** — `PROPERTY_FIELDS` כבר מוציא את העמודות עצמן, אבל
 *     אין מה שימנע מסוכן/ת להקליד "גוש 17700 חלקה 45" לתוך התיאור. זה מידע
 *     מזהה על הנכס ועל בעליו: עם גוש וחלקה אפשר להוציא נסח טאבו ולקבל את
 *     שם הבעלים — כלומר בדיוק מה ש-`redact_owner_details` טורחת להסיר.
 *
 * **מה *לא* כאן, ובכוונה:** שם בעל/ת הנכס. ההסרה שלו היא טריגר במסד
 * (‏`redact_owner_details`, מיגרציה 20261114090000) שרץ על כל כתיבה, ולכן
 * כל קורא — הבוט בכללם — מקבל טקסט נקי בלי לדעת על כך. שכפול שלו כאן היה
 * יוצר עותק שני שיתפצל. ‏[`owner-privacy.md`](../../../docs/owner-privacy.md)
 */
const GUSH_HELKA_RE =
  /\b(?:גוש|חלקה|חלקות|תת[-\s]?חלקה|מגרש)\s*[:.\-–]?\s*\d+(?:\s*[\/,]\s*\d+)*/g;

function scrubPublicText(text: string | null): string {
  return String(text || "")
    .replace(GUSH_HELKA_RE, "")
    // ניקוי הסימנים שנשארו יתומים אחרי המחיקה, כדי שלא ייצא "דברו איתנו. ."
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?·|–—-])\s*(?=[,.;:!?·|])/g, "")
    .replace(/^[\s,.;:!?·|–—-]+|[\s,.;:!?·|–—-]+$/g, "")
    .trim();
}

/** מיסוך מלא של טקסט מודעה: מספר בית, ואז טלפונים וגוש/חלקה. */
function maskPublicText(text: string | null, houseNumber: string | null): string {
  const hn = String(houseNumber ?? "").trim();
  const masked = hn
    ? maskHouseNumber(text, hn)
    : stripTrailingStreetNumber(String(text || ""));
  return scrubPublicText(masked);
}

// deno-lint-ignore no-explicit-any
function publicWhere(p: any): string {
  const hood = p.neighborhoods?.name || p.sales_area || "";
  const street = maskPublicText(p.address || p.street || "", p.house_number);
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
  return `${SITE_BASE}/property?id=${id}`;
}


/** הצורה שה-LLM רואה. כל מה שלא כאן — לא קיים מבחינתו. */
// deno-lint-ignore no-explicit-any
function publicProperty(p: any): Record<string, unknown> {
  return {
    id: p.id,
    listing_number: p.listing_number,
    title: maskPublicText(p.title, p.house_number),
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
      "**כשנמצא מעט או כלום, הכלי מרחיב בעצמו** ומחזיר `close_matches` - " +
      "נכסים פוטנציאליים במחיר או בחדרים קרובים, או בשכונה אחרת באותה עיר, " +
      "כל אחד עם הקישור שלו. ‏`relaxed_on` אומר על מה ויתרנו. אין צורך לקרוא " +
      "שוב עם טווח רחב יותר, ובשום מקרה אין להמציא נכס.",
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
    name: "contact_agent",
    description:
      "מחזיר את הסוכן/ת שמפרסם/ת נכס מסוים, עם הטלפון ועם **קישור שפותח " +
      "שיחת וואטסאפ ישירה איתו/ה** - הודעת הפתיחה כבר מזכירה את מספר המודעה. " +
      "**זה הכלי לכל שאלה שאין עליה תשובה במאגר**: כתובת מדויקת, מי הבעלים, " +
      "מתי אפשר לראות, מה מצב המשא ומתן, האם המחיר גמיש. אין לנחש תשובות " +
      "כאלה ואין להתנצל עליהן - מפנים לסוכן/ת שמכיר/ה את הנכס.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "מזהה הנכס." },
        listing_number: { type: "integer", description: "לחלופין, מספר המודעה." },
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
    name: "search_projects",
    description:
      "מחפש פרויקטים חדשים מקבלן - דירות על הנייר ובבנייה. **זה מאגר נפרד " +
      "מ-search_properties**, ושאלה על 'משהו חדש מקבלן', 'על הנייר' או " +
      "'פרויקט' מגיעה לכאן. מחזיר טווחי מחיר וחדרים, שלב הבנייה, מועד אכלוס " +
      "ושם היזם, עם קישור לדף הפרויקט.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string" },
        max_price: { type: "number", description: "תקציב - מסנן לפי מחיר הפתיחה." },
        min_rooms: { type: "number" },
        max_rooms: { type: "number" },
        stage: {
          type: "string",
          enum: [...PROJECT_STAGES],
          description:
            "planning = בתכנון · pre_sale = טרום מכירה · under_construction = " +
            "בבנייה · ready = מוכן לאכלוס · completed = הושלם.",
        },
        limit: { type: "integer", description: "ברירת מחדל 5." },
      },
      required: [],
    },
  },
  {
    name: "project_lead",
    description:
      "מעביר פנייה ליזם של פרויקט חדש. **רק אחרי אישור מפורש.** אם נאמר על " +
      "איזה פרויקט מדובר - להעביר project_slug, וזה מגיע ישירות ליזם שלו; " +
      "בלעדיו זו פנייה כללית של מי שמחפש/ת פרויקט.",
    input_schema: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        phone: { type: "string", description: "רק אם נמסר מספר אחר מזה שכותבים ממנו." },
        email: { type: "string" },
        project_slug: {
          type: "string",
          description: "ה-slug שחזר מ-search_projects, כשהפנייה על פרויקט מסוים.",
        },
        cities: { type: "array", items: { type: "string" } },
        rooms: { type: "array", items: { type: "number" }, description: "כמה חדרים מחפשים." },
        max_price: { type: "number" },
        timeline: {
          type: "string",
          enum: [...LEAD_TIMELINES],
          description: "now · 3_months · 6_months · 12_months · exploring",
        },
        purpose: {
          type: "string",
          enum: [...LEAD_PURPOSES],
          description: "residence · investment · upgrade · first_home",
        },
        message: { type: "string", description: "מה שנאמר, במילים של הפונה." },
        consent: { type: "boolean", description: "אישור מפורש ליצירת קשר. בלי true הכלי מסרב." },
      },
      required: ["full_name", "consent"],
    },
  },
  {
    name: "mortgage_estimate",
    description:
      "מחשב החזר חודשי משוער ואחוז מימון - אותה נוסחה ואותן ברירות מחדל של " +
      "המחשבון באתר. להשתמש בשאלות כמו 'כמה אוכל לקנות עם 500 אלף הון עצמי' " +
      "או 'מה ההחזר על דירה ב-1.4 מיליון'. **חובה למסור בתשובה את " +
      "ה-disclaimer שחוזר מהכלי** - ההערכה אינה ייעוץ.",
    input_schema: {
      type: "object",
      properties: {
        property_price: { type: "number", description: "מחיר הנכס בשקלים. חובה." },
        equity: { type: "number", description: "ההון העצמי בשקלים. חובה." },
        years: { type: "integer", description: `תקופה בשנים. ברירת מחדל ${DEFAULT_YEARS}.` },
        interest_rate: {
          type: "number",
          description: `ריבית שנתית באחוזים. ברירת מחדל ${DEFAULT_RATE_PCT}.`,
        },
        buyer_kind: {
          type: "string",
          enum: BUYER_KINDS,
          description:
            "single = דירה יחידה (תקרה 75%) · replacement = דירה חלופית (70%) · " +
            "investment = להשקעה (50%). ברירת מחדל single.",
        },
      },
      required: ["property_price", "equity"],
    },
  },
  {
    name: "mortgage_lead",
    description:
      "מעביר פנייה ליועץ/ת משכנתאות. **רק אחרי שהוצגה ההערכה, נאמר שהיא " +
      "הערכה בלבד, נשאל אם רוצים שיועץ/ת ייצור קשר - והתשובה הייתה כן מפורש.**",
    input_schema: {
      type: "object",
      properties: {
        full_name: { type: "string" },
        phone: { type: "string", description: "רק אם נמסר מספר אחר מזה שכותבים ממנו." },
        email: { type: "string" },
        property_price: { type: "number" },
        equity: { type: "number" },
        years: { type: "integer" },
        interest_rate: { type: "number" },
        monthly_payment: { type: "number", description: "ההחזר שחזר מ-mortgage_estimate." },
        owns_property: { type: "boolean", description: "האם יש כבר נכס בבעלות." },
        consent: { type: "boolean", description: "אישור מפורש ליצירת קשר. בלי true הכלי מסרב." },
      },
      required: ["full_name", "consent"],
    },
  },
  {
    name: "send_property_card",
    description:
      "שולח תמונה של נכס עם שורה קצרה והקישור - כרטיס אחד לכל נכס, עד " +
      MAX_CARDS_PER_TURN + " בתור. **זו הדרך להציג נכסים**: וואטסאפ הוא ערוץ " +
      "ויזואלי, וקישור בלי תמונה כמעט לא נפתח. לשלוח את הכרטיסים ואז לכתוב " +
      "משפט סיכום קצר - בלי לחזור על הפרטים שכבר בכיתוב. נכס בלי תמונות " +
      "חוזר עם sent=false, ואז מזכירים אותו בטקסט עם הקישור.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: MAX_CARDS_PER_TURN,
          items: {
            type: "object",
            properties: {
              property_id: { type: "string" },
              note: {
                type: "string",
                description: "חצי שורה למה דווקא הוא ('הכי קרוב לתקציב'). אופציונלי.",
              },
            },
            required: ["property_id"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "save_search_alert",
    description:
      "שומר חיפוש למי שמחפש/ת נכס, כדי שיקבל/תקבל עדכון כשיעלה נכס מתאים. " +
      "**להשתמש רק אחרי ש-search_properties החזיר מעט מדי או כלום, אחרי " +
      "ששאלת אם רוצים שנעדכן, ואחרי תשובה חיובית מפורשת.** לא ליזום את זה " +
      "בשיחה שהתשובה בה כבר נמצאה.\n" +
      "‏consent_agent_contact הוא שאלה **נפרדת** - האם מסכימים שסוכן/ת ייצור " +
      "קשר. תשובה חיובית רק על העדכונים = false, והחיפוש עדיין נשמר.",
    input_schema: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "השם כפי שנמסר. חובה." },
        email: { type: "string", description: "רק אם נמסר בשיחה." },
        phone: {
          type: "string",
          description:
            "רק אם נמסר מספר **אחר** מזה שממנו כותבים. אם לא נמסר - המערכת " +
            "משתמשת במספר הוואטסאפ של השיחה, וצריך לומר את זה בשיחה.",
        },
        contact_channel: {
          type: "string",
          enum: CONTACT_CHANNELS,
          description: "איך רוצים לקבל את העדכונים. ברירת מחדל whatsapp.",
        },
        consent_agent_contact: {
          type: "boolean",
          description:
            "האם ניתן אישור מפורש שסוכן/ת ייצור קשר. ברירת המחדל false, " +
            "ואין להסיק אותו מנימוס או משתיקה.",
        },
        deal_type: { type: "string", enum: DEAL_TYPES },
        category: { type: "string", enum: CATEGORIES },
        cities: { type: "array", items: { type: "string" } },
        area: { type: "string", description: "שכונה, אם נאמרה." },
        property_types: { type: "array", items: { type: "string", enum: PROPERTY_TYPES } },
        min_price: { type: "number" },
        max_price: { type: "number" },
        min_rooms: { type: "number" },
        max_rooms: { type: "number" },
        min_size_sqm: { type: "number" },
        required_features: { type: "array", items: { type: "string" } },
        free_text: {
          type: "string",
          description: "מה שלא נכנס לשדות - במילים של הפונה, לא בפרשנות שלך.",
        },
      },
      required: ["full_name", "consent_agent_contact"],
    },
  },
  {
    name: "owner_lead",
    description:
      "פותח פנייה של בעל/ת נכס שרוצה למכור או להשכיר ומבקש/ת שסוכן/ת ייצור " +
      "קשר. המערכת משייכת את הפנייה לסוכן/ת מתאים/ה לפי אזור וסוג נכס. " +
      "**להשתמש רק אחרי אישור מפורש שסוכן/ת ייצור קשר.** בלי אישור - לא " +
      "לקרוא לכלי, גם אם כל הפרטים כבר נאמרו.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "השם כפי שנמסר. חובה." },
        phone: {
          type: "string",
          description:
            "רק אם נמסר מספר אחר מזה שממנו כותבים. אחרת המערכת משתמשת במספר " +
            "הוואטסאפ של השיחה, וצריך לומר את זה בשיחה.",
        },
        city: { type: "string", description: "עיר הנכס. חובה." },
        area: { type: "string", description: "שכונה - משפרת את ההתאמה לסוכן/ת." },
        property_type: { type: "string", enum: PROPERTY_TYPES },
        deal_type: {
          type: "string",
          enum: DEAL_TYPES,
          description: "sale = רוצה למכור, rent = רוצה להשכיר.",
        },
        rooms: { type: "number" },
        condition: { type: "string", description: "מצב הנכס במילים." },
        features: { type: "array", items: { type: "string" } },
        note: { type: "string", description: "מה שנאמר ולא נכנס לשדות." },
        consent: {
          type: "boolean",
          description: "אישור מפורש שסוכן/ת ייצור קשר. בלי true הכלי מסרב.",
        },
      },
      required: ["name", "city", "property_type", "deal_type", "consent"],
    },
  },
  {
    name: "find_professionals",
    description:
      "מחזיר בעלי מקצוע שמפרסמים באתר - שמאים, עורכי דין, יועצי משכנתאות, " +
      "מעצבים, קבלני שיפוצים - עם קישור לכרטיס שלהם. להשתמש כששואלים את מי " +
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
  /** כמה לידים נפתחו מהמספר הזה בחלון הנוכחי, ומתי החלון התחיל */
  leads_created: number;
  leads_window_start: string | null;
}

interface PublicContext {
  supabase: SupabaseClient;
  conv: PublicConversationState;
  /** המספר שממנו נכתבה ההודעה — ברירת המחדל לטלפון בליד */
  waPhone: string;
  /** כרטיסי תמונה שכבר נשלחו בתור הזה. מאופס בכל תור, ואינו נשמר. */
  cardsSent: number;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.round(n), max);
}

/**
 * מחרוזת נקייה בתקרת אורך. ברירת המחדל 80 מתאימה לשמות, ערים ומזהים —
 * **לא** לשדות חופשיים. ‏`free_text` ו-`note` מתקבלים ב-intake ב-500 וב-180
 * תווים בהתאמה, וגזירה ל-80 כאן הייתה קוטעת באמצע משפט את הדבר היחיד
 * שהפונה ניסח/ה במילים שלו/ה — ובלי שאיש ידע שזה קרה.
 */
function text(value: unknown, maxLen = 80): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s.slice(0, maxLen) : null;
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
  //
  // סינון האזור נעשה **אחרי** השליפה (ראו למטה), ולכן שליפה לפי אזור חייבת
  // להיות רחבה. התקרה היא פשרה מדודה ולא שרירותית: חיפוש אזור שמחזיר 0
  // בזמן שהנכס חי באתר הוא כשל שקט — הבוט אומר "לא נמצא" והפונה מאמין.
  // ‏400 מכסה בנוחות את כל הלוח בהיקף הנוכחי; אם הוא יגדל בסדר גודל, זו
  // הנקודה שבה הסינון צריך לרדת ל-SQL (RPC עם join לשכונות).
  const AREA_SCAN_LIMIT = 400;
  const { data, error } = await query
    .order("is_promoted", { ascending: false })
    .order("bumped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(area ? AREA_SCAN_LIMIT : limit);

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

  // -------------------------------------------------------------------------
  // נכסים פוטנציאליים — קישורים במקום מבוי סתום
  //
  // חיפוש שחזר ריק או דל נגמר עד עכשיו ב"לא נמצא, אפשר להרחיב טווח או אזור":
  // הבוט **סיפר** לפונה להרחיב במקום להרחיב בעצמו. זה הרגע שבו אדם סוגר את
  // הצ'אט — ובדיוק הרגע שבו יש במלאי שלוש דירות במחיר קרוב, או באותה עיר
  // בשכונה אחרת.
  //
  // הסבב השני מרחיב **רק את מה שאפשר להתפשר עליו**: מחיר ±15%, חדרים ±1,
  // והאזור בתוך העיר. ‏deal_type, ‏category, ‏city וסוג הנכס נשארים נעולים —
  // מי שמחפש/ת דירה להשכרה בעפולה לא רוצה קרקע למכירה בחיפה, וזו אינה
  // "התאמה קרובה" אלא רעש.
  //
  // הן חוזרות **בשדה נפרד** ולא מעורבבות בתוצאות: הכלל "רק מה שחזר מהכלים"
  // שומר על הבוט מלהמציא, והצגת התפשרות כהתאמה היא בדיוק אותה הטעיה בדלת
  // האחורית. הפרומפט מחייב לומר במה הן שונות.
  // -------------------------------------------------------------------------
  const CLOSE_ENOUGH = 3;
  let close: Record<string, unknown>[] = [];
  const relaxed: string[] = [];

  if (rows.length < CLOSE_ENOUGH && !args._relaxed) {
    const widened: Record<string, unknown> = { ...args, _relaxed: true, limit: MAX_RESULTS };

    if (maxPrice !== null) { widened.max_price = Math.round(maxPrice * 1.15); relaxed.push("מחיר עד +15%"); }
    if (minPrice !== null) { widened.min_price = Math.round(minPrice * 0.85); }
    if (minRooms !== null && minRooms > 1) { widened.min_rooms = minRooms - 1; relaxed.push("חדר פחות"); }
    if (maxRooms !== null) { widened.max_rooms = maxRooms + 1; relaxed.push("חדר יותר"); }
    // ‏"באותה עיר" רק כשבאמת ננעלה עיר — הפרומפט מדקלם את relaxed_on כלשונו,
    // ומשפט שאינו מדויק כאן הופך להבטחה לא מדויקת בצ'אט.
    if (area) {
      delete widened.area;
      relaxed.push(city ? `מחוץ ל${area}, ב${city}` : `מחוץ ל${area}`);
    }
    if (minSize !== null) { widened.min_size_sqm = Math.round(minSize * 0.85); }

    // בלי הרחבה אמיתית אין סבב שני: חיפוש בלי אף מגבלה מספרית שחזר ריק
    // פשוט אין לו מה להציע, ושאילתה זהה נוספת היא רק עוד קריאה למסד.
    if (relaxed.length) {
      const more = await searchProperties(ctx, widened) as Record<string, unknown>;
      const found = (more?.properties as Record<string, unknown>[] | undefined) || [];
      const seen = new Set(rows.map((r) => String((r as { id: string }).id)));
      close = found.filter((c) => !seen.has(String(c.id))).slice(0, MAX_RESULTS - rows.length);
    }
  }

  return {
    count: rows.length,
    properties: rows.map(publicProperty),
    // ריק כשהחיפוש הצליח — ואז אין על מה לדבר.
    close_matches: close.length ? close : undefined,
    relaxed_on: close.length ? relaxed : undefined,
    close_note: close.length
      ? "אלה **אינם** מה שהתבקש אלא הקרובים לו במלאי. חובה לומר במה הם שונים לפני שמציגים אותם."
      : undefined,
    all_listings_url: `${SITE_BASE}/`,
  };
}

async function getProperty(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const id = text(args.property_id);
  // ‏Number(null) הוא 0, ו-0 עובר את Number.isFinite. בלי הסינון המפורש
  // קריאה בלי מזהה כלל הייתה מחפשת מודעה מספר 0 ועונה "הנכס אינו פעיל
  // באתר" — תשובה שנשמעת סמכותית ואומרת דבר שלא נבדק.
  const listingRaw = args.listing_number;
  const listing = (listingRaw === null || listingRaw === undefined || listingRaw === "")
    ? NaN
    : Number(listingRaw);

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
    // טלפונים וגוש/חלקה נמחקים כאן, לא בפרומפט. ראו scrubPublicText.
    description: maskPublicText(
      p.marketing_description || p.description || "",
      p.house_number,
    ),
    agency: agency?.name
      ? {
        name: agency.name,
        url: agency.slug ? `${SITE_BASE}/agency?slug=${agency.slug}` : null,
      }
      : null,
    agent: agent?.display_name
      ? {
        name: agent.display_name,
        url: agent.slug ? `${SITE_BASE}/agent?slug=${agent.slug}` : null,
      }
      : null,
    // ‏**הערה אחת, לא שתי אמיתות.** כאן חוזרים שם המשרד והסוכן/ת בלבד;
    // הטלפון והקישור לשיחה נבנים ב-`contact_agent`, כדי שהניסוח של הודעת
    // הפתיחה ושל הנרמול ל-wa.me יישבו במקום אחד.
    contact_note:
      "לכל שאלה שאין עליה תשובה כאן - כתובת מדויקת, מי הבעלים, מתי אפשר " +
      "לראות, גמישות במחיר - לקרוא ל-contact_agent ולהציג את הקישור לשיחה " +
      "ישירה עם הסוכן/ת. אלה שאלות אליו/ה, לא חוסר במאגר.",
  };
}

/**
 * חיבור ישיר לסוכן/ת שמפרסם/ת את הנכס.
 *
 * ## למה זה קיים, ולמה הוא התשובה ל"איפה בדיוק?"
 *
 * הבוט אינו מוסר כתובת מדויקת, שם בעלים או כל מידע פנימי אחר על הנכס — לא
 * מפני שהוא מתחמק, אלא מפני ש**לא הוא הכתובת לשאלות האלה**. הכתובת היא
 * הסוכן/ת שמכיר/ה את הנכס. עד עכשיו הבוט ענה "הפרטים אצל הסוכן/ת" והפנה
 * לדף — צעד נוסף שרוב האנשים לא עושים בוואטסאפ.
 *
 * ‏`contact_url` הוא הקישור שסוגר את הפער — **דף הנכס, ולא `wa.me` ישיר.**
 *
 * ## למה דרך הדף ולא ישר לשיחה
 *
 * קישור `wa.me` מהצ'אט הוא טאפ אחד, וזו הייתה הגרסה הראשונה כאן. הבעיה
 * שהוא **בלתי נראה לחלוטין**: ‏`assets/events.js` סופר קליקים בדף, לא
 * בוואטסאפ, ולכן כל פנייה שנוצרה כך לא הופיעה בשום דוח.
 *
 * וקיצור דרך לא היה עוזר: ריידיירקט שקוף היה מתעד את הקליק בשרת אבל **לא
 * היה צובע פיקסל**, כי הפניית שרת עוזבת את האתר לפני ש-GTM נטען. זה כתוב
 * כבר על `/bot` ב-`_redirects`. צביעה דורשת טעינת דף אמיתית, בלי קיצורים.
 *
 * בדף הנכס כבר יושבים **שני המסלולים**: כפתור וואטסאפ לשיחה מיידית
 * (שנספר כ-`contact_agent`) וטופס להשארת פרטים שיוצר ליד אמיתי דרך
 * ‏`property-inquiry-intake`. מי שרוצה לדבר עכשיו מדבר, מי שמעדיף שיחזרו
 * אליו משאיר פרטים — ושניהם נמדדים.
 *
 * ‏`src=wa_bot` הוא מה שהופך את זה לשימושי: בלעדיו הקליק נספר כמו כל קליק
 * אחר, ואי אפשר לענות על השאלה היחידה שבגללה ההפניה נעשתה — האם המעבר דרך
 * האתר משתלם, או שעדיף היה לחבר ישירות.
 *
 * ⚠️ **מה שנשאר פתוח, ובמודע:** המספר עצמו נשאר זמין, וההוראות מוסרות אותו
 * כשנשאלים עליו ישירות. וואטסאפ הופך מספר בטקסט לכפתור חיוג, והטאפ הזה
 * אינו נמדד ולא ניתן למדידה. מה שנשלט הוא הסדר שבו מציעים, לא קיומו של
 * המספר.
 */
async function contactAgent(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const id = text(args.property_id);
  const listingRaw = args.listing_number;
  const listing = (listingRaw === null || listingRaw === undefined || listingRaw === "")
    ? NaN
    : Number(listingRaw);

  let q = ctx.supabase
    .from("properties")
    .select("id, title, listing_number, house_number, agent_id, agency_id")
    .eq("status", "active");

  if (id) q = q.eq("id", id);
  else if (Number.isFinite(listing)) q = q.eq("listing_number", Math.round(listing));
  else return { error: "missing_identifier", note: "צריך property_id או listing_number." };

  const { data: p, error } = await q.maybeSingle();
  if (error) return { error: "lookup_failed", detail: error.message };
  if (!p) return { found: false, note: "הנכס אינו פעיל באתר כרגע." };

  ctx.conv.last_property_id = p.id;

  const { data: member } = await ctx.supabase
    .from("agency_members")
    .select("display_name, slug, phone, phone_e164")
    .eq("id", p.agent_id)
    .maybeSingle();

  let agencyName: string | null = null;
  if (p.agency_id) {
    const { data: a } = await ctx.supabase
      .from("agencies").select("name").eq("id", p.agency_id).maybeSingle();
    agencyName = a?.name ?? null;
  }

  if (!member?.display_name) {
    return {
      found: true,
      agent: null,
      contact_url: `${propertyUrl(p.id)}&src=wa_bot`,
      note: "אין סוכן/ת משויך/ת למודעה. בדף הנכס יש את פרטי המשרד.",
    };
  }

  return {
    found: true,
    agent: {
      name: member.display_name,
      agency: agencyName,
      // המספר נשאר זמין, אבל **אינו** ה-CTA. ההוראות מוסרות אותו רק כשנשאלים
      // עליו ישירות: וואטסאפ הופך מספר בטקסט לכפתור חיוג, והטאפ הזה בלתי
      // נראה לחלוטין. זה לא ניתן להנדסה — זה מה שמספר טלפון הוא — ולכן מה
      // שנשלט הוא הסדר שבו מציעים.
      phone: member.phone || null,
      phone_note: "למסור רק אם נשאלים עליו ישירות. הקישור הוא הדרך המוצעת.",
      profile_url: member.slug ? `${SITE_BASE}/agent?slug=${member.slug}` : null,
    },
    // ה-CTA. ‏`src=wa_bot` הוא מה שהופך את זה למדיד: בלעדיו הקליק על
    // "וואטסאפ לסוכן" בדף נספר כמו כל קליק אחר, ואי אפשר לדעת שהוא הגיע
    // מהבוט. ‏`assets/events.js` קורא אותו ומצרף אותו לכל אירוע.
    contact_url: `${propertyUrl(p.id)}&src=wa_bot`,
    how_to_use:
      "להציג את contact_url כדרך ליצור קשר עם הסוכן/ת. בדף הנכס יש כפתור " +
      "וואטסאפ לשיחה מיידית **וגם** טופס להשארת פרטים - הבחירה של " +
      "המתעניין/ת. אין להבטיח שהעברנו הודעה.",
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
      tagline: scrubPublicText(a.tagline) || null,
      specialties: ids.map((id) => SPECIALTY_LABELS[id]),
      specialty_ids: ids,
      // "לפי הנכסים שבמשרד" מול הצהרה של המשרד — הבדל שהתשובה צריכה לכבד
      specialties_source: declared.length ? "declared" : "derived",
      areas: a.specialty_areas || [],
      active_properties: owned.length,
      url: a.slug ? `${SITE_BASE}/agency?slug=${a.slug}` : null,
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
    all_agencies_url: `${SITE_BASE}/agencies`,
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
        headline: scrubPublicText(p.headline) || null,
        services: p.services || [],
        areas: p.service_areas || [],
        years_experience: p.years_experience,
        url: p.slug ? `${SITE_BASE}/professional?slug=${p.slug}` : null,
      };
    }),
    all_professionals_url: `${SITE_BASE}/professionals`,
  };
}

// ---------------------------------------------------------------------------
// פרויקטים חדשים מקבלן
// ---------------------------------------------------------------------------

const PROJECT_FIELDS = [
  "id", "slug", "name", "tagline", "marketing_summary", "city", "street",
  "project_stage", "occupancy_date", "occupancy_text", "total_units",
  "available_units", "min_price", "max_price", "min_rooms", "max_rooms",
  "min_size_sqm", "max_size_sqm", "property_types", "features", "cover_url",
  "developer_name", "developer_slug", "is_promoted", "published_at",
].join(", ");

const STAGE_LABELS: Record<string, string> = {
  planning: "בתכנון",
  pre_sale: "טרום מכירה",
  under_construction: "בבנייה",
  ready: "מוכן לאכלוס",
  completed: "הושלם",
};

async function searchProjects(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 5, MAX_RESULTS);

  // ‏projects_public כבר מסננת לפרויקטים חיים: סטטוס פעיל, יזם פעיל, מנוי
  // בתוקף ותאריך פרסום שעבר. אין כאן מה להוסיף עליה.
  let query = ctx.supabase.from("projects_public").select(PROJECT_FIELDS);

  const city = text(args.city);
  if (city) query = query.ilike("city", likeSafe(city));

  const stage = text(args.stage);
  if (stage && (PROJECT_STAGES as readonly string[]).includes(stage)) {
    query = query.eq("project_stage", stage);
  }

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  // התקציב מושווה למחיר **הפתיחה**: פרויקט שמתחיל מתחת לתקציב רלוונטי גם
  // אם יש בו דירות יקרות יותר. השוואה ל-max_price הייתה מסתירה אותו.
  const maxPrice = num(args.max_price);
  if (maxPrice !== null) query = query.lte("min_price", maxPrice);
  // ואותו היגיון הפוך בחדרים: פרויקט נכנס אם הטווח שלו נוגע במבוקש.
  const minRooms = num(args.min_rooms);
  const maxRooms = num(args.max_rooms);
  if (minRooms !== null) query = query.gte("max_rooms", minRooms);
  if (maxRooms !== null) query = query.lte("min_rooms", maxRooms);

  const { data, error } = await query
    .order("is_promoted", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return { error: "search_failed", detail: error.message };

  return {
    count: (data || []).length,
    projects: (data || []).map((p) => {
      // deno-lint-ignore no-explicit-any
      const r = p as any;
      return {
        slug: r.slug,
        name: r.name,
        tagline: r.tagline || r.marketing_summary || null,
        developer: r.developer_name,
        where: [r.street, r.city].filter(Boolean).join(", "),
        stage: STAGE_LABELS[r.project_stage] || r.project_stage,
        occupancy: r.occupancy_text || r.occupancy_date || null,
        price_from: r.min_price === null ? null : Number(r.min_price),
        price_to: r.max_price === null ? null : Number(r.max_price),
        rooms_from: r.min_rooms === null ? null : Number(r.min_rooms),
        rooms_to: r.max_rooms === null ? null : Number(r.max_rooms),
        property_types: r.property_types || [],
        available_units: r.available_units,
        has_cover: !!r.cover_url,
        url: `${SITE_BASE}/project?slug=${r.slug}`,
      };
    }),
    all_projects_url: `${SITE_BASE}/projects`,
  };
}

// ---------------------------------------------------------------------------
// מחשבון המשכנתא
// ---------------------------------------------------------------------------

/** לוח שפיצר — אותה נוסחה שב-index.html. */
function monthlyPayment(loan: number, annualRatePct: number, years: number): number {
  const monthlyRate = (annualRatePct / 100) / 12;
  const n = years * 12;
  if (loan <= 0 || monthlyRate <= 0) return 0;
  return loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) /
    (Math.pow(1 + monthlyRate, n) - 1);
}

function mortgageEstimate(args: Record<string, unknown>): unknown {
  const price = Number(args.property_price);
  const equity = Number(args.equity);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "missing_price", note: "צריך לשאול מה מחיר הנכס." };
  }
  if (!Number.isFinite(equity) || equity < 0) {
    return { error: "missing_equity", note: "צריך לשאול כמה הון עצמי יש." };
  }

  const years = Number.isFinite(Number(args.years))
    ? Math.min(Math.max(Math.round(Number(args.years)), 1), 40)
    : DEFAULT_YEARS;
  const rate = Number.isFinite(Number(args.interest_rate)) && Number(args.interest_rate) > 0
    ? Number(args.interest_rate)
    : DEFAULT_RATE_PCT;

  const loan = Math.max(price - equity, 0);
  const monthly = Math.round(monthlyPayment(loan, rate, years));
  // העיגול קודם להשוואה, כמו באתר: בלעדיו מימון של 75.1% היה מודיע
  // ש-75% חורג מ-75%.
  const ltvPct = price > 0 ? Math.round((loan / price) * 100) : 0;

  const kind = BUYER_KINDS.includes(String(args.buyer_kind))
    ? String(args.buyer_kind)
    : "single";
  const capPct = Math.round(LTV_THRESHOLDS[kind] * 100);

  return {
    property_price: price,
    equity,
    loan_amount: loan,
    years,
    interest_rate: rate,
    monthly_payment: monthly,
    ltv_pct: ltvPct,
    ltv_cap_pct: capPct,
    over_cap: ltvPct > capPct,
    over_cap_note: ltvPct > capPct
      ? `אחוז המימון הנדרש (${ltvPct}%) חורג מהתקרה המקובלת (${capPct}%). ` +
        "צריך הון עצמי גבוה יותר, או נכס זול יותר."
      : null,
    assumptions: `${years} שנים בריבית ${rate}%` +
      (args.years === undefined && args.interest_rate === undefined
        ? " (ברירות המחדל של המחשבון באתר - אפשר לשנות)"
        : ""),
    // ההוראות מחייבות למסור את זה, ולכן הוא חוזר בכל תשובה ולא רק כשחורגים
    disclaimer: DISCLAIMER,
    calculator_url: `${SITE_BASE}/#calc`,
  };
}

// ---------------------------------------------------------------------------
// כרטיס נכס עם תמונה
// ---------------------------------------------------------------------------

function nis(n: number): string {
  return Math.round(n).toLocaleString("he-IL");
}

/** הכיתוב של הכרטיס: שורה על הנכס, שורת פרטים, וקישור. */
// deno-lint-ignore no-explicit-any
function cardCaption(p: any, note: string | null): string {
  const facts = [
    p.rooms ? `${Number(p.rooms)} חד'` : null,
    p.size_sqm ? `${Number(p.size_sqm)} מ"ר` : null,
    p.floor !== null && p.floor !== undefined ? `קומה ${p.floor}` : null,
  ].filter(Boolean).join(" · ");

  return [
    maskPublicText(p.title, p.house_number),
    publicWhere(p),
    [p.price ? `${nis(Number(p.price))} ₪` : null, facts].filter(Boolean).join(" · "),
    note ? `\n${note}` : null,
    `\n${propertyUrl(p.id)}`,
  ].filter(Boolean).join("\n");
}

async function sendPropertyCards(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const items = Array.isArray(args.items) ? args.items : [];
  if (!items.length) return { error: "no_items" };

  const remaining = MAX_CARDS_PER_TURN - ctx.cardsSent;
  if (remaining <= 0) {
    return {
      sent: 0,
      error: "card_limit_reached",
      note: "נשלחו כבר מספיק תמונות בתור הזה. את השאר להזכיר בטקסט עם הקישור.",
    };
  }

  const results: Record<string, unknown>[] = [];

  for (const raw of items.slice(0, remaining)) {
    const item = (raw || {}) as Record<string, unknown>;
    const id = text(item.property_id);
    if (!id) continue;

    const { data } = await ctx.supabase
      .from("properties")
      .select(PROPERTY_FIELDS)
      .eq("id", id)
      .eq("status", "active")
      .maybeSingle();

    if (!data) {
      results.push({ property_id: id, sent: false, reason: "not_active" });
      continue;
    }
    // deno-lint-ignore no-explicit-any
    const p = data as any;
    const image = (p.images || [])[0];
    if (!image) {
      results.push({ property_id: id, sent: false, reason: "no_photo", url: propertyUrl(p.id) });
      continue;
    }

    const caption = cardCaption(p, text(item.note));
    try {
      const waMessageId = await sendImage(ctx.waPhone, image, caption);
      ctx.cardsSent += 1;
      ctx.conv.last_property_id = p.id;
      await ctx.supabase.from("whatsapp_messages").insert({
        wa_message_id: waMessageId,
        direction: "out",
        wa_phone: ctx.waPhone,
        msg_type: "image",
        body: caption,
        media_url: image,
        status: waMessageId ? "sent" : null,
      });
      results.push({ property_id: id, sent: true });
    } catch (err) {
      // תמונה שלא נשלחה אינה סוף העולם — הקישור עדיין עובד, והמודל יידע
      // להזכיר את הנכס בטקסט
      console.error("card send failed", err);
      results.push({
        property_id: id,
        sent: false,
        reason: "send_failed",
        url: propertyUrl(p.id),
      });
    }
  }

  const sent = results.filter((r) => r.sent).length;
  return {
    sent,
    results,
    note: sent
      ? "הכרטיסים נשלחו. עכשיו משפט סיכום קצר בלבד - בלי לחזור על הפרטים שבכיתוב."
      : "לא נשלחה אף תמונה. להזכיר את הנכסים בטקסט, כל אחד עם הקישור שלו.",
  };
}

// ---------------------------------------------------------------------------
// קליטת לידים
// ---------------------------------------------------------------------------

/**
 * קריאה לנקודת קליטה ציבורית של האתר. אותה כתובת ואותו גוף שהדפדפן שולח —
 * ולכן אותה ולידציה, אותה התאמה ואותן תקרות.
 */
async function callIntake(
  fn: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // ‏verify_jwt=false לשתי הפונקציות, אבל ה-Gateway עדיין מצפה ל-apikey
  // בבקשות מבחוץ. שליחתו עולה כלום ומונעת 401 מפתיע.
  if (ANON_KEY) {
    headers["apikey"] = ANON_KEY;
    headers["Authorization"] = `Bearer ${ANON_KEY}`;
  }

  const res = await fetch(`${FUNCTIONS_BASE}/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * התקרה לפונה, בשני חלקים.
 *
 * ‏**הבדיקה והחיוב נפרדים בכוונה.** בגרסה הראשונה המונה עלה לפני הקריאה
 * ל-intake, וכל דחייה משם — קריטריונים חסרים, תקרת חיפושים של המסד, שגיאת
 * כתיבה — הייתה צורכת מכסה. שלוש פניות שנדחו היו נועלות את הפונה ל-24 שעות
 * בלי שנוצר ולו ליד אחד. התקרה קיימת כדי לבלום הצפה, לא כדי להעניש מי
 * ששכח/ה לומר באיזו עיר.
 *
 * ‏`hasLeadSlot` גם מגלגלת את החלון כשעברו 24 שעות, ולכן היא זו שנקראת
 * ראשונה; `consumeLeadSlot` נקראת רק אחרי שה-intake אישר.
 */
function hasLeadSlot(conv: PublicConversationState): boolean {
  const windowMs = LEAD_WINDOW_HOURS * 60 * 60 * 1000;
  const started = conv.leads_window_start ? Date.parse(conv.leads_window_start) : 0;

  if (!started || Date.now() - started > windowMs) {
    conv.leads_window_start = new Date().toISOString();
    conv.leads_created = 0;
  }
  return conv.leads_created < LEAD_DAILY_CAP;
}

function consumeLeadSlot(conv: PublicConversationState): void {
  conv.leads_created += 1;
}

/** מזהה שכונה לפי שם ועיר. משפר את ההתאמה לסוכן/ת; null אינו שגיאה. */
async function lookupNeighborhoodId(
  ctx: PublicContext,
  city: string | null,
  area: string | null,
): Promise<string | null> {
  if (!area) return null;
  let query = ctx.supabase.from("neighborhoods").select("id").ilike("name", likeSafe(area));
  if (city) query = query.ilike("city", likeSafe(city));
  const { data } = await query.limit(1).maybeSingle();
  return data?.id ?? null;
}

function strListArg(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => text(v)).filter((v): v is string => !!v).slice(0, max);
}

async function saveSearchAlert(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fullName = text(args.full_name);
  if (!fullName || fullName.length < 2) {
    return { error: "missing_name", note: "צריך לשאול לשם לפני השמירה." };
  }
  if (!hasLeadSlot(ctx.conv)) {
    return {
      error: "lead_cap_reached",
      note: "נפתחו כבר מספיק פניות מהמספר הזה היום. להפנות לאתר ולא לנסות שוב.",
    };
  }

  const consent = args.consent_agent_contact === true;
  const email = text(args.email);
  // ברירת המחדל היא המספר שממנו כותבים. זה לא "איסוף" — זה המספר שהפונה
  // בחר/ה לכתוב ממנו, וההוראות מחייבות לומר בשיחה שבו נשתמש.
  const phone = text(args.phone) || ctx.waPhone;

  const cities = strListArg(args.cities, 5);
  const neighborhoodId = await lookupNeighborhoodId(
    ctx,
    cities[0] ?? null,
    text(args.area),
  );

  const { ok, status, body } = await callIntake("saved-search-intake", {
    full_name: fullName,
    phone,
    email,
    contact_channel: CONTACT_CHANNELS.includes(String(args.contact_channel))
      ? args.contact_channel
      : (email && !args.phone ? "both" : "whatsapp"),
    consent_agent_contact: consent,
    deal_type: DEAL_TYPES.includes(String(args.deal_type)) ? args.deal_type : "sale",
    category: CATEGORIES.includes(String(args.category)) ? args.category : "residential",
    cities,
    neighborhood_ids: neighborhoodId ? [neighborhoodId] : [],
    property_types: strListArg(args.property_types, 6),
    min_price: args.min_price,
    max_price: args.max_price,
    min_rooms: args.min_rooms,
    max_rooms: args.max_rooms,
    min_size_sqm: args.min_size_sqm,
    required_features: strListArg(args.required_features, 8),
    free_text: text(args.free_text, 500),
    source: "whatsapp_bot_search_agent",
  });

  if (!ok) {
    // התקרה חזרה לפונה: הוא לא עשה דבר רע, ואין טעם לנסות שוב
    if (body.error === "too_many_searches") {
      return {
        saved: false,
        error: "too_many_searches",
        note: "כבר שמורים מספיק חיפושים למספר הזה. אפשר לנהל אותם דרך הקישור שבהתראות.",
      };
    }
    return { saved: false, error: body.error || `http_${status}`, detail: body.detail };
  }

  consumeLeadSlot(ctx.conv);
  return {
    saved: true,
    duplicate: body.duplicate === true,
    consent_given: consent,
    manage_note: "אפשר לבטל את העדכונים בכל רגע דרך הקישור שמופיע בכל התראה.",
    // מה באמת קרה, כדי שהתשובה לא תבטיח יותר: בלי הסכמה אין סוכן/ת בתמונה
    what_happens: consent
      ? "החיפוש נשמר, ועדכונים יישלחו כשיעלה נכס מתאים. הפרטים זמינים גם לסוכן/ת שירצה/תרצה לעזור בחיפוש."
      : "החיפוש נשמר ועדכונים יישלחו כשיעלה נכס מתאים. אף סוכן/ת לא יקבל את הפרטים.",
  };
}

async function ownerLead(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (args.consent !== true) {
    return {
      error: "consent_required",
      note: "בלי אישור מפורש אין פנייה. לשאול, ולא להניח.",
    };
  }
  const name = text(args.name);
  const city = text(args.city);
  const propertyType = text(args.property_type);
  const dealType = String(args.deal_type);
  if (!name || !city || !propertyType || !DEAL_TYPES.includes(dealType)) {
    return {
      error: "missing_fields",
      note: "חסר שם, עיר, סוג נכס או האם למכירה/להשכרה. לשאול רק על מה שחסר.",
    };
  }
  if (!hasLeadSlot(ctx.conv)) {
    return {
      error: "lead_cap_reached",
      note: "נפתחו כבר מספיק פניות מהמספר הזה היום. להפנות לאתר ולא לנסות שוב.",
    };
  }

  const neighborhoodId = await lookupNeighborhoodId(ctx, city, text(args.area));

  const { ok, status, body } = await callIntake("owner-lead-intake", {
    name,
    phone: text(args.phone) || ctx.waPhone,
    city,
    neighborhood_id: neighborhoodId,
    property_type: propertyType,
    deal_type: dealType,
    rooms: args.rooms,
    condition: text(args.condition),
    features: strListArg(args.features, 8),
    note: text(args.note, 180),
    source: "whatsapp_bot_owner_wizard",
  });

  if (!ok) {
    return { created: false, error: body.error || `http_${status}`, detail: body.detail };
  }

  // ‏matched_agent_id ריק = לא נמצא/ה סוכן/ת מתאים/ה כרגע. זה קורה, וההוראות
  // מחייבות לומר את זה בלי להבטיח שמישהו יתקשר מחר.
  const matched = !!body.matched_agent_id;
  consumeLeadSlot(ctx.conv);
  return {
    created: true,
    matched,
    what_happens: matched
      ? "הפנייה הועברה לסוכן/ת תיווך מהאזור, שייצור/תיצור קשר."
      : "הפנייה נשמרה. כרגע לא נמצא/ה סוכן/ת פנוי/ה לאזור ולסוג הנכס, ולכן אי אפשר להבטיח מתי יחזרו.",
    privacy_note:
      "יש לומר שהשם והטלפון נמסרים לסוכן/ת תיווך לצורך יצירת הקשר הזה.",
  };
}

async function projectLead(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (args.consent !== true) {
    return { error: "consent_required", note: "בלי אישור מפורש אין פנייה. לשאול, ולא להניח." };
  }
  const fullName = text(args.full_name);
  if (!fullName || fullName.length < 2) {
    return { error: "missing_name", note: "צריך לשאול לשם." };
  }
  if (!hasLeadSlot(ctx.conv)) {
    return { error: "lead_cap_reached", note: "נפתחו כבר מספיק פניות מהמספר הזה היום." };
  }

  const rooms = Array.isArray(args.rooms)
    ? args.rooms.map((r) => Number(r)).filter((r) => Number.isFinite(r) && r > 0).slice(0, 8)
    : [];

  const { ok, status, body } = await callIntake("project-lead-intake", {
    full_name: fullName,
    phone: text(args.phone) || ctx.waPhone,
    email: text(args.email),
    project_slug: text(args.project_slug),
    cities: strListArg(args.cities, 8),
    rooms,
    max_price: args.max_price,
    timeline: text(args.timeline),
    purpose: text(args.purpose),
    message: typeof args.message === "string" ? args.message.slice(0, 2000) : null,
    source: "whatsapp_bot",
  });

  if (!ok) {
    if (body.error === "rate_limited") {
      return { created: false, error: "rate_limited", note: "נפתחו כבר מספיק פניות היום." };
    }
    if (body.error === "project_not_found") {
      return {
        created: false,
        error: "project_not_found",
        note: "הפרויקט אינו פעיל. לחפש שוב עם search_projects ולא לנחש slug.",
      };
    }
    return { created: false, error: body.error || `http_${status}`, detail: body.detail };
  }

  consumeLeadSlot(ctx.conv);
  return {
    created: true,
    // ‏direct=true פירושו שהפנייה נחתה אצל היזם של הפרויקט עצמו
    what_happens: body.direct
      ? "הפנייה הועברה ליזם של הפרויקט, שייצור קשר."
      : "הפנייה נשמרה ותועבר ליזמים שמשווקים פרויקטים מתאימים.",
    privacy_note: "יש לומר שהשם והטלפון נמסרים ליזם לצורך יצירת הקשר הזה.",
  };
}

async function mortgageLead(
  ctx: PublicContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (args.consent !== true) {
    return { error: "consent_required", note: "בלי אישור מפורש אין פנייה. לשאול, ולא להניח." };
  }
  const fullName = text(args.full_name);
  if (!fullName || fullName.length < 2) {
    return { error: "missing_name", note: "צריך לשאול לשם." };
  }
  if (!hasLeadSlot(ctx.conv)) {
    return { error: "lead_cap_reached", note: "נפתחו כבר מספיק פניות מהמספר הזה היום." };
  }

  const { ok, status, body } = await callIntake("mortgage-lead-intake", {
    full_name: fullName,
    phone: text(args.phone) || ctx.waPhone,
    email: text(args.email),
    owns_property: args.owns_property === true,
    property_price: args.property_price,
    equity: args.equity,
    interest_rate: args.interest_rate,
    years: args.years,
    monthly_payment: args.monthly_payment,
    source: "whatsapp_bot",
  });

  if (!ok) {
    return { created: false, error: body.error || `http_${status}`, detail: body.detail };
  }

  consumeLeadSlot(ctx.conv);
  return {
    created: true,
    // ‏duplicate = כבר יש פנייה פתוחה מאותו מספר. מבחינת הפונה זו הצלחה.
    duplicate: body.duplicate === true,
    what_happens:
      "הפרטים הועברו, ויועץ/ת משכנתאות ייצור קשר. אין התחייבות לזמן תגובה.",
    privacy_note:
      "יש לומר שהשם, הטלפון ונתוני החישוב נמסרים ליועץ/ת משכנתאות לצורך יצירת הקשר.",
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
      case "contact_agent":
        return await contactAgent(ctx, args);
      case "find_agencies":
        return await findAgencies(ctx, args);
      case "find_professionals":
        return await findProfessionals(ctx, args);
      case "save_search_alert":
        return await saveSearchAlert(ctx, args);
      case "owner_lead":
        return await ownerLead(ctx, args);
      case "search_projects":
        return await searchProjects(ctx, args);
      case "project_lead":
        return await projectLead(ctx, args);
      case "mortgage_estimate":
        return mortgageEstimate(args);
      case "mortgage_lead":
        return await mortgageLead(ctx, args);
      case "send_property_card":
        return await sendPropertyCards(ctx, args);
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
/**
 * ההוראות הקבועות — זהות בכל שיחה ובכל פנייה, ולכן ניתנות למטמון.
 *
 * ‏⚠️ אסור להכניס לכאן דבר שמשתנה בין קריאות. ההסבר המלא (ולמה כשל כזה שקט)
 * יושב מעל `SYSTEM_STATIC` ב-`agent.ts`.
 *
 * ‏`SITE_BASE` מגיע ממשתנה סביבה ולכן הוא קבוע לאורך חיי הפונקציה — הוא
 * בסדר כאן.
 */
const SYSTEM_STATIC: string = (() => {
  const lines = [
    "את/ה העוזר האוטומטי של שוק הנדל\"ן של עפולה והסביבה - אתר נדל\"ן מקומי " +
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
    "הצגת נכסים - בתמונה:",
    "- מצאת נכסים מתאימים? **send_property_card**, עד שלושה, ואז משפט סיכום " +
      "קצר. וואטסאפ הוא ערוץ ויזואלי, וקישור בלי תמונה כמעט לא נפתח.",
    "- הכיתוב כבר מכיל שם, מיקום, מחיר, חדרים וקישור. **אין לחזור עליהם " +
      "בטקסט** - משפט אחד שמחבר (\"שלושה שמתאימים לתקציב, השני הכי קרוב " +
      "למרכז\") ושאלה אחת קדימה.",
    "- נכס שחזר sent=false - להזכיר אותו בטקסט עם הקישור שחזר, בלי להתנצל.",
    "",
    "פרויקטים חדשים מקבלן:",
    "- **שני מאגרים נפרדים.** ‏search_properties הוא נכסים יד שנייה מהמשרדים; " +
      "‏search_projects הוא פרויקטים מקבלן. \"משהו חדש\", \"על הנייר\", " +
      "\"מקבלן\" או \"פרויקט\" = search_projects. מי שלא אמר/ה - ואפשר " +
      "ששניהם מתאימים - מקבל/ת את שניהם, קודם הנכסים.",
    "- פרויקט הוא טווח ולא נכס: מחיר מ-, חדרים מ-עד, שלב בנייה ומועד אכלוס. " +
      "לנסח ככה, ולא כאילו מדובר בדירה אחת.",
    "",
    "משכנתא:",
    "- שאלה על החזר חודשי, כמה אפשר לקנות או אחוז מימון = **mortgage_estimate**. " +
      "חסר מחיר או הון עצמי - לשאול, לא להניח.",
    "- **חובה למסור את ה-disclaimer שחוזר מהכלי**, ולא לנסח אותו מחדש. זו " +
      "הערכה כללית, לא ייעוץ, והתנאים בפועל נקבעים מול הבנק.",
    "- לומר גם את assumptions (כמה שנים ובאיזו ריבית) - מספר בלי ההנחות שמאחוריו " +
      "נשמע כמו הצעה.",
    "- אם over_cap - למסור את over_cap_note. זו המסקנה החשובה בתשובה.",
    "- **ואז שאלה אחת**: שיועץ/ת משכנתאות ייצור קשר ויבדוק את התמונה המלאה? " +
      "כן מפורש = mortgage_lead עם הנתונים מהחישוב. לא = לסיים יפה, בלי לשאול שוב.",
    "- אין לומר אם ריבית היא טובה, אם כדאי לקחת מסלול כזה או אחר, ואין להמליץ " +
      "על בנק.",
    "",
    "כללים שאין לחרוג מהם:",
    "- **רק מה שחזר מהכלים.** אין להמציא נכס, מחיר, משרד או נתון. אם הכלי " +
      "החזיר ריק גם ב-close_matches - לומר שלא נמצא, ולהציע לשמור התראה.",
    "- **‏close_matches אינם תשובה לשאלה - הם הקרוב לה.** להציג אותם רק אחרי " +
      "שנאמר שלא נמצא בדיוק מה שהתבקש, ולומר במה הם שונים לפי relaxed_on " +
      "(\"קצת מעל התקציב\", \"3 חדרים ולא 4\", \"שכונה אחרת בעפולה\"). " +
      "להציג אותם כהתאמה היא הטעיה. עם הקישור של כל אחד, כרגיל.",
    "- **מידע פנימי על הנכס אינו נמסר**: כתובת מדויקת ומספר בית, גוש וחלקה, " +
      "שם בעל/ת הנכס או כל פרט מזהה אחר עליו/ה. הנכסים מוצגים ברחוב ובשכונה. " +
      "אין לנחש, אין לשחזר מהתיאור, ואין להתנצל על כך.",
    "- **וכל שאלה כזו נגמרת ב-contact_agent, לא ב'אין לי'.** 'איפה בדיוק?', " +
      "'מי הבעלים?', 'מתי אפשר לראות?', 'המחיר גמיש?' - אלה שאלות לסוכן/ת " +
      "שמכיר/ה את הנכס. להציג את השם ואת **contact_url** - בדף הנכס יש כפתור " +
      "וואטסאפ לשיחה מיידית וגם טופס להשארת פרטים, והבחירה היא של המתעניין/ת. " +
      "**זו התשובה, לא פרס ניחומים.**",
    "- **הקישור קודם, המספר רק כשנשאלים.** ‏contact_url הוא מה שמציעים; את " +
      "הטלפון מוסרים כשנשאלים עליו ישירות ('מה המספר שלו?'), ואז בלי היסוס. " +
      "לא כי המספר סודי - אלא כי הדף נותן למתעניין/ת גם שיחה וגם טופס, " +
      "ומאפשר לנו לדעת שהפנייה הגיעה מכאן.",
    "- **אין להבטיח שהעברנו הודעה.** המתעניין/ת פונה בעצמו/ה מהדף. " +
      "הבוט מכין, האדם שולח.",
    "- **אין ייעוץ משפטי, מיסויי, שמאי או פיננסי.** אפשר להסביר מושג באופן " +
      "כללי, ואז להפנות לבעל/ת המקצוע המתאים/ה דרך find_professionals.",
    "- **אין הערכת שווי לנכס** ואין אמירה אם מחיר הוא הזדמנות או יקר מדי. " +
      "אפשר לומר מה טווח המחירים של נכסים דומים שנמצאו במאגר, וזה הכול.",
    "- **אין התחייבות בשם אף משרד או סוכן/ת** - לא על זמינות, לא על עמלה ולא " +
      "על מחיר. את/ה מפנה, הם מסכמים.",
    "- אין לבקש תעודת זהות, פרטי תשלום או מסמכים. שם ופרטי קשר נאספים רק " +
      "בתרחיש אחד - ראו \"השארת פרטים\" למטה - ורק אחרי אישור מפורש.",
    "",
    "המלצה על משרדים:",
    "- ההמלצה היא **לפי התאמה לתחום ולאזור**, לא לפי העדפה. אין \"המשרד הכי " +
      "טוב\" - יש מי שמתמחה במה שנשאל.",
    "- כשהתחומים חזרו עם specialties_source = derived, הם נגזרו מהנכסים של " +
      "המשרד בפועל ולא מהצהרה שלו. לנסח בהתאם (\"לפי הנכסים שהוא מפרסם\").",
    "- להציע עד שלושה משרדים, עם מה שמייחד כל אחד ועם הקישור לדף שלו.",
    "",
    "השארת פרטים - ארבעה מסלולים, ורק הם:",
    "",
    "**א. מחפש/ת שלא מצאנו לו/ה כלום.** אחרי חיפוש שחזר ריק או דל, ואחרי " +
      "שהצעת להרחיב טווח - שאלה אחת קצרה: לעדכן כשיעלה נכס כזה? אם כן - " +
      "לשאול לשם, ולקרוא ל-save_search_alert עם הקריטריונים מהשיחה.",
    "- **שאלת ההסכמה נפרדת מהשאלה הזו.** \"שסוכן/ת גם ייצור קשר ויעזור " +
      "בחיפוש?\" - כן מפורש = consent_agent_contact true; לא, שתיקה, \"נראה\" " +
      "או שינוי נושא = false. חיפוש נשמר בשני המקרים, וזו לא פשרה: העדכונים " +
      "הם ההבטחה, והסוכן/ת הוא תוספת שמבקשים.",
    "- אין לשאול שוב מי שסירב/ה. בשיחה אחת שואלים פעם אחת.",
    "",
    "**ב. בעל/ת נכס שרוצה למכור או להשכיר.** מי שאומר/ת \"יש לי דירה למכירה\" " +
      "או \"אני רוצה להשכיר\" - להסביר שאפשר להעביר את הפרטים לסוכן/ת תיווך " +
      "מהאזור שייצור קשר, ולשאול אם רוצים. אחרי כן: שם, עיר, שכונה, סוג הנכס, " +
      "ואם למכירה או להשכרה - ואז owner_lead.",
    "- זו פנייה לתיווך, ויש לומר זאת במילים האלה. מי שרצה/תה רק הערכת מחיר " +
      "יקבל/תקבל הסבר, לא ליד.",
    "",
    "**ג. מתעניין/ת בפרויקט מקבלן.** אחרי search_projects, למי שרוצה פרטים, " +
      "מחירון או לתאם - להציע שהיזם ייצור קשר. אחרי אישור: project_lead, עם " +
      "ה-slug של הפרויקט אם מדובר באחד מסוים.",
    "",
    "**ד. מי שצריך/ה משכנתא.** אחרי mortgage_estimate ואחרי ה-disclaimer - " +
      "לשאול אם רוצים שיועץ/ת ייצור קשר. אחרי אישור: mortgage_lead.",
    "",
    "מה שנכון לארבעתם:",
    "- **המספר שממנו כותבים הוא ברירת המחדל לטלפון, ויש לומר את זה**: " +
      "\"אשתמש במספר שממנו את/ה כותב/ת\". מי שמעדיף/ה מספר או מייל אחר - " +
      "לשאול ולהעביר בפרמטר.",
    "- לומר בפשטות מה קורה עם הפרטים לפני שקוראים לכלי: למי הם מגיעים ולשם מה.",
    "- אחרי הכלי - לומר את what_happens שחזר, כלשונו ובלי לייפות. אם חזר " +
      "‏matched=false, אין להבטיח שמישהו יחזור.",
    "- **אין לקרוא לאף אחד מארבעת הכלים בלי שנאמר \"כן\" ברור.** נימוס אינו " +
      "הסכמה, שתיקה אינה הסכמה, ו\"תשלח לי מה שיש\" אינו אישור ליצירת קשר.",
    "- **שאלה אחת בכל שיחה, לא ארבע.** מי שסירב/ה למסלול אחד לא נשאל/ת על " +
      "האחרים, ומי שכבר השאיר/ה פרטים לא נשאל/ת שוב. בוט שמנסה למכור בכל " +
      "הזדמנות הוא בוט שסוגרים.",
    "- אם חזר lead_cap_reached - לומר שאפשר להמשיך באתר, ולא לנסות שוב.",
    "",
    "גבולות התפקיד:",
    "- מי שרוצה לפרסם נכס, לפתוח משרד או להצטרף כסוכן/ת - להפנות ל-" +
      `${SITE_BASE}/pricing . אין לך דרך לרשום אותו/ה.`,
    "- מי שמבקש/ת לדבר עם אדם - להפנות לדף הנכס או המשרד הרלוונטי, ולומר " +
      "בפשטות שאת/ה עוזר/ת אוטומטי/ת ולא הסוכן/ת עצמו/ה.",
    "- מי שמעדיף/ה להירשם לעדכונים בעצמו/ה - \"הסוכן החכם\" באתר: " +
      `${SITE_BASE}/ . אותו מנגנון בדיוק.`,
  ];
  return lines.join("\n");
})();

/**
 * ‏`system` כשני בלוקים: הקבוע (במטמון) ואחריו המשתנה.
 *
 * הבלוק השני מושמט כשאין בו תוכן — שיחה ותיקה בלי נכס אחרון מחזירה מחרוזת
 * ריקה, ובלוק טקסט ריק נדחה ב-400. נקודת השבירה נשארת על הראשון בכל מקרה.
 */
function buildSystem(conv: PublicConversationState): Anthropic.TextBlockParam[] {
  const head: Anthropic.TextBlockParam = {
    type: "text",
    text: SYSTEM_STATIC,
    cache_control: { type: "ephemeral" },
  };
  const tail = sessionContext(conv).trim();
  return tail ? [head, { type: "text", text: tail }] : [head];
}

/** החלק המשתנה — יושב אחרי נקודת השבירה ולכן אינו מבטל את המטמון. */
function sessionContext(conv: PublicConversationState): string {
  const lines: string[] = [];

  if (!conv.history.length) {
    lines.push(
      "",
      "**זו ההודעה הראשונה בשיחה.** לפתוח במשפט אחד קצר שאומר מי את/ה - " +
        "העוזר האוטומטי של שוק הנדל\"ן של עפולה והסביבה - ומיד לענות לגופו " +
        "של עניין. לא תפריט, לא ברכה ארוכה.",
    );
  }
  if (conv.last_property_id) {
    lines.push(
      "",
      `הנכס האחרון שהוצג בשיחה: ${conv.last_property_id}. ` +
        "אם נשאלת שאלה בלי לומר על מה (\"כמה חדרים יש בו?\") - זה הנכס.",
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
  /** המספר שממנו הגיעה ההודעה, כברירת מחדל לטלפון בליד */
  waPhone: string;
}): Promise<string> {
  const { supabase, conv, userText, waPhone } = opts;
  const ctx: PublicContext = { supabase, conv, waPhone, cardsSent: 0 };

  const messages: Anthropic.MessageParam[] = [
    ...conv.history,
    { role: "user", content: userText },
  ];

  let finalText = "";
  // הבלוק שנושא כרגע את נקודת השבירה המתגלגלת בהודעות.
  let rollingMark: { cache_control?: { type: "ephemeral" } } | null = null;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 2048,
      // ‏low הספיק כשהיו כאן ארבעה כלי חיפוש וההחלטה ביניהם הייתה חד-משמעית.
      // עם אחד-עשר כלים, שני מאגרים נפרדים (נכסים מול פרויקטים) וארבעה
      // מסלולי ליד שכל אחד מהם נעול מאחורי אישור מפורש — ההחלטות הן בדיוק
      // אלה ש-low טועה בהן, וטעות כאן היא ליד שנפתח בלי שביקשו. אם הלטנטיות
      // בצ'אט תיעשה מורגשת, הידית היא לצמצם כלים ולא לרדת בחזרה.
      output_config: { effort: "medium" },
      // ההוראות הקבועות במטמון, והחלק המשתנה אחריהן. סדר הרינדור הוא
      // ‏tools → system → messages, ולכן נקודת השבירה תופסת גם את אחד-עשר
      // הכלים. ראו SYSTEM_STATIC ב-agent.ts להסבר המלא.
      // הבלוק השני נוסף רק כשיש בו משהו: בשיחה ותיקה בלי נכס אחרון
      // ‏`sessionContext` מחזירה מחרוזת ריקה, ובלוק טקסט ריק נדחה ב-400.
      system: buildSystem(conv),
      tools: TOOLS,
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);

    const u = response.usage as unknown as Record<string, number | undefined>;
    console.log(
      `public-llm ${MODEL} iter=${i} in=${u.input_tokens ?? 0} ` +
        `cache_read=${u.cache_read_input_tokens ?? 0} ` +
        `cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens ?? 0}`,
    );

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

    // נקודת שבירה מתגלגלת על תוצאות הכלים, כמו ב-agent.ts. **חובה לנקות את
    // הקודמת** — תקרת ה-API היא ארבע נקודות שבירה לבקשה, וסימון מצטבר היה
    // מפיל תור ארוך בשגיאה.
    if (rollingMark) delete rollingMark.cache_control;
    rollingMark = null;

    const last = results[results.length - 1] as
      | (Anthropic.ToolResultBlockParam & { cache_control?: { type: "ephemeral" } })
      | undefined;
    if (last && i < MAX_TOOL_ITERATIONS - 1) {
      last.cache_control = { type: "ephemeral" };
      rollingMark = last;
    }

    messages.push({ role: "user", content: results });
  }

  if (!finalText) {
    finalText = "לא הצלחתי למצוא תשובה לזה כרגע. אפשר לנסח אחרת, או לחפש ישירות באתר: " +
      `${SITE_BASE}/`;
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
