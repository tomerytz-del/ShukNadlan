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
  /* ‏ה-id של הרשת שה-JS ממלא. הקישורים נכתבים לתוכה כבר בשרת. */
  gridId: string;
};

const PAGES: Page[] = [
  {
    path: "/agents",
    name: "כל יועצי הנדל״ן",
    aboutCity: true,
    query: "agency_members_public?select=slug,display_name&slug=not.is.null&order=display_name.asc&limit=1000",
    href: (row) => `/agent?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.display_name || "").trim(),
    gridId: "agentsGrid",
  },
  {
    path: "/agencies",
    name: "משרדי התיווך",
    aboutCity: true,
    query: "agencies?select=slug,name&slug=not.is.null&order=name.asc&limit=1000",
    href: (row) => `/agency?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.name || "").trim(),
    itemType: "RealEstateAgent",
    gridId: "agenciesGrid",
  },
  {
    path: "/professionals",
    name: "בעלי המקצוע",
    aboutCity: true,
    query: "professional_cards_public?select=slug,business_name,advertiser_name&slug=not.is.null&limit=1000",
    href: (row) => `/professional?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.business_name || row.advertiser_name || "").trim(),
    gridId: "prosGrid",
  },
  {
    path: "/articles",
    name: "כתבות ובלוגים",
    aboutCity: false,
    query: "articles_public?select=slug,title&slug=not.is.null&order=published_at.desc&limit=1000",
    href: (row) => `/article?slug=${encodeURIComponent(String(row.slug))}`,
    label: (row) => String(row.title || "").trim(),
    gridId: "articlesGrid",
  },
];

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/* ‏הקישורים לפריטים ב-HTML הראשון, לא רק ב-ItemList: סורק שאינו מריץ JS
   (ורוב סורקי ה-AI כאלה) ראה ב-/agents קישור אחד וב-/agencies אפס, בעוד
   ה-JSON-LD הצהיר על 51 ו-33 (ביקורת 5.11.2026). הרשימה נכתבת לתוך הרשת
   הריקה שה-JS ממלא אחר כך (‏innerHTML / textContent מחליפים אותה), ולכן
   הגולש/ת רואה קישורים עד שהכרטיסים נטענים, ולא ריק. רק רשת ריקה מתמלאת. */
const SSR_STYLE = `<style id="ssrListStyle">.ssr-list{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:4px 0 12px;list-style:none}.ssr-list a{display:inline-block;padding:8px 14px;border:1px solid rgba(0,0,0,.12);border-radius:999px;font-size:.95rem;text-decoration:none;color:inherit;background:rgba(255,255,255,.7)}</style>`;

/* ‏תקרה ל-HTML בלבד; ה-ItemList ב-JSON-LD נשאר מלא. */
const SSR_MAX_LINKS = 120;

function listHtml(page: Page, rows: Row[]): string {
  const links: string[] = [];
  for (const row of rows) {
    if (links.length >= SSR_MAX_LINKS) break;
    const slug = String(row.slug || "").trim();
    const label = page.label(row);
    if (!slug || !label) continue;
    links.push(`<li><a href="${esc(page.href(row))}">${esc(label)}</a></li>`);
  }
  if (!links.length) return "";
  return `<ul class="ssr-list" aria-label="${esc(page.name)}">${links.join("")}</ul>`;
}

function fillGrid(html: string, page: Page, rows: Row[]): string {
  const list = listHtml(page, rows);
  if (!list) return html;
  const re = new RegExp(`(<div\\b[^>]*\\bid="${page.gridId}"[^>]*)(>)\\s*(</div>)`);
  if (!re.test(html)) return html;
  /* ‏prosGrid נולד hidden; הרשימה מהשרת נראית, וה-JS קובע hidden מחדש
     לפי התוצאות, כמו שהוא עושה ממילא. */
  const out = html.replace(re, (_m, open: string, gt: string, close: string) =>
    `${open.replace(/\s+hidden(?=\s|$)/, "")}${gt}${list}${close}`
  );
  return out.replace(/<\/head>/i, () => `${SSR_STYLE}\n</head>`);
}

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
  const withList = fillGrid(html, page, got.rows);
  const out = withList.replace(/<\/head>/i, () => `<script type="application/ld+json">${json}</script>\n</head>`);
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
