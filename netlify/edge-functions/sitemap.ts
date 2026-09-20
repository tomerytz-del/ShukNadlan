/* ============================================================================
   ‏sitemap.xml חי — הדפים הסטטיים מהקובץ, דפי הפירוט מהמסד
   ----------------------------------------------------------------------------
   ## הבעיה

   ‏sitemap.xml שבריפו מחזיק 18 כתובות סטטיות. דפי הפירוט — נכס, משרד,
   סוכן/ת, פרויקט, בעל/ת מקצוע וכתבה — נוצרים מהמסד, ולכן **אף אחד מהם
   לא היה בו**. אלה בדיוק הדפים שאמורים להביא תנועה אורגנית.

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

   ‏**3. כישלון מחזיר את הקובץ הסטטי.** כל שאילתה עטופה ב-timeout
   וב-try/catch ומחזירה רשימה ריקה בכשל, וכישלון כולל מחזיר את
   ‎sitemap.xml‎ כמו שהוא. ‏sitemap חלקי אינו מוחק כלום מהאינדקס — גוגל
   מתייחסת אליו כרמז ולא כרשימת מחיקה — ולכן חלקי עדיף על 500.

   ‏**4. אין ‎changefreq‎ ואין ‎priority‎ בערכים הדינמיים.** גוגל מתעלמת
   משניהם מזה שנים. ‎lastmod‎ דווקא נקרא, ולכן הוא נכתב מהמסד בכל מקום
   שיש בו חותמת זמן אמיתית — ומושמט במקום שאין (סוכנים ובעלי מקצוע).
   ‏lastmod מומצא גרוע מ-lastmod חסר: הוא מלמד את גוגל להתעלם ממנו.

   ## מטמון

   התשובה נשמרת ב-CDN של Netlify לשעה (‏stale-while-revalidate ליממה).
   ‏sitemap אינו דף שגולש/ת רואה, ואיחור של שעה בין פרסום נכס לבין הופעתו
   בו אינו משנה דבר מול מהירות הסריקה של גוגל — אבל הוא מונע שש שאילתות
   ל-Supabase בכל ביקור של כל סורק.

   ## הגבול

   גוגל מגבילה ‎sitemap‎ יחיד ל-50,000 כתובות. היום יש כאן כ-130, ולכן
   הגבול רחוק. כשמתקרבים אליו צריך לפצל ל-sitemap index — ומכיוון שזה
   לא יקרה בשקט, המספרים נכתבים כהערת XML בראש הקובץ.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";

const SITE = "https://shuknadlan.co.il";
const FETCH_TIMEOUT_MS = 2500;

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

/* ---------- הסוגים ---------- */

/* ‏key הוא שם הפרמטר בכתובת, בדיוק כפי שדף הפירוט קורא אותו:
   ‏property.html קורא ?id=, וכל השאר קוראים ?slug=. */
type Source = {
  name: string;
  page: string;
  key: "id" | "slug";
  field: string;
  lastmod?: string;
  query: string;
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
];

function entries(source: Source, rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const row of rows) {
    const value = String(row[source.field] ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);

    const loc = `${SITE}/${source.page}?${source.key}=${encodeURIComponent(value)}`;
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

    const rows = await Promise.all(SOURCES.map((s) => sbSelect(s.query)));

    const blocks: string[] = [];
    const counts: string[] = [];
    SOURCES.forEach((source, i) => {
      const urls = entries(source, rows[i]);
      counts.push(`${source.name}: ${urls.length}`);
      blocks.push(...urls);
    });

    if (!blocks.length) return fallback(); // כל השאילתות נכשלו

    const body =
      staticXml.slice(0, close) + blocks.join("\n") + "\n" + staticXml.slice(close);

    // ‏המספרים בראש הקובץ, מיד אחרי הצהרת ה-XML: `curl … | head -3` מספיק
    // כדי לראות שסוג שלם נעלם. גוגל מתעלמת מהערות.
    const note = `<!-- דפי פירוט מהמסד - ${counts.join(", ")} -->`;
    const decl = body.indexOf("?>");
    const out =
      decl === -1 ? note + "\n" + body
                  : body.slice(0, decl + 2) + "\n" + note + body.slice(decl + 2);

    return new Response(out, { status: 200, headers: XML_HEADERS });
  } catch {
    return fallback(); // ‏sitemap ישן עדיף על 500
  }
}

export const config: Config = {
  path: "/sitemap.xml",
};
