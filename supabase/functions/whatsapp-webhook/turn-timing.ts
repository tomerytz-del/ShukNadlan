// רישום זמנים לתור של גבריאלה. docs/gabriela-turn-timing.md
//
// בקובץ נפרד מ-agent.ts ומ-index.ts כדי שהבדיקה תרוץ בלי לטעון אותם.
// אין כאן תוכן הודעה, טלפון או טקסט: מספרים ושמות כלים בלבד.

export type TurnKind = "text" | "voice" | "audio_file" | "image" | "document" | "button" | "other";
export type TurnOutcome = "ok" | "error" | "aborted";

/** נצבר בתוך runAgentTurn (המודל והכלים). */
export type TurnTiming = {
  startedAt: number;
  /** מתחילת runAgentTurn עד תחילת הקריאה הראשונה למודל: טעינת פרופיל, כלים והיסטוריה */
  prepMs: number | null;
  llmMs: number;
  llmCalls: number;
  toolMs: number;
  toolCalls: number;
  toolNames: string[];
  inTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outTokens: number;
};

export function newTurnTiming(now = Date.now()): TurnTiming {
  return {
    startedAt: now, prepMs: null, llmMs: 0, llmCalls: 0, toolMs: 0, toolCalls: 0,
    toolNames: [], inTokens: 0, cacheRead: 0, cacheWrite: 0, outTokens: 0,
  };
}

export function noteLlm(t: TurnTiming, ms: number, usage: Record<string, number | undefined> | undefined, now = Date.now()) {
  if (t.prepMs === null) t.prepMs = Math.max(0, now - ms - t.startedAt);
  t.llmMs += ms;
  t.llmCalls += 1;
  t.inTokens += usage?.input_tokens ?? 0;
  t.cacheRead += usage?.cache_read_input_tokens ?? 0;
  t.cacheWrite += usage?.cache_creation_input_tokens ?? 0;
  t.outTokens += usage?.output_tokens ?? 0;
}

const MAX_TOOL_NAMES = 20;

export function noteTool(t: TurnTiming, name: string, ms: number) {
  t.toolMs += ms;
  t.toolCalls += 1;
  // שם כלי הוא טקסט שהמודל כותב: רק שם בצורה של מזהה, וחתוך
  if (t.toolNames.length < MAX_TOOL_NAMES && /^[a-z][a-z0-9_]{0,60}$/.test(name)) t.toolNames.push(name);
}

/** מה ש-handleMessage יודע ו-runAgentTurn לא: מתי ההודעה הגיעה, כמה זמן נמשך התמלול. */
export type TurnClock = { arrivedAt: number; transcribeMs: number | null; kind: TurnKind };

const clocks = new Map<string, TurnClock>();
// ארוך מחלון האיסוף (עד כמה שניות) ומהמתנה לנעילה (45 שניות), וקצר מספיק כדי ששעון שנשאר מהפעלה אחרת לא ייתפס
const CLOCK_TTL_MS = 3 * 60_000;

export function setTurnClock(agentId: string, clock: TurnClock) {
  // הודעה שנייה ברצף אינה מוחקת את הראשונה: ההמתנה נמדדת מהראשונה, והתמלול נצבר ונשאר סוג התור שלו
  const prev = clocks.get(agentId);
  if (prev && clock.arrivedAt - prev.arrivedAt <= CLOCK_TTL_MS) {
    const transcribeMs = prev.transcribeMs === null && clock.transcribeMs === null
      ? null
      : (prev.transcribeMs ?? 0) + (clock.transcribeMs ?? 0);
    clocks.set(agentId, {
      arrivedAt: prev.arrivedAt,
      transcribeMs,
      kind: prev.transcribeMs !== null ? prev.kind : clock.kind,
    });
  } else {
    clocks.set(agentId, clock);
  }
  if (clocks.size > 500) {
    for (const [k, v] of clocks) if (Date.now() - v.arrivedAt > CLOCK_TTL_MS) clocks.delete(k);
  }
}

/** לוקח ומנקה. null כשהתור רץ בהפעלה אחרת של הפונקציה, או שהשעון ישן מדי. */
export function takeTurnClock(agentId: string, now = Date.now()): TurnClock | null {
  const c = clocks.get(agentId) || null;
  clocks.delete(agentId);
  return c && now - c.arrivedAt <= CLOCK_TTL_MS ? c : null;
}

export function kindOfMessage(type: unknown, voice: boolean): TurnKind {
  switch (String(type)) {
    case "text": return "text";
    case "audio": return voice ? "voice" : "audio_file";
    case "image": return "image";
    case "document": return "document";
    case "interactive": case "button": return "button";
    default: return "other";
  }
}

const clampMs = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Math.min(3_600_000, Math.max(0, Math.round(n)));

export type TimingRow = ReturnType<typeof buildTimingRow>;

export function buildTimingRow(opts: {
  agentId: string;
  outcome: TurnOutcome;
  timing: TurnTiming;
  clock: TurnClock | null;
  turnStartedAt: number;
  sendMs?: number | null;
  now?: number;
}) {
  const now = opts.now ?? Date.now();
  const { timing: t, clock } = opts;
  const origin = clock ? clock.arrivedAt : opts.turnStartedAt;
  return {
    agent_id: opts.agentId,
    kind: clock?.kind ?? "other",
    outcome: opts.outcome,
    wait_ms: clock ? clampMs(opts.turnStartedAt - clock.arrivedAt - (clock.transcribeMs ?? 0)) : null,
    transcribe_ms: clampMs(clock?.transcribeMs),
    prep_ms: clampMs(t.prepMs),
    llm_ms: clampMs(t.llmMs),
    llm_calls: Math.min(32767, t.llmCalls),
    tool_ms: clampMs(t.toolMs),
    tool_calls: Math.min(32767, t.toolCalls),
    tool_names: t.toolNames.slice(0, MAX_TOOL_NAMES),
    in_tokens: t.inTokens,
    cache_read: t.cacheRead,
    cache_write: t.cacheWrite,
    out_tokens: t.outTokens,
    send_ms: clampMs(opts.sendMs),
    total_ms: clampMs(now - origin),
  };
}

// deno-lint-ignore no-explicit-any
type Sb = { from: (table: string) => any };

let flagCache: { at: number; on: boolean } | null = null;
const FLAG_TTL_MS = 5 * 60_000;

export async function timingEnabled(sb: Sb, now = Date.now()): Promise<boolean> {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  const { data, error } = await sb.from("pricing_config").select("value")
    .eq("key", "gabriela_turn_timing_enabled").maybeSingle();
  // כשל בקריאה: לא כותבים, ולא שומרים במטמון (ננסה שוב בתור הבא)
  if (error) return false;
  const on = Number(data?.value) === 1;
  flagCache = { at: now, on };
  return on;
}

/** כתיבה בלי להפיל את התור: כשל ברישום אינו כשל של גבריאלה. */
export async function recordTurnTiming(sb: Sb, row: TimingRow): Promise<void> {
  try {
    if (!(await timingEnabled(sb))) return;
    const { error } = await sb.from("gabriela_turn_timings").insert(row);
    if (error) console.error("turn timing insert failed", error.message);
  } catch (err) {
    console.error("turn timing failed", err);
  }
}

export function resetTimingFlagCache() {
  flagCache = null;
}
