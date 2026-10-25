// ============================================================================
// csm-tools.ts — גבריאלה לצוות ההטמעה (docs/csm-adoption.md, "בוואטסאפ")
//
// אשת צוות ההטמעה כותבת לגבריאלה מאותו מספר, ומזוהה לפי הטלפון ב-csm_staff
// (‏csm-chat.ts). היא **אינה סוכנת**: התור שלה נפרד לגמרי מזה של הסוכנים, עם
// הכלים האלה בלבד - מי בסיכון, פרטי סוכן/ת או משרד, העברת שלב, רישום פגישה,
// בקשת פיתוח, הקלטות שיחה ושאלה למנטור ההטמעה. אין כאן נכסים, לקוחות, לידים
// או ניהול פלטפורמה.
//
// הנתונים מ-csm_agents_overview (אותה פונקציה של האזור ב-/csm), דרך service_role.
// ============================================================================
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { csmLinkCatalog, csmLinkFor, csmLinkIsPublic, csmOutreachText, ilMobileDigits, waComposeUrl } from "./csm-links.ts";

type Row = Record<string, unknown>;

const STAGES: Record<string, string> = {
  registered: "נרשם/ה - לא פעיל/ה",
  call_scheduled: "נקבעה פגישה",
  onboarded: "עבר/ה הדרכה וביצע/ה פעולה ראשונה",
  active_pilot: "בפיילוט פעיל",
  champion: "משתמש/ת עצמאי/ת",
  at_risk: "נשירה - דורש/ת חיזוק",
};
const STAGE_ORDER = Object.keys(STAGES);
const WINS = ["connect", "property", "client", "match", "post", "mentor", "reminder"];
const NOTIFY_KINDS = ["new_agent", "at_risk", "meeting_reminder", "call_ready", "daily_digest"];
const AGENDA_KINDS: Record<string, string> = {
  first_win: "פגישת הצלחה ראשונה",
  followup: "פגישת מעקב",
  call: "שיחה",
  office_visit: "ביקור במשרד",
  training: "הדרכה",
  other: "פגישה",
};
const AGENDA_STATUS: Record<string, string> = {
  scheduled: "מתוכננת", done: "התקיימה", cancelled: "בוטלה", no_show: "לא הגיע/ה",
};
const SETTINGS_KEYS = ["display_name", "notify_whatsapp", "notify_off", "digest_time", "work_days",
  "quiet_from", "quiet_to", "meeting_minutes", "reminder_minutes", "meeting_link"];
const SETTINGS_ERRORS: Record<string, string> = {
  bad_name: "השם ריק או ארוך מדי.",
  bad_time: "שעה צריכה להיות בפורמט HH:MM.",
  bad_days: "ימי העבודה הם מספרים מ-0 (ראשון) עד 6 (שבת).",
  bad_minutes: "מספר הדקות מחוץ לטווח.",
  bad_link: "הקישור צריך להתחיל ב-https://.",
  bad_notify_off: "רשימת הסוגים אינה תקינה.",
  phone_web_only: "את הנייד משנים באזור ההטמעה, בלשונית \"הגדרות\".",
  not_found: "לא מצאתי את הפרופיל שלך.",
};


