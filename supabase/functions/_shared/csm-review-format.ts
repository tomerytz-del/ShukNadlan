// ============================================================================
// _shared/csm-review-format.ts — ניתוח המנטור להקלטת שיחה של צוות ההטמעה: החלק הטהור
//
// אחרי הסיכום הרגיל (csm-call-format.ts) המנטור עובר על השיחה שוב: מזהה התנגדויות
// ושאלות, מציע תשובות **רק על סמך מה שהמערכת באמת עושה** (TOOLS), רושם חלופות
// שהוזכרו (בלי לטעון עליהן דבר - CSM_COMPETITORS), ומסמן מה הוא לא ידע. כל פריט
// נכנס לרשימה סגורה של סוגי בעיות ופתרונות, כדי שאפשר יהיה לרכז אותם מעבר
// לשיחה אחת (csm_call_insights, והניתוח הכולל ב-csm-insights-format.ts).
//
// בלי Deno ובלי npm:, כדי שהבדיקה תרוץ ב-node. ה-I/O ב-csm-review.ts.
// docs/csm-adoption.md, "המנטור עובר על השיחה".
// ============================================================================
import { CSM_PLAYBOOK } from "./coach/playbook.ts";
import { TOOLS } from "./coach/prompts.ts";

/* רשימות סגורות. מפתח חדש = גם תווית כאן, גם בהסכמה (enum), וגם ב-crm-csm.js (CSM_PROBLEM_HE). */
export const PROBLEM_TYPES: Record<string, string> = {
  time: "אין זמן / עומס",
  learning: "קושי טכנולוגי או לימוד",
  existing_tool: "כבר יש כלי, CRM או אקסל",
  trust_ai: "אמון בדיוק של ה-AI",
  privacy: "פרטיות ובעלות על הנתונים והלקוחות",
  price: "מחיר ותשואה",
  relevance: "לא רלוונטי לסוג העבודה שלי",
  team_buyin: "אימוץ בצוות או במשרד",
  missing_feature: "חסרה יכולת",
  bug: "תקלה או חוויית שימוש",
  other: "אחר",
};
export const SOLUTION_TYPES: Record<string, string> = {
  demo_capability: "הדגמת יכולת",
  workflow_shortcut: "קיצור בעבודה שלו/ה",
  reassurance_control: "הרגעה: שליטה ותיקון",
  social_proof: "דוגמה מסוכן/ת אחר/ת",
  pricing_page: "הפניה למחירים",
  escalate: "העברה לתומר",
  followup_task: "משימת המשך",
  none: "לא נענתה",
};
export const QUESTION_TOPICS: Record<string, string> = {
  setup: "הקמה והתחלה", gabriela: "גבריאלה", crm: "ה-CRM", matching: "התאמות", marketing: "שיווק ופרסום",
  pricing: "מחירים ומסלולים", data_privacy: "נתונים ופרטיות", integrations: "חיבורים ויומן", support: "תמיכה", other: "אחר",
};
export const SCRIPT_STAGES: Record<string, string> = {
  opening: "פתיחה", discovery: "שאלות גילוי", demo: "הדגמה", objections: "התנגדויות", close: "סגירה והצעד הבא", followup: "המשך",
};
const HANDLED = ["well", "partial", "not_handled"] as const;

const strEnum = (o: Record<string, string>) => ({ type: "string", enum: Object.keys(o) });

