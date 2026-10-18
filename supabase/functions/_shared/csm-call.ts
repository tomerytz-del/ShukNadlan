// ============================================================================
// _shared/csm-call.ts — הקלטת שיחה של צוות ההטמעה: תמלול, סיכום והמלצות
//
// שני ערוצים לאותה פונקציה: ההעלאה באזור ההטמעה (csm-workspace, ‏action =
// analyze_call, ברקע) וקובץ שמע שאשת הצוות שולחת לגבריאלה (whatsapp-webhook/
// csm-chat.ts). השורה ב-csm_calls כבר קיימת עם audio_path; כאן היא עוברת
// processing → done או failed, ותמיד עם הודעה בעברית ב-error כשנכשלה.
//
// מה יוצא החוצה: ההקלטה ל-Whisper (OpenAI), והתמלול עם כרטיס הסוכן/ת (שם,
// משרד, שלב ושימוש - בלי טלפון ומייל) ל-Claude. docs/csm-adoption.md.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { transcribe, WHISPER_DOMAIN, WHISPER_MAX_BYTES } from "./whisper.ts";
import { anthropicRow, logAiUsage } from "./ai-usage.ts";
import { CALL_ANALYSIS_TOOL, type CallAnalysis, cleanCallAnalysis, csmCallSystem } from "./csm-call-format.ts";

const MODEL = Deno.env.get("CSM_CALL_MODEL") || Deno.env.get("COACH_ASK_MODEL") || "claude-sonnet-5-5";

/* סיומת ל-Whisper: מהשם, ואחרת מהסוג. הבתים עצמם נבדקים שוב ב-transcribe. */
const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/aac": "aac", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/webm": "webm", "video/mp4": "mp4", "audio/3gpp": "m4a", "audio/amr": "amr",
};
export function audioExtOf(path: string, mime: string): string {
  const fromName = (/\.([a-z0-9]{2,5})$/i.exec(path || "") || [])[1]?.toLowerCase();
  if (fromName && fromName !== "bin") return fromName === "3gp" ? "m4a" : fromName;
  return EXT_BY_MIME[(mime || "").toLowerCase()] || "mp3";
}

async function fail(service: SupabaseClient, id: string, message: string) {
  await service.from("csm_calls").update({ status: "failed", error: message, processed_at: new Date().toISOString() }).eq("id", id);
  return { ok: false as const, error: message };
}

export type CallResult = { ok: true; analysis: CallAnalysis; agentName: string | null } | { ok: false; error: string };

export async function processCsmCall(service: SupabaseClient, callId: string): Promise<CallResult> {
  const { data: call, error } = await service.from("csm_calls")
    .select("id, agent_id, audio_path, status").eq("id", callId).maybeSingle();
  if (error || !call) return { ok: false, error: "השיחה לא נמצאה." };
  if (!call.audio_path) return fail(service, callId, "אין הקלטה לשיחה הזו.");
  await service.from("csm_calls").update({ status: "processing", error: null }).eq("id", callId);

  // 1. ההקלטה
  const { data: blob, error: dlErr } = await service.storage.from("csm-calls").download(call.audio_path);
  if (dlErr || !blob) return fail(service, callId, "לא הצלחתי לקרוא את קובץ ההקלטה. אפשר להעלות אותו שוב?");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > WHISPER_MAX_BYTES) {
    return fail(service, callId, "ההקלטה גדולה מדי לתמלול (עד 25MB - בערך שעה ב-m4a). אפשר לשלוח חלק ממנה?");
  }
  const ext = audioExtOf(call.audio_path, blob.type);
  if (ext === "amr") {
    return fail(service, callId, "ההקלטה בפורמט AMR, ואותו אי אפשר לתמלל. אפשר לשנות בהגדרות מקליט השיחות ל-M4A או MP3?");
  }

  // 2. התמלול
  const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!openaiKey) return fail(service, callId, "תמלול הקלטות עדיין לא מופעל.");
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const transcript = await transcribe(openaiKey, copy, blob.type || "audio/mpeg", ext,
    WHISPER_DOMAIN + " שיחת הדרכה על מערכת שוק נדל״ן: גבריאלה, וואטסאפ, CRM, התאמות, פוסט שיווקי, נכס, לקוח.");
  if (!transcript) return fail(service, callId, "לא הצלחתי לתמלל את ההקלטה. אפשר לנסות קובץ בפורמט אחר (M4A או MP3)?");
  await service.from("csm_calls").update({ transcript }).eq("id", callId);

  // 3. הכרטיס של הסוכן/ת, כשהשיחה משויכת - בלי טלפון ומייל
  let agentCard: Record<string, unknown> | null = null;
  if (call.agent_id) {
    const { data: rows } = await service.rpc("csm_agents_overview");
    const r = ((rows as Record<string, unknown>[] | null) ?? []).find((x) => x.agent_id === call.agent_id);
    if (r) {
      agentCard = {
        name: r.display_name, office: r.agency_name, role: r.role, tier: r.tier, stage: r.stage,
        gabriela_messages_7d: r.gabriela_7d, active_listings: r.active_listings, clients: r.clients,
        sessions: r.sessions, weekly_goal: r.last_weekly_goal,
      };
    }
  }

  // 4. הניתוח
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return fail(service, callId, "הסיכום האוטומטי עדיין לא מופעל.");
  let response: Anthropic.Messages.Message;
  try {
    response = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "" }).messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: csmCallSystem(), cache_control: { type: "ephemeral" } }],
      tools: [CALL_ANALYSIS_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: CALL_ANALYSIS_TOOL.name },
      messages: [{
        role: "user",
        content: (agentCard ? "כרטיס הסוכן/ת: " + JSON.stringify(agentCard) + "\n\n" : "") +
          "התמלול:\n" + transcript.slice(0, 120000),
      }],
    });
  } catch (err) {
    console.error("csm call analysis failed", err instanceof Anthropic.APIError ? err.status : "network");
    return fail(service, callId, "התמלול נשמר, אבל הסיכום נכשל. אפשר לנסות שוב בעוד כמה דקות.");
  }
  logAiUsage(anthropicRow("csm_call", response.model || MODEL, response.usage));
  const use = response.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  const analysis = cleanCallAnalysis(use?.input);
  if (!analysis) return fail(service, callId, "התמלול נשמר, אבל הסיכום יצא ריק. אפשר לנסות שוב.");

  await service.from("csm_calls").update({
    status: "done", analysis, error: null, processed_at: new Date().toISOString(),
  }).eq("id", callId);
  return { ok: true, analysis, agentName: (agentCard?.name as string) || null };
}
