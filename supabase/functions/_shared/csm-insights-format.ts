// ============================================================================
// _shared/csm-insights-format.ts — הניתוח הכולל של שיחות ההטמעה: החלק הטהור
//
// המנטור מקבל ריכוז של כל השיחות שנותחו בטווח (לפי סוג בעיה, סוג פתרון ונושא שאלה, עם
// ציטוטים והערות על התסריט) ומציע: תשובה מומלצת לכל סוג התנגדות, בנק שאלות, מה עובד
// ומה לא, ושיפורים בתסריט השיחה. מבוסס על מה שנאמר בשיחות ועל מה שהמערכת עושה (TOOLS),
// לא על ידע כללי. בלי Deno ובלי npm:. ה-I/O ב-csm-insights.ts. docs/csm-adoption.md.
// ============================================================================
import { CSM_PLAYBOOK } from "./coach/playbook.ts";
import { TOOLS } from "./coach/tools.ts";
import { arr, pick, s, strEnum } from "./csm-clean.ts";
import { PROBLEM_TYPES, QUESTION_TOPICS, SCRIPT_STAGES } from "./csm-review-format.ts";

export const MIN_REVIEWED_CALLS = 3;
const strList = { type: "array", items: { type: "string" } };

export const INSIGHTS_TOOL = {
  name: "save_insights_report",
  description: "שמירת הניתוח הכולל של שיחות ההטמעה.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "משפט אחד: מה הדבר החשוב ביותר שעולה מהשיחות" },
      confidence: { type: "string", enum: ["low", "medium", "high"], description: "low עד 9 שיחות, medium עד 24, high מעל" },
      objection_playbook: {
        type: "array",
        items: {
          type: "object",
          properties: {
            problem_type: strEnum(PROBLEM_TYPES),
            times: { type: "integer", description: "כמה פעמים עלתה, מהריכוז" },
            best_reply: { type: "string", description: "התשובה המומלצת, משפט או שניים בגוף ראשון, רק על סמך יכולת קיימת" },
            why: { type: "string", description: "למה זו התשובה: מה עבד בשיחות, או מה בדיוק חסר בתשובות שנאמרו" },
            evidence: { type: "array", items: { type: "string" }, description: "עד שלושה ציטוטים מהריכוז" },
            system_feature: { type: "string" },
          },
          required: ["problem_type", "best_reply", "why"],
        },
      },
      question_bank: {
        type: "array",
        items: {
          type: "object",
          properties: { topic: strEnum(QUESTION_TOPICS), question: { type: "string" }, recommended_answer: { type: "string" } },
          required: ["topic", "question", "recommended_answer"],
        },
      },
      what_works: { ...strList, description: "סוגי תשובה שעבדו, לפי ספירת handled בריכוז" },
      what_fails: { ...strList, description: "סוגי תשובה או התנגדויות שנשארות בלי מענה" },
      script_improvements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            stage: strEnum(SCRIPT_STAGES),
            issue: { type: "string" },
            suggestion: { type: "string" },
            example_line: { type: "string", description: "משפט לדוגמה שאפשר לומר" },
            based_on_calls: { type: "integer", description: "בכמה שיחות נצפה. 1 = תצפית בודדת" },
          },
          required: ["stage", "issue", "suggestion"],
        },
      },
      competitor_insights: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, how_raised: { type: "string" }, safe_reply: { type: "string" } },
          required: ["name", "how_raised"],
        },
      },
      knowledge_gaps: {
        type: "array",
        items: { type: "object", properties: { topic: { type: "string" }, why: { type: "string" } }, required: ["topic"] },
      },
      next_experiments: { ...strList, description: "עד שלושה שינויים לנסות ב-10 השיחות הבאות" },
    },
    required: ["headline", "confidence"],
  },
};

