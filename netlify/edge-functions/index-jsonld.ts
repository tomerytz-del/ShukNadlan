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
/* ‏שוק ברירת המחדל של /agencies כשאין בחירה שמורה. סורק מגיע בלי
   localStorage, ו-CityContext נופל ל-afula-emek (assets/markets.js). */
const DEFAULT_MARKET = "afula-emek";
/* ‏משרד ההדגמה. הדף אינו מסנן לפי מזהה; הוא נופל גם כי אין בו סוכן/ת וגם
   כי העיר שלו אינה בשוק. כאן הוא יורד במפורש, גם אם שני אלה ישתנו. */
const DEMO_AGENCY_ID = "cf863e10-c25d-41ed-8b22-d6899a56e95d";
const DEMO_AGENCY_SLUG = "demo-office-play-review";
/* ‏אותן תקרות כמו agencies.html: חברי צוות לסינון "יש מישהו פעיל" (1,000)
   ואזורי פעילות (2,000). ערי השוק נקראות בעמודים, כמו MarketScope.spec. */
const STAFF_LIMIT = 1000;
const MARKET_MEMBER_LIMIT = 2000;
const CITY_PAGE = 1000;

type Row = Record<string, unknown>;

type About = { "@type": string; name: string };

type Page = {
  path: string;
  name: string;
  aboutCity: boolean;
  /* ‏כשהדף אינו על עיר אחת. השם חייב להופיע ב-H1. */
  about?: About;
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
    name: "משרדי תיווך בעמק יזרעאל",
    aboutCity: false,
    about: { "@type": "AdministrativeArea", name: "עמק יזרעאל" },
    /* ‏לא נקרא: הרשימה נבנית ב-loadDefaultMarketAgencies, באותו סינון של הדף. */
    query: "",
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

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s) => typeof s === "string" && s.length > 0) as string[];
}

function isDemoOffice(row: Row): boolean {
  return String(row.id || "") === DEMO_AGENCY_ID || String(row.slug || "") === DEMO_AGENCY_SLUG;
}

/* ‏MarketScope.inMarket לשוק ברירת המחדל: exclude של ערי שוק אחר, ומשרד
   שאחד מחבריו בחר את afula-emek נכנס גם אם העיר שלו במקום אחר. בלי spec
   (רשימת הערים האחרות ריקה) אין סינון עיר, כמו ב-spec() של הדף. */
function inDefaultMarket(
  exclude: Set<string> | null,
  cityId: unknown,
  slugs: string[],
): boolean {
  if (slugs.includes(DEFAULT_MARKET)) return true;
  if (!exclude) return true;
  if (cityId == null || cityId === "") return true;
  return !exclude.has(String(cityId));
}

/* ‏אותו סדר כמו agencies.html: קודם "יש סוכן/ת פעיל/ה" כשהשליפה שלמה
   (פחות מ-STAFF_LIMIT), ואז inMarket. כשל בשליפת הצוות (staff === null)
   אינו מסנן, כמו allSettled שנכשל. כשל באזורי הפעילות (marketMembers === null)
   משאיר רק את עיר המשרד, כמו ה-catch של memberMarkets. */
export function filterDefaultMarketOffices(
  offices: Row[],
  cities: Row[],
  staff: Row[] | null,
  marketMembers: Row[] | null,
): Row[] {
  const excludeIds = cities
    .filter((c) => c.market_slug !== DEFAULT_MARKET && c.city_id)
    .map((c) => String(c.city_id));
  const exclude = excludeIds.length ? new Set(excludeIds) : null;
  const slugsByAgency = new Map<string, string[]>();
  for (const member of marketMembers || []) {
    const slugs = stringsOf(member.service_markets);
    if (!slugs.length || !member.agency_id) continue;
    const id = String(member.agency_id);
    const cur = slugsByAgency.get(id) || [];
    for (const slug of slugs) if (!cur.includes(slug)) cur.push(slug);
    slugsByAgency.set(id, cur);
  }
  const membersComplete = staff !== null && staff.length < STAFF_LIMIT;
  const staffed = new Set(
    (staff || [])
      .filter((m) => m.active !== false && m.agency_id)
      .map((m) => String(m.agency_id)),
  );
  return offices.filter((office) => {
    if (isDemoOffice(office)) return false;
    if (membersComplete && !staffed.has(String(office.id || ""))) return false;
    const slugs = slugsByAgency.get(String(office.id || "")) || [];
    return inDefaultMarket(exclude, office.city_id, slugs);
  });
}

async function rest(path: string): Promise<Row[] | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

/* ‏עמודי market_cities_public, כמו MarketScope.spec: PostgREST חותך ב-1,000. */
async function marketCities(): Promise<Row[] | undefined> {
  const all: Row[] = [];
  for (let offset = 0; offset < CITY_PAGE * 20; offset += CITY_PAGE) {
    const page = await rest(
      `market_cities_public?select=city_id,market_slug&limit=${CITY_PAGE}&offset=${offset}`,
    );
    if (!page) return undefined;
    all.push(...page);
    if (page.length < CITY_PAGE) return all;
  }
  return all;
}

/* ‏כשל בשליפת המשרדים או במיפוי הערים: אין רשימה. לא מפרסמים את כל המשרדים
   תחת שם האזור, ולא שומרים את זה במטמון (הקריא ב-handler). */
async function loadDefaultMarketAgencies(): Promise<{ ok: true; rows: Row[]; total: number } | { ok: false }> {
  const [offices, staff, marketMembers, cities] = await Promise.all([
    rest("agencies?select=id,slug,name,city_id&slug=not.is.null&order=name.asc&limit=1000"),
    rest(`agency_members_public?select=agency_id,active&limit=${STAFF_LIMIT}`),
    rest(`agency_members_public?select=id,agency_id,service_markets&limit=${MARKET_MEMBER_LIMIT}`),
    marketCities(),
  ]);
  if (!offices || !cities) return { ok: false };
  const rows = filterDefaultMarketOffices(offices, cities, staff ?? null, marketMembers ?? null);
  return { ok: true, rows, total: rows.length };
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
  else if (page.about) collection.about = page.about;
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

  const got = page.path === "/agencies" ? await loadDefaultMarketAgencies() : await rowsOf(page.query);
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
