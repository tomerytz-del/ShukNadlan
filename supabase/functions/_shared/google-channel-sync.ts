// ============================================================================
// שורות ads_channel_daily לסנכרון Google Ads (ads-admin, google_sync_insights)
//
// שאילתת GAQL עם segments.date מחזירה שורה רק ליום שהיה בו impression.
// קמפיין מושהה, או יום בלי חשיפות, נעלם מהתשובה לגמרי. הקוד הישן כתב רק
// את מה שגוגל החזירה, ולכן synced_at קפא על היום האחרון עם הוצאה, ובלי
// שורה ב-ads_actions_log אי אפשר היה להבדיל בין "רץ ואין הוצאה" לבין
// cron, אימות או API שנשברו. כאן יום בחלון בלי שורה נכתב כאפס, והיומן
// נבנה בלי מזהה חשבון ובלי טקסט של מודעה.
//
// אין כאן רשת ואין כאן מסד. הבדיקה: scripts/google_channel_sync_test.ts
// ============================================================================

// אותו חישוב כמו fromMicros ב-google-ads.ts. לא מייבאים את הקובץ: בדיקת
// node ב-strip-types לא מעכלת parameter properties שבמחלקת השגיאה שם.
const fromMicros = (v: unknown) => Number(v || 0) / 1_000_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_CURRENCY = new Set(["ILS", "USD"]);

// מ-v23 (28.1.2026) campaign.start_date ו-campaign.end_date נמחקו.
// ברירת המחדל כאן היא v25, וגם v26 משאיר את start_date_time.
// הערך הוא "yyyy-MM-dd HH:mm:ss" בשעון הלקוח; ב-REST המפתח startDateTime.
export const GOOGLE_CAMPAIGN_LIST_GAQL = `
  SELECT campaign.id, campaign.name, campaign.status, campaign.start_date_time, customer.currency_code
    FROM campaign
   WHERE campaign.status != 'REMOVED'`;

export function googleMetricGaql(from: string, to: string): string {
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new Error("bad_date");
  return `
      SELECT campaign.id, campaign.name, campaign.status, customer.currency_code, segments.date,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM campaign
       WHERE segments.date BETWEEN '${from}' AND '${to}'
         AND campaign.status != 'REMOVED'`;
}

// "היום" לפי שעון ישראל, כמו חשבון המודעות. חלון של N ימים כולל את היום.
export function jerusalemDay(d: Date): string {
  const s = d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (!DAY_RE.test(s)) throw new Error("bad_date");
  return s;
}

export function syncWindow(now: Date, days: number): { from: string; to: string } {
  const n = Math.min(Math.max(Math.floor(days), 1), 90);
  const to = jerusalemDay(now);
  const from = jerusalemDay(new Date(now.getTime() - (n - 1) * 86_400_000));
  return { from, to };
}

