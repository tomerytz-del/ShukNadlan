import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { geocodeAfula } from "./geocode.ts";

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

async function toolListAgreements(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 10, 25);

  let query = ctx.supabase
    .from("agreements")
    .select("id, kind, status, title, created_at, sent_at, signed_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) query = query.eq("status", String(input.status));
  else if (input.pending_only) query = query.in("status", ["draft", "sent", "viewed"]);
  else query = query.neq("status", "cancelled");

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
        created_at: a.created_at,
        signed_at: a.signed_at,
      };
    }),
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
    "מה יש לך: נכסים, קובץ הלקוחות, ההתאמות בין השניים, ההסכמים, הלידים וההתראות.",
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
    "- אין דרך ליצור, לתקן או לבטל הסכם מכאן — גוף המסמך ננעל במסד אחרי היצירה. " +
      "הפניה לאשף: \"החתם לקוח\" בדשבורד.",
    "- agreement_sign_links מחזיר קישור אישי לכל חותם/ת שטרם חתם/ה. הצג/י אותו עם השם " +
      "שלידו, ואמור/אמרי במשפט אחד שהקישור אישי ואין להעביר אותו הלאה — הסוכן/ת הוא/היא " +
      "שמעביר/ה אותו לחותם/ת עצמו/ה.",
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
 */
async function callClaude(
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
