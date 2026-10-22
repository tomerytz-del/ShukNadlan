// ============================================================================
// office-coach — שלושת מאמני ה-AI של ה-CRM
//
//   ?kind=office (ברירת מחדל) "מאמן AI לבעלי משרדים" - שבועי, לכל משרד
//   ?kind=team                "מאמן מנהלי צוותים AI" - שבועי, לכל צוות
//   ?kind=agent               "מאמן סוכני נדל״ן AI"  - יומי, לכל סוכן/ת פעיל/ה
//   ?kind=platform            "מנטור AI למנהל הפלטפורמה" - שבועי בראשון, ובשאר
//                             הימים רק על חריגה חדשה (runPlatform)
//
// ‏pg_cron קורא לכל kind רק כשיש מי שמחכה (office_coach_due, team_coach_due,
// agent_coach_due; ‏20270407090000, ‏20270601160000). לכל אחד:
//   1. המספרים מאותה פונקציה שמזינה את הדאשבורד שלו (_office_dashboard_core,
//      עם רשימת סוכנים לצוות; ‏_my_dashboard_core לסוכן/ת) - המאמן מדבר על
//      אותם מספרים שהקורא/ת רואה.
//   2. צמצום לאגרגטים (payload.ts). **לא** שם, טלפון או טקסט של פונה, לא
//      כותרות נכסים ולא מזהים - פריט שאפשר לפתוח יוצא כאסימון ("L1").
//   3. ‏Claude מחזיר JSON לפי סכמה (חוזה v2), ו-cleanSummaryV2 מנקה, חותכת,
//      מוחקת כפתור שאינו ברשימה של המאמן הזה ומחזירה את האסימונים למזהים.
//   4. שמירה ב-office_coach_summaries / team_coach_summaries / agent_coach_summaries.
//
// מאמן הסוכן/ת כבוי עד שמגדירים AGENT_COACH_ENABLED=1: זו קריאה למודל לכל
// סוכן/ת לכל בוקר. יום שבו לא השתנה דבר מאתמול מעתיק את הסיכום בלי קריאה.
//
// ‏verify_jwt = false: נקראת מ-pg_cron עם x-alert-cron-secret, או ידנית עם
// מפתח service_role (‏_shared/cron-auth.ts, fail-closed).
//
// פרמטרים לקריאה ידנית (service_role):
//   ?dry_run=1        מחשב ומחזיר את הסיכום בלי לשמור
//   ?agency=<uuid>    משרד אחד (kind=office)
//   ?team=<uuid>      צוות אחד (kind=team)
//   ?agent=<uuid>     סוכן/ת אחד/ת (kind=agent), גם כשהמאמן כבוי
//   ?mode=weekly|exception  (kind=platform) לכתוב עכשיו, גם בלי חריגה חדשה
//
// ‏docs/coaches.md, ‏docs/office-coach.md
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { anthropicRow, logAiUsage } from "../_shared/ai-usage.ts";
import {
  addDays, agentFingerprintSource, cleanSummaryV2, coachNotification, type CoachSummaryV2, compactAgent,
  compactPeriod, compactPlatform, compactTeams, type Genders, monthlyTotals, newTriggers, platformTriggers, previousTitles,
  type RefMap, Refs, type Row, summarySchema, type SummaryKind, targetPct,
} from "../_shared/coach/payload.ts";
import { agentSystemPrompt, cleanTone, PLATFORM_SYSTEM_PROMPT, SYSTEM_PROMPTS } from "../_shared/coach/prompts.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// המודל כסוד עם ברירת מחדל, כמו בשאר הפונקציות שקוראות ל-Claude: שינוי
// מודל הוא החלטת איכות ועלות, ולא אמור לקרות בשקט בפריסה. מאמן הסוכן/ת
// רץ על כל סוכן/ת כל יום, ולכן ברירת המחדל שלו מודל קטן יותר.
const OFFICE_MODEL = Deno.env.get("OFFICE_COACH_MODEL") || "claude-opus-5-5";
const AGENT_MODEL = Deno.env.get("AGENT_COACH_MODEL") || "claude-sonnet-5-5";
const AGENT_ENABLED = Deno.env.get("AGENT_COACH_ENABLED") === "1";

