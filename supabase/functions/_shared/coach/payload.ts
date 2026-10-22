// ============================================================================
// _shared/coach/payload.ts — מה נשלח למודל ומה נשמר ממנו
//
// פונקציות טהורות, בלי Deno ובלי רשת, כדי שאפשר יהיה לבדוק אותן לבד
// (scripts/office_coach_test.ts): הצמצום לאגרגטים - שזה כל ההבטחה של
// המאמנים לגבי פרטיות - והניקוי של התשובה לפני שהיא נשמרת.
//
// שלושה מאמנים, חוזה פלט אחד (v2, ‏docs/coaches.md):
//   agent  - "מנטור סוכני נדל״ן AI", יומי, לסוכן/ת עצמו/ה
//   team   - "מנטור מנהלי צוותים AI", שבועי, למנהל/ת הצוות
//   office - "מנטור AI לבעלי משרדים", שבועי, למנהלי המשרד
//   platform - "מנטור AI למנהל הפלטפורמה", שבועי ועל חריגה (compactPlatform)
// ============================================================================
import { noLongDash } from "../marketing-copy.ts";

export type CoachKind = "agent" | "team" | "office";
/* ‏platform אינו CoachKind: אין לו "שאל את המנטור" (askCoach), ולכן הוא מופיע
   רק במה שנוגע לסיכום - הסכמה, הכפתורים והניקוי. */
export type SummaryKind = CoachKind | "platform";
export type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

// ---------------------------------------------------------------------------
// ‏CTA_KINDS: רשימה סגורה, ורק יכולות שקיימות ב-CRM (HANDOFF סעיף 6.3)
// ---------------------------------------------------------------------------
// ‏ref: איזה סוג מזהה אטום הכפתור צריך. "required" - בלי ref תקין אין כפתור;
// ‏"optional" - בלי ref הכפתור פותח את הקטגוריה. סוג חדש נכנס גם ל-COACH_CTA
// ב-assets/crm-coach.js (שם התווית והפעולה), וגם לרשימת הכלים בפרומפט.
type RefType = "lead" | "property" | "agreement" | "agenda" | "agent" | "inbox" | "market";
export const CTA_KINDS: Record<string, { kinds: SummaryKind[]; ref?: RefType; refRequired?: boolean }> = {
  open_lead: { kinds: ["agent"], ref: "lead", refRequired: true },
  open_leads_unanswered: { kinds: ["agent"] },
  open_property: { kinds: ["agent"], ref: "property", refRequired: true },
  open_agreement: { kinds: ["agent"], ref: "agreement", refRequired: true },
  new_agreement: { kinds: ["agent"] },
  open_agenda: { kinds: ["agent", "team", "office"], ref: "agenda" },
  new_agenda_item: { kinds: ["agent", "team", "office"] },
  promote_property: { kinds: ["agent"], ref: "property", refRequired: true },
  open_prefs: { kinds: ["agent"] },
  open_profile: { kinds: ["agent"] },
  open_matches: { kinds: ["agent"] },
  open_team_agent: { kinds: ["team", "office"], ref: "agent", refRequired: true },
  open_expiring: { kinds: ["office"] },
  // מנהל/ת הפלטפורמה (HANDOFF סעיף 9). ‏ref של inbox הוא סוג בתיבה, של market
  // ה-slug של השוק - שניהם אינם מזהים של אדם, ולכן יוצאים כמו שהם (Refs.own)
  open_inbox: { kinds: ["platform"], ref: "inbox" },
  open_market: { kinds: ["platform"], ref: "market", refRequired: true },
  new_campaign: { kinds: ["platform"], ref: "market" },
  open_health: { kinds: ["platform"] },
  open_content: { kinds: ["platform"] },
  open_costs: { kinds: ["platform"] },
};

export function ctaKindsFor(kind: SummaryKind): string[] {
  return Object.keys(CTA_KINDS).filter((k) => CTA_KINDS[k].kinds.includes(kind));
}

