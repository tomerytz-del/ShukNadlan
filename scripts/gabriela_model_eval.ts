// ============================================================================
// gabriela_model_eval.ts — השוואת מודלים לגבריאלה מול הפרומפט האמיתי
// (docs/platform-costs.md, "המטמון של גבריאלה" ← "מעבר מודל")
//
// מה נבדק: אותן בקשות טיפוסיות של סוכן/ת נשלחות לכל מודל, עם הכלים וההוראות
// של agent.ts כמו שהם, עד שלושה סבבים. **כלים לא רצים**: כל קריאה מקבלת תוצאה
// מדומה ("סביבת בדיקה"), ולכן אין כתיבה למסד, אין וואטסאפ ואין נתוני לקוחות.
// הנקודות השבורות שמחפשים במעבר ל-Opus 5.5: 400 (חשיבה שאי אפשר לכבות,
// ‏tool_choice כפוי, בלוקי חשיבה שנקשרו לשיחה), בחירת כלי שונה, ועלות וזמן.
//
// **עולה כסף** (כ-$2-4 לריצה מלאה), ולכן בלי --yes רק מדפיס תוכנית.
//
//   ANTHROPIC_API_KEY=... deno run -A scripts/gabriela_model_eval.ts \
//     --models=claude-opus-5,claude-opus-5-5 --yes
//
// מ-GitHub: workflow "גבריאלה - השוואת מודלים" (‏gabriela_model_eval.yml).
// ============================================================================
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { evalPromptParts } from "../supabase/functions/whatsapp-webhook/agent.ts";
import { RollingMarks } from "../supabase/functions/whatsapp-webhook/prompt-cache.ts";

const args = Object.fromEntries(
  Deno.args.map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const { tools, system } = evalPromptParts();
const MODELS = String(args.models ?? "claude-opus-5,claude-opus-5-5").split(",").map((s) => s.trim()).filter(Boolean);
const GO = args.yes === "true";
const MAX_ITER = 3;

// מחירים לחישוב העלות - אותם של ai_model_prices (דולר למיליון)
const PRICES: Record<string, { in: number; out: number; read: number; w5: number; w1: number }> = {
  "claude-opus-5": { in: 5, out: 25, read: 0.5, w5: 6.25, w1: 10 },
  "claude-opus-5-5": { in: 4, out: 20, read: 0.2, w5: 5, w1: 8 },
  // קריאה ממטמון: $0.10 (0.05 ממחיר הקלט $2), מחירון Anthropic מ-7.10.2026.
  // הכתיבה נשארת $2.50 / $4. אותו מספר במיגרציה 20271028110000.
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.1, w5: 2.5, w1: 4 },
};

// בקשה, והכלים שתשובה ראשונה סבירה בוחרת (ריק = תשובה בלי כלי)
const CASES: Array<{ text: string; expect: string[] }> = [
  { text: "תוסיף נכס: דירת 4 חדרים למכירה בעפולה, רחוב הנרקיס 7, קומה 3, 1.8 מליון", expect: ["create_property", "search_properties"] },
  { text: "כמה נכסים פעילים יש לי?", expect: ["property_stats"] },
  { text: "תעדכן את המחיר של הנכס בהנרקיס 7 ל-1.75 מליון", expect: ["search_properties", "list_properties", "update_property"] },
  { text: "תוסיף לקוח: רונית לוי, מחפשת 4 חדרים בעפולה עד 1.6 מליון, 050-1234567", expect: ["create_client", "list_clients"] },
  { text: "מה ההתאמות לרונית לוי?", expect: ["list_clients", "client_matches"] },
  { text: "תזכיר לי מחר ב-10 בבוקר להתקשר לרונית", expect: ["agenda_add"] },
  { text: "מה יש לי ביומן השבוע?", expect: ["agenda_list"] },
  { text: "יש לידים חדשים מהיום?", expect: ["list_leads"] },
  { text: "תכין הסכם בלעדיות למכירה לנכס בהנרקיס 7", expect: ["search_properties", "list_properties", "prepare_agreement"] },
  { text: "שאלה למנטור: איך עונים ללקוח שאומר שהעמלה גבוהה מדי?", expect: ["ask_mentor"] },
  { text: "כמה עולה מטר בממוצע ברחוב הנרקיס בעפולה?", expect: ["market_deals_lookup", "cma_report"] },
  // נכס שאינו במערכת: דוח לכתובת, ולא רשימת עסקאות לפי שם הרחוב (25.10.2026)
  { text: "תכין לי דוח cma לכתובת רוטשילד 1 בראשון לציון", expect: ["search_properties", "list_properties", "cma_report_address"] },
  { text: "מה המייל שלך?", expect: [] },
];

type Row = {
  model: string; case: number; tools: string[]; ok: boolean; firstOk: boolean;
  error?: string; usd: number; ms: number; calls: number; stop?: string; text?: string;
};

