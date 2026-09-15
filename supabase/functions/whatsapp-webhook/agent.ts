import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { geocodeAfula } from "./geocode.ts";
import {
  addMonthsIso,
  documentHtml,
  insertPayload,
  missingForAgreement,
  propertyLabel,
  signerRows,
  templateFor,
  type AgreementProperty,
  type AgreementSigner,
} from "../_shared/agreement-build.ts";

// ה"מוח" של בוט הוואטסאפ: מקבל את מה שהסוכן/ת כתב/ה (או הכתיב/ה בהקלטה),
// מריץ לולאת tool-use מול Claude, ומחזיר את הטקסט לשליחה חזרה בוואטסאפ.
// כל פעולה במסד הנתונים עוברת דרך הכלים כאן — ל-LLM אין גישה ישירה ל-SQL,
// וכל כלי מקבע בעצמו את agent_id/agency_id כדי שלא ניתן יהיה לגעת בנכס של
// סוכן/ת אחר/ת גם אם המודל "ישתכנע" לנסות.
//
// ---------------------------------------------------------------------------
// חמשת התחומים
// ---------------------------------------------------------------------------
//
// עד גרסה זו היו כאן נכסים בלבד, וזה מה שסוכן/ת קיבל/ה כששאל/ה משהו אחר:
// "אין לי גישה למאגר לקוחות — אני מטפל רק בנכסים". התחומים האחרים כבר היו
// במסד; מה שחסר היה כלי שמגיע אליהם. עכשיו:
//
//   ‏1. **נכסים** — יצירה, עדכון, סטטוס, תמונות, וספירה אמיתית.
//   ‏2. **לקוחות** — קובץ הלקוחות: הוספה, עדכון דרישות, סטטוס.
//   ‏3. **התאמות** — שני הכיוונים: מה מתאים ללקוח/ה, ולמי מתאים נכס.
//   ‏4. **הסכמים** — קריאה בלבד + קישורי חתימה אישיים להעברה ללקוח/ה.
//   ‏5. **לידים והתראות** — קריאה, ושליטה על אילו התראות יוצאות בוואטסאפ.
//
// ## שני גבולות שנשמרים בכוונה
//
// **כתיבה בהסכמים אינה כאן.** גוף המסמך נבנה בדפדפן ונחסם במסד בטריגר
// (`agreements_freeze_body`), וכל ערכה הראייתי של החתימה תלוי בזה. הבוט
// קורא הסכמים ומחזיר את קישור החתימה האישי — בדיוק מה שכפתור הוואטסאפ
// בדשבורד עושה — ולא מייצר ולא מתקן מסמך.
//
// **פתיחת ליד אינה כאן.** ‏`claim_lead` מעבירה כסף או צורכת מכסה, והיא
// נעולה מאחורי `lead-claim` שגוזרת את הזהות מ-JWT מאומת. הבוט מזהה לפי
// מספר טלפון — ראיה חלשה יותר — ולכן הוא מציג לידים במצב מוסתר (‏`leads_masked`)
// ומפנה לדשבורד לפתיחה. הודעה שמוצאת את הליד שווה כמעט כמו פתיחתו.
//
// ## למה הצלבות עוברות דרך פונקציות במסד
//
// מנוע ההתאמות (‏`client_property_match`) הוא מקור האמת היחיד לניקוד, והוא
// יושב במסד. שכפול הנוסחה כאן היה מתפצל ממנה תוך חודש, והסוכן/ת היה מקבל/ת
// בוואטסאפ ציון אחר מזה שבמסך. שלוש הפונקציות ‏`agent_client_matches`,
// ‏`agent_client_match_counts` ו-`agent_property_client_matches`
// (‏מיגרציה 20261029090000) הן אותו מנוע עם מזהה סוכן/ת מפורש, כי כאן אין JWT.

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "",
});

const MODEL = "claude-opus-5";
// שמונה ולא שש: זרימות הלקוחות דורשות שני כלים לפני הפעולה עצמה ("מצא את
// הלקוח/ה" → "הצלב" → "עדכן"), ושש סבבים היו נגמרים באמצע.
const MAX_TOOL_ITERATIONS = 8;
// כמה הודעות שיחה קודמות לשמור. מספיק כדי ש"תוסיף לזה מרפסת" יעבוד,
// קצר מספיק כדי שהעלות והלטנטיות לא יזחלו עם הזמן.
const HISTORY_LIMIT = 12;

// ---------------------------------------------------------------------------
// אוצר מילים — משוכפל מ-crm.html (קבצים סטטיים נפרדים, אין מודול משותף).
// אם מוסיפים סוג נכס או מאפיין בטופס ב-CRM, לעדכן גם כאן, אחרת הבוט ייצור
// נכסים עם ערכים שהטופס בדשבורד לא יודע להציג.
// ---------------------------------------------------------------------------
const RESIDENTIAL_PTYPES = [
  "דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "מרתף/פרטר", "טריפלקס",
  "יחידת דיור", "סטודיו/לופט", "בית פרטי/קוטג'", "דו משפחתי",
  "משק חקלאי/נחלה", "משק עזר", "מגרש", "בניין מגורים", "מחסן", "חניה",
  "קב' רכישה/זכות לנכס",
];
const COMMERCIAL_PTYPES = [
  "משרדים", "חנויות/שטח מסחרי", "מבני תעשייה", "אולמות", "חלל עבודה משותף",
  "בניין משרדים", "מגרשים", "מחסנים", "סטודיו", "כללי", "מרתף", "חניון",
  "בית מלון", "קליניקות",
];
const RESIDENTIAL_FEATURES = [
  "parking", "elevator", "balcony", "ac", "bars", "accessible",
  "renovated_feature", "furnished", "mamad", "exclusive", "building_shelter",
  "mamak", "storage",
];
const COMMERCIAL_FEATURES = [
  "parking", "elevator", "balcony", "ac", "high_ceiling", "cameras",
  "kitchenette", "alarm", "meeting_room", "loading_ramp", "comms", "cold_room",
];
const CONDITIONS = [
  "new_from_contractor", "new", "renovated", "maintained", "needs_renovation",
];
const PROJECT_STATUSES = [
  "planning", "permit_requested", "permit_issued", "construction_complete",
];
const STATUSES = ["active", "sold", "rented", "archived"];

const CLIENT_STATUSES = ["active", "paused", "closed"];

// שדות שמותר ל-LLM לכתוב אליהם. כל מה שלא ברשימה (agent_id, agency_id,
// is_promoted, bumped_at…) נקבע בשרת או לא ניתן לשינוי דרך וואטסאפ.
const WRITABLE_FIELDS = [
  "title", "description", "category", "property_type", "deal_type", "price",
  "rooms", "city", "street", "house_number", "floor", "size_sqm",
  "built_size_sqm", "condition", "project_status", "move_in_date",
  "move_in_soon", "features", "restrooms_location", "storage_location",
  "mamad_location",
] as const;

// אותו היגיון לקובץ הלקוחות. ‏status אינו כאן אלא בכלי נפרד, כדי ש"תעדכן
// לה את התקציב" לא יוכל לסגור לקוח/ה בטעות.
const CLIENT_WRITABLE_FIELDS = [
  "full_name", "phone", "email", "notes", "deal_type", "category",
  "property_types", "cities", "min_price", "max_price", "min_rooms",
  "max_rooms", "min_size_sqm", "max_floor", "required_features",
] as const;

const AGREEMENT_KIND_KEYS = [
  "sell", "buy", "tenant", "landlord", "exclusive_sell", "exclusive_landlord",
];

export interface AgentRow {
  id: string;
  agency_id: string | null;
  display_name: string | null;
  tier: string;
  agencies?: { name?: string } | null;
}

export interface ConversationState {
  history: Anthropic.MessageParam[];
  pending_images: string[];
  last_property_id: string | null;
  last_client_id: string | null;
}

// ---------------------------------------------------------------------------
// הגדרות הכלים
// ---------------------------------------------------------------------------
const propertyFields = {
  category: {
    type: "string",
    enum: ["residential", "commercial"],
    description: "מגורים או מסחרי. ברירת מחדל residential.",
  },
  property_type: {
    type: "string",
    description:
      `סוג הנכס. למגורים אחד מתוך: ${RESIDENTIAL_PTYPES.join(", ")}. ` +
      `למסחרי אחד מתוך: ${COMMERCIAL_PTYPES.join(", ")}.`,
  },
  deal_type: {
    type: "string",
    enum: ["sale", "rent"],
    description: "sale = למכירה, rent = להשכרה.",
  },
  price: { type: "number", description: "מחיר בשקלים. 1.8 מליון = 1800000." },
  title: {
    type: "string",
    description:
      "כותרת המודעה. אם הסוכן/ת לא נתן/נה כותרת — אל תשאל/י, תשאיר/י ריק ותיווצר כותרת אוטומטית.",
  },
  description: { type: "string", description: "תיאור חופשי של הנכס." },
  rooms: { type: "number", description: "מספר חדרים (אפשר 3.5)." },
  city: { type: "string", description: "עיר. ברירת מחדל עפולה." },
  street: { type: "string", description: "שם רחוב בלי מספר בית." },
  house_number: { type: "string", description: "מספר בית בלבד." },
  floor: { type: "integer", description: "קומה." },
  size_sqm: { type: "number", description: 'שטח במ"ר.' },
  built_size_sqm: { type: "number", description: 'שטח בנוי במ"ר.' },
  condition: {
    type: "string",
    enum: CONDITIONS,
    description: "מצב הנכס (רק למגורים).",
  },
  project_status: { type: "string", enum: PROJECT_STATUSES },
  move_in_date: { type: "string", description: "תאריך כניסה בפורמט YYYY-MM-DD." },
  move_in_soon: { type: "boolean", description: "כניסה מיידית/גמיש." },
  features: {
    type: "array",
    items: { type: "string" },
    description:
      `קודי מאפיינים. למגורים: ${RESIDENTIAL_FEATURES.join(", ")}. ` +
      `למסחרי: ${COMMERCIAL_FEATURES.join(", ")}.`,
  },
  restrooms_location: { type: "string", enum: ["building", "unit"] },
  storage_location: { type: "string", enum: ["building", "unit"] },
  mamad_location: { type: "string", enum: ["building", "unit"] },
} as const;

// ---------------------------------------------------------------------------
// שדות הדרישות של לקוח/ה.
//
// אותם שמות בדיוק כמו בטופס הלקוח/ה ב-crm.html, כי מנוע ההתאמות מסנן עליהם
// ב-SQL. **מערך ריק או null אינם מסננים כלום** ("לא משנה") — זו ההתנהגות
// שמאפשרת להזין לקוח/ה עם שתי שורות מידע ולקבל התאמות מיד, במקום לדרוש טופס
// מלא לפני שהמנוע מחזיר משהו. לכן גם אין כאן שאלות הכרח מלבד השם.
// ---------------------------------------------------------------------------
const clientFields = {
  full_name: { type: "string", description: "שם הלקוח/ה או שם המשפחה." },
  phone: { type: "string", description: "טלפון, בכל פורמט." },
  email: { type: "string", description: "אימייל." },
  notes: { type: "string", description: "הערות חופשיות — מה שנאמר ואין לו שדה." },
  deal_type: {
    type: "string",
    enum: ["sale", "rent"],
    description: "‏sale = מחפש/ת לקנות, ‏rent = מחפש/ת לשכור. ברירת מחדל sale.",
  },
  category: {
    type: "string",
    enum: ["residential", "commercial"],
    description: "מגורים או מסחרי. ברירת מחדל residential.",
  },
  property_types: {
    type: "array",
    items: { type: "string" },
    description:
      `סוגי הנכס שמחפשים. למגורים מתוך: ${RESIDENTIAL_PTYPES.join(", ")}. ` +
      `למסחרי מתוך: ${COMMERCIAL_PTYPES.join(", ")}. מערך ריק = כל סוג.`,
  },
  cities: {
    type: "array",
    items: { type: "string" },
    description: "ערים. מערך ריק = כל עיר.",
  },
  min_price: { type: "number", description: "תחתית התקציב בשקלים." },
  max_price: { type: "number", description: "תקרת התקציב בשקלים. שכירות = מחיר חודשי." },
  min_rooms: { type: "number", description: "מינימום חדרים (אפשר 3.5)." },
  max_rooms: { type: "number", description: "מקסימום חדרים." },
  min_size_sqm: { type: "number", description: 'מינימום מ"ר.' },
  max_floor: { type: "integer", description: "הקומה הגבוהה ביותר שמסכימים לה." },
  required_features: {
    type: "array",
    items: { type: "string" },
    description:
      `מאפיינים שהם תנאי. למגורים: ${RESIDENTIAL_FEATURES.join(", ")}. ` +
      `למסחרי: ${COMMERCIAL_FEATURES.join(", ")}. מערך ריק = אין תנאי.`,
  },
} as const;

