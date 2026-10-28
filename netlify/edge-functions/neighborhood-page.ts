/* ============================================================================
   דף שכונה - ‏/n/{עיר}/{שכונה}
   ----------------------------------------------------------------------------
   ‏`neighborhood.html` הוא דף סטטי אחד שמוגש לכל שכונה (שורת ‎200‎ ב-
   `_redirects`). הפונקציה ממלאת אותו בשרת מ-`neighborhood_page(city, slug)`,
   כדי שסורק ומנועי AI יקראו את התוכן בלי להריץ JS - בדיוק כמו
   `deals-page.ts`, שממנו היא מועתקת.

   ‏**canonical מהכתובת, לא מהמסד:** היא נכנסת לפני הקריאה למסד, ולכן דקה של
   Supabase איטי אינה מאחדת שכונות. ‏noindex - כשהמסד ענה במפורש שאין
   שכונה כזו, כשהכתובת אינה תקינה, או כשהדף אינו לאינדקס
   (‏`neighborhoodIndexable`: אפס מודעות פעילות, או עיר מחוץ לשוק חי).
   timeout, שגיאת HTTP או תשובה שאינה אובייקט: עותק של דף שמולא יוצא
   200 (‏lib/last-good.ts). בלי עותק הם 503 בלי noindex ובלי מטמון:
   גוגל חוזרת, ודף ריק אינו נשמר כאילו הוא הדף.

   התיעוד: ‎docs/neighborhood-pages.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/neighborhood-render.js";
import { liveMarketSlugs, neighborhoodIndexable } from "./lib/indexability.ts";
import { lastGoodKey, recall, remember, waitUntilOf } from "./lib/last-good.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;
const CITY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HOOD = /^[0-9a-z֐-׿]+(-[0-9a-z֐-׿]+)*$/;
export type Hood = {
  name: string;
  slug: string;
  city: string;
  city_slug: string;
  props_active: number;
  deals: number;
  [k: string]: unknown;
};

type Render = {
  render: (d: Hood) => string;
  title: (d: Hood) => string;
  description: (d: Hood) => string;
  jsonLd: (d: Hood, site: string) => string;
  path: (city: string, slug: string) => string;
  lcpHref?: (d: Hood) => string;
  lcpPreload?: (d: Hood) => string;
  ogImage?: (d: Hood) => string;
  heading?: (d: Hood) => string;
};

function hood(): Render {
  return (globalThis as unknown as { ShukHood: Render }).ShukHood;
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

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function text(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ‏/n/afula/%D7%92%D7%91... → ["afula", "גב..."]; כל צורה אחרת → null */
export function partsOf(pathname: string): [string, string] | null {
  const m = /^\/n\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    const city = decodeURIComponent(m[1]).toLowerCase();
    const slug = decodeURIComponent(m[2]).toLowerCase();
    return CITY.test(city) && HOOD.test(slug) ? [city, slug] : null;
  } catch {
    return null;
  }
}

/* ‏canonical ו-og:url מהכתובת - בלי מסד */
export function withUrl(html: string, city: string, slug: string): string {
  const url = SITE + hood().path(city, slug);
  return html
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(url)}${b}`)
    .replace(/<\/head>/i, () => `<link rel="canonical" href="${attr(url)}">\n</head>`);
}

export function noindex(html: string): string {
  return html.replace(/<\/head>/i, () => `<meta name="robots" content="noindex,follow">\n</head>`);
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

export function inject(html: string, d: Hood): string {
  const H = hood();
  const box = /<div id="dealsBody"[^>]*>[\s\S]*?<!--\/deals-->/;
  if (!box.test(html)) return html;
  const t = H.title(d);
  const full = `${t} | שוק נדל״ן`;
  const desc = H.description(d);
  /* ‏ה-H1 יושב על תמונת השער, בתוך הרינדור. בלי זה נשארת גם הכותרת של המעטפת. */
  const preload = H.lcpPreload ? H.lcpPreload(d) : "";
  const og = H.ogImage ? H.ogImage(d) : "";
  let out = html
    .replace(box, () => `<div id="dealsBody" data-ssr="1">\n${H.render(d)}\n<!--/deals-->`)
    .replace(/<section class="page-head">[\s\S]*?<\/section>\s*/, "")
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(full)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(full)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(desc)}${b}`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(desc)}${b}`);
  if (og) {
    out = out.replace(/(<meta property="og:image" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(og)}${b}`);
  }
  return out.replace(/<\/head>/i, () => `${preload}<script type="application/ld+json">${H.jsonLd(d, SITE)}</script>\n</head>`);
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;

  const parts = partsOf(new URL(request.url).pathname);
  const html = await res.text();
  let out = html;
  let cache = false;
  let status = res.status;

  try {
    if (!parts) {
      out = noindex(html);
      status = 404;
    } else {
      out = withUrl(html, parts[0], parts[1]);
      const data = await rpc("neighborhood_page", { p_city: parts[0], p_slug: parts[1] });
      if (data === null) {
        out = noindex(out);
        status = 404;
      } else if (data && typeof data === "object" && !Array.isArray(data)) {
        const d = data as Hood;
        const filled = inject(out, d);
        cache = filled !== out;
        out = filled;
        /* ‏אותו כלל כמו ה-sitemap (‏lib/indexability.ts). הדף נשאר 200. */
        if (cache && !neighborhoodIndexable(Number(d.props_active || 0), String(d.market_slug || ""), liveMarketSlugs())) {
          out = noindex(out);
        }
      } else {
        /* ‏undefined, או תשובה שאינה אובייקט: כשל זמני. בלי noindex. */
        status = 503;
      }
    }
  } catch {
    out = parts ? withUrl(html, parts[0], parts[1]) : html;
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
  path: ["/n/*", "/neighborhood", "/neighborhood.html"],
};
