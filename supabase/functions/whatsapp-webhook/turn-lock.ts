// נעילת תור אחד לסוכן/ת, ושמירת היסטוריה שלא מוחקת תור אחר.
//
// חלון הרצף (1.5-4 שניות) מאחד הודעות צמודות. מעבר לו שני POST-ים רצים
// במקביל. מי שלא תפס/ה את הנעילה חוזר/ת בלי take, והטקסט נשאר ב-pending_texts.
// המחזיק/ה משחרר/ת ב-finally; אם נשאר טקסט, טוען/ת מחדש ומריץ/ה עוד תור.
// הלולאה חסומה במספר ובזמן, כדי לא לעבור את קיר ה-Edge Function.
// מה שנשאר מחכה להודעה הבאה, שתתפוס ותרוקן.

import { peelShownMatches, stampShownMatches, type ShownMatchSet } from "./lookup_turn.ts";
import { trimHistory } from "./prompt-cache.ts";

export const TURN_STALE_MS = 45_000;
export const HEARTBEAT_MS = 15_000;
/** דופק שנתקע לא חוסם את בדיקת הדדליין. */
export const RENEW_TIMEOUT_MS = 5_000;
/** עוצרים תור חי בלי דופק מוצלח לפני שמישהו אחר רשאי לתפוס. */
export const TURN_DEADLINE_MS = 40_000;
/** כמה פעמים מייל ממתין לנעילה לפני שמודיעים לסוכן/ת ומוותרים. */
export const EMAIL_LOCK_TRIES = 3;
/** כמה פעמים compare-and-set מנסה לפני הוספה אטומית. */
export const CAS_ATTEMPTS = 4;
/** ארבעה תורים. חציון תור אצל סוכן/ת הוא כ-16 שניות; ארבעה נשארים מתחת לקיר. */
export const MAX_DRAIN_TURNS = 4;
export const DRAIN_BUDGET_MS = 80_000;
/** אותו חלון כמו runAgentTurn, כדי שגזימה חוזרת לא תזיז את תחילת ההיסטוריה אחרת. */
export const HISTORY_KEEP = 12;
export const LOCK_BACKOFF_MS = 400;

/** ריקון רק בגלל טקסט ממתין. תמונות, גם ישנות, לא פותחות תור ולא שולחות. */
export function releaseDrainsTextsOnly(pendingTexts: number, pendingImages: number): boolean {
  return pendingTexts > 0 && pendingImages >= 0;
}

/**
 * שטיפת תמונות רק באלבום בלי טקסט, ורק בתור הראשון.
 * מייל, ריקון המשך, ותמונות ישנות ליד טקסט - לא שולחים שאלה.
 */
export function shouldFlushPendingImages(opts: {
  flushImages: boolean;
  hasText: boolean;
  pendingImages: number;
  /** ריקון שהתחיל מ-waitUntil. רצף שחיכה לנעילה אינו כזה. */
  followUp?: boolean;
}): boolean {
  if (opts.followUp || opts.hasText || opts.pendingImages <= 0) return false;
  return opts.flushImages === true;
}

export const REQUEUE_MAX = 2;

/** אחרי שני החזרות לתור שולחים כישלון קצר ולא מחזירים שוב. */
export function nextRequeue(text: string): { text: string; giveUp: boolean } {
  const mark = /^\[\[rq:(\d+)\]\]/.exec(text);
  const n = mark ? Number(mark[1]) : 0;
  const body = mark ? text.slice(mark[0].length) : text;
  if (n >= REQUEUE_MAX) return { text: body, giveUp: true };
  return { text: `[[rq:${n + 1}]]${body}`, giveUp: false };
}

