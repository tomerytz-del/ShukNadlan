/* ============================================================================
   דפי נחיתה עיר → סוג נכס - /afula/בתים-פרטיים וחבריו
   ----------------------------------------------------------------------------
   silo.html הוא דף סטטי אחד. _redirects מגיש אותו תחת שלוש כתובות, והפונקציה
   ממלאת אותו בשרת ממודעות פעילות (status=active) - אותו דפוס של
   neighborhood-page.ts.

   canonical מהכתובת, לפני הקריאה למסד. כשל מסד (timeout, !ok, זריקה, גוף
   שאינו מערך) מגיש את הדף המלא האחרון ב-200 אם נשמר (lib/last-good.ts).
   בלי עותק הוא 503 בלי noindex, עם Retry-After ושתי כותרות no-store.
   noindex רק כשהמסד ענה והרשימה ריקה באמת: מערך ריק אינו כשל.

   כתובות הסינון הישנות (?deal=sale&rooms=3 וסוג הנכס) מצביעות לכאן
   מ-search-pages.ts. docs/search-landing-pages.md.

   כמה ערים, קידומת לכל אחת (‏/afula, ‏/haifa - CITIES ב-silo-render.js).
   דף של שוק שאינו live ב-assets/markets.js יוצא מלא, עם noindex
   (‏landingIndexable), עד שהשוק נדלק.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/silo-render.js";
import { landingIndexable, liveMarketSlugs } from "./lib/indexability.ts";
import { lastGoodKey, recall, remember, waitUntilOf } from "./lib/last-good.ts";
import { marketHint } from "./lib/markets.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;
const EXTRA_TIMEOUT_MS = 1500;

type Page = {
  slug: string;
  path: string;
  h1: string;
  benefit?: string;
  description: string;
  intro: string;
  property_type: string | null;
  rooms: number | null;
  city: string;
  cityName: string;
  cityId: string;
  market: string;
};

type City = { slug: string; name: string; home: string };

type Row = Record<string, unknown>;

type Extras = {
  total?: number;
  counted?: boolean;
  hoods?: Row[] | null;
  related?: Row[];
  agencies?: Row[];
};

type ListingResult = { rows: Row[]; total: number; counted: boolean };

type Silo = {
  pages: Page[];
  cities: City[];
  cityOf: (page: Page) => City;
  pageOf: (pathname: string) => Page | null;
  queryOf: (page: Page) => string;
  hoodCountQuery: (page: Page) => string;
  hoodRowsFromListings: (rows: Row[], page: Page) => Row[];
  render: (page: Page, rows: Row[], extras?: Extras) => string;
  heroHtml: (page: Page) => string;
  heroPreload: (page: Page) => string;
  heroOg: (page: Page) => { src: string; width: number; height: number };
  chipsHtml: (page: Page, rows: Row[], extras?: Extras) => string;
  updatedHtml: (rows: Row[]) => string;
  allHref: (page: Page) => string;
  scripts: (page: Page, rows: Row[], site: string) => string;
  fullTitle: (page: Page) => string;
};

function silo(): Silo {
  return (globalThis as unknown as { ShukSilo: Silo }).ShukSilo;
}

function authHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
  };
}

/* undefined = המסד לא ענה. אובייקט (גם עם מערך ריק) = ענה. */
async function listings(page: Page): Promise<ListingResult | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/properties?${silo().queryOf(page)}`, {
      headers: { ...authHeaders(), Prefer: "count=exact" },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (!Array.isArray(data)) return undefined;
    const rows = data as Row[];
    const range = res.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)\s*$/);
    return {
      rows,
      total: match ? Number(match[1]) : rows.length,
      counted: !!match,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function optionalJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXTRA_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/* משני לרשימה: כישלון כאן לא הופך את הדף ל-503. */
async function extrasFor(page: Page, got: ListingResult): Promise<Extras> {
  const extras: Extras = { total: got.total, counted: got.counted, hoods: null, related: [], agencies: [] };
  const S = silo();
  const tasks: Promise<void>[] = [];
  tasks.push((async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EXTRA_TIMEOUT_MS);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/properties?${S.hoodCountQuery(page)}`, {
        headers: { ...authHeaders(), Prefer: "count=exact" },
        signal: ctrl.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const match = (res.headers.get("content-range") || "").match(/\/(\d+)\s*$/);
      if (match && data.length !== Number(match[1])) return;
      extras.hoods = S.hoodRowsFromListings(data as Row[], page);
    } catch {
      /* הספירה משנית */
    } finally {
      clearTimeout(timer);
    }
  })());
  /* ‏עמוד של כמה יישובים (עמק) אין לו city_id. שאילתה עם eq.null
     אינה "אין משרדים" אלא מסנן שגוי, ולכן לא שולחים אותה. */
  if (page.cityId) {
    tasks.push(optionalJson(
      `${SUPABASE_URL}/rest/v1/agencies?select=id,slug,name,logo_url&city_id=eq.${page.cityId}&order=name.asc&limit=48`,
    ).then((data) => {
      if (Array.isArray(data)) extras.agencies = data as Row[];
    }));
  }
  if (got.rows.length < 3) {
    const others = S.pages.filter((p) => p.city === page.city && p.path !== page.path);
    tasks.push(Promise.all(others.map((p) => listings(p))).then((lists) => {
      const rel: Row[] = [];
      for (const list of lists) {
        if (!list) continue;
        for (const row of list.rows) rel.push(row);
      }
      extras.related = rel;
    }));
  }
  await Promise.all(tasks);
  return extras;
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function text(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function pageOf(pathname: string): Page | null {
  return silo().pageOf(pathname);
}

/* ‏עפולה נשארת עם הנתיב הגלוי, כמו שהיה. עמוד collection (עמק, נוף
   הגליל) משתמש בנתיב המקודד, כי זה ה-url שב-JSON-LD. */
function pageUrl(page: Page): string {
  const path = (page as Page & { collection?: boolean }).collection
    ? page.path.split("/").map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/")
    : page.path;
  return SITE + path;
}

/* canonical ו-og:url מהכתובת - בלי מסד */
export function withUrl(html: string, page: Page): string {
  const url = pageUrl(page);
  return html
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(url)}${b}`)
    .replace(/<link\b[^>]*\brel="canonical"[^>]*>\s*/gi, "")
    .replace(/<\/head>/i, () => `<link rel="canonical" href="${attr(url)}">\n</head>`);
}

/* ‏הקידומות של כל הערים (‏/afula/, ‏/haifa/), מ-CITIES. */
export function underCity(pathname: string): boolean {
  let path = pathname;
  try { path = decodeURIComponent(path); } catch { /* נשאר כמו שהוא */ }
  return silo().cities.some((c) => path.startsWith(`/${c.slug}/`));
}

export function noindex(html: string): string {
  if (/<meta\b[^>]*\bname="robots"[^>]*noindex/i.test(html)) return html;
  return html.replace(/<\/head>/i, () => `<meta name="robots" content="noindex,follow">\n</head>`);
}

function failureHeaders(base: Headers, status: number): Headers {
  const headers = new Headers(base);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  if (status === 503) headers.set("Retry-After", "60");
  return headers;
}

export function inject(html: string, page: Page, rows: Row[], extras: Extras = {}): string {
  const S = silo();
  const box = /<div id="siloBody"[^>]*>[\s\S]*?<!--\/silo-->/;
  if (!box.test(html)) return html;
  const full = S.fullTitle(page);
  const city = S.cityOf(page);
  const body = S.render(page, rows, extras);
  const hero = S.heroHtml(page);
  const og = S.heroOg(page);
  /* מחליפים את ה-preload של העמק שבמעטפת, כדי שהדפדפן לא ימשוך גם אותו. */
  const preload = S.heroPreload(page);
  const benefit = page.benefit || page.description;
  const count = extras.counted && Number(extras.total) > 0
    ? String(extras.total)
    : (rows.length > 0 && rows.length < 24 ? String(rows.length) : "0");
  return html
    .replace(box, () => `<div id="siloBody" data-ssr="1">\n${body}\n<!--/silo-->`)
    .replace("<!--/hero-->", () => hero)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(full)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(full)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(page.description)}${b}`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(page.description)}${b}`)
    .replace(/(<h1 id="siloH1">)[\s\S]*?(<\/h1>)/, (_m, a, b) => `${a}${text(page.h1)}${b}`)
    .replace(/(<p class="land-benefit" id="siloBenefit">)[\s\S]*?(<\/p>)/, (_m, a, b) => `${a}${text(benefit)}${b}`)
    .replace(/(<a\b[^>]*\bid="landCityCrumb"[^>]*)(>)[\s\S]*?(<\/a>)/, (_m, open, gt, close) =>
      `${String(open).replace(/\bhref="[^"]*"/, `href="${attr(city.home)}"`)}${gt}${text(city.name)}${close}`)
    .replace(/(<span id="siloCrumb">)[\s\S]*?(<\/span>)/, (_m, a, b) => `${a}${text(page.h1)}${b}`)
    .replace(/<div id="landChips">[\s\S]*?<\/div>/, () => `<div id="landChips">${S.chipsHtml(page, rows, extras)}</div>`)
    .replace(/<p class="land-updated" id="landUpdated">[\s\S]*?<\/p>/, () => `<p class="land-updated" id="landUpdated">${S.updatedHtml(rows)}</p>`)
    .replace(/(<a\b[^>]*\bid="landAll"[^>]*)(>)/, (_m, open, end) => {
      let next = String(open).replace(/\bhref="[^"]*"/, `href="${attr(S.allHref(page))}"`);
      next = next.replace(/\bdata-count="[^"]*"/, `data-count="${count}"`);
      return next + end;
    })
    .replace(/<link rel="preload" as="image" href="assets\/hero-[^"]+"[^>]*>\s*/g, "")
    .replace(/(<meta property="og:image" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(SITE + "/" + og.src)}${b}`)
    .replace(/(<meta property="og:image:width" content=")[^"]*(">)/, (_m, a, b) => `${a}${og.width}${b}`)
    .replace(/(<meta property="og:image:height" content=")[^"]*(">)/, (_m, a, b) => `${a}${og.height}${b}`)
    .replace(/<\/head>/i, () => `${preload}\n${marketHint(city.home, page.market)}${S.scripts(page, rows, SITE)}\n</head>`);
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const pathname = new URL(request.url).pathname;
  const page = pageOf(pathname);
  /* ‏נתיב עברי ב-config.path וב-_redirects לא נתפס ב-Netlify: הבקשה
     המקודדת חזרה 404 של הפלטפורמה, בלי שהפונקציה רצה. ‏`/afula/*` כן
     נתפס, כמו `/n/*`. נתיב שאינו אחד משלנו חוזר כמו שהוא, כדי שדף אחר
     תחת אותה קידומת (מתווכים) לא ייעצר כאן ב-404. */
  if (!page && underCity(pathname)) return res;
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  const html = await res.text();
  let out = html;
  let cache = false;
  let status = res.status;
  let empty = false;
  let hidden = false;

  try {
    if (!page) {
      out = noindex(html);
      status = 404;
    } else {
      out = withUrl(html, page);
      const got = await listings(page);
      if (!got) {
        status = 503;
      } else {
        const extras = await extrasFor(page, got);
        if (got.rows.length === 0) {
          /* מערך ריק הוא תשובה: אין מודעות. noindex, לא 503. */
          out = noindex(inject(out, page, got.rows, extras));
          empty = true;
          status = 200;
        } else {
          const filled = inject(out, page, got.rows, extras);
          cache = filled !== out;
          out = filled;
          /* ‏שוק שעוד לא נדלק: הדף מלא לגולש/ת, ומחוץ לאינדקס. */
          if (!landingIndexable(page.market, liveMarketSlugs())) {
            out = noindex(out);
            hidden = true;
          }
        }
      }
    }
  } catch {
    out = page ? withUrl(html, page) : html;
    cache = false;
    status = 503;
    empty = false;
  }

  if (status === 404 || status === 503 || empty) {
    if (status === 503) {
      const prev = await recall(lastGoodKey(request.url));
      if (prev) return prev;
    }
    const failed = failureHeaders(res.headers, status);
    if (empty) failed.set("X-Robots-Tag", "noindex, follow");
    return new Response(out, { status, headers: failed });
  }

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  if (hidden) headers.set("X-Robots-Tag", "noindex, follow");
  if (cache) {
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  const response = new Response(out, { status: res.status, headers });
  if (cache) await remember(lastGoodKey(request.url), response, waitUntilOf(context));
  return response;
}

export const config: Config = {
  path: [
    "/afula/*",
    "/silo",
    "/silo.html",
    "/afula/בתים-פרטיים",
    "/afula/דירות-גן",
    "/afula/דירות-3-חדרים",
    "/afula/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D",
    "/afula/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%92%D7%9F",
    "/afula/%D7%93%D7%99%D7%A8%D7%95%D7%AA-3-%D7%97%D7%93%D7%A8%D7%99%D7%9D",
    "/haifa/*",
    "/haifa/בתים-פרטיים",
    "/haifa/דירות-גן",
    "/haifa/דירות-3-חדרים",
    "/haifa/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D",
    "/haifa/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%92%D7%9F",
    "/haifa/%D7%93%D7%99%D7%A8%D7%95%D7%AA-3-%D7%97%D7%93%D7%A8%D7%99%D7%9D",
    "/kiryat-ata/*",
    "/kiryat-ata/בתים-פרטיים",
    "/kiryat-ata/דירות-גן",
    "/kiryat-ata/דירות-3-חדרים",
    "/kiryat-ata/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D",
    "/kiryat-ata/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%92%D7%9F",
    "/kiryat-ata/%D7%93%D7%99%D7%A8%D7%95%D7%AA-3-%D7%97%D7%93%D7%A8%D7%99%D7%9D",
    "/kiryat-bialik/*",
    "/kiryat-bialik/בתים-פרטיים",
    "/kiryat-bialik/דירות-גן",
    "/kiryat-bialik/דירות-3-חדרים",
    "/kiryat-bialik/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D",
    "/kiryat-bialik/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%92%D7%9F",
    "/kiryat-bialik/%D7%93%D7%99%D7%A8%D7%95%D7%AA-3-%D7%97%D7%93%D7%A8%D7%99%D7%9D",
    "/kiryat-motzkin/*",
    "/kiryat-motzkin/בתים-פרטיים",
    "/kiryat-motzkin/דירות-גן",
    "/kiryat-motzkin/דירות-3-חדרים",
    "/kiryat-motzkin/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D",
    "/kiryat-motzkin/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%92%D7%9F",
    "/kiryat-motzkin/%D7%93%D7%99%D7%A8%D7%95%D7%AA-3-%D7%97%D7%93%D7%A8%D7%99%D7%9D",
    "/kiryat-yam/*",
    "/kiryat-yam/בתים-פרטיים",
    "/kiryat-yam/דירות-גן",
    "/kiryat-yam/דירות-3-חדרים",
    "/kiryat-yam/%D7%91%D7%AA%D7%99%D7%9D-%D7%A4%D7%A8%D7%98%D7%99%D7%99%D7%9D",
    "/kiryat-yam/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%92%D7%9F",
    "/kiryat-yam/%D7%93%D7%99%D7%A8%D7%95%D7%AA-3-%D7%97%D7%93%D7%A8%D7%99%D7%9D",
    "/nof-hagalil/*",
    "/nof-hagalil/דירות-למכירה",
    "/nof-hagalil/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%9C%D7%9E%D7%9B%D7%99%D7%A8%D7%94",
    "/migdal-haemek/*",
    "/migdal-haemek/דירות-למכירה",
    "/migdal-haemek/%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%9C%D7%9E%D7%9B%D7%99%D7%A8%D7%94",
    "/emek-yizrael/*",
    "/emek-yizrael/בתים-ומגרשים",
    "/emek-yizrael/%D7%91%D7%AA%D7%99%D7%9D-%D7%95%D7%9E%D7%92%D7%A8%D7%A9%D7%99%D7%9D",
  ],
};