// סוגי ההתראה שאפשר לבקש גם בוואטסאפ. מקביל ל-NOTIF_TYPES ב-crm.html ולסוגים
// ש-`notifications_type_check` מתיר. ‏review_alert ו-lead_unrouted אינם כאן
// בכוונה: הם של מנהל/ת הפלטפורמה ומגיעים גם במייל.
const NOTIFY_TYPES = [
  "new_lead", "client_match", "agreement_signed", "review_new", "deal_closed",
  "review_request", "marketing_copy", "system",
];

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_property",
    description:
      "יוצר נכס חדש בשם הסוכן/ת ומפרסם אותו במצב active. תמונות שהגיעו בשיחה " +
      "וטרם שויכו לנכס מתחברות אליו אוטומטית. כשהעיר עפולה ויש רחוב ומספר בית, " +
      "המערכת מנסה למצוא קואורדינטות בעצמה כדי שהנכס יופיע על המפה. " +
      "אם אותה כתובת כבר קיימת אצל הסוכן/ת (גם אם נמכרה או בארכיון) הכלי לא " +
      "יוצר כפילות אלא מחזיר duplicate — ראו את הכלל בהוראות.",
    input_schema: {
      type: "object",
      properties: {
        ...propertyFields,
        force_new: {
          type: "boolean",
          description:
            "רק אחרי שהסוכן/ת אישר/ה במפורש שמדובר בנכס אחר ולא בכפילות. " +
            "מדלג על בדיקת הכפילות ויוצר מודעה נוספת.",
        },
      },
      required: ["property_type", "deal_type", "price"],
    },
  },
  {
    name: "update_property",
    description:
      "מעדכן שדות בנכס קיים של הסוכן/ת. שולחים רק את השדות שמשתנים.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "מזהה הנכס (UUID)." },
        ...propertyFields,
      },
      required: ["property_id"],
    },
  },
  {
    name: "set_property_status",
    description:
      "משנה את סטטוס הנכס. archived = הסרה מהאתר (זו הדרך למחוק נכס — אין מחיקה " +
      "אמיתית, בדיוק כמו בדשבורד). sold/rented = נמכר/הושכר.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        status: { type: "string", enum: STATUSES },
      },
      required: ["property_id", "status"],
    },
  },
  {
    name: "list_properties",
    description:
      "מחזיר את הנכסים של הסוכן/ת, החדשים קודם. להשתמש כשצריך למצוא את מזהה " +
      "הנכס שהסוכן/ת מתאר/ת במילים ('הדירה באבן גבירול').",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: STATUSES,
          description: "סינון לפי סטטוס. ברירת מחדל: כל הסטטוסים.",
        },
        limit: { type: "integer", description: "כמה להחזיר. ברירת מחדל 20." },
      },
      required: [],
    },
  },
  {
    name: "attach_images",
    description:
      "משייך לנכס קיים את התמונות שהגיעו בשיחה וטרם שויכו. להשתמש כשהסוכן/ת " +
      "שולח/ת תמונות ומבקש/ת לצרף אותן לנכס שכבר קיים.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },
  {
    name: "property_stats",
    description:
      "מחזיר ספירות מדויקות של הנכסים של הסוכן/ת: סך הכול, לפי סטטוס, לפי " +
      "קטגוריה (מגורים/מסחרי), לפי סוג עסקה, וכמה מהפעילים בלי תמונות. " +
      "**זה הכלי לכל שאלת 'כמה'** — list_properties מוגבל ב-50 שורות, וספירה " +
      "מתוכו היא ניחוש.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "property_link",
    description:
      "מחזיר את הקישור לדף הנכס באתר ולצדו הודעת וואטסאפ מוכנה להעברה — " +
      "כותרת, כתובת, חדרים, שטח, מחיר וקישור. זה הכלי ל\"תשלח לי את הקישור " +
      "לדירה בעלייה 20\" ול\"תכין לי הודעה על הנכס\". עם client_id מקובץ " +
      "הלקוחות ההודעה נפתחת בפנייה בשם, וחוזר גם קישור ישיר לצ'אט של אותו/ה " +
      "לקוח/ה — **הסוכן/ת לוחץ/ת ושולח/ת מהמספר שלו/ה**, הבוט אינו שולח " +
      "ללקוח/ה.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        client_id: {
          type: "string",
          description:
            "אופציונלי. מזהה לקוח/ה מהקובץ שההודעה מיועדת לו/ה.",
        },
        note: {
          type: "string",
          description:
            "אופציונלי. משפט אישי שהסוכן/ת ביקש/ה שייכנס להודעה.",
        },
      },
      required: ["property_id"],
    },
  },
  {
    name: "property_performance",
    description:
      "איך הנכס מתפקד באתר: צפיות בדף (סך הכול, 7 ימים, 30 יום), כמה פניות " +
      "הגיעו עליו, ומצב הקידום, ההקפצה, השת\"פ והתמונות. זה הכלי ל\"כמה " +
      "צפיות יש לדירה בהרצל\" ול\"למה אין פניות על הנכס הזה\". נתוני " +
      "הצפיות קיימים על הנכסים של הסוכן/ת בלבד.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },
  {
    name: "cma_report",
    description:
      "דוח השוואת שוק (CMA) לנכס: עסקאות שנסגרו בסביבה, ממוצע, חציון, טווח, " +
      "מחיר למ\"ר, והפער בין המחיר המבוקש לממוצע השוק. זה הכלי ל\"כמה שווה " +
      "הנכס\", \"מה נמכר באזור\" ו\"האם המחיר ריאלי\". מחזיר תקציר ואת " +
      "העסקאות הקרובות ביותר; הדוח המלא להדפסה או לשליחה ללקוח/ה נמצא " +
      "בדשבורד.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        limit: {
          type: "integer",
          description: "כמה עסקאות השוואה לפרט. ברירת מחדל 5, מקסימום 10.",
        },
      },
      required: ["property_id"],
    },
  },
  {
    name: "planning_info",
    description:
      "מידע תכנוני ובנייה על הנכס: ייעוד קרקע, אחוזי בנייה, יחידות דיור " +
      "וקומות מותרות, הערה תכנונית, סטטוס רישום החלקה והתוכניות החלות. " +
      "מחבר את מה שהסוכן/ת הצהיר/ה בטופס הנכס עם מה שנקלט מה-GIS של עיריית " +
      "עפולה. זה הכלי ל\"מה מותר לבנות שם\" ו\"מה הייעוד של המגרש\". על " +
      "נכס של סוכן/ת אחר/ת חוזר רק מה שמוצג בדף הנכס הפומבי, בלי גוש וחלקה.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },

  // -------------------------------------------------------------------------
  // קובץ הלקוחות
  // -------------------------------------------------------------------------
  {
    name: "list_clients",
    description:
      "מחזיר את קובץ הלקוחות של הסוכן/ת עם הדרישות של כל אחד/ת, ולצד כל " +
      "לקוח/ה גם מספר ההתאמות הפתוחות וההתאמה החזקה ביותר. זה הכלי גם לשאלת " +
      "'כמה לקוחות יש לי' וגם למצוא את מזהה הלקוח/ה לפי שם.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: CLIENT_STATUSES,
          description: "סינון לסטטוס אחד. ברירת המחדל, בלי השדה הזה: active בלבד.",
        },
        all_statuses: {
          type: "boolean",
          description: "true מחזיר גם לקוחות בהשהיה ולקוחות שסגרו עסקה.",
        },
        query: {
          type: "string",
          description: "חיפוש חופשי בשם או בטלפון.",
        },
        limit: { type: "integer", description: "כמה להחזיר. ברירת מחדל 20." },
      },
      required: [],
    },
  },
  {
    name: "create_client",
    description:
      "מוסיף לקוח/ה לקובץ הלקוחות של הסוכן/ת. **שדה ריק פירושו 'לא משנה'** " +
      "ואינו מסנן כלום — לקוח/ה עם שם וטלפון בלבד הוא רשומה תקפה שמקבלת " +
      "התאמות. אל תשאל/י על שדות שלא נאמרו.",
    input_schema: {
      type: "object",
      properties: {
        ...clientFields,
        force_new: {
          type: "boolean",
          description:
            "רק אחרי שהסוכן/ת אישר/ה במפורש שמדובר באדם אחר ולא בכפילות. " +
            "מדלג על בדיקת הכפילות בשם ובטלפון.",
        },
      },
      required: ["full_name"],
    },
  },
  {
    name: "update_client",
    description:
      "מעדכן פרטים או דרישות של לקוח/ה קיים/ת. שולחים רק את מה שמשתנה. " +
      "לביטול דרישה שולחים מערך ריק (למשל cities: []).",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "מזהה הלקוח/ה (UUID)." },
        ...clientFields,
      },
      required: ["client_id"],
    },
  },
  {
    name: "set_client_status",
    description:
      "משנה את סטטוס הלקוח/ה. ‏active = מחפש/ת, ‏paused = בהשהיה, " +
      "‏closed = סגר/ה עסקה או אינו/ה מחפש/ת עוד. \"תמחק את הלקוח/ה\" = closed — " +
      "הרשומה נשארת בקובץ ורק יוצאת מהרשימה הפעילה, בדיוק כמו בדשבורד.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        status: { type: "string", enum: CLIENT_STATUSES },
      },
      required: ["client_id", "status"],
    },
  },

  // -------------------------------------------------------------------------
  // התאמות — שני הכיוונים
  // -------------------------------------------------------------------------
  {
    name: "client_matches",
    description:
      "מה מתאים ללקוח/ה מסוים/ת. מצליב את הדרישות מול שלושה מאגרים בבת אחת: " +
      "הנכסים של הסוכן/ת, נכסי המשרד, ומה שמשרדים אחרים שיתפו עם המשרד. כל " +
      "התאמה חוזרת עם ציון באחוזים ועם הפערים.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        limit: { type: "integer", description: "ברירת מחדל 5." },
      },
      required: ["client_id"],
    },
  },
  {
    name: "property_matches",
    description:
      "הכיוון ההפוך: למי מהלקוחות בקובץ מתאים נכס מסוים. זה הכלי ל\"למי " +
      "להתקשר על הדירה הזו\", וגם אחרי יצירת נכס חדש.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        limit: { type: "integer", description: "ברירת מחדל 5." },
      },
      required: ["property_id"],
    },
  },
  {
    name: "list_match_alerts",
    description:
      "התראות ההתאמה שנפתחו מעצמן — נכס חדש (או נכס שהמחיר שלו ירד) שהתאים " +
      "ללקוח/ה בקובץ. ברירת המחדל היא מה שטרם נצפה.",
    input_schema: {
      type: "object",
      properties: {
        include_seen: { type: "boolean", description: "true מחזיר גם התראות שנצפו." },
        limit: { type: "integer", description: "ברירת מחדל 10." },
      },
      required: [],
    },
  },

  // -------------------------------------------------------------------------
  // הסכמים — קריאה וקישורי חתימה
  // -------------------------------------------------------------------------
  {
    name: "list_agreements",
    description:
      "ההסכמים של הסוכן/ת: סוג, סטטוס, מי החותמים ומי מהם כבר חתם/ה. " +
      "להשתמש לשאלות \"מה ממתין לחתימה\", \"האם X חתם/ה\", ולמצוא את מזהה " +
      "ההסכם. **אין דרך ליצור או לתקן הסכם מכאן** — זה נעשה באשף בדשבורד.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "viewed", "signed", "cancelled"],
          description: "סינון לפי סטטוס. ברירת המחדל: כל מה שאינו מבוטל.",
        },
        pending_only: {
          type: "boolean",
          description: "true מחזיר רק הסכמים שטרם נחתמו במלואם.",
        },
        expiring_soon: {
          type: "boolean",
          description:
            "true מחזיר רק הסכמי בלעדיות שתקופתם נגמרת בחודש וחצי הקרוב או " +
            "שכבר נגמרה. זה הכלי ל\"איזו בלעדיות נגמרת לי\".",
        },
        limit: { type: "integer", description: "ברירת מחדל 10." },
      },
      required: [],
    },
  },
  {
    name: "agreement_sign_links",
    description:
      "מחזיר את קישור החתימה האישי של כל חותם/ת שטרם חתם/ה בהסכם. הקישור " +
      "אישי לכל חותם/ת ואין להעביר אותו הלאה — יש להעתיק אותו לצ'אט של " +
      "החותם/ת עצמו/ה. הסוכן/ת הוא/היא שמעביר/ה, הבוט אינו שולח ללקוח/ה.",
    input_schema: {
      type: "object",
      properties: { agreement_id: { type: "string" } },
      required: ["agreement_id"],
    },
  },
  {
    name: "prepare_agreement",
    description:
      "מכין הזמנת שירותי תיווך ללקוח/ה מקובץ הלקוחות, מצרף אליה את הנכסים " +
      "שהסוכן/ת ביקש/ה, ומחזיר את קישור החתימה האישי. **אותו קישור משמש " +
      "לשתי הדרכים**: העברה ללקוח/ה לחתימה מרחוק, או פתיחה במכשיר של " +
      "הסוכן/ת לחתימה פנים מול פנים. " +
      "‏kind: ‏sell = בעל/ת נכס שמוכר/ת · landlord = בעל/ת נכס שמשכיר/ה · " +
      "buy = קונה · tenant = שוכר/ת · exclusive_sell / exclusive_landlord = " +
      "בלעדיות. " +
      "אם חסר משהו שנדרש כדי שההזמנה תהיה בכתב כדין — הכלי **אינו יוצר** " +
      "אלא מחזיר missing עם רשימת החסרים, ואז יש לבקש אותם מהסוכן/ת ולקרוא " +
      "שוב. גוף המסמך ננעל ברגע היצירה ואי אפשר לתקן אותו — לתיקון מבטלים " +
      "בדשבורד ומוציאים חדש.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: AGREEMENT_KIND_KEYS,
          description: "סוג הטופס.",
        },
        client_id: {
          type: "string",
          description: "מזהה הלקוח/ה מקובץ הלקוחות — זה/זו החותם/ת הראשי/ת.",
        },
        client_id_number: {
          type: "string",
          description:
            "ת.ז. או ח״פ של הלקוח/ה. חובה להזמנה בכתב. אם חסר בכרטיס — " +
            "מבקשים מהסוכן/ת, והערך נשמר גם בכרטיס הלקוח/ה.",
        },
        property_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "הנכסים שההסכם חל עליהם. בטופסי בעל/ת נכס ובלעדיות — נכס אחד.",
        },
        commission_pct: { type: "number", description: "עמלה באחוזים." },
        commission_amount: { type: "number", description: "או סכום עמלה בשקלים." },
        commission_basis: {
          type: "string",
          enum: ["price", "monthly", "yearly", "flat"],
          description:
            "בסיס חישוב העמלה. במכירה price; בשכירות monthly (דמי שכירות " +
            "חודשיים), yearly או flat.",
        },
        exclusive_from: { type: "string", description: "תחילת הבלעדיות, YYYY-MM-DD." },
        exclusive_until: { type: "string", description: "סוף הבלעדיות, YYYY-MM-DD." },
        exclusive_months: {
          type: "integer",
          description: "במקום תאריך סיום: משך בחודשים מתאריך ההתחלה.",
        },
        extra_signers: {
          type: "array",
          description:
            "חותמים נוספים — בן/בת זוג או בעלים שותף/ה. כל אחד/ת מקבל/ת " +
            "קישור חתימה נפרד משלו/ה.",
          items: {
            type: "object",
            properties: {
              full_name: { type: "string" },
              id_number: { type: "string" },
              phone: { type: "string" },
              email: { type: "string" },
            },
            required: ["full_name", "id_number"],
          },
        },
        notes: { type: "string", description: "הערות שייכנסו למסמך." },
      },
      required: ["kind", "client_id", "property_ids"],
    },
  },
  {
    name: "agreement_details",
    description:
      "כל הפרטים של הסכם אחד: סוג, סטטוס, שיעור וסכום העמלה, תקופת הבלעדיות " +
      "וכמה ימים נשארו בה, פעולות השיווק שהתחייבנו להן, הנכסים והלקוחות " +
      "שההסכם חל עליהם, וכל חותם/ת עם מועד הצפייה והחתימה. בהסכם חתום חוזר " +
      "גם קישור לעותק החתום. זה הכלי ל\"כמה עמלה סיכמנו עם דני\", \"מתי " +
      "נגמרת הבלעדיות\" ו\"תשלח לי את ההסכם החתום\".",
    input_schema: {
      type: "object",
      properties: { agreement_id: { type: "string" } },
      required: ["agreement_id"],
    },
  },

  // -------------------------------------------------------------------------
  // לידים והתראות
  // -------------------------------------------------------------------------
  {
    name: "list_leads",
    description:
      "הלידים שהשתייכו לסוכן/ת. שם וטלפון של ליד שטרם נפתח מגיעים מוסתרים " +
      "(‏א***, ‏05-****1) — זה מכוון ולא תקלה. פתיחת ליד עולה מכסה או כסף " +
      "ולכן נעשית בדשבורד בלבד.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["masked", "unlocked", "pending_charge"],
          description: "סינון. ברירת מחדל: הכול.",
        },
        limit: { type: "integer", description: "ברירת מחדל 10." },
      },
      required: [],
    },
  },
  {
    name: "list_notifications",
    description:
      "ההתראות שממתינות בפעמון של הסוכן/ת — לידים, התאמות, ביקורות, הסכמים " +
      "שנחתמו, עסקאות בצוות. זה הכלי ל\"מה חדש\" ו\"מה פספסתי\".",
    input_schema: {
      type: "object",
      properties: {
        include_read: { type: "boolean", description: "true מחזיר גם התראות שנקראו." },
        limit: { type: "integer", description: "ברירת מחדל 10." },
      },
      required: [],
    },
  },
  {
    name: "whatsapp_alerts",
    description:
      "מציג או משנה אילו סוגי התראה יישלחו לסוכן/ת **גם כהודעת וואטסאפ**, " +
      "ולא רק בפעמון שבדשבורד. ברירת המחדל היא שאף סוג אינו נשלח בוואטסאפ — " +
      "ערוץ יוצא נדלק רק בבקשה מפורשת.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "enable", "disable", "set"],
          description:
            "‏get = מה מוגדר כרגע · enable = הוספת סוגים · disable = הסרת " +
            "סוגים (בלי types — כיבוי הערוץ כולו) · set = החלפת הרשימה כולה.",
        },
        types: {
          type: "array",
          items: { type: "string", enum: NOTIFY_TYPES },
          description:
            "סוגי ההתראה. ‏new_lead = ליד חדש · client_match = נכס שהתאים " +
            "ללקוח/ה · agreement_signed = הסכם שנחתם מרחוק · review_new = " +
            "ביקורת חדשה · deal_closed = עסקה שנסגרה בצוות (מנהל/ת בלבד) · " +
            "review_request = תזכורת לבקש חוות דעת · marketing_copy = תיאור " +
            "שיווקי שנכתב אוטומטית · system = שיתופי נכסים והודעות מערכת.",
        },
      },
      required: ["action"],
    },
  },
];

