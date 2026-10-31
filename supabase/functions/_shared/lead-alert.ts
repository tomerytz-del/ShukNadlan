// ============================================================================
// נוסח התראת הוואטסאפ על ליד מטופס מטא, בלי רשת ובלי מסד.
//
// alertLead ב-meta-leads.ts קורא לכאן אחרי שתפס את השורה. מה שכאן נבדק
// ב-scripts/meta_lead_alert_test.ts: התוויות, הסינון, חלון 23 השעות,
// ודילוג על ליד ישן מ-6 שעות.
// ============================================================================

export const LEAD_ALERT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const LEAD_ALERT_WINDOW_MS = 23 * 60 * 60 * 1000;

/** ברירת המחדל של ads_settings.lead_alert_kinds כשהשורה חסרה. */
export const DEFAULT_ALERT_KINDS = ["broker", "owner", "property", "buyer", "unmapped"];

export const LEAD_KIND_LABELS: Record<string, string> = {
  broker: "מתווך/ת",
  owner: "בעל/ת נכס",
  property: "פנייה על נכס",
  buyer: "מחפש/ת",
  unmapped: "טופס לא משויך",
  ignore: "להתעלם",
};

// שדות השם, הטלפון והמייל כבר מוצגים בשורות משלהם. מפתח בעברית שאינו
// אחד מאלה נשאר ב"פרטים".
const CONTACT_KEYS = new Set([
  "full_name",
  "first_name",
  "last_name",
  "name",
  "phone_number",
  "phone",
  "email",
]);

export type LeadField = { name?: string | null; values?: string[] | null };

export type LeadAlertDecision =
  | { action: "skip"; reason: "expired" | "kind" }
  | { action: "text"; text: string; params: string[]; button?: { label: string; url: string } }
  | { action: "template"; text: string; params: string[]; button?: { label: string; url: string } };

export function phoneDigits(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  return String(raw).replace(/\D/g, "");
}

export function kindLabel(kind: string): string {
  return LEAD_KIND_LABELS[kind] || kind || LEAD_KIND_LABELS.unmapped;
}

/** null = השורה חסרה, ואז חלה ברירת המחדל. מערך (גם ריק) = הרשימה כפי שהיא. */
export function alertKindAllowed(kind: string, kinds: string[] | null): boolean {
  return (kinds ?? DEFAULT_ALERT_KINDS).includes(kind);
}

export function leadAlertExpired(createdTime: string | null | undefined, now = Date.now()): boolean {
  if (!createdTime) return true;
  const t = Date.parse(createdTime);
  if (!Number.isFinite(t)) return true;
  return now - t > LEAD_ALERT_MAX_AGE_MS;
}

/** חלון השירות של Meta: הודעה אחרונה מהמספר לפני פחות מ-23 שעות. */
export function inServiceWindow(lastMessageAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastMessageAt) return false;
  const t = Date.parse(lastMessageAt);
  if (!Number.isFinite(t)) return false;
  return now - t < LEAD_ALERT_WINDOW_MS;
}

function fieldText(fields: LeadField[] | null | undefined, name: string): string {
  const hit = (fields ?? []).find((f) => f?.name === name);
  return String(hit?.values?.[0] ?? "").trim();
}

export function leadContact(fields: LeadField[] | null | undefined): { name: string; phone: string; email: string } {
  const name = fieldText(fields, "full_name") ||
    [fieldText(fields, "first_name"), fieldText(fields, "last_name")].filter(Boolean).join(" ");
  return {
    name: name || "לא צוין",
    phone: fieldText(fields, "phone_number") || fieldText(fields, "phone") || "לא צוין",
    email: fieldText(fields, "email"),
  };
}

/** תשובות שאינן שם, טלפון או מייל. מפתח ריק או ערך ריק לא נכנסים. */
export function otherAnswers(fields: LeadField[] | null | undefined): string[] {
  const out: string[] = [];
  for (const f of fields ?? []) {
    const key = String(f?.name ?? "").trim();
    if (!key || CONTACT_KEYS.has(key.toLowerCase())) continue;
    const val = (f?.values ?? []).map((v) => String(v ?? "").trim()).filter(Boolean).join(", ");
    if (!val) continue;
    out.push(`${key}: ${val}`);
  }
  return out;
}

export function buildLeadAlert(input: {
  formName?: string | null;
  kind: string;
  fields?: LeadField[] | null;
}): { params: string[]; text: string; button: { label: string; url: string } } {
  const c = leadContact(input.fields);
  const label = kindLabel(input.kind);
  const formName = String(input.formName ?? "").trim() || "טופס לא משויך";
  const extras = otherAnswers(input.fields);
  const detailBits = [c.email ? `מייל: ${c.email}` : "", ...extras].filter(Boolean);
  const params = [formName, label, c.name, c.phone, detailBits.join("\n") || "-"];
  const lines = [
    "🔔 ליד חדש ממטא",
    `טופס: ${formName}`,
    `סוג: ${label}`,
    `שם: ${c.name}`,
    `טלפון: ${c.phone}`,
    ...(c.email ? [`מייל: ${c.email}`] : []),
    ...extras,
    "לפרטים ב-CRM.",
  ];
  return {
    params,
    text: lines.join("\n"),
    button: { label: "פתיחה ב-CRM", url: "https://shuknadlan.co.il/crm" },
  };
}

/**
 * אחרי שהשורה נתפסה: לדלג, טקסט חופשי, או תבנית.
 * הטלפון עצמו נבדק לפני התפיסה - כאן הוא כבר ידוע.
 */
export function decideLeadAlert(input: {
  createdTime: string | null | undefined;
  formName?: string | null;
  kind: string;
  kinds: string[] | null;
  fields?: LeadField[] | null;
  lastMessageAt?: string | null;
  now?: number;
}): LeadAlertDecision {
  const now = input.now ?? Date.now();
  if (leadAlertExpired(input.createdTime, now)) return { action: "skip", reason: "expired" };
  if (!alertKindAllowed(input.kind, input.kinds)) return { action: "skip", reason: "kind" };
  const built = buildLeadAlert({ formName: input.formName, kind: input.kind, fields: input.fields });
  if (inServiceWindow(input.lastMessageAt, now)) return { action: "text", ...built };
  return { action: "template", ...built };
}
