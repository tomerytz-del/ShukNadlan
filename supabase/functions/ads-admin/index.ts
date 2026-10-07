import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { actionCount, MetaClient, MetaError, normalizeAccountId } from "./meta.ts";
import {
  type Audience,
  type Brief,
  checkVariant,
  cleanVariant,
  generateVariants,
  MAX_INTENSITY,
  type Variant,
} from "./copy.ts";
import { MarketingCopyAuthError } from "../_shared/marketing-copy.ts";
import { matchesPlatform, PlacesError, placesSearch, registryCityCounts } from "./intel.ts";

// ============================================================================
// ads-admin — קונסולת השיווק, שלב 2 (docs/marketing-console.md)
//
// הפונקציה היחידה שמדברת עם חשבון המודעות של מטא. הדפדפן קורא את הטבלאות
// ads_* ישירות (RLS למנהל/ת הפלטפורמה), וכל מה שנוגע במטא עובר כאן.
//
// ‏POST {action, ...}:
//   status         הטוקן חי? החשבון, המטבע, הסטטוס, ההוצאה, והדף
//   sync_insights  ‏insights ליום ברמת campaign/adset/ad → ads_insights_daily
//   campaigns      רשימה חיה של קמפיינים וסטים (סטטוס, תקציב)
//   set_status     ‏{object_type, object_id, status: ACTIVE|PAUSED}
//   set_budget     ‏{object_type, object_id, daily_budget}  — בשקלים, עד פי 2
//   generate_copy  נוסחים למודעה: audience property|platform, intensity, brief
//                  (‏copy.ts). עם draft_id + feedback — כתיבה מחדש לפי הערה
//   save_copy      ‏{draft_id, variants, status} — נוסחים אחרי עריכה
//   intel_registry_refresh  ספירת מתווכים לכל עיר מרשם המתווכים (intel.ts)
//   intel_places_scan       ‏{city_id} — משרדים ב-Google Places, place_id בלבד
//   intel_places_live       ‏{city_id} — אותם משרדים עם שם ודירוג, לא נשמר
// ‏generate_copy ו-save_copy אינם נוגעים במטא, ולכן עובדים גם בלי הסודות שלה.
//
// ‏**אימות.** שני מסלולים, כמו ב-property-marketing-publish:
//   - JWT של מנהל/ת פלטפורמה פעיל/ה (agency_members.is_platform_admin) —
//     הקונסולה ב-crm.html. כל הפעולות.
//   - ‏x-alert-cron-secret / service_role (‎_shared/cron-auth.ts‎) — ה-cron
//     הלילי. ‏cron_secret מורשה ל-sync_insights בלבד: סוד שדלף מה-Vault לא
//     יכול להשהות קמפיינים או להעלות תקציב.
// לכן verify_jwt = false ב-config.toml: ה-cron אינו נושא JWT, וה-Gateway
// היה חוסם אותו. (המסמך תכנן true — זה התיקון שלו.)
//
// ‏**כתיבה למטא.** כל כתיבה:
//   1. קוראת את האובייקט קודם, ומוודאת שהוא שייך לחשבון שלנו (account_id).
//      ‏object_id מהדפדפן אינו מספיק כדי לגעת בחשבון של מישהו אחר שהטוקן
//      רואה (‏System User יכול להיות משויך לכמה חשבונות).
//   2. ‏dry_run=true מחזיר את התוכנית בלי לכתוב — חלון האישור בפאנל מציג
//      אותה לפני "אישור".
//   3. נרשמת ב-ads_actions_log — גם כשנכשלה, ועם מה שמטא ענתה.
//
// ‏**תקציב.** עד פי 2 בקריאה אחת, כמו update_budget.py בסקיל: עלייה גדולה
// מאפסת את שלב הלמידה ומגדילה את הנזק של טעות הקלדה. ירידה — בלי תקרה.
// ‏daily_budget בלבד; אובייקט עם lifetime_budget נדחה, לא מנוחש.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

