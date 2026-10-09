// ============================================================================
// office-coach/payload.ts — מה נשלח למודל ומה נשמר ממנו
//
// פונקציות טהורות, בלי Deno ובלי רשת, כדי שאפשר יהיה לבדוק אותן לבד
// (scripts/office_coach_test.ts): הצמצום לאגרגטים - שזה כל ההבטחה של
// המאמן לגבי פרטיות - והניקוי של התשובה לפני שהיא נשמרת.
// ============================================================================
import { noLongDash } from "../_shared/marketing-copy.ts";

export const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          owner: { type: "string" },
        },
        required: ["title", "body", "owner"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "points"],
  additionalProperties: false,
};

export type CoachPoint = { title: string; body: string; owner: string };
export type CoachSummary = { headline: string; points: CoachPoint[] };

// ---------------------------------------------------------------------------
// תאריכים: השבוע מתחיל ביום ראשון בשעון ישראל, כמו ב-office_coach_week_start
// ---------------------------------------------------------------------------
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// צמצום הנתונים: אגרגטים ושמות סוכנים בלבד
// ---------------------------------------------------------------------------
export type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function compactPeriod(d: Row) {
  const agents = (d.agents as Row[] | undefined) ?? [];
  const buckets = (d.response_buckets as Row[] | undefined) ?? [];
  const keep = [
    "leads", "leads_prev", "responded", "fast_15", "avg_response_min", "avg_response_min_prev",
    "recruited", "recruited_prev", "exclusives", "exclusives_prev", "agreements", "agreements_prev",
    "meetings", "deals", "deals_prev", "commission", "commission_prev", "commission_target",
    "open_unanswered", "active_listings", "calls_missed",
  ];
  return {
    period: d.period,
    agents: agents.map((a) => {
      const out: Row = { agent: a.agent, role: a.role === "manager" ? "מנהל/ת" : "סוכן/ת" };
      for (const k of keep) if (a[k] !== null && a[k] !== undefined) out[k] = a[k];
      const mine = buckets.filter((b) => b.agent_id === a.agent_id);
      if (mine.length) {
        out.response_buckets = Object.fromEntries(mine.map((b) => [String(b.bucket_order), num(b.leads)]));
      }
      return out;
    }),
    lead_sources: d.lead_sources,
    // בלעדיות שפוקעות: בלי כותרות נכסים - מספיק כמה, מתי, ומה מצב ההצגות
    expiring: ((d.expiring as Row[] | undefined) ?? []).map((x) => ({
      agent: agents.find((a) => a.agent_id === x.agent_id)?.agent ?? null,
      exclusivity_end: x.exclusivity_end,
      days_on_market: x.days_on_market,
      showings: x.showings,
      asking_price: x.asking_price,
    })),
  };
}

export function monthlyTotals(d: Row) {
  const map = new Map<string, Row>();
  for (const r of ((d.monthly as Row[] | undefined) ?? [])) {
    const m = String(r.month);
    const t = map.get(m) ?? { month: m, leads: 0, recruited: 0, exclusives: 0, agreements: 0, deals: 0, commission: 0 };
    for (const k of ["leads", "recruited", "exclusives", "agreements", "deals", "commission"]) t[k] = num(t[k]) + num(r[k]);
    map.set(m, t);
  }
  return [...map.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

export function cleanSummary(raw: unknown): CoachSummary | null {
  const r = raw as Partial<CoachSummary> | null;
  if (!r || typeof r.headline !== "string" || !Array.isArray(r.points)) return null;
  const txt = (s: unknown, max: number) => noLongDash(String(s ?? "").trim()).slice(0, max);
  const points = r.points
    .filter((p) => p && typeof p.title === "string" && typeof p.body === "string")
    .slice(0, 3)
    .map((p) => ({ title: txt(p.title, 120), body: txt(p.body, 600), owner: txt(p.owner, 60) }))
    .filter((p) => p.title && p.body);
  const headline = txt(r.headline, 160);
  if (!headline || !points.length) return null;
  return { headline, points };
}

