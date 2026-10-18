// ============================================================================
// coach-ask — "שאל את המאמן"
//
// שאלה חופשית לאחד משלושת מאמני ה-AI (docs/coaches.md), מול הסיכום האחרון
// שלו והמספרים של 30 הימים האחרונים. **תשובה בלבד:** אין כאן כלים, אין
// כתיבה למסד מעבר ליומן השאלות, והמאמן לא מבצע שום פעולה.
//
// ‏verify_jwt = true, והקורא/ת נגזר/ת מה-JWT המאומת - לעולם לא מה-body.
// ההרשאה לכל מאמן היא אותה הרשאה של הסיכום שלו:
//   agent  - הסוכן/ת עצמו/ה
//   team   - מנהל/ת הצוות (agency_teams.lead_member_id)
//   office - מנהל/ת המשרד (role = 'manager')
//
// מה יוצא למודל: אותו צמצום של המאמנים (_shared/coach/payload.ts) - אגרגטים,
// ובצוות ובמשרד גם שמות סוכנים. לא טלפונים, לא שמות פונים ולא מזהים.
//
// מגבלה: COACH_ASK_DAILY שאלות ליום לחשבון (ברירת מחדל 10), לפי היום בישראל.
// כל שאלה נרשמת ב-coach_questions עם המודל והטוקנים.
//
// גוף הבקשה: { kind: 'agent' | 'team' | 'office', question: string }
// תשובה:     { answer, remaining }  או  { error }
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import {
  addDays, askHistory, cleanAnswer, cleanQuestion, experienceLabel, type CoachKind, compactAgent, compactPeriod, compactTeams, type Genders,
  Refs, type Row, summaryForAsk,
} from "../_shared/coach/payload.ts";
import { askSystemPrompt, cleanTone, type CoachManages } from "../_shared/coach/prompts.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// המודל והמכסה כסודות עם ברירת מחדל: החלטת איכות ועלות, לא קבוע בקוד
const MODEL = Deno.env.get("COACH_ASK_MODEL") || "claude-sonnet-5-5";
const DAILY = Math.max(1, Number(Deno.env.get("COACH_ASK_DAILY")) || 10);

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

type Member = {
  id: string; agency_id: string | null; role: string | null; active: boolean; gender: string | null;
  years_experience: number | null;
};
type Context = { summary: unknown; data: Row; manages?: CoachManages } | { error: string; status: number };

async function latest(service: SupabaseClient, table: string, col: string, id: string, dateCol: string) {
  const { data } = await service.from(table).select("summary").eq(col, id)
    .order(dateCol, { ascending: false }).limit(1).maybeSingle();
  return data?.summary ?? null;
}

/* ההקשר של כל מאמן: מי רשאי/ת, הסיכום האחרון, והמספרים. ‏service_role,
   אחרי שההרשאה נבדקה כאן - אותם תנאים של ה-RLS על טבלאות הסיכומים. */
