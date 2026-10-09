// ============================================================================
// office-coach — מאמן ה-AI השבועי של דאשבורד המשרד ("סיכום השבוע")
//
// פעם בשבוע (pg_cron, יום ראשון בבוקר; 20270407090000_office_coach.sql) לכל
// משרד פעיל שעוד אין לו סיכום לשבוע הנוכחי:
//   1. מחשבת את מספרי המשרד דרך _office_dashboard_core - אותה פונקציה שמזינה
//      את הדאשבורד, כך שהמאמן מדבר על אותם מספרים שהמנהל/ת רואה/ה.
//   2. מצמצמת אותם לאגרגטים בלבד: שמות סוכנים ומספרים. **לא** שם, טלפון או
//      טקסט של פונה, וגם לא כותרות נכסים - המודל לא צריך אותם כדי לייעץ.
//   3. מבקשת מ-Claude כותרת ושלוש נקודות, ב-JSON לפי סכמה.
//   4. שומרת ב-office_coach_summaries. הדאשבורד מציג את האחרונה.
//
// ‏verify_jwt = false: נקראת מ-pg_cron עם x-alert-cron-secret, או ידנית עם
// מפתח service_role (‏_shared/cron-auth.ts, fail-closed).
//
// פרמטרים לקריאה ידנית (service_role):
//   ?dry_run=1        מחשב ומחזיר את הסיכום בלי לשמור
//   ?agency=<uuid>    משרד אחד בלבד, גם אם אינו ברשימת ה-due
//
// ‏docs/office-coach.md
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  addDays, cleanSummary, type CoachSummary, compactPeriod, monthlyTotals, type Row, SUMMARY_SCHEMA,
} from "./payload.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// המודל כסוד עם ברירת מחדל, כמו בשאר הפונקציות שקוראות ל-Claude: שינוי
// מודל הוא החלטת איכות ועלות, ולא אמור לקרות בשקט בפריסה.
const MODEL = Deno.env.get("OFFICE_COACH_MODEL") || "claude-opus-5-5";

// ‏Edge Function נעצרת אחרי 150 שניות. משרד שלא הספקנו נלקח בהרצה השעתית
// הבאה של יום ראשון (office_coach_due מחזירה רק מי שעוד אין לו סיכום).
const TIME_BUDGET_MS = 100_000;
const BATCH = 25;

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

// ---------------------------------------------------------------------------
// הפרומפט. יציב לגמרי (בלי תאריך ובלי שם משרד), ולכן נשמר במטמון בין המשרדים
// של אותה הרצה. כל מה שמשתנה עובר בהודעת המשתמש.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `את/ה מאמן/ת ניהולי/ת למשרדי תיווך נדל"ן בישראל, בתוך מערכת "שוק נדל״ן".
פעם בשבוע את/ה כותב/ת למנהל/ת המשרד סיכום קצר: כותרת אחת ושלוש נקודות.

מה מקבלים: מספרים מצטברים של המשרד - לשבוע שהסתיים ול-30 הימים האחרונים, לכל סוכן/ת
ולמשרד כולו: לידים, זמן תגובה, גיוסים, בלעדיות, הסכמי תיווך, פגישות, עסקאות ועמלות
(הערכה), וגם בלעדיות שפוקעות ומקורות לידים. לפעמים גם הנקודות של השבוע הקודם.

שלוש הנקודות:
1. מה עבד השבוע - הישג אמיתי מהמספרים, עם שם הסוכן/ת כשיש.
2. מה תקוע - הבעיה החשובה ביותר שהמספרים מראים (לידים בלי מענה, זמן תגובה, בלעדיות
   שפוקעות, נפילה במשפך, פיגור ביעד).
3. על מה לשים את השבוע - פעולה אחת ברורה, מי מוביל/ה אותה, ומה ייחשב הצלחה.

כללים:
- כל נקודה נשענת על מספר מהנתונים. לא להמציא מספרים, שמות או אירועים שאינם בנתונים.
- כשהנתונים דלים (משרד קטן, שבוע שקט), לומר זאת בפשטות ולהציע צעד אחד קטן. לא לנפח.
- מספר קטן (ליד אחד, עסקה אחת) אינו מגמה. לא להסיק ממנו מסקנות.
- להעדיף כלים שכבר קיימים במערכת כשהם רלוונטיים: דוח CMA לפגישת גיוס, סרטון שיווקי
  והדמיות לנכס, מיניסייט ללקוח/ה, החתמה דיגיטלית, גבריאלה (העוזרת בוואטסאפ), התאמות
  חכמות, וכפתורי "חיוג"/"וואטסאפ" בכרטיס הליד (הם גם מה שנרשם כזמן התגובה).
- עמלות הן הערכה. השפעה צפויה היא הערכה או מדד הצלחה, לא הבטחה.
- לא לחזור על אותן נקודות של השבוע הקודם אם לא השתנה דבר - לומר מה התקדם או לא.
- הטון חם, ישיר ומקצועי. בלי אימוג'י ובלי סימני קריאה מיותרים. לא להאשים סוכן/ת.

