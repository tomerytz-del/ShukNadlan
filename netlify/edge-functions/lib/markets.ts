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
  /* בתוך התיבות של השוק עצמו - בלי ההרחבה של NEAR_KM שב-locate. */
  contains: (m: Market, lat: number, lng: number) => boolean;
};

export function registry(): Registry | null {
  return (globalThis as unknown as { ShukMarkets?: Registry }).ShukMarkets || null;
}

/* ‏דף נחיתה של עיר שאינה בשוק ברירת המחדל (‏silo-page.ts, ‏brokers-page.ts):
   אותו רמז ש-market-pages.ts נותן, כדי ש-city-context.js ו-market-text.js
   יחליפו את "עפולה והעמק" בכותרת ובפוטר ויסתירו את החיפושים הפופולריים של
   עפולה. ‏markets.js שם defer, ולכן סקריפט בסוף ה-head רץ לפניו. */
export function marketHint(home: string, market: string): string {
  if (home === "/") return "";
  const data = JSON.stringify({ slug: market }).replace(/</g, "\\u003c");
  return `<script>window.SHUK_MARKET=${data};</script>\n`;
}

/* אותה בריחה כמו assets/esc.js. */
export function esc(s: unknown): string {
  return String(s === null || s === undefined ? "" : s)
    .replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
}

/* ---------- ההפניה מ-‎/‎ ----------

   מי שבחר/ה שוק, שה-GPS שלו/ה מצא שוק, או שפתח/ה קישור עם `?region=` -
   מגיע/ה ל-‎/‎ ומופנה/ית לכתובת של השוק שלו/ה. כללים:

   1. **רק לשוק חי**, חוץ מקישור מפורש. שוק שעוד לא נפתח מגיש "נפתחים
      בקרוב", וגולש/ת שחיפש/ה דירה לא צריך/ה לנחות שם בלי שביקש/ה. קישור
      קמפיין (`?region=tel-aviv`) כן נוחת על הדף של האזור, כי זה מה
      שהקישור אמר.
   2. **הקישור גובר על בחירה שמורה, והבחירה גוברת על כל ניחוש.** מי
      שבחר/ה "עפולה והעמק" לא יופנה/תופנה לחיפה.
   3. **סורקים אינם מופנים מניחוש.** קישור ל-‎/‎ שנשלח בקבוצה חייב להיראות
      כמו ‎/‎. קישור שכבר נושא `?region=` הוא חלק מהכתובת, ותצוגה מקדימה
      צריכה להראות את האזור שבקישור.

   ---------- למה זיהוי ה-IP לא בוחר שוק ----------

   ‏`context.geo` של Netlify הוא MaxMind לפי כתובת ה-IP. בישראל זה מיקום
   של הרישום של הטווח, לא של המכשיר. נבדק על שני חיבורים של בעל/ת האתר
   מעפולה (אוקטובר 2026):

   | IP | whois | MaxMind (מה שהאתר ראה) | ipinfo |
   | --- | --- | --- | --- |
   | 37.142.156.162 | AS12849 Hot-Net, ‏37.142.128.0/17, ‏BROADBAND-CABLES | תל אביב 32.0804, 34.7807 | חיפה |
   | 5.29.22.243 | AS12849 Hot-Net, ‏5.29.16.0/21, ‏BROADBAND | תל אביב 32.0804, 34.7807 | נהריה |

   שתי הנקודות נופלות בתיבה של `tel-aviv`, ולכן הפס "תל אביב-יפו נפתח
   בקרוב" עלה בעפולה. אלה טווחי כבלים, לא רק סלולר: אותו כשל ב-CGNAT של
   הסלולר, שבדרך כלל רשום במרכז. אין כאן אות שמבדיל/ה מנוי/ה בתל אביב
   ממנוי/ה בעפולה על אותו ספק. לכן ה-IP אינו שכבה בשרשרת. במקומו: קישור
   `?region=<slug>`, כתובת של שוק (`/tel-aviv`), בחירה בבורר, ו-GPS
   בלחיצה.

   ---------- ‏`soon` - שוק שעוד לא נפתח, בלי הפניה אוטומטית ----------

   מי שבחר/ה נתניה, שה-GPS מצא/ה אותה, או שפתח/ה `?region=netanya` ואז
   חזר/ה ל-‎/‎, רואה/ה פס "נפתחים בקרוב". **לא הפניה** מדף הבית סתם -
   מי שחיפש/ה דירה נשאר/ת בדף שביקש/ה. ה-IP אינו מקור. */

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse|headless/i;