async function loadContext(
  service: SupabaseClient, kind: CoachKind, me: Member, day: string, experienceBand: unknown,
): Promise<Context> {
  const from30 = addDays(day, -30), to = addDays(day, -1);

  if (kind === "agent") {
    // מנהל/ת שהוא/היא גם סוכן/ת: המנטור הזה עונה גם על שאלת ניהול (prompts.ts,
    // AGENT_WHO_MANAGES). כשל בבדיקה = כמו סוכן/ת רגיל/ה.
    const [wk, mo, summary, lead] = await Promise.all([
      service.rpc("_my_dashboard_core", { p_agent: me.id, p_from: addDays(day, -7), p_to: to }),
      service.rpc("_my_dashboard_core", { p_agent: me.id, p_from: from30, p_to: to }),
      latest(service, "agent_coach_summaries", "agent_id", me.id, "day"),
      me.role === "manager" ? Promise.resolve({ data: null })
        : service.from("agency_teams").select("id").eq("lead_member_id", me.id).limit(1).maybeSingle(),
    ]);
    const manages: CoachManages = me.role === "manager" ? "office" : lead.data ? "team" : null;
    if (wk.error || mo.error) return { error: "db_error", status: 500 };
    // הוותק, כטווח - כדי שהמנטור יתאים את העומק: תסריט מלא למתחיל/ה, שיחה
    // בגובה העיניים לוותיק/ה (playbook.ts, "התאמה לניסיון", ו-experienceLabel)
    const data = compactAgent(wk.data as Row, mo.data as Row, me.gender, new Refs());
    return { summary, data: { ...data, experience: experienceLabel(experienceBand, me.years_experience), manages }, manages };
  }

  if (!me.agency_id) return { error: "not_allowed", status: 403 };

  if (kind === "team") {
    const { data: team } = await service.from("agency_teams").select("id")
      .eq("lead_member_id", me.id).maybeSingle();
    if (!team) return { error: "not_allowed", status: 403 };
    const { data: members, error } = await service.from("agency_members")
      .select("id, gender").eq("team_id", team.id).eq("active", true);
    if (error) return { error: "db_error", status: 500 };
    const ids = (members ?? []).map((m) => m.id as string);
    const genders: Genders = Object.fromEntries((members ?? []).map((m) => [m.id, m.gender]));
    const [core, summary] = await Promise.all([
      ids.length
        ? service.rpc("_office_dashboard_core", { p_agency: me.agency_id, p_from: from30, p_to: to, p_agent_ids: ids })
        : Promise.resolve({ data: {}, error: null }),
      latest(service, "team_coach_summaries", "team_id", team.id, "week_start"),
    ]);
    if (core.error) return { error: "db_error", status: 500 };
    return { summary, data: { last_30_days: compactPeriod(core.data as Row, genders) } };
  }

  // office
  if (me.role !== "manager") return { error: "not_allowed", status: 403 };
  const [{ data: members }, core, summary] = await Promise.all([
    service.from("agency_members").select("id, gender").eq("agency_id", me.agency_id),
    service.rpc("_office_dashboard_core", { p_agency: me.agency_id, p_from: from30, p_to: to }),
    latest(service, "office_coach_summaries", "agency_id", me.agency_id, "week_start"),
  ]);
  if (core.error) return { error: "db_error", status: 500 };
  const genders: Genders = Object.fromEntries((members ?? []).map((m) => [m.id, m.gender]));
  return {
    summary,
    data: { last_30_days: compactPeriod(core.data as Row, genders), teams_last_30_days: compactTeams(core.data as Row) },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "coach_unavailable" }, 503);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const kind = String(body.kind || "") as CoachKind;
  if (!["agent", "team", "office"].includes(kind)) return json({ error: "bad_kind" }, 400);
  const question = cleanQuestion(body.question);
  if (question.length < 3) return json({ error: "bad_question" }, 400);

  // מי שואל/ת: מה-JWT בכותרת, לא מה-body
  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: me, error: meErr } = await service.from("agency_members")
    .select("id, agency_id, role, active, gender, years_experience").eq("user_id", userData.user.id).maybeSingle();
  if (meErr) return json({ error: "db_error" }, 500);
  if (!me || !me.active) return json({ error: "no_matching_agent_profile" }, 403);

  const [{ data: used, error: usedErr }, { data: dayRaw, error: dayErr }] = await Promise.all([
    service.rpc("coach_ask_count_today", { p_agent: me.id }),
    service.rpc("coach_today"),
  ]);
  if (usedErr || dayErr || !dayRaw) return json({ error: "db_error" }, 500);
  if (Number(used) >= DAILY) return json({ error: "coach_ask_quota", limit: DAILY, remaining: 0 }, 429);


  // שיחת המשך: השאלות של 12 השעות האחרונות לאותו מנטור, כדי ש"ואם הוא עדיין
  // מסרב?" יובן. רק של השואל/ת עצמו/ה. תקלה כאן אינה מפילה את השאלה.
  // והטון והוותק שהשואל/ת בחר/ה בכרטיס (coach_preferences). בלי שורה - warm.
  const [{ data: past }, { data: pref }] = await Promise.all([
    service.from("coach_questions").select("question, answer")
      .eq("agent_id", me.id).eq("kind", kind)
      .gte("created_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false }).limit(3),
    service.from("coach_preferences").select("tone, experience").eq("agent_id", me.id).maybeSingle(),
  ]);

  const ctx = await loadContext(service, kind, me as Member, String(dayRaw), pref?.experience);
  if ("error" in ctx) return json({ error: ctx.error }, ctx.status);

  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await anthropic.beta.messages.create({
      model: MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 2000,
      system: [{ type: "text", text: askSystemPrompt(kind, cleanTone(pref?.tone), ctx.manages ?? null), cache_control: { type: "ephemeral" } }],
      messages: [
        ...askHistory(past as Row[] | null),
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ latest_summary: summaryForAsk(ctx.summary), data: ctx.data }) },
            { type: "text", text: "השאלה: " + question },
          ],
        },
      ],
    });
  } catch (err) {
    console.error("coach-ask failed", err instanceof Anthropic.APIError ? err.status : "network");
    return json({ error: "coach_unavailable" }, 503);
  }
  if (response.stop_reason === "refusal") return json({ error: "coach_refused" }, 422);

  const answer = cleanAnswer(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  if (!answer) return json({ error: "coach_unavailable" }, 503);

  const inputTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) +
    (response.usage.cache_creation_input_tokens ?? 0);
  const { error: logErr } = await service.from("coach_questions").insert({
    agent_id: me.id, agency_id: me.agency_id, kind, question, answer,
    model: response.model, input_tokens: inputTokens, output_tokens: response.usage.output_tokens,
  });
  // יומן שלא נכתב אינו מפיל תשובה שכבר שולמה, אבל המכסה נשענת עליו
  if (logErr) console.error("coach-ask log failed", logErr.message);

  return json({ answer, remaining: Math.max(0, DAILY - Number(used) - 1) });
});
