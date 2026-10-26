/* ============================================================================
   עותק אחרון של תשובת 200 — במקום 503 כשהמסד נופל לרגע
   ----------------------------------------------------------------------------
   גוגל מתייחסת ל-503 כאי-יציבות של האתר כולו ומאטה סריקה. כשל של שאילתה
   (timeout, סטטוס שאינו 200, גוף לא צפוי) אינו אומר שהדף הקודם שגוי.
   לכן שומרים את תשובת ה-200 האחרונה שמולאה, ובכשל מגישים אותה שוב ב-200.

   503 עם Retry-After נשאר רק כשאין עותק בכלל: דיפלוי חדש עוד לא הצליח
   פעם אחת, או שהכתובת הזו לא מולאה מעולם.

   שני מקומות, אותו מפתח:
   · זיכרון של ה-isolate — הבדיקות, ובקשה שנייה באותו תהליך.
   · ‏Netlify Blobs ‏`getDeployStore` — isolate אחר באותו דיפלוי.
     לא ‏`getStore`: חנות של האתר כולו נכתבת גם מתצוגת פריוויו.
     דיפלוי חדש מתחיל בלי עותק, וזה בכוונה.

   מה שלא נשמר: 404, 503, מעטפת שלא מולאה, ו-sitemap סטטי של "הכל נפל".
   תשובת הצלחה יוצאת כמו שהיא. השמירה קוראת עותק (clone) ולא את הגוף
   שחוזר ללקוח.
   ========================================================================== */

type Saved = {
  body: string;
  headers: [string, string][];
};

const memory = new Map<string, Saved>();
const STORE = "edge-last-good";

export function resetLastGood(): void {
  memory.clear();
}

/* ‏המפתח הוא הנתיב. ‏?id= ו-?slug= נשארים, כי דף פירוט אחד מגיש הכל.
   פרמטר מעקב אינו עותק נפרד. נתיב עברי ונתיב מקודד מתלכדים. */
export function lastGoodKey(url: string): string {
  const u = new URL(url);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const q = new URLSearchParams();
  const id = u.searchParams.get("id");
  const slug = u.searchParams.get("slug");
  if (id) q.set("id", id);
  if (slug) q.set("slug", slug);
  const search = q.toString();
  return search ? `${path}?${search}` : path;
}

export function waitUntilOf(context: unknown): ((p: Promise<unknown>) => void) | undefined {
  const wait = (context as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  return typeof wait === "function" ? (p) => wait.call(context, p) : undefined;
}

let blobsOff = false;

async function blobs(): Promise<{ get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> } | null> {
  if (blobsOff) return null;
  const g = globalThis as { Netlify?: unknown };
  if (!g.Netlify) {
    blobsOff = true;
    return null;
  }
  try {
    const mod = await import("npm:@netlify/blobs");
    const store = mod.getDeployStore(STORE);
    return {
      get: (key) => store.get(key, { type: "text", consistency: "strong" }),
      set: (key, value) => store.set(key, value),
    };
  } catch {
    blobsOff = true;
    return null;
  }
}

function blobKey(key: string): string {
  return encodeURIComponent(key);
}

async function persist(key: string, saved: Saved): Promise<void> {
  const store = await blobs();
  if (!store) return;
  await store.set(blobKey(key), JSON.stringify(saved));
}

async function load(key: string): Promise<Saved | null> {
  const store = await blobs();
  if (!store) return null;
  const raw = await store.get(blobKey(key));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Saved;
  if (!parsed || typeof parsed.body !== "string" || !Array.isArray(parsed.headers)) return null;
  return parsed;
}

/* ‏שומר תשובת 200. לא זורק: כשל שמירה אינו משנה את התשובה ללקוח. */
export async function remember(
  key: string,
  response: Response,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  if (response.status !== 200) return;
  let saved: Saved;
  try {
    const copy = response.clone();
    const body = await copy.text();
    const headers: [string, string][] = [];
    copy.headers.forEach((value, name) => headers.push([name, value]));
    saved = { body, headers };
  } catch {
    return;
  }
  memory.set(key, saved);
  const pending = persist(key, saved).catch(() => {});
  if (waitUntil) {
    try {
      waitUntil(pending);
      return;
    } catch { /* אין waitUntil אמיתי — מחכים כאן */ }
  }
  await pending;
}

/* ‏העותק הקודם, ב-200, בלי Retry-After. null כשאין כלום. */
export async function recall(key: string): Promise<Response | null> {
  let saved = memory.get(key) || null;
  if (!saved) {
    try {
      saved = await load(key);
    } catch {
      saved = null;
    }
    if (saved) memory.set(key, saved);
  }
  if (!saved) return null;
  const headers = new Headers(saved.headers);
  headers.delete("retry-after");
  return new Response(saved.body, { status: 200, headers });
}