export const CSM_TOOLS: Anthropic.Tool[] = [
  {
    name: "csm_overview",
    description:
      "צוות ההטמעה בלבד. תמונת המצב של הטמעת הסוכנים: כמה בכל שלב, מי בסיכון (5 ימים ומעלה בלי הודעה לגבריאלה), " +
      "ומי שמועד הקשר שלו/ה הגיע. לשאלות כמו \"מי בסיכון?\", \"למי לחזור היום?\", \"מה המצב?\".",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "csm_find_agent",
    description:
      "צוות ההטמעה בלבד. כרטיס מלא של סוכן/ת לפי שם, טלפון או שם משרד: טלפון, מייל, משרד וכתובתו, מסלול, " +
      "השלב בצנרת, ורמת השימוש (הודעות לגבריאלה, נכסים, לקוחות, משימות, שאלות למנטור, כניסה אחרונה). " +
      "מחזיר גם agent_id לשימוש בכלים csm_set_stage / csm_log_session / csm_add_feedback.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "שם, חלק משם, טלפון או שם משרד" } },
      required: ["query"],
    },
  },
  {
    name: "csm_office",
    description:
      "צוות ההטמעה בלבד. משרד תיווך לפי שם: כתובת ועיר, המנהלים, וכל הסוכנים עם טלפון, שלב ושימוש. " +
      "בלי query - רשימת כל המשרדים עם מספרים מצטברים, לתעדוף.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "שם המשרד או חלק ממנו. ריק = כל המשרדים" } },
    },
  },
  {
    name: "csm_set_stage",
    description:
      "צוות ההטמעה בלבד. העברת סוכן/ת לשלב בצנרת, ולפי הצורך מועד הקשר הבא והערה. " +
      "השלבים: registered (נרשם/ה), call_scheduled (נקבעה פגישה), onboarded (עבר/ה הדרכה), " +
      "active_pilot (פיילוט פעיל), champion (עצמאי/ת), at_risk (נשירה). קודם csm_find_agent למזהה.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        stage: { type: "string", enum: STAGE_ORDER },
        followup_date: { type: "string", description: "YYYY-MM-DD, מועד הקשר הבא" },
        note: { type: "string" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "csm_log_session",
    description:
      "צוות ההטמעה בלבד. רישום פגישת הדרכה או שיחת מעקב עם סוכן/ת: אילו פעולות בוצעו בהצלחה " +
      "(connect=שמירת המספר והודעת שלום, property=נכס, client=לקוח/ה, match=התאמה, post=פוסט שיווקי, " +
      "mentor=שאלה למנטור, reminder=תזכורת), דירוג 1-5, יעד שבועי, מועד קשר והערות. " +
      "פעולה אחת לפחות מעבירה ל\"עבר/ה הדרכה\". לסכם לה מה נרשם לפני הקריאה אם משהו לא ברור.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        done: { type: "array", items: { type: "string", enum: WINS } },
        clarity: { type: "integer", minimum: 1, maximum: 5, description: "האם המערכת ברורה" },
        time_saving: { type: "integer", minimum: 1, maximum: 5, description: "האם רואה/ה חיסכון בזמן" },
        weekly_goal: { type: "string" },
        followup_date: { type: "string", description: "YYYY-MM-DD" },
        notes: { type: "string" },
        dev_notes: { type: "string", description: "קושי בניסוח, שדה חסר, באג" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "csm_add_feedback",
    description:
      "צוות ההטמעה בלבד. בקשת פיתוח או חיכוך שסוכן/ת העלה/תה. בקשה עם אותה כותרת מקבלת את הסוכן/ת כקול נוסף " +
      "(\"ביקשו 3\") ולא שורה כפולה - לכן כותרת קצרה ועניינית.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "הבקשה במשפט אחד" },
        agent_id: { type: "string", description: "מי ביקש/ה (מ-csm_find_agent). לא חובה" },
        category: { type: "string", enum: ["pilot_blocker", "daily_efficiency", "office_management"] },
        severity: { type: "string", enum: ["blocker", "usability", "enhancement"] },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "csm_ask_mentor",
    description:
      "שאלה למנטור ההטמעה: עם איזה משרדים להתחיל, איך לגשת למשרד או למנהל/ת, מה לענות על התנגדות, " +
      "איך להחזיר סוכן/ת שנשר/ה. המנטור רואה את כל התיק. להעביר את השאלה כמו שנשאלה.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "csm_recent_calls",
    description:
      "הקלטות השיחה האחרונות שנותחו (מהאזור או מוואטסאפ): מתי, עם מי, סטטוס, ותקציר. " +
      "עם call_id - הניתוח המלא של שיחה אחת (סיכום, התחייבויות, המלצות, צעדים, הודעה מוצעת).",
    input_schema: {
      type: "object",
      properties: { call_id: { type: "string" } },
    },
  },
  {
    name: "csm_link_call",
    description:
      "שיוך הקלטת שיחה לסוכן/ת (\"זו הייתה שיחה עם יוסי\"). קודם csm_find_agent למזהה. " +
      "apply_followup=true מעדכן גם את מועד הקשר והשלב המוצע מהניתוח.",
    input_schema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        agent_id: { type: "string" },
        apply_followup: { type: "boolean" },
      },
      required: ["call_id", "agent_id"],
    },
  },
  {
    name: "csm_agenda_list",
    description:
      "היומן שלה: הפגישות שקבעה (עם event_id), ומי שמועד הקשר שלו/ה בצנרת נופל בטווח ואין לו/ה פגישה. " +
      "בלי תאריך - שבעה ימים מהיום. לשאלות כמו \"מה יש לי היום?\", \"מה השבוע?\", \"מתי הפגישה עם יוסי?\".",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, היום הראשון בטווח (שעון ישראל). ריק = היום" },
        days: { type: "integer", minimum: 1, maximum: 31, description: "כמה ימים. ברירת מחדל 1 כשיש תאריך, 7 בלעדיו" },
      },
    },
  },
  {
    name: "csm_agenda_add",
    description:
      "קביעת פגישה ביומן שלה. kind: first_win (פגישת הצלחה ראשונה), followup (פגישת מעקב), call (שיחה), " +
      "office_visit (ביקור במשרד), training (הדרכה קבוצתית), other. פגישה עם סוכן/ת \"נרשם/ה\" מעבירה ל\"נקבעה פגישה\" " +
      "ומועד הקשר בצנרת הופך למועד הפגישה. קודם csm_find_agent למזהה. התזכורת יוצאת לבד לפני הפגישה. " +
      "מחזיר קישור \"הוספה ליומן Google\" - לצרף אותו לתשובה.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "מ-csm_find_agent. לא חובה (הדרכה קבוצתית, משרד שעוד לא נרשם)" },
        kind: { type: "string", enum: ["first_win", "followup", "call", "office_visit", "training", "other"] },
        title: { type: "string", description: "ריק = לפי הסוג והשם" },
        date: { type: "string", description: "YYYY-MM-DD, שעון ישראל" },
        time: { type: "string", description: "HH:MM, שעון ישראל" },
        duration_minutes: { type: "integer", minimum: 5, maximum: 600, description: "ריק = ברירת המחדל שלה" },
        location: { type: "string", description: "כתובת, או \"טלפון\" / \"זום\"" },
        meeting_url: { type: "string", description: "קישור לפגישה בווידאו" },
        use_my_link: { type: "boolean", description: "true = הקישור הקבוע שלה מההגדרות" },
        reminder_minutes: { type: "integer", minimum: 0, maximum: 1440, description: "ריק = ברירת המחדל שלה; 0 = בלי תזכורת" },
        notes: { type: "string" },
      },
      required: ["date", "time"],
    },
  },
  {
    name: "csm_agenda_update",
    description:
      "שינוי פגישה ביומן לפי event_id (מ-csm_agenda_list): הזזה (date/time), אורך, מקום, קישור, הערה, או סטטוס - " +
      "done (התקיימה), cancelled (בוטלה), no_show (לא הגיע/ה), scheduled (החזרה). אחרי done עם סוכן/ת - להציע לרשום " +
      "אותה ב-csm_log_session.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM" },
        duration_minutes: { type: "integer", minimum: 5, maximum: 600 },
        status: { type: "string", enum: ["scheduled", "done", "cancelled", "no_show"] },
        title: { type: "string" },
        location: { type: "string" },
        meeting_url: { type: "string" },
        notes: { type: "string" },
      },
      required: ["event_id"],
    },
  },
  {
    name: "csm_notifications",
    description:
      "ההתראות שלה (הפעמון באזור ההטמעה): סוכן/ת חדש/ה, מי שעבר/ה 5 ימים בלי גבריאלה, תזכורות לפגישות, הקלטה " +
      "שהסתיימה וסיכום הבוקר. מחזיר את שלא נקראו. mark_read=true מסמן הכול כנקרא.",
    input_schema: {
      type: "object",
      properties: { mark_read: { type: "boolean" } },
    },
  },
  {
    name: "csm_settings",
    description:
      "ההגדרות שלה. בלי שדות - מה מוגדר עכשיו. עם שדות - עדכון: display_name, notify_whatsapp (התראות בוואטסאפ), " +
      "notify_off (סוגים לכבות: new_agent, at_risk, meeting_reminder, call_ready, daily_digest - הרשימה המלאה של מה שכבוי), " +
      "digest_time (שעת סיכום הבוקר HH:MM), work_days (0=ראשון עד 6=שבת), quiet_from / quiet_to (שעות בלי וואטסאפ, " +
      "חוץ מתזכורת לפגישה), meeting_minutes (אורך פגישה), reminder_minutes (כמה דקות לפני), meeting_link (קישור קבוע " +
      "לפגישות וידאו, https). הנייד והמייל - רק באזור ההטמעה.",
    input_schema: {
      type: "object",
      properties: {
        display_name: { type: "string" },
        notify_whatsapp: { type: "boolean" },
        notify_off: { type: "array", items: { type: "string", enum: NOTIFY_KINDS } },
        digest_time: { type: "string" },
        work_days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } },
        quiet_from: { type: "string" },
        quiet_to: { type: "string" },
        meeting_minutes: { type: "integer", minimum: 10, maximum: 240 },
        reminder_minutes: { type: "integer", minimum: 0, maximum: 1440 },
        meeting_link: { type: "string" },
      },
    },
  },
  {
    name: "csm_links",
    description:
      "הקישורים לאתר ול-CRM שאפשר לתת לסוכן/ת: מסך ב-CRM (נכסים, לקוחות, לידים, יומן, הסכמים, פרופיל, הגדרות, " +
      "ארנק, יומן Google, ולמנהלים - צוות, דאשבורד המשרד ודף המשרד), דפי האתר (מסלולים, רכישה, הרשמה, שאלות נפוצות, " +
      "מחירים ועסקאות), הדף האישי של הסוכן/ת ושל המשרד, וצ'אט עם גבריאלה. עם agent_id - הכתובות המלאות לסוכן/ת הזה/ו. " +
      "רשימה סגורה: קישור שאינו כאן לא נשלח.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "לכתובות האישיות (הדף שלו/ה, דף המשרד). לא חובה" },
        key: { type: "string", description: "קישור אחד לפי המפתח מהרשימה. ריק = כל הרשימה" },
      },
    },
  },
  {
    name: "csm_send_to_agent",
    description:
      "שליחת הודעה עם קישור אחד מ-csm_links (למשל המסלולים - pricing) - לסוכן/ת במערכת (agent_id), או למי שעוד " +
      "לא במערכת, כמו משרד שמגייסים (phone + name). " +
      "לסוכן/ת: מהמספר של גבריאלה בשמה, **בשני שלבים** - בלי confirmed מחזיר את הנוסח, להראות לה ולשאול; " +
      "confirmed=true רק אחרי אישור מפורש לנוסח הזה. via=my_phone - במקום זה קישור שפותח את הוואטסאפ שלה עם ההודעה מוכנה. " +
      "למי שלא במערכת: תמיד קישור לשליחה מהטלפון שלה (Meta אינה מתירה לעסק לפתוח שיחה עם מי שלא פנה אליו), " +
      "ורק דפים ציבוריים - לא מסכי CRM.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "מ-csm_find_agent, לסוכן/ת במערכת" },
        phone: { type: "string", description: "נייד של מי שלא במערכת" },
        name: { type: "string", description: "השם של מי שלא במערכת, לפתיחת ההודעה" },
        message: { type: "string", description: "גוף ההודעה, בגוף ראשון שלה, קצר ובשפה של וואטסאפ" },
        link_key: { type: "string", description: "מפתח מ-csm_links. לא חובה" },
        via: { type: "string", enum: ["gabriela", "my_phone"], description: "לסוכן/ת. ברירת מחדל gabriela" },
        confirmed: { type: "boolean" },
      },
      required: ["message"],
    },
  },
];