כתיבה:
- עברית. ניסוח מגדרי עם לוכסן (סוכן/ת, מוביל/ה).
- מקף רגיל (-) בלבד, לעולם לא מקף ארוך.
- כותרת: עד 12 מילים. כותרת של נקודה: עד 8 מילים. גוף נקודה: עד 45 מילים.
- owner: מי מוביל/ה את הנקודה - שם סוכן/ת מהנתונים, "מנהל/ת המשרד" או "כל הצוות".`;

async function coach(payload: unknown): Promise<
  | { ok: true; summary: CoachSummary; input_tokens: number; output_tokens: number; model: string }
  | { ok: false; reason: string }
> {
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await anthropic.beta.messages.create({
      model: MODEL,
      // מודל שסירב (סיווג בטיחות שגוי על נתוני מכירות) מועבר בשרת למודל גיבוי
      // באותה קריאה, במקום שהמשרד יישאר בלי סיכום השבוע.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // ‏max_tokens כולל גם את החשיבה הנסתרת. תקרה נמוכה מחזירה תשובה ריקה
      // (ראו generateMarketingCopy, 1.10.2026), ולכן יש מקום.
      max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited" };
    if (err instanceof Anthropic.APIError) return { ok: false, reason: `api_${err.status ?? "error"}` };
    return { ok: false, reason: "network" };
  }

  // ‏refusal אחרי הגיבוי: כל השרשרת סירבה. אין מה לנסות שוב - המשרד יידלג השבוע,
  // ויופיע ביומן.
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
  const summary = cleanSummary(parsed);
  if (!summary) return { ok: false, reason: "empty_summary" };
  return {
    ok: true,
    summary,
    model: response.model,
    input_tokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) +
      (response.usage.cache_creation_input_tokens ?? 0),
    output_tokens: response.usage.output_tokens,
  };
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
  const dryRun = url.searchParams.get("dry_run") === "1";
  const onlyAgency = url.searchParams.get("agency");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const started = Date.now();

  const { data: weekStartRaw, error: wsErr } = await supabase.rpc("office_coach_week_start");
  if (wsErr || !weekStartRaw) return json({ error: "db_error", detail: wsErr?.message }, 500);
  const weekStart = String(weekStartRaw);

  // מי בתור: משרד אחד בקריאה ידנית, אחרת מי שעוד אין לו סיכום השבוע
  let queue: { agency_id: string; agency_name: string }[];
  if (onlyAgency) {
    if (!/^[0-9a-f-]{36}$/i.test(onlyAgency)) return json({ error: "bad_agency" }, 400);
    const { data, error } = await supabase.from("agencies").select("id, name").eq("id", onlyAgency).maybeSingle();
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);
    queue = [{ agency_id: data.id, agency_name: data.name }];
  } else {
    const { data, error } = await supabase.rpc("office_coach_due", { p_limit: BATCH });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    queue = (data ?? []) as { agency_id: string; agency_name: string }[];
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
    const [wk, mo, prev] = await Promise.all([
      supabase.rpc("_office_dashboard_core", { p_agency: office.agency_id, p_from: lastWeek.from, p_to: lastWeek.to }),
      supabase.rpc("_office_dashboard_core", { p_agency: office.agency_id, p_from: last30.from, p_to: last30.to }),
      supabase.from("office_coach_summaries").select("week_start, summary")
        .eq("agency_id", office.agency_id).lt("week_start", weekStart)
        .order("week_start", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (wk.error || mo.error) {
      results.push({ agency_id: office.agency_id, error: "db_error", detail: (wk.error ?? mo.error)?.message });
      continue;
    }
    const prevSummary = (prev.data?.summary ?? null) as CoachSummary | null;
    const payload = {
      week: lastWeek,
      response_time_method: (wk.data as Row)?.data_notes,
      last_week: compactPeriod(wk.data as Row),
      last_30_days: compactPeriod(mo.data as Row),
      monthly_office_totals_12m: monthlyTotals(mo.data as Row),
      previous_week_points: prevSummary?.points?.map((p) => p.title) ?? null,
    };

    const out = await coach(payload);
    if (!out.ok) {
      console.error("office-coach failed", office.agency_id, out.reason);
      results.push({ agency_id: office.agency_id, error: out.reason });
      continue;
    }
    if (!dryRun) {
      const { error } = await supabase.from("office_coach_summaries").upsert({
        agency_id: office.agency_id,
        week_start: weekStart,
        summary: out.summary,
        model: out.model,
        input_tokens: out.input_tokens,
        output_tokens: out.output_tokens,
      }, { onConflict: "agency_id,week_start" });
      if (error) {
        results.push({ agency_id: office.agency_id, error: "db_error", detail: error.message });
        continue;
      }
    }
    results.push({
      agency_id: office.agency_id,
      ok: true,
      input_tokens: out.input_tokens,
      output_tokens: out.output_tokens,
      ...(dryRun ? { summary: out.summary, payload } : {}),
    });
  }

  return json({
    week_start: weekStart,
    dry_run: dryRun,
    processed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => r.error).length,
    deferred: results.filter((r) => r.skipped).length,
    results,
  });
});
