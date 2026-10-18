// ============================================================================
// prompt_cache_test.ts — נקודות השבירה של גבריאלה (whatsapp-webhook/prompt-cache.ts)
//
// שלושה כשלים שקטים שהבדיקה תופסת: יותר מארבע נקודות שבירה (ה-API מפיל את
// הבקשה), היסטוריה שנשלחת אחרת בין תור לתור (המטמון לא נקרא), וגזימה שמזיזה
// את תחילת ההיסטוריה בכל תור. ‏docs/platform-costs.md, "המטמון של גבריאלה".
//
//   node --experimental-strip-types scripts/prompt_cache_test.ts
// ============================================================================
import { historyWithBreakpoint, RollingMarks, trimHistory } from "../supabase/functions/whatsapp-webhook/prompt-cache.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

type Msg = { role: "user" | "assistant"; content: string };
const hist: Msg[] = [
  { role: "user", content: "שלום" }, { role: "assistant", content: "היי" },
  { role: "user", content: "תוסיף נכס" }, { role: "assistant", content: "הוספתי" },
];

// 1. ההיסטוריה: כל ההודעות כבלוקים, נקודה אחת על האחרונה, והמקור לא משתנה
const out = historyWithBreakpoint(hist as never) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
check("כל ההודעות נשלחות כבלוקים", out.every((m) => Array.isArray(m.content)));
const marks = out.flatMap((m) => m.content).filter((b) => b.cache_control);
check("נקודת שבירה אחת, על ההודעה האחרונה", marks.length === 1 && out[3].content[0].cache_control !== undefined);
check("ההיסטוריה עצמה לא השתנתה", typeof hist[3].content === "string");

// 2. התור הבא: אותן הודעות בדיוק (בלי הסימון) כקידומת - אחרת המטמון לא נקרא
const next = historyWithBreakpoint([...hist, { role: "user", content: "ועוד" }, { role: "assistant", content: "בוצע" }] as never) as typeof out;
const strip = (m: typeof out[number]) => JSON.stringify(m.content.map(({ cache_control: _c, ...b }) => b));
check("הקידומת זהה בין תורים", out.every((m, i) => strip(m) === strip(next[i])));
check("היסטוריה ריקה - בלי נקודה ובלי שגיאה", historyWithBreakpoint([]).length === 0);

// 3. לולאת הכלים: לעולם לא יותר משתיים (עם ההוראות וההיסטוריה - ארבע)
const rolling = new RollingMarks();
const blocks: Array<{ cache_control?: unknown }> = Array.from({ length: 6 }, () => ({}));
blocks.forEach((b) => rolling.add(b as never));
const live = blocks.filter((b) => b.cache_control);
check("שתי נקודות מתגלגלות בלבד", live.length === 2, live.length);
check("השתיים הן האחרונות", blocks[4].cache_control !== undefined && blocks[5].cache_control !== undefined);

// 4. גזימה במדרגות: תחילת ההיסטוריה קבועה בין הגזימות
let h: number[] = [];
const starts: number[] = [];
for (let t = 0; t < 30; t++) {
  h = trimHistory([...h, 2 * t, 2 * t + 1], 12);
  starts.push(h[0]);
}
const changes = starts.filter((s, i) => i && s !== starts[i - 1]).length;
check("התחלה משתנה רק בגזימה (לא בכל תור)", changes <= 9, changes);
check("לא יותר מ-18 הודעות", Math.max(...Array.from({ length: 30 }, () => h.length)) <= 18 && h.length >= 12);
check("זוגות נשמרים (מתחיל בהודעת משתמש)", h[0] % 2 === 0);

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ נקודות השבירה של גבריאלה: כל הבדיקות עברו");
