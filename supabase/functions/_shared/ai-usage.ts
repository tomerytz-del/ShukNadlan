// ============================================================================
// ai-usage.ts — יומן השימוש במודלים, לפירוט העלות בפאנל "עלויות"
// (docs/platform-costs.md, "עלות AI לפי יכולת")
//
// כל קריאה למודל שאינה של המנטור (שלו יש יומנים משלו) כותבת כאן שורה אחת:
// איזו יכולת, איזה מודל, וכמה טוקנים מכל סוג. ‏ai_usage_costs מכפילה במחירון.
//
// **לעולם לא מפיל את הקורא:** כשל כתיבה נבלע ונרשם ללוג, כי התשובה כבר שולמה
// והגיעה, וזה רק פירוט. ובזמן ריצה של Supabase הכתיבה נדחית ל-waitUntil, כדי
// שתור של גבריאלה לא יחכה לה.
//
// ‏`usage` הוא האובייקט כמו שהספק החזיר אותו:
//   Anthropic: ‏input_tokens (בלי מטמון), cache_read_input_tokens,
//              cache_creation_input_tokens + cache_creation.ephemeral_1h_input_tokens
//   Gemini:    usageMetadata (‏promptTokenCount, candidatesTokenCount, thoughtsTokenCount)
//   יחידות:    ‏{ units } - Whisper בדקות
// ============================================================================

export type AiFeature =
  | "gabriela_agent"
  | "gabriela_public"
  | "gabriela_agent_warm"
  | "gabriela_public_warm"
  | "media_extract"
  | "marketing_copy"
  | "ads_copy"
  | "call_summary"
  | "transcribe"
  | "image_classify"
  | "image_visualize"
  | "showcase_branding"
  | "lead_analyzer"
  | "news_analyzer";

export type AiUsageRow = {
  feature: AiFeature;
  provider: "anthropic" | "google" | "openai";
  model: string;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_write_1h_tokens: number;
  output_tokens: number;
  units: number | null;
  agency_id: string | null;
  agent_id: string | null;
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** שורה מ-usage של Anthropic. כתיבה למטמון של שעה מתומחרת אחרת (פי 2 ולא 1.25). */
export function anthropicRow(
  feature: AiFeature,
  model: string,
  // deno-lint-ignore no-explicit-any
  usage: any,
  ids: { agency_id?: string | null; agent_id?: string | null } = {},
): AiUsageRow {
  const u = usage ?? {};
  const write = n(u.cache_creation_input_tokens);
  const write1h = Math.min(write, n(u.cache_creation?.ephemeral_1h_input_tokens));
  return {
    feature, provider: "anthropic", model: String(model || ""),
    uncached_input_tokens: n(u.input_tokens),
    cache_read_tokens: n(u.cache_read_input_tokens),
    cache_write_tokens: write - write1h,
    cache_write_1h_tokens: write1h,
    output_tokens: n(u.output_tokens),
    units: null, agency_id: ids.agency_id ?? null, agent_id: ids.agent_id ?? null,
  };
}

/** שורה מ-usageMetadata של Gemini. החשיבה מתומחרת כפלט. */
// deno-lint-ignore no-explicit-any
export function geminiRow(feature: AiFeature, model: string, meta: any): AiUsageRow {
  const m = meta ?? {};
  return {
    feature, provider: "google", model: String(model || ""),
    uncached_input_tokens: Math.max(0, n(m.promptTokenCount) - n(m.cachedContentTokenCount)),
    cache_read_tokens: n(m.cachedContentTokenCount),
    cache_write_tokens: 0, cache_write_1h_tokens: 0,
    output_tokens: n(m.candidatesTokenCount) + n(m.thoughtsTokenCount),
    units: null, agency_id: null, agent_id: null,
  };
}

/** שורה ליחידות (דקות תמלול). */
export function unitsRow(
  feature: AiFeature,
  provider: AiUsageRow["provider"],
  model: string,
  units: number,
  ids: { agency_id?: string | null; agent_id?: string | null } = {},
): AiUsageRow {
  return {
    feature, provider, model, uncached_input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    cache_write_1h_tokens: 0, output_tokens: 0, units: Math.max(0, Number(units) || 0),
    agency_id: ids.agency_id ?? null, agent_id: ids.agent_id ?? null,
  };
}

async function insert(row: AiUsageRow): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const url = env?.get("SUPABASE_URL");
  const key = env?.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/rest/v1/ai_usage_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("ai usage log failed", res.status, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error("ai usage log failed", (err as Error).message);
  }
}

/** כותב שורה ליומן. לא זורק, ולא מעכב את התשובה כשיש waitUntil. */
export function logAiUsage(row: AiUsageRow): Promise<void> {
  if (!row.model) return Promise.resolve();
  const p = insert(row);
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(p);
    return Promise.resolve();
  }
  return p;
}
