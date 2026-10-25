/* ============================================================================
   ‏sitemap.xml חי — הדפים הסטטיים מהקובץ, דפי הפירוט מהמסד
   ----------------------------------------------------------------------------
   ## הבעיה

   ‏sitemap.xml שבריפו מחזיק 18 כתובות סטטיות. דפי הפירוט — נכס, משרד,
   סוכן/ת, פרויקט, בעל/ת מקצוע, כתבה וחברה יזמית — נוצרים מהמסד, ולכן
   **אף אחד מהם לא היה בו**. אלה בדיוק הדפים שאמורים להביא תנועה אורגנית.

   וגרוע מכך: אין אליהם קישור סטטי שסורק יכול לעקוב אחריו. רשימת הנכסים
   בדף הבית נבנית ב-JS אחרי טעינה, כלומר הדרך היחידה שגוגל תדע שנכס קיים
   היא שנספר לה. ‏sitemap הוא הדרך לספר.

   עדכון ידני של הקובץ אינו פתרון: נכס חדש עולה לאתר בכל יום, והקובץ היה
   מתיישן ביום שאחרי כל עדכון.

   ## מה הפונקציה עושה

   רצה על ה-edge בכל בקשה ל-‎/sitemap.xml‎, מושכת את הכתובות הדינמיות
   מ-Supabase, ומשרשרת אותן לקובץ הסטטי — שממשיך להיות מקור האמת לדפים
   הסטטיים. **דף ציבורי חדש עדיין נוסף ל-sitemap.xml הרגיל**, בדיוק כמו
   היום, והפונקציה הזו לא משנה בכך דבר.

   ## ארבע החלטות שחשוב להבין

   ‏**1. הקובץ הסטטי הוא הבסיס, לא רשימה משוכפלת.** הפונקציה קוראת אותו
   דרך ‎context.next()‎ ומוסיפה לתוכו. אילו היא הייתה מונה את הדפים
   הסטטיים בעצמה, היו שתי רשימות שצריכות להישאר זהות — ואחת מהן הייתה
   מתיישנת. כך יש אחת.

   ‏**2. מפתח anon, כמו ב-og-tags.** הפונקציה קוראת בדיוק מה שגולש/ת
   אנונימי/ת קוראת, ו-RLS חל עליה כרגיל. כל המקורות כאן הם תצוגות
   ‎_public‎ שכבר מסננות בעצמן (כרטיס מקצוע שתוקפו פג, סוכן/ת לא פעיל/ה,
   כתבה שטרם פורסמה), ולכן אין כאן שום שיקול דעת שמוגדר פעמיים.

   ‏**3. כישלון של מקור רגיל מחזיר רשימה ריקה, וכישלון של כולם מחזיר
   את הקובץ הסטטי.** כל שאילתת GET עטופה ב-timeout וב-try/catch ומחזירה
   רשימה ריקה בכשל. ‏sitemap חלקי אינו מוחק כלום מהאינדקס — גוגל
   מתייחסת אליו כרמז ולא כרשימת מחיקה — ולכן חלקי עדיף על 500, וכישלון
   של כל המקורות יחד מחזיר את ‎sitemap.xml‎ כמו שהוא.

   ‏**היוצא מן הכלל הוא בלוק העסקאות לפי יישוב.** הוא נמשך ב-POST, כמו
   ‏deals-page.ts, עם timeout של 8 שניות: ה-GET ב-2.5 שניות נכשל בשקט
   והקובץ יוצא 200 בלי אף ‎/deals/‎. מערך ריק מהפונקציה הוא תשובה
   לגיטימית (אין יישוב עם עסקאות) ונשאר 200. כשל — timeout, סטטוס שאינו
   ‏200, או גוף שאינו מערך — כשיש כתובות ממקור אחר, הוא 503 עם
   ‏Retry-After ו-no-store בשתי כותרות המטמון, בלי urlset חלקי. אין
   כאן noindex: זה אינו דף HTML, וכשל זמני אינו סיבה למחוק כתובות.

   ‏**4. אין ‎changefreq‎ ואין ‎priority‎ בערכים הדינמיים.** גוגל מתעלמת
   משניהם מזה שנים. ‎lastmod‎ דווקא נקרא, ולכן הוא נכתב מהמסד בכל מקום
   שיש בו חותמת זמן אמיתית — ומושמט במקום שאין (סוכנים, בעלי מקצוע
   וחברות יזמיות).
   ‏lastmod מומצא גרוע מ-lastmod חסר: הוא מלמד את גוגל להתעלם ממנו.

   ## מטמון

   התשובה נשמרת ב-CDN של Netlify לשעה (‏stale-while-revalidate ליממה).
   ‏sitemap אינו דף שגולש/ת רואה, ואיחור של שעה בין פרסום נכס לבין הופעתו
   בו אינו משנה דבר מול מהירות הסריקה של גוגל — אבל הוא מונע שבע שאילתות
   ל-Supabase בכל ביקור של כל סורק.

   ## הגבול

   גוגל מגבילה ‎sitemap‎ יחיד ל-50,000 כתובות. היום יש כאן כ-130, ולכן
   הגבול רחוק. כשמתקרבים אליו צריך לפצל ל-sitemap index — ומכיוון שזה
   לא יקרה בשקט, המספרים נכתבים כהערת XML בראש הקובץ.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/silo-render.js";
import "../../assets/brokers-render.js";
import { SEARCH_PAGES } from "./search-pages.ts";
import {
  landingIndexable,
  liveMarketSlugs,
  neighborhoodIndexable,
  settlementIndexable,
  THIN_DEALS,
} from "./lib/indexability.ts";

const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";

const SITE = "https://shuknadlan.co.il";
const FETCH_TIMEOUT_MS = 2500;
/* ‏הצבירה ב-deal_settlements_public כבדה מה-GET של 2.5 שניות, והשמטה
   שקטה של הבלוק מוציאה 200 בלי דפי העסקאות. 8 שניות עדיין מתחת ל-timeout
   של כותרות ה-edge (‏40 שניות). מחכים לרשת, לא ל-CPU. */
