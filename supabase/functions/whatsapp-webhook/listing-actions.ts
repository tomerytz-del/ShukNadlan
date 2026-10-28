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

export const PUBLISH_YES = "לפרסם";
export const PUBLISH_NO = "לא עכשיו";
export const PUBLISH_EDIT = "לערוך";
export const PUBLISH_DONE = "הנכס כבר פורסם, ולא מפרסמים שוב.";
export const PUBLISH_EXPIRED = "הבקשה לפרסם פגה. אפשר לבקש שוב.";
export const PUBLISH_MISSING = "הבקשה לפרסם לא נמצאה. אפשר לבקש שוב.";
export const PUBLISH_BUSY = "הפרסום כבר בטיפול. אם הנכס לא עלה, אפשר לבקש שוב.";
export const PUBLISH_STORE_MISSING =
  "אי אפשר לאשר את הפרסום מכאן כרגע. אפשר לפרסם את הנכס מאזור האישי באתר.";
export const PUBLISH_FAILED = "לא הצלחתי לפרסם את הנכס. אפשר לנסות שוב.";
export const PUBLISH_ALREADY = "הנכס כבר באוויר.";
export const PUBLISH_EXCLUSIVE_ELSEWHERE =
  "הנכס נמצא בבלעדיות של משרד אחר, ולכן אי אפשר לפרסם אותו.";
export const PUBLISH_DUPLICATE_ELSEWHERE =
  "הנכס כבר מפורסם במערכת. אפשר לפרסם אותו רק עם הסכם בלעדיות חתום.";
export const PUBLISH_DUPLICATE_SAME =
  "הנכס כבר מפורסם במשרד שלכם. אין צורך במודעה שנייה.";