export const REVIEW_TOOL = {
  name: "save_call_review",
  description: "שמירת ניתוח המנטור לשיחת הטמעה.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", description: "שני משפטים: הרגע החזק בשיחה והפספוס הגדול" },
      objections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            quote: { type: "string", description: "ההתנגדות בלשון שנאמרה" },
            problem_type: strEnum(PROBLEM_TYPES),
            handled: { type: "string", enum: [...HANDLED], description: "האם מנהלת ההטמעה ענתה: well / partial / not_handled" },
            how_handled: { type: "string", description: "מה היא אמרה, בקצרה. ריק אם לא ענתה" },
            suggested_reply: { type: "string", description: "מה כדאי לומר: משפט או שניים בגוף ראשון, רק על סמך יכולת מהרשימה" },
            solution_type: strEnum(SOLUTION_TYPES),
            system_feature: { type: "string", description: "שם היכולת מהרשימה שעליה נשענת התשובה, או ריק" },
            competitor: { type: "string", description: "חלופה שהוזכרה בהתנגדות, או ריק" },
          },
          required: ["quote", "problem_type", "handled", "suggested_reply", "solution_type"],
        },
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            topic: strEnum(QUESTION_TOPICS),
            answered: { type: "string", enum: [...HANDLED], description: "well = נענתה נכון, partial = חלקית, not_handled = לא נענתה או נענתה לא נכון" },
            answer_given: { type: "string", description: "מה נאמר בשיחה, בקצרה" },
            suggested_answer: { type: "string", description: "תשובה מומלצת, רק על סמך יכולת מהרשימה. ריק כשהתשובה שנאמרה נכונה" },
          },
          required: ["question", "topic", "answered"],
        },
      },
      competitors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "השם כפי שנאמר" },
            claimed_strength: { type: "string", description: "מה אמר/ה שהחלופה נותנת לו/ה" },
            reply_hint: { type: "string", description: "איך עונים, לפי כללי החלופות: שאלה ופעולה אחת שאין לה מקבילה בדבריו/ה" },
          },
          required: ["name"],
        },
      },
      script_notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            stage: strEnum(SCRIPT_STAGES),
            note: { type: "string", description: "מה נצפה בשיחה" },
            suggestion: { type: "string", description: "ניסוח או שינוי מוצע" },
          },
          required: ["stage", "note"],
        },
      },
      knowledge_gaps: { type: "array", items: { type: "string" }, description: "מה עלה בשיחה ואין למנטור ידע לענות עליו" },
    },
    required: ["verdict"],
  },
};

export function csmReviewSystem(): string {
  return `את/ה המנטור של מנהלת ההדרכות וההטמעה של "שוק נדל״ן". עברת על תמלול שיחה שלה עם סוכן/ת או מנהל/ת משרד על אימוץ המערכת (לפעמים עם שגיאות תמלול, ולפעמים עם כרטיס הסוכן/ת). המשימה: לקרוא ל-save_call_review.

מה בודקים:
- objections: כל התנגדות או היסוס לאימוץ, בלשון שנאמרה (quote), עם problem_type. handled: האם מנהלת ההטמעה ענתה (well, partial, not_handled) ו-how_handled מה אמרה. suggested_reply: מה כדאי לומר, משפט או שניים בגוף ראשון, שנשענים **רק** על יכולת מהרשימה "הכלים שקיימים במערכת" (ושם היכולת ב-system_feature). solution_type: איזה סוג תשובה זו.
- questions: שאלות של הסוכן/ת, ומה נענה. כשהתשובה שנאמרה לא נכונה או חסרה - suggested_answer לפי הכלים בלבד.
- competitors: כל חלופה שהוזכרה, לפי הכללים של "חלופות ומתחרים" למטה. לא טוענים עליה דבר.
- script_notes: תצפיות על מבנה השיחה (פתיחה, שאלות גילוי, הדגמה, התנגדויות, סגירה והצעד הבא, המשך), עם ניסוח מוצע. עד שש, רק מה שנראה בשיחה הזו.
- knowledge_gaps: כל דבר שעלה ואין לך ידע לענות עליו - יכולת שאינה ברשימה, מחיר, פרט על מתחרה. רושמים ולא ממציאים.
- verdict: שני משפטים: הרגע החזק והפספוס הגדול.

כללים: רק מה שנאמר בשיחה. שיחה בלי התנגדויות או שאלות - רשימה ריקה, בלי להמציא. יכולת שלא ברשימת הכלים לא קיימת, ולא מציעים אותה. לא חוזרים על מספרי טלפון, ת.ז. או פרטי לקוחות של הסוכן/ת. עברית, מקף רגיל (-) בלבד, בלי אימוג'י, בלי הבטחה להכנסה.

${TOOLS}

השיטה (ידע ההטמעה של שוק נדל"ן):
${CSM_PLAYBOOK}`;
}

