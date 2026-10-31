/* ============================================================================
   עסקאות נדל"ן לפי יישוב - ‏/deals ו-/deals/{slug}
   ----------------------------------------------------------------------------
   ‏`deals.html` הוא דף סטטי אחד שמוגש בשתי צורות: האינדקס (‏/deals) ודף
   לכל יישוב (‏/deals/afula, דרך שורת ‎200‎ ב-`_redirects`). הפונקציה ממלאת
   אותו בשרת, כדי שסורק יקרא את המספרים בלי להריץ JS:

     ‏· אינדקס - ‏`deal_settlements_public()`: רק יישובים שמותר לאנדקס
     (‏`settlementIndexable`, אותו כלל כמו הדף וה-sitemap). השאר אינם
     קישור. כשל בשאילתת המודעות משאיר את הרשימה המלאה.
     ‏· יישוב  - ‏`deal_settlement_page(slug)`: כותרת, תיאור, כרטיסים, חציון
       לפי חדרים, עסקאות אחרונות, Dataset ו-BreadcrumbList.

   ## ‏canonical של יישוב נקבע מהכתובת, לא מהמסד

   בדף הסטטי יש canonical אחת - ‏/deals. אילו דף יישוב היה מקבל את שלו רק
   כשהמסד ענה, דקה של Supabase איטי הייתה מאחדת את כל היישובים לאינדקס
   (‏הנימוק של דפי הפירוט, ‏scripts/check_canonical.py). לכן ה-canonical
   וה-og:url מוחלפים **לפני** הקריאה למסד, מה-slug שבכתובת. ‏noindex נכנס
   כשהמסד ענה במפורש שאין יישוב כזה, כשה-slug פסול, או כשהדף אינו לאינדקס
   (פחות מ-5 עסקאות בחלון של הדף, אפס מודעות פעילות בעיר, או עיר מחוץ
   לשוק חי - ‏`settlementIndexable`). timeout אינו noindex. כשל מסד מגיש
   את הדף המלא האחרון ב-200 אם נשמר (‏lib/last-good.ts); 503 רק בלי עותק.

   ## כישלון אינו מוחק את הדף

   ‏timeout או מסד שלא ענה: עותק של דף שמולא יוצא 200. בלי עותק - 503 עם
   ‏Retry-After, בלי noindex ובלי מטמון. ה-HTML של ה-503 יוצא עם ה-canonical
   הנכון ובלי נתונים, ו-`assets/deals.js` (‏אותו `deals-render.js`) ממלא
   אותו מהדפדפן. יישוב שהמסד אמר שאין, או slug פסול - 404 עם noindex,
   גם הוא בלי מטמון, ואינו נשמר כעותק.

   התיעוד: ‎docs/settlement-deals.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/deals-render.js";
import { liveMarketSlugs, settlementIndexable, THIN_DEALS } from "./lib/indexability.ts";
import { lastGoodKey, recall, remember, waitUntilOf } from "./lib/last-good.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type Settlement = {
  name: string;
  slug: string;
  updated_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  deals: number;
  median_price: number | null;
  median_ppsqm: number | null;
  by_rooms: { rooms: number; deals: number; median_price: number | null; median_ppsqm: number | null }[];
  recent: Record<string, unknown>[];
};

export type IndexRow = { name: string; slug: string; deals: number; newest: string | null };

type Deals = {
  renderSettlement: (d: Settlement) => string;
  renderIndex: (list: IndexRow[]) => string;
  title: (d: Settlement) => string;
  description: (d: Settlement) => string;
  jsonLd: (d: Settlement | null, site: string) => string;
};

function deals(): Deals {
  return (globalThis as unknown as { ShukDeals: Deals }).ShukDeals;
}

/* ‏undefined = המסד לא ענה (כשל זמני). null = ענה שאין. */
async function rpc(name: string, body: unknown): Promise<unknown | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/* ‏ok:false = לא ידענו כמה מודעות יש או לאיזה שוק העיר שייכת.
   מערך ריק הוא אפס מודעות, לא כשל. */
async function listingContext(cityName: string): Promise<
  { ok: true; listings: number; marketSlug: string | null } | { ok: false }
> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?status=eq.active&city=eq.${encodeURIComponent(cityName)}&select=city_id&limit=1000`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false };
    const ids = [...new Set(data.map((row) => String((row as { city_id?: unknown }).city_id || "").trim()).filter(Boolean))];
    if (!data.length) return { ok: true, listings: 0, marketSlug: null };
    if (!ids.length) return { ok: true, listings: data.length, marketSlug: null };
    const marketRes = await fetch(
      `${SUPABASE_URL}/rest/v1/market_cities_public?select=market_slug&city_id=in.(${ids.join(",")})&limit=20`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
        },
        signal: ctrl.signal,
      },
    );
    if (!marketRes.ok) return { ok: false };
    const markets = await marketRes.json();
    if (!Array.isArray(markets)) return { ok: false };
    const marketSlug = String((markets[0] as { market_slug?: unknown } | undefined)?.market_slug || "").trim() || null;
    return { ok: true, listings: data.length, marketSlug };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function text(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ‏/deals/afula → "afula". ‏/deals, ‏/deals/ ו-/deals.html → "". */
export function slugOf(pathname: string): string {
  const m = /^\/deals\/([^/]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

/* ‏canonical ו-og:url של דף יישוב - בלי מסד. */
export function withUrl(html: string, slug: string): string {
  const url = `${SITE}/deals/${slug}`;
  return html
    .replace(/(<link rel="canonical" href=")[^"]*(">)/, (_m, a, b) => `${a}${url}${b}`)
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_m, a, b) => `${a}${url}${b}`);
}

function withBody(html: string, body: string, extra = ""): string {
  const box = /<div id="dealsBody"[^>]*>[\s\S]*?<!--\/deals-->/;
  if (!body || !box.test(html)) return html;
  return html.replace(box, () => `<div id="dealsBody" data-ssr="1">\n${body}\n${extra}<!--/deals-->`);
}

function withJsonLd(html: string, ld: string): string {
  return html.replace(/<\/head>/i, () => `<script type="application/ld+json">${ld}</script>\n</head>`);
}

export function injectIndex(html: string, list: IndexRow[]): string {
  const D = deals();
  const out = withBody(html, D.renderIndex(list));
  return out === html ? html : withJsonLd(out, D.jsonLd(null, SITE));
}

export function injectSettlement(html: string, d: Settlement): string {
  const D = deals();
  const t = D.title(d);
  const full = `${t} | שוק נדל״ן`;
  const desc = D.description(d);
  /* ‏הנתונים למיון בדפדפן, בלי שליפה חוזרת. ‏`<` מוברח כמו ב-JSON-LD. */
  const data = `<script type="application/json" id="dealsData">${
    JSON.stringify({ recent: d.recent || [] }).replace(/</g, "\\u003c")
  }</script>\n`;
  let out = withBody(html, D.renderSettlement(d), data);
  if (out === html) return html;
  out = out
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(full)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(full)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(desc)}${b}`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(desc)}${b}`)
    .replace(/(<h1 id="dealsH1">)[\s\S]*?(<\/h1>)/, (_m, a, b) => `${a}${text(t)}${b}`)
    .replace(/(<p id="dealsLead">)[\s\S]*?(<\/p>)/, (_m, a, b) => `${a}${text(desc)}${b}`);
  return withJsonLd(out, D.jsonLd(d, SITE));
}

export function noindex(html: string): string {
  return html.replace(/<\/head>/i, () => `<meta name="robots" content="noindex,follow">\n</head>`);
}

/* עמודים של 1,000 לפי סדר יציב. עמוד מלא אינו הסוף. כשל או עמוד
   שנחתך מחזירים null, כדי לא להחליט על ספירה חלקית. */
async function fetchAll(
  path: string,
  order: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>[] | null> {
  const all: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset <= pageSize * 20; offset += pageSize) {
    const join = path.includes("?") ? "&" : "?";
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${path}${join}order=${order}&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
        },
        signal,
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    all.push(...data as Record<string, unknown>[]);
    if (data.length < pageSize) return all;
  }
  return null;
}

/* מודעות פעילות לפי שם עיר, והשוק. null = לא ידענו.
   אז לא מציגים את הרשימה המלאה: יישוב לא מאומת אינו קישור. */
async function cityListings(): Promise<Map<string, { listings: number; marketSlug: string | null }> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const props = await fetchAll(
      "properties?status=eq.active&select=city,city_id",
      "id.asc",
      ctrl.signal,
    );
    if (!props) return null;
    const markets = await fetchAll(
      "market_cities_public?select=city_id,market_slug",
      "city_id.asc",
      ctrl.signal,
    );
    if (!markets) return null;
    const marketById = new Map<string, string>();
    for (const row of markets) {
      const id = String(row.city_id || "").trim();
      const slug = String(row.market_slug || "").trim();
      if (id && slug) marketById.set(id, slug);
    }
    const byName = new Map<string, { listings: number; marketSlug: string | null }>();
    for (const row of props) {
      const name = String(row.city || "").trim();
      if (!name) continue;
      const cur = byName.get(name) || { listings: 0, marketSlug: null };
      cur.listings += 1;
      const slug = marketById.get(String(row.city_id || "").trim());
      if (slug) cur.marketSlug = slug;
      byName.set(name, cur);
    }
    return byName;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* חלון 12 החודשים של הדף. null = לא ידענו. יישוב כזה אינו מקושר. */
async function windowDeals(slug: string): Promise<number | null> {
  const data = await rpc("deal_settlement_page", { p_slug: slug });
  if (data === undefined) return null;
  if (data === null) return 0;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return Number((data as Settlement).deals || 0);
}

/* ok: הסינון הושלם, ומותר לשמור את הדף. אחרת safe הוא רק מה שאומת,
   בלי לשמור אותו כעותק. */
async function indexableRows(list: IndexRow[]): Promise<
  { ok: true; rows: IndexRow[] } | { ok: false; safe: IndexRow[] }
> {
  const cities = await cityListings();
  if (!cities) return { ok: false, safe: [] };
  const live = liveMarketSlugs();
  const coarse = list.filter((row) => {
    const info = cities.get(String(row.name || "").trim()) || { listings: 0, marketSlug: null };
    return settlementIndexable(Number(row.deals || 0), info.listings, info.marketSlug, live);
  });
  let failed = false;
  const flags = await Promise.all(coarse.map(async (row) => {
    const n = await windowDeals(String(row.slug || ""));
    if (n === null) {
      failed = true;
      return false;
    }
    const info = cities.get(String(row.name || "").trim()) || { listings: 0, marketSlug: null };
    return settlementIndexable(n, info.listings, info.marketSlug, live);
  }));
  const rows = coarse.filter((_, i) => flags[i]);
  return failed ? { ok: false, safe: rows } : { ok: true, rows };
}

/* ‏404 או 503 בלבד. דף שהתמלא - גם דל - אינו עובר כאן. */
function failureHeaders(base: Headers, status: number): Headers {
  const headers = new Headers(base);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  if (status === 503) headers.set("Retry-After", "60");
  return headers;
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;

  const slug = slugOf(new URL(request.url).pathname);
  const html = await res.text();
  let out = html;
  let cache = false;
  let status = res.status;

  try {
    if (!slug) {
      const list = await rpc("deal_settlements_public", {});
      if (Array.isArray(list)) {
        if (list.length) {
          const shown = await indexableRows(list as IndexRow[]);
          if (!shown.ok) {
            const prev = await recall(lastGoodKey(request.url));
            if (prev) return prev;
            if (shown.safe.length) out = injectIndex(html, shown.safe);
            cache = false;
            const headers = failureHeaders(res.headers, 200);
            headers.delete("Retry-After");
            return new Response(out, { status: 200, headers });
          }
          if (shown.rows.length) {
            out = injectIndex(html, shown.rows);
            cache = out !== html;
          }
        }
      } else {
        /* ‏לא מערך: המסד לא ענה. רשימה ריקה היא תשובה תקינה ונשארת 200. */
        status = 503;
      }
    } else if (!SLUG.test(slug)) {
      out = noindex(html);
      status = 404;
    } else {
      out = withUrl(html, slug);
      const data = await rpc("deal_settlement_page", { p_slug: slug });
      if (data === null) {
        out = noindex(out);
        status = 404;
      } else if (data && typeof data === "object" && !Array.isArray(data)) {
        const filled = injectSettlement(out, data as Settlement);
        cache = filled !== out;
        out = filled;
        /* ‏פחות מ-5 עסקאות בחלון של הדף - ידוע בלי שאילתה נוספת.
           מודעות ושוק: רק כשהשאילתה ענתה. כשל שלה אינו noindex. */
        if (cache && Number((data as Settlement).deals || 0) < THIN_DEALS) {
          out = noindex(out);
        } else if (cache) {
          const listed = await listingContext(String((data as Settlement).name || ""));
          if (listed.ok && !settlementIndexable(
            Number((data as Settlement).deals || 0),
            listed.listings,
            listed.marketSlug,
            liveMarketSlugs(),
          )) {
            out = noindex(out);
          }
        }
      } else {
        /* ‏undefined, או תשובה שאינה אובייקט: כשל זמני. בלי noindex. */
        status = 503;
      }
    }
  } catch {
    out = slug && SLUG.test(slug) ? withUrl(html, slug) : html;
    cache = false;
    status = 503;
  }

  if (status === 404 || status === 503) {
    if (status === 503) {
      const prev = await recall(lastGoodKey(request.url));
      if (prev) return prev;
    }
    return new Response(out, { status, headers: failureHeaders(res.headers, status) });
  }

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  /* ‏הסוכן מעדכן לכל היותר פעם ביום. דף שלא מולא אינו נשמר במטמון, כדי
     שכשל רגעי לא יוגש שעה שלמה - וזה גם מה שהופך "טריגר build אחרי
     עדכון" למיותר: אין build, ואחרי שעה הדף משקף את המסד. */
  if (cache) {
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  if (/noindex/i.test(out)) headers.set("X-Robots-Tag", "noindex, follow");
  const response = new Response(out, { status: res.status, headers });
  if (cache) await remember(lastGoodKey(request.url), response, waitUntilOf(context));
  return response;
}

export const config: Config = {
  path: ["/deals", "/deals.html", "/deals/*"],
  /* בלי manual כל בקשה מריצה את הסינון מחדש (כמה שניות). הכותרות
     שלמטה חלות רק כשהמטמון ידני. התשובה אינה תלויה בעוגיית שוק. */
  cache: "manual",
};
