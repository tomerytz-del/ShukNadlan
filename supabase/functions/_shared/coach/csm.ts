// ============================================================================
// _shared/coach/csm.ts — מנטור ההטמעה: שאלה חופשית של צוות ההטמעה
//
// מנטור נפרד משלושת המנטורים של הסוכנים: אין לו סיכום יומי ואין לו כפתורים,
// והנתונים שלו הם תיק ההטמעה כולו (csm_agents_overview). שני ערוצים:
// ‏csm-workspace (‏action = ask_mentor, הלשונית "המנטור" ב-/csm) ו-csm_ask_mentor
// של גבריאלה מול הצוות (whatsapp-webhook/csm-chat.ts). **הזהות היא תמיד
// csm_staff.id של מי שזוהה/תה** (JWT או טלפון), לא פרמטר. docs/csm-adoption.md.
//
// מה יוצא למודל: שמות משרדים וסוכנים (ציבוריים באתר), עיר, מסלול, השלב
// בצנרת ומספרי שימוש. **לא** טלפון, מייל, כתובת או ת.ז. - המנטור ממליץ את מי
// להתחיל ואיך, ומנהלת ההטמעה רואה את פרטי הקשר במסך.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { askHistory, cleanAnswer, cleanQuestion, type Row, splitGap } from "./payload.ts";
import { CSM_SYSTEM, csmPortfolio, num } from "./csm-prompt.ts";
import { anthropicRow, logAiUsage } from "../ai-usage.ts";

const MODEL = Deno.env.get("COACH_ASK_MODEL") || "claude-sonnet-5-5";
// צוות ההטמעה שואל/ת יותר מסוכן/ת - זה כלי העבודה שלו/ה. חלון של 24 שעות.
export const CSM_DAILY = Math.max(1, Number(Deno.env.get("COACH_CSM_DAILY")) || 30);

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  return client ??= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "" });
}

export type CsmAskResult =
  | { answer: string; remaining: number }
  | { error: string; status: number; remaining?: number };

/* ‏staffId: csm_staff.id שהקורא/ת כבר זיהה/תה (‏JWT ב-csm-workspace, טלפון
   בגבריאלה). כאן נבדק רק שהשורה פעילה. */
export async function askCsmMentor(
  service: SupabaseClient, staffId: string, rawQuestion: unknown, channel: "web" | "whatsapp" = "web",
): Promise<CsmAskResult> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return { error: "coach_unavailable", status: 503 };
  const question = cleanQuestion(rawQuestion);
  if (question.length < 3) return { error: "bad_question", status: 400 };
  const { data: me } = await service.from("csm_staff").select("id, active").eq("id", staffId).maybeSingle();
  if (!me || !me.active) return { error: "not_allowed", status: 403 };

  const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since12 = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const [{ count: used, error: usedErr }, { data: past }, overview, fb] = await Promise.all([
    service.from("csm_mentor_questions").select("id", { count: "exact", head: true })
      .eq("staff_id", me.id).gte("created_at", since24),
    service.from("csm_mentor_questions").select("question, answer")
      .eq("staff_id", me.id).gte("created_at", since12)
      .order("created_at", { ascending: false }).limit(3),
    service.rpc("csm_agents_overview"),
    service.from("csm_feedback").select("title, category, severity, csm_feedback_votes(count)")
      .in("status", ["open", "planned", "in_progress"]).limit(200),
  ]);
  if (usedErr || overview.error) return { error: "db_error", status: 500 };
  if (Number(used) >= CSM_DAILY) return { error: "coach_ask_quota", status: 429, remaining: 0 };

  const feedback = ((fb.data as Row[] | null) ?? [])
    .map((f) => ({ ...f, votes: num(((f.csm_feedback_votes as Row[] | undefined) ?? [])[0]?.count) }))
    .sort((a, b) => b.votes - a.votes);
  const data = csmPortfolio((overview.data as Row[]) ?? [], feedback);

  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await anthropic().beta.messages.create({
      model: MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 2000,
      system: [{ type: "text", text: CSM_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        ...askHistory(past as Row[] | null),
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify(data) },
            { type: "text", text: "השאלה: " + question },
          ],
        },
      ],
    });
  } catch (err) {
    console.error("csm mentor failed", err instanceof Anthropic.APIError ? err.status : "network");
    return { error: "coach_unavailable", status: 503 };
  }
  if (response.stop_reason === "refusal") return { error: "coach_refused", status: 422 };

  const raw = splitGap(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  const answer = cleanAnswer(raw.answer) ||
    (raw.gap ? "על זה עוד אין לי את השיטה של שוק נדל״ן. העברתי את הנושא לצוות כדי שיוסיפו אותו." : "");
  if (!answer) return { error: "coach_unavailable", status: 503 };

  const inputTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) +
    (response.usage.cache_creation_input_tokens ?? 0);
  logAiUsage(anthropicRow("csm_mentor", response.model || MODEL, response.usage));
  const { error: logErr } = await service.from("csm_mentor_questions").insert({
    staff_id: me.id, channel, question, answer, gap_topic: raw.gap,
    model: response.model, input_tokens: inputTokens, output_tokens: response.usage.output_tokens,
    cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
  });
  if (logErr) console.error("csm mentor log failed", logErr.message);

  return { answer, remaining: Math.max(0, CSM_DAILY - Number(used) - 1) };
}