/* ההיכרות ו"מה אפשר לעשות כאן": נוסח קבוע ולא מהמודל - כך הוא תמיד מדויק
   (רק מה שהכלים באמת עושים), מיידי וללא עלות. נשלח בהודעה הראשונה שלה
   (היסטוריה ריקה), וכל פעם שהיא שואלת מה אפשר לעשות. כלי חדש ב-CSM_TOOLS
   מקבל כאן שורה, באותו PR. */
export function csmCapabilities(name?: string | null, first = false): string {
  const hello = first
    ? `היי${name ? " " + name : ""}, אני גבריאלה - העוזרת של צוות ההטמעה בשוק נדל"ן. כאן את עובדת מול הסוכנים והמשרדים בפיילוט.\n\n`
    : "";
  return hello + [
    "*מה אפשר לעשות כאן:*",
    "- *תמונת מצב* - \"מי בסיכון?\", \"למי לחזור היום?\"",
    "- *סוכן/ת או משרד* - טלפון, מייל, כתובת ורמת השימוש: \"תני לי את הפרטים של יוסי\", \"מה המצב במשרד נדל\"ן הצפון?\"",
    "- *לעדכן שלב ומועד קשר* - \"תעבירי את יוסי לפיילוט פעיל ונדבר ביום חמישי\"",
    "- *לרשום פגישה* - \"יוסי העלה נכס ופוסט, דירוג 5, היעד: 3 נכסים עד חמישי\"",
    "- *הקלטת שיחה* - שלחי לי קובץ הקלטה, ואחזיר תמלול, סיכום, המלצות והודעה מוכנה לסוכן/ת. שיחות למספר הווירטואלי שלך (אם יש) מגיעות אלייך לבד, עם ההקלטה",
    "- *בקשת פיתוח* - \"יוסי ביקש שדה מחסן בטופס הנכס\"",
    "- *המנטור* - \"שאלה למנטור: עם איזה משרדים להתחיל השבוע?\"",
    "- *היומן* - \"תקבעי לי פגישת הצלחה ראשונה עם יוסי ביום שלישי ב-10:00\", \"מה יש לי היום?\", \"תזיזי את הפגישה עם דנה לחמישי\"",
    "- *התראות* - תזכורת לפני כל פגישה, סוכן/ת חדש/ה, מי שעבר/ה 5 ימים בלי גבריאלה וסיכום בוקר: \"מה ההתראות שלי?\"",
    "- *הגדרות* - \"תכבי לי את סיכום הבוקר\", \"תזכורת שעה לפני כל פגישה\", \"בלי וואטסאפ אחרי 20:00\"",
    "- *קישורים לסוכנים* - \"מה הקישור למסלולים?\", \"תשלחי ליוסי את הקישור להוספת נכס ב-CRM\" (אראה לך את הנוסח לפני שאשלח), \"תכיני לי הודעה עם המסלולים למשרד אלון 052-1234567\" (קישור שנשלח מהטלפון שלך)",
    "",
    "אפשר לכתוב או לשלוח הודעה קולית. הכול נשמר גם באזור ההטמעה: https://shuknadlan.co.il/csm",
    "בכל רגע אפשר לכתוב \"מה אפשר לעשות כאן\" ואזכיר.",
  ].join("\n");
}

// "מה אני יכולה לעשות כאן", "עזרה", "תפריט" - תשובה קבועה, בלי מודל
export function isCapabilitiesQuestion(text: string): boolean {
  const t = String(text || "").trim();
  return t.length <= 60 && /^(מה\s+(אני\s+)?(יכולה|אפשר|אוכל)\s+(לעשות|לבקש)(\s+(כאן|פה|איתך|בשיחה))?|מה\s+את\s+(יודעת|יכולה)(\s+לעשות)?|עזרה|תפריט|help|menu)[\s?!.]*$/i.test(t);
}
export const CSM_GREETING = /^(היי|הי|הַי|שלום|אהלן|בוקר טוב|צהריים טובים|ערב טוב|hi|hello)[\s!.,?]*$/i;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const days = (v: unknown) => (v ? Math.floor((Date.now() - new Date(String(v)).getTime()) / 86400000) : null);
const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

function waDigits(phone: unknown): string {
  const d = digits(phone);
  return d.startsWith("0") ? "972" + d.slice(1) : d;
}

// מועד קשר: 10:00 בבוקר בישראל ביום שנבחר
function followupIso(date: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T10:00:00+03:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* "2026-10-04" + "10:00" בשעון ישראל → ISO ב-UTC, עם שעון קיץ/חורף. עותק של
   ilLocalToIso ב-agent.ts: הקובץ הזה לא מייבא מהעוזרת של הסוכנים
   (office_coach_test). */
function ilOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs) / 60000);
}
export function ilLocalToIso(date: unknown, time: unknown): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - ilOffsetMinutes(naive) * 60000;
  utc = naive - ilOffsetMinutes(utc) * 60000;
  return new Date(utc).toISOString();
}
const ilDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const ilTime = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
const ilWhen = (iso: unknown) =>
  new Date(String(iso)).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