export type Geo = {
  latitude?: number;
  longitude?: number;
  country?: { code?: string };
};

export type Decision = {
  location: string | null;   // ‏302 לכאן, או null
  geoCookie: string | null;  // ערך לעוגיית shuk_geo, או null. ה-IP כבר לא ממלא את זה
  soon: string | null;       // ‏slug לעוגיית shuk_soon - שוק שעוד לא נפתח, או null
  marketCookie: string | null; // ‏slug|source לעוגיית shuk_market, או null
  clearSoon: boolean;        // למחוק shuk_soon ישנה (פס שנקבע מזיהוי IP)
};

const REGION_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* מוריד פרמטר אחד בלי לערבל את השאר ובלי לקודד מחדש ערכים (utm, עברית). */
export function withoutQueryParam(search: string, name: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return "";
  const kept = raw.split("&").filter((part) => {
    if (!part) return false;
    let key = part.split("=")[0] || "";
    try { key = decodeURIComponent(key.replace(/\+/g, " ")); } catch { /* השם כמו שהוא */ }
    return key !== name;
  });
  return kept.length ? "?" + kept.join("&") : "";
}

function fresh(partial: Partial<Decision> = {}): Decision {
  return {
    location: null,
    geoCookie: null,
    soon: null,
    marketCookie: null,
    clearSoon: false,
    ...partial,
  };
}

function hasNamedCookie(header: string, name: string): boolean {
  return new RegExp(`(?:^|;\\s*)${name}=`).test(header || "");
}

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
  opts: {
    cookie: string;
    userAgent: string;
    geo?: Geo | null;
    search: string;
    /* ‏`?region=<slug>`. null/undefined = אין פרמטר. מחרוזת (גם ריקה) = יש. */
    region?: string | null;
    /* עמוד תוצאות (`?deal=sale` וחבריו) נשאר במקומו. הקישור נזכר, בלי להחליף דף. */
    hasContent?: boolean;
  },
): Decision {
  const search = opts.search || "";
  const hadSoon = hasNamedCookie(opts.cookie || "", "shuk_soon");

  /* קישור מפורש גובר על עוגייה ועל כל ניחוש, גם אצל סורק: זו הכתובת
     עצמה, לא מיקום. פרמטר לא מוכר יורד כדי שלא יישאר עותק של ‎/‎. */
  if (opts.region != null) {
    const slug = String(opts.region).trim().toLowerCase();
    const rest = withoutQueryParam(search, "region");
    const home = "/" + rest;
    const m = REGION_RE.test(slug) ? reg.bySlug(slug) : null;
    if (!m) return fresh({ location: home });
    const marketCookie = `${m.slug}|link`;
    if (opts.hasContent || (m.live && m.isDefault)) {
      return fresh({
        location: home,
        marketCookie,
        soon: m.live ? null : m.slug,
        clearSoon: m.live && hadSoon,
      });
    }
    return fresh({
      location: m.path + rest,
      marketCookie,
      clearSoon: hadSoon,
    });
  }

  if (BOT.test(opts.userAgent || "")) return fresh();

  const chosen = cookieValue(opts.cookie || "", "shuk_market");
  if (chosen) {
    const m = reg.bySlug(chosen.split("|")[0]);
    if (m) {
      if (!m.live) return fresh({ soon: m.slug });
      if (m.isDefault) return fresh({ clearSoon: hadSoon });
      return fresh({ location: m.path + search, clearSoon: hadSoon });
    }
  }

  /* ‏opts.geo נשאר בחתימה כי search-pages מעביר את context.geo. הוא לא
     נקרא: ראו "למה זיהוי ה-IP לא בוחר שוק" למעלה. */
  void opts.geo;

  return fresh({ clearSoon: hadSoon });
}
