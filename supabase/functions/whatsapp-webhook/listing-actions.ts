// פעולות הרסניות מוואטסאפ: מחיקת תמונה, ביטול הסכם, והנפקה מחדש.
// הכפתור נושא את המזהה. הכותרת לבדה אינה מספיקה. אין מחיקה בלי אישור.
// הנפקה שומרת את התיקונים בבקשה, והכפתור נושא מזהה קצר שלה. מחיקה נושאת
// טביעה של כתובות התמונות, כדי ששינוי סדר לא ימחק תמונה אחרת.

export const IMAGE_DELETE_YES = "כן, למחוק";
export const IMAGE_DELETE_NO = "לא למחוק";
export const AGREEMENT_CANCEL_YES = "כן, לבטל";
export const AGREEMENT_CANCEL_NO = "להשאיר";
export const AGREEMENT_REISSUE_YES = "כן, הסכם חדש";
export const AGREEMENT_REISSUE_NO = "לא עכשיו";

export const IMAGE_DELETE_STALE =
  "התמונות השתנו בינתיים ולא מחקתי. אפשר לבקש שוב.";
export const REISSUE_DONE =
  "כבר הוצא הסכם חדש לבקשה הזו, ולא מוציאים עוד אחד.";
export const REISSUE_EXPIRED =
  "הבקשה פגה. אפשר לבקש הסכם חדש שוב.";
export const REISSUE_MISSING =
  "הבקשה לא נמצאה. אפשר לבקש הסכם חדש שוב.";
export const REISSUE_BUSY =
  "הבקשה כבר בטיפול. אם לא יצא הסכם חדש, אפשר לבקש שוב.";
export const REISSUE_OLD_CANCELLED =
  "ההסכם הישן כבר בוטל בהנפקה הזו. לא מוציאים עוד אחד.";
export const REISSUE_STORE_MISSING =
  "אי אפשר לאשר הנפקה כרגע. אפשר לנסות שוב אחרי עדכון המערכת.";

/** כפתור הנפקה שקט אחרי שש שעות. וואטסאפ משאיר אותו לחיץ, והבקשה לא. */
export const REISSUE_BUTTON_TTL_MS = 6 * 60 * 60 * 1000;

export const REISSUE_OVERRIDE_KEYS = [
  "commission_pct", "commission_amount", "commission_basis",
  "exclusive_from", "exclusive_until", "notes", "client_email", "in_person_only",
] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMAGE_RE = new RegExp(
  `^imgd:(y|n):(${UUID})(?::([0-9.]+)(?::([0-9a-f]{8}))?)?$`,
  "i",
);
const AGREEMENT_RE = new RegExp(`^ag(cx|rx):(y|n):([0-9a-f]{12}|${UUID})$`, "i");

export interface OwnedRow {
  agent_id: string;
  agency_id?: string | null;
}

/** הסוכן/ת הוא/היא בעל/ת השורה, והמשרד לא השתנה מתחתיה. */
export function ownsRow(
  agent: { id: string; agency_id?: string | null },
  row: OwnedRow | null | undefined,
): boolean {
  if (!row || row.agent_id !== agent.id) return false;
  if (agent.agency_id && row.agency_id && agent.agency_id !== row.agency_id) return false;
  return true;
}

export function imagesAfterRemove(
  images: readonly string[],
  positions: readonly number[],
): { ok: true; next: string[]; removed: number } | { ok: false; error: string } {
  const n = images.length;
  if (!n) return { ok: false, error: "אין לנכס תמונות." };
  const drop = new Set<number>();
  for (const raw of positions) {
    const p = Number(raw);
    if (!Number.isInteger(p) || p < 1 || p > n) {
      return { ok: false, error: `יש לנכס ${n} תמונות. צריך מספר בין 1 ל-${n}.` };
    }
    drop.add(p);
  }
  if (!drop.size) return { ok: false, error: `צריך את מספרי התמונות למחיקה, בין 1 ל-${n}.` };
  const next = images.filter((_, i) => !drop.has(i + 1));
  return { ok: true, next, removed: n - next.length };
}