// ---------------------------------------------------------------------------
// מזהים אטומים: המודל לא רואה UUID. כל פריט שאפשר לפתוח מקבל אסימון קצר
// ("L1", "P2", "S3"), והמודל מחזיר ref רק מתוכם. cleanSummaryV2 ממירה את
// האסימון חזרה למזהה האמיתי, ומוחקת אסימון שלא נשלח.
// ---------------------------------------------------------------------------
const REF_PREFIX: Record<RefType, string> = {
  lead: "L", property: "P", agreement: "G", agenda: "A", agent: "S", inbox: "I", market: "M",
};
export type RefMap = Record<string, { type: RefType; id: string }>;

export class Refs {
  map: RefMap = {};
  private n: Record<string, number> = {};
  private seen = new Map<string, string>();
  add(type: RefType, id: unknown): string | null {
    if (typeof id !== "string" || !id) return null;
    const key = type + ":" + id;
    const had = this.seen.get(key);
    if (had) return had;
    this.n[type] = (this.n[type] ?? 0) + 1;
    const token = REF_PREFIX[type] + this.n[type];
    this.map[token] = { type, id };
    this.seen.set(key, token);
    return token;
  }
  /* ‏ref שהוא הערך עצמו - לסוג בתיבה ול-slug של שוק, שאין בהם מה להסתיר
     ושהמודל צריך לקרוא כדי לכתוב עליהם */
  own(type: RefType, id: unknown): string | null {
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(id)) return null;
    this.map[id] = { type, id };
    return id;
  }
}

// ---------------------------------------------------------------------------
// סכמת הפלט, לפי סוג המאמן. ‏agenda (סדר יום לישיבת צוות) - לצוות בלבד.
// אין minItems/maxItems: החיתוך לשלושה נעשה ב-cleanSummaryV2.
// ---------------------------------------------------------------------------
export function summarySchema(kind: SummaryKind) {
  const props: Row = {
    headline: { type: "string" },
    summary: { type: "string" },
    strength: { type: "string" },
    focus: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["high", "mid", "win"] },
          title: { type: "string" },
          why: { type: "string" },
          impact: { type: "string" },
          cta: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...ctaKindsFor(kind), "none"] },
              ref: { type: "string" },
            },
            required: ["kind", "ref"],
            additionalProperties: false,
          },
        },
        required: ["priority", "title", "why", "impact", "cta"],
        additionalProperties: false,
      },
    },
    questions: { type: "array", items: { type: "string" } },
  };
  const required = ["headline", "summary", "strength", "focus", "actions", "questions"];
  if (kind === "team") {
    props.agenda = { type: "array", items: { type: "string" } };
    required.push("agenda");
  }
  return { type: "object", properties: props, required, additionalProperties: false };
}

export type CoachAction = {
  priority: "high" | "mid" | "win";
  title: string;
  why: string;
  impact: string;
  cta: { kind: string; ref?: string } | null;
};
/* "כשאין ידע": השורה הראשונה "[נושא חסר: X]" (GAP_MARK ב-prompts.ts) יורדת
   מהתשובה, והנושא נשמר. סימון באמצע התשובה אינו נחשב - רק שורה ראשונה. */
export function splitGap(answer: string): { answer: string; gap: string | null } {
  const m = String(answer || "").match(/^\s*\[נושא חסר:\s*([^\]\n]{1,80})\]\s*\n?/);
  if (!m) return { answer, gap: null };
  const gap = m[1].replace(/\s+/g, " ").trim().slice(0, 80) || null;
  return { answer: answer.slice(m[0].length).trim(), gap };
}

/* ההתראה של הבוקר (coach_daily): הכותרת והצעדים, שורה אחת - בתבנית וואטסאפ
   Meta דוחה \n (סקיל agent-notifications, סעיף 5). רק טקסט שהמודל כתב ונוקה. */