// ---------------------------------------------------------------------------
// מימוש הכלים
// ---------------------------------------------------------------------------
interface ToolContext {
  supabase: SupabaseClient;
  agent: AgentRow;
  conv: ConversationState;
}

const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");

function propertyLink(id: string): string | undefined {
  return SITE_BASE_URL ? `${SITE_BASE_URL}/property.html?id=${id}` : undefined;
}

/** הקישור הקבוע לעותק החתום — אותו אחד שנשלח לכל הצדדים במייל אחרי החתימה. */
function agreementLink(viewToken: string): string | undefined {
  return SITE_BASE_URL ? `${SITE_BASE_URL}/agreement.html?t=${viewToken}` : undefined;
}

/** מחיר כפי שהוא נקרא בהודעה: שכירות היא תמיד לחודש. */
function priceText(price: unknown, dealType: unknown): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "";
  const formatted = n.toLocaleString("he-IL");
  return dealType === "rent" ? `${formatted} ₪ לחודש` : `${formatted} ₪`;
}

/**
 * ‏wa.me דורש מספר בינלאומי בלי + ובלי האפס המוביל — אותו נרמול שיושב
 * ב-`waLink` ב-`crm.html`. מספר שאינו נראה כמו מספר ישראלי תקין מחזיר
 * ‏undefined, ואז הודעת ההעברה נשלחת דרך בורר הצ'אטים של וואטסאפ במקום
 * לצ'אט שגוי.
 */
function waNumber(phone: unknown): string | undefined {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 9) return undefined;
  if (digits.startsWith("972")) return digits;
  return "972" + digits.replace(/^0+/, "");
}

