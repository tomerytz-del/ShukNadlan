// ============================================================================
// prompt-cache.ts — נקודות השבירה של המטמון בשני הבוטים (agent.ts, public-agent.ts)
//
// ‏docs/platform-costs.md, "המטמון של גבריאלה". שלוש נקודות, ותקרת ה-API היא ארבע:
//
//   1. סוף `SYSTEM_STATIC` (עם הכלים שלפניו) - בכל בוט בנפרד, ttl של שעה.
//   2. סוף ההיסטוריה (‏`historyWithBreakpoint`) - בתור הבא אותה היסטוריה נקראת
//      מהמטמון ב-0.1 מהמחיר במקום להישלח מלאה. עד 17K טוקנים בשיחה ארוכה.
//   3. שתי האחרונות בלולאת הכלים (‏`RollingMarks`) - ולא רק האחרונה. ה-API מחפש
//      התאמה עד ~20 בלוקים אחורה מכל נקודה, ותור עם הרבה קריאות כלים במקביל
//      (בלוק לכל קריאה ולכל תוצאה) עובר את זה: הסבב הבא לא מצא את מה שהקודם
//      כתב וכתב הכול מחדש. ב-18.10.2026 כך היו 17 מתוך 36 סבבים שלישיים ומעלה.
//      נקודה על סוף הסבב הקודם היא התאמה מדויקת, בלי תלות במרחק.
//
// וההיסטוריה נגזמת **במדרגות** (‏`trimHistory`), לא בחלון מחליק: `slice(-12)`
// מזיז את תחילת ההיסטוריה בכל תור, וקידומת שתחילתה זזה לא נקראת מהמטמון לעולם.
// ============================================================================
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";

type Mark = { cache_control?: { type: "ephemeral" } };

/** ההיסטוריה כבלוקים, עם נקודת שבירה על הבלוק האחרון. ‏`history` עצמה לא משתנה.
 *  **כל** ההודעות נשלחות כבלוקים ולא רק המסומנת: בתור הבא היא כבר לא אחרונה,
 *  ומחרוזת במקום בלוק הייתה קידומת אחרת. */
export function historyWithBreakpoint(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = history.map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? [{ type: "text" as const, text: m.content }]
      : m.content.map((b) => ({ ...b })),
  })) as Anthropic.MessageParam[];
  const last = out[out.length - 1];
  const blocks = last?.content as Array<Anthropic.ContentBlockParam & Mark> | undefined;
  const tail = blocks?.[blocks.length - 1];
  // בלוק טקסט ריק נדחה ב-400 גם בלי הסימון; וסימון על thinking אינו מותר
  if (tail && (tail.type !== "text" || tail.text)) tail.cache_control = { type: "ephemeral" };
  return out;
}

/** גזימה במדרגות: עד `limit + step` הודעות נשמרות כמו שהן, ומעבר לזה נשארות
 *  `limit` האחרונות. ממוצע דומה לחלון של `limit`, והתחילה קבועה בין הגזימות. */
export function trimHistory<T>(history: T[], limit: number, step = 6): T[] {
  return history.length > limit + step ? history.slice(-limit) : history;
}

/** שתי נקודות השבירה האחרונות בלולאת הכלים. השלישית מוסרת מהישנה. */
export class RollingMarks {
  private marks: Mark[] = [];
  add(block: Mark): void {
    block.cache_control = { type: "ephemeral" };
    this.marks.push(block);
    while (this.marks.length > 2) delete this.marks.shift()!.cache_control;
  }
}