const ADS_TOKEN = Deno.env.get("META_ADS_ACCESS_TOKEN") || "";
const AD_ACCOUNT = Deno.env.get("META_AD_ACCOUNT_ID") || "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const PAGE_ID = Deno.env.get("FACEBOOK_PAGE_ID") || "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5";
const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";

const MAX_BUDGET_MULTIPLIER = 2;
// ‏90 יום — מעבר לזה מטא ממילא מגבילה פירוט יומי, וההרצה תיחתך בזמן.
const MAX_SYNC_DAYS = 90;
const LEVELS = ["campaign", "adset", "ad"] as const;
type Level = typeof LEVELS[number];

const LEAD_ACTIONS = ["lead"];
// טופס מיידי מדווח גם lead וגם onsite_conversion.lead_grouped על אותו ליד.
// סופרים lead, ונופלים לקבוץ רק כשהוא לבדו — אחרת כל ליד נספר פעמיים.
const LEAD_FALLBACK_ACTIONS = ["onsite_conversion.lead_grouped"];
const CONVERSATION_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];

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

type Caller = { via: "console" | "cron"; actorId: string | null; full: boolean };

type LogEntry = {
  action: string;
  object_type?: string | null;
  object_id?: string | null;
  request?: unknown;
  response?: unknown;
  ok: boolean;
  error?: string | null;
};

async function log(sb: SupabaseClient, caller: Caller, e: LogEntry) {
  const { error } = await sb.from("ads_actions_log").insert({
    actor_id: caller.actorId,
    via: caller.via,
    action: e.action,
    object_type: e.object_type ?? null,
    object_id: e.object_id ?? null,
    request: e.request ?? {},
    response: e.response ?? null,
    ok: e.ok,
    error: e.error ?? null,
  });
  // יומן שלא נכתב אינו מבטל את הפעולה שכבר נעשתה במטא — אבל הוא חייב
  // להשאיר עקבה, אחרת "מי העלה את התקציב" נשאר בלי תשובה.
  if (error) console.error("ads_actions_log insert failed", e.action, error.message);
}

// שגיאה של מטא → תשובת HTTP. ‏429 על throttling כדי שהפאנל יציע "נסו
// בעוד כמה דקות", ‏502 על כל השאר — התקלה אצל מטא, לא אצל הקורא.
function metaErrorResponse(e: unknown) {
  if (e instanceof MetaError) {
    return json({
      error: e.tokenInvalid ? "meta_token_invalid" : e.rateLimited ? "meta_rate_limited" : "meta_error",
      meta: { code: e.meta.code, subcode: e.meta.error_subcode, message: e.meta.message, user_msg: e.meta.error_user_msg },
    }, e.rateLimited ? 429 : 502);
  }
  console.error("ads-admin unexpected", e);
  return json({ error: "internal_error", detail: (e as Error)?.message ?? String(e) }, 500);
}

function metaErrorText(e: unknown): string {
  return e instanceof MetaError ? e.message : (e as Error)?.message ?? String(e);
}

const OBJECT_ID_RE = /^\d{5,25}$/;

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
async function actionStatus(meta: MetaClient, act: string) {
  const out: Record<string, unknown> = { configured: true, api_version: Deno.env.get("META_API_VERSION") || "v26.0" };
  try {
    out.token_owner = await meta.get("me", { fields: "id,name" });
    out.account = await meta.get(act, {
      fields: "name,account_status,disable_reason,currency,timezone_name,amount_spent,spend_cap,balance",
    });
  } catch (e) {
    return metaErrorResponse(e);
  }
  // הדף אינו חוסם: חשבון חי עם דף שהטוקן אינו רואה עדיין שווה דשבורד
  // ביצועים. זה ייחסם בשלב 4/5, כשטפסים ופוסטים יצטרכו אותו.
  if (PAGE_ID) {
    try {
      out.page = await meta.get(PAGE_ID, { fields: "id,name" });
    } catch (e) {
      out.page = { id: PAGE_ID, error: metaErrorText(e) };
    }
  }
  return json(out);
}

