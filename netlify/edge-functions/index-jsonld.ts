/* ============================================================================
   JSON-LD לרשימות /agents /agencies /professionals /articles
   /projects נשאר ב-projects-page.ts: בלי ItemList כשהרשימה ריקה, ועם FAQ.
   ----------------------------------------------------------------------------
   אותו דפוס של מילוי בשרת כמו brokers-page: הסורק רואה @graph בלי להריץ JS.
   הכתובות והשמות באים מהתצוגות הציבוריות, ואותו מפתח anon. כשל מסד משאיר
   את ה-HTML כמו שהוא - הרשימה בדפדפן לא תלויה בבלוק הזה.

   אם בדף כבר יש CollectionPage, לא מוסיפים בלוק שני.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;

type Row = Record<string, unknown>;

type Page = {
  path: string;
  name: string;
  aboutCity: boolean;
  query: string;
  href: (row: Row) => string;
  label: (row: Row) => string;
  itemType?: string;
};

const PAGES: Page[] = [
  {
    path: "/agents",
    name: "כל יועצי הנדל״ן",
    aboutCity: true,
    query: "agency_members_public?select=slug,display_name&slug=not.is.null&order=display_name.asc&limit=1000",
    href: (row) => `/agent?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.display_name || "").trim(),
  },
  {
    path: "/agencies",
    name: "משרדי התיווך",
    aboutCity: true,
    query: "agencies?select=slug,name&slug=not.is.null&order=name.asc&limit=1000",
    href: (row) => `/agency?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.name || "").trim(),
    itemType: "RealEstateAgent",
  },
  {
    path: "/professionals",
    name: "בעלי המקצוע",
    aboutCity: true,
    query: "professional_cards_public?select=slug,business_name,advertiser_name&slug=not.is.null&limit=1000",
    href: (row) => `/professional?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.business_name || row.advertiser_name || "").trim(),
  },
  {
    path: "/articles",
    name: "כתבות ובלוגים",
    aboutCity: false,
    query: "articles_public?select=slug,title&slug=not.is.null&order=published_at.desc&limit=1000",
    href: (row) => `/article?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.title || "").trim(),
  },
];

function pageOf(pathname: string): Page | null {
  const path = pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  return PAGES.find((page) => page.path === path) || null;
}

async function rowsOf(query: string): Promise<{ ok: true; rows: Row[]; total: number } | { ok: false }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        Prefer: "count=exact",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false };
    const range = res.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)\s*$/);
    return { ok: true, rows: data, total: match ? Number(match[1]) : data.length };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function graph(page: Page, rows: Row[], total: number): Record<string, unknown> {
  const url = `${SITE}${page.path}`;
  const items: Record<string, unknown>[] = [];
  for (const row of rows) {
    const slug = String(row.slug || "").trim();
    const label = page.label(row);
    if (!slug || !label) continue;
    const itemUrl = `${SITE}${page.href(row)}`;
    const entry: Record<string, unknown> = {
      "@type": "ListItem",
      position: items.length + 1,
      url: itemUrl,
      name: label,
    };
    if (page.itemType) {
      entry.item = { "@type": page.itemType, name: label, url: itemUrl };
    }
    items.push(entry);
  }
  const list: Record<string, unknown> = {
    "@type": "ItemList",
    "@id": `${url}#list`,
    itemListOrder: "https://schema.org/ItemListUnordered",
    numberOfItems: rows.length < total ? total : items.length,
  };
  if (items.length) list.itemListElement = items;
  const collection: Record<string, unknown> = {
    "@type": "CollectionPage",
    "@id": `${url}#page`,
    url,
    name: page.name,
    inLanguage: "he",
    isPartOf: { "@id": `${SITE}/#website` },
    breadcrumb: { "@id": `${url}#breadcrumb` },
    mainEntity: { "@id": `${url}#list` },
  };
  if (page.aboutCity) collection.about = { "@type": "City", name: "עפולה" };
  return {
    "@context": "https://schema.org",
    "@graph": [
      collection,
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "שוק נדל״ן", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: page.name, item: url },
        ],
      },
      list,
    ],
  };
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  const page = pageOf(new URL(request.url).pathname);
  if (!page) return res;

  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  const passthrough = () => new Response(html, { status: res.status, headers });
  if (html.includes("CollectionPage")) return passthrough();

  const got = await rowsOf(page.query);
  if (!got.ok) return passthrough();

  const json = JSON.stringify(graph(page, got.rows, got.total)).replace(/</g, "\\u003c");
  let out = html.replace(/<\/head>/i, () => `<script type="application/ld+json">${json}</script>\n</head>`);
  if (page.path === "/agencies") {
    const links = got.rows.map((row) => {
      const slug = String(row.slug || "").trim();
      const name = String(row.name || "").trim();
      if (!slug || !name) return "";
      const href = `/agency?slug=${encodeURIComponent(slug)}`;
      return `<a class="ag-card" href="${href.replace(/"/g, "&quot;")}">${name.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c))}</a>`;
    }).filter(Boolean).join("");
    if (links) {
      out = out.replace(
        /(<div\b[^>]*\bid="agenciesGrid"[^>]*>)\s*(<\/div>)/i,
        (_match, open: string, close: string) => open + links + close,
      );
    }
  }
  /* בלי מטמון כל בקשה חיכתה לשאילתה ל-Supabase (‏count=exact, עד 1,000 שורות):
     ‏/agencies הגיע ל-1.1-1.5 שניות עד הבייט הראשון (‏slow_ttfb, 25.10.2026).
     הרשימה שהגולש/ת רואה נבנית בדפדפן, והבלוק הזה הוא לסורק בלבד - שעה של
     בלוק ישן אינה מסתירה משרד מאיש. רק תשובה שמולאה נשמרת, כמו ב-brokers-page. */
  headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return new Response(out, { status: res.status, headers });
}

export const config: Config = {
  path: [
    "/agents", "/agents.html",
    "/agencies", "/agencies.html",
    "/professionals", "/professionals.html",
    "/articles", "/articles.html",
  ],
};
