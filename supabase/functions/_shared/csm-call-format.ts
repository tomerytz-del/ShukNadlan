// ============================================================================
// _shared/csm-call-format.ts — ניתוח הקלטת שיחה של צוות ההטמעה: החלק הטהור
//
// הפרומפט, הסכמה שהמודל ממלא, הניקוי של מה שחזר, והנוסח לוואטסאפ. בלי Deno
// ובלי npm:, כדי שהבדיקה תרוץ ב-node (scripts/office_coach_test.ts). ה-I/O -
// הורדה, תמלול, קריאה למודל ועדכון השורה - ב-csm-call.ts. docs/csm-adoption.md.
// ============================================================================
import { CSM_PLAYBOOK } from "./coach/playbook.ts";

export const CSM_STAGE_KEYS = ["registered", "call_scheduled", "onboarded", "active_pilot", "champion", "at_risk"];
const STAGE_HE: Record<string, string> = {
  registered: "נרשם/ה - לא פעיל/ה", call_scheduled: "נקבעה פגישה", onboarded: "עבר/ה הדרכה",
  active_pilot: "פיילוט פעיל", champion: "משתמש/ת עצמאי/ת", at_risk: "נשירה - דורש/ת חיזוק",
};
const MOOD_HE: Record<string, string> = {
  positive: "חיובי/ת ומעורב/ת", neutral: "ניטרלי/ת", hesitant: "מהסס/ת", negative: "מתנגד/ת או מתוסכל/ת",
};

/* הכלי שהמודל חייב לקרוא לו (tool_choice): כך התשובה היא תמיד מבנה ולא טקסט
   חופשי שצריך לפרסר. */
export const CALL_ANALYSIS_TOOL = {
  name: "save_call_analysis",
  description: "שמירת הניתוח של שיחת ההטמעה.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "3-5 משפטים: עם מי השיחה, על מה דובר ומה הוחלט" },
      mood: { type: "string", enum: ["positive", "neutral", "hesitant", "negative"] },
      pains: { type: "array", items: { type: "string" }, description: "נקודות כאב וחיכוכים שהסוכן/ת או המשרד העלו" },
      objections: { type: "array", items: { type: "string" }, description: "התנגדויות לאימוץ המערכת, בלשון שנאמרה" },
      commitments: { type: "array", items: { type: "string" }, description: "מה כל צד התחייב לעשות" },
      recommendations: { type: "array", items: { type: "string" }, description: "2-5 המלצות למנהלת ההטמעה, לפי השיטה" },
      next_steps: {
        type: "array",
        items: {
          type: "object",
          properties: { action: { type: "string" }, when: { type: "string", description: "YYYY-MM-DD או ריק" } },
          required: ["action"],
        },
      },
      suggested_stage: { type: "string", enum: [...CSM_STAGE_KEYS, ""], description: "השלב המתאים אחרי השיחה, או ריק" },
      followup_date: { type: "string", description: "YYYY-MM-DD למועד הקשר הבא, או ריק" },
      feedback_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "בקשת פיתוח או באג במשפט קצר" },
            severity: { type: "string", enum: ["blocker", "usability", "enhancement"] },
          },
          required: ["title"],
        },
      },
      message_draft: { type: "string", description: "הודעת וואטסאפ קצרה וחמה מהמנהלת לסוכן/ת אחרי השיחה, עד 60 מילים" },
    },
    required: ["summary", "mood", "recommendations"],
  },
};

