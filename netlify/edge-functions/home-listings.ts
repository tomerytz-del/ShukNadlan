/* ============================================================================
   דף הבית: כ-12 נכסים פעילים אחרונים ב-HTML הראשון, ו-ItemList
   ----------------------------------------------------------------------------
   הסורק שקורא את / בלי JS ראה אפס קישורים לנכס. הרשימה גלויה בציור
   הראשון, בגובה השמור של המדף, ו-prop-shelf.js מחליף אותה במקום.

   שאילתה אחת (עפולה ויישובי העמק), במקביל ל-HTML של הדף, עם timeout
   קצר. fetch עם cache: "manual" כדי ש-Netlify-CDN-Cache-Control יחול
   על התשובה. כשל או timeout: הדף כמו שהוא, בלי מטמון ובלי noindex.

   רק / בלי פרמטרי חיפוש. ?deal=sale וחבריו הם עמודי תוצאות.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { HOME_VARY, setHomeCache, withHomeVary } from "./lib/page-cache.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 800;
const LIMIT = 12;

/* עפולה, ואז יישובי afula-emek מ-assets/silo-render.js (עמק יזרעאל).
   שאילתה אחת, בלי סבב נפרד אל market_cities_public. */
const CITIES = [
  "עפולה",
  "אביטל", "אדירים", "אומן", "אחוזת ברק", "בית השיטה", "בלפוריה", "ברק", "גבע", "גבת", "גדיש", "גדעונה", "גזית", "גיניגר", "גן נר", "דבורה", "דברת", "היוגב", "חבר", "יזרעאל", "יעל", "יפעת", "כפר ברוך", "כפר גדעון", "כפר יחזקאל", "כפר תבור", "מבואות הגלבוע", "מגן שאול", "מולדת", "מזרע", "מיטב", "מיטל", "מלאה", "מרחביה (מושב)", "מרחביה (קיבוץ)", "נהלל", "נורית", "ניר יפה", "עין דור", "עין חרוד (איחוד)", "עין חרוד (מאוחד)", "פרזון", "רם-און", "רמת דוד", "רמת צבי", "שריד", "תל יוסף", "תל עדשים",
];

const NOT_CONTENT = new Set([
  "src", "fbclid", "gclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "msclkid", "ref",
  "region", "beta",
]);

type Row = { id?: unknown; title?: unknown; price?: unknown; deal_type?: unknown };

function isHome(url: URL): boolean {
  const page = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  return page === "/" || page === "/index";
}

function hasContent(params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (!raw.trim()) continue;
    if (key.startsWith("utm_") || NOT_CONTENT.has(key)) continue;
    return true;
  }
  return false;
}

function authHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
  };
}

function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
}

function money(price: unknown, deal: unknown): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "לפי בקשה";
  const num = Math.round(n).toLocaleString("he-IL");
  return deal === "rent" ? `₪${num} לחודש` : `₪${num}`;
}

function linkText(row: Row): string {
  const title = String(row.title || "נכס").replace(/\s+/g, " ").trim() || "נכס";
  return `${title} · ${money(row.price, row.deal_type)}`;
}

function cityFilter(): string {
  const parts = CITIES.map((name) => `"${encodeURIComponent(name)}"`);
  return `city=in.(${parts.join(",")})`;
}

async function latest(signal: AbortSignal): Promise<Row[] | undefined> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/properties?select=id,title,price,deal_type&status=eq.active&${cityFilter()}&order=is_promoted.desc,created_at.desc&limit=${LIMIT}`,
    { headers: authHeaders(), signal, cache: "manual" },
  );
  if (!res.ok) return undefined;
  const data = await res.json();
  if (!Array.isArray(data)) return undefined;
  return data as Row[];
}

function linksHtml(rows: Row[]): string {
  const items = rows.filter((row) => String(row.id || "").trim() && String(row.title || "").trim()).slice(0, LIMIT);
  if (!items.length) return "";
  const anchors = items.map((row) => {
    const id = encodeURIComponent(String(row.id));
    const price = money(row.price, row.deal_type);
    const title = String(row.title).replace(/\s+/g, " ").trim();
    return `<a href="/property?id=${id}"><span class="home-ssr-title">${esc(title)}</span> <span class="home-ssr-price">${esc(price)}</span></a>`;
  });
  return `<nav class="home-ssr" aria-label="נכסים אחרונים">${anchors.join("")}</nav>`;
}

function itemList(rows: Row[]): string {
  const items = rows.filter((row) => String(row.id || "").trim() && String(row.title || "").trim()).slice(0, LIMIT);
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "נכסים אחרונים בעפולה והעמק",
    numberOfItems: items.length,
    itemListElement: items.map((row, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/property?id=${encodeURIComponent(String(row.id))}`,
      name: linkText(row),
    })),
  };
  return JSON.stringify(list).replace(/</g, "\\u003c");
}

function inject(html: string, rows: Row[]): string | null {
  const nav = linksHtml(rows);
  if (!nav) return null;
  const box = /(<section\b[^>]*\bid="allProps"[^>]*)(>\s*)(<\/section>)/i;
  if (!box.test(html)) return null;
  let out = html.replace(box, (_m, open, mid, close) => {
    let tag = String(open).replace(/\s+hidden\b/, "");
    if (!/data-ssr=/.test(tag)) tag += ' data-ssr="1"';
    return `${tag}${mid}${nav}${close}`;
  });
  if (!out.includes('"@type":"ItemList"') && !out.includes('"@type": "ItemList"')) {
    const json = itemList(rows);
    out = out.replace(/<\/head>/i, () => `<script type="application/ld+json">${json}</script>\n</head>`);
  }
  return out;
}

function cacheHeaders(headers: Headers): void {
  /* s-maxage לשעה. stale-while-revalidate קצר, כדי שמודעה שנמכרה
     לא תישאר ב-CDN עד יממה. Netlify-Vary זהה ל-search-pages. */
  setHomeCache(headers);
}

export default async function handler(request: Request, context: Context) {
  if (request.method !== "GET" && request.method !== "HEAD") return withHomeVary(await context.next());
  let url: URL;
  try { url = new URL(request.url); } catch { return withHomeVary(await context.next()); }
  if (!isHome(url) || hasContent(url.searchParams)) return withHomeVary(await context.next());

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const rowsP = latest(ctrl.signal).catch(() => undefined);
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html") || (res.status >= 300 && res.status < 400)) {
    ctrl.abort();
    clearTimeout(timer);
    return withHomeVary(res);
  }

  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("Netlify-Vary", HOME_VARY);
  /* כשל או רשימה ריקה: לא לרשת מטמון ארוך של הדף הסטטי. */
  const passthrough = () => {
    headers.set("Netlify-CDN-Cache-Control", "no-store");
    headers.set("Netlify-Vary", HOME_VARY);
    return new Response(html, { status: res.status, headers });
  };

  try {
    const rows = await rowsP;
    if (!rows) return passthrough();
    const out = inject(html, rows);
    if (!out) return passthrough();
    cacheHeaders(headers);
    return new Response(out, { status: res.status, headers });
  } finally {
    clearTimeout(timer);
  }
}

/* cache: "manual" הוא מה שגורם ל-Netlify-CDN-Cache-Control לחול.
   בלי זה כל בקשה ל-/ מריצה את הפונקציה מחדש. */
export const config: Config = { cache: "manual", path: ["/", "/index.html"] };
