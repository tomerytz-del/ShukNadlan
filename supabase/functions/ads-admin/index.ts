import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { actionCount, MetaClient, MetaError, normalizeAccountId } from "../_shared/meta-graph.ts";
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
import { LEAD_FIELDS, pageToken, routeLead, storeLead } from "../_shared/meta-leads.ts";
import { customerPath, fromMicros, gaql, googleAdsConfig, GoogleAdsError, keywordIdeas, mutate } from "../_shared/google-ads.ts";
import { DIRECTIONS, seedsFor } from "./google-directions.ts";
import { buildGooglePlan, createdCampaignId } from "./google-campaign.ts";
import { buildPlan, type Created, DESTINATIONS, type Destination, execute, type Format, FORMATS, type GeoPoint, type PlanInput } from "./campaign.ts";

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
//   lead_forms     טפסי הלידים של הדף, עם השיוך שלהם (ads_lead_forms)
//   save_lead_form ‏{form_id, kind, property_id, deal_type, ...} — ושליחת מה שחיכה לו
//   sync_leads     רשת הביטחון של ads-leads-webhook: הלידים של 48 השעות האחרונות
//                  לכל טופס משויך, ושליחה חוזרת של new/failed. גם מה-cron.
//   retry_lead     ‏{meta_lead_id} — שליחה חוזרת של ליד שנכשל
//   subscribe_page רישום הדף ל-leadgen באפליקציה (‏/{page}/subscribed_apps)
//   create_campaign  ‏{draft_id, variants, destination, format, ...} - קמפיין
//                    מנוסח מאושר (‏campaign.ts). ‏dry_run מחזיר את התוכנית
//   discard_campaign ‏{id} - מחיקת קמפיין שנוצר מכאן ולא הופעל, או עץ חלקי
//   google_status    Google Ads: הסודות קיימים? החשבון, המטבע, אזור הזמן
//   google_campaigns ‏{days} - קמפיינים עם הוצאה, קליקים והמרות. קריאה בלבד
//                    (‏_shared/google-ads.ts, שלב 7)
//   google_directions   כיווני הפרסום (‏google-directions.ts) - בלי קריאה לגוגל
//   google_create_campaign ‏{direction, market, market_path, daily_budget, radius_km,
//                    max_cpc?, keywords, negatives, headlines, descriptions, dry_run}
//                    - קמפיין חיפוש מושהה (‏google-campaign.ts). ‏dry_run שולח
//                    לגוגל validateOnly - הבדיקה של גוגל עצמה, בלי ליצור
//   google_set_status ‏{campaign_id, status: ENABLED|PAUSED, dry_run} - קריאה, אישור, יומן
//   google_keyword_ideas ‏{direction, market?} - Keyword Planner: נפח חודשי, תחרות
//                    ומחיר לקליק לרעיונות מהכיוון ומערי השוק. פעולה אחת מהמכסה
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
const PAGE_TOKEN = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5";
const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
const IG_ACCOUNT_ID = Deno.env.get("INSTAGRAM_ACCOUNT_ID") || "";
const SITE = "https://shuknadlan.co.il";

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
  // כל משרד נרשם לעיר שבכתובת שלו, ולא לעיר שנסרקה: הסריקה מחפשת סביב
  // מרכז העיר, ומשרד בעיר השכנה חוזר גם בה (20270324090000).
  const { data: stored, error } = await sb.rpc("market_intel_store_places", {
    p_places: r.places.map((p) => ({ id: p.id, locality: p.locality })),
    p_scanned_city: city.id,
  });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  const { error: sErr } = await sb.from("market_intel_scans")
    .upsert({ city_id: city.id, offices: r.places.length, capped: r.capped, scanned_at: now }, { onConflict: "city_id" });
  if (sErr) return json({ error: "db_error", detail: sErr.message }, 500);
  const { count } = await sb.from("market_intel_places").select("place_id", { count: "exact", head: true }).eq("city_id", city.id);
  return json({ ok: true, city: city.name, offices: count ?? 0, found: r.places.length, capped: r.capped, assigned: stored });
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
  // רק משרדים שהכתובת שלהם בעיר הזו, כמו בסריקה. היישובים השונים ברשימה
  // הם קומץ (העיר והשכנות שלה), ולכן פענוח אחד לכל יישוב ולא לכל משרד.
  const cityOf = new Map<string, string | null>();
  for (const loc of new Set(r.places.map((p) => p.locality).filter((l): l is string => !!l))) {
    const { data } = await sb.rpc("city_id_for_name", { p_name: loc });
    cityOf.set(loc, (data as string | null) ?? null);
  }
  const inCity = r.places.filter((p) => !p.locality || cityOf.get(p.locality) === city.id);
  const places = inCity
    .map(({ locality: _l, ...p }) => ({ ...p, on_platform: matchesPlatform(p.name, names) }))
    .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  return json({ city: city.name, capped: r.capped, places, other_city: r.places.length - inCity.length });
}