const s = (v: unknown, max: number) => String(v ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
const pick = (v: unknown, allowed: Record<string, string>, fallback: string) => (Object.prototype.hasOwnProperty.call(allowed, String(v)) ? String(v) : fallback);
const handled = (v: unknown): "well" | "partial" | "not_handled" => (HANDLED as readonly string[]).includes(String(v)) ? String(v) as "well" : "not_handled";
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v : []).slice(0, max) as Record<string, unknown>[];

export type CallReview = {
  verdict: string;
  objections: { quote: string; problem_type: string; handled: string; how_handled: string; suggested_reply: string; solution_type: string; system_feature: string; competitor: string }[];
  questions: { question: string; topic: string; answered: string; answer_given: string; suggested_answer: string }[];
  competitors: { name: string; claimed_strength: string; reply_hint: string }[];
  script_notes: { stage: string; note: string; suggestion: string }[];
  knowledge_gaps: string[];
};

/* מה שנשמר: רק השדות הצפויים, מהרשימות הסגורות, באורך סביר ובלי מקף ארוך */
export function cleanCallReview(raw: unknown): CallReview | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const verdict = s(r.verdict, 600);
  if (!verdict) return null;
  return {
    verdict,
    objections: arr(r.objections, 10).map((o) => ({
      quote: s(o.quote, 300), problem_type: pick(o.problem_type, PROBLEM_TYPES, "other"), handled: handled(o.handled),
      how_handled: s(o.how_handled, 300), suggested_reply: s(o.suggested_reply, 500),
      solution_type: pick(o.solution_type, SOLUTION_TYPES, "none"), system_feature: s(o.system_feature, 80), competitor: s(o.competitor, 80),
    })).filter((o) => o.quote.length >= 2),
    questions: arr(r.questions, 12).map((q) => ({
      question: s(q.question, 300), topic: pick(q.topic, QUESTION_TOPICS, "other"), answered: handled(q.answered),
      answer_given: s(q.answer_given, 300), suggested_answer: s(q.suggested_answer, 500),
    })).filter((q) => q.question.length >= 2),
    competitors: arr(r.competitors, 5).map((c) => ({
      name: s(c.name, 80), claimed_strength: s(c.claimed_strength, 300), reply_hint: s(c.reply_hint, 400),
    })).filter((c) => c.name.length >= 2),
    script_notes: arr(r.script_notes, 6).map((n) => ({
      stage: pick(n.stage, SCRIPT_STAGES, "objections"), note: s(n.note, 300), suggestion: s(n.suggestion, 400),
    })).filter((n) => n.note.length >= 2),
    knowledge_gaps: (Array.isArray(r.knowledge_gaps) ? r.knowledge_gaps : []).map((g) => s(g, 200)).filter((g) => g.length >= 3).slice(0, 6),
  };
}

export type InsightRow = {
  kind: "objection" | "question" | "competitor" | "gap"; problem_type: string | null; solution_type: string | null;
  outcome: string | null; text: string; reply: string | null; system_feature: string | null; competitor: string | null;
};

/* הניתוח כשורות מנורמלות (csm_call_insights). הצד הלא מוכר של שורה: ריק = null, לא מחרוזת ריקה. */
export function reviewInsightRows(rv: CallReview): InsightRow[] {
  const n = (v: string) => v || null;
  return [
    ...rv.objections.map((o): InsightRow => ({
      kind: "objection", problem_type: o.problem_type, solution_type: o.solution_type, outcome: o.handled,
      text: o.quote, reply: n(o.suggested_reply), system_feature: n(o.system_feature), competitor: n(o.competitor),
    })),
    ...rv.questions.map((q): InsightRow => ({
      kind: "question", problem_type: q.topic, solution_type: null, outcome: q.answered,
      text: q.question, reply: n(q.suggested_answer || q.answer_given), system_feature: null, competitor: null,
    })),
    ...rv.competitors.map((c): InsightRow => ({
      kind: "competitor", problem_type: null, solution_type: null, outcome: null,
      text: c.claimed_strength || c.name, reply: n(c.reply_hint), system_feature: null, competitor: c.name,
    })),
    ...rv.knowledge_gaps.map((g): InsightRow => ({
      kind: "gap", problem_type: null, solution_type: null, outcome: null, text: g, reply: null, system_feature: null, competitor: null,
    })),
  ];
}