function costOf(model: string, u: Record<string, number | undefined> & { cache_creation?: Record<string, number> }) {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  const w = u.cache_creation_input_tokens ?? 0;
  const w1 = Math.min(w, u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  return ((u.input_tokens ?? 0) * p.in + (u.cache_read_input_tokens ?? 0) * p.read +
    (w - w1) * p.w5 + w1 * p.w1 + (u.output_tokens ?? 0) * p.out) / 1e6;
}

async function runCase(client: Anthropic, model: string, idx: number): Promise<Row> {
  const c = CASES[idx];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: c.text }];
  const rolling = new RollingMarks();
  const row: Row = { model, case: idx, tools: [], ok: true, firstOk: false, usd: 0, ms: 0, calls: 0 };
  const t0 = performance.now();
  try {
    for (let i = 0; i < MAX_ITER; i++) {
      // אותם פרמטרים כמו runAgentTurn: effort medium, ‏max_tokens 4096, ‏ttl של שעה
      const res = await client.messages.create({
        model,
        max_tokens: 4096,
        output_config: { effort: "medium" },
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: "סביבת בדיקה: הסוכן/ת בדיקה, משרד בדיקה, עפולה. תוצאות הכלים מדומות." },
        ],
        tools,
        messages,
      } as unknown as Anthropic.MessageCreateParamsNonStreaming);
      row.calls++;
      row.usd += costOf(model, res.usage as never);
      row.stop = res.stop_reason ?? undefined;
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (i === 0) {
        const first = uses.map((u) => u.name);
        row.firstOk = c.expect.length ? first.some((n) => c.expect.includes(n)) : first.length === 0;
      }
      row.tools.push(...uses.map((u) => u.name));
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
      if (text) row.text = text.slice(0, 140);
      if (!uses.length) break;
      messages.push({ role: "assistant", content: res.content });
      const results = uses.map((u) => ({
        type: "tool_result" as const,
        tool_use_id: u.id,
        content: JSON.stringify({ stub: true, note: "סביבת בדיקה - אין נתונים. סיים/י בתשובה קצרה לסוכן/ת." }),
      }));
      const last = results[results.length - 1];
      if (i < MAX_ITER - 1) rolling.add(last as never);
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    row.ok = false;
    row.error = err instanceof Anthropic.APIError ? `${err.status} ${String(err.message).slice(0, 160)}` : String(err).slice(0, 160);
  }
  row.ms = performance.now() - t0;
  return row;
}

console.log(`השוואת מודלים לגבריאלה · ${MODELS.join(" מול ")} · ${CASES.length} בקשות · עד ${MAX_ITER} סבבים`);
console.log(`פרומפט: ${tools.length} כלים, ${system.length.toLocaleString()} תווי הוראות`);
if (!GO) {
  console.log("זו תוכנית בלבד. כל בקשה היא קריאה אמיתית למודל ועולה כסף - להרצה מוסיפים --yes.");
  Deno.exit(0);
}
const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
if (!key) {
  console.error("חסר ANTHROPIC_API_KEY");
  Deno.exit(2);
}
const client = new Anthropic({ apiKey: key });

const rows: Row[] = [];
for (const model of MODELS) {
  // ברצף ולא במקביל: הבקשה הראשונה כותבת את המטמון, והשאר קוראות - כמו בפרודקשן
  for (let i = 0; i < CASES.length; i++) {
    const r = await runCase(client, model, i);
    rows.push(r);
    console.log(`${model} #${i + 1}: ${r.ok ? "✓" : "✗ " + r.error} · כלים: ${r.tools.join(", ") || "-"} · ` +
      `${r.firstOk ? "בחירה ראשונה תקינה" : "בחירה ראשונה שונה מהצפוי"} · $${r.usd.toFixed(4)} · ${(r.ms / 1000).toFixed(1)} ש'`);
  }
}

const lines = ["", "| מודל | הצליחו | בחירה ראשונה תקינה | עלות (בלי הראשונה) | עלות ממוצעת לבקשה | זמן ממוצע |", "| --- | --- | --- | --- | --- | --- |"];
for (const model of MODELS) {
  const rs = rows.filter((r) => r.model === model);
  const warm = rs.slice(1);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  lines.push(`| ${model} | ${rs.filter((r) => r.ok).length}/${rs.length} | ${rs.filter((r) => r.firstOk).length}/${rs.length} | ` +
    `$${warm.reduce((a, r) => a + r.usd, 0).toFixed(3)} | $${avg(warm.map((r) => r.usd)).toFixed(4)} | ${(avg(rs.map((r) => r.ms)) / 1000).toFixed(1)} ש' |`);
}
const diff = CASES.map((_, i) => {
  const per = MODELS.map((m) => rows.find((r) => r.model === m && r.case === i));
  const names = per.map((r) => (r?.tools[0] ?? "-"));
  return new Set(names).size > 1 ? `- #${i + 1} "${CASES[i].text.slice(0, 40)}": ${MODELS.map((m, j) => `${m}=${names[j]}`).join(" · ")}` : "";
}).filter(Boolean);
lines.push("", diff.length ? "**בחירה ראשונה שונה בין המודלים:**\n" + diff.join("\n") : "**כל המודלים בחרו אותו כלי ראשון בכל הבקשות.**");
console.log(lines.join("\n"));
const summary = Deno.env.get("GITHUB_STEP_SUMMARY");
if (summary) await Deno.writeTextFile(summary, lines.join("\n") + "\n", { append: true });
if (rows.some((r) => !r.ok)) Deno.exit(1);