/** מספר מה-LLM, או null. ‏NaN שנכנס לעמודה numeric מפיל את כל ה-insert. */
function finiteOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ‏YYYY-MM-DD אמיתי, או null. תאריך שבור מפיל insert במקום לחזור כשאלה. */
function isoDateOrNull(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(raw + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : raw;
}

/** נכס שהסוכן/ת רשאי/ת לראות: שלו/ה, או כל נכס פעיל — כמו ה-RLS. */
async function visibleProperty(ctx: ToolContext, propertyId: string, columns: string) {
  const { data } = await ctx.supabase
    .from("properties")
    .select(columns)
    .eq("id", propertyId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  if (row.agent_id !== ctx.agent.id && row.status !== "active") return null;
  return row;
}

/** בונה כותרת סבירה כשהסוכן/ת לא נתן/נה אחת — עדיף מלשאול שאלה מיותרת. */
function autoTitle(p: Record<string, unknown>): string {
  const parts = [String(p.property_type || "נכס")];
  if (p.rooms) parts.push(`${p.rooms} חדרים`);
  const address = [p.street, p.house_number].filter(Boolean).join(" ");
  if (address) parts.push(`ב${address}`);
  if (p.city) parts.push(address ? `, ${p.city}` : `ב${p.city}`);
  return parts.join(" ").replace(" ,", ",");
}

/**
 * מסננת את קלט ה-LLM לשדות שמותר לכתוב אליהם, ומנקה ערכים ריקים.
 *
 * ‏מערך ריק **כן** עובר, ובכוונה: בקובץ הלקוחות `cities: []` היא הדרך לבטל
 * דרישה ("לא משנה לו/ה איפה"), ולא היעדר ערך.
 */
function pick(
  input: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

const pickWritable = (input: Record<string, unknown>) => pick(input, WRITABLE_FIELDS);

/** מוודאת שהנכס באמת שייך לסוכן/ת לפני כל שינוי. */
async function ownedProperty(ctx: ToolContext, propertyId: string) {
  const { data } = await ctx.supabase
    .from("properties")
    .select("id, title, images, street, house_number, city")
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// כפילות
//
// אותו היגיון שרץ בטופס "נכס חדש" בדשבורד (‏findPropertyDuplicate ב-crm.html):
// אותה כתובת אחרי נרמול, ורק כשמספר החדרים, הקומה וסוג העסקה מתאימים —
// אחרת זו דירה אחרת באותו בניין. בוואטסאפ זה קריטי אפילו יותר: "תעלה את
// הדירה בעלייה 20" נאמר בלי לראות את הרשימה, ובלי הבדיקה נוצרת מודעה שנייה.
// ---------------------------------------------------------------------------
function normText(value: unknown): string {
  return String(value ?? "")
    .replace(/^\s*(רחוב|רח['׳]?)\s+/u, "")
    .replace(/["'׳״,.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function numEq(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") return true;
  return Number(a) === Number(b);
}

async function findDuplicateProperty(ctx: ToolContext, payload: Record<string, unknown>) {
  const city = normText(payload.city);
  const street = normText(payload.street);
  const house = normText(payload.house_number);
  const title = normText(payload.title);
  if (!city || (!street && !title)) return null;

  const { data, error } = await ctx.supabase
    .from("properties")
    .select("id, listing_number, title, price, rooms, floor, deal_type, property_type, city, street, house_number, status, updated_at")
    .eq("agent_id", ctx.agent.id)
    .limit(500);
  if (error || !data) return null;

  const sameAddress = (p: Record<string, unknown>) =>
    !!(street && house && normText(p.city) === city &&
       normText(p.street) === street && normText(p.house_number) === house);
  const sameTitlePrice = (p: Record<string, unknown>) =>
    !!(title && normText(p.title) === title && Number(p.price) === Number(payload.price));
  const sameUnit = (p: Record<string, unknown>) =>
    numEq(p.rooms, payload.rooms) && numEq(p.floor, payload.floor) &&
    (!p.deal_type || !payload.deal_type || p.deal_type === payload.deal_type);

  const matches = data.filter((p) => (sameAddress(p) && sameUnit(p)) || sameTitlePrice(p));
  if (!matches.length) return null;

  // נכס פעיל קודם לארכיון: מודעה כפולה *באוויר* היא הנזק הגדול יותר
  matches.sort((a, b) => {
    const liveA = a.status === "active" ? 0 : 1;
    const liveB = b.status === "active" ? 0 : 1;
    if (liveA !== liveB) return liveA - liveB;
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
  });
  return { match: matches[0], total: matches.length };
}

async function toolCreateProperty(ctx: ToolContext, input: Record<string, unknown>) {
  if (!ctx.agent.agency_id) {
    return { ok: false, error: "לסוכן/ת אין משרד משויך — צריך להשלים הרשמה בדשבורד." };
  }

  const payload = pickWritable(input);
  payload.category ??= "residential";
  payload.city ??= "עפולה";
  payload.agent_id = ctx.agent.id;
  payload.agency_id = ctx.agent.agency_id;
  payload.status = "active";
  if (!payload.title) payload.title = autoTitle(payload);
  // address נגזר משני השדות בדיוק כמו בטופס בדשבורד
  const street = payload.street as string | undefined;
  const houseNumber = payload.house_number as string | undefined;
  if (street || houseNumber) {
    payload.address = [street, houseNumber].filter(Boolean).join(" ");
  }

  // פין על המפה: בלי lat/lng הנכס לא מופיע במפה בעמוד הבית
  if (payload.city === "עפולה" && street && houseNumber) {
    const coords = await geocodeAfula(street, houseNumber);
    if (coords) {
      payload.lat = coords.lat;
      payload.lng = coords.lng;
    }
  }

  // כפילות: לא יוצרים, אלא מחזירים למודל את המודעה הקיימת כדי שישאל/תשאל
  // את הסוכן/ת. ‏force_new הוא האישור המפורש לעקוף.
  if (!input.force_new) {
    const duplicate = await findDuplicateProperty(ctx, payload);
    if (duplicate) {
      const m = duplicate.match;
      ctx.conv.last_property_id = m.id;
      return {
        ok: false,
        duplicate: true,
        property_id: m.id,
        listing_number: m.listing_number,
        status: m.status,
        title: m.title,
        address: [m.street, m.house_number, m.city].filter(Boolean).join(" "),
        price: m.price,
        rooms: m.rooms,
        floor: m.floor,
        also_similar: duplicate.total - 1,
        error:
          "כבר קיימת מודעה לאותה כתובת אצל הסוכן/ת. לא נוצרה מודעה חדשה — " +
          "שאל/י את הסוכן/ת אם להחזיר ולעדכן את הקיימת או לפרסם מודעה נוספת.",
      };
    }
  }

  // התמונות שהצטברו בשיחה מתחברות מיד לנכס החדש — זו כל הפואנטה של
  // "לצלם את הדירה ולשלוח בוואטסאפ יחד עם הטקסט"
  const images = ctx.conv.pending_images;
  if (images.length) payload.images = images;

  const { data, error } = await ctx.supabase
    .from("properties")
    .insert(payload)
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = data.id;
  ctx.conv.pending_images = [];

  return {
    ok: true,
    property_id: data.id,
    title: data.title,
    images_attached: images.length,
    on_map: payload.lat !== undefined,
    link: propertyLink(data.id),
  };
}

async function toolUpdateProperty(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const existing = await ownedProperty(ctx, propertyId);
  if (!existing) return { ok: false, error: "לא נמצא נכס כזה אצל הסוכן/ת." };

  const payload = pickWritable(input);
  if (!Object.keys(payload).length) {
    return { ok: false, error: "לא נשלח אף שדה לעדכון." };
  }

  // כשהכתובת משתנה — גם address וגם הפין על המפה צריכים להתעדכן איתה
  const street = (payload.street ?? existing.street) as string | undefined;
  const houseNumber = (payload.house_number ?? existing.house_number) as string | undefined;
  if (payload.street !== undefined || payload.house_number !== undefined) {
    payload.address = [street, houseNumber].filter(Boolean).join(" ") || null;
    const city = (payload.city ?? existing.city) as string | undefined;
    if (city === "עפולה" && street && houseNumber) {
      const coords = await geocodeAfula(street, houseNumber);
      if (coords) {
        payload.lat = coords.lat;
        payload.lng = coords.lng;
      }
    }
  }
  payload.updated_at = new Date().toISOString();

  const { error } = await ctx.supabase
    .from("properties")
    .update(payload)
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id);

  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = propertyId;
  return {
    ok: true,
    property_id: propertyId,
    updated_fields: Object.keys(payload).filter((k) => k !== "updated_at"),
    link: propertyLink(propertyId),
  };
}

async function toolSetStatus(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const status = String(input.status || "");
  if (!STATUSES.includes(status)) return { ok: false, error: "סטטוס לא חוקי." };

  const existing = await ownedProperty(ctx, propertyId);
  if (!existing) return { ok: false, error: "לא נמצא נכס כזה אצל הסוכן/ת." };

  const { error } = await ctx.supabase
    .from("properties")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id);

  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = propertyId;
  return { ok: true, property_id: propertyId, title: existing.title, status };
}

async function toolListProperties(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = ctx.supabase
    .from("properties")
    .select("id, title, address, city, price, rooms, deal_type, status, created_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) query = query.eq("status", String(input.status));

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data.length, properties: data };
}

async function toolAttachImages(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  if (!ctx.conv.pending_images.length) {
    return { ok: false, error: "אין תמונות ממתינות בשיחה." };
  }

  const existing = await ownedProperty(ctx, propertyId);
  if (!existing) return { ok: false, error: "לא נמצא נכס כזה אצל הסוכן/ת." };

  const merged = [...(existing.images || []), ...ctx.conv.pending_images];
  const { error } = await ctx.supabase
    .from("properties")
    .update({ images: merged, updated_at: new Date().toISOString() })
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id);

  if (error) return { ok: false, error: error.message };

  const added = ctx.conv.pending_images.length;
  ctx.conv.pending_images = [];
  ctx.conv.last_property_id = propertyId;
  return { ok: true, property_id: propertyId, images_added: added, total_images: merged.length };
}

/**
 * ספירות מדויקות במקום ניחוש.
 *
 * הכלי הזה נולד מכשל אמיתי: לשאלה "כמה נכסים מסחריים יש לי" הבוט קרא
 * ל-`list_properties`, קיבל 50 שורות (התקרה), וענה "מתוך 50 האחרונים, כ-42
 * מסחריים". התשובה נשמעה מוסמכת והייתה שגויה בשורש — אין דרך לספור מדגם.
 * ‏`count: 'exact'` עם `head: true` מחזיר מספר מהמסד בלי להעביר שורות בכלל.
 */
async function toolPropertyStats(ctx: ToolContext) {
  const { data, error } = await ctx.supabase
    .rpc("agent_property_stats", { p_agent_id: ctx.agent.id });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as Record<string, unknown>) };
}

// ---------------------------------------------------------------------------
// קישור לנכס והודעה מוכנה
//
// ‏`wa.me` ולא שליחה מהשרת, ומאותה סיבה שקישור החתימה אינו נשלח ללקוח/ה
// (`agreement_sign_links`): ההודעה יוצאת מהמספר של הסוכן/ת, נקראת אישית, ומי
// שמחליט/ה למי היא נשלחת הוא/היא מי שמכיר/ה את הצדדים. הבוט מכין, הסוכן/ת
// לוחץ/ת. זו גם הסיבה שאין כאן שום כתיבה למסד — הכלי הזה בונה טקסט.
// ---------------------------------------------------------------------------
async function toolPropertyLink(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const p = await visibleProperty(
    ctx,
    propertyId,
    "id, agent_id, title, address, city, street, house_number, price, rooms, " +
      "size_sqm, built_size_sqm, deal_type, property_type, status, listing_number",
  );
  if (!p) return { ok: false, error: "לא נמצא נכס כזה." };

  const link = propertyLink(String(p.id));
  if (!link) {
    return { ok: false, error: "כתובת האתר אינה מוגדרת בשרת — אין דרך לבנות קישור." };
  }

  let client: Record<string, unknown> | null = null;
  if (input.client_id) {
    const found = await ownedClient(ctx, String(input.client_id));
    if (!found) return { ok: false, error: "לא נמצא/ה לקוח/ה כזה/כזו בקובץ של הסוכן/ת." };
    client = found as unknown as Record<string, unknown>;
  }

  const address = [p.street, p.house_number].filter(Boolean).join(" ") ||
    String(p.address || "");
  const facts = [
    p.rooms ? `${p.rooms} חדרים` : "",
    (p.built_size_sqm || p.size_sqm) ? `${p.built_size_sqm || p.size_sqm} מ"ר` : "",
    priceText(p.price, p.deal_type),
  ].filter(Boolean).join(" · ");

  const greeting = client
    ? `היי ${String(client.full_name || "").trim()},`
    : "";
  const message = [
    greeting,
    String(p.title || autoTitle(p)),
    [address, p.city].filter(Boolean).join(", "),
    facts,
    String(input.note || "").trim(),
    link,
  ].filter(Boolean).join("\n");

  const encoded = encodeURIComponent(message);
  const clientWa = client ? waNumber(client.phone) : undefined;

  ctx.conv.last_property_id = String(p.id);
  if (client) ctx.conv.last_client_id = String(client.id);

  return {
    ok: true,
    property_id: p.id,
    listing_number: p.listing_number,
    title: p.title,
    status: p.status,
    link,
    message,
    // בורר הצ'אטים של וואטסאפ — לכל נמען/ת שהסוכן/ת יבחר/תבחר
    wa_share_url: `https://wa.me/?text=${encoded}`,
    // וכשיש לקוח/ה עם טלפון: ישר לצ'אט שלו/ה, מהמספר של הסוכן/ת
    wa_client_url: clientWa ? `https://wa.me/${clientWa}?text=${encoded}` : undefined,
    client_name: client ? client.full_name : undefined,
    client_phone_missing: !!client && !clientWa,
    // קישור לנכס שאינו active נפתח רק אצל הסוכן/ת שלו — ה-policy על
    // ‏`properties` מחזירה לאנונימי/ת נכסים פעילים בלבד. עדיף לומר את זה כאן
    // מאשר שהלקוח/ה יקבל/תקבל דף ריק.
    warning: p.status !== "active"
      ? `הנכס במצב ${p.status} — הקישור לא ייפתח אצל מי שאינו הסוכן/ת שלו. להחזרה לאוויר: set_property_status עם active.`
      : undefined,
  };
}

/**
 * איך הנכס מתפקד.
 *
 * ‏`property_views` נקרא כאן על הנכסים של הסוכן/ת בלבד, בדיוק כמו ה-policy
 * שלו בדשבורד (ולכן גם עמודת הצפיות קיימת רק בייצוא העצמי — ראו
 * ‏`docs/property-export.md`). ‏`service_role` עוקף RLS, ולכן הגבול הזה נשמר
 * כאן בקוד.
 */
async function toolPropertyPerformance(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const { data: p } = await ctx.supabase
    .from("properties")
    .select("id, title, address, city, status, price, deal_type, images, " +
            "is_promoted, promoted_until, bumped_at, shared_with_partners, " +
            "created_at, listing_number")
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  if (!p) {
    return {
      ok: false,
      error: "לא נמצא נכס כזה אצל הסוכן/ת. נתוני הצפיות קיימים על הנכסים שלך בלבד.",
    };
  }

  const since = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();

  const countViews = async (from?: string) => {
    let q = ctx.supabase
      .from("property_views")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId);
    if (from) q = q.gte("viewed_at", from);
    const { count } = await q;
    return count ?? 0;
  };

  const [viewsTotal, views30, views7] = await Promise.all([
    countViews(),
    countViews(since(30)),
    countViews(since(7)),
  ]);

  const { count: leadsTotal } = await ctx.supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("agent_id", ctx.agent.id);

  const daysOnline = Math.max(
    1,
    Math.round((Date.now() - new Date(String(p.created_at)).getTime()) / 86_400_000),
  );
  const images = (p.images as unknown as string[] | null) || [];

  ctx.conv.last_property_id = String(p.id);

  return {
    ok: true,
    property_id: p.id,
    listing_number: p.listing_number,
    title: p.title,
    address: [p.address, p.city].filter(Boolean).join(", "),
    status: p.status,
    price: p.price,
    days_online: daysOnline,
    views_total: viewsTotal,
    views_30d: views30,
    views_7d: views7,
    views_per_day: Math.round((viewsTotal / daysOnline) * 10) / 10,
    leads_total: leadsTotal ?? 0,
    images_count: images.length,
    is_promoted: !!p.is_promoted,
    promoted_until: p.promoted_until,
    last_bumped_at: p.bumped_at,
    shared_with_partners: !!p.shared_with_partners,
    link: propertyLink(String(p.id)),
  };
}

/**
 * דוח CMA.
 *
 * ‏`agent_cma_report` ולא `cma_report`: זו אותה פונקציה בדיוק, רק עם מזהה
 * סוכן/ת מפורש במקום `current_agent_id()` — ל-Edge Function אין JWT. מקור
 * האמת אחד, כדי שהמספר בוואטסאפ יהיה המספר שבמסך.
 *
 * החזרת הדוח **המלא** לצ'אט הייתה מציפה: הוא כולל את כל העסקאות ברדיוס ואת
 * עסקאות העיר שאי אפשר למקם. לכן חוזרות רק ההשוואות הקרובות ביותר, והדוח
 * להדפסה נשאר בדשבורד.
 */
async function toolCmaReport(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);

  const { data, error } = await ctx.supabase.rpc("agent_cma_report", {
    p_agent_id: ctx.agent.id,
    p_property_id: propertyId,
  });
  if (error) return { ok: false, error: error.message };

  const report = (data || {}) as Record<string, unknown>;
  if (report.error === "property_not_found") {
    return { ok: false, error: "לא נמצא נכס כזה." };
  }
  if (report.error) {
    return { ok: false, error: String(report.detail || report.error) };
  }

  const subject = (report.subject || {}) as Record<string, unknown>;
  const stats = (report.stats || {}) as Record<string, unknown>;
  const comparables = (report.comparables || []) as Record<string, unknown>[];
  const cityComparables = (report.city_comparables || []) as Record<string, unknown>[];

  const asking = Number(subject.price);
  const avg = Number(stats.avg_price);
  const gapPct = Number.isFinite(asking) && Number.isFinite(avg) && avg > 0
    ? Math.round(((asking - avg) / avg) * 100)
    : undefined;

  ctx.conv.last_property_id = propertyId;

  return {
    ok: true,
    property_id: propertyId,
    subject: {
      title: subject.title,
      address: [subject.address, subject.city].filter(Boolean).join(", "),
      property_type: subject.property_type,
      rooms: subject.rooms,
      size_sqm: subject.size_sqm,
      asking_price: subject.price,
      asking_price_per_sqm: subject.price_per_sqm,
    },
    // הפער הוא השורה שהסוכן/ת מחפש/ת: המחיר המבוקש מול ממוצע העסקאות בסביבה
    gap_vs_market_pct: gapPct,
    stats,
    radius_meters_used: report.radius_meters_used,
    // ‏true = הרדיוס נפתח עד הסוף ועדיין אין מספיק השוואות. התשובה עדיין
    // תקפה, אבל היא נשענת על מדגם קטן וצריך לומר את זה.
    radius_exhausted: report.radius_exhausted,
    comparables: comparables.slice(0, limit),
    comparables_returned: Math.min(comparables.length, limit),
    // עסקאות באותה עיר שאין להן מיקום — לא מעורבבות בממוצע, ולכן רק נספרות
    city_comparables_count: cityComparables.length,
    no_location: !subject.lat && !report.radius_meters_used
      ? "לנכס אין קואורדינטות, ולכן אין השוואות לפי רדיוס. גיאוקוד נעשה על כתובת בעפולה עם רחוב ומספר בית."
      : undefined,
    full_report_where: "הדוח המלא להדפסה או לשליחה ללקוח/ה: כפתור \"דוח CMA\" בכרטיס הנכס בדשבורד.",
  };
}

/**
 * מידע תכנוני ובנייה.
 *
 * הצנזור (גוש, חלקה, שטח חלקה) יושב ב-`agent_property_planning` ולא כאן,
 * מאותה סיבה שהוא יושב ב-SQL ולא בדפדפן: רשימת שדות אסורים שמתוחזקת בשני
 * מקומות מתפצלת בסוף מעצמה. ‏`docs/land-planning.md`.
 */
async function toolPlanningInfo(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");

  const { data, error } = await ctx.supabase.rpc("agent_property_planning", {
    p_agent_id: ctx.agent.id,
    p_property_id: propertyId,
  });
  if (error) return { ok: false, error: error.message };

  const info = (data || {}) as Record<string, unknown>;
  if (info.error === "property_not_found") {
    return { ok: false, error: "לא נמצא נכס כזה." };
  }
  if (info.error) {
    return { ok: false, error: String(info.detail || info.error) };
  }

  ctx.conv.last_property_id = propertyId;

  if (!info.has_data) {
    return {
      ok: true,
      has_data: false,
      property_id: propertyId,
      title: info.title,
      is_land: info.is_land,
      // המידע התכנוני נקלט אוטומטית בשמירת נכס עם רחוב ומספר בית בעפולה.
      // נכס בעיר אחרת, או כזה שנשמר בלי כתובת מלאה, פשוט אין לו מה להציג.
      note: "אין מידע תכנוני שמור על הנכס הזה. הקליטה האוטומטית עובדת על כתובת בעפולה עם רחוב ומספר בית; בדיקה נקודתית לפי גוש/חלקה אפשרית בקטגוריית \"מידע תכנוני\" בדשבורד.",
    };
  }

  return { ok: true, ...info };
}

// ---------------------------------------------------------------------------
// קובץ הלקוחות
//
// ‏RLS על `agent_clients` צרה יותר מזו של `properties` — רק הסוכן/ת עצמו/ה,
// לא מנהל/ת המשרד ולא מנהל/ת הפלטפורמה — כי אלה פרטים שהלקוח/ה מסר/ה לאדם
// ספציפי. ‏service_role עוקף RLS, ולכן **כל כלי כאן מקבע `agent_id` בעצמו**:
// זה מה שמחזיק את אותה הבטחה בערוץ הוואטסאפ.
// ---------------------------------------------------------------------------

/** מוודאת שהלקוח/ה באמת שייך/ת לסוכן/ת לפני כל שינוי או הצלבה. */
async function ownedClient(ctx: ToolContext, clientId: string) {
  const { data } = await ctx.supabase
    .from("agent_clients")
    .select("id, full_name, phone, status, deal_type, category")
    .eq("id", clientId)
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  return data;
}

/** שורת הדרישות בעברית — מה שהסוכן/ת רואה בכרטיס הלקוח/ה בדשבורד. */
function clientNeeds(c: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(c.deal_type === "rent" ? "להשכרה" : "למכירה");
  if (c.category === "commercial") parts.push("מסחרי");
  const types = (c.property_types as string[]) || [];
  if (types.length) parts.push(types.join("/"));
  const cities = (c.cities as string[]) || [];
  if (cities.length) parts.push(cities.join("/"));
  if (c.min_rooms || c.max_rooms) {
    parts.push(`${c.min_rooms ?? ""}${c.min_rooms && c.max_rooms ? "-" : ""}${c.max_rooms ?? ""} חד׳`);
  }
  if (c.min_price || c.max_price) {
    const from = c.min_price ? Number(c.min_price).toLocaleString("he-IL") : "";
    const to = c.max_price ? Number(c.max_price).toLocaleString("he-IL") : "";
    parts.push(from && to ? `₪${from}-${to}` : from ? `מ-₪${from}` : `עד ₪${to}`);
  }
  if (c.min_size_sqm) parts.push(`מ-${c.min_size_sqm} מ״ר`);
  if (c.max_floor !== null && c.max_floor !== undefined) parts.push(`עד קומה ${c.max_floor}`);
  const feats = (c.required_features as string[]) || [];
  if (feats.length) parts.push(`חובה: ${feats.join(", ")}`);
  return parts.join(" · ");
}

async function toolListClients(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 20, 50);

  let query = ctx.supabase
    .from("agent_clients")
    .select(
      "id, full_name, phone, email, notes, status, deal_type, category, " +
      "property_types, cities, min_price, max_price, min_rooms, max_rooms, " +
      "min_size_sqm, max_floor, required_features, created_at",
    )
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false });

  if (input.status) query = query.eq("status", String(input.status));
  else if (!input.all_statuses) query = query.eq("status", "active");

  const q = String(input.query || "").trim();
  if (q) {
    // ‏escape על הפסיק והסוגריים: מחרוזת חיפוש עם פסיק הייתה נקראת כשני
    // תנאים ב-`or` ומחזירה שגיאת פרסור מ-PostgREST.
    const safe = q.replace(/[,()*]/g, " ").trim();
    if (safe) query = query.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  const { data, error } = await query.limit(limit);
  if (error) return { ok: false, error: error.message };

  // ספירת ההתאמות לכל לקוח/ה בקריאה אחת (ולא שאילתה לכל שורה). כשל כאן אינו
  // מפיל את הרשימה — הדרישות והטלפון הם עיקר התשובה, וההתאמות תוספת.
  const counts = new Map<string, { n: number; top: string | null }>();
  const { data: matchRows, error: matchErr } = await ctx.supabase
    .rpc("agent_client_match_counts", { p_agent_id: ctx.agent.id });
  if (matchErr) console.warn("match counts failed", matchErr.message);
  for (const row of (matchRows || []) as Record<string, unknown>[]) {
    const top = row.top_score
      ? `${row.top_score}% — ${[row.top_title, row.top_street, row.top_city].filter(Boolean).join(", ")}`
      : null;
    counts.set(String(row.client_id), { n: Number(row.match_count) || 0, top });
  }

  // ספירה כוללת, נפרדת מה-limit: "כמה לקוחות יש לי" היא שאלה על הקובץ ולא
  // על החלון שהוחזר.
  const { count: totalActive } = await ctx.supabase
    .from("agent_clients")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", ctx.agent.id)
    .eq("status", "active");
  const { count: totalAll } = await ctx.supabase
    .from("agent_clients")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", ctx.agent.id);

  return {
    ok: true,
    total_active: totalActive ?? 0,
    total_all: totalAll ?? 0,
    returned: data.length,
    clients: data.map((c) => ({
      client_id: c.id,
      full_name: c.full_name,
      phone: c.phone,
      email: c.email,
      status: c.status,
      needs: clientNeeds(c),
      notes: c.notes,
      match_count: counts.get(c.id)?.n ?? null,
      top_match: counts.get(c.id)?.top ?? null,
    })),
  };
}