const DEALS_FETCH_TIMEOUT_MS = 8000;

/* תקרה לכל סוג, כדי ששאילתה אחת לא תמשוך את כל הטבלה אם משהו משתבש.
   הן גבוהות בהרבה מהמצב היום (79 נכסים, 15 סוכנים, 10 משרדים). */
const LIMIT = 5000;

/* ---------- עזרים ---------- */

/* ‏XML, לא HTML: כאן חייבים לברוח מ-& בתוך ה-loc, אחרת הקובץ אינו תקין
   כלל וגוגל דוחה אותו שלם. */
function xml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}

/* ‏W3C datetime. גוגל מקבלת גם תאריך בלבד, וזו הצורה הקריאה. ערך לא תקין
   מושמט — ראו החלטה 4 למעלה. */
function day(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}

async function sbSelect(path: string): Promise<Record<string, unknown>[]> {
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
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return []; // ‏timeout, רשת, JSON פגום — הסוג הזה פשוט לא ייכנס לקובץ
  } finally {
    clearTimeout(timer);
  }
}

/* ‏ok:false = כשל זמני. מערך ריק הוא תשובה לגיטימית, לא כשל.
   גוף שאינו מערך אינו "אין יישובים" — הוא תשובה שלא הבנו. */
type RpcRows = { ok: true; rows: Record<string, unknown>[] } | { ok: false };

