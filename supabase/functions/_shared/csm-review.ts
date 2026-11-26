// ============================================================================
// _shared/csm-review.ts - המנטור עובר על הקלטת שיחה של צוות ההטמעה
//
// צעד נפרד אחרי processCsmCall: הסיכום והוואטסאפ כבר יצאו, וכאן המנטור (עם רשימת היכולות וכללי
// החלופות) מזהה התנגדויות ושאלות, מציע תשובות ושומר גם שורות מנורמלות (csm_call_insights).
// **לא נכשל בקול:** תקלה לא משנה את מצב השיחה - היא נרשמת ב-csm_calls.review_error ומוצגת עם
// "ניתוח חוזר". עלות: קריאה שנייה על אותו תמלול (הפרומפט שונה: יכולות וחלופות), ולכן נפרדת ולא
// מאוחדת עם הסיכום. הפורמט והניקוי ב-csm-review-format.ts. docs/csm-adoption.md.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { csmAgentCard, processCsmCall } from "./csm-call.ts";
import { CSM_ANALYSIS_MODEL, forcedToolCall } from "./csm-model.ts";
import { type CallReview, cleanCallReview, csmReviewSystem, REVIEW_TOOL, reviewInsightRows } from "./csm-review-format.ts";

const MODEL = CSM_ANALYSIS_MODEL("CSM_REVIEW_MODEL");

export type ReviewResult = { ok: true; review: CallReview } | { ok: false; error: string };

/* הכשל נשמר עם הסיבה. העמודה נוספה במיגרציה, ולכן שגיאת כתיבה (מסד בלעדיה) לא נחשבת */
async function failReview(service: SupabaseClient, callId: string, error: string): Promise<ReviewResult> {
  await service.from("csm_calls").update({ review_error: error }).eq("id", callId);
  return { ok: false, error };
}

/** ניתוח המנטור לשיחה. card: כרטיס הסוכן/ת אם כבר נקרא (processCsmCall), אחרת נקרא כאן. */
export async function reviewCsmCall(
  service: SupabaseClient, callId: string, card?: Record<string, unknown> | null,
): Promise<ReviewResult> {
  const { data: call } = await service.from("csm_calls")
    .select("id, staff_id, agent_id, transcript").eq("id", callId).maybeSingle();
  if (!call) return { ok: false, error: "השיחה לא נמצאה." };
  if (!call.transcript) return { ok: false, error: "אין תמלול לשיחה הזו, ולכן אין מה לנתח." };
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return failReview(service, callId, "ניתוח המנטור עדיין לא מופעל.");

  const agentCard = card !== undefined ? card : call.agent_id ? await csmAgentCard(service, call.agent_id as string) : null;
  const res = await forcedToolCall({
    feature: "csm_review", model: MODEL, maxTokens: 4000, system: csmReviewSystem(), tool: REVIEW_TOOL,
    content: (agentCard ? "כרטיס הסוכן/ת: " + JSON.stringify(agentCard) + "\n\n" : "") +
      "התמלול:\n" + String(call.transcript).slice(0, 120000),
  });
  if ("error" in res) return failReview(service, callId, "ניתוח המנטור נכשל. אפשר לנסות שוב בעוד כמה דקות.");
  const review = cleanCallReview(res.input);
  if (!review) return failReview(service, callId, "ניתוח המנטור יצא ריק. אפשר לנסות שוב.");

  const { error: upErr } = await service.from("csm_calls")
    .update({ review, reviewed_at: new Date().toISOString() }).eq("id", callId);
  if (upErr) {
    console.error("csm review save failed", upErr.message);
    return failReview(service, callId, "הניתוח הושלם אבל לא נשמר. אפשר לנסות שוב.");
  }
  await service.from("csm_calls").update({ review_error: null }).eq("id", callId);
  // ניתוח חוזר מחליף את הקודם: אותה שיחה לא נספרת פעמיים בריכוז
  await service.from("csm_call_insights").delete().eq("call_id", callId);
  const rows = reviewInsightRows(review).map((r) => ({ ...r, call_id: callId, staff_id: call.staff_id, agent_id: call.agent_id }));
  if (rows.length) {
    const { error: insErr } = await service.from("csm_call_insights").insert(rows);
    if (insErr) console.error("csm insights insert failed", insErr.message);
  }
  return { ok: true, review };
}

/** תמלול וסיכום, ואז ניתוח המנטור. הניתוח לעולם לא זורק ולא משנה את תוצאת הסיכום. */
export async function processAndReviewCsmCall(service: SupabaseClient, callId: string) {
  const res = await processCsmCall(service, callId);
  if (res.ok) await reviewCsmCall(service, callId, res.card).catch((e) => console.error("csm review threw", e));
  return res;
}