// ---------------------------------------------------------------------------
// sync_insights
//
// כותב מחדש את N הימים האחרונים בכל רמה. מטא מחזירה שורה רק לאובייקט שהיה
// לו impression באותו יום, ולכן upsert לבדו היה משאיר שורה ישנה של מודעה
// שמטא תיקנה לאפס. אחרי ה-upsert נמחקות שורות החלון שלא נגעו בהן בהרצה הזו
// (‏synced_at ישן) — רק ברמה שהשליפה שלה הצליחה במלואה.
// ---------------------------------------------------------------------------
function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function actionSyncInsights(sb: SupabaseClient, meta: MetaClient, act: string, caller: Caller, body: any) {
  let days = Number(body?.days);
  if (!Number.isFinite(days) || days <= 0) {
    const { data } = await sb.from("ads_settings").select("value").eq("key", "sync_days").maybeSingle();
    days = Number(data?.value) || 3;
  }
  days = Math.min(Math.max(Math.floor(days), 1), MAX_SYNC_DAYS);

  // "היום" לפי UTC. החשבון בשעון ישראל, ולכן ב-00:10 UTC היום הקודם כבר
  // נסגר שם; היום הנוכחי ייכתב שוב מחר, כמו כל יום בחלון.
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  const range = { since: isoDay(since), until: isoDay(until) };
  const runStart = new Date().toISOString();

  const summary: Record<string, unknown> = { range };
  const failed: string[] = [];

  for (const level of LEVELS) {
    let rows: any[];
    try {
      rows = await meta.getAll(`${act}/insights`, {
        level,
        time_increment: 1,
        time_range: JSON.stringify(range),
        fields: [
          "date_start", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
          "spend", "impressions", "reach", "clicks", "frequency", "cpm", "ctr", "actions",
        ].join(","),
        limit: 500,
      });
    } catch (e) {
      // רמה אחת שנכשלה אינה מוחקת כלום ואינה עוצרת את האחרות.
      failed.push(level);
      summary[level] = { error: metaErrorText(e) };
      if (e instanceof MetaError && (e.tokenInvalid || e.rateLimited)) break;
      continue;
    }

    const records = rows.map((r) => mapInsightRow(level, r, runStart)).filter((r) => r !== null);
    if (records.length) {
      const { error } = await sb.from("ads_insights_daily").upsert(records, { onConflict: "day,level,object_id" });
      if (error) {
        failed.push(level);
        summary[level] = { error: `db: ${error.message}` };
        continue;
      }
    }
    const { error: delErr, count } = await sb.from("ads_insights_daily")
      .delete({ count: "exact" })
      .eq("level", level)
      .gte("day", range.since)
      .lte("day", range.until)
      .lt("synced_at", runStart);
    summary[level] = { rows: records.length, removed: delErr ? `error: ${delErr.message}` : count ?? 0 };
  }

  const ok = failed.length === 0;
  await log(sb, caller, {
    action: "sync_insights",
    object_type: "account",
    object_id: act,
    request: { days },
    response: summary,
    ok,
    error: ok ? null : `failed levels: ${failed.join(",")}`,
  });
  return json({ ok, ...summary }, ok ? 200 : 207);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapInsightRow(level: Level, r: any, runStart: string) {
  const objectId = level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : r.ad_id;
  const objectName = level === "campaign" ? r.campaign_name : level === "adset" ? r.adset_name : r.ad_name;
  if (!objectId || !r.date_start) return null;
  const leads = actionCount(r.actions, LEAD_ACTIONS) || actionCount(r.actions, LEAD_FALLBACK_ACTIONS);
  return {
    day: r.date_start,
    level,
    object_id: String(objectId),
    object_name: objectName ?? null,
    campaign_id: r.campaign_id ? String(r.campaign_id) : null,
    adset_id: level === "campaign" ? null : (r.adset_id ? String(r.adset_id) : null),
    spend: num(r.spend),
    impressions: Math.round(num(r.impressions)),
    reach: Math.round(num(r.reach)),
    clicks: Math.round(num(r.clicks)),
    link_clicks: Math.round(actionCount(r.actions, ["link_click"])),
    leads: Math.round(leads),
    conversations: Math.round(actionCount(r.actions, CONVERSATION_ACTIONS)),
    frequency: numOrNull(r.frequency),
    cpm: numOrNull(r.cpm),
    ctr: numOrNull(r.ctr),
    synced_at: runStart,
  };
}

// ---------------------------------------------------------------------------
// campaigns — רשימה חיה. תקציבים במטא ביחידות משנה (אגורות); הפאנל מקבל
// גם את הערך בשקלים כדי שלא יחלק בעצמו.
// ---------------------------------------------------------------------------
function withMajor(o: any) {
  return {
    ...o,
    daily_budget_ils: o.daily_budget != null ? Number(o.daily_budget) / 100 : null,
    lifetime_budget_ils: o.lifetime_budget != null ? Number(o.lifetime_budget) / 100 : null,
  };
}

async function actionCampaigns(meta: MetaClient, act: string, body: any) {
  // ברירת המחדל מסתירה ארכיון ומחוקים — הם אינם ניתנים לפעולה.
  const includeArchived = Boolean(body?.include_archived);
  const filtering = includeArchived ? undefined : JSON.stringify([
    { field: "effective_status", operator: "NOT_IN", value: ["ARCHIVED", "DELETED"] },
  ]);
  try {
    const [campaigns, adsets] = await Promise.all([
      meta.getAll(`${act}/campaigns`, {
        fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,updated_time",
        limit: 200,
        ...(filtering ? { filtering } : {}),
      }),
      meta.getAll(`${act}/adsets`, {
        fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,learning_stage_info",
        limit: 200,
        ...(filtering ? { filtering } : {}),
      }),
    ]);
    return json({ campaigns: campaigns.map(withMajor), adsets: adsets.map(withMajor) });
  } catch (e) {
    return metaErrorResponse(e);
  }
}

// ---------------------------------------------------------------------------
// כתיבה: קריאה מקדימה + אימות שייכות
// ---------------------------------------------------------------------------
const WRITABLE_TYPES = ["campaign", "adset", "ad"];

async function loadOwned(meta: MetaClient, accountBare: string, objectId: string, fields: string) {
  const obj = await meta.get(objectId, { fields: `id,name,account_id,${fields}` });
  if (String(obj?.account_id ?? "") !== accountBare) return null;
  return obj;
}

async function actionSetStatus(sb: SupabaseClient, meta: MetaClient, accountBare: string, caller: Caller, body: any) {
  const objectType = String(body?.object_type ?? "");
  const objectId = String(body?.object_id ?? "");
  const status = String(body?.status ?? "");
  const dryRun = Boolean(body?.dry_run);
  if (!WRITABLE_TYPES.includes(objectType)) return json({ error: "bad_object_type" }, 400);
  if (!OBJECT_ID_RE.test(objectId)) return json({ error: "bad_object_id" }, 400);
  // ‏ARCHIVED/DELETED אינם הפיכים — אין להם מקום בכפתור של פאנל.
  if (status !== "ACTIVE" && status !== "PAUSED") return json({ error: "bad_status" }, 400);

  let current: any;
  try {
    current = await loadOwned(meta, accountBare, objectId, "status,effective_status");
  } catch (e) {
    return metaErrorResponse(e);
  }
  if (!current) return json({ error: "not_in_account" }, 404);

  const plan = { object_type: objectType, object_id: objectId, name: current.name, from: current.status, to: status, effective_status: current.effective_status };
  if (dryRun) return json({ dry_run: true, plan });
  if (current.status === status) return json({ ok: true, unchanged: true, plan });

  try {
    const res = await meta.post(objectId, { status });
    await log(sb, caller, { action: "set_status", object_type: objectType, object_id: objectId, request: plan, response: res, ok: true });
    return json({ ok: true, plan });
  } catch (e) {
    await log(sb, caller, {
      action: "set_status", object_type: objectType, object_id: objectId, request: plan,
      response: e instanceof MetaError ? e.meta : null, ok: false, error: metaErrorText(e),
    });
    return metaErrorResponse(e);
  }
}

async function actionSetBudget(sb: SupabaseClient, meta: MetaClient, accountBare: string, caller: Caller, body: any) {
  const objectType = String(body?.object_type ?? "");
  const objectId = String(body?.object_id ?? "");
  const dryRun = Boolean(body?.dry_run);
  // ‏ad אינו נושא תקציב: הוא יושב בקמפיין (CBO) או בסט.
  if (objectType !== "campaign" && objectType !== "adset") return json({ error: "bad_object_type" }, 400);
  if (!OBJECT_ID_RE.test(objectId)) return json({ error: "bad_object_id" }, 400);
  const targetIls = Number(body?.daily_budget);
  if (!Number.isFinite(targetIls) || targetIls <= 0) return json({ error: "bad_budget" }, 400);
  const targetMinor = Math.round(targetIls * 100);

  let current: any;
  try {
    current = await loadOwned(meta, accountBare, objectId, "status,daily_budget,lifetime_budget");
  } catch (e) {
    return metaErrorResponse(e);
  }
  if (!current) return json({ error: "not_in_account" }, 404);

  const currentMinor = Number(current.daily_budget) || 0;
  if (!currentMinor) {
    // אין daily_budget: או שהתקציב ברמה האחרת (CBO מול סט), או שהוא lifetime.
    return json({
      error: current.lifetime_budget ? "lifetime_budget_not_supported" : "no_budget_on_object",
      detail: current.lifetime_budget
        ? "לאובייקט הזה תקציב לכל התקופה - משנים אותו ב-Ads Manager"
        : "התקציב מוגדר ברמה אחרת (קמפיין או סט) - יש לשנות שם",
    }, 409);
  }

  const multiplier = targetMinor / currentMinor;
  const plan = {
    object_type: objectType, object_id: objectId, name: current.name,
    from_ils: currentMinor / 100, to_ils: targetMinor / 100, multiplier: Math.round(multiplier * 1000) / 1000,
    // ‏20% ומעלה עלולים לאפס את שלב הלמידה (write-actions.md בסקיל).
    learning_reset_risk: Math.abs(multiplier - 1) >= 0.2,
  };
  if (multiplier > MAX_BUDGET_MULTIPLIER) {
    return json({ error: "budget_increase_too_large", detail: `עד פי ${MAX_BUDGET_MULTIPLIER} בפעולה אחת`, plan }, 400);
  }
  if (dryRun) return json({ dry_run: true, plan });
  if (targetMinor === currentMinor) return json({ ok: true, unchanged: true, plan });

  try {
    const res = await meta.post(objectId, { daily_budget: targetMinor });
    await log(sb, caller, { action: "set_budget", object_type: objectType, object_id: objectId, request: plan, response: res, ok: true });
    return json({ ok: true, plan });
  } catch (e) {
    await log(sb, caller, {
      action: "set_budget", object_type: objectType, object_id: objectId, request: plan,
      response: e instanceof MetaError ? e.meta : null, ok: false, error: metaErrorText(e),
    });
    return metaErrorResponse(e);
  }
}

// ---------------------------------------------------------------------------
// generate_copy / save_copy — טיוטות קופי (ads_copy_drafts)
//
// ‏intensity נחתך לתקרת המסלול כאן, וה-check במסד הוא הגדר השנייה. נכס חייב
// להיות active: מודעה לנכס שאינו באתר אסורה (docs/marketing-console.md), ואין
// טעם לנסח אותה.
// ---------------------------------------------------------------------------
async function setting(sb: SupabaseClient, key: string): Promise<unknown> {
  const { data } = await sb.from("ads_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

function readBrief(raw: any): Brief {
  const t = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 500) : undefined);
  return { offer: t(raw?.offer), angle: t(raw?.angle), notes: t(raw?.notes), deadline: t(raw?.deadline) };
}

function withWarnings(audience: Audience, variants: Variant[], brief: Brief) {
  return variants.map((v) => ({ ...v, warnings: checkVariant(audience, v, brief) }));
}

async function actionGenerateCopy(sb: SupabaseClient, caller: Caller, body: any) {
  if (!ANTHROPIC_KEY) return json({ error: "copy_not_configured" }, 503);
  const count = Math.min(Math.max(Math.floor(Number(body?.count) || 3), 1), 6);
  const feedback = typeof body?.feedback === "string" ? body.feedback.trim().slice(0, 1000) : "";

  // כתיבה מחדש של טיוטה קיימת: המסלול, הנכס והתדריך באים מהטיוטה, והרמה
  // יכולה להשתנות ("פחות אגרסיבי").
  let draft: any = null;
  if (body?.draft_id) {
    const { data, error } = await sb.from("ads_copy_drafts").select("*").eq("id", String(body.draft_id)).maybeSingle();
    if (error) return json({ error: "db_error" }, 500);
    if (!data) return json({ error: "draft_not_found" }, 404);
    draft = data;
  }

  const requested = draft?.audience ?? body?.audience;
  if (requested !== "property" && requested !== "platform") return json({ error: "bad_audience" }, 400);
  const audience: Audience = requested;
  let intensity = Math.floor(Number(body?.intensity));
  if (!Number.isFinite(intensity) || intensity < 1) {
    intensity = draft?.intensity ?? (audience === "platform" ? Number(await setting(sb, "platform_default_intensity")) || 3 : 2);
  }
  intensity = Math.min(intensity, MAX_INTENSITY[audience]);
  const brief = body?.brief ? readBrief(body.brief) : readBrief(draft?.brief ?? {});
  const propertyId: string | null = draft?.property_id ?? (body?.property_id ? String(body.property_id) : null);

  let facts: Record<string, unknown> | null = null;
  if (audience === "property") {
    if (!propertyId) return json({ error: "property_required" }, 400);
    const { data: prop, error } = await sb.from("properties").select("id, status").eq("id", propertyId).maybeSingle();
    if (error) return json({ error: "db_error" }, 500);
    if (!prop) return json({ error: "property_not_found" }, 404);
    if (prop.status !== "active") return json({ error: "property_not_active", detail: "מודעה ממומנת רק לנכס שבאוויר" }, 409);
    const { data: f, error: fErr } = await sb.rpc("property_marketing_facts", { p_property_id: propertyId });
    if (fErr) return json({ error: "db_error", detail: fErr.message }, 500);
    facts = Array.isArray(f) ? f[0] : f;
    if (!facts) return json({ error: "property_not_found" }, 404);
  }
  const platformFacts = audience === "platform" ? String((await setting(sb, "platform_facts")) ?? "") : "";

  let variants: Variant[];
  try {
    variants = await generateVariants({
      apiKey: ANTHROPIC_KEY, model: CLAUDE_MODEL, audience, intensity, platformFacts, facts, brief, count,
      previous: draft && feedback ? (draft.variants as Variant[]) : undefined,
      feedback: draft ? feedback : undefined,
    });
  } catch (e) {
    if (e instanceof MarketingCopyAuthError) return json({ error: "copy_auth_failed" }, 503);
    console.error("generate_copy failed", (e as Error).message);
    return json({ error: "copy_failed", detail: (e as Error).message }, 502);
  }

  const now = new Date().toISOString();
  if (draft) {
    // הסבב הקודם נשמר ב-history עם ההערה שהחליפה אותו — עד 10 אחרונים.
    const history = [{ at: now, intensity: draft.intensity, feedback, variants: draft.variants }, ...(draft.history ?? [])].slice(0, 10);
    const { data, error } = await sb.from("ads_copy_drafts")
      .update({ intensity, brief, generated: variants, variants, history, status: "draft", model: CLAUDE_MODEL, updated_at: now })
      .eq("id", draft.id).select("*").single();
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    return json({ draft: { ...data, variants: withWarnings(audience, variants, brief) } });
  }

  const { data, error } = await sb.from("ads_copy_drafts").insert({
    created_by: caller.actorId, audience, intensity, property_id: propertyId, brief,
    generated: variants, variants, model: CLAUDE_MODEL,
  }).select("*").single();
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  return json({ draft: { ...data, variants: withWarnings(audience, variants, brief) } });
}

async function actionSaveCopy(sb: SupabaseClient, body: any) {
  const id = String(body?.draft_id ?? "");
  if (!id) return json({ error: "draft_required" }, 400);
  const { data: draft, error } = await sb.from("ads_copy_drafts").select("id, audience, brief").eq("id", id).maybeSingle();
  if (error) return json({ error: "db_error" }, 500);
  if (!draft) return json({ error: "draft_not_found" }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let variants: Variant[] | null = null;
  if (body?.variants !== undefined) {
    if (!Array.isArray(body.variants) || body.variants.length > 12) return json({ error: "bad_variants" }, 400);
    variants = body.variants.map(cleanVariant);
    patch.variants = variants;
  }
  if (body?.status !== undefined) {
    if (!["draft", "approved", "archived"].includes(body.status)) return json({ error: "bad_status" }, 400);
    patch.status = body.status;
  }
  const { data, error: upErr } = await sb.from("ads_copy_drafts").update(patch).eq("id", id).select("*").single();
  if (upErr) return json({ error: "db_error", detail: upErr.message }, 500);
  const brief = readBrief(draft.brief ?? {});
  return json({ draft: { ...data, variants: withWarnings(draft.audience, (data.variants ?? []) as Variant[], brief) } });
}

// ---------------------------------------------------------------------------
// מודיעין שווקים (intel.ts). מנהל/ת בלבד - לא ה-cron.
// ---------------------------------------------------------------------------
async function actionRegistryRefresh(sb: SupabaseClient) {
  let res;
  try {
    res = await registryCityCounts();
  } catch (e) {
    console.error("registry refresh failed", (e as Error).message);
    return json({ error: "registry_failed", detail: (e as Error).message }, 502);
  }
  const now = new Date().toISOString();
  const rows = [...res.counts.entries()].map(([city_name, brokers]) => ({ city_name, brokers, refreshed_at: now }));
  // ‏upsert ואז מחיקת מה שלא נגעו בו: עיר שנעלמה מהרשם לא נשארת עם ספירה ישנה,
  // וכשל באמצע לא משאיר טבלה ריקה.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("market_intel_registry").upsert(rows.slice(i, i + 500), { onConflict: "city_name" });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
  }
  await sb.from("market_intel_registry").delete().lt("refreshed_at", now);
  return json({ ok: true, brokers: res.total, cities: rows.length, field: res.field });
}

async function loadCity(sb: SupabaseClient, cityId: string) {
  const { data, error } = await sb.from("cities").select("id, name, lat, lng").eq("id", cityId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function placesErrorResponse(e: unknown) {
  if (e instanceof PlacesError) {
    return json({ error: "places_error", detail: e.code + ": " + e.message }, e.status === 429 ? 429 : 502);
  }
  return json({ error: "places_error", detail: (e as Error)?.message ?? String(e) }, 502);
}

async function actionPlacesScan(sb: SupabaseClient, body: any) {
  if (!PLACES_KEY) return json({ error: "places_not_configured" }, 503);
  const city = await loadCity(sb, String(body?.city_id ?? "")).catch(() => null);
  if (!city) return json({ error: "city_not_found" }, 404);
  let r;
  try {
    r = await placesSearch({ apiKey: PLACES_KEY, city: city.name, lat: city.lat, lng: city.lng, live: false });
  } catch (e) {
    return placesErrorResponse(e);
  }
  const now = new Date().toISOString();
  if (r.places.length) {
    const { error } = await sb.from("market_intel_places").upsert(
      r.places.map((p) => ({ place_id: p.id, city_id: city.id, last_seen: now })), { onConflict: "place_id" });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
  }
  const { error: sErr } = await sb.from("market_intel_scans")
    .upsert({ city_id: city.id, offices: r.places.length, capped: r.capped, scanned_at: now }, { onConflict: "city_id" });
  if (sErr) return json({ error: "db_error", detail: sErr.message }, 500);
  return json({ ok: true, city: city.name, offices: r.places.length, capped: r.capped });
}

async function actionPlacesLive(sb: SupabaseClient, body: any) {
  if (!PLACES_KEY) return json({ error: "places_not_configured" }, 503);
  const city = await loadCity(sb, String(body?.city_id ?? "")).catch(() => null);
  if (!city) return json({ error: "city_not_found" }, 404);
  let r;
  try {
    r = await placesSearch({ apiKey: PLACES_KEY, city: city.name, lat: city.lat, lng: city.lng, live: true });
  } catch (e) {
    return placesErrorResponse(e);
  }
  const { data: agencies } = await sb.from("agencies").select("name").eq("city_id", city.id);
  const names = (agencies ?? []).map((a: any) => a.name).filter(Boolean);
  const places = r.places
    .map((p) => ({ ...p, on_platform: matchesPlatform(p.name, names) }))
    .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  return json({ city: city.name, capped: r.capped, places });
}

// ---------------------------------------------------------------------------
async function authorize(req: Request, sb: SupabaseClient): Promise<Caller | Response> {
  const internal = authorizeInternalCaller(req);
  if (internal.ok) {
    return internal.via === "cron_secret"
      ? { via: "cron", actorId: null, full: false }
      : { via: "console", actorId: null, full: true };
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader) {
    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await authed.auth.getUser();
    if (userData?.user) {
      const { data: member, error } = await sb
        .from("agency_members")
        .select("id, is_platform_admin, active")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (error) return json({ error: "db_error" }, 500);
      if (member?.active && member?.is_platform_admin) return { via: "console", actorId: member.id, full: true };
      return json({ error: "forbidden" }, 403);
    }
  }

  if (internal.status === 503) {
    console.error("cron auth לא מוגדר", internal.error, internal.detail);
    return json({ error: internal.error, detail: internal.detail }, 503);
  }
  return json({ error: "unauthorized" }, 401);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const caller = await authorize(req, sb);
  if (caller instanceof Response) return caller;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body?.action ?? "");

  if (!caller.full && action !== "sync_insights") return json({ error: "forbidden_for_cron" }, 403);

  // ה-cron יורה רק כש-enabled; הבדיקה כאן מכסה את הפער בין כיבוי לבין
  // הרצה שכבר הייתה בדרך.
  if (caller.via === "cron") {
    const { data } = await sb.from("ads_settings").select("value").eq("key", "enabled").maybeSingle();
    if (data?.value !== true) return json({ ok: true, skipped: "disabled" });
  }

  // הקופי אינו נוגע במטא — עובד גם לפני שהחשבון מחובר.
  if (action === "generate_copy") return await actionGenerateCopy(sb, caller, body);
  if (action === "save_copy") return await actionSaveCopy(sb, body);
  if (action === "intel_registry_refresh") return await actionRegistryRefresh(sb);
  if (action === "intel_places_scan") return await actionPlacesScan(sb, body);
  if (action === "intel_places_live") return await actionPlacesLive(sb, body);

  if (!ADS_TOKEN || !AD_ACCOUNT) {
    // ‏status עונה 200 כדי שהפאנל יציג "ממתין לחיבור" ולא שגיאה.
    if (action === "status") {
      return json({ configured: false, missing: [!ADS_TOKEN && "META_ADS_ACCESS_TOKEN", !AD_ACCOUNT && "META_AD_ACCOUNT_ID"].filter(Boolean) });
    }
    console.error("ads-admin: META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID אינם מוגדרים");
    return json({ error: "meta_not_configured" }, 503);
  }

  const meta = new MetaClient(ADS_TOKEN, APP_SECRET);
  const { act, bare } = normalizeAccountId(AD_ACCOUNT);

  try {
    switch (action) {
      case "status":
        return await actionStatus(meta, act);
      case "sync_insights":
        return await actionSyncInsights(sb, meta, act, caller, body);
      case "campaigns":
        return await actionCampaigns(meta, act, body);
      case "set_status":
        return await actionSetStatus(sb, meta, bare, caller, body);
      case "set_budget":
        return await actionSetBudget(sb, meta, bare, caller, body);
      default:
        return json({ error: "unknown_action", detail: action }, 400);
    }
  } catch (e) {
    return metaErrorResponse(e);
  }
});
