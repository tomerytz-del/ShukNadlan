// נעילת תור אחד לסוכן/ת, ושמירת היסטוריה שלא מוחקת תור אחר.
//
// חלון הרצף (1.5-4 שניות) מאחד הודעות צמודות. מעבר לו שני POST-ים רצים
// במקביל. מי שלא תפס/ה את הנעילה חוזר/ת בלי take, והטקסט נשאר ב-pending_texts.
// המחזיק/ה משחרר/ת ב-finally; אם נשאר טקסט, טוען/ת מחדש ומריץ/ה עוד תור.
// הלולאה חסומה במספר ובזמן, כדי לא לעבור את קיר ה-Edge Function.
// מה שנשאר מחכה להודעה הבאה, שתתפוס ותרוקן.

import { peelShownMatches, stampShownMatches, type ShownMatchSet } from "./lookup_turn.ts";
import { trimHistory } from "./prompt-cache.ts";

export const TURN_STALE_MS = 120_000;
/** ארבעה תורים. חציון תור אצל סוכן/ת הוא כ-16 שניות; ארבעה נשארים מתחת לקיר. */
export const MAX_DRAIN_TURNS = 4;
export const DRAIN_BUDGET_MS = 80_000;
/** אותו חלון כמו runAgentTurn, כדי שגזימה חוזרת לא תזיז את תחילת ההיסטוריה אחרת. */
export const HISTORY_KEEP = 12;

export type LockAcquire = true | false | "unavailable";

export interface TurnLockStore {
  acquire(agentId: string, token: string): Promise<LockAcquire>;
  /** true רק אם הטוקן שוחרר ועדיין יש pending_texts. */
  release(agentId: string, token: string): Promise<boolean>;
}

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

export async function runWithTurnLock(opts: {
  agentId: string;
  store: TurnLockStore;
  runTurn: () => Promise<"work" | "idle">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxTurns?: number;
  budgetMs?: number;
  waitForLockMs?: number;
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
      return { ran, leftPending: true, skippedBusy: false, unlocked: false };
    }
    const token = newToken();
    let got = await opts.store.acquire(opts.agentId, token);
    const waitStart = now();
    while (got === false && now() - waitStart < waitFor && now() - start < budgetMs) {
      await sleep(400);
      got = await opts.store.acquire(opts.agentId, token);
    }
    if (got === "unavailable") {
      if (i === 0) {
        const outcome = await opts.runTurn();
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
    try {
      const outcome = await opts.runTurn();
      if (outcome === "work") ran++;
    } finally {
      pending = await opts.store.release(opts.agentId, token);
    }
    pendingAfter = pending;
    if (!pending) {
      return { ran, leftPending: false, skippedBusy: false, unlocked: false };
    }
  }
  return { ran, leftPending: pendingAfter, skippedBusy: false, unlocked: false };
}

/** אותו חוזה כמו ה-RPC, לבדיקות. לא נקרא מהוובהוק. */
export function memoryTurnStore(opts?: { now?: () => number; staleMs?: number }): TurnLockStore & {
  pending: string[];
  holdToken: () => string | null;
} {
  let chain: Promise<unknown> = Promise.resolve();
  const now = opts?.now ?? (() => Date.now());
  const staleMs = opts?.staleMs ?? TURN_STALE_MS;
  let token: string | null = null;
  let started = 0;
  const pending: string[] = [];
  const run = <T>(fn: () => T): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };
  return {
    pending,
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
        return pending.length > 0;
      });
    },
  };
}