async function toolCreateClient(ctx: ToolContext, input: Record<string, unknown>) {
  const fullName = String(input.full_name || "").trim();
  if (!fullName) return { ok: false, error: "חסר שם הלקוח/ה." };

  const payload = pick(input, CLIENT_WRITABLE_FIELDS);
  payload.full_name = fullName;
  payload.agent_id = ctx.agent.id;
  // ‏agency_id נשמר כדי שהרשומה תדע מאיזה משרד היא נוצרה, בדיוק כמו בטופס
  // בדשבורד. הוא אינו מרחיב את הראייה — ה-RLS היא לפי agent_id בלבד.
  payload.agency_id = ctx.agent.agency_id;

  // כפילות: אותו שם או אותו טלפון אצל אותו/ה סוכן/ת. בוואטסאפ זה קורה יותר
  // מבדשבורד — "תוסיף את משפחת כהן" נאמר בלי לראות את הקובץ — ולקוח/ה כפול/ה
  // פירושו שני כרטיסים עם חצי מהדרישות בכל אחד.
  const phone = String(input.phone || "").replace(/\D/g, "");
  const { data: existing } = await ctx.supabase
    .from("agent_clients")
    .select("id, full_name, phone, status")
    .eq("agent_id", ctx.agent.id)
    .limit(300);
  const dup = (existing || []).find((c) =>
    normText(c.full_name) === normText(fullName) ||
    (!!phone && String(c.phone || "").replace(/\D/g, "").slice(-9) === phone.slice(-9))
  );
  if (dup && !input.force_new) {
    return {
      ok: false,
      duplicate: true,
      client_id: dup.id,
      full_name: dup.full_name,
      phone: dup.phone,
      status: dup.status,
      error:
        "כבר קיים/ת לקוח/ה כזה/כזו בקובץ. לא נוצרה רשומה חדשה — שאל/י את " +
        "הסוכן/ת אם לעדכן את הקיימת (update_client) או שזה/זו אדם אחר/ת.",
    };
  }

  const { data, error } = await ctx.supabase
    .from("agent_clients")
    .insert(payload)
    .select("id, full_name, phone, status, deal_type, category, property_types, " +
            "cities, min_price, max_price, min_rooms, max_rooms, min_size_sqm, " +
            "max_floor, required_features")
    .single();
  if (error) return { ok: false, error: error.message };

  ctx.conv.last_client_id = data.id;
  return {
    ok: true,
    client_id: data.id,
    full_name: data.full_name,
    needs: clientNeeds(data),
  };
}

async function toolUpdateClient(ctx: ToolContext, input: Record<string, unknown>) {
  const clientId = String(input.client_id || "");
  const existing = await ownedClient(ctx, clientId);
  if (!existing) return { ok: false, error: "לא נמצא/ה לקוח/ה כזה/כזו אצל הסוכן/ת." };

  const payload = pick(input, CLIENT_WRITABLE_FIELDS);
  if (!Object.keys(payload).length) return { ok: false, error: "לא נשלח אף שדה לעדכון." };
  payload.updated_at = new Date().toISOString();

  const { data, error } = await ctx.supabase
    .from("agent_clients")
    .update(payload)
    .eq("id", clientId)
    .eq("agent_id", ctx.agent.id)
    .select("id, full_name, status, deal_type, category, property_types, cities, " +
            "min_price, max_price, min_rooms, max_rooms, min_size_sqm, max_floor, " +
            "required_features")
    .single();
  if (error) return { ok: false, error: error.message };

  ctx.conv.last_client_id = clientId;
  return {
    ok: true,
    client_id: clientId,
    full_name: data.full_name,
    updated_fields: Object.keys(payload).filter((k) => k !== "updated_at"),
    needs: clientNeeds(data),
  };
}

async function toolSetClientStatus(ctx: ToolContext, input: Record<string, unknown>) {
  const clientId = String(input.client_id || "");
  const status = String(input.status || "");
  if (!CLIENT_STATUSES.includes(status)) return { ok: false, error: "סטטוס לא חוקי." };

  const existing = await ownedClient(ctx, clientId);
  if (!existing) return { ok: false, error: "לא נמצא/ה לקוח/ה כזה/כזו אצל הסוכן/ת." };

  const { error } = await ctx.supabase
    .from("agent_clients")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("agent_id", ctx.agent.id);
  if (error) return { ok: false, error: error.message };

  ctx.conv.last_client_id = clientId;
  return { ok: true, client_id: clientId, full_name: existing.full_name, status };
}

// ---------------------------------------------------------------------------
// התאמות
//
// שלוש הפונקציות במסד הן מקור האמת לניקוד (‏client_property_match), ולכן
// הציון שיוצא בוואטסאפ זהה לזה שבפאנל בדשבורד. אם יוחלף כאן חישוב מקומי —
// השניים יתפצלו.
// ---------------------------------------------------------------------------
async function toolClientMatches(ctx: ToolContext, input: Record<string, unknown>) {
  const clientId = String(input.client_id || "");
  const client = await ownedClient(ctx, clientId);
  if (!client) return { ok: false, error: "לא נמצא/ה לקוח/ה כזה/כזו אצל הסוכן/ת." };

  const limit = Math.min(Number(input.limit) || 5, 15);
  const { data, error } = await ctx.supabase.rpc("agent_client_matches", {
    p_agent_id: ctx.agent.id,
    p_client_id: clientId,
    p_limit: limit,
  });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    client_id: clientId,
    client_name: client.full_name,
    count: (data || []).length,
    matches: (data || []).map((m: Record<string, unknown>) => ({
      property_id: m.property_id,
      // ‏own / agency / shared — זה מה שקובע אם צריך להרים טלפון לסוכן/ת אחר/ת
      source: m.source,
      score: m.score,
      title: m.title,
      address: [m.street, m.house_number, m.city].filter(Boolean).join(" "),
      price: m.price,
      rooms: m.rooms,
      floor: m.floor,
      size_sqm: m.size_sqm,
      gaps: m.reasons,
      listing_agent: m.listing_agent_name,
      listing_agent_phone: m.listing_agent_phone,
      link: propertyLink(String(m.property_id)),
    })),
  };
}

async function toolPropertyMatches(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const limit = Math.min(Number(input.limit) || 5, 15);

  const { data, error } = await ctx.supabase.rpc("agent_property_client_matches", {
    p_agent_id: ctx.agent.id,
    p_property_id: propertyId,
    p_limit: limit,
  });
  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = propertyId;
  return {
    ok: true,
    property_id: propertyId,
    count: (data || []).length,
    clients: (data || []).map((c: Record<string, unknown>) => ({
      client_id: c.client_id,
      full_name: c.client_name,
      phone: c.client_phone,
      score: c.score,
      gaps: c.reasons,
    })),
  };
}

async function toolListMatchAlerts(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 10, 25);

  // שתי שאילתות ולא embed: ‏client_match_alerts מחזיקה מפתחות זרים גם
  // ל-agent_clients וגם ל-properties, ו-PostgREST מסתבך ב-embed מרובה
  // (‏PGRST201) בדיוק כמו ב-agency_members→agencies ב-index.ts.
  let query = ctx.supabase
    .from("client_match_alerts")
    .select("id, client_id, property_id, source, score, reasons, status, created_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!input.include_seen) query = query.eq("status", "new");

  const { data: alerts, error } = await query;
  if (error) return { ok: false, error: error.message };
  if (!alerts.length) return { ok: true, count: 0, alerts: [] };

  const clientIds = [...new Set(alerts.map((a) => a.client_id))];
  const propertyIds = [...new Set(alerts.map((a) => a.property_id))];

  const [{ data: clients }, { data: properties }] = await Promise.all([
    ctx.supabase.from("agent_clients").select("id, full_name, phone")
      .eq("agent_id", ctx.agent.id).in("id", clientIds),
    ctx.supabase.from("properties")
      .select("id, title, price, rooms, city, street, house_number, status")
      .in("id", propertyIds),
  ]);
  const clientById = new Map<string, Record<string, unknown>>();
  for (const c of clients || []) clientById.set(c.id, c);
  const propertyById = new Map<string, Record<string, unknown>>();
  for (const p of properties || []) propertyById.set(p.id, p);

  return {
    ok: true,
    count: alerts.length,
    // נכס שאינו פעיל יותר נושר, כמו ב-`client_match_alerts_feed`: התראה על
    // נכס שאי אפשר להציע יותר היא רעש.
    alerts: alerts
      .filter((a) => propertyById.get(a.property_id)?.status === "active")
      .map((a) => {
        const c = clientById.get(a.client_id);
        const p = propertyById.get(a.property_id)!;
        return {
          alert_id: a.id,
          status: a.status,
          score: a.score,
          source: a.source,
          client_id: a.client_id,
          client_name: c?.full_name ?? null,
          client_phone: c?.phone ?? null,
          property_id: a.property_id,
          title: p.title,
          address: [p.street, p.house_number, p.city].filter(Boolean).join(" "),
          price: p.price,
          rooms: p.rooms,
          gaps: a.reasons,
          link: propertyLink(String(a.property_id)),
        };
      }),
  };
}

// ---------------------------------------------------------------------------
// הסכמים — קריאה בלבד, וקישור החתימה
// ---------------------------------------------------------------------------
const AGREEMENT_KINDS: Record<string, string> = {
  buy: "הזמנת שירותי תיווך — קניה",
  sell: "הזמנת שירותי תיווך — מכירה",
  tenant: "הזמנת שירותי תיווך — שוכר",
  landlord: "הזמנת שירותי תיווך — משכיר",
  exclusive_sell: "בלעדיות — מכירה",
  exclusive_landlord: "בלעדיות — משכיר",
};

const EXCLUSIVE_KINDS = ["exclusive_sell", "exclusive_landlord"];

/** כמה ימים קדימה נחשבת בלעדיות "נגמרת". חודש וחצי — מספיק כדי לחדש בנחת. */
const EXPIRING_HORIZON_DAYS = 45;

function daysUntil(date: unknown): number | undefined {
  if (!date) return undefined;
  const then = new Date(String(date)).getTime();
  if (!Number.isFinite(then)) return undefined;
  // חצות של היום מול חצות של התאריך: "נגמרת מחר" לא צריכה להיות תלויה בשעה
  // שבה נשאלה השאלה.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((then - today.getTime()) / 86_400_000);
}