/* "הוספה ליומן Google" - קישור תבנית, בלי OAuth ובלי גישה ליומן שלה. אותו
   מבנה של csmGcalUrl ב-assets/crm-csm.js. */
export function gcalTemplateUrl(e: { title: string; starts_at: string; duration_minutes: number; details?: string; location?: string }): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(e.starts_at).getTime();
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: fmt(start) + "/" + fmt(start + e.duration_minutes * 60000),
    ctz: "Asia/Jerusalem",
  });
  if (e.details) q.set("details", e.details.slice(0, 1200));
  if (e.location) q.set("location", e.location);
  return "https://calendar.google.com/calendar/render?" + q.toString();
}

function agentCard(r: Row) {
  return {
    agent_id: r.agent_id,
    name: r.display_name,
    phone: r.phone,
    whatsapp: r.phone ? "https://wa.me/" + waDigits(r.phone) : null,
    email: r.email,
    office: r.agency_name,
    office_address: [r.agency_address, r.agency_city].filter(Boolean).join(", ") || null,
    role: r.role === "manager" ? "מנהל/ת משרד" : "סוכן/ת",
    tier: r.tier,
    stage: STAGES[String(r.stage)] || r.stage,
    joined_days_ago: days(r.joined_at),
    last_login_days_ago: days(r.last_login_at),
    days_since_gabriela: days(r.last_gabriela_at),
    gabriela_messages_7d: num(r.gabriela_7d),
    gabriela_messages_30d: num(r.gabriela_30d),
    active_listings: num(r.active_listings),
    listings_total: num(r.listings_total),
    clients: num(r.clients),
    open_tasks: num(r.open_tasks),
    mentor_questions_30d: num(r.mentor_30d),
    sessions: num(r.sessions),
    last_session_days_ago: days(r.last_session_at),
    weekly_goal: r.last_weekly_goal || null,
    next_followup: r.next_followup_at ? String(r.next_followup_at).slice(0, 10) : null,
    notes: r.stage_notes || null,
  };
}

const short = (r: Row) => ({
  agent_id: r.agent_id, name: r.display_name, office: r.agency_name, phone: r.phone,
  stage: STAGES[String(r.stage)] || r.stage, days_since_gabriela: days(r.last_gabriela_at),
});

async function overviewRows(supabase: SupabaseClient): Promise<Row[]> {
  const { data, error } = await supabase.rpc("csm_agents_overview");
  if (error) throw new Error(error.message);
  return (data as Row[]) ?? [];
}

function atRisk(r: Row) {
  return r.stage !== "champion" && (days(r.joined_at) ?? 0) >= 5 && (days(r.last_gabriela_at) ?? 999) >= 5;
}

/* ‏staff: השורה ב-csm_staff שזוהתה לפי הטלפון (csm-chat.ts). ‏askMentor ו-
   ‏busyCheck מוזרקים כדי שהקובץ לא ייבא את המנטור (npm:) ואת יומן Google
   (‏Deno.env) בבדיקות שרצות ב-node. ‏busyCheck מחזיר את הזמנים התפוסים ביומן
   הראשי שלה ב-Google, או null כשאין חיבור עם הרשאת פנוי/תפוס. */
export type BusyCheck = (fromIso: string, toIso: string) => Promise<Array<{ start: string; end: string }> | null>;

/* ‏sendToAgent: השליחה עצמה (whatsapp.ts), מוזרקת מאותה סיבה. ‏inWindow קובע
   טקסט מלא או תבנית; ‏path הוא סיומת הכפתור של התבנית. */
export type SendToAgent = (a: {
  agentId: string; phone: string; firstName: string; text: string; path: string | null; inWindow: boolean;
}) => Promise<{ ok: boolean; waMessageId?: string | null; error?: string }>;

// הגנה על דירוג האיכות של המספר אצל Meta: הרבה הודעות יזומות ביום מאותו
// מספר הן מה שמוריד אותו. 40 ביום לאשת צוות הן הרבה מעבר לעבודה רגילה.
const OUTREACH_DAILY_CAP = 40;

