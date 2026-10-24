/* ============================================================================
   דפי נחיתה עיר → סוג נכס - /afula/בתים-פרטיים וחבריו
   ----------------------------------------------------------------------------
   silo.html הוא דף סטטי אחד. _redirects מגיש אותו תחת שלוש כתובות, והפונקציה
   ממלאת אותו בשרת ממודעות פעילות (status=active) - אותו דפוס של
   neighborhood-page.ts.

   canonical מהכתובת, לפני הקריאה למסד. כשל מסד (timeout, !ok, זריקה, גוף
   שאינו מערך) הוא 503 בלי noindex, עם Retry-After ושתי כותרות no-store.
   noindex רק כשהמסד ענה והרשימה ריקה באמת: מערך ריק אינו כשל.

   כתובות הסינון הישנות (?deal=sale&rooms=3 וסוג הנכס) מצביעות לכאן
   מ-search-pages.ts. docs/search-landing-pages.md.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/silo-render.js";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;

type Page = {
  slug: string;
  path: string;
  h1: string;
  description: string;
  intro: string;
  property_type: string | null;
  rooms: number | null;
};

type Row = Record<string, unknown>;

type Silo = {
  pageOf: (pathname: string) => Page | null;
  queryOf: (page: Page) => string;
  render: (page: Page, rows: Row[]) => string;
  scripts: (page: Page, rows: Row[], site: string) => string;
  fullTitle: (page: Page) => string;
};

function silo(): Silo {
  return (globalThis as unknown as { ShukSilo: Silo }).ShukSilo;
}

/* undefined = המסד לא ענה. מערך (גם ריק) = ענה. */
async function listings(page: Page): Promise<Row[] | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/properties?${silo().queryOf(page)}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return Array.isArray(data) ? data as Row[] : undefined;
  } catch {
    return undefined;
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

export function pageOf(pathname: string): Page | null {
  return silo().pageOf(pathname);
}

/* canonical ו-og:url מהכתובת - בלי מסד */
export function withUrl(html: string, page: Page): string {
  const url = SITE + page.path;
  return html
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(url)}${b}`)
    .replace(/<link\b[^>]*\brel="canonical"[^>]*>\s*/gi, "")
    .replace(/<\/head>/i, () => `<link rel="canonical" href="${attr(url)}">\n</head>`);
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

export function inject(html: string, page: Page, rows: Row[]): string {
  const S = silo();
  const box = /<div id="siloBody"[^>]*>[\s\S]*?<!--\/silo-->/;
  if (!box.test(html)) return html;
  const full = S.fullTitle(page);
  const body = S.render(page, rows);
  const preloadMatch = body.match(/<img[^>]*fetchpriority="high"[^>]*>/);
  const src = preloadMatch ? (preloadMatch[0].match(/\bsrc="([^"]+)"/) || [])[1] : "";
  const preload = src ? `<link rel="preload" as="image" href="${src}" fetchpriority="high">\n` : "";
  return html
    .replace(box, () => `<div id="siloBody" data-ssr="1">\n${body}\n<!--/silo-->`)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(full)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(full)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(page.description)}${b}`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(page.description)}${b}`)
    .replace(/(<h1 id="siloH1">)[\s\S]*?(<\/h1>)/, (_m, a, b) => `${a}${text(page.h1)}${b}`)
    .replace(/(<p id="siloLead">)[\s\S]*?(<\/p>)/, (_m, a, b) => `${a}${text(page.description)}${b}`)
    .replace(/<\/head>/i, () => `${preload}${S.scripts(page, rows, SITE)}\n</head>`);
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const pathname = new URL(request.url).pathname;
  const page = pageOf(pathname);
  /* ‏נתיב עברי ב-config.path וב-_redirects לא נתפס ב-Netlify: הבקשה
     המקודדת חזרה 404 של הפלטפורמה, בלי שהפונקציה רצה. ‏`/afula/*` כן
     נתפס, כמו `/n/*`. נתיב שאינו אחד משלנו חוזר כמו שהוא, כדי שדף אחר
     תחת אותה קידומת (מתווכים) לא ייעצר כאן ב-404. */
  if (!page) {
    let path = pathname;
    try { path = decodeURIComponent(path); } catch { /* נשאר כמו שהוא */ }
    if (path.startsWith("/afula/")) return res;
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  const html = await res.text();
  let out = html;
  let cache = false;
  let status = res.status;
  let empty = false;

  try {
    if (!page) {
      out = noindex(html);
      status = 404;
    } else {
      out = withUrl(html, page);
      const rows = await listings(page);
      if (!rows) {
        status = 503;
      } else if (rows.length === 0) {
        /* מערך ריק הוא תשובה: אין מודעות. noindex, לא 503. */
        out = noindex(inject(out, page, rows));
        empty = true;
        status = 200;
      } else {
        const filled = inject(out, page, rows);
        cache = filled !== out;
        out = filled;
      }
    }
  } catch {
    out = page ? withUrl(html, page) : html;
    cache = false;
    status = 503;
    empty = false;
  }

  if (status === 404 || status === 503 || empty) {
    return new Response(out, { status, headers: failureHeaders(res.headers, status) });
  }

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  if (cache) {
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return new Response(out, { status: res.status, headers });
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
  ],
};