export function coachNotification(s: CoachSummaryV2): { title: string; body: string } {
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  const title = ("המנטור: " + flat(s.headline || "הסיכום של היום")).slice(0, 140);
  const steps = (s.actions || []).map((a, i) => `${i + 1}. ${flat(a.title)}`);
  const body = (steps.length ? steps.join(" · ") : flat(s.focus || s.summary || "")).slice(0, 400);
  return { title, body };
}

export type CoachSummaryV2 = {
  v: 2;
  headline: string;
  summary: string;
  strength: string;
  focus: string;
  actions: CoachAction[];
  questions: string[];
  agenda?: string[];
};

const txt = (s: unknown, max: number) => noLongDash(String(s ?? "").trim().replace(/\s+/g, " ")).slice(0, max);

/* הניקוי לפני שמירה: מקף ארוך, אורכים, עד 3 צעדים, ‏cta.kind מהרשימה של
   המאמן הזה בלבד, ו-ref שהומר למזהה אמיתי. כפתור שלא עבר - הצעד נשאר בלי
   כפתור, לא נזרק. תשובה בלי כותרת או בלי צעד אחד תקין אינה נשמרת. */
export function cleanSummaryV2(raw: unknown, kind: SummaryKind, refs: RefMap = {}): CoachSummaryV2 | null {
  const r = raw as Row | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.actions)) return null;
  const allowed = new Set(ctaKindsFor(kind));
  const actions: CoachAction[] = (r.actions as Row[])
    .filter((a) => a && typeof a.title === "string")
    .map((a) => {
      const priority = (["high", "mid", "win"] as const).find((p) => p === a.priority) ?? "mid";
      return {
        priority,
        title: txt(a.title, 120),
        why: txt(a.why, 400),
        impact: txt(a.impact, 120),
        cta: ctaFitsTitle(String(a.title), cleanCta(a.cta, allowed, refs)),
      };
    })
    .filter((a) => a.title && a.why)
    .slice(0, 3);
  const headline = txt(r.headline, 160);
  if (!headline || !actions.length) return null;
  const out: CoachSummaryV2 = {
    v: 2,
    headline,
    summary: txt(r.summary, 400),
    strength: txt(r.strength, 80),
    focus: txt(r.focus, 80),
    actions,
    questions: (Array.isArray(r.questions) ? r.questions : []).map((q) => txt(q, 80)).filter(Boolean).slice(0, 3),
  };
  if (kind === "team") {
    out.agenda = (Array.isArray(r.agenda) ? r.agenda : []).map((q) => txt(q, 160)).filter(Boolean).slice(0, 6);
  }
  return out;
}

/* צעד של קידום מקבל רק את כפתור הקידום. בבוקר הראשון (19.10.2026) 22 מתוך 67
   צעדים היו "קדם/י נכס", ולאף אחד לא היה נכס עם אסימון - והמודל הצמיד להם
   "ההגדרות" או "לידים שלא נענו" (אצל מי שאין לו/ה לידים). כפתור שמוביל למקום
   אחר גרוע מצעד בלי כפתור. */