// ‏Edge Function נעצרת אחרי 150 שניות. מה שלא הספקנו נלקח בהרצה הבאה
// (פונקציות ה-due מחזירות רק מי שעוד אין לו סיכום).
const TIME_BUDGET_MS = 100_000;
const BATCH = 25;
const AGENT_PARALLEL = 4;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

type CoachOut =
  | {
    ok: true; summary: CoachSummaryV2; input_tokens: number; output_tokens: number; model: string;
    cache_read_tokens: number; cache_write_tokens: number;
  }
  | { ok: false; reason: string };

async function coach(
  kind: SummaryKind, payload: unknown, refs: RefMap,
  system = kind === "platform" ? PLATFORM_SYSTEM_PROMPT : SYSTEM_PROMPTS[kind],
): Promise<CoachOut> {
  const model = kind === "agent" ? AGENT_MODEL : OFFICE_MODEL;
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await anthropic.beta.messages.create({
      model,
      // מודל שסירב (סיווג בטיחות שגוי על נתוני מכירות) מועבר בשרת למודל גיבוי
      // באותה קריאה, במקום שהקורא/ת יישאר/תישאר בלי סיכום.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // ‏max_tokens כולל גם את החשיבה הנסתרת. תקרה נמוכה מחזירה תשובה ריקה
      // (ראו generateMarketingCopy, 1.10.2026), ולכן יש מקום.
      max_tokens: 8000,
      output_config: { effort: kind === "agent" ? "low" : "medium", format: { type: "json_schema", schema: summarySchema(kind) } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited" };
    if (err instanceof Anthropic.APIError) return { ok: false, reason: `api_${err.status ?? "error"}` };
    return { ok: false, reason: "network" };
  }

  // ‏refusal אחרי הגיבוי: כל השרשרת סירבה. מדלגים, וזה מופיע ביומן.
  if (response.stop_reason === "refusal") return { ok: false, reason: "refusal" };
  if (response.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens" };

  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  const summary = cleanSummaryV2(parsed, kind, refs);
  if (!summary) return { ok: false, reason: "empty_summary" };
  return {
    ok: true,
    summary,
    model: response.model,
    input_tokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) +
      (response.usage.cache_creation_input_tokens ?? 0),
    output_tokens: response.usage.output_tokens,
    cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gendersOf(supabase: SupabaseClient, col: "agency_id" | "team_id", id: string): Promise<Genders> {
  // כשל כאן אינו מפיל: בלי מין המודל פשוט מנסח סביב השמות
  const { data } = await supabase.from("agency_members").select("id, gender").eq(col, id);
  return Object.fromEntries(((data ?? []) as { id: string; gender: string | null }[]).map((m) => [m.id, m.gender]));
}

// ---------------------------------------------------------------------------
// office: משרד לשבוע
// ---------------------------------------------------------------------------
async function runOffice(supabase: SupabaseClient, url: URL, dryRun: boolean, started: number) {
  const { data: weekStartRaw, error: wsErr } = await supabase.rpc("office_coach_week_start");
  if (wsErr || !weekStartRaw) return json({ error: "db_error", detail: wsErr?.message }, 500);
  const weekStart = String(weekStartRaw);

  const only = url.searchParams.get("agency");
  let queue: { agency_id: string }[];
  if (only) {
    if (!UUID_RE.test(only)) return json({ error: "bad_agency" }, 400);
    queue = [{ agency_id: only }];
  } else {
    const { data, error } = await supabase.rpc("office_coach_due", { p_limit: BATCH });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    queue = (data ?? []) as { agency_id: string }[];
  }

  // השבוע שהסתיים: ראשון עד שבת שלפני week_start. ועוד 30 יום, להקשר.
  const lastWeek = { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
  const last30 = { from: addDays(weekStart, -30), to: addDays(weekStart, -1) };

  const results: Row[] = [];
  for (const office of queue) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      results.push({ agency_id: office.agency_id, skipped: "time_budget" });
      continue;
    }
    const [wk, mo, prev, genders] = await Promise.all([
      supabase.rpc("_office_dashboard_core", { p_agency: office.agency_id, p_from: lastWeek.from, p_to: lastWeek.to }),
      supabase.rpc("_office_dashboard_core", { p_agency: office.agency_id, p_from: last30.from, p_to: last30.to }),
      supabase.from("office_coach_summaries").select("summary")
        .eq("agency_id", office.agency_id).lt("week_start", weekStart)
        .order("week_start", { ascending: false }).limit(1).maybeSingle(),
      gendersOf(supabase, "agency_id", office.agency_id),
    ]);
    if (wk.error || mo.error) {
      results.push({ agency_id: office.agency_id, error: "db_error", detail: (wk.error ?? mo.error)?.message });
      continue;
    }
    const refs = new Refs();
    const payload = {
      week: lastWeek,
      response_time_method: (wk.data as Row)?.data_notes,
      last_week: compactPeriod(wk.data as Row, genders, refs),
      last_30_days: compactPeriod(mo.data as Row, genders, refs),
      teams_last_week: compactTeams(wk.data as Row),
      teams_last_30_days: compactTeams(mo.data as Row),
      monthly_office_totals_12m: monthlyTotals(mo.data as Row),
      previous_week_actions: previousTitles(prev.data?.summary),
    };
    const out = await coach("office", payload, refs.map);
    if (!out.ok) {
      console.error("office-coach failed", office.agency_id, out.reason);
      results.push({ agency_id: office.agency_id, error: out.reason });
      continue;
    }
    if (!dryRun) {
      const { error } = await supabase.from("office_coach_summaries").upsert({
        agency_id: office.agency_id, week_start: weekStart, summary: out.summary, model: out.model,
        input_tokens: out.input_tokens, output_tokens: out.output_tokens, actions_done: [],
        cache_read_tokens: out.cache_read_tokens, cache_write_tokens: out.cache_write_tokens,
      }, { onConflict: "agency_id,week_start" });
      if (error) {
        results.push({ agency_id: office.agency_id, error: "db_error", detail: error.message });
        continue;
      }
    }
    results.push({
      agency_id: office.agency_id, ok: true, input_tokens: out.input_tokens, output_tokens: out.output_tokens,
      ...(dryRun ? { summary: out.summary, payload } : {}),
    });
  }
  return report("office", { week_start: weekStart }, dryRun, results);
}

// ---------------------------------------------------------------------------
// team: צוות לשבוע. אותה ליבה, עם רשימת סוכני הצוות (שלב 4).
// ---------------------------------------------------------------------------
async function runTeam(supabase: SupabaseClient, url: URL, dryRun: boolean, started: number) {
  const { data: weekStartRaw, error: wsErr } = await supabase.rpc("office_coach_week_start");
  if (wsErr || !weekStartRaw) return json({ error: "db_error", detail: wsErr?.message }, 500);
  const weekStart = String(weekStartRaw);

  const only = url.searchParams.get("team");
  let queue: { team_id: string; agency_id: string; team_name: string }[];
  if (only) {
    if (!UUID_RE.test(only)) return json({ error: "bad_team" }, 400);
    const { data, error } = await supabase.from("agency_teams").select("id, agency_id, name").eq("id", only).maybeSingle();
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);
    queue = [{ team_id: data.id, agency_id: data.agency_id, team_name: data.name }];
  } else {
    const { data, error } = await supabase.rpc("team_coach_due", { p_limit: BATCH });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    queue = (data ?? []) as typeof queue;
  }

  const lastWeek = { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
  const last30 = { from: addDays(weekStart, -30), to: addDays(weekStart, -1) };

  const results: Row[] = [];
  for (const team of queue) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      results.push({ team_id: team.team_id, skipped: "time_budget" });
      continue;
    }
    // סוכני הצוות הפעילים - כמו team_dashboard
    const { data: members, error: mErr } = await supabase.from("agency_members")
      .select("id, gender").eq("team_id", team.team_id).eq("active", true);
    if (mErr) {
      results.push({ team_id: team.team_id, error: "db_error", detail: mErr.message });
      continue;
    }
    const ids = (members ?? []).map((m) => m.id as string);
    if (!ids.length) {
      results.push({ team_id: team.team_id, skipped: "no_members" });
      continue;
    }
    const genders: Genders = Object.fromEntries((members ?? []).map((m) => [m.id, m.gender]));
    const [wk, mo, prev] = await Promise.all([
      supabase.rpc("_office_dashboard_core", { p_agency: team.agency_id, p_from: lastWeek.from, p_to: lastWeek.to, p_agent_ids: ids }),
      supabase.rpc("_office_dashboard_core", { p_agency: team.agency_id, p_from: last30.from, p_to: last30.to, p_agent_ids: ids }),
      supabase.from("team_coach_summaries").select("summary")
        .eq("team_id", team.team_id).lt("week_start", weekStart)
        .order("week_start", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (wk.error || mo.error) {
      results.push({ team_id: team.team_id, error: "db_error", detail: (wk.error ?? mo.error)?.message });
      continue;
    }
    const refs = new Refs();
    const payload = {
      week: lastWeek,
      team: team.team_name,
      response_time_method: (wk.data as Row)?.data_notes,
      last_week: compactPeriod(wk.data as Row, genders, refs),
      last_30_days: compactPeriod(mo.data as Row, genders, refs),
      team_target_pct_30_days: targetPct(mo.data as Row),
      previous_week_actions: previousTitles(prev.data?.summary),
    };
    const out = await coach("team", payload, refs.map);
    if (!out.ok) {
      console.error("team-coach failed", team.team_id, out.reason);
      results.push({ team_id: team.team_id, error: out.reason });
      continue;
    }
    if (!dryRun) {
      const { error } = await supabase.from("team_coach_summaries").upsert({
        agency_id: team.agency_id, team_id: team.team_id, week_start: weekStart, summary: out.summary,
        model: out.model, input_tokens: out.input_tokens, output_tokens: out.output_tokens, actions_done: [],
        cache_read_tokens: out.cache_read_tokens, cache_write_tokens: out.cache_write_tokens,
      }, { onConflict: "team_id,week_start" });
      if (error) {
        results.push({ team_id: team.team_id, error: "db_error", detail: error.message });
        continue;
      }
    }
    results.push({
      team_id: team.team_id, ok: true, input_tokens: out.input_tokens, output_tokens: out.output_tokens,
      ...(dryRun ? { summary: out.summary, payload } : {}),
    });
  }
  return report("team", { week_start: weekStart }, dryRun, results);
}

// ---------------------------------------------------------------------------
// agent: סוכן/ת ליום. ‏_my_dashboard_core - אותם מספרים של "הדשבורד שלי".
// ---------------------------------------------------------------------------
/* הנכסים הפעילים של הסוכן/ת ומספר הלידים של כל אחד ב-14 הימים האחרונים, בשביל
   quietListings (מה מותר להציע לקדם). תקלה כאן אינה מפילה את הסיכום - בלי
   רשימה המנטור פשוט לא מציע קידום. */
async function activeListings(supabase: SupabaseClient, agentId: string): Promise<Row[]> {
  const props = await supabase.from("properties").select("id, created_at, promoted_until")
    .eq("agent_id", agentId).eq("status", "active").order("created_at").limit(200);
  if (props.error || !props.data?.length) {
    if (props.error) console.error("agent-coach listings failed", agentId, props.error.message);
    return [];
  }
  const ids = props.data.map((p) => p.id as string);
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const leads = await supabase.from("leads").select("property_id").in("property_id", ids).gte("created_at", since).limit(1000);
  if (leads.error) {
    console.error("agent-coach listings leads failed", agentId, leads.error.message);
    return [];
  }
  const count = new Map<string, number>();
  for (const l of leads.data ?? []) count.set(l.property_id as string, (count.get(l.property_id as string) ?? 0) + 1);
  return props.data.map((p) => ({ ...p, leads_14d: count.get(p.id as string) ?? 0 }));
}

async function runAgentOne(
  supabase: SupabaseClient, agent: { agent_id: string; agency_id: string }, day: string, dryRun: boolean,
): Promise<Row> {
  const [wk, mo, me, prev, pref] = await Promise.all([
    supabase.rpc("_my_dashboard_core", { p_agent: agent.agent_id, p_from: addDays(day, -7), p_to: addDays(day, -1) }),
    supabase.rpc("_my_dashboard_core", { p_agent: agent.agent_id, p_from: addDays(day, -30), p_to: addDays(day, -1) }),
    supabase.from("agency_members").select("gender").eq("id", agent.agent_id).maybeSingle(),
    supabase.from("agent_coach_summaries").select("day, summary, input_hash, actions_done")
      .eq("agent_id", agent.agent_id).lt("day", day)
      .order("day", { ascending: false }).limit(1).maybeSingle(),
    // הטון שהסוכן/ת בחר/ה בכרטיס. בלי שורה, או בתקלה - ברירת המחדל (warm).
    supabase.from("coach_preferences").select("tone").eq("agent_id", agent.agent_id).maybeSingle(),
  ]);
  if (wk.error || mo.error) return { agent_id: agent.agent_id, error: "db_error", detail: (wk.error ?? mo.error)?.message };

  const refs = new Refs();
  const data = compactAgent(
    wk.data as Row, mo.data as Row, me.data?.gender as string | null, refs, new Date(),
    await activeListings(supabase, agent.agent_id),
  );
  const tone = cleanTone(pref.data?.tone);
  // הטון בטביעת האצבע: מי שהחליף/ה טון מקבל/ת מחר סיכום חדש ולא העתק של אתמול
  const hash = await sha256(tone + "|" + agentFingerprintSource(data));

  // יום בלי שינוי מאתמול: אותו סיכום, בלי קריאה למודל. ה-ref-ים של אתמול
  // תקפים, כי אותם פריטים בדיוק.
  if (prev.data && prev.data.day === addDays(day, -1) && prev.data.input_hash === hash) {
    if (!dryRun) {
      const { error } = await supabase.from("agent_coach_summaries").upsert({
        agency_id: agent.agency_id, agent_id: agent.agent_id, day, summary: prev.data.summary, input_hash: hash,
        model: "copy", input_tokens: 0, output_tokens: 0, actions_done: prev.data.actions_done ?? [],
      }, { onConflict: "agent_id,day" });
      if (error) return { agent_id: agent.agent_id, error: "db_error", detail: error.message };
    }
    return { agent_id: agent.agent_id, ok: true, copied: true };
  }

  const payload = { ...data, yesterday_actions: previousTitles(prev.data?.summary) };
  const out = await coach("agent", payload, refs.map, agentSystemPrompt(tone));
  if (!out.ok) {
    console.error("agent-coach failed", agent.agent_id, out.reason);
    return { agent_id: agent.agent_id, error: out.reason };
  }
  if (!dryRun) {
    const { error } = await supabase.from("agent_coach_summaries").upsert({
      agency_id: agent.agency_id, agent_id: agent.agent_id, day, summary: out.summary, input_hash: hash,
      model: out.model, input_tokens: out.input_tokens, output_tokens: out.output_tokens, actions_done: [],
        cache_read_tokens: out.cache_read_tokens, cache_write_tokens: out.cache_write_tokens,
    }, { onConflict: "agent_id,day" });
    if (error) return { agent_id: agent.agent_id, error: "db_error", detail: error.message };
    // התראת הבוקר - רק על סיכום חדש (יום שהועתק מאתמול אינו מצלצל). בפעמון,
    // ובוואטסאפ דרך notification-push עם השקט והתקרה של הסוכן/ת. כשל כאן
    // אינו מפיל את הסיכום, שכבר נשמר.
    const n = coachNotification(out.summary);
    const { error: nErr } = await supabase.from("notifications").insert({
      agent_id: agent.agent_id, type: "coach_daily", title: n.title, body: n.body,
    });
    if (nErr) console.error("agent-coach notification failed", agent.agent_id, nErr.message);
  }
  return {
    agent_id: agent.agent_id, ok: true, input_tokens: out.input_tokens, output_tokens: out.output_tokens,
    ...(dryRun ? { summary: out.summary, payload } : {}),
  };
}

async function runAgent(supabase: SupabaseClient, url: URL, dryRun: boolean, started: number) {
  const only = url.searchParams.get("agent");
  if (!AGENT_ENABLED && !only) return json({ kind: "agent", disabled: true, detail: "AGENT_COACH_ENABLED אינו 1" });

  const { data: dayRaw, error: dErr } = await supabase.rpc("coach_today");
  if (dErr || !dayRaw) return json({ error: "db_error", detail: dErr?.message }, 500);
  const day = String(dayRaw);

  let queue: { agent_id: string; agency_id: string }[];
  if (only) {
    if (!UUID_RE.test(only)) return json({ error: "bad_agent" }, 400);
    const { data, error } = await supabase.from("agency_members").select("id, agency_id").eq("id", only).maybeSingle();
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (!data || !data.agency_id) return json({ error: "not_found" }, 404);
    queue = [{ agent_id: data.id, agency_id: data.agency_id }];
  } else {
    const { data, error } = await supabase.rpc("agent_coach_due", { p_limit: BATCH });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    queue = (data ?? []) as typeof queue;
  }

  // כמה סוכנים במקביל: קריאה אחת למודל היא כמה שניות, ו-25 ברצף לא נכנסים
  // ב-150 השניות של הפונקציה
  const results: Row[] = [];
  for (let i = 0; i < queue.length; i += AGENT_PARALLEL) {
    const chunk = queue.slice(i, i + AGENT_PARALLEL);
    if (Date.now() - started > TIME_BUDGET_MS) {
      for (const a of chunk) results.push({ agent_id: a.agent_id, skipped: "time_budget" });
      continue;
    }
    results.push(...await Promise.all(chunk.map((a) => runAgentOne(supabase, a, day, dryRun))));
  }
  return report("agent", { day }, dryRun, results);
}

// ---------------------------------------------------------------------------
// platform: מנהל/ת הפלטפורמה. שבועי, ובאמצע השבוע רק על חריגה חדשה.
// ---------------------------------------------------------------------------
/* כל בוקר (cron platform-coach, ‏20270730090000):
     1. כבר נכתב היום - לא עושים כלום.
     2. אין סיכום שבועי מאז ראשון - weekly.
     3. אחרת - חריגה שלא הייתה בסיכום האחרון (newTriggers) - exception.
     4. אחרת - בלי קריאה למודל. זה רוב הימים, ובכוונה: "רק על חריגות".
   השורה נושאת את החריגות של אותו בוקר, כדי שמחר לא יחזרו כחדשות. */
async function runPlatform(supabase: SupabaseClient, url: URL, dryRun: boolean) {
  const forced = url.searchParams.get("mode");
  if (forced && forced !== "weekly" && forced !== "exception") return json({ error: "bad_mode" }, 400);

  const [dayR, wsR, input, last, lastWeekly] = await Promise.all([
    supabase.rpc("coach_today"),
    supabase.rpc("office_coach_week_start"),
    supabase.rpc("platform_coach_input"),
    supabase.from("platform_coach_summaries").select("day, summary, triggers")
      .order("day", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("platform_coach_summaries").select("day").eq("kind", "weekly")
      .order("day", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const dbErr = dayR.error ?? wsR.error ?? input.error ?? last.error ?? lastWeekly.error;
  if (dbErr || !dayR.data || !wsR.data) return json({ error: "db_error", detail: dbErr?.message }, 500);
  const day = String(dayR.data);
  const weekStart = String(wsR.data);
  if (last.data?.day === day && !forced) return report("platform", { day, skipped: "already_today" }, dryRun, []);

  // שמות הערים בכל שוק, כדי שהמנטור יכתוב "עפולה" ולא slug. כשל - בלי שמות.
  const raw = input.data as Row;
  const slugs = (((raw.growth as Row | undefined)?.markets as Row[] | undefined) ?? []).map((m) => String(m.slug));
  const names = await supabase.from("market_city_names").select("market_slug, name").in("market_slug", slugs);
  const cities: Record<string, string[]> = {};
  for (const r of (names.data ?? []) as { market_slug: string; name: string }[]) {
    (cities[r.market_slug] ??= []).push(r.name);
  }

  const refs = new Refs();
  const data = compactPlatform(raw, refs, cities);
  const triggers = platformTriggers(data);
  const fresh = newTriggers(triggers, last.data?.triggers as string[] | null);
  const weeklyDue = !lastWeekly.data || String(lastWeekly.data.day) < weekStart;
  const mode = forced ?? (weeklyDue ? "weekly" : fresh.length ? "exception" : null);
  if (!mode) return report("platform", { day, skipped: "no_new_exception", triggers }, dryRun, []);

  const payload = {
    mode,
    ...(mode === "exception" ? { new_exceptions: fresh } : {}),
    exceptions_now: triggers,
    ...data,
    previous_actions: previousTitles(last.data?.summary),
  };
  const out = await coach("platform", payload, refs.map);
  if (!out.ok) {
    console.error("platform-coach failed", out.reason);
    return report("platform", { day, mode }, dryRun, [{ error: out.reason }]);
  }
  // ‏ai_usage_log ולא עמודות הטבלה: ai_usage_costs (פאנל "עלויות") קורא את
  // היומן, ואת שלוש טבלאות המנטורים של המשרדים בלבד
  logAiUsage(anthropicRow("platform_coach", out.model, {
    input_tokens: Math.max(0, out.input_tokens - out.cache_read_tokens - out.cache_write_tokens),
    output_tokens: out.output_tokens,
    cache_read_input_tokens: out.cache_read_tokens,
    cache_creation_input_tokens: out.cache_write_tokens,
  }));
  if (!dryRun) {
    const { error } = await supabase.from("platform_coach_summaries").upsert({
      day, kind: mode, summary: out.summary, triggers, model: out.model,
      input_tokens: out.input_tokens, output_tokens: out.output_tokens, actions_done: [],
      cache_read_tokens: out.cache_read_tokens, cache_write_tokens: out.cache_write_tokens,
    }, { onConflict: "day" });
    if (error) return report("platform", { day, mode }, dryRun, [{ error: "db_error", detail: error.message }]);
    // לכל מנהלי הפלטפורמה. כשל כאן אינו מפיל את הסיכום, שכבר נשמר.
    const n = coachNotification(out.summary);
    const { data: admins } = await supabase.from("agency_members").select("id")
      .eq("is_platform_admin", true).eq("active", true);
    if (admins?.length) {
      const { error: nErr } = await supabase.from("notifications").insert(admins.map((a) => ({
        agent_id: a.id, type: "platform_coach", title: n.title, body: n.body,
      })));
      if (nErr) console.error("platform-coach notification failed", nErr.message);
    }
  }
  return report("platform", { day, mode }, dryRun, [{
    ok: true, input_tokens: out.input_tokens, output_tokens: out.output_tokens,
    ...(dryRun ? { summary: out.summary, payload } : {}),
  }]);
}

function report(kind: SummaryKind, extra: Row, dryRun: boolean, results: Row[]) {
  return json({
    kind,
    ...extra,
    dry_run: dryRun,
    processed: results.filter((r) => r.ok).length,
    copied: results.filter((r) => r.copied).length,
    failed: results.filter((r) => r.error).length,
    deferred: results.filter((r) => r.skipped).length,
    results,
  });
}

// ---------------------------------------------------------------------------
// ההרצה
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
  if (!ANTHROPIC_KEY) return json({ error: "anthropic_not_configured", detail: "‏ANTHROPIC_API_KEY אינו מוגדר." }, 503);

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "office") as SummaryKind;
  const dryRun = url.searchParams.get("dry_run") === "1";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const started = Date.now();

  if (kind === "office") return runOffice(supabase, url, dryRun, started);
  if (kind === "team") return runTeam(supabase, url, dryRun, started);
  if (kind === "agent") return runAgent(supabase, url, dryRun, started);
  if (kind === "platform") return runPlatform(supabase, url, dryRun);
  return json({ error: "bad_kind" }, 400);
});
