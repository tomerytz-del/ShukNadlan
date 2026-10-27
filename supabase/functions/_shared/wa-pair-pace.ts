// מרווח בין הודעות יוצאות לאותו נמען.
//
// Meta דוחה רצף לאותו מספר (131056, pair rate limit). בתוך תהליך אחד
// השרשרת הזו מסדרת את השליחות. בין תהליכים (בוט + התראות) השמירה היא
// whatsapp_pair_reserve במסד, אם חוברה. בלי המסד נשאר המרווח המקומי.

const DEFAULT_GAP_MS = 1500;

type Reserve = (phone: string, gapMs: number) => Promise<number>;

let gapOverride: number | null = null;
let reserve: Reserve | null = null;
const chains = new Map<string, Promise<unknown>>();
const lastSent = new Map<string, number>();

function readEnvGap(): number {
  try {
    const deno = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno;
    const raw = deno?.env?.get?.("WHATSAPP_PAIR_GAP_MS");
    const n = Number(raw);
    if (raw != null && raw !== "" && Number.isFinite(n) && n >= 0 && n <= 20000) return n;
  } catch {
    /* הרצה מחוץ ל-Deno, למשל בדיקת node */
  }
  return DEFAULT_GAP_MS;
}

export function pairGapMs(): number {
  return gapOverride ?? readEnvGap();
}

/** לחיבור ה-RPC מהוובהוק ומהתראות. מחזירה כמה מילישניות לחכות. */
export function setPairReserve(fn: Reserve | null): void {
  reserve = fn;
}

export function resetPairPaceForTests(gapMs = 0): void {
  gapOverride = gapMs;
  reserve = null;
  chains.clear();
  lastSent.clear();
}

function digits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d || phone;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * מריצה את השליחה אחרי כל שליחה קודמת לאותו מספר, עם מרווח.
 * ההודעה הראשונה יוצאת מיד. כישלון אינו שובר את השרשרת של הבאה.
 */
export function paceRecipient<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  const key = digits(phone);
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(async () => {
    const gap = pairGapMs();
    let wait = 0;
    if (reserve && gap > 0) {
      try {
        wait = await reserve(key, gap);
      } catch {
        wait = 0;
      }
    }
    if (!reserve || wait === 0) {
      const last = lastSent.get(key) ?? 0;
      wait = Math.max(wait, gap - (Date.now() - last));
    }
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastSent.set(key, Date.now());
    }
  });
  chains.set(key, run.then(() => undefined, () => undefined));
  return run;
}