const PUBLISH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// uuid אופציונלי: כפתור ישן בלי מזהה נכס עדיין נפתר מהשורה השמורה.
const PUBLISH_RE = /^pubx:(y|n|e):([0-9a-f]{12})(?::([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i;

export function publishConfirmButtons(
  requestId: string,
  propertyId?: string | null,
): { id: string; title: string }[] | null {
  if (!/^[0-9a-f]{12}$/i.test(requestId)) return null;
  if (utf16len(PUBLISH_YES) > 20 || utf16len(PUBLISH_NO) > 20 || utf16len(PUBLISH_EDIT) > 20) return null;
  const prop = propertyId && PUBLISH_UUID_RE.test(propertyId) ? `:${propertyId.toLowerCase()}` : "";
  const yes = `pubx:y:${requestId.toLowerCase()}${prop}`;
  if (yes.length > 200) return null;
  const id = requestId.toLowerCase();
  return [
    { id: yes, title: PUBLISH_YES },
    { id: `pubx:n:${id}${prop}`, title: PUBLISH_NO },
    { id: `pubx:e:${id}${prop}`, title: PUBLISH_EDIT },
  ];
}

export const UNPUB_PUBLISH = "לפרסם";
export const UNPUB_SHARE = "שת״פ";
export const UNPUB_LATER = "לא עכשיו";

const UNPUB_RE = new RegExp(`^unpub:(p|s|n|m):(${UUID})$`, "i");

/** שלושה כפתורים על תזכורת של נכס אחד. בלי תזכורת (m) נשאר ב-CRM. */
export function unpublishedNudgeButtons(
  propertyId: string,
): { id: string; title: string }[] | null {
  if (!PUBLISH_UUID_RE.test(propertyId)) return null;
  if (utf16len(UNPUB_PUBLISH) > 20 || utf16len(UNPUB_SHARE) > 20 || utf16len(UNPUB_LATER) > 20) {
    return null;
  }
  const id = propertyId.toLowerCase();
  const buttons = [
    { id: `unpub:p:${id}`, title: UNPUB_PUBLISH },
    { id: `unpub:s:${id}`, title: UNPUB_SHARE },
    { id: `unpub:n:${id}`, title: UNPUB_LATER },
  ];
  if (buttons.some((b) => b.id.length > 200)) return null;
  return buttons;
}

/** לפרסם מהכפתור רק טיוטה. unpublished הוא הטיוטה במסד. sold ו-archived לא. */
export function unpublishedNudgeCanPublish(status: string | null | undefined): boolean {
  return status === "unpublished" || status === "draft";
}

/** הכפתור בוואטסאפ נשאר לחיץ. בלי תזכורת מהשבוע האחרון לא מפרסמים ממנו. */
export const UNPUB_BUTTON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function unpublishedNudgeButtonFresh(
  createdAt: string | null | undefined,
  nowMs: number,
): boolean {
  const t = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(t)) return false;
  if (t > nowMs + 5 * 60 * 1000) return false;
  return nowMs - t <= UNPUB_BUTTON_TTL_MS;
}

export function parseUnpublishedNudgeButton(
  buttonId: string,
): { action: "publish" | "share" | "snooze" | "mute"; propertyId: string } | null {
  const m = UNPUB_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const letter = m[1].toLowerCase();
  return {
    action: letter === "p" ? "publish" : letter === "s" ? "share" : letter === "m" ? "mute" : "snooze",
    propertyId: m[2].toLowerCase(),
  };
}

export function parsePublishButton(
  buttonId: string,
): { action: "yes" | "no" | "edit"; requestId: string; propertyId: string | null } | null {
  const m = PUBLISH_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const letter = m[1].toLowerCase();
  return {
    action: letter === "y" ? "yes" : letter === "e" ? "edit" : "no",
    requestId: m[2].toLowerCase(),
    propertyId: m[3] ? m[3].toLowerCase() : null,
  };
}

export type PublishDecision =
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "busy" }
  | { kind: "done"; text: string }
  | { kind: "run"; propertyId: string };

/**
 * בוואטסאפ יש outbox, ולכן confirm לא מפרסם. בלי כפתורים (מייל) confirm=true
 * הוא האישור, כי אין לאן לשלוח pubx:.
 */
export function publishWritesNow(hasOutbox: boolean, confirm: unknown): boolean {
  return !hasOutbox && confirm === true;
}

/** 1 שואל לפני פרסום. 0, שורה חסרה או קריאה שנכשלה: פרסום מיידי, כמו קודם. */
export function publishAskFirst(value: unknown, readFailed = false): boolean {
  if (readFailed) return false;
  if (value == null || value === "") return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return n !== 0;
}

/** טיוטה עד לכפתור. unpublished הוא מה שהאתר, החיפוש וההתראות לא מציגים. */
export function listingStatusForCreate(askFirst: boolean): "unpublished" | "active" {
  return askFirst ? "unpublished" : "active";
}

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

/**
 * הודעת המסד לא יוצאת לסוכן/ת. בלעדיות ומודעה כפולה של משרד אחר מגיעות עם
 * שם אדם ושם משרד, וזה לא של הסוכן/ת. כאן נשאר משפט בלי פרטים. null = לא
 * הודעה מוכרת. את הטקסט הגולמי רושמים בשרת לפני הקריאה.
 */
export function redactPublishError(message: string | null | undefined): string | null {
  const msg = String(message || "").replace(/[—–]/g, "-").trim();
  if (msg.includes("הנכס נמצא בבלעדיות של")) return PUBLISH_EXCLUSIVE_ELSEWHERE;
  if (msg.includes("הנכס כבר מפורסם במערכת")) return PUBLISH_DUPLICATE_ELSEWHERE;
  if (msg.includes("הנכס כבר מפורסם במשרד שלכם")) {
    const num = msg.match(/#(\d+)/);
    return num
      ? `הנכס כבר מפורסם במשרד שלכם (מודעה #${num[1]}). אין צורך במודעה שנייה.`
      : PUBLISH_DUPLICATE_SAME;
  }
  return null;
}

/** הודעה מוכרת בלי שמות, וכל השאר משפט כללי. */
export function publishErrorText(message: string | null | undefined): string {
  return redactPublishError(message) ?? PUBLISH_FAILED;
}

/** הפונקציה עוד לא עלתה: יצירת הטיוטה ממשיכה בלי האזהרה. */
export function draftElsewhereMissing(error: { code?: string } | null | undefined): boolean {
  const code = String(error?.code || "");
  return code === "42883" || code === "PGRST202";
}

/**
 * אזהרה בזמן טיוטה, בלי שם של מתווך/ת ומשרד אחר. clear ו-unknown אינם אזהרה.
 * החסימה עצמה נשארת בטריגר, במעבר ל-active.
 */
export function elsewhereDraftWarning(state: string | null | undefined): string | null {
  if (state === "exclusive_elsewhere") {
    return `${PUBLISH_EXCLUSIVE_ELSEWHERE} הטיוטה נשמרה, והפרסום ייעצר עד הסכם בלעדיות חתום.`;
  }
  if (state === "duplicate_elsewhere") {
    return `${PUBLISH_DUPLICATE_ELSEWHERE} הטיוטה נשמרה.`;
  }
  if (state === "duplicate_same_agency") {
    return `${PUBLISH_DUPLICATE_SAME} הטיוטה נשמרה.`;
  }
  return null;
}

/**
 * כפתור שפג (שש שעות), "לא עכשיו" ו"לערוך" לא מוחקים את הטיוטה ולא מפרסמים.
 * התזכורת השבועית בוחרת unpublished לפי unpublished_at, לא לפי כפתור פתוח.
 */
export function unpublishedAfterUnconfirmedPublish(_kind: "expired" | "no" | "edit"): "unpublished" {
  return "unpublished";
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

export type PublishChannel = "site" | "social" | "brokers" | "save";

export interface PublishDestination {
  code: string;
  title: string;
  description: string;
  channels: PublishChannel[];
  edit: boolean;
}

/** רשימה אחת, בחירה אחת. הכותרות בתוך 24 יחידות UTF-16 של Meta. */
export const PUBLISH_DESTINATIONS: PublishDestination[] = [
  {
    code: "asb",
    title: "אתר + רשתות + מתווכים",
    description: "האתר, תור לפייסבוק ולאינסטגרם, ושת״פ למשרדים",
    channels: ["site", "social", "brokers"],
    edit: false,
  },
  {
    code: "as",
    title: "אתר + רשתות",
    description: "האתר, ותור לפייסבוק ולאינסטגרם",
    channels: ["site", "social"],
    edit: false,
  },
  {
    code: "a",
    title: "רק אתר",
    description: "דף הנכס באתר, בלי רשתות ובלי שת״פ",
    channels: ["site"],
    edit: false,
  },
  {
    code: "ab",
    title: "אתר + מתווכים",
    description: "האתר, ושת״פ למשרדים אחרים",
    channels: ["site", "brokers"],
    edit: false,
  },
  {
    code: "m",
    title: "רק לשמור במאגר",
    description: "בלי אתר, בלי רשתות ובלי שת״פ",
    channels: ["save"],
    edit: false,
  },
  {
    code: "e",
    title: "לערוך",
    description: "פתיחת הכרטיס ב-CRM, בלי לפרסם",
    channels: [],
    edit: true,
  },
];

export const DEST_LIST_BUTTON = "לאן לפרסם";
export const DEST_LIST_SECTION = "בחירה אחת";

/** לכל נכס: לכל היותר שורת תור לפייסבוק ואחת לאינסטגרם. בלי התראה. */
export const SOCIAL_QUEUE_ROWS_PER_PROPERTY = 2;

const DEST_RE = /^dst:(asb|as|ab|a|m|e):([0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** לחיצה ישנה על שורת רשתות, כשהדגל כבוי, נשמרת כמו השורה בלי רשתות. */
export function publishChannelsToStore(
  channels: readonly string[],
  socialOn: boolean,
): string[] {
  if (socialOn) return channels.slice();
  return channels.filter((channel) => channel !== "social");
}

/** דגל הרשתות כבוי: אין שורה שמבטיחה פייסבוק או אינסטגרם. */
export function publishDestinations(socialOn: boolean): PublishDestination[] {
  if (socialOn) return PUBLISH_DESTINATIONS;
  return PUBLISH_DESTINATIONS.filter((row) => !row.channels.includes("social"));
}

export function destinationMenuGuidance(socialOn: boolean): string {
  if (socialOn) {
    return "הבחירה היא אחת: אתר ורשתות ומתווכים, אתר ורשתות, רק אתר, אתר ומתווכים, רק מאגר, או עריכה. ";
  }
  return "הבחירה היא אחת: רק אתר, אתר ומתווכים, רק מאגר, או עריכה. ";
}

export function publishDestinationList(
  requestId: string,
  propertyId: string,
  socialOn = true,
): { button: string; section: string; rows: { id: string; title: string; description: string }[] } | null {
  if (!/^[0-9a-f]{12}$/i.test(requestId) || !PUBLISH_UUID_RE.test(propertyId)) return null;
  if (utf16len(DEST_LIST_BUTTON) > 20 || utf16len(DEST_LIST_SECTION) > 24) return null;
  const rows = publishDestinations(socialOn).map((row) => {
    const id = `dst:${row.code}:${requestId.toLowerCase()}:${propertyId.toLowerCase()}`;
    return { id, title: row.title, description: row.description, code: row.code };
  });
  if (rows.length > 10) return null;
  if (rows.some((row) => row.id.length > 200 || utf16len(row.title) > 24 || utf16len(row.description) > 72)) {
    return null;
  }
  return {
    button: DEST_LIST_BUTTON,
    section: DEST_LIST_SECTION,
    rows: rows.map(({ id, title, description }) => ({ id, title, description })),
  };
}

export function parsePublishDestination(
  buttonId: string,
): { code: string; requestId: string; propertyId: string; channels: PublishChannel[]; edit: boolean } | null {
  const m = DEST_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const found = PUBLISH_DESTINATIONS.find((row) => row.code === m[1].toLowerCase());
  if (!found) return null;
  return {
    code: found.code,
    requestId: m[2].toLowerCase(),
    propertyId: m[3].toLowerCase(),
    channels: found.channels.slice(),
    edit: found.edit,
  };
}

/** אותו מזהה בקשה לשתי שורות: הלחיצה השנייה נתקעת בבקשה שכבר בוצעה. */
export function destinationSameRequest(a: string, b: string): boolean {
  const left = parsePublishDestination(a);
  const right = parsePublishDestination(b);
  if (!left || !right) return false;
  return left.requestId === right.requestId && left.propertyId === right.propertyId;
}

/** אתר מעלה טיוטה. רק מאגר מוריד נכס שכבר באוויר. נמכר לא זז. */
export function destinationStatusPatch(
  channels: readonly string[],
  status: string,
): "active" | "unpublished" | null {
  const save = channels.length === 1 && channels[0] === "save";
  if (save && status === "active") return "unpublished";
  if (channels.includes("site") && (status === "unpublished" || status === "draft")) return "active";
  return null;
}

/**
 * רשתות לא יוצאות מהלחיצה. דגל כבוי, או נכס שלא באוויר: רק הסימון.
 * דגל דלוק ונכס באוויר: התור (השהיה ותקרה יומית), לא פוסט.
 */
export function socialEnqueuePlan(
  channels: readonly string[],
  flagOn: boolean,
  willBeActive: boolean,
): "skip" | "record" | "queue" {
  if (!channels.includes("social") || !flagOn) return "skip";
  if (!willBeActive) return "record";
  return "queue";
}

export function destinationReply(input: {
  channels: readonly string[];
  status: string;
  licenseHeld: boolean;
  social: "skip" | "record" | "queue";
  brokersSent: boolean;
}): string {
  const save = input.channels.length === 1 && input.channels[0] === "save";
  if (save) {
    return "הנכס נשמר במאגר ולא פורסם. אפשר לשנות את היעד אחר כך מהכרטיס או מכאן.";
  }
  const parts: string[] = [];
  if (input.licenseHeld) {
    parts.push("היעד נשמר. הנכס יעלה לאוויר ברגע שרישיון התיווך יאושר.");
  } else if (input.status === "active") {
    parts.push("הנכס באתר.");
  } else {
    parts.push("היעד נשמר. הנכס לא באתר.");
  }
  if (input.social === "record") {
    parts.push(input.status === "active"
      ? "הרשתות נרשמו וייכנסו לתור כשהאפשרות תידלק, עם ההשהיה והתקרה היומית."
      : "הרשתות נרשמו. הן ייכנסו לתור אחרי שהנכס באוויר, אם האפשרות דלוקה.");
  } else if (input.social === "queue") {
    parts.push("הרשתות נכנסו לתור הפרסום, עם ההשהיה והתקרה היומית.");
  }
  if (input.channels.includes("brokers")) {
    parts.push(input.brokersSent
      ? "השת״פ יצא למשרדים, עד התקרה לנכס, ובלי מספר טלפון."
      : "השת״פ נרשם. ההפצה למשרדים יוצאת רק כשהאפשרות דלוקה, עד תקרה של משרדים לנכס, ובלי מספר טלפון.");
  }
  return parts.join(" ");
}
