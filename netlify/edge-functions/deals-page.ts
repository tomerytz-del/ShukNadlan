/* ============================================================================
   עסקאות נדל"ן לפי יישוב - ‏/deals ו-/deals/{slug}
   ----------------------------------------------------------------------------
   ‏`deals.html` הוא דף סטטי אחד שמוגש בשתי צורות: האינדקס (‏/deals) ודף
   לכל יישוב (‏/deals/afula, דרך שורת ‎200‎ ב-`_redirects`). הפונקציה ממלאת
   אותו בשרת, כדי שסורק יקרא את המספרים בלי להריץ JS:

     ‏· אינדקס - ‏`deal_settlements_public()`: רשימת היישובים.
     ‏· יישוב  - ‏`deal_settlement_page(slug)`: כותרת, תיאור, כרטיסים, חציון
       לפי חדרים, עסקאות אחרונות, Dataset ו-BreadcrumbList.

   ## ‏canonical של יישוב נקבע מהכתובת, לא מהמסד

   בדף הסטטי יש canonical אחת - ‏/deals. אילו דף יישוב היה מקבל את שלו רק
   כשהמסד ענה, דקה של Supabase איטי הייתה מאחדת את כל היישובים לאינדקס
   (‏הנימוק של דפי הפירוט, ‏scripts/check_canonical.py). לכן ה-canonical
   וה-og:url מוחלפים **לפני** הקריאה למסד, מה-slug שבכתובת. ‏noindex נכנס
   רק כשהמסד ענה במפורש שאין יישוב כזה.

   ## כישלון אינו שובר דף

   ‏timeout או מסד שלא ענה - הדף יוצא עם ה-canonical הנכון ובלי נתונים, ו-
   `assets/deals.js` (‏אותו `deals-render.js`) ממלא אותו מהדפדפן.

   התיעוד: ‎docs/settlement-deals.md‎.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/deals-render.js";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const THIN_DEALS = 5;

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

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;

  const slug = slugOf(new URL(request.url).pathname);
  const html = await res.text();
  let out = html;
  let cache = false;

  try {
    if (!slug) {
      const list = await rpc("deal_settlements_public", {});
      if (Array.isArray(list) && list.length) {
        out = injectIndex(html, list as IndexRow[]);
        cache = out !== html;
      }
    } else if (!SLUG.test(slug)) {
      out = noindex(html);
    } else {
      out = withUrl(html, slug);
      const data = await rpc("deal_settlement_page", { p_slug: slug });
      if (data === null) {
        out = noindex(out);
      } else if (data && typeof data === "object") {
        const filled = injectSettlement(out, data as Settlement);
        cache = filled !== out;
        out = filled;
        /* ‏כל עיר בשוק ברשימה (‏20270330090000), ורובן כפרים קטנים. דף עם
           פחות מ-THIN_DEALS עסקאות הוא תוכן דל בעיני גוגל - הוא נשאר
           לגולש/ת, אבל לא לאינדקס, וגם אינו ב-sitemap ובאינדקס /deals. */
        if (cache && Number((data as Settlement).deals || 0) < THIN_DEALS) out = noindex(out);
      }
    }
  } catch {
    out = slug && SLUG.test(slug) ? withUrl(html, slug) : html;
    cache = false;
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
  return new Response(out, { status: res.status, headers });
}

export const config: Config = {
  path: ["/deals", "/deals.html", "/deals/*"],
};