export function csmInsightsSystem(): string {
  return `את/ה המנטור של מנהלת ההדרכות וההטמעה של "שוק נדל״ן". מקבלים ריכוז של שיחות הטמעה שכבר נותחו: התנגדויות לפי סוג בעיה (עם ספירת handled/missed לכל סוג), סוגי תשובה, שאלות, חלופות שהוזכרו, הערות על התסריט ופערי ידע. המשימה: לקרוא ל-save_insights_report.

מה מייצרים:
- objection_playbook: לכל סוג התנגדות שחזר, התשובה המומלצת. מבוססת על מה שעבד בשיחות (outcome well) ועל יכולת קיימת בלבד. כשאף תשובה לא עבדה - אומרים מה חסר, ולא ממציאים הצלחה.
- question_bank: שאלות שחוזרות, והתשובה הנכונה.
- what_works, what_fails: לפי הספירות בלבד.
- script_improvements: שיפורים בתסריט השיחה, לפי הערות שחוזרות. תצפית בודדת מסומנת based_on_calls = 1 ולא מוצגת כדפוס.
- competitor_insights: איך חלופות עולות, ותשובה בטוחה לפי הכללים על חלופות. בלי טענה על החלופה עצמה.
- knowledge_gaps: מה עלה שאין ידע עליו.
- next_experiments: עד שלושה שינויים קטנים לנסות ב-10 השיחות הבאות, כך שאפשר לבדוק אם עבדו.

כללים: המספרים הם מהריכוז ולא ממציאים אחרים. מעט שיחות (פחות מעשר) - confidence נמוך, ולא מסיקים דפוס מתצפית אחת. יכולת שלא ברשימת הכלים לא קיימת. עברית, מקף רגיל (-) בלבד, בלי אימוג'י, בלי הבטחה להכנסה, ובלי פרטי לקוחות או טלפונים.

${TOOLS}

השיטה (ידע ההטמעה של שוק נדל"ן):
${CSM_PLAYBOOK}`;
}

const int = (v: unknown) => Math.max(0, Math.min(9999, Math.round(Number(v) || 0)));

export type InsightsReport = {
  headline: string; confidence: "low" | "medium" | "high";
  objection_playbook: { problem_type: string; times: number; best_reply: string; why: string; evidence: string[]; system_feature: string }[];
  question_bank: { topic: string; question: string; recommended_answer: string }[];
  what_works: string[]; what_fails: string[];
  script_improvements: { stage: string; issue: string; suggestion: string; example_line: string; based_on_calls: number }[];
  competitor_insights: { name: string; how_raised: string; safe_reply: string }[];
  knowledge_gaps: { topic: string; why: string }[];
  next_experiments: string[];
};

export function cleanInsightsReport(raw: unknown): InsightsReport | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const headline = s(r.headline, 300);
  if (!headline) return null;
  const strs = (v: unknown, n: number, len = 300) => (Array.isArray(v) ? v : []).map((x) => s(x, len)).filter((x) => x.length >= 3).slice(0, n);
  return {
    headline,
    confidence: ["low", "medium", "high"].includes(String(r.confidence)) ? String(r.confidence) as "low" : "low",
    objection_playbook: arr(r.objection_playbook, 11).map((o) => ({
      problem_type: pick(o.problem_type, PROBLEM_TYPES, "other"), times: int(o.times), best_reply: s(o.best_reply, 600),
      why: s(o.why, 500), evidence: strs(o.evidence, 3, 250), system_feature: s(o.system_feature, 80),
    })).filter((o) => o.best_reply.length >= 3),
    question_bank: arr(r.question_bank, 12).map((q) => ({
      topic: pick(q.topic, QUESTION_TOPICS, "other"), question: s(q.question, 300), recommended_answer: s(q.recommended_answer, 600),
    })).filter((q) => q.question.length >= 3 && q.recommended_answer.length >= 3),
    what_works: strs(r.what_works, 6), what_fails: strs(r.what_fails, 6),
    script_improvements: arr(r.script_improvements, 8).map((x) => ({
      stage: pick(x.stage, SCRIPT_STAGES, "objections"), issue: s(x.issue, 300), suggestion: s(x.suggestion, 500),
      example_line: s(x.example_line, 300), based_on_calls: int(x.based_on_calls),
    })).filter((x) => x.issue.length >= 3 && x.suggestion.length >= 3),
    competitor_insights: arr(r.competitor_insights, 6).map((c) => ({ name: s(c.name, 80), how_raised: s(c.how_raised, 300), safe_reply: s(c.safe_reply, 500) }))
      .filter((c) => c.name.length >= 2),
    knowledge_gaps: arr(r.knowledge_gaps, 8).map((g) => ({ topic: s(g.topic, 200), why: s(g.why, 300) })).filter((g) => g.topic.length >= 3),
    next_experiments: strs(r.next_experiments, 3),
  };
}
