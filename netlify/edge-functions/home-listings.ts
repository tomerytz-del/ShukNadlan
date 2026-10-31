/* ============================================================================
   דף הבית: כ-12 נכסים פעילים אחרונים ב-HTML הראשון, ו-ItemList
   ----------------------------------------------------------------------------
   הסורק שקורא את / בלי JS ראה אפס קישורים לנכס. המדף נבנה אחר כך
   ב-prop-shelf.js, ומחליף את הרשימה הזו (אותו #allProps, אותו מקום שמור).

   רק / בלי פרמטרי חיפוש. ?deal=sale וחבריו הם עמודי תוצאות; הרשימה שלהם
   אינה הרשימה של דף הבית. utm_*, gclid ו-beta אינם תוכן.

   כשל מסד אינו 503 ואינו noindex: דף הבית יוצא כמו שהוא, בלי מטמון,
   כדי שהבקשה הבאה תנסה שוב. הצלחה נשמרת שעה (הבלוק הוא לסורק; הגולש
   רואה את המדף מהדפדפן).
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;
const LIMIT = 12;
const MARKET = "afula-emek";

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

async function latest(signal: AbortSignal): Promise<Row[] | undefined> {
  const citiesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/market_cities_public?select=city_id&market_slug=eq.${MARKET}&limit=200`,
    { headers: authHeaders(), signal },
  );
  if (!citiesRes.ok) return undefined;
  const cities = await citiesRes.json();
  if (!Array.isArray(cities) || !cities.length) return undefined;
  const ids = cities
    .map((row) => String((row as { city_id?: unknown }).city_id || "").trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return undefined;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/properties?select=id,title,price,deal_type&status=eq.active&city_id=in.(${ids.join(",")})&order=is_promoted.desc,created_at.desc&limit=${LIMIT}`,
    { headers: authHeaders(), signal },
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
    const text = linkText(row);
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
    const tag = /data-ssr=/.test(open) ? open : `${open} data-ssr="1"`;
    return `${tag}${mid}${nav}${close}`;
  });
  if (out.includes('"@type":"ItemList"') || out.includes('"@type": "ItemList"')) {
    return out;
  }
  const json = itemList(rows);
  out = out.replace(/<\/head>/i, () => `<script type="application/ld+json">${json}</script>\n</head>`);
  return out;
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  if (request.method !== "GET" && request.method !== "HEAD") return res;
  let url: URL;
  try { url = new URL(request.url); } catch { return res; }
  if (!isHome(url) || hasContent(url.searchParams)) return res;
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  if (res.status >= 300 && res.status < 400) return res;

  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  const passthrough = () => new Response(html, { status: res.status, headers });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const rows = await latest(ctrl.signal);
    if (!rows) return passthrough();
    const out = inject(html, rows);
    if (!out) return passthrough();
    if (!headers.has("set-cookie")) {
      headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    }
    return new Response(out, { status: res.status, headers });
  } catch {
    return passthrough();
  } finally {
    clearTimeout(timer);
  }
}

export const config: Config = { path: ["/", "/index.html"] };