export function stripRequeueMark(text: string): string {
  return text.replace(/^\[\[rq:\d+\]\]/, "");
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** כמו ב-27.10: אם הוותיקה ממתינה יותר מזה, לא מצרפים אף תמונה אוטומטית. */
export const HOLD_ALL_IMAGE_MS = 20 * 60 * 1000;
/** תקרה מעל הכלל של 20 הדקות. מעבר לזה אין צירוף אוטומטי. */
export const AUTO_ATTACH_IMAGE_MS = DAY_MS;
/** יום בשבוע רק בחלון הזה. מעבר לו אין אזכור זמן, כדי ש"חמישי" לא יתבלבל עם השבוע. */
export const PHOTO_LABEL_DAYS = 6;

export function imageUrlKey(url: string): string {
  const i = url.indexOf("?");
  return i < 0 ? url : url.slice(0, i);
}

/**
 * שאלה על תמונות רק אם הרצף מבקש אותה, ורק על תמונות שאף תור שהסתיים לא הראה.
 * מלצר שהתמונה שלו כבר נענתה כתור טקסט לא שולח שאלה.
 */
export function unsolicitedPhotoAsk(opts: {
  flushImages: boolean;
  hasText: boolean;
  pending: readonly string[];
  handled: readonly string[];
}): string[] {
  if (!opts.flushImages || opts.hasText || opts.pending.length === 0) return [];
  const done = new Set(opts.handled.map(imageUrlKey));
  return opts.pending.filter((u) => !done.has(imageUrlKey(u)));
}

/**
 * כל תמונות האלבום שהתור הראה, לא רק הכתובת האחרונה שנשלחה למודל.
 * תמונה ישנה מיום לא סומנה: המודל לא ראה אותה.
 */
export function urlsHandledByTurn(
  shown: string | null,
  pending: readonly string[],
  at: readonly (number | null)[] = [],
  now = Date.now(),
): string[] {
  if (!shown) return [];
  if (!pending.length) return [shown];
  const dated = at.length === pending.length && at.some((t) => t != null);
  const recent = dated
    ? pending.filter((_, i) => {
      const t = at[i];
      return t != null && now - t < AUTO_ATTACH_IMAGE_MS;
    })
    : [...pending];
  const key = imageUrlKey(shown);
  if (recent.some((u) => imageUrlKey(u) === key)) return recent;
  const same = pending.filter((u) => imageUrlKey(u) === key);
  return same.length ? same : [shown];
}

export function rememberAskedImages(
  seen: Map<string, number>,
  agentId: string,
  urls: readonly string[],
  now = Date.now(),
): void {
  for (const url of urls) seen.set(`${agentId}\n${imageUrlKey(url)}`, now);
}

/** אותה תמונה לא נשאלת שוב בתוך היממה, גם אם סימון המסד נכשל. */
export function urlsNotAskedRecently(
  seen: ReadonlyMap<string, number>,
  agentId: string,
  urls: readonly string[],
  now = Date.now(),
  windowMs = AUTO_ATTACH_IMAGE_MS,
): string[] {
  return urls.filter((url) => {
    const at = seen.get(`${agentId}\n${imageUrlKey(url)}`);
    return at == null || now - at >= windowMs;
  });
}

/**
 * צירוף אוטומטי לנכס חדש.
 * אם הוותיקה ממתינה יותר מ-20 דקות, לא מצטרפת אף תמונה (27.10).
 * תמונה ישנה מיממה לא מצטרפת גם כש-include_waiting_images דלוק,
 * אלא אם הסוכן/ת הפנה/תה אליה במפורש.
 */
export function splitPendingForCreate(opts: {
  urls: readonly string[];
  at: readonly (number | null)[];
  /** pending_images_since. null כמו ב-main: אין הוותיקה, לא עוצרים את כולן. */
  since?: number | null;
  /** include_waiting_images. עוקף את 20 הדקות, לא את היממה. */
  explicit?: boolean;
  /** הסוכן/ת הפנה/תה אל התמונות הישנות עצמן. */
  referenced?: boolean;
  now?: number;
}): { attach: string[]; hold: string[] } {
  if (opts.referenced) return { attach: [...opts.urls], hold: [] };
  const now = opts.now ?? Date.now();
  const ageAt = (t: number | null | undefined) => (t == null ? null : now - t);
  const per = opts.urls.map((_, i) => ageAt(i < opts.at.length ? opts.at[i] : null));
  const sinceAge = ageAt(opts.since === undefined ? null : opts.since);
  let oldest = sinceAge;
  if (oldest == null) {
    for (const age of per) {
      if (age != null) oldest = oldest == null ? age : Math.max(oldest, age);
    }
  }
  const overDay = (age: number | null) => age != null && age >= AUTO_ATTACH_IMAGE_MS;
  if (!opts.explicit && oldest != null && oldest > HOLD_ALL_IMAGE_MS) {
    return { attach: [], hold: [...opts.urls] };
  }
  const attach: string[] = [];
  const hold: string[] = [];
  opts.urls.forEach((url, i) => {
    const age = per[i] ?? sinceAge;
    if (opts.explicit ? overDay(age) || age == null : overDay(per[i])) hold.push(url);
    else attach.push(url);
  });
  return { attach, hold };
}

/**
 * יום בשבוע ושעה, בלי תאריך מספרי. null כשהתמונה ישנה משישה ימים:
 * "יום חמישי" בלי תאריך מטעה.
 */
export function photoWaitLabel(at: number, now = Date.now()): string | null {
  if (now - at > PHOTO_LABEL_DAYS * DAY_MS) return null;
  const tz = "Asia/Jerusalem";
  const time = new Date(at).toLocaleTimeString("he-IL", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(t);
  if (dayKey(at) === dayKey(now)) return `מהשעה ${time}`;
  const weekday = new Date(at).toLocaleDateString("he-IL", { timeZone: tz, weekday: "long" })
    .replace(/^יום\s+/, "");
  return `מיום ${weekday} בשעה ${time}`;
}

/** גוף השאלה. תמונה ישנה משישה ימים בלי שעה ובלי יום. */
export function photoAskLead(
  count: number,
  since: number | null,
  now = Date.now(),
  askAfterMs = 20 * 60 * 1000,
): string {
  const veryOld = since != null && now - since > PHOTO_LABEL_DAYS * DAY_MS;
  if (veryOld) {
    return count === 1
      ? "יש תמונה ישנה שממתינה לשיוך"
      : `יש ${count} תמונות ישנות שממתינות לשיוך`;
  }
  const label = since != null && now - since > askAfterMs ? photoWaitLabel(since, now) : null;
  const what = count === 1 ? "תמונה אחת" : `${count} תמונות`;
  const older = label ? ` (הראשונה ${label})` : "";
  return `יש ${what} שממתינות לשיוך${older}`;
}

/** הערת הקטלוג פעם אחת, גם אם התור חזר לתור. */
export function withCatalogNote(text: string, note: string): string {
  if (!note || text.includes("[בתור הזה")) return text;
  return text + note;
}

/** טקסט שנלקח והתור נקטע בלי כלי מוחזר לראש התור, לא לסוף. */
export function prependPending(existing: readonly string[], added: readonly string[]): string[] {
  const fresh = added.map((t) => t.trim()).filter(Boolean);
  return [...fresh, ...existing];
}

/**
 * תור שנקטע אחרי כלי שכבר הצליח: שומרים מה נעשה, כדי שלא ייפתח נכס כפול.
 * בלי כלי: אין מה לשמור, והטקסט חוזר לתור.
 */
export function abortedTurnPlan(toolNames: readonly string[]): "save" | "requeue" {
  return toolNames.length ? "save" : "requeue";
}

export function abortedTurnNote(toolNames: readonly string[]): string {
  return `בוצעו כלים לפני שהתור נקטע: ${toolNames.join(", ")}. ` +
    "אם נוצר נכס או כרטיס, הוא כבר קיים ואין ליצור שוב.";
}

/** מייל שלא תפס נעילה: עוד ניסיון, ואחרי שלושה מודיעים ומוותרים. */
export function emailLockPlan(attempt: number, max = EMAIL_LOCK_TRIES): "retry" | "fail" {
  return attempt >= max ? "fail" : "retry";
}

/** בלי נושא. "נשמר חלק" רק כשידוע שכלי רץ. unknown לא מזמין להעביר שוב. */
export function emailFailureNotice(toolsRan: boolean | "unknown"): { title: string; body: string } {
  if (toolsRan === true) {
    return {
      title: "מייל שלא הושלם",
      body: "הטיפול במייל נקטע אחרי שנשמר חלק מהעבודה. מה שכבר נשמר נשאר.",
    };
  }
  if (toolsRan === "unknown") {
    return {
      title: "מייל שלא הושלם",
      body: "הטיפול במייל נקטע לפני שהסתיים.",
    };
  }
  return {
    title: "מייל שלא טופל",
    body: "לא הצלחתי לטפל במייל שהועבר. אפשר לכתוב לי כאן מה להכניס.",
  };
}

/** דופק עם תקרה. תקיעה חוזרת כשגיאה כדי שהדדליין ימשיך להיבדק. */
export async function renewOrTimeout(
  renew: () => Promise<RenewBeat>,
  sleep: (ms: number) => Promise<void>,
  timeoutMs = RENEW_TIMEOUT_MS,
): Promise<RenewBeat> {
  let finished = false;
  const renewP = renew().then((v) => {
    finished = true;
    return v;
  }).catch(() => "error" as const);
  const timeoutP = sleep(timeoutMs).then(() => "error" as const);
  const first = await Promise.race([renewP, timeoutP]);
  if (!finished) return "error";
  return first;
}

export class LeaseLost extends Error {
  constructor() {
    super("lease lost");
    this.name = "LeaseLost";
  }
}

export class LeaseDeadline extends Error {
  constructor() {
    super("lease deadline");
    this.name = "LeaseDeadline";
  }
}

/** true = החכירה הוארכה. false = הטוקן נלקח. error = כשל רשת. unavailable = אין RPC. */
export type RenewBeat = true | false | "error" | "unavailable";

/**
 * בזמן שהתור רץ: דופק כל 15 שניות. טוקן שנלקח עוצר מיד. כשל רשת לא עוצר
 * עד 40 שניות בלי דופק מוצלח - לפני חלון ה-45, כדי ששני תורים לא ירוצו יחד.
 * אין RPC (הפונקציה עלתה לפני המיגרציה): לא מפילים תור חי. השעון במסד
 * נשאר 120 שניות עד שהמיגרציה עולה.
 */
export async function raceTurnWithLease<T>(opts: {
  run: () => Promise<T>;
  renew: () => Promise<RenewBeat>;
  onAbort?: () => void;
  heartbeatMs?: number;
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<T> {
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const deadlineMs = opts.deadlineMs ?? TURN_DEADLINE_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  let lastOk = now();
  let lastBeat = lastOk;
  let stop = false;
  let rejectAbort: (err: Error) => void = () => {};
  const abort = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  abort.catch(() => {});
  const fail = (err: Error) => {
    if (stop) return;
    stop = true;
    // הדחייה קודם, כדי ש-Promise.race יבחר בה ולא בסיום שה-abort עצמו גורם.
    rejectAbort(err);
    opts.onAbort?.();
  };
  const watch = (async () => {
    try {
      while (!stop) {
        const remain = deadlineMs - (now() - lastOk);
        if (remain <= 0) {
          fail(new LeaseDeadline());
          return;
        }
        const untilBeat = heartbeatMs - (now() - lastBeat);
        const slice = Math.min(remain, Math.max(0, untilBeat));
        if (slice > 0) await sleep(slice);
        if (stop) return;
        if (now() - lastOk >= deadlineMs) {
          fail(new LeaseDeadline());
          return;
        }
        if (now() - lastBeat < heartbeatMs) continue;
        lastBeat = now();
        let beat: RenewBeat;
        let renewHung = false;
        try {
          let finished = false;
          const renewP = opts.renew().then((v) => {
            finished = true;
            return v;
          }).catch(() => "error" as const);
          const timeoutP = sleep(RENEW_TIMEOUT_MS).then(() => "error" as const);
          beat = await Promise.race([renewP, timeoutP]);
          renewHung = !finished;
          if (renewHung) {
            renewP.then((v) => {
              if (!stop && v === false) fail(new LeaseLost());
            });
            beat = "error";
          }
        } catch {
          beat = "error";
        }
        if (stop) return;
        if (beat === "unavailable") return;
        if (beat === "error") {
          if (now() - lastOk >= deadlineMs) fail(new LeaseDeadline());
          continue;
        }
        if (beat !== true) {
          fail(new LeaseLost());
          return;
        }
        if (now() - lastOk >= deadlineMs) {
          fail(new LeaseDeadline());
          return;
        }
        lastOk = now();
      }
    } catch {
      // דחייה מאוחרת אחרי שהתור נגמר לא בורחת.
    }
  })();
  watch.catch(() => {});
  try {
    return await Promise.race([opts.run(), abort]);
  } finally {
    stop = true;
  }
}

/** ניסיון חוזר לשחרור. false יציב (הטוקן כבר לא שלנו) לא חוזרים עליו. זריקה = כשל רשת. */
export async function releaseWithRetry(
  release: () => Promise<boolean>,
  attempts = 3,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  let last = false;
  for (let i = 0; i < attempts; i++) {
    try {
      return await release();
    } catch {
      last = false;
      if (i < attempts - 1) await sleep(200 * (i + 1));
    }
  }
  return last;
}

export type LockAcquire = true | false | "unavailable";

export interface TurnLockStore {
  acquire(agentId: string, token: string): Promise<LockAcquire>;
  /** true רק אם הטוקן שוחרר ועדיין יש pending_texts. */
  release(agentId: string, token: string): Promise<boolean>;
  /** מאריך חכירה. false = הטוקן כבר לא שלנו. */
  renew?(agentId: string, token: string): Promise<RenewBeat>;
}

export type TurnCtx = { pass: number; signal: AbortSignal; followUp?: boolean };

export type HistMsg = { role?: string; content?: unknown };

export function rpcMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.code || ""} ${error.message || ""}`;
  return error.code === "PGRST202" ||
    /schema cache|could not find the function|does not exist/i.test(blob);
}

function msgKey(message: HistMsg): string {
  const content = message?.content;
  const body = typeof content === "string" ? content : JSON.stringify(content ?? null);
  return `${message?.role ?? ""}\n${body}`;
}

/**
 * הרשומות שהתור הזה הוסיף. trimHistory מוריד תחילית; ההתאמה היא הסיומת
 * של הבסיס שפותחת את ההיסטוריה החדשה. מה שאחריה הוא של התור.
 */
export function entriesAddedSince<T extends HistMsg>(base: readonly T[], next: readonly T[]): T[] {
  const baseKeys = base.map(msgKey);
  const nextKeys = next.map(msgKey);
  for (let drop = 0; drop <= baseKeys.length; drop++) {
    const rest = baseKeys.slice(drop);
    if (rest.length > nextKeys.length) continue;
    let aligned = true;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] !== nextKeys[i]) {
        aligned = false;
        break;
      }
    }
    if (aligned) return next.slice(rest.length);
  }
  return [];
}

/** היסטוריה שמורה + רשומות התור, וסמן assistant אחד בסוף. */
export function historyWithAppendedTurn<T extends HistMsg>(
  stored: readonly T[],
  added: readonly T[],
  shown: Readonly<Record<string, ShownMatchSet>> | undefined,
  limit = HISTORY_KEEP,
): T[] {
  const peeled = peelShownMatches(stored);
  const body = trimHistory([...peeled.history, ...added], limit);
  const merged = { ...peeled.shown, ...(shown || {}) };
  return stampShownMatches(body, merged);
}

/**
 * גרסאות שוות: כותבים את ההיסטוריה של התור (היא נבנתה מהבסיס הזה).
 * גרסה שזזה: לא דורסים. מוסיפים רק את מה שהתור הוסיף, על מה ששמור עכשיו.
 */
export function nextSavedHistory<T extends HistMsg>(opts: {
  expectedVersion: number;
  storedVersion: number;
  storedHistory: readonly T[];
  loadedHistory: readonly T[];
  nextHistory: readonly T[];
  shown?: Readonly<Record<string, ShownMatchSet>>;
  storedShown?: Readonly<Record<string, ShownMatchSet>>;
}): T[] {
  const added = entriesAddedSince(opts.loadedHistory, opts.nextHistory);
  if (opts.expectedVersion === opts.storedVersion) {
    return stampShownMatches(opts.nextHistory, opts.shown);
  }
  return historyWithAppendedTurn(opts.storedHistory, added, {
    ...(opts.storedShown || {}),
    ...(opts.shown || {}),
  });
}

/**
 * אותו חוזה כמו whatsapp_history_merge_append: מוסיפים, גוזרים ל-12
 * הודעות בלי הסמן, וסמן assistant אחד נשאר בסוף.
 */
/**
 * איך שומרים היסטוריה.
 * גרסה לא ידועה: הוספה אטומית, ו-upsert מלא רק אם ה-RPC עוד לא קיים.
 * אחרי 4 התנגשויות: הוספה אטומית, לא מערך מלא שמוחק תור אחר.
 */
export function historyPersistPlan(opts: {
  versionKnown: boolean;
  append: "ok" | "missing" | "failed" | "pending";
  casConflicts: number;
  casMissing: boolean;
}): "cas" | "append" | "legacy" | "stop" {
  if (!opts.versionKnown) {
    if (opts.append === "ok" || opts.append === "pending") return "append";
    if (opts.append === "missing") return "legacy";
    return "stop";
  }
  if (opts.casMissing) return "legacy";
  if (opts.casConflicts >= CAS_ATTEMPTS) {
    return opts.append === "pending" ? "append" : "stop";
  }
  return "cas";
}

export function mergeHistoryAppend<T extends HistMsg>(
  history: readonly T[],
  entries: readonly T[],
  cap = HISTORY_KEEP,
): T[] {
  const prev = peelShownMatches(history);
  const added = peelShownMatches(entries);
  const limit = Math.max(1, cap);
  const body = [...prev.history, ...added.history].slice(-limit);
  return stampShownMatches(body, { ...prev.shown, ...added.shown });
}

export async function runWithTurnLock(opts: {
  agentId: string;
  store: TurnLockStore;
  runTurn: (ctx: TurnCtx) => Promise<"work" | "idle">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxTurns?: number;
  budgetMs?: number;
  waitForLockMs?: number;
  followUp?: boolean;
  newToken?: () => string;
}): Promise<{ ran: number; leftPending: boolean; skippedBusy: boolean; unlocked: boolean }> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxTurns = opts.maxTurns ?? MAX_DRAIN_TURNS;
  const budgetMs = opts.budgetMs ?? DRAIN_BUDGET_MS;
  const waitFor = opts.waitForLockMs ?? 0;
  const newToken = opts.newToken ?? (() => crypto.randomUUID());
  const start = now();
  let ran = 0;
  let pendingAfter = false;

  for (let i = 0; i < maxTurns; i++) {
    if (i > 0 && now() - start >= budgetMs) {
      return { ran, leftPending: pendingAfter, skippedBusy: false, unlocked: false };
    }
    const token = newToken();
    let got = await opts.store.acquire(opts.agentId, token);
    const waitStart = now();
    // ההמתנה הראשונה (מי שלא תפס) יכולה להימשך עד חלון ההתיישנות.
    // תורי הריקון שאחריה נעצרים בתקציב, כדי לא לעבור את קיר הפונקציה.
    while (got === false && now() - waitStart < waitFor) {
      if (i > 0 && now() - start >= budgetMs) break;
      await sleep(LOCK_BACKOFF_MS);
      got = await opts.store.acquire(opts.agentId, token);
    }
    if (got === "unavailable") {
      if (i === 0) {
        const outcome = await opts.runTurn({
          pass: 0,
          signal: new AbortController().signal,
          followUp: opts.followUp === true,
        });
        return {
          ran: outcome === "work" ? 1 : 0,
          leftPending: false,
          skippedBusy: false,
          unlocked: true,
        };
      }
      return { ran, leftPending: pendingAfter, skippedBusy: false, unlocked: true };
    }
    if (got === false) {
      return { ran, leftPending: ran > 0, skippedBusy: ran === 0, unlocked: false };
    }
    let pending = false;
    const ac = new AbortController();
    let running: Promise<"work" | "idle"> = Promise.resolve("idle");
    const run = () => {
      running = opts.runTurn({ pass: i, signal: ac.signal, followUp: opts.followUp === true });
      return running;
    };
    try {
      const outcome = opts.store.renew
        ? await raceTurnWithLease({
          run,
          renew: () => opts.store.renew!(opts.agentId, token),
          onAbort: () => ac.abort(),
          sleep,
          now,
        })
        : await run();
      if (outcome === "work") ran++;
    } catch (err) {
      if (!(err instanceof LeaseLost) && !(err instanceof LeaseDeadline)) throw err;
    } finally {
      // הכלי שכבר רץ נגמר לפני השחרור, והדופק נשאר עד אז. בלי זה
      // משחררים אחרי שתי שניות והתור הבא רץ על נכס שעוד נוצר.
      if (ac.signal.aborted) {
        let settled = false;
        let wake: () => void = () => {};
        const untilWake = () => new Promise<void>((resolve) => {
          wake = resolve;
        });
        const keep = (async () => {
          const started = now();
          while (!settled && now() - started < 25_000) {
            if (!opts.store.renew) {
              await Promise.race([sleep(25_000), untilWake()]);
              return;
            }
            const beat = await renewOrTimeout(
              () => opts.store.renew!(opts.agentId, token),
              sleep,
            );
            // בלי דופק מוצלח לא מחכים: החכירה התיישן והכלי לא יחסום אותה.
            if (beat !== true) return;
            await Promise.race([sleep(HEARTBEAT_MS), untilWake()]);
          }
        })();
        await Promise.race([running.catch(() => undefined), keep.catch(() => undefined)]);
        settled = true;
        wake();
        await keep.catch(() => undefined);
      }
      pending = await releaseWithRetry(() => opts.store.release(opts.agentId, token), 3, sleep);
    }
    pendingAfter = pending;
    if (!pending) {
      return { ran, leftPending: false, skippedBusy: false, unlocked: false };
    }
  }
  return { ran, leftPending: pendingAfter, skippedBusy: false, unlocked: false };
}

export type TurnLockResult = {
  ran: number;
  leftPending: boolean;
  skippedBusy: boolean;
  unlocked: boolean;
};

/**
 * תפיסה, ואם מישהו מחזיק - המתנה קצרה עד חלון ההתיישנות ואז תפיסה שוב.
 * אם נשאר טקסט (או שעדיין תפוס אחרי ההמתנה) קוראים ל-kick פעם אחת,
 * כדי ש-waitUntil ימשיך בלי כפילות: הלקיחה של pending_texts אטומית.
 */
export async function runTurnUntilQuiet(opts: {
  agentId: string;
  store: TurnLockStore;
  runTurn: (ctx: TurnCtx) => Promise<"work" | "idle">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxTurns?: number;
  budgetMs?: number;
  waitForLockMs?: number;
  followUp?: boolean;
  retryBusy?: boolean;
  kicksLeft?: number;
  kick?: () => void;
  newToken?: () => string;
}): Promise<TurnLockResult> {
  const retryBusy = opts.retryBusy !== false;
  const firstWait = retryBusy ? 0 : (opts.waitForLockMs ?? 0);
  let result = await runWithTurnLock({
    ...opts,
    waitForLockMs: firstWait,
  });
  if (result.unlocked) return result;
  if (result.skippedBusy && retryBusy) {
    result = await runWithTurnLock({
      ...opts,
      waitForLockMs: opts.waitForLockMs && opts.waitForLockMs > 0
        ? opts.waitForLockMs
        : TURN_STALE_MS,
      budgetMs: TURN_STALE_MS + (opts.budgetMs ?? DRAIN_BUDGET_MS),
    });
  }
  const kicksLeft = opts.kicksLeft ?? 1;
  if ((result.leftPending || result.skippedBusy) && opts.kick && kicksLeft > 0) {
    opts.kick();
  }
  return result;
}

/** אותו חוזה כמו ה-RPC, לבדיקות. לא נקרא מהוובהוק. */
export function memoryTurnStore(opts?: { now?: () => number; staleMs?: number }): TurnLockStore & {
  pending: string[];
  images: string[];
  holdToken: () => string | null;
} {
  let chain: Promise<unknown> = Promise.resolve();
  const now = opts?.now ?? (() => Date.now());
  const staleMs = opts?.staleMs ?? TURN_STALE_MS;
  let token: string | null = null;
  let started = 0;
  const pending: string[] = [];
  const images: string[] = [];
  const run = <T>(fn: () => T): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };
  return {
    pending,
    images,
    holdToken: () => token,
    acquire(_agentId, nextToken) {
      return run(() => {
        const age = now() - started;
        const stale = token != null && age >= staleMs;
        if (token && !stale) return false;
        token = nextToken;
        started = now();
        return true;
      });
    },
    release(_agentId, held) {
      return run(() => {
        if (token !== held) return false;
        token = null;
        return releaseDrainsTextsOnly(pending.length, images.length);
      });
    },
  };
}
