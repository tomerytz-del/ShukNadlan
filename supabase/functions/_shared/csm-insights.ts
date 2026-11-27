// ============================================================================
// _shared/csm-insights.ts — הניתוח הכולל של שיחות ההטמעה (I/O)
//
// רץ ברקע מ-csm-workspace (action = insights_report) ומעדכן שורה ב-
// csm_insight_reports (processing ← done | failed). הקלט: הריכוז מ-
// csm_insights_overview, ציטוטים לפי סוג בעיה, והערות על התסריט מהשיחות האחרונות.
// הפורמט והניקוי ב-csm-insights-format.ts. docs/csm-adoption.md.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CSM_ANALYSIS_MODEL, forcedToolCall } from "./csm-model.ts";
import { cleanInsightsReport, csmInsightsSystem, INSIGHTS_TOOL, MIN_REVIEWED_CALLS } from "./csm-insights-format.ts";

const MODEL = CSM_ANALYSIS_MODEL("CSM_INSIGHTS_MODEL");

async function finish(service: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await service.from("csm_insight_reports").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}

export async function runInsightsReport(service: SupabaseClient, reportId: string, days: number): Promise<void> {
  const fail = (error: string) => finish(service, reportId, { status: "failed", error });
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail("הניתוח הכולל עדיין לא מופעל.");

  const { data: overview, error: ovErr } = await service.rpc("csm_insights_overview", { p_days: days });
  if (ovErr || !overview) return fail("לא הצלחתי לקרוא את ריכוז השיחות.");
  const reviewed = Number((overview as Record<string, unknown>).calls_reviewed) || 0;
  if (reviewed < MIN_REVIEWED_CALLS) {
    return fail(`יש רק ${reviewed} שיחות מנותחות בטווח. לניתוח כולל צריך לפחות ${MIN_REVIEWED_CALLS}.`);
  }
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const [{ data: quotes }, { data: reviews }] = await Promise.all([
    service.from("csm_call_insights").select("kind, problem_type, solution_type, outcome, text, reply, competitor")
      .in("kind", ["objection", "question"]).gte("created_at", since).order("created_at", { ascending: false }).limit(260),
    service.from("csm_calls").select("review").not("review", "is", null).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(40),
  ]);
  // לכל סוג בעיה עד שישה ציטוטים: מספיק כדי לראות דפוס, בלי לשלם על כל שורה
  const byType: Record<string, unknown[]> = {};
  for (const q of (quotes as Record<string, unknown>[] | null) ?? []) {
    const k = `${q.kind}:${q.problem_type}`;
    (byType[k] ??= []).length < 6 && byType[k].push({ text: q.text, outcome: q.outcome, solution: q.solution_type, reply: q.reply });
  }
  const reviewed_ = ((reviews as { review: { script_notes?: unknown[]; verdict?: string } }[] | null) ?? []).map((r) => r.review);
  const scriptNotes = reviewed_.flatMap((r) => (r.script_notes ?? []).slice(0, 4)).slice(0, 80);
  const verdicts = reviewed_.map((r) => r.verdict).filter(Boolean).slice(0, 25);

  const res = await forcedToolCall({
    feature: "csm_insights", model: MODEL, maxTokens: 6000, system: csmInsightsSystem(), tool: INSIGHTS_TOOL,
    content: "ריכוז השיחות:\n" + JSON.stringify({ overview, quotes_by_type: byType, script_notes: scriptNotes, call_verdicts: verdicts }).slice(0, 90000),
  });
  if ("error" in res) return fail("הניתוח הכולל נכשל. אפשר לנסות שוב בעוד כמה דקות.");
  const report = cleanInsightsReport(res.input);
  if (!report) return fail("הניתוח הכולל יצא ריק. אפשר לנסות שוב.");
  await finish(service, reportId, { status: "done", error: null, report, calls_count: reviewed });
}