// ---------------------------------------------------------------------------
// לידים מטפסי מטא (שלב 4). השליחה עצמה ב-_shared/meta-leads.ts, משותפת
// ל-ads-leads-webhook. כאן: שיוך טפסים, סנכרון, ושליחה חוזרת.
// ---------------------------------------------------------------------------
const FORM_KINDS = ["property", "owner", "buyer", "broker", "ignore"];
const ROUTE_OPTS = { supabaseUrl, serviceRoleKey };

async function leadsToken(): Promise<string> {
  return await pageToken(ADS_TOKEN, PAGE_ID, PAGE_TOKEN || ADS_TOKEN);
}

// ליד שחיכה (טופס שלא שויך) או שנכשל - נשלח שוב. ‏formId מצמצם לטופס אחד.
async function routePending(sb: SupabaseClient, formId?: string) {
  let q = sb.from("ads_leads").select("meta_lead_id").in("status", ["new", "failed"]).lt("attempts", 5)
    .order("received_at", { ascending: true }).limit(100);
  if (formId) q = q.eq("form_id", formId);
  const { data } = await q;
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    const res = await routeLead(sb, ROUTE_OPTS, r.meta_lead_id);
    out[res.status] = (out[res.status] ?? 0) + 1;
  }
  return out;
}

async function actionLeadForms(sb: SupabaseClient) {
  if (!PAGE_ID) return json({ error: "page_not_configured" }, 503);
  const token = await leadsToken();
  if (!token) return json({ error: "meta_not_configured" }, 503);
  let forms: any[] = [];
  try {
    forms = await new MetaClient(token, APP_SECRET).getAll(`${PAGE_ID}/leadgen_forms`, {
      fields: "id,name,status,created_time,questions{key,label,type}", limit: 100,
    });
  } catch (e) {
    return metaErrorResponse(e);
  }
  const { data: mapped } = await sb.from("ads_lead_forms").select("*");
  const byId = new Map((mapped ?? []).map((m: any) => [m.form_id, m]));
  const { data: counts } = await sb.from("ads_leads").select("form_id, status");
  const tally: Record<string, Record<string, number>> = {};
  for (const c of counts ?? []) {
    const k = c.form_id ?? "";
    tally[k] ??= {};
    tally[k][c.status] = (tally[k][c.status] ?? 0) + 1;
  }
  return json({
    forms: forms.map((f) => ({
      id: f.id, name: f.name, status: f.status, created_time: f.created_time,
      questions: (f.questions ?? []).map((q: any) => ({ key: q.key, label: q.label, type: q.type })),
      mapping: byId.get(f.id) ?? null,
      leads: tally[f.id] ?? {},
    })),
  });
}

async function actionSaveLeadForm(sb: SupabaseClient, body: any) {
  const formId = String(body?.form_id ?? "");
  if (!/^\d{5,25}$/.test(formId)) return json({ error: "bad_form_id" }, 400);
  const kind = String(body?.kind ?? "");
  if (!FORM_KINDS.includes(kind)) return json({ error: "bad_kind" }, 400);
  const deal = body?.deal_type === "rent" ? "rent" : body?.deal_type === "sale" ? "sale" : null;
  const propertyId = body?.property_id ? String(body.property_id) : null;
  if (kind === "property") {
    if (!propertyId) return json({ error: "property_required" }, 400);
    const { data: prop } = await sb.from("properties").select("id, status").eq("id", propertyId).maybeSingle();
    if (!prop) return json({ error: "property_not_found" }, 404);
    if (prop.status !== "active") return json({ error: "property_not_active" }, 409);
  }
  const t = (x: unknown, n = 80) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
  const fieldMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(body?.field_map ?? {})) {
    if (["city", "property_type", "budget", "rooms", "consent", "note"].includes(k) && typeof v === "string" && v) {
      fieldMap[k] = v.slice(0, 100);
    }
  }
  const { error } = await sb.from("ads_lead_forms").upsert({
    form_id: formId, form_name: t(body?.form_name, 200), kind,
    property_id: kind === "property" ? propertyId : null,
    deal_type: deal, default_city: t(body?.default_city), default_property_type: t(body?.default_property_type),
    field_map: fieldMap, updated_at: new Date().toISOString(),
  }, { onConflict: "form_id" });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  // מה שחיכה לשיוך הזה יוצא עכשיו, ולא בעוד שעה.
  const routed = await routePending(sb, formId);
  return json({ ok: true, routed });
}

