import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { geocodeAfula, geocodeInCity } from "./geocode.ts";
import { lookupPlanning, planningLookupKey } from "../_shared/afula-planning.ts";
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
import { loadAgency } from "../_shared/agency-lookup.ts";

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
// ומאז נוספו שתי יכולות שהיו קיימות בדשבורד בלבד, ושתיהן **מפעילות את אותו
// מנוע** ולא עותק שלו: **שת"פ** (הפצת נכס למשרדים וביטולה, דרך
// ‏`share_property_for_agent`) ו**הפקת סרטון שיווקי** מהתמונות של הנכס (דרך
// ‏`property-video-create`, אותה נקודת קצה שהדשבורד קורא לה).
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
// **והפקת סרטון היא הגבול הזה בגרסה שלישית — היא כן כאן, עם בלם.** היא
// הפעולה היחידה מכאן שמורידה כסף מהארנק, ולכן היא נשברה לשני כלים: אחד
// שמחזיר מחיר ויתרה בלי לגעת בכלום, ואחד שמפיק ודורש `confirm` מפורש. מה
// שמבדיל אותה מ-`claim_lead` הוא מי הנשוא: שם אלה פרטיו של אדם שלישי
// שנקנים בכסף, וכאן זה שירות שהסוכן/ת מזמין/ה לעצמו/ה על נכס שלו/ה.
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

// המודל כסוד ולא כקבוע בקוד, כמו ב-`property-description` וב-
// ‏`property-marketing-publish` (שתיהן על Sonnet). ברירת המחדל נשארת Opus:
// שינוי מודל הוא החלטת איכות, והיא לא אמורה לקרות בשקט בפריסה.
//
// **מטמון הוא לפי מודל.** החלפה מאפסת אותו, והקריאות הראשונות אחריה ישלמו
// מחיר מלא עד שיתחמם מחדש — זה נראה כמו רגרסיה בעלות ואינו כזה.
const MODEL = Deno.env.get("WHATSAPP_BOT_MODEL") || "claude-opus-5";
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
export const RESIDENTIAL_PTYPES = [
  "דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "מרתף/פרטר", "טריפלקס",
  "יחידת דיור", "סטודיו/לופט", "בית פרטי/קוטג'", "דו משפחתי",
  "משק חקלאי/נחלה", "משק עזר", "מגרש", "בניין מגורים", "מחסן", "חניה",
  "קב' רכישה/זכות לנכס",
];
export const COMMERCIAL_PTYPES = [
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
      "כותרת המודעה. אם הסוכן/ת לא נתן/נה כותרת - אל תשאל/י, תשאיר/י ריק ותיווצר כותרת אוטומטית.",
  },
  description: { type: "string", description: "תיאור חופשי של הנכס." },
  rooms: { type: "number", description: "מספר חדרים (אפשר 3.5)." },
  city: { type: "string", description: "עיר. ברירת מחדל: העיר של המשרד של הסוכן/ת." },
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
  notes: { type: "string", description: "הערות חופשיות - מה שנאמר ואין לו שדה." },
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
      "יוצר כפילות אלא מחזיר duplicate - ראו את הכלל בהוראות.",
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
      "משנה את סטטוס הנכס. archived = הסרה מהאתר (זו הדרך למחוק נכס - אין מחיקה " +
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
      "מחזיר את הנכסים של הסוכן/ת, החדשים קודם. זה הכלי למצוא את מזהה הנכס " +
      "שהסוכן/ת מתאר/ת במילים ('הדירה באבן גבירול'). **כשיודעים מה מחפשים - " +
      "להעביר query במקום למשוך את כל הרשימה**: החיפוש רץ על כל הנכסים של " +
      "הסוכן/ת ולא רק על מה שנכנס לחלון. מחזיר תמיד גם `total` (כמה יש " +
      "באמת) ו-`truncated`.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "חיפוש חופשי בכותרת, ברחוב, בכתובת ובעיר - או מספר מודעה. " +
            "'אבן גבירול', 'פנטהאוז', 'עפולה', '10423'.",
        },
        status: {
          type: "string",
          enum: STATUSES,
          description: "סינון לפי סטטוס. ברירת מחדל: כל הסטטוסים.",
        },
        limit: { type: "integer", description: "כמה להחזיר. ברירת מחדל 20, מקסימום 200." },
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
      "**זה הכלי לכל שאלת 'כמה'** - ‏list_properties מחזיר חלון, וספירת שורות " +
      "מתוכו היא ניחוש. הפילוחים כאן קיימים רק כאן.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "property_link",
    description:
      "מחזיר את הקישור לדף הנכס באתר ולצדו הודעת וואטסאפ מוכנה להעברה - " +
      "כותרת, כתובת, חדרים, שטח, מחיר וקישור. זה הכלי ל\"תשלח לי את הקישור " +
      "לדירה בעלייה 20\" ול\"תכין לי הודעה על הנכס\". עם client_id מקובץ " +
      "הלקוחות ההודעה נפתחת בפנייה בשם, וחוזר גם קישור ישיר לצ'אט של אותו/ה " +
      "לקוח/ה - **הסוכן/ת לוחץ/ת ושולח/ת מהמספר שלו/ה**, הבוט אינו שולח " +
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
      "דוח השוואת שוק (CMA) לנכס **למכירה**: עסקאות שנסגרו בסביבה, ממוצע, " +
      "חציון, טווח, מחיר למ\"ר, והפער בין המחיר המבוקש לממוצע השוק. זה הכלי " +
      "ל\"כמה שווה הנכס\", \"מה נמכר באזור\" ו\"האם המחיר ריאלי\". " +
      "המאגר הוא עסקאות מכר בלבד, ולכן הכלי מסרב על נכס להשכרה. " +
      "הממוצע מחושב על עסקאות מאותו סוג נכס **ומאותו מספר חדרים**; אם לא " +
      "נמצאו די כאלה חוזר comparability_guidance שאומר מה לומר. " +
      "**כשאין די עסקאות להשוואה הכלי אינו מחזיר ממוצע כלל** - במקרה כזה יש " +
      "לומר לסוכן/ת שאין נתונים ולא לאמוד מספר לבד. מחזיר תקציר ואת " +
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
    name: "market_deals_lookup",
    description:
      "עסקאות שנסגרו בפועל בסביבת כתובת, ממאגר רשות המיסים. זה הכלי ל\"מה " +
      "נמכר בהרצל 20 בחצי השנה האחרונה\", ל\"תן לי 5 עסקאות אחרונות ברחוב " +
      "הזה\" ול\"כמה שילמו על דירת 4 חדרים באזור\". בניגוד ל-cma_report הוא " +
      "**אינו** דורש שהנכס יהיה במערכת, ולכן הוא מתאים גם לפני לקיחת נכס. " +
      "מחזיר עסקאות בודדות עם כתובת, גוש, חלקה, סוג, חדרים, קומה, מ\"ר, " +
      "מחיר, מחיר למ\"ר, תאריך ומרחק. " +
      "**זמין במסלול Elite בלבד**; במסלול אחר הכלי מחזיר tier_required, ואז " +
      "יש לומר לסוכן/ת שהיכולת שייכת ל-Elite ולא להמציא נתונים. " +
      "אלה עסקאות מכר בלבד, ולא שכירות. " +
      "**בלי רחוב** (\"איזה עסקאות היו בנוף הגליל\") הכלי מחזיר את העסקאות " +
      "האחרונות בעיר כולה - אל תנחש/י רחוב בשביל זה.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "העיר. ברירת מחדל: העיר של הסוכן/ת." },
        street: { type: "string", description: "שם רחוב, בלי מספר בית." },
        house_number: { type: "string", description: "מספר בית. משפר את המיקום." },
        radius_m: {
          type: "integer",
          description: "רדיוס במטרים סביב הכתובת. ברירת מחדל 300, מקסימום 5000.",
        },
        months: {
          type: "integer",
          description: "כמה חודשים אחורה. ברירת מחדל 24, מקסימום 120.",
        },
        limit: { type: "integer", description: "כמה עסקאות להחזיר. ברירת מחדל 5, מקסימום 50." },
        property_type: {
          type: "string",
          description: "סינון לסוג נכס כפי שהוא במאגר: דירה, בנין או קרקע.",
        },
      },
      required: [],
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
  {
    name: "planning_lookup",
    description:
      "מידע תכנוני על **כתובת או גוש/חלקה** - בלי שיהיה נכס במערכת. זה הכלי " +
      "ל\"מה הגוש והחלקה של הרצל 20\", ל\"מה הייעוד בגוש 16742 חלקה 96\" ול\"אילו " +
      "תוכניות חלות על הכתובת\". מחזיר גוש, חלקה, שטח החלקה הרשום, סטטוס רישום, " +
      "ייעוד קרקע, והתוכניות החלות (מספר, תיאור, תאריך). " +
      "תן/י **או** street + house_number **או** gush + helka. " +
      "המקור הוא שכבות ה-GIS של עיריית עפולה, ולכן כתובת מחוץ לעפולה אינה " +
      "נתמכת עדיין - הכלי מחזיר city_not_supported עם קישור לחיפוש ב-GovMap. " +
      "לנכס שכבר במערכת עדיף planning_info, שמחבר גם את מה שהסוכן/ת הזין/ה.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "העיר. ברירת מחדל: העיר של המשרד." },
        street: { type: "string", description: "שם רחוב, בלי מספר בית." },
        house_number: { type: "string", description: "מספר בית." },
        gush: { type: "string", description: "מספר גוש, ספרות בלבד." },
        helka: { type: "string", description: "מספר חלקה, ספרות בלבד." },
      },
      required: [],
    },
  },

  // -------------------------------------------------------------------------
  // שיתוף פעולה בין משרדים (שת"פ)
  //
  // אותן שתי פעולות שבשורת הנכס בדשבורד, ואותו מנוע במסד — ראו
  // ‏`share_property_for_agent` במיגרציה 20261119090000.
  // -------------------------------------------------------------------------
  {
    name: "share_property",
    description:
      "פותח נכס לשת\"פ: מפיץ אותו לכל משרדי התיווך שברשימת השת\"פ של הסוכן/ת, " +
      "ושולח לחברי המשרדים שקיבלו אותו עכשיו התראה. **הכלי מסנכרן ולא רק מוסיף** " +
      "- משרד שהוסר מהרשימה מאז ההפצה הקודמת מאבד את הגישה - ולכן זה גם הכלי " +
      "ל\"תעדכן את ההפצה\". הפעלה חוזרת אינה יוצרת כפילות ואינה מתריעה שוב למי " +
      "שכבר קיבל. עובד על נכס פעיל בלבד.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },
  {
    name: "unshare_property",
    description:
      "מוריד נכס משת\"פ: מסיר אותו מכל המשרדים שקיבלו אותו ומכבה את סימון " +
      "השיתוף. הנכס עצמו נשאר פעיל באתר - זו הסרה מהשת\"פ ולא הסרה מהמכירה.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },
  {
    name: "property_share_status",
    description:
      "מצב השת\"פ של נכס: האם הוא מופץ, לכמה משרדים ולאילו, וכמה משרדים היו " +
      "מקבלים אותו אילו היה מסונכרן עכשיו (targets_now). זה הכלי ל\"עם מי " +
      "שיתפתי את הדירה הזו\" ולבדיקה אחרי הפצה.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },

  // -------------------------------------------------------------------------
  // סרטון שיווקי מהתמונות של הנכס
  //
  // שני כלים ולא אחד, והחלוקה היא בדיוק בין מה שעולה כסף למה שלא:
  // ‏`property_video_info` קורא, ‏`create_property_video` מחייב.
  // -------------------------------------------------------------------------
  {
    name: "property_video_info",
    description:
      "כמה תעלה הפקת סרטון שיווקי לנכס ומה מצב ההפקה האחרונה שלו - **בלי " +
      "לפתוח בקשה ובלי לחייב**. מחזיר את המסלול, המחיר (0 כשההפקה כלולה " +
      "במסלול), כמה נשאר במכסה החודשית, יתרת הארנק, כמה תמונות יש לנכס, האם " +
      "כבר יש סרטון, ואם יש בקשה פתוחה - ההתקדמות שלה. **זה הכלי הראשון בכל " +
      "שיחה על סרטון**, גם ל\"מה קורה עם הסרטון\".",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },
  {
    name: "create_property_video",
    description:
      "מפיק סרטון שיווקי מהתמונות של הנכס: כל תמונה הופכת לקליפ קצר בתנועת " +
      "מצלמה, הקליפים מחוברים לרצף של עד 20 שניות, והסרטון מוצמד לנכס. " +
      "ההפקה לוקחת כמה דקות ורצה ברקע - הסוכן/ת מקבל/ת התראה כשהיא נגמרת. " +
      "**במסלול PROFESSIONAL הכסף יורד מהארנק ברגע שהבקשה נפתחת**, ולכן " +
      "‏confirm הוא חובה ומותר להעביר אותו רק אחרי שהמחיר נאמר לסוכן/ת " +
      "והוא/היא אישר/ה במפורש. במסלול Elite ההפקה כלולה אבל צורכת מהמכסה " +
      "החודשית, ולכן גם שם מאשרים לפני.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        confirm: {
          type: "boolean",
          description:
            "חובה true. אישור מפורש של הסוכן/ת אחרי שנאמר לו/ה המחיר או שההפקה " +
            "כלולה במסלול. אין להסיק אישור מ\"תעשה לי סרטון\" - זו הבקשה, לא האישור.",
        },
        replace_existing: {
          type: "boolean",
          description:
            "אישור נפרד להחליף סרטון שכבר קיים על הנכס. הסרטון הקיים עלול להיות " +
            "סיור שהסוכן/ת צילם/ה בעצמו/ה, ולכן הוא אינו נדרס בלי שנשאל/ה.",
        },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16"],
          description: "יחס התמונה. ברירת מחדל 16:9. ‏9:16 = אנכי לסטורי/רילס.",
        },
      },
      required: ["property_id", "confirm"],
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
          description:
            "חיפוש חופשי בשם או בטלפון. **כשיודעים את מי מחפשים - להעביר " +
            "query במקום למשוך את כל הקובץ**: החיפוש רץ על כל הלקוחות ולא " +
            "רק על מה שנכנס לחלון, וההערות חוזרות מלאות ברשימה קצרה.",
        },
        limit: { type: "integer", description: "כמה להחזיר. ברירת מחדל 20, מקסימום 200." },
      },
      required: [],
    },
  },
  {
    name: "create_client",
    description:
      "מוסיף לקוח/ה לקובץ הלקוחות של הסוכן/ת. **שדה ריק פירושו 'לא משנה'** " +
      "ואינו מסנן כלום - לקוח/ה עם שם וטלפון בלבד הוא רשומה תקפה שמקבלת " +
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
      "‏closed = סגר/ה עסקה או אינו/ה מחפש/ת עוד. \"תמחק את הלקוח/ה\" = closed - " +
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
      "התראות ההתאמה שנפתחו מעצמן - נכס חדש (או נכס שהמחיר שלו ירד) שהתאים " +
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
      "ההסכם. **אין דרך ליצור או לתקן הסכם מכאן** - זה נעשה באשף בדשבורד.",
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
      "אישי לכל חותם/ת ואין להעביר אותו הלאה - יש להעתיק אותו לצ'אט של " +
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
      "אם חסר משהו שנדרש כדי שההזמנה תהיה בכתב כדין - הכלי **אינו יוצר** " +
      "אלא מחזיר missing עם רשימת החסרים, ואז יש לבקש אותם מהסוכן/ת ולקרוא " +
      "שוב. גוף המסמך ננעל ברגע היצירה ואי אפשר לתקן אותו - לתיקון מבטלים " +
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
          description: "מזהה הלקוח/ה מקובץ הלקוחות - זה/זו החותם/ת הראשי/ת.",
        },
        client_id_number: {
          type: "string",
          description:
            "ת.ז. או ח״פ של הלקוח/ה. חובה להזמנה בכתב. אם חסר בכרטיס - " +
            "מבקשים מהסוכן/ת, והערך נשמר גם בכרטיס הלקוח/ה.",
        },
        property_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "הנכסים שההסכם חל עליהם. בטופסי בעל/ת נכס ובלעדיות - נכס אחד.",
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
            "חותמים נוספים - בן/בת זוג או בעלים שותף/ה. כל אחד/ת מקבל/ת " +
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
      "(‏א***, ‏05-****1) - זה מכוון ולא תקלה. פתיחת ליד עולה מכסה או כסף " +
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
      "ההתראות שממתינות בפעמון של הסוכן/ת - לידים, התאמות, ביקורות, הסכמים " +
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
      "ולא רק בפעמון שבדשבורד. ברירת המחדל היא שאף סוג אינו נשלח בוואטסאפ - " +
      "ערוץ יוצא נדלק רק בבקשה מפורשת.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "enable", "disable", "set"],
          description:
            "‏get = מה מוגדר כרגע · enable = הוספת סוגים · disable = הסרת " +
            "סוגים (בלי types - כיבוי הערוץ כולו) · set = החלפת הרשימה כולה.",
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

