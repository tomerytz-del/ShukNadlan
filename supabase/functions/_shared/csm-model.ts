// ============================================================================
// _shared/csm-model.ts - קריאה אחת למודל עם כלי כפוי, לניתוחי ההטמעה (csm-review, csm-insights)
//
// הלקוח, ה-system במטמון, ה-tool_choice, הרישום לעלויות ומציאת ה-tool_use - במקום אחד. כשל ברשת או
// ב-API מחזיר { error } (ולא זורק), כי אף אחד מהקוראים לא משנה מצב שיחה בגללו. docs/csm-adoption.md.
// ============================================================================
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { type AiFeature, anthropicRow, logAiUsage } from "./ai-usage.ts";

export const CSM_ANALYSIS_MODEL = (override: string) =>
  Deno.env.get(override) || Deno.env.get("COACH_ASK_MODEL") || "claude-sonnet-5-5";

export async function forcedToolCall(o: {
  feature: AiFeature; model: string; maxTokens: number; system: string; tool: { name: string }; content: string;
}): Promise<{ input: unknown } | { error: true }> {
  try {
    const response = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "" }).messages.create({
      model: o.model,
      max_tokens: o.maxTokens,
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      tools: [o.tool as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: o.tool.name },
      messages: [{ role: "user", content: o.content }],
    });
    logAiUsage(anthropicRow(o.feature, response.model || o.model, response.usage));
    const use = response.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
    return { input: use?.input };
  } catch (err) {
    console.error(`${o.feature} model call failed`, err instanceof Anthropic.APIError ? err.status : "network");
    return { error: true };
  }
}