async function toolListAgreements(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 10, 25);
  const expiringSoon = !!input.expiring_soon;

  let query = ctx.supabase
    .from("agreements")
    .select("id, kind, status, title, created_at, sent_at, signed_at, exclusive_from, exclusive_until")
    .eq("agent_id", ctx.agent.id)
    .limit(limit);

  if (expiringSoon) {
    // בלעדיות בלבד: להזמנת תיווך רגילה אין תקופה שנגמרת. מיון עולה — מה
    // שנגמר קודם הוא מה שדחוף, וזה ההפך מסדר ברירת המחדל.
    const horizon = new Date(Date.now() + EXPIRING_HORIZON_DAYS * 86_400_000)
      .toISOString().slice(0, 10);
    query = query
      .in("kind", EXCLUSIVE_KINDS)
      .neq("status", "cancelled")
      .not("exclusive_until", "is", null)
      .lte("exclusive_until", horizon)
      .order("exclusive_until", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  if (input.status) query = query.eq("status", String(input.status));
  else if (input.pending_only) query = query.in("status", ["draft", "sent", "viewed"]);
  else if (!expiringSoon) query = query.neq("status", "cancelled");

  const { data: rows, error } = await query;
  if (error) return { ok: false, error: error.message };
  if (!rows.length) return { ok: true, count: 0, agreements: [] };

  const { data: signers } = await ctx.supabase
    .from("agreement_signers")
    .select("agreement_id, full_name, phone, signed_at, ord")
    .in("agreement_id", rows.map((r) => r.id))
    .order("ord");

  const byAgreement = new Map<string, Record<string, unknown>[]>();
  for (const s of signers || []) {
    const list = byAgreement.get(s.agreement_id) || [];
    list.push(s);
    byAgreement.set(s.agreement_id, list);
  }

  return {
    ok: true,
    count: rows.length,
    agreements: rows.map((a) => {
      const list = byAgreement.get(a.id) || [];
      return {
        agreement_id: a.id,
        kind: AGREEMENT_KINDS[a.kind] || a.kind,
        status: a.status,
        title: a.title,
        signed_count: list.filter((s) => s.signed_at).length,
        signer_count: list.length,
        signers: list.map((s) => ({
          full_name: s.full_name,
          signed: !!s.signed_at,
        })),
        exclusive_from: a.exclusive_from,
        exclusive_until: a.exclusive_until,
        exclusive_days_left: daysUntil(a.exclusive_until),
        created_at: a.created_at,
        signed_at: a.signed_at,
      };
    }),
  };
}

/**
 * הסכם אחד, במלואו.
 *
 * ‏`list_agreements` היא רשימה — סוג, סטטוס ומי חתם/ה. השאלות שנשאלות
 * בוואטסאפ הן דווקא על התוכן: "כמה עמלה סיכמנו", "עד מתי הבלעדיות", "על
 * איזה נכס זה". כל אלה שדות על השורה, ובלי הכלי הזה הסוכן/ת היה/הייתה
 * צריך/ה לפתוח את הדשבורד כדי לקרוא מספר אחד.
 *
 * ‏`document_html` **אינו** חוזר: הוא המסמך המשפטי המלא, הוא נעול במסד
 * בטריגר, והוא לא נקרא בהודעת וואטסאפ. מה שמחליף אותו בהסכם חתום הוא
 * ‏`view_token` — אותו קישור קבוע שנשלח לכל הצדדים במייל העותק החתום.
 */
// ---------------------------------------------------------------------------
// הכנת הסכם להחתמה
//
// עד כאן העוזר קרא הסכמים ולא כתב אותם, ובצדק: גוף המסמך נבנה בדפדפן
// ונחסם במסד (`agreements_freeze_body`), וכל ערכה הראייתי של החתימה תלוי
// בזה. מה שנפתח כאן אינו עוקף את הגבול הזה אלא עומד בו — **אותו קוד ואותו
// נוסח** בונים את המסמך (`_shared/agreement-build.ts`, עותק מוגן ב-CI של
// מודולי `assets/`), ההסכם נוצר פעם אחת עם גוף קפוא, ותיקון עדיין נעשה רק
// בדרך שהנייר מכיר: ביטול והוצאת הסכם חדש.
//
// שלוש החלטות:
//
// **1. חסר נתון = לא נוצר הסכם.** `missingForAgreement` היא בדיוק הרשימה
// ש-`agrValidate` מחשבת באשף — ת.ז. לכל חותם/ת, עמלה, ותקופת בלעדיות בטופסי
// בלעדיות. הזמנה בלי אלה אינה "הזמנה בכתב כדין", וטופס חסר שנחתם גרוע
// מטופס שלא נוצר: הוא נראה תקין עד הרגע שבו צריך אותו.
//
// **2. הבוט אינו שולח ללקוח/ה.** הוא מחזיר את הקישור האישי לצ'אט של
// הסוכן/ת — בדיוק כמו `agreement_sign_links`, ומאותה סיבה. הסטטוס נשאר
// `draft` עד שליחה דרך `agreement-sign` בדשבורד, כי זו השליחה שמסמנת
// `sent` ושולחת את המייל.
//
// **3. אותו קישור לשתי הדרכים.** "מרחוק" זה להעביר אותו ללקוח/ה; "פנים מול
// פנים" זה לפתוח אותו על המכשיר של הסוכן/ת ולהושיט. אין כאן שני מנגנונים,
// ולכן אין מה לבחור מראש.
// ---------------------------------------------------------------------------
async function toolPrepareAgreement(ctx: ToolContext, input: Record<string, unknown>) {
  const kind = String(input.kind || "");
  const tpl = templateFor(kind);
  if (!tpl) return { ok: false, error: "סוג הסכם לא מוכר." };

  if (!ctx.agent.agency_id) {
    return { ok: false, error: "לסוכן/ת אין משרד משויך — צריך להשלים הרשמה בדשבורד." };
  }
  if (!SITE_BASE_URL) {
    return { ok: false, error: "כתובת האתר אינה מוגדרת בשרת — אין דרך לבנות קישור חתימה." };
  }

  // ---- הלקוח/ה
  const { data: client } = await ctx.supabase
    .from("agent_clients")
    .select("id, full_name, phone, email, address, id_number")
    .eq("id", String(input.client_id || ""))
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  if (!client) return { ok: false, error: "לא נמצא/ה לקוח/ה כזה/כזו בקובץ של הסוכן/ת." };

  // ת.ז. שהסוכן/ת מסר/ה בצ'אט נשמרת גם בכרטיס — כדי שההסכם הבא לא ייעצר
  // כאן שוב. ‏best-effort, כמו באשף: כשל בשמירה אינו עוצר את ההסכם.
  const clientIdNumber = String(input.client_id_number || client.id_number || "").trim();
  if (clientIdNumber && clientIdNumber !== client.id_number) {
    const { error } = await ctx.supabase
      .from("agent_clients")
      .update({ id_number: clientIdNumber })
      .eq("id", client.id)
      .eq("agent_id", ctx.agent.id);
    if (error) console.warn("client id_number save failed", error.message);
  }

  // ---- כרטיס הסוכן/ת והמשרד — מה שמודפס בראש המסמך
  const { data: member } = await ctx.supabase
    .from("agency_members")
    .select("id, display_name, id_number, license_number, phone, agency_id, agencies(name, address)")
    .eq("id", ctx.agent.id)
    .maybeSingle();
  if (!member) return { ok: false, error: "לא נמצאו פרטי הסוכן/ת." };
  // ‏supabase-js מחזיר יחס many-to-one כאובייקט, אבל ה-typing שלו מרשה גם
  // מערך. שתי הצורות מטופלות כאן כדי שההסכם לא ייצא בלי שם המשרד.
  const agencyRaw = member.agencies as unknown;
  const agency = (Array.isArray(agencyRaw) ? agencyRaw[0] : agencyRaw) as
    Record<string, unknown> | null;

  // ---- הנכסים
  const requested = (input.property_ids as string[] | undefined) || [];
  if (!requested.length) return { ok: false, error: "לא נבחרו נכסים להסכם." };

  const { data: rows } = await ctx.supabase
    .from("properties")
    // כל ה-src שמופיעים ב-PROPERTY_FIELDS_* — שדה שלא נשלף פשוט יוצא במסמך
    // כקו למילוי ידני, וזה לא מה שרוצים כשהערך קיים במודעה.
    .select("id, agent_id, status, title, property_type, street, house_number, city, " +
            "sales_area, rooms, floor, total_floors, price, built_size_sqm, " +
            "garden_sqm, move_in_date, condition, features, deal_type")
    .in("id", requested);

  const visible = ((rows || []) as unknown as Record<string, unknown>[])
    .filter((r) => r.agent_id === ctx.agent.id || r.status === "active");
  if (!visible.length) return { ok: false, error: "לא נמצא אף אחד מהנכסים שביקשת." };

  // גוש וחלקה נכנסים למסמך, והם קיימים רק על נכס של הסוכן/ת עצמו/ה.
  const ownIds = visible.filter((r) => r.agent_id === ctx.agent.id).map((r) => String(r.id));
  const planningByProperty = new Map<string, Record<string, unknown>>();
  if (ownIds.length) {
    const { data: planning } = await ctx.supabase
      .from("property_planning_info")
      .select("property_id, gush, helka")
      .in("property_id", ownIds);
    for (const row of (planning || []) as unknown as Record<string, unknown>[]) {
      planningByProperty.set(String(row.property_id), row);
    }
  }

  // סדר הבקשה נשמר: "קודם זה ואז זה" הוא סדר ההצעות במסמך של קונה/שוכר.
  let chosen: AgreementProperty[] = requested
    .map((id) => visible.find((r) => String(r.id) === id))
    .filter(Boolean)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        property_id: String(row.id),
        label: propertyLabel(row),
        row,
        planning: planningByProperty.get(String(row.id)) || null,
      };
    });

  let dropped: string[] = [];
  if (tpl.propertyMode === "single" && chosen.length > 1) {
    dropped = chosen.slice(1).map((p) => p.label);
    chosen = chosen.slice(0, 1);
  }

  // ---- החותמים: הלקוח/ה, ואחריו/ה כל מי שהסוכן/ת הוסיף/ה
  const signers: AgreementSigner[] = [{
    party: "client",
    full_name: String(client.full_name || "").trim(),
    id_number: clientIdNumber,
    phone: client.phone,
    email: client.email,
    address: client.address,
    client_id: String(client.id),
  }];
  for (const extra of (input.extra_signers as Record<string, unknown>[] | undefined) || []) {
    signers.push({
      party: "partner",
      full_name: String(extra.full_name || "").trim(),
      id_number: String(extra.id_number || "").trim(),
      phone: String(extra.phone || "").trim() || null,
      email: String(extra.email || "").trim() || null,
      address: null,
      client_id: null,
    });
  }

  // ---- תקופת הבלעדיות
  const exclusiveFrom = isoDateOrNull(input.exclusive_from);
  let exclusiveUntil = isoDateOrNull(input.exclusive_until);
  const months = Number(input.exclusive_months) || 0;
  if (!exclusiveUntil && months > 0 && exclusiveFrom) {
    exclusiveUntil = addMonthsIso(exclusiveFrom, months);
  }
  if (tpl.exclusive && exclusiveFrom && exclusiveUntil && exclusiveUntil <= exclusiveFrom) {
    return { ok: false, error: "תאריך סיום הבלעדיות אינו אחרי תאריך ההתחלה." };
  }

  const build = {
    kind,
    agentId: ctx.agent.id,
    agencyId: ctx.agent.agency_id,
    agent: {
      name: member.display_name,
      id_number: member.id_number,
      license_number: member.license_number,
      phone: member.phone,
      agency_name: (agency?.name as string) || null,
      agency_address: (agency?.address as string) || null,
    },
    signers,
    properties: chosen,
    commission: {
      pct: finiteOrNull(input.commission_pct),
      amount: finiteOrNull(input.commission_amount),
      basis: (input.commission_basis as string) || (tpl.dealType === "rent" ? null : "price"),
    },
    exclusive: { from: exclusiveFrom, until: exclusiveUntil },
    notes: (input.notes as string) || null,
  };

  const missing = missingForAgreement(build);
  if (missing.length) {
    return {
      ok: false,
      missing,
      // ההסכם לא נוצר בכוונה. טופס חסר שנחתם נראה תקין עד הרגע שבו צריך
      // אותו, ואז כבר אי אפשר לתקן אותו למפרע.
      note: "ההסכם לא נוצר. בקש/י מהסוכן/ת את מה שחסר וקרא/י שוב ל-prepare_agreement.",
    };
  }

  // ---- יצירה. ‏verify_code נוצר במסד ומודפס בתחתית המסמך, ולכן ה-HTML
  // נבנה אחרי ה-insert ורק אז נשמר — בדיוק כמו באשף.
  const { data: created, error: insertError } = await ctx.supabase
    .from("agreements")
    .insert(insertPayload(build))
    .select("id, verify_code, created_at, title, require_otp")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  const html = documentHtml(build, String(created.verify_code || ""), String(created.created_at));
  const { error: htmlError } = await ctx.supabase
    .from("agreements")
    .update({ document_html: html })
    .eq("id", created.id)
    .eq("agent_id", ctx.agent.id);
  if (htmlError) return { ok: false, error: htmlError.message };

  const { error: signersError } = await ctx.supabase
    .from("agreement_signers")
    .insert(signerRows(String(created.id), signers));
  if (signersError) return { ok: false, error: signersError.message };

  const { data: saved } = await ctx.supabase
    .from("agreement_signers")
    .select("full_name, phone, sign_token, token_expires_at, ord")
    .eq("agreement_id", created.id)
    .order("ord");

  const links = ((saved || []) as unknown as Record<string, unknown>[]).map((sg) => {
    const url = `${SITE_BASE_URL}/sign.html?t=${sg.sign_token}`;
    const wa = waNumber(sg.phone);
    return {
      full_name: sg.full_name,
      phone: sg.phone,
      sign_url: url,
      expires_at: sg.token_expires_at,
      wa_send_url: wa
        ? `https://wa.me/${wa}?text=${encodeURIComponent(
          `היי ${String(sg.full_name || "").trim()},\n${created.title}\nלחתימה מקוונת:\n${url}`,
        )}`
        : undefined,
    };
  });

  return {
    ok: true,
    agreement_id: created.id,
    kind: AGREEMENT_KINDS[kind] || kind,
    title: created.title,
    status: "draft",
    verify_code: created.verify_code,
    client_name: client.full_name,
    properties: chosen.map((p) => p.label),
    // נכס שנשר כי הטופס הזה הוא חד-נכסי. עדיף לומר את זה מאשר שיתגלה
    // אחרי שהלקוח/ה חתם/ה.
    dropped_properties: dropped.length ? dropped : undefined,
    signers: links,
    // אותו קישור לשתי הדרכים — אין כאן שני מנגנונים.
    how_to_sign: "אותו קישור משמש לשתי הדרכים: מרחוק — להעביר אותו לחותם/ת; פנים מול פנים — לפתוח אותו על המכשיר שלך ולהושיט לחתימה.",
    requires_otp: !!created.require_otp,
    otp_note: created.require_otp
      ? "בטופס הזה החתימה מרחוק דורשת קוד אימות שנשלח למייל של החותם/ת. בחתימה פנים מול פנים זה לא רלוונטי."
      : undefined,
    // ‏OTP בלי מייל = קישור שנפתח ונתקע. עדיף לומר את זה עכשיו.
    otp_missing_email: created.require_otp
      ? signers.filter((sg) => !(sg.email || "").trim()).map((sg) => sg.full_name)
      : undefined,
    frozen_note: "גוף המסמך ננעל ואי אפשר לערוך אותו. לתיקון — ביטול ההסכם והוצאת חדש, באשף שבדשבורד.",
    manage_where: `${SITE_BASE_URL}/crm.html`,
  };
}