export async function runCsmTool(
  supabase: SupabaseClient, staff: { id: string; display_name?: string | null }, name: string, input: Record<string, unknown>,
  askMentor?: (q: unknown) => Promise<unknown>,
  busyCheck?: BusyCheck,
  sendToAgent?: SendToAgent,
): Promise<unknown> {
  if (!staff?.id) return { ok: false, error: "הכלי פתוח לצוות ההטמעה בלבד." };

  if (name === "csm_ask_mentor") {
    return askMentor ? await askMentor(input.question) : { ok: false, error: "המנטור לא זמין כרגע." };
  }

  if (name === "csm_links" || name === "csm_send_to_agent") {
    const agentId = input.agent_id ? String(input.agent_id) : null;
    let ctx: { agent_slug?: string | null; agency_slug?: string | null; role?: string | null } = {};
    let target: Row | null = null;
    if (agentId) {
      const rows = await overviewRows(supabase);
      target = rows.find((r) => r.agent_id === agentId) ?? null;
      if (!target) return { ok: false, error: "agent_id לא נמצא. קודם csm_find_agent." };
      // שתי שאילתות ולא embed: ל-agency_members יש יותר ממפתח זר אחד ל-agencies,
      // ו-embed נכשל ב-PGRST201 (scripts/check_agency_embed.py)
      const { data: m } = await supabase.from("agency_members")
        .select("slug, phone_e164, agency_id").eq("id", agentId).maybeSingle();
      const { data: ag } = m?.agency_id
        ? await supabase.from("agencies").select("slug").eq("id", m.agency_id).maybeSingle()
        : { data: null };
      ctx = { agent_slug: m?.slug ?? null, agency_slug: ag?.slug ?? null, role: String(target.role || "") };
      target = { ...target, phone_e164: m?.phone_e164 ?? null };
    }

    if (name === "csm_links") {
      if (input.key) {
        const l = csmLinkFor(String(input.key), ctx);
        if (!l) return { ok: false, error: agentId ? "אין קישור כזה לסוכן/ת הזה/ו (מפתח לא מוכר, או שאין לו/ה דף באתר עדיין)." : "מפתח לא מוכר, או קישור אישי שצריך agent_id." };
        return { ok: true, link: l };
      }
      return {
        ok: true,
        links: csmLinkCatalog().map((l) => {
          const full = csmLinkFor(l.key, ctx);
          return { ...l, url: full?.url ?? null };
        }),
        note: "url ריק = קישור אישי שצריך agent_id, או שאין לסוכן/ת דף באתר. manager_only - מסך שרק מנהל/ת משרד רואה.",
      };
    }

    // csm_send_to_agent
    const message = String(input.message ?? "").trim();
    if (message.length < 2 || message.length > 900) return { ok: false, error: "ההודעה צריכה להיות בין 2 ל-900 תווים." };

    // מי שעוד לא במערכת (משרד שמגייסים): נייד שאינו של סוכן/ת. רק קישור לשליחה
    // מהטלפון שלה - לעסק אסור לפתוח שיחה בוואטסאפ עם מי שלא פנה אליו, ופנייה
    // קרה מהמספר של גבריאלה הייתה פוגעת בדירוג שלו אצל כל הסוכנים.
    if (!target && input.phone) {
      const digits = ilMobileDigits(input.phone);
      if (!digits) return { ok: false, error: "זה לא נראה כמו נייד ישראלי. אפשר לבדוק את המספר?" };
      const rows = await overviewRows(supabase);
      const isAgent = rows.find((r) => String(r.phone ?? "").replace(/\D/g, "").replace(/^0/, "972") === digits);
      if (isAgent) {
        return { ok: false, error: `המספר הזה של ${isAgent.display_name} שכבר במערכת - לשלוח עם agent_id=${isAgent.agent_id}.` };
      }
      const link = input.link_key ? csmLinkFor(String(input.link_key)) : null;
      if (input.link_key && !link) return { ok: false, error: "הקישור לא ברשימה (csm_links)." };
      if (link && !csmLinkIsPublic(link.key)) {
        return { ok: false, error: "זה מסך ב-CRM, ומי שעוד לא במערכת יראה רק מסך כניסה. לשלוח דף ציבורי - למשל pricing או signup." };
      }
      const name = String(input.name ?? "").trim().slice(0, 60);
      const text = csmOutreachText(null, (name && !message.includes(name) ? `היי ${name}, ` : "") + message, link, true);
      await supabase.from("csm_messages").insert({
        staff_id: staff.id, agent_id: null, link_key: link?.key ?? null, url: link?.url ?? null,
        body: text, channel: "compose", to_phone: digits, to_name: name || null,
      });
      return {
        ok: true, compose_url: waComposeUrl(digits, text), text,
        note: "לתת לה את compose_url כמו שהוא, עם משפט: לחיצה פותחת את הוואטסאפ שלך עם ההודעה מוכנה ל" + (name || "מספר הזה") +
          ", ושולחים משם. לא נשלח כלום מהמספר של גבריאלה.",
      };
    }

    if (!target) return { ok: false, error: "חסר agent_id (סוכן/ת במערכת) או phone (מי שעוד לא במערכת)." };
    if (!target.phone_e164) return { ok: false, error: "אין לסוכן/ת נייד בכרטיס, ולכן אי אפשר לשלוח בוואטסאפ." };
    const link = input.link_key ? csmLinkFor(String(input.link_key), ctx) : null;
    if (input.link_key && !link) return { ok: false, error: "הקישור לא ברשימה (csm_links), או שאין לסוכן/ת דף כזה." };
    if (link && csmLinkCatalog().find((l) => l.key === link.key)?.manager_only && target.role !== "manager") {
      return { ok: false, error: "זה מסך של מנהל/ת משרד, והסוכן/ת הזה/ו אינו/ה מנהל/ת - לא יראה אותו." };
    }
    if (input.via === "my_phone") {
      const own = csmOutreachText(null, message, link, true);
      await supabase.from("csm_messages").insert({
        staff_id: staff.id, agent_id: target.agent_id, link_key: link?.key ?? null, url: link?.url ?? null,
        body: own, channel: "compose", to_phone: String(target.phone_e164),
      });
      return { ok: true, compose_url: waComposeUrl(String(target.phone_e164), own), text: own,
        note: "לתת לה את compose_url: לחיצה פותחת את הוואטסאפ שלה עם ההודעה מוכנה, ושולחים משם." };
    }
    const text = csmOutreachText(staff.display_name ?? null, message, link);
    const { data: conv } = await supabase.from("whatsapp_conversations")
      .select("last_message_at").eq("agent_id", target.agent_id).maybeSingle();
    const inWindow = !!conv?.last_message_at && Date.now() - new Date(String(conv.last_message_at)).getTime() < 23 * 3600000;

    if (input.confirmed !== true) {
      return {
        ok: true, preview: text, to: target.display_name, will_send_as: inWindow ? "הודעה מלאה" : "הודעת תבנית קצרה עם כפתור לקישור (הסוכן/ת לא כתב/ה לגבריאלה ב-24 השעות האחרונות)",
        note: "להציג לה את הנוסח כמו שהוא ולשאול אם לשלוח. לשלוח (confirmed=true) רק אחרי אישור מפורש שלה לנוסח הזה.",
      };
    }
    if (!sendToAgent) return { ok: false, error: "השליחה לא זמינה כרגע." };
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await supabase.from("csm_messages").select("id", { count: "exact", head: true })
      .eq("staff_id", staff.id).in("channel", ["text", "template"]).gte("created_at", since);
    if ((count ?? 0) >= OUTREACH_DAILY_CAP) {
      return { ok: false, error: `נשלחו כבר ${count} הודעות ב-24 השעות האחרונות - זו התקרה, כדי לשמור על המספר של גבריאלה. אפשר לשלוח מהנייד שלך.` };
    }
    const first = String(target.display_name || "").trim().split(/\s+/)[0] || "שלום";
    const res = await sendToAgent({
      agentId: String(target.agent_id), phone: String(target.phone_e164), firstName: first,
      text, path: link?.path ?? null, inWindow,
    });
    await supabase.from("csm_messages").insert({
      staff_id: staff.id, agent_id: target.agent_id, link_key: link?.key ?? null, url: link?.url ?? null,
      body: text, channel: inWindow ? "text" : "template", wa_message_id: res.waMessageId ?? null,
      error: res.ok ? null : (res.error || "send_failed").slice(0, 500),
    });
    if (!res.ok) return { ok: false, error: "השליחה נכשלה: " + (res.error || "שגיאה לא ידועה") };
    return { ok: true, sent_to: target.display_name, channel: inWindow ? "הודעה מלאה" : "תבנית עם כפתור" };
  }

  if (name === "csm_settings") {
    const patch: Row = {};
    for (const k of SETTINGS_KEYS) if (input[k] !== undefined && input[k] !== null) patch[k] = input[k];
    const { data, error } = await supabase.rpc("csm_profile_apply", { p_staff_id: staff.id, p: patch, p_allow_phone: false });
    if (error) return { ok: false, error: error.message };
    const res = (data ?? {}) as Row;
    if (res.error) return { ok: false, error: SETTINGS_ERRORS[String(res.error)] || String(res.error) };
    return { ok: true, updated: Object.keys(patch), settings: res.profile,
      note: "work_days: 0=ראשון עד 6=שבת. notify_off = הסוגים הכבויים. לומר במשפט מה השתנה." };
  }

  if (name === "csm_notifications") {
    const { data, error, count } = await supabase.from("csm_notifications")
      .select("id, kind, title, body, created_at", { count: "exact" })
      .eq("staff_id", staff.id).is("read_at", null)
      .order("created_at", { ascending: false }).limit(10);
    if (error) return { ok: false, error: error.message };
    if (input.mark_read) {
      const { error: e2 } = await supabase.from("csm_notifications")
        .update({ read_at: new Date().toISOString() }).eq("staff_id", staff.id).is("read_at", null);
      if (e2) return { ok: false, error: e2.message };
    }
    return {
      ok: true, unread: count ?? 0, marked_read: !!input.mark_read,
      notifications: ((data as Row[] | null) ?? []).map((n) => ({
        kind: n.kind, title: n.title, body: n.body, when: ilWhen(n.created_at),
      })),
    };
  }

  if (name === "csm_agenda_list") {
    const today = ilDate(Date.now());
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? "")) ? String(input.date) : today;
    const span = Math.min(31, Math.max(1, Number(input.days) || (input.date ? 1 : 7)));
    const startIso = ilLocalToIso(from, "00:00");
    if (!startIso) return { ok: false, error: "תאריך לא תקין." };
    const endIso = new Date(new Date(startIso).getTime() + span * 86400000).toISOString();
    const [{ data, error }, rows] = await Promise.all([
      supabase.from("csm_agenda")
        .select("id, agent_id, kind, title, starts_at, duration_minutes, location, meeting_url, notes, status")
        .eq("staff_id", staff.id).gte("starts_at", startIso).lt("starts_at", endIso)
        .order("starts_at").limit(60),
      overviewRows(supabase),
    ]);
    if (error) return { ok: false, error: error.message };
    const byId = new Map(rows.map((r) => [r.agent_id, r]));
    const events = (data as Row[] | null) ?? [];
    const withEvent = new Set(events.filter((e) => e.status === "scheduled").map((e) => e.agent_id));
    return {
      ok: true, from, days: span,
      events: events.map((e) => {
        const a = e.agent_id ? byId.get(e.agent_id) : null;
        return {
          event_id: e.id, when: ilWhen(e.starts_at), minutes: e.duration_minutes,
          kind: AGENDA_KINDS[String(e.kind)] || e.kind, title: e.title || null,
          status: AGENDA_STATUS[String(e.status)] || e.status,
          agent: a ? { agent_id: a.agent_id, name: a.display_name, office: a.agency_name, phone: a.phone } : null,
          location: e.location || null, meeting_url: e.meeting_url || null, notes: e.notes || null,
        };
      }),
      followups_without_meeting: rows
        .filter((r) => r.next_followup_at && !withEvent.has(r.agent_id) && r.stage !== "champion" &&
          new Date(String(r.next_followup_at)).getTime() < new Date(endIso).getTime())
        .slice(0, 15).map((r) => ({ ...short(r), followup: ilDate(new Date(String(r.next_followup_at)).getTime()) })),
      note: "להציג לפי יום ושעה. מועד קשר בלי פגישה - להציע לקבוע (csm_agenda_add) או להתקשר.",
    };
  }

  if (name === "csm_agenda_add" || name === "csm_agenda_update") {
    const { data: me } = await supabase.from("csm_staff")
      .select("meeting_minutes, reminder_minutes, meeting_link").eq("id", staff.id).maybeSingle();
    const rows = await overviewRows(supabase);
    const text = (v: unknown, max: number) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max) || null);
    const url = (v: unknown) => {
      const t = text(v, 500);
      return t === undefined || t === null ? t : /^https?:\/\//i.test(t) ? t : "bad";
    };
    let existing: Row | null = null;
    if (name === "csm_agenda_update") {
      const { data: ev } = await supabase.from("csm_agenda").select("*")
        .eq("id", String(input.event_id ?? "")).eq("staff_id", staff.id).maybeSingle();
      if (!ev) return { ok: false, error: "הפגישה לא נמצאה ביומן שלך. קודם csm_agenda_list." };
      existing = ev as Row;
    }
    const target = input.agent_id ? rows.find((r) => r.agent_id === String(input.agent_id)) : null;
    if (input.agent_id && !target) return { ok: false, error: "agent_id לא נמצא. קודם csm_find_agent." };

    const patch: Row = {};
    if (input.date !== undefined || input.time !== undefined) {
      const prev = existing ? new Date(String(existing.starts_at)).getTime() : null;
      const date = input.date ?? (prev != null ? ilDate(prev) : undefined);
      const time = input.time ?? (prev != null ? ilTime(prev) : undefined);
      const iso = ilLocalToIso(date, time);
      if (!iso) return { ok: false, error: "צריך תאריך YYYY-MM-DD ושעה HH:MM." };
      if (new Date(iso).getTime() < Date.now() - 5 * 60000 && (!existing || input.status !== "done")) {
        return { ok: false, error: "המועד כבר עבר. לאיזה יום ושעה לקבוע?" };
      }
      patch.starts_at = iso;
    }
    if (input.duration_minutes !== undefined) {
      const m = Number(input.duration_minutes);
      if (!Number.isInteger(m) || m < 5 || m > 600) return { ok: false, error: "אורך הפגישה בין 5 ל-600 דקות." };
      patch.duration_minutes = m;
    }
    for (const [k, max] of [["title", 200], ["location", 300], ["notes", 4000]] as const) {
      const t = text(input[k], max);
      if (t !== undefined) patch[k] = t;
    }
    const mu = input.use_my_link && me?.meeting_link ? me.meeting_link : url(input.meeting_url);
    if (mu === "bad") return { ok: false, error: "הקישור לפגישה צריך להתחיל ב-https://." };
    if (mu !== undefined) patch.meeting_url = mu;
    if (input.status !== undefined) {
      if (!AGENDA_STATUS[String(input.status)]) return { ok: false, error: "סטטוס לא מוכר." };
      patch.status = String(input.status);
    }

    let saved: Row | null;
    if (existing) {
      if (!Object.keys(patch).length) return { ok: false, error: "לא נאמר מה לשנות." };
      const { data, error } = await supabase.from("csm_agenda").update(patch)
        .eq("id", existing.id).eq("staff_id", staff.id).select("*").single();
      if (error) return { ok: false, error: error.message };
      saved = data as Row;
    } else {
      if (!patch.starts_at) return { ok: false, error: "צריך תאריך ושעה." };
      const kind = AGENDA_KINDS[String(input.kind)] ? String(input.kind) : (target ? "followup" : "other");
      const rem = input.reminder_minutes === undefined || input.reminder_minutes === null ? null : Number(input.reminder_minutes);
      if (rem !== null && (!Number.isInteger(rem) || rem < 0 || rem > 1440)) return { ok: false, error: "תזכורת בין 0 ל-1440 דקות." };
      const row = {
        staff_id: staff.id, agent_id: target?.agent_id ?? null, kind,
        duration_minutes: num(me?.meeting_minutes) || 45, reminder_minutes: rem, ...patch,
      } as Row;
      if (!row.title) row.title = AGENDA_KINDS[kind] + (target?.display_name ? " - " + target.display_name : "");
      const { data, error } = await supabase.from("csm_agenda").insert(row).select("*").single();
      if (error) return { ok: false, error: error.message };
      saved = data as Row;
    }
    const a = saved!.agent_id ? rows.find((r) => r.agent_id === saved!.agent_id) : null;
    // התנגשות: פגישה אחרת שלה שחופפת
    const start = new Date(String(saved!.starts_at)).getTime();
    const end = start + num(saved!.duration_minutes) * 60000;
    const { data: around } = await supabase.from("csm_agenda").select("id, title, starts_at, duration_minutes")
      .eq("staff_id", staff.id).eq("status", "scheduled").neq("id", String(saved!.id))
      .gte("starts_at", new Date(start - 10 * 3600000).toISOString()).lt("starts_at", new Date(end).toISOString());
    const clash = ((around as Row[] | null) ?? []).filter((o) =>
      new Date(String(o.starts_at)).getTime() + num(o.duration_minutes) * 60000 > start);
    // יומן Google: מחובר - הפגישה עוברת לבד (google-calendar-sync), ובודקים
    // את היומן האישי שלה (פנוי/תפוס בלבד). לא מחובר - קישור תבנית.
    const { data: gconn } = await supabase.from("csm_calendar_connections")
      .select("status").eq("staff_id", staff.id).maybeSingle();
    const gSynced = gconn?.status === "active";
    // רק כן/לא יוצא למודל - לא טווחי הזמן עצמם (privacy.html#google-calendar)
    let googleBusy: boolean | null = null;
    if (gSynced && busyCheck && saved!.status === "scheduled") {
      try {
        const busy = await busyCheck(new Date(start).toISOString(), new Date(end).toISOString());
        googleBusy = busy === null ? null : busy.length > 0;
      } catch (err) {
        console.warn("csm freebusy failed", String(err));
      }
    }
    const details = [a ? `עם ${a.display_name}${a.agency_name ? " (" + a.agency_name + ")" : ""}` : "",
      a?.phone ? "טלפון: " + a.phone : "", saved!.meeting_url ? String(saved!.meeting_url) : "",
      saved!.notes ? String(saved!.notes) : ""].filter(Boolean).join("\n");
    return {
      ok: true, event_id: saved!.id, when: ilWhen(saved!.starts_at), minutes: saved!.duration_minutes,
      title: saved!.title, status: AGENDA_STATUS[String(saved!.status)],
      agent: a ? a.display_name : null,
      reminder_minutes: saved!.reminder_minutes ?? me?.reminder_minutes ?? null,
      google_calendar: gSynced ? "נכנסת לבד ליומן Google שלה (יומן \"שוק נדל\"ן\")" : null,
      google_calendar_url: saved!.status === "scheduled" && !gSynced
        ? gcalTemplateUrl({ title: String(saved!.title || "פגישה"), starts_at: String(saved!.starts_at),
          duration_minutes: num(saved!.duration_minutes) || 45, details,
          location: String(saved!.location || saved!.meeting_url || "") || undefined })
        : null,
      clashes: clash.map((o) => ({ title: o.title, when: ilWhen(o.starts_at) })),
      slot_busy_in_google: googleBusy,
      note: saved!.status === "done" && a
        ? "להציע לרשום מה בוצע בפגישה (csm_log_session)."
        : "לומר מתי נקבע ואת התזכורת. יומן Google מחובר - לומר שהפגישה עוברת לשם לבד; לא מחובר - לצרף את google_calendar_url ולהזכיר שאפשר לחבר בהגדרות באזור. " +
          "התנגשות ביומן ההטמעה או השעה תפוסה ביומן Google האישי שלה (slot_busy_in_google = true) - לציין ולשאול אם להזיז.",
    };
  }

  if (name === "csm_recent_calls") {
    const names = new Map(((await overviewRows(supabase)) ?? []).map((r) => [r.agent_id, r.display_name]));
    if (input.call_id) {
      const { data, error } = await supabase.from("csm_calls")
        .select("id, title, agent_id, status, error, analysis, created_at").eq("id", String(input.call_id)).maybeSingle();
      if (error || !data) return { ok: false, error: "השיחה לא נמצאה." };
      return { ok: true, call: { ...data, agent: names.get(data.agent_id) || null } };
    }
    const { data, error } = await supabase.from("csm_calls")
      .select("id, title, agent_id, status, error, analysis, created_at")
      .order("created_at", { ascending: false }).limit(8);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      calls: ((data as Row[] | null) ?? []).map((c) => ({
        call_id: c.id, title: c.title, agent: names.get(c.agent_id) || null, status: c.status,
        date: String(c.created_at).slice(0, 10), error: c.error || null,
        summary: (c.analysis as Row | null)?.summary ?? null,
      })),
    };
  }

  if (name === "csm_overview") {
    const rows = await overviewRows(supabase);
    const byStage: Record<string, number> = {};
    for (const r of rows) {
      const s = STAGES[String(r.stage)] || String(r.stage);
      byStage[s] = (byStage[s] || 0) + 1;
    }
    const due = rows.filter((r) => r.next_followup_at && new Date(String(r.next_followup_at)).getTime() <= Date.now() + 86400000);
    const risk = rows.filter(atRisk).sort((a, b) => (days(a.joined_at) ?? 0) - (days(b.joined_at) ?? 0));
    return {
      ok: true,
      agents_total: rows.length,
      by_stage: byStage,
      at_risk_count: risk.length,
      at_risk: risk.slice(0, 15).map(short),
      followups_due: due.slice(0, 15).map((r) => ({ ...short(r), weekly_goal: r.last_weekly_goal || null,
        followup: String(r.next_followup_at).slice(0, 10) })),
      note: "הצג/י בקצרה: מספרים לפי שלב, ואז מי בסיכון ומי לחזור אליו היום (שם, משרד, טלפון). " +
        "חדשים (הצטרפו לאחרונה) קודם - שם החלון נסגר הכי מהר.",
    };
  }

  if (name === "csm_find_agent") {
    const q = norm(input.query), qd = digits(input.query);
    if (!q) return { ok: false, error: "צריך שם, טלפון או משרד." };
    const rows = await overviewRows(supabase);
    const hits = rows.filter((r) =>
      norm(r.display_name).includes(q) || norm(r.agency_name).includes(q) ||
      (qd.length >= 6 && (digits(r.phone).endsWith(qd.slice(-9)))));
    if (!hits.length) return { ok: true, count: 0, note: "לא נמצא/ה סוכן/ת. אפשר לנסות חלק מהשם או את הטלפון." };
    if (hits.length > 8) {
      return { ok: true, count: hits.length, agents: hits.slice(0, 15).map(short),
        note: "יותר מדי תוצאות - להציג את הרשימה הקצרה ולשאול למי הכוונה." };
    }
    return { ok: true, count: hits.length, agents: hits.map(agentCard) };
  }

  if (name === "csm_office") {
    const rows = await overviewRows(supabase);
    const q = norm(input.query);
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r.agency_id || "none");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    if (!q) {
      return {
        ok: true,
        offices: [...groups.values()].map((a) => ({
          office: a[0].agency_name, city: a[0].agency_city || null, agents: a.length,
          on_gabriela_7d: a.filter((r) => num(r.gabriela_7d) > 0).length,
          active_listings: a.reduce((s, r) => s + num(r.active_listings), 0),
          at_risk: a.filter(atRisk).length,
          manager_uses_gabriela: a.some((r) => r.role === "manager" && (days(r.last_gabriela_at) ?? 999) < 7),
        })).sort((x, y) => y.agents - x.agents).slice(0, 40),
      };
    }
    const match = [...groups.values()].filter((a) => norm(a[0].agency_name).includes(q));
    if (!match.length) return { ok: true, count: 0, note: "לא נמצא משרד בשם הזה." };
    if (match.length > 3) return { ok: true, count: match.length, offices: match.map((a) => a[0].agency_name), note: "לשאול לאיזה משרד הכוונה." };
    return {
      ok: true,
      offices: match.map((a) => ({
        office: a[0].agency_name,
        address: [a[0].agency_address, a[0].agency_city].filter(Boolean).join(", ") || null,
        agents_count: a.length,
        managers: a.filter((r) => r.role === "manager").map((r) => ({ name: r.display_name, phone: r.phone, email: r.email })),
        agents: a.map((r) => ({ ...short(r), tier: r.tier, gabriela_7d: num(r.gabriela_7d),
          active_listings: num(r.active_listings), clients: num(r.clients) })),
      })),
    };
  }

  if (name === "csm_link_call") {
    const rows = await overviewRows(supabase);
    const target = rows.find((r) => r.agent_id === String(input.agent_id));
    if (!target) return { ok: false, error: "agent_id לא נמצא. קודם csm_find_agent." };
    const { data: call, error } = await supabase.from("csm_calls")
      .update({ agent_id: target.agent_id }).eq("id", String(input.call_id)).select("id, analysis").maybeSingle();
    if (error || !call) return { ok: false, error: "השיחה לא נמצאה." };
    const a = (call.analysis ?? {}) as Row;
    if (input.apply_followup && (a.suggested_stage || a.followup_date)) {
      const row: Row = { agent_id: target.agent_id, updated_at: new Date().toISOString(),
        stage: STAGES[String(a.suggested_stage)] ? a.suggested_stage : target.stage };
      if (a.followup_date) row.next_followup_at = followupIso(a.followup_date);
      const { error: stErr } = await supabase.from("csm_agent_stage").upsert(row, { onConflict: "agent_id" });
      if (stErr) return { ok: false, error: stErr.message };
      return { ok: true, name: target.display_name, stage: STAGES[String(row.stage)], followup: a.followup_date || null };
    }
    return { ok: true, name: target.display_name };
  }

  // הכלים שכותבים: הסוכן/ת חייב/ת להיות ברשימה
  const rows = name === "csm_add_feedback" && !input.agent_id ? [] : await overviewRows(supabase);
  const target = input.agent_id ? rows.find((r) => r.agent_id === String(input.agent_id)) : null;
  if (input.agent_id && !target) return { ok: false, error: "agent_id לא נמצא. קודם csm_find_agent." };

  if (name === "csm_set_stage") {
    if (!target) return { ok: false, error: "חסר agent_id." };
    const stage = input.stage ? String(input.stage) : String(target.stage);
    if (!STAGES[stage]) return { ok: false, error: "שלב לא מוכר." };
    const row: Row = { agent_id: target.agent_id, stage, updated_at: new Date().toISOString() };
    if (input.followup_date !== undefined) row.next_followup_at = followupIso(input.followup_date);
    if (input.note) row.notes = String(input.note).slice(0, 2000);
    const { error } = await supabase.from("csm_agent_stage").upsert(row, { onConflict: "agent_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, name: target.display_name, stage: STAGES[stage],
      followup: row.next_followup_at ? String(input.followup_date) : null };
  }

  if (name === "csm_log_session") {
    if (!target) return { ok: false, error: "חסר agent_id." };
    const done = (Array.isArray(input.done) ? input.done : []).map(String).filter((k) => WINS.includes(k));
    const firstWin = Object.fromEntries(WINS.map((k) => [k, done.includes(k)]));
    const rate = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);
    const follow = followupIso(input.followup_date);
    const { error } = await supabase.from("csm_sessions").insert({
      agent_id: target.agent_id,
      kind: num(target.sessions) ? "followup" : "first_win",
      first_win: firstWin,
      clarity: rate(input.clarity), time_saving: rate(input.time_saving),
      weekly_goal: input.weekly_goal ? String(input.weekly_goal).slice(0, 300) : null,
      followup_at: follow,
      notes: input.notes ? String(input.notes).slice(0, 4000) : null,
      dev_notes: input.dev_notes ? String(input.dev_notes).slice(0, 4000) : null,
    });
    if (error) return { ok: false, error: error.message };
    // כמו "שמירת הפגישה" ב-CRM: הצלחה מקדמת ל"עבר/ה הדרכה", רק קדימה; מנשירה - לפיילוט
    const cur = String(target.stage);
    const next = done.length && STAGE_ORDER.indexOf(cur) < STAGE_ORDER.indexOf("onboarded") ? "onboarded"
      : cur === "at_risk" && done.length ? "active_pilot" : cur;
    const { error: stErr } = await supabase.from("csm_agent_stage").upsert(
      { agent_id: target.agent_id, stage: next, updated_at: new Date().toISOString(), ...(follow ? { next_followup_at: follow } : {}) },
      { onConflict: "agent_id" });
    if (stErr) console.error("csm stage after session failed", stErr.message);
    return { ok: true, name: target.display_name, done: done.length, stage: STAGES[next],
      followup: follow ? String(input.followup_date) : null };
  }

  if (name === "csm_add_feedback") {
    const title = String(input.title ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (title.length < 2) return { ok: false, error: "חסרה כותרת." };
    const { data: existing, error: e1 } = await supabase.from("csm_feedback").select("id, title").limit(1000);
    if (e1) return { ok: false, error: e1.message };
    let id = ((existing as Row[] | null) ?? []).find((f) => norm(f.title) === norm(title))?.id as string | undefined;
    const isNew = !id;
    if (!id) {
      const cat = String(input.category || "");
      const sev = String(input.severity || "");
      const { data, error } = await supabase.from("csm_feedback").insert({
        title,
        description: input.description ? String(input.description).slice(0, 4000) : null,
        category: ["pilot_blocker", "daily_efficiency", "office_management"].includes(cat) ? cat : "daily_efficiency",
        severity: ["blocker", "usability", "enhancement"].includes(sev) ? sev : "usability",
      }).select("id").single();
      if (error) return { ok: false, error: error.message };
      id = data.id as string;
    }
    if (target) {
      const { error } = await supabase.from("csm_feedback_votes")
        .upsert({ feedback_id: id, agent_id: target.agent_id }, { onConflict: "feedback_id,agent_id", ignoreDuplicates: true });
      if (error) return { ok: false, error: error.message };
    }
    const { count } = await supabase.from("csm_feedback_votes").select("id", { count: "exact", head: true }).eq("feedback_id", id);
    return { ok: true, new_request: isNew, requested_by: count ?? 0 };
  }

  return { ok: false, error: `כלי לא מוכר: ${name}` };
}