// בתחילת מילה בלבד: "התקדמות" ו"מקדמה" אינם קידום
const PROMOTE_TITLE = /(^|[\s"'(])[ולבה]?(קד[םמ]|קידום|הקפצ|הקפיץ)/;
function ctaFitsTitle(title: string, cta: CoachAction["cta"]): CoachAction["cta"] {
  if (cta && PROMOTE_TITLE.test(title) && cta.kind !== "promote_property" && cta.kind !== "open_property") return null;
  return cta;
}

function cleanCta(raw: unknown, allowed: Set<string>, refs: RefMap): CoachAction["cta"] {
  const c = raw as Row | null;
  if (!c || typeof c.kind !== "string" || !allowed.has(c.kind)) return null;
  const spec = CTA_KINDS[c.kind];
  const token = typeof c.ref === "string" ? c.ref.trim() : "";
  const hit = token ? refs[token] : undefined;
  const ok = hit && spec.ref && hit.type === spec.ref;
  if (spec.refRequired && !ok) return null;
  return ok ? { kind: c.kind, ref: hit!.id } : { kind: c.kind };
}

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
// צמצום הנתונים של משרד או צוות: אגרגטים ושמות סוכנים בלבד
// ---------------------------------------------------------------------------
/* ‏genders: agent_id → 'male' | 'female' מ-agency_members.gender. רק שני הערכים
   האלה יוצאים, ורק כ"סוכן" / "סוכנת", כדי שהמודל ינסח פועל וכינוי נכון. סוכן/ת
   בלי ערך לא מקבל/ת שדה, והמודל מנסח סביב השם. */
export type Genders = Record<string, string | null | undefined>;

const PERIOD_KEEP = [
  "leads", "leads_prev", "responded", "fast_15", "avg_response_min", "avg_response_min_prev",
  "recruited", "recruited_prev", "exclusives", "exclusives_prev", "agreements", "agreements_prev",
  "meetings", "deals", "deals_prev", "commission", "commission_prev", "commission_target",
  "open_unanswered", "active_listings", "calls_missed",
];

/* ‏refs: כשהמאמן יכול להציע "לשורת הסוכן/ת" (צוות, משרד), כל סוכן/ת מקבל/ת
   אסימון (S1...) - לא המזהה. */
export function compactPeriod(d: Row, genders: Genders = {}, refs?: Refs) {
  const agents = (d.agents as Row[] | undefined) ?? [];
  const buckets = (d.response_buckets as Row[] | undefined) ?? [];
  return {
    period: d.period,
    agents: agents.map((a) => {
      const g = genders[String(a.agent_id)];
      const role = a.role === "manager"
        ? (g === "male" ? "מנהל" : g === "female" ? "מנהלת" : "מנהל/ת")
        : (g === "male" ? "סוכן" : g === "female" ? "סוכנת" : "סוכן/ת");
      const out: Row = { agent: a.agent, role };
      if (refs) out.ref = refs.add("agent", a.agent_id);
      if (g === "male" || g === "female") out.gender = g;
      for (const k of PERIOD_KEEP) if (a[k] !== null && a[k] !== undefined) out[k] = a[k];
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

/* הצוותים של המשרד (‏teams מ-_office_dashboard_core, שלב 5): שם הצוות, שם
   מנהל/ת הצוות ומספרים. בלי מזהים. */
const TEAM_KEEP = [
  "agents", "commission", "deals", "leads", "recruited", "exclusives", "avg_response_min",
  "commission_target", "commission_in_target",
];
export function compactTeams(d: Row) {
  return ((d.teams as Row[] | undefined) ?? []).map((t) => {
    const out: Row = { team: t.name, lead: t.lead ?? null };
    for (const k of TEAM_KEEP) if (t[k] !== null && t[k] !== undefined) out[k] = t[k];
    return out;
  });
}

/* עמידה ביעד של קבוצת סוכנים, בדיוק כמו target_pct בדאשבורד: עמלות של מי
   שיש לו/ה יעד, חלקי סכום היעדים. בלי יעדים - null. */
export function targetPct(d: Row): number | null {
  const agents = ((d.agents as Row[] | undefined) ?? []).filter((a) => num(a.commission_target) > 0);
  const target = agents.reduce((s, a) => s + num(a.commission_target), 0);
  if (!target) return null;
  return Math.round((agents.reduce((s, a) => s + num(a.commission), 0) / target) * 100) / 100;
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

// ---------------------------------------------------------------------------
// מאמן הסוכן/ת: מ-_my_dashboard_core (אותם מספרים של "הדשבורד שלי")
// ---------------------------------------------------------------------------
const ME_KEEP = [
  "leads", "leads_prev", "responded", "responded_prev", "fast_15", "fast_15_prev",
  "avg_response_min", "avg_response_min_prev", "meetings", "meetings_prev",
  "recruited", "recruited_prev", "exclusives", "exclusives_prev", "agreements", "agreements_prev",
  "deals", "deals_prev", "commission", "commission_prev", "commission_target",
  "open_unanswered", "active_listings", "fast_streak_days", "calls_missed",
];
const AVG_KEEP = [
  "agents", "leads", "responded", "fast_15", "meetings", "agreements", "recruited", "exclusives",
  "deals", "commission", "avg_response_min",
];

function pick(src: Row | null | undefined, keys: string[]): Row {
  const out: Row = {};
  if (!src) return out;
  for (const k of keys) if (src[k] !== null && src[k] !== undefined) out[k] = src[k];
  return out;
}

const hoursSince = (iso: unknown, now: Date) =>
  typeof iso === "string" ? Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 3_600_000)) : null;
const daysUntil = (iso: unknown, now: Date) =>
  typeof iso === "string" ? Math.round((Date.parse(iso + "T00:00:00Z") - now.getTime()) / 86_400_000) : null;

/* מה שיוצא למודל על סוכן/ת אחד/ת. ‏office_avg רק כשהמסד החזיר אותו (שלושה
   סוכנים פעילים ומעלה). פריטי ה-todo יוצאים כאסימון, סוג ומספרים בלבד:
   **לא** שם פונה, כותרת נכס, עיר, כותרת משימה או טלפון. */
/* נכסים שקטים: פעילים 14 יום ומעלה, בלי ליד ב-14 הימים האחרונים ובלי קידום
   פעיל. אלה הנכסים היחידים שהמנטור יכול להציע לקדם (promote_property), כי רק
   להם יש אסימון. בלי הרשימה הוא המליץ "קדם/י נכס אחד מתוך ה-13" והצמיד כפתור
   שגוי. עד שלושה, הוותיקים קודם. יוצאים מספרים בלבד - לא כותרת ולא עיר.
   ‏rows: ‏{ id, created_at, promoted_until, leads_14d } מ-runAgentOne. */
const QUIET_DAYS = 14;
export function quietListings(rows: Row[], now = new Date()): Row[] {
  const day = 86_400_000;
  return rows
    .map((p) => ({
      id: p.id,
      days_listed: typeof p.created_at === "string" ? Math.floor((now.getTime() - Date.parse(p.created_at)) / day) : null,
      promoted: typeof p.promoted_until === "string" && Date.parse(p.promoted_until) > now.getTime(),
      leads: num(p.leads_14d),
    }))
    .filter((p) => typeof p.id === "string" && p.days_listed !== null && p.days_listed >= QUIET_DAYS && !p.promoted && p.leads === 0)
    .sort((a, b) => (b.days_listed as number) - (a.days_listed as number))
    .slice(0, 3);
}

export function compactAgent(
  week: Row, month: Row, gender: string | null | undefined, refs: Refs, now = new Date(), listings: Row[] = [],
) {
  const todo = (month.todo as Row | undefined) ?? {};
  const list = (k: string) => ((todo[k] as Row[] | undefined) ?? []);
  const out: Row = {
    last_7_days: { period: week.period, me: pick(week.me as Row, ME_KEEP) },
    last_30_days: {
      period: month.period,
      me: pick(month.me as Row, ME_KEEP),
      office_avg: month.office_avg ? pick(month.office_avg as Row, AVG_KEEP) : null,
    },
    todo: {
      leads_waiting: list("leads").map((l) => ({
        ref: refs.add("lead", l.ref_id), lead_type: l.lead_type ?? null, hours_waiting: hoursSince(l.created_at, now),
      })),
      exclusivity_ending: list("exclusivity").map((x) => ({
        ref: refs.add("property", x.ref_id), days_left: daysUntil(x.ends_on, now),
        days_on_market: x.days_on_market ?? null, showings: x.showings ?? null,
      })),
      agreements_unsigned: list("agreements").map((g) => ({
        ref: refs.add("agreement", g.ref_id), agreement_kind: g.agreement_kind ?? null,
        days_since_sent: hoursSince(g.sent_at, now) === null ? null : Math.floor(hoursSince(g.sent_at, now)! / 24),
        viewed: !!g.viewed,
      })),
      agenda_today: list("agenda").map((a) => ({
        ref: refs.add("agenda", a.ref_id), agenda_kind: a.agenda_kind ?? null,
        overdue: typeof a.due_at === "string" ? Date.parse(a.due_at) < now.getTime() : false,
      })),
      listings_quiet: quietListings(listings, now).map((p) => ({
        ref: refs.add("property", p.id), days_listed: p.days_listed, leads_14_days: 0,
      })),
    },
  };
  if (gender === "male" || gender === "female") out.gender = gender;
  return out;
}

/* טביעת האצבע של יום: המספרים והפריטים, בלי מה שמשתנה רק כי עבר זמן (שעות
   המתנה, ימים עד הפקיעה או מאז השליחה, "באיחור"). אם היא זהה לזו של אתמול, הסיכום של אתמול מועתק
   בלי קריאה למודל. */
export function agentFingerprintSource(p: Row): string {
  const todo = (p.todo as Record<string, Row[]> | undefined) ?? {};
  const stable = Object.fromEntries(
    Object.entries(todo).map(([k, items]) => [k, (items ?? []).map((i) => ({
      ...i, hours_waiting: undefined, days_left: undefined, days_since_sent: undefined, overdue: undefined,
      days_listed: undefined,
    }))]),
  );
  return JSON.stringify({ a: p.last_7_days, b: p.last_30_days, t: stable, g: p.gender ?? null });
}

/* הנקודות של הסיכום הקודם, כדי שהמאמן לא יחזור על עצמו. קורא גם v1. */
export function previousTitles(summary: unknown): string[] | null {
  const s = summary as Row | null;
  if (!s) return null;
  if (Array.isArray(s.actions)) return (s.actions as Row[]).map((a) => String(a.title ?? "")).filter(Boolean);
  if (Array.isArray(s.points)) return (s.points as Row[]).map((p) => String(p.title ?? "")).filter(Boolean);
  return null;
}

// ---------------------------------------------------------------------------
// "שאל את המאמן" (coach-ask)
// ---------------------------------------------------------------------------
/* הסיכום האחרון, כפי שהוא נשלח עם השאלה: טקסט בלבד. ‏cta.ref הוא מזהה
   אמיתי (UUID) אחרי cleanSummaryV2, ולכן הכפתורים לא יוצאים בכלל. קורא גם v1. */
export function summaryForAsk(summary: unknown): Row | null {
  const s = summary as Row | null;
  if (!s || typeof s !== "object") return null;
  if (Array.isArray(s.actions)) {
    return {
      headline: s.headline ?? null, summary: s.summary ?? null, strength: s.strength ?? null, focus: s.focus ?? null,
      actions: (s.actions as Row[]).map((a) => ({ title: a.title ?? null, why: a.why ?? null, impact: a.impact ?? null })),
      ...(Array.isArray(s.agenda) ? { agenda: s.agenda } : {}),
    };
  }
  if (Array.isArray(s.points)) {
    return { headline: s.headline ?? null, points: (s.points as Row[]).map((p) => ({ title: p.title ?? null, body: p.body ?? null })) };
  }
  return null;
}

/* השאלה: טקסט רגיל, עד 300 תווים */
export function cleanQuestion(raw: unknown): string {
  return String(raw ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/* התשובה לפני שהיא מוצגת ונשמרת: בלי מקף ארוך, בלי כותרות ו-** של Markdown,
   ועד 2,400 תווים - שאלה מקצועית מקבלת עד 250 מילים (askSystemPrompt). */
export function cleanAnswer(raw: unknown): string {
  const t = noLongDash(String(raw ?? ""))
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > 2400 ? t.slice(0, 2399).trimEnd() + "…" : t;
}

/* הוותק שהמנטור מקבל, כטווח בעברית: קודם מה שהסוכן/ת ענה/תה במנטור
   (coach_preferences.experience, פרטי), ואם לא ענה/תה - מ-years_experience
   שבפרופיל. בלי שניהם - null, והמנטור מסיק מהשאלה. */
export const EXPERIENCE_LABELS: Record<string, string> = {
  lt1: "פחות משנה",
  "1to5": "שנה עד 5 שנים",
  "5plus": "5 שנים ומעלה",
};

export function experienceLabel(band: unknown, years: unknown): string | null {
  if (typeof band === "string" && EXPERIENCE_LABELS[band]) return EXPERIENCE_LABELS[band];
  const y = years == null || years === "" ? NaN : Number(years);
  if (!Number.isFinite(y) || y < 0) return null;
  return y < 1 ? EXPERIENCE_LABELS.lt1 : y < 5 ? EXPERIENCE_LABELS["1to5"] : EXPERIENCE_LABELS["5plus"];
}

/* שיחת המשך: עד 3 השאלות והתשובות האחרונות של אותו/ה שואל/ת לאותו מנטור,
   מ-coach_questions, מהישנה לחדשה, כתורות user/assistant. שורה בלי תשובה
   (תשובה שלא נשמרה) לא נכנסת, כדי שהתורות יתחלפו. */
export function askHistory(rows: Row[] | null | undefined): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of (rows ?? []).filter((x) => x && x.question && x.answer).slice(0, 3).reverse()) {
    out.push({ role: "user", content: "השאלה: " + cleanQuestion(r.question) });
    out.push({ role: "assistant", content: String(r.answer) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// מנהל/ת הפלטפורמה: מ-platform_coach_input (שש הפונקציות של מרכז הפיקוד)
// ---------------------------------------------------------------------------
/* **רשימות סגורות, מספרים בלבד.** הקלט הגולמי מכיל שמות משרדים (stuck_license,
   ‏report.agencies) ושמות קמפיינים; שום דבר מהם לא יוצא. מה שיש לו שם הוא שוק
   (slug) וסוג בתיבה - שניהם שלנו ולא של אדם. ‏office_coach_test בודק. */
const PC_MONTH_KEEP = [
  "month", "agencies_new", "agents_new", "managers_new", "paid_agents_new", "leads_total",
  "properties_new", "deals_closed", "revenue_total", "topups",
];
const PC_MARKET_KEEP = [
  "agents_active", "agencies", "props_active", "props_new_7d", "props_new_30d", "leads_30d", "leads_prev_30d",
  "paying", "on_promo", "supply_per_agent", "demand_per_agent", "supply_tag", "demand_tag",
];
const PC_RESPONSE_KEEP = ["total", "measured", "within_12h", "median_hours"];
const PC_FUNNEL_KEEP = ["signed", "licensed", "first_property", "paying"];
const PC_BUDGET_KEEP = ["key", "spent", "budget", "pct", "approved"];
const PC_CHANNEL_KEEP = ["channel", "spend", "clicks", "leads"];

const perAgent = (n: unknown, agents: unknown) => (num(agents) ? Math.round((num(n) / num(agents)) * 100) / 100 : null);

/* ‏cities: slug → שמות הערים בשוק (market_city_names), כדי שהמודל יכתוב
   "עפולה" ולא "afula-emek". עד שלוש לשוק. */
export function compactPlatform(raw: Row, refs: Refs, cities: Record<string, string[]> = {}) {
  const cc = (raw.cc as Row | undefined) ?? {};
  const mk = (cc.marketplace as Row | undefined) ?? {};
  const health = (cc.health as Row | undefined) ?? {};
  const months = ((raw.report as Row | undefined)?.months as Row[] | undefined) ?? [];
  const growth = (raw.growth as Row | undefined) ?? {};
  const counts = (raw.counts as Row | undefined) ?? {};
  const budget = (raw.budget as Row | undefined) ?? {};
  const ads = (raw.ads as Row | undefined) ?? {};

  const markets = ((growth.markets as Row[] | undefined) ?? []);
  const active = markets.filter((m) => num(m.agencies) || num(m.agents) || num(m.props_active));
  const kinds = (counts.kinds as Record<string, Row> | undefined) ?? {};
  const funnel = (growth.funnel as Record<string, Row> | undefined) ?? {};
  const newsAt = typeof health.news_last_at === "string" ? Date.parse(health.news_last_at) : NaN;

  return {
    // הקודם והנוכחי (החודש הנוכחי חלקי)
    months: months.slice(-2).map((m) => pick(m, PC_MONTH_KEEP)),
    marketplace_30_days: {
      ...pick(mk, PC_MARKET_KEEP),
      leads_per_agent: perAgent(mk.leads_30d, mk.agents_active),
      response: pick(mk.response as Row | undefined, PC_RESPONSE_KEEP),
    },
    markets: active.map((m) => ({
      ref: refs.own("market", m.slug),
      cities: (cities[String(m.slug)] ?? []).slice(0, 3),
      agencies: num(m.agencies), agents: num(m.agents), props_active: num(m.props_active),
      props_new_30d: num(m.props_new_30d), leads_30d: num(m.leads_30d),
      leads_per_agent: perAgent(m.leads_30d, m.agents),
    })),
    markets_planned_empty: markets.length - active.length,
    recruitment: {
      last_30_days: pick(funnel["30d"], PC_FUNNEL_KEEP),
      all_time: pick(funnel.all, PC_FUNNEL_KEEP),
      license_stuck: ((growth.stuck_license as unknown[] | undefined) ?? []).length,
    },
    inbox: {
      total: num(counts.total),
      overdue: num(counts.overdue),
      kinds: Object.entries(kinds).filter(([, v]) => num(v?.total)).map(([k, v]) => ({
        ref: refs.own("inbox", k), total: num(v.total), overdue: num(v.overdue),
      })),
    },
    system: {
      findings_high: num(health.findings_high),
      findings_medium: num(health.findings_medium),
      cron_failed_24h: ((health.cron_failed_24h as unknown[] | undefined) ?? []).length,
      markets_errors: num(health.markets_errors),
      markets_data_hours: health.markets_oldest_hours ?? null,
      news_hours_since: Number.isFinite(newsAt) ? Math.round((Date.parse(String(raw.generated_at)) - newsAt) / 3_600_000) : null,
    },
    costs_this_month: ((budget.categories as Row[] | undefined) ?? []).map((c) => pick(c, PC_BUDGET_KEEP)),
    ads_this_month: {
      total: num(ads.total),
      channels: ((ads.channels as Row[] | undefined) ?? []).map((c) => pick(c, PC_CHANNEL_KEEP)),
    },
  };
}

/* החריגות: מה מצדיק עדכון באמצע השבוע. קוד יציב לכל אחת - הסוג או השם
   בתוכו - כדי שאותה חריגה לא תשלח עדכון כל בוקר (newTriggers). מחושבות
   מהקלט המצומצם, כך שאין כאן מה שלא יצא למודל. */
export function platformTriggers(p: ReturnType<typeof compactPlatform>): string[] {
  const out: string[] = [];
  for (const k of p.inbox.kinds) if (k.overdue && k.ref) out.push("inbox_overdue:" + k.ref);
  if (p.system.findings_high) out.push("findings_high");
  if (p.system.cron_failed_24h) out.push("cron_failed");
  if (p.system.markets_errors) out.push("markets_errors");
  for (const c of p.costs_this_month) {
    if (c.approved && num(c.pct) >= 100) out.push("budget_over:" + String(c.key));
  }
  const mk = p.marketplace_30_days as Row;
  if (num(mk.leads_prev_30d) >= 10 && num(mk.leads_30d) < num(mk.leads_prev_30d) * 0.7) out.push("leads_drop");
  return out.sort();
}

/* חריגה שלא הייתה בסיכום האחרון. חריגה שנמשכת אינה חדשה; כזו שנעלמה וחזרה
   אחרי סיכום שלא כלל אותה - חדשה. */
export function newTriggers(now: string[], prev: string[] | null | undefined): string[] {
  const had = new Set(prev ?? []);
  return now.filter((t) => !had.has(t));
}