async function toolAgreementDetails(ctx: ToolContext, input: Record<string, unknown>) {
  const agreementId = String(input.agreement_id || "");

  const { data: a, error } = await ctx.supabase
    .from("agreements")
    .select("id, kind, status, title, commission_pct, commission_amount, " +
            "commission_note, exclusive_from, exclusive_until, marketing_actions, " +
            "notes, property_ids, client_ids, view_token, verify_code, " +
            "require_otp, created_at, sent_at, viewed_at, signed_at, cancelled_at")
    .eq("id", agreementId)
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!a) return { ok: false, error: "לא נמצא הסכם כזה אצל הסוכן/ת." };

  const { data: signers } = await ctx.supabase
    .from("agreement_signers")
    .select("full_name, party, phone, email, signed_at, viewed_at, ord")
    .eq("agreement_id", agreementId)
    .order("ord");

  const propertyIds = (a.property_ids as unknown as string[] | null) || [];
  const clientIds = (a.client_ids as unknown as string[] | null) || [];

  // הנכסים והלקוחות מסוננים גם ב-agent_id ולא רק ב-id: `service_role` עוקף
  // ‏RLS, ורשימת מזהים על שורת ההסכם אינה אישור גישה בפני עצמה.
  let properties: Record<string, unknown>[] = [];
  if (propertyIds.length) {
    const { data } = await ctx.supabase
      .from("properties")
      .select("id, title, address, city, price, listing_number, status")
      .in("id", propertyIds)
      .eq("agent_id", ctx.agent.id);
    properties = (data || []) as unknown as Record<string, unknown>[];
  }

  let clients: Record<string, unknown>[] = [];
  if (clientIds.length) {
    const { data } = await ctx.supabase
      .from("agent_clients")
      .select("id, full_name, phone")
      .in("id", clientIds)
      .eq("agent_id", ctx.agent.id);
    clients = (data || []) as unknown as Record<string, unknown>[];
  }

  const daysLeft = daysUntil(a.exclusive_until);
  const isExclusive = EXCLUSIVE_KINDS.includes(String(a.kind));
  const list = signers || [];

  return {
    ok: true,
    agreement_id: a.id,
    kind: AGREEMENT_KINDS[a.kind] || a.kind,
    status: a.status,
    title: a.title,
    commission: {
      pct: a.commission_pct,
      amount: a.commission_amount,
      note: a.commission_note,
    },
    exclusivity: isExclusive
      ? {
        from: a.exclusive_from,
        until: a.exclusive_until,
        days_left: daysLeft,
        expired: daysLeft !== undefined && daysLeft < 0,
        marketing_actions: a.marketing_actions,
      }
      : undefined,
    properties: properties.map((p) => ({
      title: p.title,
      address: [p.address, p.city].filter(Boolean).join(", "),
      listing_number: p.listing_number,
      status: p.status,
      price: p.price,
      link: propertyLink(String(p.id)),
    })),
    clients: clients.map((c) => ({ full_name: c.full_name, phone: c.phone })),
    signers: list.map((sg) => ({
      full_name: sg.full_name,
      party: sg.party,
      phone: sg.phone,
      viewed_at: sg.viewed_at,
      signed_at: sg.signed_at,
      signed: !!sg.signed_at,
    })),
    signed_count: list.filter((sg) => sg.signed_at).length,
    signer_count: list.length,
    notes: a.notes,
    created_at: a.created_at,
    sent_at: a.sent_at,
    signed_at: a.signed_at,
    cancelled_at: a.cancelled_at,
    // רק אחרי חתימה מלאה. לפני כן אין "עותק חתום" להראות, והקישור מציג
    // מסמך שאיש עוד לא חתם עליו.
    signed_copy_url: a.status === "signed" && a.view_token
      ? agreementLink(String(a.view_token))
      : undefined,
    verify_code: a.status === "signed" ? a.verify_code : undefined,
  };
}

