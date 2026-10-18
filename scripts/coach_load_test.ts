// ============================================================================
// coach_load_test.ts — מבחן עומס למנטור (docs/coaches.md, "מבחן עומס")
//
// מה נבדק: צוואר הבקבוק של "שאל את המנטור" אינו המסד ואינו הפונקציה אלא מגבלות
// הקצב של חשבון Anthropic (בקשות לדקה, טוקנים לדקה). לכן הסקריפט שולח ישר ל-API
// את אותו פרומפט ש-askCoach שולח (askSystemPrompt עם הידע), בגלים של N בקשות
// בו-זמנית, ומודד זמן תגובה, שגיאות 429/529 ואת המגבלות שהשרת מחזיר בכותרות.
//
// **לא נוגע בפרודקשן:** לא קורא ל-coach-ask, לא כותב ל-coach_questions ולא
// מוריד מכסה מאף סוכן/ת. **אבל עולה כסף** - כל בקשה היא קריאה אמיתית למודל.
// לכן בלי --yes רק מדפיס תוכנית ויוצא, ו---levels=1 (ברירת המחדל) הוא בדיקה
// של בקשה אחת שמספיקה כדי לקרוא את המגבלות של החשבון מהכותרות.
//
//   ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/coach_load_test.ts
//   ... --levels=10,50,100 --yes
//
// דגלים: --levels=1,10,50  --model=claude-sonnet-5-5  --max-tokens=600
//        --kind=agent|team|office  --pause=60 (שניות בין גלים, כדי שדקת הקצב תתאפס)
//        --yes (לשלוח באמת)
// מ-GitHub: workflow ‏"מבחן עומס למנטור" (‏coach_load_test.yml), עם הסוד הקיים.
// ============================================================================
import { askSystemPrompt } from "../supabase/functions/_shared/coach/prompts.ts";

type Kind = "agent" | "team" | "office";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const LEVELS = String(args.levels ?? "1").split(",").map((x) => Math.max(1, Math.min(2000, Number(x) || 1)));
const MODEL = String(args.model ?? process.env.COACH_ASK_MODEL ?? "claude-sonnet-5-5");
const MAX_TOKENS = Math.max(50, Math.min(2000, Number(args["max-tokens"] ?? 600)));
const KIND = (["agent", "team", "office"].includes(String(args.kind)) ? args.kind : "agent") as Kind;
const PAUSE_S = Math.max(0, Number(args.pause ?? 60));
const GO = args.yes === "true";
const KEY = process.env.ANTHROPIC_API_KEY || "";

// שאלות אמיתיות-למראה, כדי שהפרקים לפי נושא ייבחרו כמו בפרודקשן
const QUESTIONS = [
  "מה להכין לפגישת גיוס מחר?",
  'איך עונים למוכר שאומר "אמכור לבד"?',
  "איך מוכרים שטח חקלאי?",
  "איך מסננים שוכר לנכס בניהול?",
  "מה בודקים לפני שמשווקים פרויקט של קבלן?",
  "איך מתמחרים נכס מסחרי מניב?",
];
// נתונים מצומצמים בגודל של מה ש-askCoach שולח
const DATA = JSON.stringify({
  latest_summary: { headline: "שבוע עם 3 פגישות גיוס", actions: [{ title: "לחזור ל-2 לידים", why: "", impact: "" }] },
  data: { last_7_days: { leads: 6, responded: 5, meetings: 3, listings: 1 }, last_30_days: { leads: 22, meetings: 9, listings: 3, deals: 1 } },
});

type Result = { ok: boolean; status: number; ms: number; inTok: number; outTok: number; cacheRead: number; retryAfter: string | null };
let limits: Record<string, string> = {};

async function one(i: number): Promise<Result> {
  const question = QUESTIONS[i % QUESTIONS.length];
  const t0 = performance.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: askSystemPrompt(KIND, "warm", null, question), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: DATA }, { type: "text", text: "השאלה: " + question }] }],
      }),
    });
    const ms = performance.now() - t0;
    for (const [k, v] of res.headers) if (k.startsWith("anthropic-ratelimit-")) limits[k] = v;
    const body = await res.json().catch(() => ({})) as { usage?: Record<string, number> };
    const u = body.usage ?? {};
    return {
      ok: res.ok, status: res.status, ms,
      inTok: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outTok: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, retryAfter: res.headers.get("retry-after"),
    };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - t0, inTok: 0, outTok: 0, cacheRead: 0, retryAfter: null };
  }
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const promptChars = askSystemPrompt(KIND, "warm", null, QUESTIONS.join("\n")).length;
const total = LEVELS.reduce((a, b) => a + b, 0);
console.log(`מבחן עומס למנטור · מודל ${MODEL} · ${KIND} · גלים: ${LEVELS.join(", ")} (סה"כ ${total} בקשות)`);
console.log(`פרומפט מערכת עד ~${promptChars.toLocaleString()} תווים לבקשה, תשובה עד ${MAX_TOKENS} טוקנים`);
if (!KEY) { console.error("חסר ANTHROPIC_API_KEY"); process.exit(2); }
if (!GO) { console.log("\nזו תוכנית בלבד. כל בקשה היא קריאה אמיתית למודל ועולה כסף - להרצה מוסיפים --yes."); process.exit(0); }

let failedLevel: number | null = null;
for (const [li, n] of LEVELS.entries()) {
  if (li > 0 && PAUSE_S) {
    console.log(`\n...המתנה ${PAUSE_S} שניות לאיפוס דקת הקצב`);
    await new Promise((r) => setTimeout(r, PAUSE_S * 1000));
  }
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: n }, (_, i) => one(i)));
  const wall = (performance.now() - t0) / 1000;
  const ok = rs.filter((r) => r.ok);
  const by = rs.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const lat = ok.map((r) => r.ms / 1000);
  console.log(`\n== ${n} בו-זמנית ==`);
  console.log(`הצליחו: ${ok.length}/${n} (${Math.round((100 * ok.length) / n)}%) · סטטוסים: ${JSON.stringify(by)} · זמן הגל: ${wall.toFixed(1)} ש'`);
  if (lat.length) console.log(`זמן תגובה: חציון ${pct(lat, 50).toFixed(1)} ש' · p95 ${pct(lat, 95).toFixed(1)} ש' · מקסימום ${pct(lat, 100).toFixed(1)} ש'`);
  console.log(`טוקנים: קלט ${rs.reduce((a, r) => a + r.inTok, 0).toLocaleString()} (מהמטמון ${rs.reduce((a, r) => a + r.cacheRead, 0).toLocaleString()}) · פלט ${rs.reduce((a, r) => a + r.outTok, 0).toLocaleString()}`);
  const ra = rs.find((r) => r.retryAfter)?.retryAfter;
  if (ra) console.log(`retry-after מהשרת: ${ra} ש'`);
  if (ok.length < n && failedLevel === null) failedLevel = n;
  if (by["401"] || by["403"]) { console.error("\nהמפתח נדחה (401/403) - עוצרים. בודקים את ANTHROPIC_API_KEY."); process.exit(1); }
}

console.log("\nמגבלות החשבון (מהכותרות של התשובה האחרונה):");
for (const [k, v] of Object.entries(limits).sort()) console.log(`  ${k.replace("anthropic-ratelimit-", "")}: ${v}`);
console.log(failedLevel === null
  ? "\nכל הגלים עברו בלי שגיאות."
  : `\nשגיאות החלו בגל של ${failedLevel}. בפרודקשן הספרייה מנסה שוב פעמיים, ואחר כך הסוכן/ת מקבל/ת "המנטור לא זמין כרגע".`);