async function sbRpc(name: string): Promise<RpcRows> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEALS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false };
    return { ok: true, rows: data.slice(0, LIMIT) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- הסוגים ---------- */

/* ‏key הוא שם הפרמטר בכתובת, בדיוק כפי שדף הפירוט קורא אותו:
   ‏property.html קורא ?id=, וכל השאר קוראים ?slug=. */
type Source = {
  name: string;
  page: string;
  key: "id" | "slug";
  field: string;
  lastmod?: string;
  query?: string;
  /* ‏POST ל-rpc. כישלון של מקור כזה, כשיש כתובות ממקור אחר, הוא 503
     ולא השמטה שקטה. מערך ריק אינו כישלון. */
  rpc?: string;
  // ‏כתובת בצורת נתיב (‏/deals/afula) במקום ‎?slug=‎. הדף שמגיש אותה ממלא
  // את ה-canonical מהכתובת עצמה (‏deals-page.ts).
  path?: (value: string) => string;
};

const SOURCES: Source[] = [
  {
    name: "נכסים",
    page: "property",
    key: "id",
    field: "id",
    lastmod: "updated_at",
    // ‏status=active הוא התנאי היחיד שמעלה מודעה לאתר (ראו CLAUDE.md)
    query: `properties?status=eq.active&select=id,updated_at&order=updated_at.desc&limit=${LIMIT}`,
  },
  {
    name: "משרדים",
    page: "agency",
    key: "slug",
    field: "slug",
    lastmod: "updated_at",
    query: `agencies?slug=not.is.null&select=slug,updated_at&order=updated_at.desc&limit=${LIMIT}`,
  },
  {
    name: "סוכנים",
    page: "agent",
    key: "slug",
    field: "slug",
    // ‏אין באגף הזה חותמת זמן, ולכן אין lastmod. התצוגה כבר מסננת active=true.
    query: `agency_members_public?slug=not.is.null&select=slug&limit=${LIMIT}`,
  },
  {
    name: "פרויקטים",
    page: "project",
    key: "slug",
    field: "slug",
    lastmod: "published_at",
    query: `projects_public?slug=not.is.null&select=slug,published_at&limit=${LIMIT}`,
  },
  {
    name: "בעלי מקצוע",
    page: "professional",
    key: "slug",
    field: "slug",
    // ‏התצוגה מסננת כרטיס שתוקפו פג; starts_at אינו תאריך עדכון תוכן.
    query: `professional_cards_public?slug=not.is.null&select=slug&limit=${LIMIT}`,
  },
  {
    name: "כתבות",
    page: "article",
    key: "slug",
    field: "slug",
    lastmod: "published_at",
    query: `articles_public?slug=not.is.null&select=slug,published_at&order=published_at.desc&limit=${LIMIT}`,
  },
  {
    name: "חברות יזמיות",
    page: "developer",
    key: "slug",
    field: "slug",
    // ‏אין בתצוגה חותמת זמן, ולכן אין lastmod — כמו סוכנים ובעלי מקצוע.
    query: `developers_public?slug=not.is.null&select=slug&limit=${LIMIT}`,
  },
  {
    // ‏דף עסקאות לכל יישוב פעיל **שיש לו עסקאות** (‏docs/settlement-deals.md).
    // הטבלה עצמה מחזיקה את כל ערי השווקים, רובן בלי עסקאות - והפונקציה
    // מסננת אותן, כדי לא להגיש לגוגל מאות דפים ריקים.
    name: "עסקאות לפי יישוב",
    page: "deals",
    key: "slug",
    field: "slug",
    lastmod: "updated_at",
    rpc: "deal_settlements_public",
    path: (v) => `/deals/${encodeURIComponent(v)}`,
  },
  {
    // ‏דף לכל שכונה שיש בה נכס פעיל או 5 עסקאות ב-24 חודשים
    // (‏docs/neighborhood-pages.md). ‏path_key = "afula/גבעת-המורה".
    name: "שכונות",
    page: "neighborhood",
    key: "slug",
    field: "path_key",
    query: `rpc/neighborhood_pages_public?select=path_key,city,props&limit=${LIMIT}`,
    path: (v) => `/n/${v.split("/").map(encodeURIComponent).join("/")}`,
  },
];

function entries(source: Source, rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const row of rows) {
    const value = String(row[source.field] ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);

    const loc = source.path
      ? `${SITE}${source.path(value)}`
      : `${SITE}/${source.page}?${source.key}=${encodeURIComponent(value)}`;
    const mod = source.lastmod ? day(row[source.lastmod]) : "";
    out.push(
      "  <url>\n" +
        `    <loc>${xml(loc)}</loc>\n` +
        (mod ? `    <lastmod>${mod}</lastmod>\n` : "") +
        "  </url>",
    );
  }
  return out;
}