export function enumerateDays(from: string, to: string): string[] {
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return [];
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let i = 0; i < 90 && cur <= end; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export type GoogleChannelRecord = {
  channel: "google";
  day: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_status: string | null;
  spend: number;
  currency: "ILS" | "USD";
  clicks: number;
  impressions: number;
  conversions: number;
  synced_at: string;
};

export type GoogleChannelBuild = {
  records: GoogleChannelRecord[];
  skippedCurrencies: string[];
  metricRows: number;
  zeroRows: number;
};

type Metric = {
  campaignId: string;
  name: string | null;
  status: string | null;
  currency: string;
  day: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

function text(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

function currencyOf(v: unknown): string {
  return String(v || "ILS");
}

function metricFromRow(r: any): Metric | null {
  const campaignId = String(r?.campaign?.id || "");
  const day = text(r?.segments?.date);
  if (!campaignId || !day || !DAY_RE.test(day)) return null;
  return {
    campaignId,
    name: text(r?.campaign?.name),
    status: text(r?.campaign?.status),
    currency: currencyOf(r?.customer?.currencyCode),
    day,
    spend: fromMicros(r?.metrics?.costMicros),
    clicks: Number(r?.metrics?.clicks || 0),
    impressions: Number(r?.metrics?.impressions || 0),
    conversions: Number(r?.metrics?.conversions || 0),
  };
}

function recordFrom(m: {
  campaignId: string;
  name: string | null;
  status: string | null;
  currency: string;
  day: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
}, syncedAt: string, skipped: Set<string>): GoogleChannelRecord | null {
  if (!ALLOWED_CURRENCY.has(m.currency)) {
    skipped.add(m.currency);
    return null;
  }
  return {
    channel: "google",
    day: m.day,
    campaign_id: m.campaignId,
    campaign_name: m.name,
    campaign_status: m.status,
    spend: m.spend,
    currency: m.currency as "ILS" | "USD",
    clicks: m.clicks,
    impressions: m.impressions,
    conversions: m.conversions,
    synced_at: syncedAt,
  };
}

// metrics גוברים על אפס. יום שלפני campaign.start_date_time לא מקבל אפס,
// אבל שורת הוצאה שגוגל כן החזירה נשמרת. קמפיין חסר מהרשימה (או REMOVED)
// לא ממולא, וההוצאה שלו נשמרת אם הגיעה בשאילתת הימים.
//
// משווים רק את היום. "2026-11-02" < "2026-11-02 00:00:00" ב-JS, ולכן
// השוואה למחרוזת המלאה מדלגת גם על יום ההתחלה.
function campaignStartDay(row: any): string | null {
  const raw = text(row?.campaign?.startDateTime);
  if (!raw || raw.length < 10) return null;
  const day = raw.slice(0, 10);
  const boundary = raw.length === 10 || raw[10] === " " || raw[10] === "T";
  return boundary && DAY_RE.test(day) ? day : null;
}

export function googleChannelRecordsFromGaql(input: {
  metricRows: any[];
  campaignRows: any[];
  from: string;
  to: string;
  syncedAt: string;
}): GoogleChannelBuild {
  const skipped = new Set<string>();
  const metrics = new Map<string, Metric>();
  let metricRows = 0;
  for (const row of input.metricRows || []) {
    const m = metricFromRow(row);
    if (!m) continue;
    metricRows++;
    metrics.set(`${m.campaignId}|${m.day}`, m);
  }

  const records: GoogleChannelRecord[] = [];
  const seen = new Set<string>();
  const push = (rec: GoogleChannelRecord | null) => {
    if (!rec) return;
    const key = `${rec.campaign_id}|${rec.day}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(rec);
  };

  for (const m of metrics.values()) push(recordFrom(m, input.syncedAt, skipped));

  const days = enumerateDays(input.from, input.to);
  for (const row of input.campaignRows || []) {
    const campaignId = String(row?.campaign?.id || "");
    const status = text(row?.campaign?.status);
    if (!campaignId || status === "REMOVED") continue;
    const start = campaignStartDay(row);
    const currency = currencyOf(row?.customer?.currencyCode);
    const name = text(row?.campaign?.name);
    for (const day of days) {
      if (start && day < start) continue;
      if (seen.has(`${campaignId}|${day}`)) continue;
      push(recordFrom({
        campaignId, name, status, currency, day,
        spend: 0, clicks: 0, impressions: 0, conversions: 0,
      }, input.syncedAt, skipped));
    }
  }

  records.sort((a, b) => a.day.localeCompare(b.day) || a.campaign_id.localeCompare(b.campaign_id));
  const zeroRows = records.filter((r) => !metrics.has(`${r.campaign_id}|${r.day}`)).length;
  return { records, skippedCurrencies: [...skipped].sort(), metricRows, zeroRows };
}

export type GoogleSyncLog = {
  action: "google_sync_insights";
  object_type: "account";
  object_id: null;
  request: { days: number | null; from?: string; to?: string };
  response: {
    rows: number;
    zero_rows: number;
    metric_rows: number;
    skipped_currencies: string[];
    code: string | null;
  };
  ok: boolean;
  error: string | null;
};

// היומן הוא דופק הסנכרון. בלי מזהה לקוח, בלי שאילתה ובלי טקסט ממודעה.
export function googleSyncLogEntry(input: {
  ok: boolean;
  days?: number | null;
  from?: string;
  to?: string;
  rows?: number;
  zeroRows?: number;
  metricRows?: number;
  skippedCurrencies?: string[];
  error?: string | null;
  code?: string | null;
}): GoogleSyncLog {
  const request: GoogleSyncLog["request"] = { days: input.days ?? null };
  if (input.from && DAY_RE.test(input.from)) request.from = input.from;
  if (input.to && DAY_RE.test(input.to)) request.to = input.to;
  const error = input.error ? String(input.error).slice(0, 300) : null;
  return {
    action: "google_sync_insights",
    object_type: "account",
    object_id: null,
    request,
    response: {
      rows: input.rows ?? 0,
      zero_rows: input.zeroRows ?? 0,
      metric_rows: input.metricRows ?? 0,
      skipped_currencies: input.skippedCurrencies ?? [],
      code: input.code ?? null,
    },
    ok: input.ok,
    error,
  };
}