export function csmCallSystem(): string {
  return `את/ה מנתח/ת הקלטות שיחה של מנהלת ההדרכות וההטמעה של "שוק נדל״ן" - שיחות עם סוכני נדל"ן ומנהלי משרדי תיווך על אימוץ המערכת (גבריאלה בוואטסאפ, ה-CRM, ההתאמות, השיווק). מקבלים תמלול (לפעמים עם שגיאות תמלול), ולפעמים כרטיס של הסוכן/ת: השלב בצנרת ורמת השימוש.

המשימה: לקרוא ל-save_call_analysis עם ניתוח שעוזר לה להמשיך מהשיחה:
- summary: מה היה בשיחה ומה הוחלט, בלי הקדמות.
- pains, objections: רק מה שנאמר בשיחה. לא להשלים מהראש.
- commitments: מי התחייב למה ("הסוכנת: להעלות 3 נכסים עד חמישי").
- recommendations: מה המנהלת עושה עכשיו, לפי השיטה שלמטה (פעולה אחת קטנה ומדידה, הודעה עם פקודה מוכנה, פגישת הצלחה ראשונה, מעבר שלב). רק כלים שקיימים.
- next_steps ו-followup_date: לפי מה שסוכם; כשלא נקבע מועד - לפי כלל האצבע (שיחה קצרה בעוד 5 ימים).
- suggested_stage: רק כשהשיחה מצדיקה מעבר.
- feedback_items: בקשות פיתוח או באגים שעלו, כל אחד פעם אחת.
- message_draft: הודעה קצרה בגוף שני לסוכן/ת, עם הצעד הבא. בלי הבטחות להכנסה.

כללים: עברית. מקף רגיל (-) בלבד, לעולם לא מקף ארוך. בלי אימוג'י. לא ממציאים שמות, מספרים או החלטות שלא נאמרו. לא חוזרים בניתוח על מספרי טלפון, ת.ז. או פרטים של לקוחות של הסוכן/ת שהוזכרו בשיחה.

השיטה (ידע ההטמעה של שוק נדל"ן):
${CSM_PLAYBOOK}`;
}

const s = (v: unknown, max: number) => String(v ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
const list = (v: unknown, max = 8, len = 300) =>
  (Array.isArray(v) ? v : []).map((x) => s(x, len)).filter(Boolean).slice(0, max);
const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);

export type CallAnalysis = {
  summary: string; mood: string | null; pains: string[]; objections: string[]; commitments: string[];
  recommendations: string[]; next_steps: { action: string; when: string | null }[];
  suggested_stage: string | null; followup_date: string | null;
  feedback_items: { title: string; severity: string }[]; message_draft: string;
};

/* מה שנשמר: רק השדות הצפויים, באורך סביר, בלי מקף ארוך, ושלב רק מהרשימה */
export function cleanCallAnalysis(raw: unknown): CallAnalysis | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const summary = s(r.summary, 1500);
  if (!summary) return null;
  return {
    summary,
    mood: MOOD_HE[String(r.mood)] ? String(r.mood) : null,
    pains: list(r.pains),
    objections: list(r.objections),
    commitments: list(r.commitments),
    recommendations: list(r.recommendations, 6),
    next_steps: (Array.isArray(r.next_steps) ? r.next_steps : []).slice(0, 6)
      .map((x) => ({ action: s((x as Record<string, unknown>)?.action, 200), when: ymd((x as Record<string, unknown>)?.when) }))
      .filter((x) => x.action),
    suggested_stage: CSM_STAGE_KEYS.includes(String(r.suggested_stage)) ? String(r.suggested_stage) : null,
    followup_date: ymd(r.followup_date),
    feedback_items: (Array.isArray(r.feedback_items) ? r.feedback_items : []).slice(0, 6)
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const sev = String(o.severity);
        return { title: s(o.title, 160), severity: ["blocker", "usability", "enhancement"].includes(sev) ? sev : "usability" };
      })
      .filter((x) => x.title.length >= 2),
    message_draft: s(r.message_draft, 600),
  };
}

/* הסיכום כהודעת וואטסאפ למנהלת ההטמעה (‏formatForWhatsapp עוד ינקה אחריו) */
export function callAnalysisText(a: CallAnalysis, agentName?: string | null): string {
  const sec = (title: string, items: string[]) => (items.length ? `\n*${title}*\n` + items.map((x) => "- " + x).join("\n") : "");
  return [
    `*סיכום השיחה${agentName ? " עם " + agentName : ""}*`,
    a.summary,
    a.mood ? `\nהטון: ${MOOD_HE[a.mood]}` : "",
    sec("נקודות כאב", a.pains),
    sec("התנגדויות", a.objections),
    sec("התחייבויות", a.commitments),
    sec("המלצות", a.recommendations),
    sec("הצעדים הבאים", a.next_steps.map((x) => x.action + (x.when ? ` (${x.when})` : ""))),
    a.suggested_stage ? `\nשלב מוצע: ${STAGE_HE[a.suggested_stage]}` : "",
    a.followup_date ? `קשר הבא: ${a.followup_date}` : "",
    sec("לפיתוח", a.feedback_items.map((f) => f.title)),
    a.message_draft ? `\n*הודעה מוצעת לסוכן/ת*\n${a.message_draft}` : "",
  ].filter(Boolean).join("\n").trim();
}
