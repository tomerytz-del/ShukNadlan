// רישום זמני תור: צבירה, בניית השורה, השעון והדגל.
//   node --experimental-strip-types scripts/gabriela_turn_timing_test.ts
import { readFileSync } from "node:fs";
import {
  buildTimingRow, kindOfMessage, newTurnTiming, noteLlm, noteTool, recordTurnTiming,
  resetTimingFlagCache, setTurnClock, takeTurnClock,
} from "../supabase/functions/whatsapp-webhook/turn-timing.ts";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n  ${(err as Error).message}`);
  }
}
function eq(a: unknown, b: unknown, msg = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
}

await test("צבירת מודל וכלים, prep_ms מהקריאה הראשונה בלבד", () => {
  const t = newTurnTiming(1000);
  noteLlm(t, 3000, { input_tokens: 10, cache_read_input_tokens: 50000, output_tokens: 200 }, 5000);
  noteLlm(t, 2000, { input_tokens: 5, cache_creation_input_tokens: 7, output_tokens: 100 }, 12000);
  eq(t.prepMs, 1000, "prep");
  eq([t.llmMs, t.llmCalls, t.inTokens, t.cacheRead, t.cacheWrite, t.outTokens], [5000, 2, 15, 50000, 7, 300]);
  noteTool(t, "list_leads", 400);
  noteTool(t, "bad name; drop", 100);
  eq([t.toolMs, t.toolCalls, t.toolNames], [500, 2, ["list_leads"]], "tools");
});

await test("השורה: wait בלי תמלול, total מההגעה, בלי שדות מחוץ לרשימה", () => {
  const t = newTurnTiming(30_000);
  noteLlm(t, 1000, undefined, 32_000);
  const row = buildTimingRow({
    agentId: "a1", outcome: "ok", timing: t, turnStartedAt: 30_000, sendMs: 300, now: 40_000,
    clock: { arrivedAt: 10_000, transcribeMs: 6_000, kind: "voice" },
  });
  eq([row.kind, row.wait_ms, row.transcribe_ms, row.total_ms, row.send_ms], ["voice", 14_000, 6_000, 30_000, 300]);
  eq(Object.keys(row).sort(), [
    "agent_id", "cache_read", "cache_write", "in_tokens", "kind", "llm_calls", "llm_ms",
    "out_tokens", "outcome", "prep_ms", "send_ms", "tool_calls", "tool_ms", "tool_names", "total_ms",
    "transcribe_ms", "wait_ms",
  ].sort());
});

await test("בלי שעון: kind=other, wait ו-transcribe null, total מתחילת התור", () => {
  const t = newTurnTiming(5_000);
  const row = buildTimingRow({ agentId: "a1", outcome: "error", timing: t, clock: null, turnStartedAt: 5_000, now: 9_000 });
  eq([row.kind, row.wait_ms, row.transcribe_ms, row.total_ms], ["other", null, null, 4_000]);
});

await test("שעון: הודעה שנייה ברצף שומרת את ההגעה הראשונה ואת התמלול", () => {
  setTurnClock("z", { arrivedAt: 1_000, transcribeMs: 8_000, kind: "voice" });
  setTurnClock("z", { arrivedAt: 3_000, transcribeMs: null, kind: "text" });
  eq(takeTurnClock("z", 4_000), { arrivedAt: 1_000, transcribeMs: 8_000, kind: "voice" });
});

await test("שעון: נלקח פעם אחת, ופג אחרי 3 דקות", () => {
  setTurnClock("x", { arrivedAt: 1_000, transcribeMs: null, kind: "text" });
  eq(takeTurnClock("x", 2_000)?.kind, "text");
  eq(takeTurnClock("x", 2_000), null);
  setTurnClock("y", { arrivedAt: 1_000, transcribeMs: null, kind: "text" });
  eq(takeTurnClock("y", 1_000 + 4 * 60_000), null);
});

await test("סוגי הודעות", () => {
  eq([kindOfMessage("audio", true), kindOfMessage("audio", false), kindOfMessage("text", false),
    kindOfMessage("interactive", false), kindOfMessage("sticker", false)],
    ["voice", "audio_file", "text", "button", "other"]);
});

await test("הדגל: כבוי לא כותב, דולק כותב, כשל בכתיבה לא זורק", async () => {
  const inserted: unknown[] = [];
  const mk = (flag: number | null, flagErr = false, insertErr = false) => ({
    from: (table: string) => table === "pricing_config"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: flag === null ? null : { value: flag }, error: flagErr ? { message: "x" } : null }) }) }) }
      : { insert: async (r: unknown) => { inserted.push(r); return { error: insertErr ? { message: "boom" } : null }; } },
  });
  const row = buildTimingRow({ agentId: "a", outcome: "ok", timing: newTurnTiming(), clock: null, turnStartedAt: Date.now() });
  resetTimingFlagCache();
  await recordTurnTiming(mk(0), row);
  eq(inserted.length, 0, "flag off");
  resetTimingFlagCache();
  await recordTurnTiming(mk(null, true), row);
  eq(inserted.length, 0, "flag read error");
  resetTimingFlagCache();
  await recordTurnTiming(mk(1), row);
  eq(inserted.length, 1, "flag on");
  resetTimingFlagCache();
  await recordTurnTiming(mk(1, false, true), row); // לא זורק
});

await test("המיגרציה: RLS, הרשאות ל-service_role בלבד, ובלי עמודת תוכן", () => {
  const sql = readFileSync("supabase/migrations/20271201110000_gabriela_turn_timings.sql", "utf8");
  if (!/enable row level security/.test(sql)) throw new Error("no RLS");
  if (!/revoke all on table public\.gabriela_turn_timings from public, anon, authenticated/.test(sql)) throw new Error("revoke");
  const block = sql.match(/create table if not exists public\.gabriela_turn_timings \(([\s\S]*?)\n\);/)?.[1] || "";
  const cols = block.split("\n").map((l) => l.match(/^\s{2}([a-z_]+)\s+(bigint|timestamptz|uuid|text|integer|smallint)\b/)?.[1])
    .filter(Boolean).sort();
  eq(cols, ["agent_id", "cache_read", "cache_write", "created_at", "id", "in_tokens", "kind", "llm_calls", "llm_ms",
    "out_tokens", "outcome", "prep_ms", "send_ms", "tool_calls", "tool_ms", "tool_names", "total_ms", "transcribe_ms", "wait_ms"].sort(), "cols");
});

await test("agent.ts ו-index.ts מחוברים", () => {
  const agent = readFileSync("supabase/functions/whatsapp-webhook/agent.ts", "utf8");
  const index = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
  if (!/noteLlm\(opts\.timing/.test(agent) || !/noteTool\(opts\.timing/.test(agent)) throw new Error("agent");
  const email = readFileSync("supabase/functions/whatsapp-webhook/email-intake.ts", "utf8");
  if (!/timing,\n/.test(email) || !/kind: "email"/.test(email) || !/logTiming\(delivered \? "ok" : "error"/.test(email)) throw new Error("email");
  if (!/setTurnClock\(/.test(index) || !/recordTurnTiming\(/.test(index)) throw new Error("index");
});

await test("תצוגת השאלות החוזרות: service_role בלבד, security_invoker, וספירות בלבד", () => {
  const sql = readFileSync("supabase/migrations/20271202130000_gabriela_reask_report.sql", "utf8");
  if (!/with \(security_invoker = true\)/.test(sql)) throw new Error("security_invoker");
  if (!/revoke all on public\.gabriela_reask_report from public, anon, authenticated/.test(sql)) throw new Error("revoke");
  if (!/grant select on public\.gabriela_reask_report to service_role/.test(sql)) throw new Error("grant");
  const finalSelect = sql.slice(sql.lastIndexOf("select day,"), sql.indexOf("group by day"));
  if (/\b(agent_id|body|phone|wa_phone)\b/.test(finalSelect)) throw new Error("final select must be counts only");
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
