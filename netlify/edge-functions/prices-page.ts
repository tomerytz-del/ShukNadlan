/* ============================================================================
   מחירי דירות לפי עיר - ‏/prices
   ----------------------------------------------------------------------------
   ‏`prices.html` הוא דף סטטי שהטבלאות בו ריקות. הפונקציה כאן ממלאת אותן
   בשרת מ-`city_price_table()`, כדי שסורק - של גוגל או של מנוע תשובות -
   יקרא את המספרים עצמם בלי להריץ JS. היא מוסיפה גם Dataset ב-JSON-LD
   ואת התקופה שהנתונים מכסים.

   ## כישלון אינו שובר דף

   ‏timeout, מסד שלא ענה או תשובה ריקה - הדף יוצא כמו שהוא, וה-JS שבו
   (‏`assets/prices-render.js`, אותו קובץ שמיובא כאן) קורא לאותה פונקציה
   מהדפדפן. כלומר כשל כאן מאבד את הגרסה לסורק, לא את הטבלה לגולש/ת.

   התיעוד: ‎docs/city-prices.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/prices-render.js";
import { registry } from "./lib/markets.ts";

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

type Prices = {
  render: (rows: PriceRow[], opts: { labelFor: (s: string) => string; marketOrder: string[] }) => string;
  jsonLd: (rows: PriceRow[], site: string) => string;
  period: (rows: PriceRow[]) => { start: string; end: string } | null;
  heDate: (iso: string) => string;
};

function prices(): Prices {
  return (globalThis as unknown as { ShukPrices: Prices }).ShukPrices;
}

async function fetchRows(): Promise<PriceRow[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/city_price_table`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows as PriceRow[] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ‏ממלא את הדף. מחזיר את ה-HTML כמו שהוא אם הסמנים חסרים. */
export function inject(html: string, rows: PriceRow[]): string {
  const P = prices();
  const reg = registry();
  const list = reg ? reg.list : [];
  const label = new Map(list.map((m) => [m.slug, m.label]));
  const body = P.render(rows, {
    labelFor: (s) => label.get(s) || "",
    marketOrder: list.map((m) => m.slug),
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

  const rows = await fetchRows();
  if (!rows) return res;
  /* ‏הגוף נקרא פעם אחת - ובכל חריגה בהזרקה יוצא כמו שנקרא. */
  const html = await res.text();
  let out = html;
  try {
    out = inject(html, rows);
  } catch {
    out = html;
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  /* ‏הנתונים מתעדכנים לכל היותר פעם ביום (‏deals_scraper). דף שלא מולא
     אינו נשמר במטמון, כדי שכשל רגעי לא יוגש שעה שלמה. */
  if (out !== html) {
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return new Response(out, { status: res.status, headers });
}

export const config: Config = {
  path: ["/prices", "/prices.html"],
};
