/* ============================================================================
   מחירי דירות לפי עיר - ‏/prices
   ----------------------------------------------------------------------------
   ‏`prices.html` הוא דף סטטי שהטבלאות בו ריקות. הפונקציה כאן ממלאת אותן
   בשרת מ-`city_price_table()`, כדי שסורק - של גוגל או של מנוע תשובות -
   יקרא את המספרים עצמם בלי להריץ JS. היא מוסיפה גם Dataset ב-JSON-LD
   ואת התקופה שהנתונים מכסים.

   ## כישלון אינו שובר דף

   ‏timeout, שגיאת HTTP או תשובה שאינה מערך: אם יש עותק של דף שמולא,
   הוא מוגש שוב ב-200 (‏lib/last-good.ts). בלי עותק - 503 עם אותו HTML,
   כדי שה-JS (‏`assets/prices-render.js`, אותו קובץ שמיובא כאן) ימלא
   מהדפדפן וגוגל תחזור. בלי מטמון על ה-503. מערך ריק הוא תשובה מהמסד:
   200 בלי מילוי, וה-JS ממלא. הדף אחד, לא "רשומה חסרה", ולכן ריק אינו 404.

   ## מחירי מודעות: תוספת, לא תנאי

   ‏`city_asking_price_table()` (‏20271127100000) נשלפת במקביל ומוסיפה לכל
   עיר טבלת "מבוקש מול נסגר". כשלה (timeout, סטטוס שאינו 200, גוף שאינו
   מערך) הדף עדיין יוצא עם העסקאות ב-200, אבל **לא נשמר במטמון** ולא נשמר
   כעותק אחרון: כמו בכשל השכונות ב-`deals-page.ts`, דף חלקי אינו אמור להיות
   מוגש שעה שלמה. מערך ריק (אין עיר עם 5 מודעות) הוא תשובה תקינה.

   התיעוד: ‎docs/city-prices.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/prices-render.js";
import { registry } from "./lib/markets.ts";
import { lastGoodKey, recall, remember, waitUntilOf } from "./lib/last-good.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;

export type PriceRow = {
  market_slug: string;
  city: string;
  rooms: number;
  deals: number;
  median_price: number;
  median_ppsqm: number;
  period_start: string;
  period_end: string;
};

export type AskingRow = {
  market_slug: string;
  city: string;
  rooms: number;
  listings: number;
  median_price: number;
  as_of: string;
};

type Prices = {
  render: (
    rows: PriceRow[],
    opts: { labelFor: (s: string) => string; marketOrder: string[]; asking?: AskingRow[] },
  ) => string;
  jsonLd: (rows: PriceRow[], site: string) => string;
  period: (rows: PriceRow[]) => { start: string; end: string } | null;
  heDate: (iso: string) => string;
};

function prices(): Prices {
  return (globalThis as unknown as { ShukPrices: Prices }).ShukPrices;
}

type RowsResult<T> = { ok: true; rows: T[] } | { ok: false };

/* ‏מחירי המודעות הם תוספת, ולכן timeout קצר יותר: איטיות שלהם אינה אמורה
   להחזיק את כל הדף (ואת המטמון) עד הגבול של העסקאות. */
const ASKING_TIMEOUT_MS = 1500;

async function rpc<T>(name: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<RowsResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: false };
    return { ok: true, rows: rows as T[] };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/* ‏503 בלבד. דף שמולא אינו עובר כאן, וגם לא מערך ריק. */
function failureHeaders(base: Headers): Headers {
  const headers = new Headers(base);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  headers.set("Retry-After", "60");
  return headers;
}

/* ‏ממלא את הדף. מחזיר את ה-HTML כמו שהוא אם הסמנים חסרים. */
export function inject(html: string, rows: PriceRow[], asking: AskingRow[] = []): string {
  const P = prices();
  const reg = registry();
  const list = reg ? reg.list : [];
  const label = new Map(list.map((m) => [m.slug, m.label]));
  const body = P.render(rows, {
    labelFor: (s) => label.get(s) || "",
    marketOrder: list.map((m) => m.slug),
    asking,
  });
  const start = /<div id="pricesTables"[^>]*>[\s\S]*?<!--\/prices-->/;
  if (!body || !start.test(html)) return html;

  let out = html.replace(
    start,
    () => `<div id="pricesTables" data-ssr="1">\n${body}\n<!--/prices-->`,
  );
  const p = P.period(rows);
  if (p) {
    const text = `${P.heDate(p.start)} - ${P.heDate(p.end)}`;
    out = out.replace(/(<span id="pricesPeriod"[^>]*>)[\s\S]*?(<\/span>)/, (_m, a, b) => `${a}${text}${b}`);
  }
  out = out.replace(
    /<\/head>/i,
    () => `<script type="application/ld+json">${P.jsonLd(rows, SITE)}</script>\n</head>`,
  );
  return out;
}

export default async function handler(_request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  const [got, askingGot] = await Promise.all([
    rpc<PriceRow>("city_price_table"),
    rpc<AskingRow>("city_asking_price_table", ASKING_TIMEOUT_MS),
  ]);
  if (!got.ok) {
    const prev = await recall(lastGoodKey(_request.url));
    if (prev) return prev;
    return new Response(res.body, { status: 503, headers: failureHeaders(res.headers) });
  }
  /* ‏המסד ענה ואין שורות: הדף נשאר 200, וה-JS ממלא. */
  if (!got.rows.length) return res;
  /* ‏מחירי המודעות נכשלו ויש עותק של דף שלם (עסקאות ומחירי מודעות): הוא מוגש,
     כמו בכשל עסקאות. בלי עותק הדף יוצא חלקי, וראו הכותרות למטה. */
  if (!askingGot.ok) {
    const prev = await recall(lastGoodKey(_request.url));
    if (prev) return prev;
  }
  /* ‏הגוף נקרא פעם אחת - ובכל חריגה בהזרקה יוצא כמו שנקרא. */
  const html = await res.text();
  let out = html;
  try {
    out = inject(html, got.rows, askingGot.ok ? askingGot.rows : []);
  } catch {
    out = html;
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  /* ‏הנתונים מתעדכנים לכל היותר פעם ביום (‏deals_scraper). דף שלא מולא, או
     שמולא בלי מחירי המודעות, אינו נשמר במטמון ואינו נשמר כעותק אחרון: כשל רגעי
     לא יוגש שעה שלמה. */
  const filled = out !== html;
  if (filled) {
    const complete = askingGot.ok;
    headers.set("Netlify-CDN-Cache-Control", complete ? "public, max-age=3600, stale-while-revalidate=86400" : "no-store");
    headers.set("Cache-Control", complete ? "public, max-age=0, must-revalidate" : "no-store");
  }
  const response = new Response(out, { status: res.status, headers });
  if (filled && askingGot.ok) await remember(lastGoodKey(_request.url), response, waitUntilOf(context));
  return response;
}

export const config: Config = {
  path: ["/prices", "/prices.html"],
};