type CityInfo = { listings: number; marketSlug: string | null };
type CityMap = { ok: boolean; byName: Map<string, CityInfo>; rows: Record<string, unknown>[] };

async function sbGet(path: string, timeout = FETCH_TIMEOUT_MS): Promise<RpcRows> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false };
    return { ok: true, rows: data.slice(0, LIMIT) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/* ‏מודעות פעילות לפי עיר, והשוק של כל עיר. כשל כאן אינו "אפס מודעות". */
async function loadCityMarkets(): Promise<CityMap> {
  const props = await sbGet(
    `properties?status=eq.active&select=city,city_id,updated_at,property_type,rooms,deal_type,category&limit=${LIMIT}`,
  );
  if (!props.ok) return { ok: false, byName: new Map(), rows: [] };
  const ids = [...new Set(props.rows.map((row) => String(row.city_id || "").trim()).filter(Boolean))];
  const marketById = new Map<string, string>();
  if (ids.length) {
    const markets = await sbGet(
      `market_cities_public?select=city_id,market_slug&city_id=in.(${ids.join(",")})&limit=${LIMIT}`,
    );
    if (!markets.ok) return { ok: false, byName: new Map(), rows: [] };
    for (const row of markets.rows) {
      const id = String(row.city_id || "").trim();
      const slug = String(row.market_slug || "").trim();
      if (id && slug) marketById.set(id, slug);
    }
  }
  const byName = new Map<string, CityInfo>();
  for (const row of props.rows) {
    const name = String(row.city || "").trim();
    if (!name) continue;
    const cur = byName.get(name) || { listings: 0, marketSlug: null };
    cur.listings += 1;
    const slug = marketById.get(String(row.city_id || "").trim());
    if (slug) cur.marketSlug = slug;
    byName.set(name, cur);
  }
  return { ok: true, byName, rows: props.rows };
}

async function pageDeals(slug: string): Promise<{ ok: true; deals: number } | { ok: false }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/deal_settlement_page`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_slug: slug }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (data === null) return { ok: true, deals: 0 };
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false };
    return { ok: true, deals: Number((data as { deals?: unknown }).deals || 0) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/* ‏מספר העסקאות שב-deal_settlements_public הוא כל הזמנים. הדף סופר את
   חלון 12 החודשים. אחרי שהסף הגס עבר, המספר של הדף הוא שקובע. כשל
   בשאילתת הדף אינו מוחק יישוב שכבר עבר את הכלל הגס. */
async function dealRowIndexable(
  row: Record<string, unknown>,
  cities: CityMap,
  live: Set<string> | null,
): Promise<boolean> {
  const allTime = Number(row.deals || 0);
  if (allTime < THIN_DEALS) return false;
  if (!cities.ok) return true;
  const info = cities.byName.get(String(row.name || "").trim());
  const listings = info?.listings || 0;
  const market = info?.marketSlug || "";
  if (!settlementIndexable(allTime, listings, market, live)) return false;
  const page = await pageDeals(String(row.slug || ""));
  if (!page.ok) return true;
  return settlementIndexable(page.deals, listings, market, live);
}

async function rowsForSitemap(
  source: Source,
  rows: Record<string, unknown>[],
  cities: CityMap,
  live: Set<string> | null,
): Promise<Record<string, unknown>[]> {
  if (source.page === "neighborhood") {
    return rows.filter((row) => {
      const props = Number(row.props || 0);
      if (!cities.ok) return props > 0;
      const info = cities.byName.get(String(row.city || "").trim());
      return neighborhoodIndexable(props, info?.marketSlug, live);
    });
  }
  if (source.page === "deals") {
    const flags = await Promise.all(rows.map((row) => dealRowIndexable(row, cities, live)));
    return rows.filter((_, i) => flags[i]);
  }
  return rows;
}

const NOT_CONTENT = new Set([
  "src", "fbclid", "gclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "msclkid", "ref", "region",
]);

function queryKey(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, raw] of params) {
    if (NOT_CONTENT.has(key) || key.startsWith("utm_")) continue;
    const value = raw.trim().replace(/[\u2018\u2019\u05f3']/g, "'");
    if (!value) continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join("&");
}

/* ‏כתובת סינון שה-canonical שלה הוא דף נחיתה. אותה רשימה כמו search-pages. */
function locPointsElsewhere(loc: string): boolean {
  let url: URL;
  try { url = new URL(loc); } catch { return false; }
  if (url.pathname !== "/") return false;
  const key = queryKey(url.searchParams);
  const page = SEARCH_PAGES.find((item) => queryKey(new URLSearchParams(item.query)) === key);
  return !!page?.landing;
}

function unescapeXml(s: string): string {
  return s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function encodeLoc(escaped: string): string {
  let url: URL;
  try { url = new URL(unescapeXml(escaped)); } catch { return escaped; }
  const path = url.pathname.split("/").map((seg) => {
    try { return encodeURIComponent(decodeURIComponent(seg)); } catch { return encodeURIComponent(seg); }
  }).join("/");
  return xml(`${url.origin}${path}${url.search}`);
}

function encodeLocs(body: string): string {
  return body.replace(/<loc>([^<]*)<\/loc>/g, (_m, loc) => `<loc>${encodeLoc(loc)}</loc>`);
}

function removeLoc(body: string, loc: string): string {
  const needle = `<loc>${xml(loc)}</loc>`;
  const at = body.indexOf(needle);
  if (at < 0) return body;
  const start = body.lastIndexOf("<url>", at);
  const end = body.indexOf("</url>", at);
  if (start < 0 || end < 0) return body;
  return body.slice(0, start) + body.slice(end + "</url>".length);
}

function upsertLastmod(body: string, loc: string, mod: string): string {
  if (!mod) return body;
  const needle = `<loc>${xml(loc)}</loc>`;
  const at = body.indexOf(needle);
  if (at < 0) return body;
  const end = body.indexOf("</url>", at);
  if (end < 0) return body;
  if (body.slice(at, end).includes("<lastmod>")) return body;
  const insertAt = at + needle.length;
  return body.slice(0, insertAt) + `\n    <lastmod>${mod}</lastmod>` + body.slice(insertAt);
}

type SiloPage = {
  path: string;
  property_type: string | null;
  rooms: number | null;
  cityName: string;
  market: string;
};
type BrokersPage = { path: string; cityId: string; market: string };

function landingPages(): SiloPage[] {
  const pages = (globalThis as unknown as { ShukSilo?: { pages?: SiloPage[] } }).ShukSilo?.pages;
  return Array.isArray(pages) ? pages : [];
}

function brokersPages(): BrokersPage[] {
  const pages = (globalThis as unknown as { ShukBrokers?: { pages?: BrokersPage[] } }).ShukBrokers?.pages;
  return Array.isArray(pages) ? pages : [];
}

/* ‏אותו סינון כמו queryOf ב-silo-render.js: העיר היא המחרוזת properties.city. */
function landingMatches(page: SiloPage, row: Record<string, unknown>): boolean {
  if (String(row.city || "") !== page.cityName) return false;
  if (String(row.deal_type || "") !== "sale") return false;
  if (String(row.category || "") !== "residential") return false;
  if (page.property_type && String(row.property_type || "") !== page.property_type) return false;
  if (page.rooms != null && Number(row.rooms) !== Number(page.rooms)) return false;
  return true;
}

/* ‏אחרי שהבלוקים מהמסד נכנסו: מורידים כתובת שהדף שלה היה noindex או
   שה-canonical שלה במקום אחר, ומוסיפים lastmod אמיתי לדפי הנחיתה.
   עיר שכבר בקובץ הסטטי (עפולה) נשארת במקומה, עם אותו lastmod.
   עיר מ-ShukSilo.pages / ShukBrokers.pages שנעדרת מהקובץ נכנסת רק אם
   הדף עצמו היה index,follow: שוק חי, ויש מודעות או משרד. בלי זה אין
   שורה — גם לא לעיר עם מלאי שאין לה דף, וגם לא לשוק שאינו חי. */
function bodyHasLoc(body: string, loc: string): boolean {
  const raw = `<loc>${xml(loc)}</loc>`;
  if (body.includes(raw)) return true;
  const encoded = `<loc>${encodeLoc(loc)}</loc>`;
  return encoded !== raw && body.includes(encoded);
}

/* ‏שורה חדשה, בלי changefreq ובלי priority (החלטה 4). נכתבת לפני
   ‎</urlset>‎ כדי לא להזיז כתובת שכבר בקובץ. */
function appendUrl(body: string, loc: string, mod: string): string {
  if (bodyHasLoc(body, loc)) return body;
  const block =
    "  <url>\n" +
    `    <loc>${xml(loc)}</loc>\n` +
    (mod ? `    <lastmod>${mod}</lastmod>\n` : "") +
    "  </url>\n";
  const close = body.lastIndexOf("</urlset>");
  if (close < 0) return body;
  return body.slice(0, close) + block + body.slice(close);
}

function keepLanding(body: string, loc: string, mod: string): string {
  if (bodyHasLoc(body, loc)) return upsertLastmod(body, loc, mod);
  return appendUrl(body, loc, mod);
}

async function polish(body: string, cities: CityMap, live: Set<string> | null): Promise<string> {
  let out = body;
  const locs = [...out.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unescapeXml(m[1]));
  for (const loc of locs) {
    if (locPointsElsewhere(loc)) out = removeLoc(out, loc);
  }

  /* /projects נשאר גם כשאין פרויקט: יש בו מדריך קנייה, והוא ניתן לאינדוקס.
     docs/sitemap.md. דפי /project?slug= עדיין מגיעים מ-projects_public. */

  for (const page of brokersPages()) {
    const loc = `${SITE}${page.path}`;
    if (!landingIndexable(page.market, live)) {
      out = removeLoc(out, loc);
      continue;
    }
    const agencies = await sbGet(
      `agencies?slug=not.is.null&city_id=eq.${page.cityId}&select=updated_at&order=updated_at.desc&limit=1`,
    );
    if (agencies.ok && agencies.rows.length === 0) {
      out = removeLoc(out, loc);
    } else if (agencies.ok && agencies.rows.length) {
      out = keepLanding(out, loc, day(agencies.rows[0].updated_at));
    }
  }

  for (const page of landingPages()) {
    if (!landingIndexable(page.market, live)) out = removeLoc(out, `${SITE}${page.path}`);
  }

  /* ‏כשל בשאילתת המודעות אינו "אפס מודעות": לא מוסיפים עיר חדשה ולא
     מורידים עיר שכבר בקובץ. */
  if (cities.ok) {
    for (const page of landingPages()) {
      if (!landingIndexable(page.market, live)) continue;
      const matched = cities.rows.filter((row) => landingMatches(page, row));
      if (!matched.length) {
        out = removeLoc(out, `${SITE}${page.path}`);
        continue;
      }
      const newest = matched.reduce((best, row) => {
        const stamp = day(row.updated_at);
        return stamp > best ? stamp : best;
      }, "");
      out = keepLanding(out, `${SITE}${page.path}`, newest);
    }
  }

  return encodeLocs(out);
}

/* ---------- ההרכבה ---------- */

const XML_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  // שעה ב-CDN, יממה של הגשה ישנה תוך רענון ברקע
  "Netlify-CDN-Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  "Cache-Control": "public, max-age=0, must-revalidate",
};

export default async function handler(_request: Request, context: Context) {
  const res = await context.next();

  // ‏404 או שגיאה מהקובץ הסטטי: אין על מה לבנות, והתשובה יוצאת כמו שהיא
  // ‏(עטיפה שלה בכותרות XML הייתה מגישה דף שגיאה כ-sitemap תקין).
  if (!res.ok) return res;

  // הקובץ הסטטי נקרא פעם אחת ונשמר כמחרוזת: הוא גם הבסיס וגם מסלול הנפילה
  let staticXml: string;
  try {
    staticXml = await res.text();
  } catch {
    return res;
  }

  const fallback = () => new Response(staticXml, { status: 200, headers: XML_HEADERS });

  try {
    const close = staticXml.lastIndexOf("</urlset>");
    if (close === -1) return fallback(); // לא הצורה שציפינו לה — לא נוגעים

    const loaded = await Promise.all(SOURCES.map((s) =>
      s.rpc
        ? sbRpc(s.rpc)
        : sbSelect(s.query || "").then((rows) => ({ ok: true as const, rows }))
    ));

    const cities = await loadCityMarkets();
    const live = liveMarketSlugs();
    const blocks: string[] = [];
    const counts: string[] = [];
    let guardedFailed = false;
    let otherUrls = 0;
    for (let i = 0; i < SOURCES.length; i++) {
      const source = SOURCES[i];
      const got = loaded[i];
      /* ‏מקור שמסומן rpc: כשל אינו נבלע. מקור GET שנכשל כבר חזר כרשימה ריקה. */
      if (!got.ok) {
        guardedFailed = true;
        continue;
      }
      const rows = await rowsForSitemap(source, got.rows, cities, live);
      const urls = entries(source, rows);
      counts.push(`${source.name}: ${urls.length}`);
      blocks.push(...urls);
      if (!source.rpc) otherUrls += urls.length;
    }

    /* ‏בלוק העסקאות נכשל ויש כתובות אחרות: לא מפרסמים 200 בלי /deals/.
       הגוף הוא הקובץ הסטטי בלבד, והוא אינו נשמר. */
    if (guardedFailed && otherUrls > 0) {
      return new Response(staticXml, {
        status: 503,
        headers: {
          "content-type": "application/xml; charset=utf-8",
          "Cache-Control": "no-store",
          "Netlify-CDN-Cache-Control": "no-store",
          "Retry-After": "60",
        },
      });
    }

    if (!blocks.length) return fallback(); // כל השאילתות נכשלו, או שאין מה להוסיף

    const body =
      staticXml.slice(0, close) + blocks.join("\n") + "\n" + staticXml.slice(close);

    // ‏המספרים בראש הקובץ, מיד אחרי הצהרת ה-XML: `curl … | head -3` מספיק
    // כדי לראות שסוג שלם נעלם. גוגל מתעלמת מהערות.
    const note = `<!-- דפי פירוט מהמסד - ${counts.join(", ")} -->`;
    const decl = body.indexOf("?>");
    const noted =
      decl === -1 ? note + "\n" + body
                  : body.slice(0, decl + 2) + "\n" + note + body.slice(decl + 2);

    const out = await polish(noted, cities, live);
    return new Response(out, { status: 200, headers: XML_HEADERS });
  } catch {
    return fallback(); // ‏sitemap ישן עדיף על 500
  }
}

export const config: Config = {
  path: "/sitemap.xml",
};