async function toolAgreementSignLinks(ctx: ToolContext, input: Record<string, unknown>) {
  const agreementId = String(input.agreement_id || "");

  const { data: agreement } = await ctx.supabase
    .from("agreements")
    .select("id, kind, status, title")
    .eq("id", agreementId)
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  if (!agreement) return { ok: false, error: "לא נמצא הסכם כזה אצל הסוכן/ת." };
  if (agreement.status === "cancelled") {
    return { ok: false, error: "ההסכם בוטל — אין קישורי חתימה." };
  }
  if (agreement.status === "signed") {
    return { ok: false, error: "ההסכם כבר נחתם על ידי כל הצדדים." };
  }

  const { data: signers, error } = await ctx.supabase
    .from("agreement_signers")
    .select("id, full_name, phone, sign_token, token_expires_at, signed_at, ord")
    .eq("agreement_id", agreementId)
    .order("ord");
  if (error) return { ok: false, error: error.message };

  const pending = (signers || []).filter((s) => !s.signed_at);
  if (!pending.length) {
    return { ok: false, error: "כל החותמים בהסכם הזה כבר חתמו." };
  }
  if (!SITE_BASE_URL) {
    return { ok: false, error: "כתובת האתר אינה מוגדרת בשרת — אין דרך לבנות קישור." };
  }

  return {
    ok: true,
    agreement_id: agreementId,
    title: agreement.title,
    kind: AGREEMENT_KINDS[agreement.kind] || agreement.kind,
    signers: pending.map((s) => ({
      full_name: s.full_name,
      phone: s.phone,
      // האסימון אישי לכל חותם/ת (48 תווים), ולא אחד להסכם — בני זוג לא
      // תמיד יושבים באותו חדר. לכן הקישור נמסר עם שם החותם/ת לידו.
      sign_url: `${SITE_BASE_URL}/sign.html?t=${s.sign_token}`,
      expires_at: s.token_expires_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// לידים והתראות
// ---------------------------------------------------------------------------
async function toolListLeads(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 10, 25);

  // ‏leads_masked ולא leads: ה-view מחליף שם, טלפון והודעה בגרסה מוסתרת כל
  // עוד הליד לא נפתח. ‏service_role עוקף RLS אבל **לא** את ה-view, ולכן זו
  // הדרך היחידה כאן שבה ליד סגור לא מדליף פרטים לצ'אט.
  let query = ctx.supabase
    .from("leads_masked")
    .select("id, lead_type, deal_type, status, display_name, display_phone, " +
            "display_message, city, property_type, property_id, created_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (input.status) query = query.eq("status", String(input.status));

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const { count: masked } = await ctx.supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", ctx.agent.id)
    .eq("status", "masked");

  return {
    ok: true,
    returned: (data || []).length,
    waiting_to_unlock: masked ?? 0,
    unlock_where: SITE_BASE_URL ? `${SITE_BASE_URL}/crm.html?goto=accLeads` : null,
    leads: (data || []).map((l) => ({
      lead_id: l.id,
      lead_type: l.lead_type,
      status: l.status,
      name: l.display_name,
      phone: l.display_phone,
      message: l.display_message,
      city: l.city,
      property_type: l.property_type,
      created_at: l.created_at,
    })),
  };
}

async function toolListNotifications(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 10, 25);

  let query = ctx.supabase
    .from("notifications")
    .select("id, type, title, body, read, created_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!input.include_read) query = query.eq("read", false);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const { count: unread } = await ctx.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", ctx.agent.id)
    .eq("read", false);

  // ההתראות אינן מסומנות כנקראו מכאן, בכוונה: הפעמון בדשבורד הוא מסך
  // הקריאה, וסימון מהצ'אט היה מרוקן אותו בלי שהסוכן/ת ראה/תה את הפרטים.
  return {
    ok: true,
    unread_total: unread ?? 0,
    returned: (data || []).length,
    notifications: (data || []).map((n) => ({
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      created_at: n.created_at,
    })),
  };
}

async function toolWhatsappAlerts(ctx: ToolContext, input: Record<string, unknown>) {
  const action = String(input.action || "get");
  const asked = (Array.isArray(input.types) ? input.types : [])
    .map((t) => String(t))
    .filter((t) => NOTIFY_TYPES.includes(t));

  const { data: prefs } = await ctx.supabase
    .from("agent_notification_preferences")
    .select("whatsapp_types, muted_types")
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  const current: string[] = prefs?.whatsapp_types || [];

  if (action === "get") {
    return { ok: true, enabled_types: current, all_types: NOTIFY_TYPES };
  }

  if ((action === "enable" || action === "set") && !asked.length) {
    return {
      ok: false,
      error: "לא צוין אף סוג התראה מוכר. בקש/י מהסוכן/ת לומר על מה לקבל התראה בוואטסאפ.",
      all_types: NOTIFY_TYPES,
    };
  }

  let next: string[];
  if (action === "enable") next = [...new Set([...current, ...asked])];
  else if (action === "set") next = [...new Set(asked)];
  // ‏disable בלי types הוא "תפסיק לשלוח לי בוואטסאפ" — כיבוי הערוץ כולו.
  else next = asked.length ? current.filter((t) => !asked.includes(t)) : [];

  // ‏upsert ולא update: לרוב הסוכנים אין שורת העדפות בכלל (היעדר שורה =
  // קבלת כל ההתראות בפעמון), וההדלקה הראשונה היא זו שיוצרת אותה.
  // ‏muted_types נשמר כפי שהוא — הפעמון בדשבורד אינו מושפע מהערוץ.
  const { error } = await ctx.supabase
    .from("agent_notification_preferences")
    .upsert({
      agent_id: ctx.agent.id,
      whatsapp_types: next,
      muted_types: prefs?.muted_types || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: "agent_id" });
  if (error) return { ok: false, error: error.message };

  // סוג שהסוכן/ת השתיק/ה בפעמון לא ייווצר מלכתחילה (הטריגר
  // ‏notifications_apply_preferences מחזיר null), ולכן גם לא יישלח בוואטסאפ.
  // זו התנגשות שכדאי לומר עליה מיד ולא להשאיר כשקט.
  const muted = (prefs?.muted_types || []).filter((t: string) => next.includes(t));

  return {
    ok: true,
    enabled_types: next,
    channel_off: next.length === 0,
    muted_conflict: muted.length ? muted : undefined,
    note: muted.length
      ? "הסוגים האלה מושתקים בפעמון, ולכן לא ייווצרו ולא יישלחו — צריך להפעיל אותם קודם ב'ניהול התראות' בדשבורד."
      : undefined,
  };
}

async function runTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      // נכסים
      case "create_property": return await toolCreateProperty(ctx, input);
      case "update_property": return await toolUpdateProperty(ctx, input);
      case "set_property_status": return await toolSetStatus(ctx, input);
      case "list_properties": return await toolListProperties(ctx, input);
      case "attach_images": return await toolAttachImages(ctx, input);
      case "property_stats": return await toolPropertyStats(ctx);
      case "property_link": return await toolPropertyLink(ctx, input);
      case "property_performance": return await toolPropertyPerformance(ctx, input);
      case "cma_report": return await toolCmaReport(ctx, input);
      case "planning_info": return await toolPlanningInfo(ctx, input);
      // לקוחות
      case "list_clients": return await toolListClients(ctx, input);
      case "create_client": return await toolCreateClient(ctx, input);
      case "update_client": return await toolUpdateClient(ctx, input);
      case "set_client_status": return await toolSetClientStatus(ctx, input);
      // התאמות
      case "client_matches": return await toolClientMatches(ctx, input);
      case "property_matches": return await toolPropertyMatches(ctx, input);
      case "list_match_alerts": return await toolListMatchAlerts(ctx, input);
      // הסכמים
      case "list_agreements": return await toolListAgreements(ctx, input);
      case "agreement_sign_links": return await toolAgreementSignLinks(ctx, input);
      case "agreement_details": return await toolAgreementDetails(ctx, input);
      case "prepare_agreement": return await toolPrepareAgreement(ctx, input);
      // לידים והתראות
      case "list_leads": return await toolListLeads(ctx, input);
      case "list_notifications": return await toolListNotifications(ctx, input);
      case "whatsapp_alerts": return await toolWhatsappAlerts(ctx, input);
      default: return { ok: false, error: `כלי לא מוכר: ${name}` };
    }
  } catch (err) {
    console.error(`tool ${name} threw`, err);
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

// ---------------------------------------------------------------------------
// לולאת השיחה
// ---------------------------------------------------------------------------
function systemPrompt(agent: AgentRow, conv: ConversationState): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "את/ה העוזר/ת של שוק נדל\"ן — מערכת ניהול נכסים לסוכני נדל\"ן בעפולה.",
    "את/ה מדבר/ת עם הסוכן/ת בוואטסאפ ומבצע/ת עבורו/ה פעולות במערכת דרך הכלים.",
    "",
    `הסוכן/ת: ${agent.display_name || "ללא שם"}${agent.agencies?.name ? ` · משרד ${agent.agencies.name}` : ""}.`,
    `תאריך היום: ${today}.`,
    "",
    "מה יש לך: נכסים, קובץ הלקוחות, ההתאמות בין השניים, ניתוח שוק ומידע תכנוני, " +
      "ההסכמים, הלידים וההתראות.",
    "",
    "כללים כלליים:",
    "- ענה/י בעברית, קצר, בסגנון וואטסאפ. אימוג'י אחד לכל היותר.",
    "- מחירים בעברית מדוברת: \"1.8 מליון\" = 1800000, \"5,500 שקל\" = 5500. שכירות היא מחיר חודשי.",
    "- אל תשאל/י שאלות מיותרות, ואל תמציא/י פרטים שלא נאמרו. מה שלא ידוע נשאר ריק.",
    "- אל תציג/י UUID לסוכן/ת. התייחס/י לנכסים לפי כתובת או כותרת, וללקוחות לפי שם.",
    "- אחרי פעולה מוצלחת אשר/י אותה במשפט אחד עם מה שנוצר/השתנה. אם התקבל link, צרף/י אותו.",
    "- **לשאלת \"כמה\" תמיד קרא/י לכלי שמחזיר ספירה** (property_stats, list_clients) ואל " +
      "תספור/תספרי מתוך רשימה שהוחזרה — רשימה היא חלון, לא הקובץ.",
    "",
    "נכסים:",
    "- השדות ההכרחיים ליצירת נכס הם סוג נכס, סוג עסקה ומחיר בלבד — אם יש אותם, צור/צרי את הנכס והשלם/י את השאר ממה שנאמר.",
    "- אם חסר אחד מהשלושה, בקש/י בשאלה אחת קצרה רק את מה שחסר.",
    "- לפני שינוי או ארכוב של נכס קיים — ודא/י שאת/ה יודע/ת על איזה נכס מדובר. אם לא, קרא/י ל-list_properties.",
    "- \"תמחק את הנכס\" = set_property_status עם archived. אין מחיקה אמיתית.",
    "- אם create_property החזיר duplicate: אל תיצור/י מודעה נוספת. אמור/אמרי לסוכן/ת " +
      "מה קיים (כתובת, מספר מודעה וסטטוס) ושאל/י בשאלה אחת: להחזיר ולעדכן את הקיימת, " +
      "או לפרסם מודעה נוספת? להחזרה: update_property עם ה-property_id והפרטים החדשים, " +
      "ואז set_property_status עם active. למודעה נוספת: create_property שוב עם force_new.",
    "- אחרי שנוצר נכס חדש — קרא/י ל-property_matches עליו. אם יש לקוח/ה מתאים/ה בקובץ, " +
      "זו השורה החשובה בתשובה: \"מתאים ל<שם> (92%), 052-…\".",
    "",
    "קישור לנכס ושליחה:",
    "- \"תשלח לי את הקישור לנכס\" / \"תכין הודעה על הדירה\" = property_link. הצג/י את " +
      "ה-message כמו שהוא (זה הטקסט שיועבר), ומתחתיו את wa_share_url — לחיצה אחת פותחת " +
      "וואטסאפ עם ההודעה מוכנה.",
    "- כשהסוכן/ת אומר/ת למי ההודעה (\"תשלח את זה לרונית\") — מצא/י את הלקוח/ה עם " +
      "list_clients, והעבר/י client_id ל-property_link. אז חוזר wa_client_url ישר לצ'אט " +
      "שלו/ה. אם חזר client_phone_missing — אמור/אמרי שאין טלפון בקובץ והצג/י את " +
      "wa_share_url במקום.",
    "- **הבוט אינו שולח ללקוח/ה.** ההודעה יוצאת מהמספר של הסוכן/ת בלחיצה שלו/ה, " +
      "בדיוק כמו קישור החתימה. אל תבטיח/י ששלחת.",
    "- אם חזר warning — אמור/אמרי אותו. קישור לנכס שאינו active לא נפתח אצל הלקוח/ה.",
    "",
    "ניתוח נכס:",
    "- \"כמה שווה\" / \"מה נמכר באזור\" / \"המחיר ריאלי?\" = cma_report. השורה החשובה " +
      "היא gap_vs_market_pct — הפער בין המחיר המבוקש לממוצע. אם radius_exhausted הוא " +
      "true, אמור/אמרי שהמדגם קטן לפני שאת/ה מסיק/ה ממנו.",
    "- \"מה מותר לבנות\" / \"מה הייעוד\" / \"יש תוכנית על המגרש\" = planning_info. " +
      "סיים/י תמיד במשפט ה-disclaimer שחוזר מהכלי — זה מידע כללי ולא בדיקה מול הוועדה.",
    "- \"כמה צפיות\" / \"למה אין פניות\" = property_performance. אם יש מעט צפיות והנכס " +
      "בלי תמונות או בלי קידום — זו התשובה, ואמור/אמרי אותה.",
    "",
    "לקוחות והתאמות:",
    "- למצוא לקוח/ה לפי שם: list_clients עם query. הדרישות והתקציב חוזרים בשדה needs.",
    "- ליצירת לקוח/ה די בשם. שדה ריק פירושו \"לא משנה\" ולא \"חסר\" — אל תבקש/י תקציב או ערים שלא נאמרו.",
    "- \"תמחק את הלקוח/ה\" = set_client_status עם closed. הרשומה נשארת בקובץ.",
    "- אם create_client החזיר duplicate — אל תיצור/י רשומה שנייה. אמור/אמרי מה קיים ושאל/י אם לעדכן.",
    "- \"מה יש ל<שם>\" = client_matches. \"למי מתאים הנכס הזה\" = property_matches. " +
      "\"מה חדש בהתאמות\" = list_match_alerts.",
    "- בהתאמה שאינה שלך (source agency או shared) הוסף/י את שם הסוכן/ת המפרסם/ת והטלפון — בלעדיהם אין מה לעשות עם ההתאמה.",
    "",
    "הסכמים:",
    "- אפשר **ליצור** הסכם מכאן (prepare_agreement, למטה), אבל **אי אפשר לתקן או " +
      "לבטל** — גוף המסמך ננעל במסד ברגע היצירה. תיקון = ביטול והוצאת הסכם חדש, " +
      "באשף \"החתם לקוח\" בדשבורד.",
    "- agreement_sign_links מחזיר קישור אישי לכל חותם/ת שטרם חתם/ה. הצג/י אותו עם השם " +
      "שלידו, ואמור/אמרי במשפט אחד שהקישור אישי ואין להעביר אותו הלאה — הסוכן/ת הוא/היא " +
      "שמעביר/ה אותו לחותם/ת עצמו/ה.",
    "- \"כמה עמלה סיכמנו\" / \"מתי נגמרת הבלעדיות\" / \"על איזה נכס ההסכם\" = " +
      "agreement_details. למצוא את המזהה: list_agreements, ומשם ההסכם שהכותרת שלו " +
      "מתאימה.",
    "- \"איזו בלעדיות נגמרת לי\" = list_agreements עם expiring_soon. " +
      "‏exclusive_days_left שלילי = כבר נגמרה.",
    "- \"תשלח לי את ההסכם החתום\" = agreement_details → signed_copy_url. הוא קיים רק " +
      "אחרי שכל הצדדים חתמו, וזה אותו קישור שנשלח לכולם במייל.",
    "",
    "הכנת הסכם להחתמה (prepare_agreement):",
    "- \"תכין הזמנת תיווך לרונית על הדירה בעלייה 20\" = list_clients למצוא אותה, " +
      "list_properties למצוא את הנכס, ואז prepare_agreement.",
    "- בחירת הטופס לפי מי חותם/ת: בעל/ת נכס שמוכר/ת = sell · בעל/ת נכס שמשכיר/ה = " +
      "landlord · קונה = buy · שוכר/ת = tenant · בלעדיות = exclusive_sell או " +
      "exclusive_landlord. אם לא ברור מי הצד — שאל/י בשאלה אחת.",
    "- **אם חזר missing — ההסכם לא נוצר.** בקש/י בהודעה אחת את כל מה שברשימה " +
      "(בדרך כלל ת.ז. של הלקוח/ה ואחוז העמלה), ואז קרא/י שוב. אל תמציא/י ת.ז. " +
      "ואל תנחש/י עמלה.",
    "- אחרי היצירה: הצג/י את sign_url של כל חותם/ת עם השם שלידו, ואמור/אמרי את " +
      "how_to_sign — אותו קישור משמש גם לחתימה מרחוק וגם לפגישה פנים מול פנים. " +
      "אם יש wa_send_url, זו הדרך המהירה להעביר.",
    "- אמור/אמרי גם את frozen_note: גוף המסמך ננעל, ותיקון נעשה בביטול והוצאת " +
      "הסכם חדש בדשבורד. אם requires_otp — אמור/אמרי את otp_note.",
    "- **הבוט אינו שולח ללקוח/ה**, כאן כמו בכל קישור אחר. הסוכן/ת מעביר/ה.",
    "",
    "לידים והתראות:",
    "- שם וטלפון של ליד שטרם נפתח מגיעים מוסתרים. זה מכוון — אל תתנצל/י ואל תנסה/י " +
      "לעקוף. אמור/אמרי שהפתיחה נעשית בדשבורד וצרף/י את unlock_where.",
    "- \"מה חדש\" / \"מה פספסתי\" = list_notifications.",
    "- בקשה לקבל התראות בוואטסאפ (\"תעדכן אותי על לידים חדשים כאן\") = whatsapp_alerts " +
      "עם enable והסוגים המתאימים. \"תפסיק\" = disable בלי types. אם חזר muted_conflict — " +
      "אמור/אמרי את ה-note כמו שהוא.",
  ];

  if (conv.pending_images.length) {
    lines.push(
      "",
      `יש כרגע ${conv.pending_images.length} תמונות שהתקבלו בשיחה וטרם שויכו לנכס. ` +
        "יצירת נכס חדש תצרף אותן אוטומטית; לצירוף לנכס קיים יש להשתמש ב-attach_images.",
    );
  }
  if (conv.last_property_id) {
    lines.push(
      "",
      `הנכס האחרון שנגעת בו בשיחה הזו: ${conv.last_property_id}. ` +
        "אם הסוכן/ת אומר/ת \"תוסיף לזה\" או \"תעדכן את זה\" — זה הנכס שמדובר בו.",
    );
  }
  if (conv.last_client_id) {
    lines.push(
      "",
      `הלקוח/ה האחרון/ה שנגעת בו/בה בשיחה הזו: ${conv.last_client_id}. ` +
        "אם הסוכן/ת אומר/ת \"תעדכן לו את התקציב\" בלי לומר שם — זה/זו מי שמדובר בו/בה.",
    );
  }

  return lines.join("\n");
}

/**
 * קריאה ל-Claude. ‏fallbacks מפעיל ניתוב אוטומטי למודל חלופי אם בקשה נדחית
 * על ידי מסנני הבטיחות, כדי שסוכן/ת לא תיתקע בלי תשובה. אם ה-beta לא זמין
 * לחשבון — נופלים לקריאה רגילה במקום להפיל את כל הזרימה.
 *
 * מיוצאת כי `public-agent.ts` צריכה בדיוק את אותה התנהגות. זה הדבר היחיד
 * שהבוט הציבורי לוקח מכאן — הכלים, ההוראות ורשימת ההרשאות שלו נפרדים לגמרי.
 */
export async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    // deno-lint-ignore no-explicit-any
    return await (anthropic.beta.messages.create as any)({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    console.warn("beta fallbacks unavailable, retrying without", err);
    return await anthropic.messages.create(params);
  }
}

/**
 * מריץ תור אחד של שיחה: קלט הסוכן/ת -> (כלים) -> טקסט תשובה.
 * ‏conv מתעדכן במקום (pending_images / last_property_id) ונשמר על ידי הקורא.
 */
export async function runAgentTurn(opts: {
  supabase: SupabaseClient;
  agent: AgentRow;
  conv: ConversationState;
  userContent: Anthropic.ContentBlockParam[];
  /** תיאור טקסטואלי של התור לשמירה בהיסטוריה (בלי בלוקי תמונה, שלא לנפח אותה) */
  userSummary: string;
}): Promise<string> {
  const { supabase, agent, conv, userContent, userSummary } = opts;
  const ctx: ToolContext = { supabase, agent, conv };

  const messages: Anthropic.MessageParam[] = [
    ...conv.history,
    { role: "user", content: userContent },
  ];

  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 4096,
      // ‏medium ולא low. ‏low הספיק כשהמשימה הייתה חילוץ פרטי נכס מול חמישה
      // כלים; עם שמונה-עשר כלים ושני מאגרים שצריך להצליב ביניהם, הבחירה בין
      // ‏client_matches ל-property_matches ו"קודם למצוא את המזהה" הן החלטות
      // שבהן low טועה. אם הלטנטיות בצ'אט נעשית מורגשת — לחזור ל-low ולהצר
      // את רשימת הכלים, לא לוותר על הדיוק.
      output_config: { effort: "medium" },
      system: systemPrompt(agent, conv),
      tools: TOOLS,
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) finalText = text;

    if ((response.stop_reason as string) === "refusal") {
      finalText = "מצטער, לא הצלחתי לטפל בבקשה הזו. אפשר לנסח אותה אחרת?";
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
    finalText = "לא הצלחתי להשלים את הפעולה. אפשר לנסות שוב או לפנות לדשבורד.";
  }

  // ההיסטוריה נשמרת כטקסט בלבד — בלי בלוקי הכלים ובלי התמונות. זה מספיק
  // כדי לפתור התייחסויות ("תוסיף לזה מרפסת"), ומונע היסטוריה שגדלה בלי גבול
  // ומצבים לא חוקיים של tool_result יתום אחרי גזימה.
  conv.history = [
    ...conv.history,
    { role: "user", content: userSummary },
    { role: "assistant", content: finalText },
  ].slice(-HISTORY_LIMIT);

  return finalText;
}