/** טביעה קצרה של כתובות התמונות שנבחרו. שינוי סדר משנה אותה. */
export function imageUrlsHash(urls: readonly string[]): string {
  let h = 0x811c9dc5;
  const s = urls.join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function imageDeleteMatches(
  images: readonly string[],
  positions: readonly number[],
  hash: string | null | undefined,
): boolean {
  if (!hash) return false;
  const urls: string[] = [];
  for (const p of positions) {
    if (!Number.isInteger(p) || p < 1 || p > images.length) return false;
    urls.push(images[p - 1]);
  }
  return imageUrlsHash(urls) === hash.toLowerCase();
}

export function imageDeleteButtons(
  propertyId: string,
  positions: readonly number[],
  images: readonly string[],
): { id: string; title: string }[] | null {
  const pos = [...new Set(positions.map(Number))]
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 99)
    .sort((a, b) => a - b)
    .slice(0, 12);
  if (!pos.length || !propertyId) return null;
  const urls: string[] = [];
  for (const p of pos) {
    if (p > images.length || !images[p - 1]) return null;
    urls.push(images[p - 1]);
  }
  const yes = `imgd:y:${propertyId}:${pos.join(".")}:${imageUrlsHash(urls)}`;
  const no = `imgd:n:${propertyId}`;
  if (yes.length > 200 || utf16len(IMAGE_DELETE_YES) > 20 || utf16len(IMAGE_DELETE_NO) > 20) return null;
  return [
    { id: yes, title: IMAGE_DELETE_YES },
    { id: no, title: IMAGE_DELETE_NO },
  ];
}

export function parseImageDeleteButton(buttonId: string): {
  yes: boolean;
  propertyId: string;
  positions: number[];
  hash: string | null;
} | null {
  const m = IMAGE_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const positions = m[3]
    ? m[3].split(".").map(Number).filter((n) => Number.isInteger(n) && n >= 1)
    : [];
  if (m[1].toLowerCase() === "y" && !positions.length) return null;
  return {
    yes: m[1].toLowerCase() === "y",
    propertyId: m[2],
    positions,
    hash: m[4] ? m[4].toLowerCase() : null,
  };
}

export function agreementConfirmButtons(
  action: "cancel" | "reissue",
  agreementId: string,
): { id: string; title: string }[] | null {
  if (!agreementId) return null;
  const prefix = action === "cancel" ? "agcx" : "agrx";
  const yesTitle = action === "cancel" ? AGREEMENT_CANCEL_YES : AGREEMENT_REISSUE_YES;
  const noTitle = action === "cancel" ? AGREEMENT_CANCEL_NO : AGREEMENT_REISSUE_NO;
  if (utf16len(yesTitle) > 20 || utf16len(noTitle) > 20) return null;
  const yes = `${prefix}:y:${agreementId}`;
  if (yes.length > 200) return null;
  return [
    { id: yes, title: yesTitle },
    { id: `${prefix}:n:${agreementId}`, title: noTitle },
  ];
}

export function parseAgreementButton(buttonId: string): {
  action: "cancel" | "reissue";
  yes: boolean;
  agreementId: string;
} | null {
  const m = AGREEMENT_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  return {
    action: m[1].toLowerCase() === "cx" ? "cancel" : "reissue",
    yes: m[2].toLowerCase() === "y",
    agreementId: m[3],
  };
}

export function newPendingActionId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function reissueOverridePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REISSUE_OVERRIDE_KEYS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

export interface PendingActionRow {
  id: string;
  agent_id?: string;
  action?: string;
  subject_id: string;
  payload?: Record<string, unknown> | null;
  expires_at: string;
  claimed_at?: string | null;
  executed_at?: string | null;
  new_subject_id?: string | null;
  result?: string | null;
}

export type ReissueDecision =
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "busy" }
  | { kind: "done"; text: string }
  | { kind: "superseded" }
  | { kind: "run"; agreementId: string; overrides: Record<string, unknown> };

/**
 * לחיצה על כפתור הנפקה. done / superseded לא יוצרים הסכם נוסף.
 * oldStatus=cancelled כשהבקשה כבר תפסה את ההסכם הישן ומחקה אותו.
 */
export function reissueClickDecision(
  row: PendingActionRow | null | undefined,
  nowMs: number,
  oldStatus?: string | null,
): ReissueDecision {
  if (!row || !row.subject_id || (row.action && row.action !== "reissue")) return { kind: "missing" };
  if (row.executed_at || row.new_subject_id) {
    return { kind: "done", text: String(row.result || "").trim() || REISSUE_DONE };
  }
  const exp = Date.parse(String(row.expires_at || ""));
  if (!Number.isFinite(exp) || exp <= nowMs) return { kind: "expired" };
  if (row.claimed_at) {
    if (oldStatus === "cancelled") return { kind: "superseded" };
    return { kind: "busy" };
  }
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return { kind: "run", agreementId: row.subject_id, overrides: payload };
}

