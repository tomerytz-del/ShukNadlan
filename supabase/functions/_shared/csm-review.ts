// ============================================================================
// _shared/csm-review.ts — המנטור עובר על הקלטת שיחה של צוות ההטמעה
//
// צעד נפרד אחרי processCsmCall: הסיכום הרגיל כבר שמור והודעת הוואטסאפ כבר יצאה,
// וכאן המנטור (עם רשימת היכולות ועם הכללים על חלופות) מזהה התנגדויות ושאלות,
// מציע תשובות, ושומר אותן גם כשורות מנורמלות (csm_call_insights) לריכוז.
// **לא נכשל בקול:** תקלה כאן לא משנה את מצב השיחה - מחזירה הודעה בעברית.
// הפורמט, הרשימות הסגורות והניקוי ב-csm-review-format.ts. docs/csm-adoption.md.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { anthropicRow, logAiUsage } from "./ai-usage.ts";
import { csmAgentCard } from "./csm-call.ts";
import { type CallReview, cleanCallReview, csmReviewSystem, REVIEW_TOOL, reviewInsightRows } from "./csm-review-format.ts";

const MODEL = Deno.env.get("CSM_REVIEW_MODEL") || Deno.env.get("CSM_CALL_MODEL") || Deno.env.get("COACH_ASK_MODEL") || "claude-sonnet-5-5";

export type ReviewResult = { ok: true; review: CallReview } | { ok: false; error: string };

export async function reviewCsmCall(service: SupabaseClient, callId: string): Promise<ReviewResult> {
  const { data: call } = await service.from("csm_calls")
    .select("id, staff_id, agent_id, transcript").eq("id", callId).maybeSingle();
  if (!call) return { ok: false, error: "השיחה לא נמצאה." };
  if (!call.transcript) return { ok: false, error: "אין תמלול לשיחה הזו, ולכן אין מה לנתח." };
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return { ok: false, error: "ניתוח המנטור עדיין לא מופעל." };

  const card = call.agent_id ? await csmAgentCard(service, call.agent_id as string) : null;
  let response: Anthropic.Messages.Message;
  try {
    response = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "" }).messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: csmReviewSystem(), cache_control: { type: "ephemeral" } }],
      tools: [REVIEW_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: REVIEW_TOOL.name },
      messages: [{
        role: "user",
        content: (card ? "כרטיס הסוכן/ת: " + JSON.stringify(card) + "\n\n" : "") +
          "התמלול:\n" + String(call.transcript).slice(0, 120000),
      }],
    });
  } catch (err) {
    console.error("csm call review failed", err instanceof Anthropic.APIError ? err.status : "network");
    return { ok: false, error: "ניתוח המנטור נכשל. אפשר לנסות שוב בעוד כמה דקות." };
  }
  logAiUsage(anthropicRow("csm_review", response.model || MODEL, response.usage));
  const use = response.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  const review = cleanCallReview(use?.input);
  if (!review) return { ok: false, error: "ניתוח המנטור יצא ריק. אפשר לנסות שוב." };

  const { error: upErr } = await service.from("csm_calls")
    .update({ review, reviewed_at: new Date().toISOString() }).eq("id", callId);
  if (upErr) {
    console.error("csm review save failed", upErr.message);
    return { ok: false, error: "הניתוח הושלם אבל לא נשמר. אפשר לנסות שוב." };
  }
  // ניתוח חוזר מחליף את הקודם: אותה שיחה לא נספרת פעמיים בריכוז
  await service.from("csm_call_insights").delete().eq("call_id", callId);
  const rows = reviewInsightRows(review).map((r) => ({ ...r, call_id: callId, staff_id: call.staff_id, agent_id: call.agent_id }));
  if (rows.length) {
    const { error: insErr } = await service.from("csm_call_insights").insert(rows);
    if (insErr) console.error("csm insights insert failed", insErr.message);
  }
  return { ok: true, review };
}
