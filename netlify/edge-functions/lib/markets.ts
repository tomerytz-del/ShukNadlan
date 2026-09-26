/* ============================================================================
   עזרי השווקים לפונקציות ה-edge (‏search-pages.ts, ‏market-pages.ts)

   קובץ בתת-תיקייה שאינו `<שם>/<שם>.ts` ואינו `index.ts` - ולכן Netlify אינו
   פורס אותו כפונקציה, והוא משמש רק לייבוא.

   הרשימה עצמה ב-`assets/markets.js`: אותו קובץ נטען בדפדפן, ומיובא כאן
   לתופעת הלוואי שלו (‏`globalThis.ShukMarkets`). ‏docs/regional-pages.md.
   ========================================================================== */

import "../../../assets/markets.js";

export type Market = {
  slug: string;
  label: string;
  path: string;
  live: boolean;
  isDefault: boolean;
  center: [number, number];
  zoom: number;
  bbox: [number, number, number, number];
  /* תיבות ל-locate בלבד, כשהמסגרת (`bbox`) חופפת שוק שכן. ‏assets/markets.js. */
  boxes?: [number, number, number, number][];
  title: string;
  description: string;
};

export type Registry = {
  list: Market[];
  byPath: (path: string) => Market | null;
  bySlug: (slug: string) => Market | null;
  defaultMarket: () => Market;
  locate: (lat: number, lng: number, onlyLive?: boolean) => Market | null;
};

export function registry(): Registry | null {
  return (globalThis as unknown as { ShukMarkets?: Registry }).ShukMarkets || null;
}

/* אותה בריחה כמו assets/esc.js. */
export function esc(s: unknown): string {
  return String(s === null || s === undefined ? "" : s)
    .replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
}

/* ---------- ההפניה מ-‎/‎ ----------

   מי שבחר/ה שוק, שה-GPS שלו/ה מצא שוק, או שה-IP שלו/ה נופל בתיבה של שוק -
   מגיע/ה ל-‎/‎ ומופנה/ית לכתובת של השוק שלו/ה. שלושה כללים:

   1. **רק לשוק חי.** שוק שעוד לא נפתח מגיש "נפתחים בקרוב", וגולש/ת שחיפש/ה
      דירה לא צריך/ה לנחות שם בלי שביקש/ה.
   2. **בחירה מפורשת גוברת על הכול**, כולל בחירה בברירת המחדל: מי שבחר/ה
      "עפולה והעמק" לא יופנה/תופנה לחיפה בגלל ה-IP.
   3. **סורקים לעולם אינם מופנים.** ‏Googlebot מגיע בלי עוגיות ומ-IP זר, כך
      שממילא לא היה מופנה - אבל תצוגות מקדימות של וואטסאפ ופייסבוק כן עלולות
      להגיע מישראל, וקישור ל-‎/‎ שנשלח בקבוצה חייב להיראות כמו ‎/‎.

   ‏IP סלולרי בישראל ממוקם לרוב לפי נקודת היציאה של הספק (תל אביב, פתח
   תקווה) ולא לפי המכשיר. לכן שכבת ה-IP פועלת רק בתוך תיבה של שוק, ולכן יש
   כפתור GPS. */

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse|headless/i;

export type Geo = {
  latitude?: number;
  longitude?: number;
  country?: { code?: string };
};

export type Decision = {
  location: string | null;   // ‏302 לכאן, או null
  geoCookie: string | null;  // ערך לעוגיית shuk_geo, או null
};

function cookieValue(header: string, name: string): string | null {
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/* ‏slug|lat|lng|zoom|label - הפורמט של assets/city-context.js. */
export function geoCookieValue(m: Market): string {
  return [m.slug, m.center[0], m.center[1], m.zoom, m.label].join("|");
}

export function decide(
  reg: Registry,
  opts: { cookie: string; userAgent: string; geo?: Geo | null; search: string },
): Decision {
  const none: Decision = { location: null, geoCookie: null };
  if (BOT.test(opts.userAgent || "")) return none;

  const chosen = cookieValue(opts.cookie || "", "shuk_market");
  if (chosen) {
    const m = reg.bySlug(chosen.split("|")[0]);
    if (m) {
      return (m.live && !m.isDefault)
        ? { location: m.path + (opts.search || ""), geoCookie: null }
        : none;
    }
  }

  const g = opts.geo;
  if (!g || g.country?.code !== "IL") return none;
  if (typeof g.latitude !== "number" || typeof g.longitude !== "number") return none;
  const m = reg.locate(g.latitude, g.longitude, true);
  if (!m) return none;
  return {
    location: m.isDefault ? null : m.path + (opts.search || ""),
    geoCookie: geoCookieValue(m),
  };
}