export const PUBLISH_YES = "כן, לפרסם";
export const PUBLISH_NO = "לא עכשיו";
export const PUBLISH_DONE = "הנכס כבר פורסם, ולא מפרסמים שוב.";
export const PUBLISH_EXPIRED = "הבקשה לפרסם פגה. אפשר לבקש שוב.";
export const PUBLISH_MISSING = "הבקשה לפרסם לא נמצאה. אפשר לבקש שוב.";
export const PUBLISH_BUSY = "הפרסום כבר בטיפול. אם הנכס לא עלה, אפשר לבקש שוב.";
export const PUBLISH_STORE_MISSING =
  "אי אפשר לאשר פרסום כרגע. אפשר לנסות שוב אחרי עדכון המערכת.";
export const PUBLISH_FAILED = "לא הצלחתי לפרסם את הנכס. אפשר לנסות שוב.";
export const PUBLISH_ALREADY = "הנכס כבר באוויר.";

const PUBLISH_RE = /^pubx:(y|n):([0-9a-f]{12})$/i;

export function publishConfirmButtons(requestId: string): { id: string; title: string }[] | null {
  if (!/^[0-9a-f]{12}$/i.test(requestId)) return null;
  if (utf16len(PUBLISH_YES) > 20 || utf16len(PUBLISH_NO) > 20) return null;
  const yes = `pubx:y:${requestId.toLowerCase()}`;
  if (yes.length > 200) return null;
  return [
    { id: yes, title: PUBLISH_YES },
    { id: `pubx:n:${requestId.toLowerCase()}`, title: PUBLISH_NO },
  ];
}

export function parsePublishButton(buttonId: string): { yes: boolean; requestId: string } | null {
  const m = PUBLISH_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  return { yes: m[1].toLowerCase() === "y", requestId: m[2].toLowerCase() };
}

export type PublishDecision =
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "busy" }
  | { kind: "done"; text: string }
  | { kind: "run"; propertyId: string };

/** לחיצה שנייה על כפתור שכבר פורסם לא מפרסמת שוב. */
export function publishClickDecision(
  row: PendingActionRow | null | undefined,
  nowMs: number,
): PublishDecision {
  if (!row || row.action !== "publish" || !row.subject_id) return { kind: "missing" };
  if (row.executed_at) {
    return { kind: "done", text: String(row.result || "").trim() || PUBLISH_DONE };
  }
  const exp = Date.parse(String(row.expires_at || ""));
  if (!Number.isFinite(exp) || exp <= nowMs) return { kind: "expired" };
  if (row.claimed_at) return { kind: "busy" };
  return { kind: "run", propertyId: row.subject_id };
}

export function publishDecisionText(decision: PublishDecision): string | null {
  switch (decision.kind) {
    case "run":
      return null;
    case "done":
      return decision.text;
    case "expired":
      return PUBLISH_EXPIRED;
    case "busy":
      return PUBLISH_BUSY;
    default:
      return PUBLISH_MISSING;
  }
}

/** 23514: ה-check עדיין מתיר רק reissue. לא לפרסם בלי שהבקשה נשמרה. */
export function publishStoreBlocked(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (String(error.code || "") === "23514") return true;
  return pendingStoreMissing(error);
}

/** הודעת בלעדיות בעברית עוברת. אנגלית גולמית לא. */
export function publishErrorText(message: string | null | undefined): string {
  const msg = String(message || "").replace(/[—–]/g, "-").trim();
  if (/[א-ת]/.test(msg)) return msg;
  return PUBLISH_FAILED;
}

export function reissueDecisionText(decision: ReissueDecision): string | null {
  switch (decision.kind) {
    case "run":
      return null;
    case "done":
      return decision.text;
    case "expired":
      return REISSUE_EXPIRED;
    case "busy":
      return REISSUE_BUSY;
    case "superseded":
      return REISSUE_OLD_CANCELLED;
    default:
      return REISSUE_MISSING;
  }
}

/**
 * הטבלה עוד לא עלתה: הפונקציה נפרסת לפני המיגרציה.
 * רק "היחס לא קיים" (42P01) ו"הטבלה לא בסכמה" (PGRST205).
 * PGRST204 הוא עמודה חסרה, והודעה חופשית אינה הוכחה.
 */