async function actionSyncLeads(sb: SupabaseClient, caller: Caller, body: any) {
  const hours = Math.min(Math.max(Number(body?.hours) || 48, 1), 24 * 30);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const { data: forms } = await sb.from("ads_lead_forms").select("form_id").neq("kind", "ignore");
  const summary: Record<string, unknown> = { forms: (forms ?? []).length, fetched: 0 };
  const token = (forms ?? []).length ? await leadsToken() : "";
  if ((forms ?? []).length && token) {
    const meta = new MetaClient(token, APP_SECRET);
    let fetched = 0;
    const failed: string[] = [];
    for (const f of forms ?? []) {
      try {
        const leads = await meta.getAll(`${f.form_id}/leads`, {
          fields: LEAD_FIELDS,
          filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
          limit: 100,
        });
        for (const l of leads) {
          await storeLead(sb, { ...l, form_id: l.form_id ?? f.form_id }, "sync");
          fetched++;
        }
      } catch (e) {
        failed.push(f.form_id);
        summary[`error_${f.form_id}`] = e instanceof MetaError ? e.message : String(e);
        if (e instanceof MetaError && (e.tokenInvalid || e.rateLimited)) break;
      }
    }
    summary.fetched = fetched;
    if (failed.length) summary.failed_forms = failed;
  } else if ((forms ?? []).length) {
    summary.error = "no_token";
  }
  summary.routed = await routePending(sb);
  await log(sb, caller, {
    action: "sync_leads", object_type: "lead_form", object_id: null, request: { hours }, response: summary,
    ok: !summary.failed_forms && !summary.error, error: summary.error ? String(summary.error) : null,
  });
  return json({ ok: true, ...summary });
}

async function actionRetryLead(sb: SupabaseClient, body: any) {
  const id = String(body?.meta_lead_id ?? "");
  if (!id) return json({ error: "lead_required" }, 400);
  // ניסיון ידני מאפס את מונה הניסיונות - מי שלוחץ/ת "שוב" כבר בדק/ה מה נכשל.
  await sb.from("ads_leads").update({ attempts: 0 }).eq("meta_lead_id", id).in("status", ["failed", "new"]);
  const r = await routeLead(sb, ROUTE_OPTS, id);
  return json({ ok: r.status === "routed" || r.status === "broker" || r.status === "skipped", ...r });
}

async function actionSubscribePage(sb: SupabaseClient, caller: Caller) {
  if (!PAGE_ID) return json({ error: "page_not_configured" }, 503);
  const token = await leadsToken();
  if (!token) return json({ error: "meta_not_configured" }, 503);
  try {
    const res = await new MetaClient(token, APP_SECRET).post(`${PAGE_ID}/subscribed_apps`, { subscribed_fields: "leadgen" });
    await log(sb, caller, { action: "subscribe_page", object_type: "account", object_id: PAGE_ID, response: res, ok: true });
    return json({ ok: true });
  } catch (e) {
    await log(sb, caller, { action: "subscribe_page", object_type: "account", object_id: PAGE_ID, ok: false, error: e instanceof MetaError ? e.message : String(e) });
    return metaErrorResponse(e);
  }
}

// ---------------------------------------------------------------------------
// create_campaign / discard_campaign (שלב 5, campaign.ts)
//
// ‏**מה נחסם, ולמה כאן ולא בעורך:**
//   - טיוטה שלא אושרה. העורך מזהיר; היצירה היא המקום שבו זה הופך לכסף.
//   - שורת הגילוי ריקה (‏ads_settings.disclosure_line). במודעת נכס נוספת לה
//     גם השורה של המתווך/ת שהנכס שלו/ה, ורק עם רישיון מאומת: התקנות דורשות
//     שם ומספר רישיון בכל מודעה של מתווך/ת, והנכס משווק בשמו/ה.
//   - נכס שאינו באוויר, ונכס בלי אישור מפורש שיש הסכמת בעלים לפרסום ממומן
//     (‏owner_consent). את ההסכמה עצמה אין לנו במסד, ולכן היא מאושרת בחלון
//     ונרשמת ביומן - לא מנוחשת.
//   - טופס לידים שאינו מהסוג המתאים: נכס ← טופס "פנייה על נכס" של אותו נכס
//     או "מחפש/ת"; פלטפורמה ← "מתווכים". אחרת ליד ממודעה על דירה היה נכנס
//     לרוטציה של מוכרים.
//   - תקציב מעל ads_settings.max_daily_budget, וחשבון שאינו בשקלים.
//   - תמונה בקמפיין הפלטפורמה רק מהאחסון שלנו או מהאתר: הפונקציה מורידה
//     אותה, וכתובת חופשית הייתה הופכת אותה למורידה של כל דבר.
// ---------------------------------------------------------------------------
function storageHost(): string {
  try { return new URL(supabaseUrl).host; } catch { return ""; }
}

function allowedImageUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u.trim());
    if (url.protocol !== "https:") return null;
    if (url.host !== storageHost() && url.host !== "shuknadlan.co.il") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);