// קריאה לנקודת קצה אחרת של הפרויקט. ‏`create_property_video` הוא הכלי היחיד
// שעושה את זה — ההפקה חיה ב-`property-video-create` ולא כאן, כדי שהחיוב
// והזכאות יישארו בעותק אחד. ‏service_role הוא גם מה שמעביר את ה-Gateway
// (‏verify_jwt = true שם) וגם מה ש-`authorizeInternalCaller` מזהה.
const FUNCTIONS_BASE =
  `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "")}/functions/v1`;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function propertyLink(id: string): string | undefined {
  return SITE_BASE_URL ? `${SITE_BASE_URL}/property?id=${id}` : undefined;
}

/** הקישור הקבוע לעותק החתום — אותו אחד שנשלח לכל הצדדים במייל אחרי החתימה. */
function agreementLink(viewToken: string): string | undefined {
  return SITE_BASE_URL ? `${SITE_BASE_URL}/agreement?t=${viewToken}` : undefined;
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

/* העיר שנכס חדש נוצר בה כשהסוכן/ת לא אמר/ה: העיר של המשרד (agencies.city_id).
   עד השווקים זו הייתה "עפולה" קבועה, ומשרד בחיפה שהכתיב "דירת 4 חדרים בהרצל"
   היה מקבל נכס בעפולה. שתי שאילתות ולא embed, וכל כשל נופל לעפולה - בדיוק
   ההתנהגות שהייתה. docs/regional-pages.md */
async function agencyDefaultCity(ctx: ToolContext): Promise<string> {
  try {
    const { data: agency } = await ctx.supabase
      .from("agencies").select("city_id").eq("id", ctx.agent.agency_id).maybeSingle();
    if (!agency?.city_id) return "עפולה";
    const { data: city } = await ctx.supabase
      .from("cities").select("name").eq("id", agency.city_id).maybeSingle();
    return String(city?.name || "").trim() || "עפולה";
  } catch {
    return "עפולה";
  }
}

/* פין לנכס בכל עיר שיש לה ספק גאוקוד פעיל. עפולה נשארת על הקבועים שבקוד
   (geocodeAfula) ולא על השורה במסד, כדי שתקלת מסד לא תוריד לה את הפין -
   שם זה עבד כך מתמיד. שתי הפונקציות לעולם אינן זורקות. */
function geocodeForProperty(ctx: ToolContext, city: string, street: string, houseNumber: string) {
  return city === "עפולה"
    ? geocodeAfula(street, houseNumber)
    : geocodeInCity(ctx.supabase, city, street, houseNumber);
}

async function toolCreateProperty(ctx: ToolContext, input: Record<string, unknown>) {
  if (!ctx.agent.agency_id) {
    return { ok: false, error: "לסוכן/ת אין משרד משויך - צריך להשלים הרשמה בדשבורד." };
  }

  const payload = pickWritable(input);
  payload.category ??= "residential";
  payload.city ??= await agencyDefaultCity(ctx);
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
  if (payload.city && street && houseNumber) {
    const coords = await geocodeForProperty(ctx, String(payload.city), street, houseNumber);
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
          "כבר קיימת מודעה לאותה כתובת אצל הסוכן/ת. לא נוצרה מודעה חדשה - " +
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
    if (city && street && houseNumber) {
      const coords = await geocodeForProperty(ctx, city, street, houseNumber);
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

/**
 * הנכסים של הסוכן/ת — חיפוש, ולא רק חלון.
 *
 * ## למה הייתה כאן תקרה של 50, ולמה היא לא הייתה הבעיה האמיתית
 *
 * הכלי נועד למצוא מזהה נכס מתוך תיאור במילים ("הדירה באבן גבירול"), אבל
 * **לא היה לו שדה חיפוש** — הוא החזיר את ה-N החדשים ביותר, והמודל היה
 * אמור לסרוק אותם בעצמו. עם תקרה של 50 זה נשבר בדיוק במקום הכי גרוע:
 * לסוכן/ת עם 57 נכסים, הנכס שלא נכנס לחלון פשוט "לא קיים" מבחינת הבוט,
 * והוא היה מודיע שהוא רואה עד 50.
 *
 * `query` הוא התיקון האמיתי, כי הוא רץ **במסד על כל הנכסים** ולא על החלון:
 * עם חיפוש, 20 שורות מספיקות למצוא כל נכס בקובץ של 500. התקרה עלתה
 * ל-200 בשביל המקרה השני — "תראה לי את כל הנכסים שלי" — ולא בשביל החיפוש.
 *
 * ## ולמה לא להסיר את התקרה לגמרי
 *
 * לא בגלל המסד. **תוצאת הכלי נכנסת ל-`messages` ונשלחת מחדש בכל סבב של
 * לולאת הכלים** (עד 8), ואין כאן prompt caching. שורה שוקלת ~260 תווים,
 * כלומר 200 שורות הן ~26K טוקנים שעלולים להישלח שוב ושוב באותו תור.
 * וזה עוד לפני העניין המעניין יותר: רשימה ארוכה של שורות כמעט זהות
 * **מורידה** את הדיוק של בחירת הנכס הנכון, לא מעלה אותו.
 *
 * ## `total` הוא מה שמונע את הניחוש
 *
 * קודם הוחזר `count: data.length` בלבד — כלומר גודל החלון, בלי שום דרך
 * לדעת שזה חלון. מכאן חוזרת גם ספירה אמיתית (`head: true`, בלי להעביר
 * שורות) ו-`truncated`, בדיוק כמו ב-`list_clients`.
 */
const LIST_PROPERTIES_MAX = 200;

async function toolListProperties(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), LIST_PROPERTIES_MAX);
  const status = input.status ? String(input.status) : null;

  let query = ctx.supabase
    .from("properties")
    .select("id, listing_number, title, address, city, price, rooms, deal_type, status, created_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  // ספירה על אותם תנאים בדיוק פרט ל-limit. ‏head: true מחזיר מספר בלי שורות.
  let counter = ctx.supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", ctx.agent.id);

  if (status) {
    query = query.eq("status", status);
    counter = counter.eq("status", status);
  }

  const q = String(input.query || "").trim();
  if (q) {
    // ‏escape על הפסיק והסוגריים, כמו ב-list_clients: מחרוזת חיפוש עם פסיק
    // הייתה נקראת כשני תנאים ב-`or` ומחזירה שגיאת פרסור מ-PostgREST.
    const safe = q.replace(/[,()*]/g, " ").trim();
    if (safe) {
      const terms = [
        `title.ilike.%${safe}%`,
        `street.ilike.%${safe}%`,
        `address.ilike.%${safe}%`,
        `city.ilike.%${safe}%`,
      ];
      // ‏listing_number הוא bigint, ולכן ilike עליו הוא שגיאת טיפוס ולא
      // "אפס תוצאות". הוא נכנס לתנאי רק כשהחיפוש הוא מספר שלם — וזה גם
      // המקרה היחיד שבו הוא מעניין ("תמצא לי את 10423").
      if (/^\d+$/.test(safe)) terms.push(`listing_number.eq.${safe}`);
      const or = terms.join(",");
      query = query.or(or);
      counter = counter.or(or);
    }
  }

  const [{ data, error }, { count, error: countErr }] = await Promise.all([query, counter]);
  if (error) return { ok: false, error: error.message };
  if (countErr) console.warn("property count failed", countErr.message);

  const total = typeof count === "number" ? count : data.length;
  return {
    ok: true,
    returned: data.length,
    // כמה **באמת** יש בתנאים האלה, ולא כמה הוחזרו. בלי זה המודל מדווח את
    // גודל החלון כאילו הוא הקובץ.
    total,
    truncated: total > data.length,
    query: q || undefined,
    properties: data,
    note: total > data.length
      ? `מוצגים ${data.length} מתוך ${total}. לצמצום - query, ולספירות - property_stats.`
      : undefined,
  };
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
// שת"פ
//
// שלושת הכלים האלה אינם מחזיקים שום לוגיקה: הם מעבירים ל-RPC ומתרגמים קוד
// שגיאה לעברית. זה מכוון — הסנכרון מול רשימת ההסרות, ההתראות למשרדים
// שקיבלו את הנכס עכשיו, והדגל על שורת הנכס יושבים כולם ב-
// ‏`share_property_for_agent`, שהוא בדיוק המנוע שהדשבורד מפעיל. שכפול של
// חלק כלשהו מזה כאן היה מייצר שת"פ שמתנהג אחרת מוואטסאפ מאשר מהדשבורד.
// ---------------------------------------------------------------------------

/**
 * קודי הסירוב שחוזרים מפונקציות המסד של הנכס, בעברית.
 *
 * הקודים עצמם הם אלה שה-RPC מחזירה — לא תרגום שלהם — כדי ששינוי בצד המסד
 * ייראה כאן כקוד לא מוכר ולא כהודעה שקטה ושגויה.
 */
const PROPERTY_RPC_ERRORS: Record<string, string> = {
  agent_not_found: "לא נמצא כרטיס סוכן/ת פעיל.",
  agent_without_agency: "אין שיוך למשרד, ולכן אין למי להפיץ. השיוך נעשה בדשבורד.",
  property_not_found: "לא נמצא נכס כזה.",
  not_your_property: "הנכס הזה אינו של הסוכן/ת.",
  property_not_active: "אפשר להפיץ לשת\"פ רק נכס פעיל. נכס שנמכר, הושכר או בארכיון אינו מופץ.",
};

function rpcError(code: unknown) {
  const key = String(code || "");
  return { ok: false, error: PROPERTY_RPC_ERRORS[key] || `הפעולה נדחתה (${key}).`, code: key };
}

async function toolShareProperty(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const { data, error } = await ctx.supabase.rpc("share_property_for_agent", {
    p_agent_id: ctx.agent.id,
    p_property_id: propertyId,
  });
  if (error) return { ok: false, error: error.message };

  // deno-lint-ignore no-explicit-any
  const res = (data || {}) as Record<string, any>;
  if (res.error) return rpcError(res.error);

  ctx.conv.last_property_id = propertyId;

  // ‏shared_count = 0 אחרי הפצה מוצלחת אינו כישלון אלא הגדרה: הסוכן/ת הסיר/ה
  // את כל המשרדים מרשימת השת"פ (או שאין עדיין משרד נוסף בפלטפורמה). בלי
  // המשפט הזה הבוט היה מודיע "שותף!" על נכס שאיש לא קיבל.
  const count = Number(res.shared_count || 0);
  return {
    ok: true,
    property_id: propertyId,
    title: res.title,
    shared_count: count,
    newly_shared: res.newly_shared,
    revoked: res.revoked,
    note: count === 0
      ? "אף משרד לא קיבל את הנכס - רשימת השת\"פ ריקה. הרשימה נערכת בדשבורד תחת \"משרדי שיתוף פעולה\"."
      : undefined,
  };
}

async function toolUnshareProperty(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const { data, error } = await ctx.supabase.rpc("unshare_property_for_agent", {
    p_agent_id: ctx.agent.id,
    p_property_id: propertyId,
  });
  if (error) return { ok: false, error: error.message };

  // deno-lint-ignore no-explicit-any
  const res = (data || {}) as Record<string, any>;
  if (res.error) return rpcError(res.error);

  ctx.conv.last_property_id = propertyId;
  return {
    ok: true,
    property_id: propertyId,
    title: res.title,
    removed: res.removed,
    note: "הנכס עצמו נשאר פעיל באתר.",
  };
}

async function toolPropertyShareStatus(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const { data, error } = await ctx.supabase.rpc("agent_property_share_status", {
    p_agent_id: ctx.agent.id,
    p_property_id: propertyId,
  });
  if (error) return { ok: false, error: error.message };

  // deno-lint-ignore no-explicit-any
  const res = (data || {}) as Record<string, any>;
  if (res.error) return rpcError(res.error);

  ctx.conv.last_property_id = propertyId;
  return { ok: true, ...res };
}

// ---------------------------------------------------------------------------
// סרטון שיווקי
//
// ההפקה עצמה נשארת ב-`property-video-create` — אותה נקודת קצה שהדשבורד קורא
// לה — והבוט קורא לה עם `service_role` ו-agent_id מפורש. ראו ההסבר בראש
// אותה פונקציה: הזכאות, התקרה החודשית, החיוב, בחירת הסצנות וההחזר בכישלון
// חיים שם, ועותק שני שלהם כאן היה מתפצל.
//
// **הכלי שקורא והכלי שמחייב הם שני כלים.** בדשבורד הכפתור פשוט לא מוצג למי
// שאינו זכאי/ת, והמחיר כתוב בעמוד המחירים; בצ'אט אין כפתור להסתיר ואין מסך
// אישור, ו-₪25 יורדים מהארנק ברגע שהבקשה נפתחת. לכן `confirm` הוא פרמטר
// מפורש ולא ברירת מחדל — אותו כלל בדיוק שנשמר ב-`consent_agent_contact`
// בבוט הציבורי.
// ---------------------------------------------------------------------------

/**
 * קודי החסימה של הסרטון, בעברית.
 *
 * אותה מפה משרתת את שני הכלים בכוונה: הקודים ש-`agent_property_video_quote`
 * מחזירה ב-`blocker` הם **אותם קודים** ש-`property-video-create` מחזירה
 * בסירוב. אם הם היו מתוארים בשתי מפות, אותו מצב היה נשמע אחרת לפני ההפקה
 * ואחריה — וזה בדיוק המקרה שבו סוכן/ת חושב/ת שמשהו השתנה.
 */
const VIDEO_BLOCKERS: Record<string, string> = {
  not_eligible:
    "הפקת סרטון זמינה במסלולים PROFESSIONAL ו-Elite, על נכס פעיל של הסוכן/ת. " +
    "לפרטים ולשדרוג: " + (SITE_BASE_URL ? `${SITE_BASE_URL}/pricing` : "עמוד המחירים"),
  job_in_progress: "כבר רצה הפקה על הנכס הזה. אפשר לשאול מה מצבה.",
  no_images: "אין תמונות לנכס הזה - אי אפשר להפיק ממנו סרטון.",
  not_enough_images: "אין מספיק תמונות לנכס להפקת סרטון.",
  monthly_cap_reached: "המכסה החודשית של הפקות הסרטון נוצלה.",
  insufficient_balance: "אין מספיק יתרה בארנק. טעינה נעשית בדשבורד.",
  video_exists: "כבר יש סרטון על הנכס. החלפה דורשת אישור מפורש (replace_existing).",
  // שלושת אלה אינם באשמת הסוכן/ת ואין מה לעשות איתם בשיחה — אבל "הפעולה
  // נדחתה (fal_submit_failed)" הוא בדיוק סוג ההודעה שגורמת לאנשים לנסות שוב
  // חמש פעמים.
  fal_not_configured: "שירות הווידאו אינו זמין כרגע. לא נגבה תשלום.",
  fal_submit_failed: "שירות הווידאו לא קיבל את הבקשה. לא נגבה תשלום - אפשר לנסות שוב בהמשך.",
  no_matching_agent_profile: "לא נמצא כרטיס סוכן/ת פעיל.",
};

async function toolPropertyVideoInfo(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");

  // שתי קריאות ולא אחת: ההצעה ומצב ההפקה עונות על שתי שאלות שונות במסד,
  // והבוט שואל אותן יחד כי בצ'אט זו שאלה אחת ("מה עם סרטון לנכס הזה").
  const [quoteRes, statusRes] = await Promise.all([
    ctx.supabase.rpc("agent_property_video_quote", {
      p_agent_id: ctx.agent.id,
      p_property_id: propertyId,
    }),
    ctx.supabase.rpc("agent_property_video_status", {
      p_agent_id: ctx.agent.id,
      p_property_id: propertyId,
    }),
  ]);

  if (quoteRes.error) return { ok: false, error: quoteRes.error.message };
  // deno-lint-ignore no-explicit-any
  const quote = (quoteRes.data || {}) as Record<string, any>;
  if (quote.error) return rpcError(quote.error);

  // כשל בשליפת המצב אינו מפיל את ההצעה: המחיר והזכאות הם מה שנשאל, ומצב
  // הפקה שאולי אינה קיימת הוא תוספת.
  if (statusRes.error) console.warn("video status lookup failed", statusRes.error.message);
  // deno-lint-ignore no-explicit-any
  const status = (statusRes.data || {}) as Record<string, any>;

  ctx.conv.last_property_id = propertyId;

  const blocker = String(quote.blocker || "");
  return {
    ok: true,
    ...quote,
    blocker_text: blocker ? VIDEO_BLOCKERS[blocker] ?? blocker : undefined,
    // ‏price_text מנוסח כאן ולא במודל: "כלול במסלול" מול "₪25 מהארנק" הוא
    // בדיוק המשפט שצריך להיאמר לפני החיוב, ואין טעם להשאיר אותו לניסוח חופשי.
    price_text: quote.eligible
      ? (quote.included
        ? `כלול במסלול Elite (נשארו ${quote.monthly_left} הפקות החודש)`
        : `₪${Number(quote.price || 0)} מיתרת הארנק (יתרה: ₪${Number(quote.credit_balance || 0)})`)
      : undefined,
    last_job: status.has_job ? status : undefined,
  };
}

async function toolCreatePropertyVideo(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");

  // האישור נבדק כאן ולא רק בהוראות: הוראה היא בקשה מהמודל, וזו פעולה
  // שמורידה כסף. מודל שיחליט לדלג עליה ייעצר בשרת.
  if (input.confirm !== true) {
    return {
      ok: false,
      error: "חסר אישור מפורש של הסוכן/ת. יש לומר את המחיר, לקבל \"כן\", ורק אז לקרוא שוב עם confirm.",
      code: "confirm_required",
    };
  }

  // בלי המפתח אין מסלול פנימי, והקריאה הייתה חוזרת 401 — הודעה שאין לסוכן/ת
  // מה לעשות איתה. עדיף לומר את זה כאן.
  if (!SERVICE_ROLE_KEY) {
    return { ok: false, code: "not_configured", error: "הפקת סרטון אינה זמינה כרגע מהצ'אט." };
  }

  const res = await fetch(`${FUNCTIONS_BASE}/property-video-create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // המסלול הפנימי של `authorizeInternalCaller`. ‏agent_id נאמן רק בזכותו.
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      agent_id: ctx.agent.id,
      property_id: propertyId,
      replace_existing: input.replace_existing === true,
      aspect_ratio: input.aspect_ratio === "9:16" ? "9:16" : "16:9",
    }),
  });

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {};
  try {
    body = await res.json();
  } catch { /* גוף שאינו JSON — הסטטוס הוא כל מה שיש */ }

  if (!res.ok) {
    const code = String(body.error || `http_${res.status}`);
    return {
      ok: false,
      code,
      error: VIDEO_BLOCKERS[code] ?? String(body.message || body.detail || "הפקת הסרטון לא נפתחה."),
      // ‏video_exists הוא היחיד שיש עליו מה לעשות בשיחה עצמה.
      retry_with: code === "video_exists" ? "replace_existing" : undefined,
    };
  }

  ctx.conv.last_property_id = propertyId;
  return {
    ok: true,
    property_id: propertyId,
    clips: body.clips,
    estimated_seconds: body.estimated_seconds,
    amount_charged: body.amount_charged,
    // ‏**הבוט אינו יוזם הודעה** (חלון 24 השעות של Meta), ולכן ההודעה על סיום
    // מגיעה בערוץ ההתראות ולא כהמשך של השיחה הזו.
    note: "ההפקה רצה ברקע ולוקחת כמה דקות. תישלח התראה כשהסרטון יהיה מוכן, " +
      "ואפשר גם לשאול בכל רגע מה מצבה.",
  };
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
    return { ok: false, error: "כתובת האתר אינה מוגדרת בשרת - אין דרך לבנות קישור." };
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
      ? `הנכס במצב ${p.status} - הקישור לא ייפתח אצל מי שאינו הסוכן/ת שלו. להחזרה לאוויר: set_property_status עם active.`
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
  const coverage = (report.data_coverage || {}) as Record<string, unknown>;
  const comparables = (report.comparables || []) as Record<string, unknown>[];
  const cityComparables = (report.city_comparables || []) as Record<string, unknown>[];

  // ‏agent_cma_report מחזירה `avg_price` רק כש-`has_statistics` — מדגם קטן
  // מ-`cma_min_comparables` חוזר בלי ממוצע בכלל. הבדיקה כאן היא חגורה שנייה:
  // בלעדיה, ממוצע שיתווסף מתישהו לענף אחר של הפונקציה היה זולג לצ'אט בלי
  // שאיש יחליט על כך.
  const hasStats = coverage.has_statistics === true;
  // שני פערים ולא אחד. הם מתארים את אותו נכס ויכולים להצביע לכיוונים
  // שונים לגמרי, כי ההבדל ביניהם הוא כולו השטח: נכס של 80 מ"ר
  // ב-1,320,000 ₪ יצא +3% מול ממוצע של 1,282,937 ₪ (113 מ"ר בממוצע),
  // ובאותה נשימה +43% למ"ר. מודל שמקבל רק את הראשון יאמר "המחיר בשוק",
  // וזו התשובה הלא נכונה. הצד של ה-UI: `renderCmaReport` ב-assets/crm.js.
  // ‏`ask == null` לפני `Number()`: **`Number(null)` הוא 0 ולא NaN**, ולכן
  // נכס בלי שטח (`price_per_sqm` חוזר null כש-`size_sqm` ריק) היה מקבל
  // ‏`gap_vs_market_per_sqm_pct: -100` — ומודל שמקבל את זה יאמר לסוכן/ת
  // שהמחיר למ"ר נמוך ב-100% מהשוק. שקר בטוח בעצמו, על החלטת תמחור.
  // ‏`Number.isFinite` לבדו אינו תופס זאת כי 0 סופי לגמרי.
  const gap = (ask: unknown, avgOf: unknown): number | undefined => {
    if (ask === null || ask === undefined || avgOf === null || avgOf === undefined) {
      return undefined;
    }
    const a = Number(ask), v = Number(avgOf);
    return hasStats && Number.isFinite(a) && Number.isFinite(v) && a > 0 && v > 0
      ? Math.round(((a - v) / v) * 100)
      : undefined;
  };
  const gapPct = gap(subject.price, stats.avg_price);
  const gapPerSqmPct = gap(subject.price_per_sqm, stats.avg_price_per_sqm);

  // שכבת השוק: נכסים **פעילים** למכירה בסביבה, כלומר מחירים מבוקשים.
  // היא עונה על "מול מי אני מתחרה" ולא על "במה נסגר", ולכן הפער שלה
  // הוא מבוקש מול מבוקש - השוואה הוגנת, ובלבד שנאמר מה היא.
  //
  // ‏`gap` בנוי סביב `hasStats` של שכבת העסקאות, ולכן אינו מתאים כאן:
  // לנכס יכול להיות חציון שוק בלי שיהיה לו ממוצע עסקאות, ולהפך.
  const marketStats = (report.market_stats || {}) as Record<string, unknown>;
  const hasMarket = coverage.has_market_statistics === true;
  const marketGap = (ask: unknown, mid: unknown): number | undefined => {
    if (ask === null || ask === undefined || mid === null || mid === undefined) return undefined;
    const a = Number(ask), v = Number(mid);
    return hasMarket && Number.isFinite(a) && Number.isFinite(v) && a > 0 && v > 0
      ? Math.round(((a - v) / v) * 100)
      : undefined;
  };

  // שכבת השכונה: עסקאות רשמיות **בלי פין** באותה שכונה כמו הנכס
  // (20270114091000). חציון משלה, נפרד מממוצע הרדיוס, ומושתק מתחת לסף
  // בדיוק כמוהו - `neighborhood_stats` חוזר null במדגם קטן.
  const hoodStats = (report.neighborhood_stats || {}) as Record<string, unknown>;
  const hasHood = coverage.has_neighborhood_statistics === true;
  const hoodGap = (ask: unknown, mid: unknown): number | undefined => {
    if (ask === null || ask === undefined || mid === null || mid === undefined) return undefined;
    const a = Number(ask), v = Number(mid);
    return hasHood && Number.isFinite(a) && Number.isFinite(v) && a > 0 && v > 0
      ? Math.round(((a - v) / v) * 100)
      : undefined;
  };

  // הנחיה ולא נתון: מודל שמקבל "0 עסקאות" ימלא את החסר באומדן משלו אם לא
  // ייאמר לו במפורש שאסור. זה בדיוק המקום שבו דוח כן הופך לדוח שנשמע כן.
  // על מה הממוצע נשען. מאז `20261228090000` הסטטיסטיקה מחושבת על עסקאות
  // מאותה מחלקת נכס **ומאותו מספר חדרים**, לפי סולם שמרחיב קודם את הרדיוס
  // ורק אחר כך מרפה מהתאמת החדרים. שני המצבים שבהם הוא לא הצליח הם בדיוק
  // אלה שבהם הממוצע חוזר לערבב דירות 3 חדרים עם דירות 5 - ומודל שלא נאמר
  // לו ימסור את הפער כאילו כלום לא קרה. זו הנחיה ולא נתון, מאותה סיבה
  // ש-COVERAGE_GUIDANCE היא הנחיה.
  const ROOMS_GUIDANCE: Record<string, string> = {
    exact: "",
    relaxed:
      "לא נמצאו די עסקאות באותו מספר חדרים בדיוק, ולכן הממוצע נשען על טווח חדרים מעט רחב " +
      "יותר. ציין/י זאת כשאת/ה מוסר/ת את הפער.",
    no_similar_rooms:
      "לא נמצאו די עסקאות במספר חדרים דומה, ולכן הממוצע הכולל מערבב נכסים בגדלים שונים. " +
      "אל תמסור/תמסרי את gap_vs_market_pct כאילו הוא השוואה לנכס דומה: אמור/אמרי במפורש " +
      "שההשוואה אינה מסוננת לפי חדרים, ושהמחיר למ\"ר הוא ההשוואה המהימנה כאן.",
    subject_rooms_missing:
      "לנכס עצמו לא רשום מספר חדרים, ולכן ההשוואה אינה מסוננת לפי חדרים והממוצע מערבב " +
      "גדלים שונים. אמור/אמרי זאת, ובקש/י להשלים את מספר החדרים בכרטיס הנכס - זה מה " +
      "שמדייק את הדוח יותר מכל דבר אחר.",
  };

  // שכבת השוק. **הסכנה כאן היא ערבוב**: מודל שמקבל "חציון" ו"ממוצע"
  // באותו אובייקט ימסור אותם כשני אומדנים של אותו דבר, וזה בדיוק מה
  // שהם אינם - אחד הוא מה שנסגר והשני הוא מה שמבקשים עכשיו.
  const MARKET_GUIDANCE: Record<string, string> = {
    features:
      "חציון השוק נשען על נכסים שתואמים לנכס גם במאפיינים (ממ\"ד, מעלית, מרפסת, חניה). " +
      "אלה **מחירים מבוקשים** ולא מחירי עסקה: אמור/אמרי זאת במפורש, ואל תערבב/י אותם עם ממוצע העסקאות.",
    rooms_only:
      "לא נמצאו די נכסים שתואמים גם במאפיינים, ולכן חציון השוק נשען על אותו מספר חדרים בלבד. " +
      "אלה **מחירים מבוקשים** ולא מחירי עסקה, ויש לומר את שניהם.",
    subject_features_missing:
      "לנכס לא רשומים מאפיינים, ולכן אי אפשר לדרג את המתחרים לפיהם. אלה **מחירים מבוקשים**. " +
      "אפשר להציע לסמן ממ\"ד, מעלית, מרפסת וחניה בכרטיס הנכס כדי לדייק את ההשוואה.",
    too_few:
      "יש פחות נכסים דומים בשוק מהמינימום, ולכן **אין חציון שוק**. אפשר למנות את הנכסים עצמם " +
      "כמתחרים, ואסור לגזור מהם מחיר.",
  };

  const COVERAGE_GUIDANCE: Record<string, string> = {
    ok: "",
    insufficient:
      `נמצאו ${String(coverage.comparables_found)} עסקאות בלבד בסביבת הנכס, והמינימום לחישוב ממוצע הוא ` +
      `${String(coverage.min_required)}. אין ממוצע ואין הערכת שווי. אמור/י זאת במפורש, הצג/י את העסקאות ` +
      "הבודדות כמו שהן, ואל תאמוד/תאמדי מחיר בעצמך.",
    none:
      "לא נמצאה אף עסקה להשוואה בסביבת הנכס. אמור/י זאת במפורש ואל תאמוד/תאמדי מחיר בעצמך.",
    no_location:
      "לנכס אין קואורדינטות, ולכן אין השוואות לפי רדיוס. גיאוקוד נעשה על כתובת בעפולה עם רחוב ומספר בית.",
  };

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
    // הפער הוא השורה שהסוכן/ת מחפש/ת: המחיר המבוקש מול ממוצע העסקאות
    // בסביבה — וקיים רק כשיש ממוצע שמותר להישען עליו. שניהם חוזרים,
    // כי אחד מהם לבדו מטעה בדיוק כשהשטחים שונים.
    gap_vs_market_pct: gapPct,
    gap_vs_market_per_sqm_pct: gapPerSqmPct,
    // כמה עסקאות באמת עמדו מאחורי כל אחד מהם. ממוצע המ"ר נשען רק על
    // עסקאות שיש להן שטח, והוא לרוב מדגם קטן יותר.
    gap_sample_size: hasStats ? stats.comparables_count : undefined,
    gap_per_sqm_sample_size: hasStats ? stats.sqm_sample_size : undefined,
    stats,
    data_coverage: coverage,
    coverage_guidance: COVERAGE_GUIDANCE[String(coverage.status)] || undefined,
    // ‏0 = אותו מספר חדרים בדיוק, 0.5/1 = טווח, null = בלי סינון חדרים.
    // ‏`rooms_band_reason` אומר איזה מהשניים האחרונים זה, וזה ההבדל בין
    // "לא נמצאו עסקאות דומות" ל"לנכס חסר מספר חדרים".
    // ---- שכבת השוק. מחירים מבוקשים, ולכן שדות נפרדים לגמרי ----
    market_median_asking_price: hasMarket ? marketStats.median_price : undefined,
    market_median_asking_price_per_sqm: hasMarket ? marketStats.median_price_per_sqm : undefined,
    market_gap_vs_asking_pct: marketGap(subject.price, marketStats.median_price),
    market_gap_vs_asking_per_sqm_pct: marketGap(subject.price_per_sqm, marketStats.median_price_per_sqm),
    market_sample_size: hasMarket ? marketStats.count : undefined,
    market_comparables_total: coverage.market_comparables_total,
    market_feature_matched: coverage.market_feature_matched,
    market_band_reason: coverage.market_band_reason,
    market_guidance: MARKET_GUIDANCE[String(coverage.market_band_reason)] || undefined,
    rooms_band: hasStats ? coverage.rooms_band : undefined,
    rooms_band_reason: hasStats ? coverage.rooms_band_reason : undefined,
    excluded_other_rooms: hasStats ? coverage.excluded_other_rooms : undefined,
    comparability_guidance: hasStats
      ? ROOMS_GUIDANCE[String(coverage.rooms_band_reason)] || undefined
      : undefined,
    // מאיפה הנתונים בדוח הזה באמת הגיעו. נאמר לסוכן/ת כשהוא/היא שואל/ת.
    sources: report.sources,
    // עסקאות שרשומות לפי המחיר המבוקש ולא לפי מחיר הסגירה. אם יש כאלה,
    // הן אינן "מחירי עסקה" וצריך לומר זאת כשמציגים אותן.
    asking_basis_count: coverage.asking_basis_count,
    radius_meters_used: report.radius_meters_used,
    radius_exhausted: report.radius_exhausted,
    comparables: comparables.slice(0, limit),
    comparables_returned: Math.min(comparables.length, limit),
    // עסקאות באותה עיר שאין להן מיקום — לא מעורבבות בממוצע, ולכן רק נספרות
    city_comparables_count: cityComparables.length,
    // עסקאות בלי פין באותה שכונה - השוואה "לפי שכונה", לא ברדיוס. כשמציגים
    // את החציון הזה אומרים שהוא לפי שכונה ושהוא נפרד מהממוצע שלמעלה.
    neighborhood_name: coverage.neighborhood_name || undefined,
    neighborhood_deals_total: coverage.neighborhood_comparables_total || undefined,
    neighborhood_median_price: hasHood ? hoodStats.median_price : undefined,
    neighborhood_median_price_per_sqm: hasHood ? hoodStats.median_price_per_sqm : undefined,
    neighborhood_sample_size: hasHood ? hoodStats.count : undefined,
    neighborhood_gap_pct: hoodGap(subject.price, hoodStats.median_price),
    neighborhood_gap_per_sqm_pct: hoodGap(subject.price_per_sqm, hoodStats.median_price_per_sqm),
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
/**
 * עסקאות רשות המיסים סביב כתובת.
 *
 * ‏**הגאוקוד כאן, לא במסד.** ‏`agent_market_deals_lookup` מקבלת `lat`/`lng`
 * ואינה יודעת לפתור כתובת - השכבה שפותרת אותה היא WFS עירוני, כלומר רשת,
 * כלומר לא פונקציה במסד. ‏`geocodeInCity` מחזירה `null` גם על "אין כזו
 * כתובת" וגם על "אין ספק לעיר", ובשני המקרים נופלים למצב `street`.
 *
 * ‏**ולמה בכלל יש מצב נפילה.** התאמת שם רחוב היא שבירה לכתיב, וזו הסיבה
 * שהרדיוס הוא ברירת המחדל. אבל "אין לנו שכבה בעיר הזו" אינו סיבה להחזיר
 * כלום כשהנתונים במסד - והערך המוחזר נושא `mode`, כדי שהעוזר יוכל לומר
 * שהחיפוש היה לפי שם רחוב ולא לפי מרחק.
 */
async function toolMarketDealsLookup(ctx: ToolContext, input: Record<string, unknown>) {
  const city = String(input.city || "עפולה").trim();
  const street = String(input.street || "").trim();
  const houseNumber = String(input.house_number || "").trim();

  // בלי רחוב = העיר כולה (מיגרציה 20270104090000). קודם זה החזיר "צריך
  // שם רחוב", והעוזר ניחש שני רחובות "מרכזיים" שלא היו במאגר.
  const coords = street && houseNumber ? await geocodeInCity(ctx.supabase, city, street, houseNumber) : null;

  const { data, error } = await ctx.supabase.rpc("agent_market_deals_lookup", {
    p_agent_id:      ctx.agent.id,
    p_city:          city,
    p_lat:           coords?.lat ?? null,
    p_lng:           coords?.lng ?? null,
    p_street:        street || null,
    p_house_number:  houseNumber || null,
    p_radius_m:      Number(input.radius_m) || 300,
    p_months:        Number(input.months) || 24,
    p_limit:         Number(input.limit) || 5,
    p_property_type: input.property_type ? String(input.property_type) : null,
  });
  if (error) return { ok: false, error: error.message };

  const res = (data || {}) as Record<string, unknown>;
  if (res.error === "tier_required") {
    return {
      ok: false,
      error: String(res.detail || "היכולת זמינה במסלול Elite."),
      upgrade_to: "Elite",
    };
  }
  if (res.error) return { ok: false, error: String(res.detail || res.error) };

  const deals = (res.deals || []) as Record<string, unknown>[];

  // חיפוש ריק: אולי חור בנתונים. ‏report_deal_gap מחליטה מהמסד ומתריעה
  // למנהל/ת הפלטפורמה (מיגרציה 20270110090000). כשל כאן אינו מפיל את התשובה.
  if (deals.length === 0) {
    const { error: gapErr } = await ctx.supabase.rpc("report_deal_gap", {
      p_city: city, p_street: street || null,
    });
    if (gapErr) console.warn("report_deal_gap failed", gapErr.message);
  }

  // הנחיה ולא נתון, באותו היגיון של COVERAGE_GUIDANCE ב-cma_report: מודל
  // שמקבל רשימה ריקה ימלא את החסר באומדן משלו אם לא ייאמר לו במפורש שאסור.
  // ‏coverage חוזר רק כשהתוצאה ריקה: מה **כן** יש במאגר לעיר. בלעדיו העוזר
  // הסיק "המאגר לא מכסה את נוף הגליל" על עיר עם 1,512 עסקאות.
  const coverage = res.coverage as Record<string, unknown> | null | undefined;
  const guidance = deals.length === 0
    ? (coverage && Number(coverage.deals_in_city) > 0
      ? "לא נמצאה עסקה שעונה על החיפוש, **אבל העיר כן במאגר**: coverage מראה כמה עסקאות יש בה, " +
        "באיזה טווח תאריכים (first_sold_at עד last_sold_at) ובאילו רחובות (top_streets). " +
        "אמור/י זאת, הצע/י רחוב מתוך top_streets או חיפוש בעיר כולה, ואל תאמר/י שהעיר אינה במאגר. " +
        "אם החיפוש היה על תקופה ארוכה מהטווח - הסבר/י שהמאגר מחזיק רק את 1,500 העסקאות האחרונות ביישוב."
      : "אין במאגר אף עסקה בעיר הזו. אמור/י זאת במפורש, ואל תאמוד/תאמדי מחיר בעצמך.")
    : res.mode === "street"
    ? "לא הצלחנו למקם את הכתובת, ולכן החיפוש נעשה לפי **שם הרחוב** ולא לפי מרחק. אמור/י זאת, ואל תציג/י מרחקים."
    : res.mode === "street_partial"
    ? "שם הרחוב לא נמצא כמו שהוא, והתוצאות הן מרחוב ש**שמו דומה** (שם אחד מוכל בשני). אמור/י מה שם הרחוב במאגר, כדי שהסוכן/ת יוודא/תוודא שזה הרחוב הנכון."
    : res.mode === "city"
    ? "אלה העסקאות האחרונות **בעיר כולה**, לא ברחוב מסוים. אל תציג/י מרחקים."
    : "";

  return {
    ok: true,
    mode: res.mode,
    city: res.city,
    radius_meters: res.radius_meters,
    months: res.months,
    oldest_considered: res.oldest_considered,
    returned: res.returned,
    total_found: res.total_found,
    source: res.source,
    deals,
    ...(coverage ? { coverage } : {}),
    ...(guidance ? { guidance } : {}),
  };
}

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
      note: "אין מידע תכנוני שמור על הנכס הזה. הקליטה האוטומטית עובדת על כתובת בעפולה עם רחוב ומספר בית; בדיקה נקודתית לפי הכתובת או לפי גוש/חלקה אפשרית עם planning_lookup.",
    };
  }

  return { ok: true, ...info };
}

/**
 * מידע תכנוני לפי כתובת או גוש/חלקה, בלי נכס.
 *
 * ‏`planning_info` עונה רק על נכס שכבר במערכת. אבל השאלה "מה הגוש והחלקה
 * של הרצל 20" נשאלת **לפני** שיש נכס - בשיחה הראשונה עם בעלים, או כשמתווך/ת
 * בודק/ת מגרש. בדשבורד זה הכלי "מידע תכנוני"; כאן זה אותו מנוע בדיוק.
 *
 * ‏**אותה שליפה, לא עותק:** ‏`lookupPlanning` מ-`_shared/afula-planning.ts`,
 * שגם `afula-planning-lookup` וגם `planning-backfill` קוראות לה. ואותו
 * מטמון (‏`planning_lookups`, ‏24 שעות, אותו `lookup_key`), כך ששאלה בבוט
 * ובדשבורד על אותה כתובת עולה קריאת WFS אחת.
 *
 * ‏**הגייט:** אותו מסלול כמו `afula-planning-lookup` - ‏mid/premium עם
 * ‏`billing_status = 'active'`. הוובהוק בודק רק `tier` בכניסה, ולכן מנוי
 * שפג נבדק כאן (‏`.claude/skills/new-tier-capability`).
 *
 * ‏**רק עפולה, ביושר.** השכבות הן של העירייה. ‏GovMap נותן את אותו מידע
 * לכל הארץ, אבל הטוקן שלו נעול לדפדפן ועוד לא ידוע אם הוא עונה לשרת
 * (‏`docs/govmap.md`). עד אז מחוץ לעפולה חוזר `city_not_supported` עם קישור
 * לחיפוש ב-GovMap - ולא ניחוש.
 */
async function toolPlanningLookup(ctx: ToolContext, input: Record<string, unknown>) {
  const digits = (v: unknown) => String(v ?? "").replace(/[^\d]/g, "");
  const gush = digits(input.gush);
  const helka = digits(input.helka);
  // ‏lookupPlanning משרשרת רחוב ומספר לתוך XML של שאילתת ה-WFS בלי בריחה.
  // בדשבורד הקלט עובר בשדה מרשימה; כאן הוא טקסט חופשי מהמודל, ו-`<` או `&`
  // היו שוברים את השאילתה ומחזירים "השכבה לא ענתה" על כתובת תקינה.
  const xmlSafe = (v: unknown) => String(v ?? "").replace(/[<>&"']/g, " ").replace(/\s+/g, " ").trim();
  let street = xmlSafe(input.street);
  const houseNumber = xmlSafe(input.house_number);
  const byParcel = Boolean(gush && helka);

  if (!byParcel && !(street && houseNumber)) {
    return {
      ok: false,
      error: "missing_fields",
      guidance: "צריך רחוב ומספר בית, או גוש וחלקה. שאל/י בשאלה אחת קצרה מה חסר.",
    };
  }

  const { data: member, error: memberErr } = await ctx.supabase
    .from("agency_members").select("tier, active, billing_status")
    .eq("id", ctx.agent.id).maybeSingle();
  if (memberErr) return { ok: false, error: memberErr.message };
  if (
    !member?.active || member.billing_status !== "active" ||
    (member.tier !== "mid" && member.tier !== "premium")
  ) {
    return {
      ok: false,
      error: "tier_required",
      detail: "מידע תכנוני זמין במסלולים PROFESSIONAL ו-Elite עם מנוי פעיל.",
      upgrade_to: "PROFESSIONAL",
    };
  }

  const city = String(input.city || "").trim() || await agencyDefaultCity(ctx);
  const query = byParcel
    ? `גוש ${gush} חלקה ${helka}`
    : `${street} ${houseNumber} ${city}`;
  const govmapUrl = "https://www.govmap.gov.il/?q=" + encodeURIComponent(query);

  // גוש/חלקה הם מזהה ארצי, ולכן העיר אינה חוסמת אותם: שכבת הקדסטר של
  // עפולה פשוט לא תמצא חלקה מחוץ לתחומה, וזה מטופל למטה. כתובת, לעומת זאת,
  // תיבדק מול רחובות עפולה - ו"הרצל 20" בחיפה היה מחזיר את הרצל 20 בעפולה.
  if (!byParcel && city !== "עפולה") {
    return {
      ok: false,
      error: "city_not_supported",
      city,
      govmap_url: govmapUrl,
      guidance:
        "המידע התכנוני האוטומטי זמין כרגע רק בעפולה. אמור/י זאת, והצע/י את govmap_url " +
        "(חיפוש הכתובת במפה הממשלתית, שם אפשר ללחוץ על החלקה). אם הסוכן/ת יודע/ת " +
        "גוש וחלקה - אפשר לנסות איתם. אל תנחש/י גוש, חלקה או ייעוד.",
    };
  }

  if (!byParcel) street = await canonicalAfulaStreet(ctx, street);

  const lookupKey = byParcel
    ? planningLookupKey({ gush, helka })
    : planningLookupKey({ street, house_number: houseNumber });
  let record: Record<string, unknown>;
  let cached = false;

  const { data: hit } = await ctx.supabase
    .from("planning_lookups").select("*").eq("lookup_key", lookupKey).maybeSingle();
  if (hit && new Date(hit.looked_up_at).getTime() > Date.now() - 24 * 60 * 60 * 1000) {
    record = hit as Record<string, unknown>;
    cached = true;
  } else {
    let result: Awaited<ReturnType<typeof lookupPlanning>>;
    try {
      result = await lookupPlanning({
        street: byParcel ? undefined : street,
        house_number: byParcel ? undefined : houseNumber,
        gush: byParcel ? gush : undefined,
        helka: byParcel ? helka : undefined,
      });
    } catch (err) {
      // תקלת שכבה אינה "לא נמצא" - ואסור שתיאמר כך לסוכן/ת.
      console.error("planning_lookup: WFS failed", err);
      return {
        ok: false,
        error: "gis_unavailable",
        guidance: "שכבות ה-GIS של העירייה לא ענו כרגע. אמור/י שכדאי לנסות שוב בעוד כמה דקות, ואל תאמר/י שהכתובת לא קיימת.",
      };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        govmap_url: govmapUrl,
        guidance: result.error === "parcel_not_found"
          ? "החלקה לא נמצאה בשכבת הקדסטר של עפולה. ייתכן שהיא מחוץ לעפולה - המידע האוטומטי מכסה כרגע רק אותה. הצע/י את govmap_url."
          : "הכתובת לא נמצאה בשכבת הכתובות של העירייה. בקש/י לוודא את שם הרחוב והמספר, או גוש וחלקה אם ידועים. אפשר גם להציע את govmap_url.",
      };
    }
    record = result.record as Record<string, unknown>;
    const { error: upErr } = await ctx.supabase
      .from("planning_lookups").upsert(record, { onConflict: "lookup_key" });
    if (upErr) console.warn("planning_lookup: cache write failed", upErr.message);
  }

  // תוכניות: מספר, תיאור ושנה. ‏area_sqm של תוכנית לא נחוץ בצ'אט, ורשימה של
  // שבע תוכניות מלאות בהודעת וואטסאפ מסתירה את השורה החשובה - הייעוד.
  const plans = ((record.applicable_plans || []) as Record<string, unknown>[])
    .slice(0, 8)
    .map((p) => ({
      number: p.number ?? null,
      description: p.description ?? null,
      year: p.date ? String(p.date).slice(0, 4) : null,
    }));
  const lat = Number(record.lat), lng = Number(record.lng);

  return {
    ok: true,
    cached,
    city: "עפולה",
    queried: byParcel ? { gush, helka } : { street, house_number: houseNumber },
    gush: record.gush ?? null,
    helka: record.helka ?? null,
    parcel_area_sqm: record.parcel_area_sqm ?? null,
    parcel_status: record.parcel_status ?? null,
    land_use_designation: record.land_use_designation ?? null,
    applicable_plans: plans,
    plans_total: ((record.applicable_plans || []) as unknown[]).length,
    map_url: Number.isFinite(lat) && Number.isFinite(lng)
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : null,
    guidance:
      "פתח/י בגוש ובחלקה, אחריהם הייעוד, ואז התוכניות. אם גוש או חלקה חזרו ריקים - " +
      "אמור/י שהכתובת נמצאה אבל החלקה לא זוהתה, ואל תשלים/י אותם. סיים/י במשפט ה-disclaimer.",
    disclaimer:
      "המידע כללי, מבוסס על שכבות ה-GIS של עיריית עפולה, ואינו תחליף לבדיקה מול הוועדה המקומית לתכנון ובנייה.",
  };
}

/**
 * שם הרחוב הקנוני מרשימת הרחובות של עפולה, או מה שהוקלד אם אין התאמה.
 *
 * ‏`planning-backfill` למדה את זה בדרך הקשה: "יצחק רבין 1" לא נמצא, כי
 * בשכבה זה "שדרות יצחק רבין" - ו-`streetVariants` אינו מכסה תחילית שלמה.
 * הרשימה (ושמות נרדפים ממאגר רשות האוכלוסין) יודעת לתרגם. לעולם לא זורקת:
 * זה תיקון כתיב, ולא תנאי לשליפה.
 */
async function canonicalAfulaStreet(ctx: ToolContext, street: string): Promise<string> {
  try {
    const { data: key } = await ctx.supabase.rpc("street_name_key", { p_name: street });
    if (!key) return street;
    const { data: exact } = await ctx.supabase
      .from("street_registry").select("name")
      .eq("city", "עפולה").eq("name_key", key).eq("active", true)
      .limit(1).maybeSingle();
    if (exact?.name) return String(exact.name);
    const { data: alias } = await ctx.supabase
      .from("street_registry_aliases").select("name")
      .eq("city", "עפולה").eq("alias_key", key)
      .limit(1).maybeSingle();
    if (alias?.name) return String(alias.name);
  } catch (err) {
    console.warn("canonicalAfulaStreet failed", err);
  }
  return street;
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

/**
 * קובץ הלקוחות — אותה תקרה ואותו היגיון של `list_properties`, עם הבדל אחד
 * שמשנה את המספרים.
 *
 * **שורת לקוח/ה כבדה כמעט פי שניים משורת נכס**: ~460 תווים מול ~260, כי
 * ‏`needs` מורכב משמונה־עשר שדות ו-`notes` הוא טקסט חופשי בלי גבול. ‏200
 * שורות כאן הן ~92KB — ובאותה לולאת כלים שנשלחת מחדש בכל סבב, זה הרבה יותר
 * מ-200 נכסים.
 *
 * לכן התקרה עלתה ל-200 כמו שם, אבל **`notes` נגזם בחלון גדול**: מעל
 * ‏`NOTES_FULL_WINDOW` שורות מדובר בעיון ברשימה ולא בשליפה של לקוח/ה מסוים/ת,
 * ואיש אינו קורא שישים הערות מלאות בוואטסאפ. חיפוש לפי שם מחזיר שורות
 * בודדות — ושם ההערה חוזרת שלמה, כי זו בדיוק השאלה שנשאלה.
 *
 * ‏`total_active` ו-`total_all` עונים על "כמה לקוחות יש לי" ואינם מושפעים
 * מהסינון. ‏`total_matching` הוא הספירה על **אותם תנאים** שהוחזרו, והוא זה
 * שקובע את `truncated` — בלעדיו רשימה שסוננה ב-query הייתה נראית חתוכה רק
 * משום שיש לסוכן/ת עוד לקוחות אחרים.
 */
const LIST_CLIENTS_MAX = 200;
const NOTES_FULL_WINDOW = 20;
const NOTES_BROWSE_CHARS = 240;

async function toolListClients(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), LIST_CLIENTS_MAX);

  let query = ctx.supabase
    .from("agent_clients")
    .select(
      "id, full_name, phone, email, notes, status, deal_type, category, " +
      "property_types, cities, min_price, max_price, min_rooms, max_rooms, " +
      "min_size_sqm, max_floor, required_features, created_at",
    )
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false });

  // ספירה על אותם תנאים בדיוק פרט ל-limit. ‏head: true מחזיר מספר בלי שורות.
  let counter = ctx.supabase
    .from("agent_clients")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", ctx.agent.id);

  if (input.status) {
    query = query.eq("status", String(input.status));
    counter = counter.eq("status", String(input.status));
  } else if (!input.all_statuses) {
    query = query.eq("status", "active");
    counter = counter.eq("status", "active");
  }

  const q = String(input.query || "").trim();
  if (q) {
    // ‏escape על הפסיק והסוגריים: מחרוזת חיפוש עם פסיק הייתה נקראת כשני
    // תנאים ב-`or` ומחזירה שגיאת פרסור מ-PostgREST.
    const safe = q.replace(/[,()*]/g, " ").trim();
    if (safe) {
      const or = `full_name.ilike.%${safe}%,phone.ilike.%${safe}%`;
      query = query.or(or);
      counter = counter.or(or);
    }
  }

  const [{ data, error }, { count: totalMatching, error: matchCountErr }] = await Promise.all([
    query.limit(limit),
    counter,
  ]);
  if (error) return { ok: false, error: error.message };
  if (matchCountErr) console.warn("client match count failed", matchCountErr.message);

  // ספירת ההתאמות לכל לקוח/ה בקריאה אחת (ולא שאילתה לכל שורה). כשל כאן אינו
  // מפיל את הרשימה — הדרישות והטלפון הם עיקר התשובה, וההתאמות תוספת.
  const counts = new Map<string, { n: number; top: string | null }>();
  const { data: matchRows, error: matchErr } = await ctx.supabase
    .rpc("agent_client_match_counts", { p_agent_id: ctx.agent.id });
  if (matchErr) console.warn("match counts failed", matchErr.message);
  for (const row of (matchRows || []) as Record<string, unknown>[]) {
    const top = row.top_score
      ? `${row.top_score}% - ${[row.top_title, row.top_street, row.top_city].filter(Boolean).join(", ")}`
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

  // עיון ברשימה מול שליפה של לקוח/ה. ראו ההסבר מעל הפונקציה.
  const browsing = data.length > NOTES_FULL_WINDOW;
  const matching = typeof totalMatching === "number" ? totalMatching : data.length;
  let notesTrimmed = 0;

  return {
    ok: true,
    total_active: totalActive ?? 0,
    total_all: totalAll ?? 0,
    // כמה תואמים את הסינון שהוחזר — זה מה שמגדיר אם הרשימה חתוכה, ולא
    // ‏total_all: חיפוש שמצא שלושה מתוך מאה אינו רשימה חתוכה.
    total_matching: matching,
    truncated: matching > data.length,
    returned: data.length,
    query: q || undefined,
    clients: data.map((c) => {
      const full = String(c.notes ?? "");
      const trim = browsing && full.length > NOTES_BROWSE_CHARS;
      if (trim) notesTrimmed++;
      return {
        client_id: c.id,
        full_name: c.full_name,
        phone: c.phone,
        email: c.email,
        status: c.status,
        needs: clientNeeds(c),
        notes: trim ? `${full.slice(0, NOTES_BROWSE_CHARS)}…` : (c.notes ?? null),
        notes_truncated: trim || undefined,
        match_count: counts.get(c.id)?.n ?? null,
        top_match: counts.get(c.id)?.top ?? null,
      };
    }),
    note: [
      matching > data.length
        ? `מוצגים ${data.length} מתוך ${matching}. לצמצום - query.`
        : null,
      notesTrimmed
        ? `ההערות של ${notesTrimmed} לקוחות נגזמו כי הרשימה ארוכה - לקריאה מלאה, query על השם.`
        : null,
    ].filter(Boolean).join(" ") || undefined,
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
        "כבר קיים/ת לקוח/ה כזה/כזו בקובץ. לא נוצרה רשומה חדשה - שאל/י את " +
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
  buy: "הזמנת שירותי תיווך - קניה",
  sell: "הזמנת שירותי תיווך - מכירה",
  tenant: "הזמנת שירותי תיווך - שוכר",
  landlord: "הזמנת שירותי תיווך - משכיר",
  exclusive_sell: "בלעדיות - מכירה",
  exclusive_landlord: "בלעדיות - משכיר",
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
    return { ok: false, error: "לסוכן/ת אין משרד משויך - צריך להשלים הרשמה בדשבורד." };
  }
  if (!SITE_BASE_URL) {
    return { ok: false, error: "כתובת האתר אינה מוגדרת בשרת - אין דרך לבנות קישור חתימה." };
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
  // המשרד בשאילתה נפרדת ולא ב-embed‏ (agencies(name, address)). ראו
  // ‏`_shared/agency-lookup.ts`: ה-embed הזה מחזיר PGRST201 ומפיל את **כל**
  // השאילתה, ולכן `member` היה חוזר null — כלומר כל ניסיון להכין הסכם מכאן
  // נענה ב"לא נמצאו פרטי הסוכן/ת", בלי שדבר אחר ייראה שבור.
  const { data: member } = await ctx.supabase
    .from("agency_members")
    .select("id, display_name, id_number, license_number, phone, agency_id")
    .eq("id", ctx.agent.id)
    .maybeSingle();
  if (!member) return { ok: false, error: "לא נמצאו פרטי הסוכן/ת." };
  const agency = await loadAgency(ctx.supabase, member.agency_id, "name, address");

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
    const url = `${SITE_BASE_URL}/sign?t=${sg.sign_token}`;
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
    how_to_sign: "אותו קישור משמש לשתי הדרכים: מרחוק - להעביר אותו לחותם/ת; פנים מול פנים - לפתוח אותו על המכשיר שלך ולהושיט לחתימה.",
    requires_otp: !!created.require_otp,
    otp_note: created.require_otp
      ? "בטופס הזה החתימה מרחוק דורשת קוד אימות שנשלח למייל של החותם/ת. בחתימה פנים מול פנים זה לא רלוונטי."
      : undefined,
    // ‏OTP בלי מייל = קישור שנפתח ונתקע. עדיף לומר את זה עכשיו.
    otp_missing_email: created.require_otp
      ? signers.filter((sg) => !(sg.email || "").trim()).map((sg) => sg.full_name)
      : undefined,
    frozen_note: "גוף המסמך ננעל ואי אפשר לערוך אותו. לתיקון - ביטול ההסכם והוצאת חדש, באשף שבדשבורד.",
    manage_where: `${SITE_BASE_URL}/crm`,
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
    return { ok: false, error: "ההסכם בוטל - אין קישורי חתימה." };
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
    return { ok: false, error: "כתובת האתר אינה מוגדרת בשרת - אין דרך לבנות קישור." };
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
      sign_url: `${SITE_BASE_URL}/sign?t=${s.sign_token}`,
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
    unlock_where: SITE_BASE_URL ? `${SITE_BASE_URL}/crm?goto=accLeads` : null,
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
      ? "הסוגים האלה מושתקים בפעמון, ולכן לא ייווצרו ולא יישלחו - צריך להפעיל אותם קודם ב'ניהול התראות' בדשבורד."
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
      case "market_deals_lookup": return await toolMarketDealsLookup(ctx, input);
      case "planning_info": return await toolPlanningInfo(ctx, input);
      case "planning_lookup": return await toolPlanningLookup(ctx, input);
      // שת"פ
      case "share_property": return await toolShareProperty(ctx, input);
      case "unshare_property": return await toolUnshareProperty(ctx, input);
      case "property_share_status": return await toolPropertyShareStatus(ctx, input);
      // סרטון שיווקי
      case "property_video_info": return await toolPropertyVideoInfo(ctx, input);
      case "create_property_video": return await toolCreatePropertyVideo(ctx, input);
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
/**
 * ההוראות הקבועות — **זהות בייט־בבייט לכל סוכן/ת ולכל הודעה**, וזה מה שהופך
 * אותן לניתנות למטמון.
 *
 * ## למה זה מפוצל לשניים
 *
 * ‏Prompt caching הוא **התאמת תחילית**: כל בית שמשתנה מבטל את כל מה שאחריו.
 * קודם הפרומפט נבנה כמחרוזת אחת שכללה את שם הסוכן/ת, את שם המשרד, את תאריך
 * היום ואת מצב השיחה — כלומר הוא היה שונה אצל כל אחד/ת ובכל שיחה, ולכן
 * **לא היה ניתן למטמון כלל**. עשרים ותשעה הגדרות כלים ותשעה קילו-בייט של
 * הוראות נשלחו מחדש בכל קריאה, ועד שמונה פעמים בתוך תור אחד.
 *
 * הפיצול הוא לפי מי שהתוכן משתנה איתו:
 *
 *   ‏· כאן — ההוראות. זהות לכולם, ולכן המטמון משותף **בין כל הסוכנים**.
 *   ‏· `sessionContext()` — השם, המשרד, התאריך ומצב השיחה. קטן, ויושב אחרי
 *     נקודת השבירה כדי שלא יבטל את מה שלפניו.
 *
 * סדר הרינדור של ה-API הוא `tools` → `system` → `messages`, ולכן נקודת
 * שבירה אחת בסוף הבלוק הזה תופסת גם את הגדרות הכלים שלפניו.
 *
 * ⚠️ **אסור להכניס לכאן דבר שמשתנה בין קריאות** — לא תאריך, לא שם, לא מזהה
 * ולא ספירה. שורה כזו לא תישבר ולא תיראה שבורה; היא פשוט תאפס את המטמון
 * בשקט, ו-`cache_read_input_tokens` בלוג יחזור אפס.
 */
const SYSTEM_STATIC: string = (() => {
  const lines = [
    "את/ה העוזר/ת של שוק נדל\"ן - מערכת ניהול נכסים לסוכני נדל\"ן.",
    "את/ה מדבר/ת עם הסוכן/ת בוואטסאפ ומבצע/ת עבורו/ה פעולות במערכת דרך הכלים.",
    "",
    "מה יש לך: נכסים, שת\"פ בין משרדים, הפקת סרטון שיווקי, קובץ הלקוחות, ההתאמות " +
      "בין השניים, ניתוח שוק ומידע תכנוני, ההסכמים, הלידים וההתראות.",
    "",
    "כללים כלליים:",
    "- ענה/י בעברית, קצר, בסגנון וואטסאפ. אימוג'י אחד לכל היותר.",
    "- הדגשה בוואטסאפ היא כוכבית אחת: *כך*, ולא שתיים. מקף רגיל (-) ולא מקף ארוך.",
    "- מחירים בעברית מדוברת: \"1.8 מליון\" = 1800000, \"5,500 שקל\" = 5500. שכירות היא מחיר חודשי.",
    "- אל תשאל/י שאלות מיותרות, ואל תמציא/י פרטים שלא נאמרו. מה שלא ידוע נשאר ריק.",
    "- אל תציג/י UUID לסוכן/ת. התייחס/י לנכסים לפי כתובת או כותרת, וללקוחות לפי שם.",
    "- אחרי פעולה מוצלחת אשר/י אותה במשפט אחד עם מה שנוצר/השתנה. אם התקבל link, צרף/י אותו.",
    "- **לשאלת \"כמה\" תמיד קרא/י לכלי שמחזיר ספירה** (property_stats, list_clients) ואל " +
      "תספור/תספרי מתוך רשימה שהוחזרה - רשימה היא חלון, לא הקובץ.",
    "",
    "נכסים:",
    "- השדות ההכרחיים ליצירת נכס הם סוג נכס, סוג עסקה ומחיר בלבד - אם יש אותם, צור/צרי את הנכס והשלם/י את השאר ממה שנאמר.",
    "- אם חסר אחד מהשלושה, בקש/י בשאלה אחת קצרה רק את מה שחסר.",
    "- לפני שינוי או ארכוב של נכס קיים - ודא/י שאת/ה יודע/ת על איזה נכס מדובר. אם לא, קרא/י ל-list_properties.",
    "- **למצוא נכס = list_properties עם query**, ולא משיכת כל הרשימה וסריקה שלה. " +
      "החיפוש רץ על כל הנכסים של הסוכן/ת; הרשימה בלי query היא רק החדשים. " +
      "\"הדירה באבן גבירול\" → query: \"אבן גבירול\". מספר מודעה → query עם המספר.",
    "- ‏**אל תדווח/י על גודל הרשימה שהוחזרה כאילו הוא מספר הנכסים.** ‏total הוא " +
      "כמה יש באמת, ו-truncated אומר שהוחזר חלק. אם הוחזר note - אמור/אמרי אותו.",
    "- \"תמחק את הנכס\" = set_property_status עם archived. אין מחיקה אמיתית.",
    "- אם create_property החזיר duplicate: אל תיצור/י מודעה נוספת. אמור/אמרי לסוכן/ת " +
      "מה קיים (כתובת, מספר מודעה וסטטוס) ושאל/י בשאלה אחת: להחזיר ולעדכן את הקיימת, " +
      "או לפרסם מודעה נוספת? להחזרה: update_property עם ה-property_id והפרטים החדשים, " +
      "ואז set_property_status עם active. למודעה נוספת: create_property שוב עם force_new.",
    "- אחרי שנוצר נכס חדש - קרא/י ל-property_matches עליו. אם יש לקוח/ה מתאים/ה בקובץ, " +
      "זו השורה החשובה בתשובה: \"מתאים ל<שם> (92%), 052-…\".",
    "",
    "קישור לנכס ושליחה:",
    "- \"תשלח לי את הקישור לנכס\" / \"תכין הודעה על הדירה\" = property_link. הצג/י את " +
      "ה-message כמו שהוא (זה הטקסט שיועבר), ומתחתיו את wa_share_url - לחיצה אחת פותחת " +
      "וואטסאפ עם ההודעה מוכנה.",
    "- כשהסוכן/ת אומר/ת למי ההודעה (\"תשלח את זה לרונית\") - מצא/י את הלקוח/ה עם " +
      "list_clients, והעבר/י client_id ל-property_link. אז חוזר wa_client_url ישר לצ'אט " +
      "שלו/ה. אם חזר client_phone_missing - אמור/אמרי שאין טלפון בקובץ והצג/י את " +
      "wa_share_url במקום.",
    "- **הבוט אינו שולח ללקוח/ה.** ההודעה יוצאת מהמספר של הסוכן/ת בלחיצה שלו/ה, " +
      "בדיוק כמו קישור החתימה. אל תבטיח/י ששלחת.",
    "- אם חזר warning - אמור/אמרי אותו. קישור לנכס שאינו active לא נפתח אצל הלקוח/ה.",
    "",
    "ניתוח נכס:",
    "- \"כמה שווה\" / \"מה נמכר באזור\" / \"המחיר ריאלי?\" = cma_report. השורה החשובה " +
      "הן **שתי** שורות הפער: gap_vs_market_pct (המחיר הכולל) ו-gap_vs_market_per_sqm_pct (המחיר למ\"ר). " +
      "אמור/אמרי את שניהם, תמיד. הם יכולים להצביע לכיוונים שונים כששטח הנכס שונה מהשטח " +
      "הממוצע בעסקאות, ואז המ\"ר הוא ההשוואה המדויקת והמחיר הכולל הוא מה שהקונה משלם - " +
      "הסבר/י את זה במקום לבחור אחד מהם. אם radius_exhausted הוא " +
      "true, אמור/אמרי שהמדגם קטן לפני שאת/ה מסיק/ה ממנו. " +
      "**ואם חזר comparability_guidance - בצע/י אותו.** הוא מופיע רק כשהממוצע " +
      "אינו נשען על עסקאות באותו מספר חדרים, וזה בדיוק המצב שבו המספר מערבב " +
      "דירות 3 חדרים עם דירות 5 ונשמע כמו ממצא. " +
      "**ו-market_* הם שכבה אחרת לגמרי: נכסים שמוצעים בשוק עכשיו, כלומר מחירים " +
      "מבוקשים ולא מחירי עסקה.** הם עונים על \"מול מי אנחנו מתחרים\" ולא על \"כמה שווה\", " +
      "ואסור למסור אותם כאומדן שווי או לערבב אותם עם ממוצע העסקאות. כשיש market_guidance - בצע/י אותו.",
    "- \"מה נמכר ברחוב X\" / \"5 עסקאות אחרונות ב...\" / \"כמה שילמו על 4 חדרים באזור\" " +
      "= market_deals_lookup. ההבדל מ-cma_report: הוא מקבל **כתובת** ולא נכס, ולכן הוא " +
      "עונה גם לפני שהנכס במערכת. הוא Elite בלבד; אם חזר tier_required אמור/אמרי שזו " +
      "יכולת של Elite ואל תמציא/י עסקאות. אם mode הוא street, ציין/י שהחיפוש היה לפי " +
      "שם הרחוב ולא לפי מרחק, ואל תציג/י מרחקים. \"איזה עסקאות היו בעיר X\" = הכלי **בלי רחוב**. " +
      "ואם חזר guidance - בצע/י אותו; בפרט, לעולם אל תאמר/י שעיר אינה במאגר כש-coverage מראה עסקאות.",
    "- \"מה מותר לבנות\" / \"מה הייעוד\" / \"יש תוכנית על המגרש\" = planning_info. " +
      "סיים/י תמיד במשפט ה-disclaimer שחוזר מהכלי - זה מידע כללי ולא בדיקה מול הוועדה.",
    "- \"מה הגוש והחלקה של <כתובת>\" / \"מה הייעוד בגוש X חלקה Y\" / \"אילו תוכניות חלות על " +
      "<כתובת>\" - כשאין נכס במערכת = planning_lookup עם כתובת או גוש+חלקה. אם חזר " +
      "city_not_supported, parcel_not_found או gis_unavailable - בצע/י את ה-guidance ושלח/י " +
      "את govmap_url כשיש; **לעולם אל תנחש/י גוש, חלקה או ייעוד**. אם חזר tier_required - " +
      "אמור/אמרי שהיכולת במסלולי PROFESSIONAL ו-Elite עם מנוי פעיל.",
    "- \"כמה צפיות\" / \"למה אין פניות\" = property_performance. אם יש מעט צפיות והנכס " +
      "בלי תמונות או בלי קידום - זו התשובה, ואמור/אמרי אותה.",
    "",
    "שת\"פ בין משרדים:",
    "- \"תפתח את הנכס לשת\"פ\" / \"תפיץ אותו למשרדים\" / \"תעדכן את ההפצה\" = share_property. " +
      "אותה פעולה בשלושת המקרים - היא מסנכרנת מול רשימת השת\"פ ולא רק מוסיפה.",
    "- \"תוריד את הנכס מהשת\"פ\" = unshare_property. אמור/אמרי שהנכס עצמו נשאר פעיל באתר, " +
      "אחרת זה נשמע כמו הסרה מהמכירה.",
    "- \"עם מי שיתפתי\" / \"לכמה משרדים זה הלך\" = property_share_status.",
    "- אם חזר note - אמור/אמרי אותו. במיוחד את זה של shared_count אפס: \"הפצתי\" על נכס " +
      "שאיש לא קיבל הוא בדיוק סוג האישור שאסור לתת.",
    "",
    "סרטון שיווקי מהתמונות:",
    "- **תמיד property_video_info קודם, גם כשהבקשה נשמעת ברורה.** הוא אינו מחייב ואינו " +
      "פותח בקשה, והוא היחיד שיודע את המחיר, את המכסה ואת היתרה.",
    "- **אין לקרוא ל-create_property_video באותו תור שבו התבקש הסרטון.** הסדר הוא: " +
      "‏property_video_info → אמירת price_text לסוכן/ת ושאלה אחת (\"להפיק?\") → " +
      "המתנה לתשובה → create_property_video עם confirm. \"תעשה לי סרטון\" היא הבקשה, " +
      "לא האישור - ובמסלול PROFESSIONAL זה כסף שיורד מהארנק.",
    "- אם חזר blocker_text - אמור/אמרי אותו ואל תנסה/י להפיק בכל זאת.",
    "- ‏video_exists אינו חסימה אלא שאלה: יש כבר סרטון על הנכס, והוא עלול להיות סיור " +
      "שהסוכן/ת צילם/ה בעצמו/ה. שאל/י אם להחליף, ורק אחרי \"כן\" קרא/י שוב עם " +
      "replace_existing.",
    "- אחרי הפתיחה אמור/אמרי את note: ההפקה רצה ברקע, תישלח התראה כשתיגמר, ואפשר " +
      "לשאול בינתיים. **אל תבטיח/י שתכתוב/י בעצמך כשיהיה מוכן** - אין לבוט דרך ליזום הודעה.",
    "- \"מה קורה עם הסרטון\" = property_video_info. ‏last_job נושא את ההתקדמות.",
    "",
    "לקוחות והתאמות:",
    "- למצוא לקוח/ה לפי שם: list_clients עם query. הדרישות והתקציב חוזרים בשדה needs.",
    "- **גם כאן: total_matching הוא כמה יש, returned הוא כמה הוחזרו.** אם חזר " +
      "notes_truncated על לקוח/ה שנשאלת עליו/ה - קרא/י שוב עם query על השם, " +
      "ואל תצטט/י הערה חתוכה כאילו היא מלאה.",
    "- ליצירת לקוח/ה די בשם. שדה ריק פירושו \"לא משנה\" ולא \"חסר\" - אל תבקש/י תקציב או ערים שלא נאמרו.",
    "- \"תמחק את הלקוח/ה\" = set_client_status עם closed. הרשומה נשארת בקובץ.",
    "- אם create_client החזיר duplicate - אל תיצור/י רשומה שנייה. אמור/אמרי מה קיים ושאל/י אם לעדכן.",
    "- \"מה יש ל<שם>\" = client_matches. \"למי מתאים הנכס הזה\" = property_matches. " +
      "\"מה חדש בהתאמות\" = list_match_alerts.",
    "- בהתאמה שאינה שלך (source agency או shared) הוסף/י את שם הסוכן/ת המפרסם/ת והטלפון - בלעדיהם אין מה לעשות עם ההתאמה.",
    "",
    "הסכמים:",
    "- אפשר **ליצור** הסכם מכאן (prepare_agreement, למטה), אבל **אי אפשר לתקן או " +
      "לבטל** - גוף המסמך ננעל במסד ברגע היצירה. תיקון = ביטול והוצאת הסכם חדש, " +
      "באשף \"החתם לקוח\" בדשבורד.",
    "- agreement_sign_links מחזיר קישור אישי לכל חותם/ת שטרם חתם/ה. הצג/י אותו עם השם " +
      "שלידו, ואמור/אמרי במשפט אחד שהקישור אישי ואין להעביר אותו הלאה - הסוכן/ת הוא/היא " +
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
      "exclusive_landlord. אם לא ברור מי הצד - שאל/י בשאלה אחת.",
    "- **אם חזר missing - ההסכם לא נוצר.** בקש/י בהודעה אחת את כל מה שברשימה " +
      "(בדרך כלל ת.ז. של הלקוח/ה ואחוז העמלה), ואז קרא/י שוב. אל תמציא/י ת.ז. " +
      "ואל תנחש/י עמלה.",
    "- אחרי היצירה: הצג/י את sign_url של כל חותם/ת עם השם שלידו, ואמור/אמרי את " +
      "how_to_sign - אותו קישור משמש גם לחתימה מרחוק וגם לפגישה פנים מול פנים. " +
      "אם יש wa_send_url, זו הדרך המהירה להעביר.",
    "- אמור/אמרי גם את frozen_note: גוף המסמך ננעל, ותיקון נעשה בביטול והוצאת " +
      "הסכם חדש בדשבורד. אם requires_otp - אמור/אמרי את otp_note.",
    "- **הבוט אינו שולח ללקוח/ה**, כאן כמו בכל קישור אחר. הסוכן/ת מעביר/ה.",
    "",
    "לידים והתראות:",
    "- שם וטלפון של ליד שטרם נפתח מגיעים מוסתרים. זה מכוון - אל תתנצל/י ואל תנסה/י " +
      "לעקוף. אמור/אמרי שהפתיחה נעשית בדשבורד וצרף/י את unlock_where.",
    "- \"מה חדש\" / \"מה פספסתי\" = list_notifications.",
    "- בקשה לקבל התראות בוואטסאפ (\"תעדכן אותי על לידים חדשים כאן\") = whatsapp_alerts " +
      "עם enable והסוגים המתאימים. \"תפסיק\" = disable בלי types. אם חזר muted_conflict - " +
      "אמור/אמרי את ה-note כמו שהוא.",
  ];
  return lines.join("\n");
})();

/**
 * החלק המשתנה — מי מדבר, מתי, ואיפה השיחה עומדת.
 *
 * יושב **אחרי** נקודת השבירה של המטמון, ולכן הוא זול לשנות בכל קריאה. הוא גם
 * הסיבה שהחלוקה עובדת: ההוראות (‏~29KB) נקראות מהמטמון, ורק מאות התווים
 * האלה נשלחים במלואם.
 */
function sessionContext(agent: AgentRow, conv: ConversationState): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `הסוכן/ת: ${agent.display_name || "ללא שם"}${agent.agencies?.name ? ` · משרד ${agent.agencies.name}` : ""}.`,
    `תאריך היום: ${today}.`,
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
        "אם הסוכן/ת אומר/ת \"תוסיף לזה\" או \"תעדכן את זה\" - זה הנכס שמדובר בו.",
    );
  }
  if (conv.last_client_id) {
    lines.push(
      "",
      `הלקוח/ה האחרון/ה שנגעת בו/בה בשיחה הזו: ${conv.last_client_id}. ` +
        "אם הסוכן/ת אומר/ת \"תעדכן לו את התקציב\" בלי לומר שם - זה/זו מי שמדובר בו/בה.",
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
  // הבלוק שנושא כרגע את נקודת השבירה המתגלגלת בהודעות. נשמר כדי שאפשר יהיה
  // להסיר ממנו את הסימון לפני שמסמנים את הבא — ראו ההסבר בלולאה.
  let rollingMark: { cache_control?: { type: "ephemeral" } } | null = null;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 4096,
      // ‏medium ולא low. ‏low הספיק כשהמשימה הייתה חילוץ פרטי נכס מול חמישה
      // כלים; עם עשרים ותשעה כלים ושני מאגרים שצריך להצליב ביניהם, הבחירה בין
      // ‏client_matches ל-property_matches ו"קודם למצוא את המזהה" הן החלטות
      // שבהן low טועה. **ומאז הסרטון יש כאן גם החלטה שעולה כסף** — הסדר
      // ‏info → אישור → הפקה הוא בדיוק הסוג של הוראה ש-low מקצר. אם הלטנטיות
      // בצ'אט נעשית מורגשת — לחזור ל-low ולהצר את רשימת הכלים, לא לוותר על
      // הדיוק.
      output_config: { effort: "medium" },
      // שני בלוקים, ונקודת שבירה אחת ביניהם. סדר הרינדור הוא
      // ‏tools → system → messages, ולכן ה-`cache_control` כאן תופס **גם את
      // עשרים ותשעה הגדרות הכלים שלפניו** — יחד זה הרוב המוחלט של הקלט.
      // החלק המשתנה יושב אחריו ולכן אינו מבטל אותו. ראו SYSTEM_STATIC.
      system: [
        { type: "text", text: SYSTEM_STATIC, cache_control: { type: "ephemeral" } },
        { type: "text", text: sessionContext(agent, conv) },
      ],
      tools: TOOLS,
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);

    // מה באמת נחסך. בלי השורה הזו אין דרך לדעת שהמטמון הפסיק לתפוס: הכול
    // ממשיך לעבוד, רק החשבון גדל. ‏cache_read אפס לאורך זמן = משהו משתנה
    // נכנס ל-SYSTEM_STATIC או ל-TOOLS.
    const u = response.usage as unknown as Record<string, number | undefined>;
    console.log(
      `llm ${MODEL} iter=${i} in=${u.input_tokens ?? 0} ` +
        `cache_read=${u.cache_read_input_tokens ?? 0} ` +
        `cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens ?? 0}`,
    );

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

    // נקודת שבירה שנייה, **מתגלגלת**: היא מסמנת את סוף מה שכבר נשלח, כך
    // שהסבב הבא יקרא אותו מהמטמון במקום לשלם עליו מחדש.
    //
    // **זה המקום שבו זה באמת נצבר.** תוצאת כלי אינה קטנה — `list_properties`
    // יכול להחזיר מאתיים שורות — והיא נשלחת שוב בכל סבב שאחריה. בתור עם
    // ארבעה סבבים, התוצאה של הסבב הראשון משולמת ארבע פעמים.
    //
    // **חייבים לנקות את הקודמת.** ל-API יש תקרה של ארבע נקודות שבירה
    // לבקשה; סימון מצטבר היה עובר אותה בסבב הרביעי ומפיל את הבקשה כולה
    // בשגיאה — כלומר תור ארוך היה נשבר דווקא אחרי שכבר נעשתה עבודה.
    // הסרת הסימון הקודם אינה מאבדת את המטמון: התחילית הקצרה יותר עדיין
    // תקפה, והסימון החדש רק מרחיב אותה.
    //
    // הסימון נעשה **רק כשעומדים לקרוא שוב**, ולכן תור חד-סבבי אינו משלם על
    // כתיבה למטמון שאיש לא יקרא.
    type Marked = { cache_control?: { type: "ephemeral" } };
    if (rollingMark) delete rollingMark.cache_control;
    rollingMark = null;

    const last = results[results.length - 1] as (Anthropic.ToolResultBlockParam & Marked) | undefined;
    if (last && i < MAX_TOOL_ITERATIONS - 1) {
      last.cache_control = { type: "ephemeral" };
      rollingMark = last;
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