export function pendingStoreMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "42P01" || code === "PGRST205";
}

/**
 * עם תור וואטסאפ אין כתיבה מהמודל, גם אם confirm=true.
 * confirm כותב רק בלי outbox (מייל), אחרי אישור מפורש.
 */
export function confirmWritesNow(hasOutbox: boolean, confirm: unknown): boolean {
  return !hasOutbox && confirm === true;
}

/** טיוטה שטרם נחתמה מבוטלת מיד. בלעדיות חתומה ממתינה לחתימה על החדש. */
export function reissueOldAgreementPlan(status: string, kind: string): "cancel" | "supersede" | "keep" {
  if (status === "draft" || status === "sent" || status === "viewed") return "cancel";
  if (status === "signed" && String(kind || "").startsWith("exclusive_")) return "supersede";
  return "keep";
}

export function reissueBlockedKind(kind: string): string | null {
  if (String(kind || "").startsWith("marketing_")) {
    return "את טופס ההסכמה לשיווק לא מנפיקים לבד. מנפיקים מחדש את הבלעדיות, וההסכמה נוצרת איתו.";
  }
  return null;
}

const BASES = new Set(["price", "monthly", "yearly", "flat"]);

export interface ReissueSource {
  kind: string;
  client_ids?: string[] | null;
  property_ids?: string[] | null;
  commission_pct?: number | null;
  commission_amount?: number | null;
  commission_note?: string | null;
  exclusive_from?: string | null;
  exclusive_until?: string | null;
  notes?: string | null;
}

export interface ReissueSigner {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  ord?: number | null;
  client_id?: string | null;
}

/** שדות ל-prepare_agreement. הערכים שהסוכן/ת תיקן/ה גוברים על מה שנשמר. */
export function reissuePrepareInput(
  row: ReissueSource,
  signers: readonly ReissueSigner[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> | { error: string } {
  const blocked = reissueBlockedKind(row.kind);
  if (blocked) return { error: blocked };
  const clientIds = (row.client_ids || []).map((id) => String(id || "")).filter(Boolean);
  const clientId = String(
    overrides.client_id || clientIds[0] || signers.find((s) => Number(s.ord) === 0 && s.client_id)?.client_id ||
      signers.find((s) => s.client_id)?.client_id || "",
  );
  if (!clientId) return { error: "אין לקוח/ה על ההסכם, אי אפשר להוציא חדש." };
  const propertyIds = Array.isArray(overrides.property_ids) && overrides.property_ids.length
    ? overrides.property_ids
    : (row.property_ids || []);
  if (!propertyIds.length) return { error: "אין נכס על ההסכם, אי אפשר להוציא חדש." };
  const extras = signers
    .filter((s) => Number(s.ord) > 0 && String(s.full_name || "").trim())
    .map((s, i) => {
      const linked = String(s.client_id || clientIds[i + 1] || "").trim();
      return {
        full_name: String(s.full_name).trim(),
        phone: s.phone || undefined,
        email: s.email || undefined,
        ...(linked ? { client_id: linked } : {}),
      };
    });
  const used = new Set<string>([clientId]);
  for (const extra of extras) {
    if (extra.client_id) used.add(extra.client_id);
  }
  const also = clientIds.filter((id) => !used.has(id));
  const basis = BASES.has(String(row.commission_note || "")) ? String(row.commission_note) : undefined;
  return {
    kind: row.kind,
    client_id: clientId,
    property_ids: propertyIds,
    commission_pct: overrides.commission_pct ?? row.commission_pct ?? undefined,
    commission_amount: overrides.commission_amount ?? row.commission_amount ?? undefined,
    commission_basis: overrides.commission_basis ?? basis,
    exclusive_from: overrides.exclusive_from ?? row.exclusive_from ?? undefined,
    exclusive_until: overrides.exclusive_until ?? row.exclusive_until ?? undefined,
    notes: overrides.notes ?? row.notes ?? undefined,
    client_email: overrides.client_email || undefined,
    in_person_only: overrides.in_person_only === true ? true : undefined,
    extra_signers: extras.length ? extras : undefined,
    also_client_ids: also.length ? also : undefined,
    force_new: true,
  };
}

function utf16len(s: string): number {
  return [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
}