function utm(campaignKey: string) {
  return `utm_source=meta&utm_medium=paid&utm_campaign=${encodeURIComponent(campaignKey)}`;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

async function actionCreateCampaign(sb: SupabaseClient, meta: MetaClient, act: string, caller: Caller, body: any) {
  const dryRun = Boolean(body?.dry_run);
  const draftId = String(body?.draft_id ?? "");
  if (!draftId) return json({ error: "draft_required" }, 400);
  const { data: draft, error: dErr } = await sb.from("ads_copy_drafts").select("*").eq("id", draftId).maybeSingle();
  if (dErr) return json({ error: "db_error" }, 500);
  if (!draft) return json({ error: "draft_not_found" }, 404);
  if (draft.status !== "approved") return json({ error: "draft_not_approved" }, 409);

  const all = (draft.variants ?? []) as any[];
  const picked: number[] = Array.isArray(body?.variants) ? [...new Set(body.variants.map((n: unknown) => Math.floor(Number(n))))] as number[] : [0];
  if (!picked.length || picked.length > 3 || picked.some((i) => !Number.isInteger(i) || i < 0 || i >= all.length)) {
    return json({ error: "bad_variants" }, 400);
  }
  const variants = picked.map((i) => ({
    angle: String(all[i]?.angle ?? ""), primary_text: String(all[i]?.primary_text ?? ""),
    headline: String(all[i]?.headline ?? ""), description: String(all[i]?.description ?? ""), cta: String(all[i]?.cta ?? ""),
  }));

  const destination = String(body?.destination ?? "") as Destination;
  if (!DESTINATIONS.includes(destination)) return json({ error: "bad_destination" }, 400);
  const format = String(body?.format ?? "image") as Format;
  if (!FORMATS.includes(format)) return json({ error: "bad_format" }, 400);
  if (format === "carousel" && draft.audience !== "property") return json({ error: "carousel_property_only" }, 400);

  const disclosureLine = String((await setting(sb, "disclosure_line")) ?? "").trim();
  if (!disclosureLine) return json({ error: "disclosure_missing" }, 409);
  const maxBudget = Number(await setting(sb, "max_daily_budget")) || 150;
  const dailyBudget = Math.round(Number(body?.daily_budget) * 100) / 100;
  if (!(dailyBudget >= 10 && dailyBudget <= maxBudget)) return json({ error: "bad_budget", detail: `בין ₪10 ל-₪${maxBudget} ליום` }, 400);
  let endTime: string | undefined;
  if (body?.days !== undefined && body?.days !== null && body?.days !== "") {
    const days = Math.floor(Number(body.days));
    if (!(days >= 1 && days <= 60)) return json({ error: "bad_days" }, 400);
    endTime = new Date(Date.now() + days * 86_400_000).toISOString();
  }
  const ageMin = clampInt(body?.age_min, 18, 65, 25);
  const ageMax = clampInt(body?.age_max, 18, 65, 65);
  const defaultRadius = Number(await setting(sb, "default_radius_km")) || 15;
  const leadFormId = destination === "lead_form" ? String(body?.lead_form_id ?? "") : "";

  let form: any = null;
  if (destination === "lead_form") {
    if (!leadFormId) return json({ error: "lead_form_required" }, 400);
    const { data, error } = await sb.from("ads_lead_forms").select("form_id, kind, property_id").eq("form_id", leadFormId).maybeSingle();
    if (error) return json({ error: "db_error" }, 500);
    if (!data) return json({ error: "lead_form_not_mapped", detail: "שייכו את הטופס בלשונית לידים ממטא" }, 409);
    form = data;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const key = `sn_${draft.id.slice(0, 8)}`;
  let disclosure = disclosureLine;
  let images: string[] = [];
  let geo: GeoPoint[] = [];
  let landingUrl: string | undefined;
  let campaignName: string;
  const propertyId: string | null = draft.property_id ?? null;

  if (draft.audience === "property") {
    if (!propertyId) return json({ error: "property_required" }, 400);
    if (body?.owner_consent !== true) return json({ error: "owner_consent_required" }, 400);
    const { data: prop, error } = await sb.from("properties")
      .select("id, title, city, status, lat, lng, images, marketing_image, agent_id").eq("id", propertyId).maybeSingle();
    if (error) return json({ error: "db_error" }, 500);
    if (!prop) return json({ error: "property_not_found" }, 404);
    if (prop.status !== "active") return json({ error: "property_not_active", detail: "מודעה ממומנת רק לנכס שבאוויר" }, 409);

    const { data: agent } = prop.agent_id
      ? await sb.from("agency_members").select("display_name, license_number, license_status").eq("id", prop.agent_id).maybeSingle()
      : { data: null };
    if (!agent?.license_number || !["verified", "manual"].includes(agent.license_status) || !agent.display_name) {
      return json({ error: "agent_license_missing", detail: "למתווך/ת של הנכס אין רישיון מאומת - אין שורת גילוי" }, 409);
    }
    const agentLine = `${String(agent.display_name).trim()}, רישיון תיווך ${agent.license_number}`;
    disclosure = disclosureLine.includes(String(agent.license_number)) ? disclosureLine : `${agentLine} | ${disclosureLine}`;

    images = [...new Set([prop.marketing_image, ...(prop.images ?? [])].filter(isHttps))];
    let lat = Number(prop.lat), lng = Number(prop.lng);
    if (!(lat && lng) && prop.city) {
      const { data: c } = await sb.from("cities").select("lat, lng").eq("name", prop.city).maybeSingle();
      lat = Number(c?.lat); lng = Number(c?.lng);
    }
    if (!(lat && lng)) return json({ error: "property_no_location" }, 409);
    geo = [{ lat, lng, radius_km: clampInt(body?.radius_km, 1, 80, defaultRadius), label: String(prop.city ?? prop.title ?? "") }];
    landingUrl = `${SITE}/property?id=${encodeURIComponent(prop.id)}&${utm(key)}`;
    campaignName = `SN · נכס · ${String(prop.title ?? prop.city ?? "").slice(0, 40)} · ${stamp}`;

    if (form && !(form.kind === "buyer" || (form.kind === "property" && form.property_id === propertyId))) {
      return json({ error: "lead_form_wrong_kind", detail: "לנכס: טופס פנייה על הנכס הזה, או טופס מחפשים" }, 409);
    }
  } else {
    const cityIds: string[] = Array.isArray(body?.city_ids) ? [...new Set(body.city_ids.map(String))] as string[] : [];
    if (!cityIds.length || cityIds.length > 10) return json({ error: "cities_required", detail: "בין עיר אחת לעשר" }, 400);
    const { data: cities, error } = await sb.from("cities").select("id, name, lat, lng").in("id", cityIds);
    if (error) return json({ error: "db_error" }, 500);
    const radius = clampInt(body?.radius_km, 1, 80, 10);
    geo = (cities ?? []).filter((c: any) => Number(c.lat) && Number(c.lng))
      .map((c: any) => ({ lat: Number(c.lat), lng: Number(c.lng), radius_km: radius, label: String(c.name) }));
    if (geo.length !== cityIds.length) return json({ error: "city_no_location" }, 409);

    const img = allowedImageUrl(body?.image_url);
    if (!img) return json({ error: "bad_image_url", detail: "תמונה מהאחסון של האתר בלבד (https)" }, 400);
    images = [img];
    let path = String((await setting(sb, "platform_landing_path")) ?? "/pricing");
    if (!path.startsWith("/") || path.startsWith("//")) path = "/pricing";
    landingUrl = `${SITE}${path}${path.includes("?") ? "&" : "?"}${utm(key)}`;
    campaignName = `SN · מתווכים · ${(variants[0].angle || "פלטפורמה").slice(0, 30)} · ${stamp}`;

    if (form && form.kind !== "broker") return json({ error: "lead_form_wrong_kind", detail: "לקמפיין למתווכים: טופס מסוג מתווכים" }, 409);
  }

  const inp: PlanInput = {
    audience: draft.audience, campaignName, pageId: PAGE_ID, instagramUserId: IG_ACCOUNT_ID || undefined,
    destination, format, variants, disclosure, images, landingUrl, leadFormId: leadFormId || undefined,
    dailyBudget, endTime, geo, ageMin, ageMax,
  };
  const { plan, errors, warnings } = buildPlan(inp);
  if (!plan) return json({ error: "invalid_plan", errors, warnings }, 400);

  const account = await meta.get(act, { fields: "currency" });
  if (account?.currency !== "ILS") return json({ error: "account_currency_not_ils", detail: String(account?.currency ?? "") }, 409);

  const preview = {
    name: campaignName,
    summary: plan.summary,
    disclosure,
    ads: plan.creatives.map((c) => ({ headline: c.headline, message: c.message, cta: c.cta, images: c.images.length })),
  };
  if (dryRun) return json({ dry_run: true, plan: preview, warnings });

  const { data: row, error: insErr } = await sb.from("ads_campaigns").insert({
    created_by: caller.actorId, draft_id: draft.id, audience: draft.audience, property_id: propertyId,
    name: campaignName, destination, format, lead_form_id: leadFormId || null, daily_budget: dailyBudget,
    end_time: endTime ?? null, plan: { ...preview, adset: plan.adset, owner_consent: draft.audience === "property" ? true : null },
  }).select("id").single();
  if (insErr) return json({ error: "db_error", detail: insErr.message }, 500);

  const objects: Created[] = [];
  const record = async (o: Created) => {
    objects.push(o);
    const patch: Record<string, unknown> = { objects, updated_at: new Date().toISOString() };
    if (o.type === "campaign") patch.meta_campaign_id = o.id;
    const { error } = await sb.from("ads_campaigns").update(patch).eq("id", row.id);
    if (error) console.error("ads_campaigns record failed", row.id, error.message);
  };

  try {
    const res = await execute(meta, act, inp, plan, record);
    await sb.from("ads_campaigns").update({ status: "created", updated_at: new Date().toISOString() }).eq("id", row.id);
    await log(sb, caller, { action: "create_campaign", object_type: "campaign", object_id: res.campaignId, request: { id: row.id, ...preview }, response: res, ok: true });
    return json({ ok: true, id: row.id, campaign_id: res.campaignId, ads: res.ads.length, warnings });
  } catch (e) {
    const msg = e instanceof MetaError ? e.message : (e as Error)?.message ?? String(e);
    await sb.from("ads_campaigns").update({ status: "failed", error: msg.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", row.id);
    await log(sb, caller, {
      action: "create_campaign", object_type: "campaign", object_id: objects.find((o) => o.type === "campaign")?.id ?? null,
      request: { id: row.id, ...preview }, response: e instanceof MetaError ? e.meta : { objects }, ok: false, error: msg,
    });
    if (e instanceof MetaError) return metaErrorResponse(e);
    return json({ error: "create_failed", detail: msg, id: row.id }, 502);
  }
}

async function actionDiscardCampaign(sb: SupabaseClient, meta: MetaClient, accountBare: string, caller: Caller, body: any) {
  const id = String(body?.id ?? "");
  const { data: row, error } = await sb.from("ads_campaigns").select("*").eq("id", id).maybeSingle();
  if (error) return json({ error: "db_error" }, 500);
  if (!row) return json({ error: "campaign_not_found" }, 404);
  if (row.status === "discarded") return json({ ok: true, unchanged: true });

  const campaignId: string | null = row.meta_campaign_id ?? null;
  if (campaignId) {
    const current = await loadOwned(meta, accountBare, campaignId, "status,effective_status");
    // קמפיין שכבר נמחק במטא (ב-Ads Manager) - רק מסמנים כאן.
    if (current && current.status === "ACTIVE") {
      return json({ error: "campaign_active", detail: "קמפיין פעיל משהים קודם, ואז מוחקים" }, 409);
    }
    if (Boolean(body?.dry_run)) return json({ dry_run: true, plan: { name: row.name, campaign_id: campaignId, status: current?.status ?? null } });
    if (current) {
      try {
        // מחיקת קמפיין מוחקת איתו את הסטים והמודעות. הקריאייטיבים והתמונות
        // נשארים יתומים בספריית החשבון - הם אינם מוציאים כסף.
        await meta.post(campaignId, { status: "DELETED" });
      } catch (e) {
        await log(sb, caller, { action: "discard_campaign", object_type: "campaign", object_id: campaignId, request: { id }, response: e instanceof MetaError ? e.meta : null, ok: false, error: metaErrorText(e) });
        return metaErrorResponse(e);
      }
    }
  } else if (Boolean(body?.dry_run)) {
    return json({ dry_run: true, plan: { name: row.name, campaign_id: null, status: null } });
  }
  await sb.from("ads_campaigns").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", id);
  await log(sb, caller, { action: "discard_campaign", object_type: "campaign", object_id: campaignId, request: { id }, ok: true });
  return json({ ok: true });
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

// ---------------------------------------------------------------------------
// Google Ads - שלב 7. קריאה (7א), Keyword Planner (7ב), ויצירת קמפיין
// והשהיה/הפעלה (7ג) באותו דפוס של מטא: קריאה, validateOnly, אישור ויומן.
// ---------------------------------------------------------------------------

function googleErrorResponse(e: unknown) {
  if (e instanceof GoogleAdsError) {
    console.error("google ads", e.status, e.code, e.message);
    return json({ error: "google_error", code: e.code, detail: e.message, errors: e.details.slice(0, 8) }, e.status === 429 ? 429 : 502);
  }
  return json({ error: "google_error", detail: (e as Error)?.message ?? String(e) }, 502);
}

async function actionGoogleStatus() {
  const { config, missing } = googleAdsConfig((k) => Deno.env.get(k));
  // ‏200 ולא שגיאה: הפאנל מציג "ממתין לחיבור" עם רשימת הסודות החסרים.
  if (!config) return json({ configured: false, missing });
  try {
    const rows = await gaql(config,
      "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.test_account FROM customer LIMIT 1");
    const c = rows[0]?.customer || {};
    return json({
      configured: true,
      version: config.version,
      account: { id: String(c.id || config.customerId), name: c.descriptiveName || null, currency: c.currencyCode || null, time_zone: c.timeZone || null, test: !!c.testAccount },
    });
  } catch (e) {
    return googleErrorResponse(e);
  }
}

async function actionGoogleCampaigns(body: any) {
  const { config } = googleAdsConfig((k) => Deno.env.get(k));
  if (!config) return json({ error: "google_not_configured" }, 503);
  const days = [7, 30, 90].includes(Number(body?.days)) ? Number(body.days) : 30;
  // תאריכים לפי שעון ישראל - כמו החשבון. ‏BETWEEN כולל את שני הקצוות.
  const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  try {
    // שתי שאילתות: רשימת הקמפיינים בלי segments.date (אחרת קמפיין מושהה בלי
    // חשיפות אינו חוזר בכלל - בדיוק זה שנוצר עכשיו), והמדדים לפי יום, שמתאחדים
    // לשורה אחת לקמפיין (‏segments.date מחזיר שורה לכל יום).
    const list = await gaql(config, `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign_budget.amount_micros
        FROM campaign
       WHERE campaign.status != 'REMOVED'`);
    const daily = await gaql(config, `
      SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM campaign
       WHERE segments.date BETWEEN '${ymd(from)}' AND '${ymd(to)}'
         AND campaign.status != 'REMOVED'`);
    const sums = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number }>();
    for (const r of daily) {
      const id = String(r.campaign?.id || "");
      const t = sums.get(id) || { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      t.impressions += Number(r.metrics?.impressions || 0);
      t.clicks += Number(r.metrics?.clicks || 0);
      t.cost += fromMicros(r.metrics?.costMicros);
      t.conversions += Number(r.metrics?.conversions || 0);
      sums.set(id, t);
    }
    const campaigns = list.map((r: any) => {
      const id = String(r.campaign?.id || "");
      const m = sums.get(id) || { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      return {
        id,
        name: r.campaign?.name || "",
        status: r.campaign?.status || "",
        channel: r.campaign?.advertisingChannelType || "",
        daily_budget: r.campaignBudget?.amountMicros != null ? fromMicros(r.campaignBudget.amountMicros) : null,
        ...m,
      };
    }).sort((a: any, b: any) => b.cost - a.cost);
    return json({ ok: true, from: ymd(from), to: ymd(to), days, campaigns });
  } catch (e) {
    return googleErrorResponse(e);
  }
}

async function actionGoogleKeywordIdeas(sb: SupabaseClient, body: any) {
  const { config } = googleAdsConfig((k) => Deno.env.get(k));
  if (!config) return json({ error: "google_not_configured" }, 503);
  const d = DIRECTIONS.find((x) => x.key === String(body?.direction || ""));
  if (!d) return json({ error: "unknown_direction" }, 400);

  // ערי השוק, הגדולות קודם. שלוש נכנסות למונחי הזרע (תקרה של 20 מונחים),
  // וכולן משמשות לסימון "מקומי" ברעיונות שחוזרים.
  let marketCities: string[] = [];
  if (d.market) {
    const market = String(body?.market || "");
    if (!market) return json({ error: "market_required" }, 400);
    const { data, error } = await sb.from("cities").select("name, population")
      .eq("market_slug", market).order("population", { ascending: false, nullsFirst: false });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    marketCities = (data || []).map((c: any) => String(c.name));
    if (!marketCities.length) return json({ error: "market_not_found" }, 404);
  }
  const seeds = seedsFor(d, marketCities.slice(0, 3));
  try {
    const ideas = await keywordIdeas(config, seeds);
    const seedSet = new Set(seeds);
    const rows = ideas.map((i) => ({
      ...i,
      seed: seedSet.has(i.text),
      local: marketCities.some((c) => i.text.includes(c)),
    })).sort((a, b) => (b.searches ?? -1) - (a.searches ?? -1));
    return json({ ok: true, direction: d.key, seeds, cities: marketCities.slice(0, 3), negatives: d.negatives, ideas: rows });
  } catch (e) {
    return googleErrorResponse(e);
  }
}

async function actionGoogleCreateCampaign(sb: SupabaseClient, caller: Caller, body: any) {
  const { config } = googleAdsConfig((k) => Deno.env.get(k));
  if (!config) return json({ error: "google_not_configured" }, 503);
  const dryRun = Boolean(body?.dry_run);
  const d = DIRECTIONS.find((x) => x.key === String(body?.direction || ""));
  if (!d) return json({ error: "unknown_direction" }, 400);

  // כל קמפיין ממוקד לשוק - גם גיוס מתווכים, שבו העיר אינה במילים.
  const market = String(body?.market || "");
  const marketPath = String(body?.market_path ?? "/");
  if (!market) return json({ error: "market_required" }, 400);
  if (!/^\/[a-z0-9-]*$/.test(marketPath)) return json({ error: "bad_request", detail: "market_path" }, 400);
  const { data: top, error: cErr } = await sb.from("cities").select("name, lat, lng")
    .eq("market_slug", market).not("lat", "is", null)
    .order("population", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (cErr) return json({ error: "db_error", detail: cErr.message }, 500);
  if (!top) return json({ error: "market_not_found" }, 404);

  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).slice(0, 16);
  const { plan, errors, warnings } = buildGooglePlan(config, {
    direction: d,
    market: { slug: market, path: marketPath, city: String(top.name), lat: Number(top.lat), lng: Number(top.lng) },
    daily_budget: Number(body?.daily_budget),
    radius_km: Number(body?.radius_km),
    max_cpc: body?.max_cpc == null || body?.max_cpc === "" ? null : Number(body.max_cpc),
    keywords: list(body?.keywords),
    negatives: list(body?.negatives),
    headlines: list(body?.headlines),
    descriptions: list(body?.descriptions),
    stamp,
  });
  if (!plan) return json({ error: "invalid_plan", errors, warnings }, 400);
  const { operations, ...preview } = plan;

  try {
    if (dryRun) {
      // ‏validateOnly: גוגל בודקת את כל הבקשה - מדיניות, אורכים, מילים - ולא יוצרת.
      await mutate(config, operations, true);
      return json({ dry_run: true, plan: preview, warnings });
    }
    const res = await mutate(config, operations, false);
    const campaignId = createdCampaignId(res);
    await log(sb, caller, {
      action: "google_create_campaign", object_type: "campaign", object_id: campaignId,
      request: { customer: customerPath(config), ...preview }, response: { campaign_id: campaignId, operations: operations.length }, ok: true,
    });
    return json({ ok: true, campaign_id: campaignId, name: plan.name, warnings });
  } catch (e) {
    if (!dryRun) {
      await log(sb, caller, {
        action: "google_create_campaign", object_type: "campaign", request: { customer: customerPath(config), ...preview },
        response: e instanceof GoogleAdsError ? { code: e.code, errors: e.details } : null, ok: false, error: (e as Error)?.message ?? String(e),
      });
    }
    return googleErrorResponse(e);
  }
}

async function actionGoogleSetStatus(sb: SupabaseClient, caller: Caller, body: any) {
  const { config } = googleAdsConfig((k) => Deno.env.get(k));
  if (!config) return json({ error: "google_not_configured" }, 503);
  const id = String(body?.campaign_id || "");
  const to = String(body?.status || "");
  if (!/^\d{1,20}$/.test(id) || !["ENABLED", "PAUSED"].includes(to)) return json({ error: "bad_request" }, 400);
  try {
    // קריאה קודם: הקמפיין קיים בחשבון שלנו, ומה הסטטוס שלו עכשיו.
    const rows = await gaql(config, `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${id}`);
    const cur = rows[0]?.campaign;
    if (!cur) return json({ error: "not_found" }, 404);
    const plan = { name: cur.name || id, from: cur.status || null, to };
    if (Boolean(body?.dry_run)) return json({ dry_run: true, plan });
    try {
      await mutate(config, [{ campaignOperation: { update: { resourceName: `${customerPath(config)}/campaigns/${id}`, status: to }, updateMask: "status" } }], false);
    } catch (e) {
      await log(sb, caller, { action: "google_set_status", object_type: "campaign", object_id: id, request: plan, ok: false, error: (e as Error)?.message ?? String(e) });
      throw e;
    }
    await log(sb, caller, { action: "google_set_status", object_type: "campaign", object_id: id, request: plan, ok: true });
    return json({ ok: true, plan });
  } catch (e) {
    return googleErrorResponse(e);
  }
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

  // ה-cron מורשה לשני סנכרונים בלבד - שום פעולה שמשנה קמפיין או שולחת ליד ידנית.
  if (!caller.full && action !== "sync_insights" && action !== "sync_leads") return json({ error: "forbidden_for_cron" }, 403);

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
  // הלידים צריכים טוקן של הדף ולא בהכרח את חשבון המודעות - לפני הבדיקה שלו.
  if (action === "lead_forms") return await actionLeadForms(sb);
  if (action === "save_lead_form") return await actionSaveLeadForm(sb, body);
  if (action === "sync_leads") return await actionSyncLeads(sb, caller, body);
  if (action === "retry_lead") return await actionRetryLead(sb, body);
  if (action === "subscribe_page") return await actionSubscribePage(sb, caller);
  // גוגל - חשבון נפרד וסודות נפרדים, ולכן לפני הבדיקה של מטא.
  if (action === "google_status") return await actionGoogleStatus();
  if (action === "google_campaigns") return await actionGoogleCampaigns(body);
  if (action === "google_directions") return json({ directions: DIRECTIONS });
  if (action === "google_keyword_ideas") return await actionGoogleKeywordIdeas(sb, body);
  if (action === "google_create_campaign") return await actionGoogleCreateCampaign(sb, caller, body);
  if (action === "google_set_status") return await actionGoogleSetStatus(sb, caller, body);

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
      case "create_campaign":
        return await actionCreateCampaign(sb, meta, act, caller, body);
      case "discard_campaign":
        return await actionDiscardCampaign(sb, meta, bare, caller, body);
      default:
        return json({ error: "unknown_action", detail: action }, 400);
    }
  } catch (e) {
    return metaErrorResponse(e);
  }
});
