/* ============================================================================
   תגיות שיתוף לדפי הפירוט — מוזרקות בשרת, לפני שהדפדפן מקבל את הדף
   ----------------------------------------------------------------------------
   ## הבעיה

   שבעת דפי הפירוט — נכס, משרד, סוכן/ת, פרויקט, חברה יזמית, בעל/ת מקצוע
   וכתבה — הם קבצים סטטיים: הכותרת בהם היא "נכס | שוק נדל״ן", והתוכן
   האמיתי נטען ב-JS אחרי שהדף כבר בדפדפן.

   הסורק של וואטסאפ **אינו מריץ JS**. הוא מושך את ה-HTML, מחפש תגיות
   ‎og:‎ — ולא מוצא אף אחת. התוצאה היא שקישור לנכס שסוכן/ת שולח/ת ללקוח/ה
   מופיע בשיחה ככתובת עירומה: בלי תמונה, בלי כותרת, בלי מחיר.

   בשוק שבו וואטסאפ הוא ערוץ ההפצה העיקרי, זה מחיר ישיר על כל שיתוף.
   אותו דבר בפייסבוק, בטלגרם ובתצוגה המקדימה של גוגל.

   ## מה הפונקציה עושה

   רצה על ה-edge לפני שהתשובה יוצאת, מושכת את הנכס/המשרד/הסוכן מ-Supabase,
   ומזריקה ל-‎<head>‎ תגיות ‎og:‎, ‎twitter:‎ ו-‎canonical‎. בדף נכס היא גם
   חושפת את גוף המודעה ומכניסה את תמונת השער, כדי שהפוטר לא יקפוץ
   וה-LCP לא יחכה ל-JS. שאר הדפים לא משתנים מעבר לתגיות.

   ## שני סוגי דפים, ולמה ההזרקה שונה בהם

   נכס, משרד וסוכן/ת אינם נושאים תגיות ‎og:‎ כלל, ולכן הן נכתבות כאן מאפס.

   פרויקט, חברה יזמית, בעל/ת מקצוע וכתבה **כן** נושאים אותן — עם ערכים
   כלליים ועם ‎id‎ (‏‎ogTitle‎, ‎metaDescription‎, ‎ogDescription‎, ‎ogImage‎),
   כי ה-JS שלהם ממלא אותן אחרי הטעינה. שם התפקיד כאן הוא **למלא את
   התגיות הקיימות ולא להוסיף חדשות**, משתי סיבות:

     • תגית ‎og:title‎ כפולה משאירה לסורק לבחור, והוא בוחר את הכללית.
     • ה-JS בדפים האלה כותב ‎el('ogTitle').content = …‎ **בלי בדיקת null**.
       הסרה של התגית הייתה זורקת ‎TypeError‎ באמצע ‎renderMeta‎ ושוברת את
       כל מה שבא אחריה בדף — כלומר ההזרקה לסורק הייתה משלמת בדף של הגולש/ת.

   ‏og:type נשאר כפי שהדף כתב אותו (‏article‎ לכתבה, ‎profile‎ לבעל/ת מקצוע),
   ונכתב כ-‎website‎ רק בדפים שאין בהם אחד.

   ## שלוש החלטות שחשוב להבין

   ‏**1. מפתח anon ולא service_role.** הפונקציה רואה בדיוק מה שגולש/ת
   אנונימי/ת רואה, ו-RLS חל עליה כרגיל. נכס שאינו ‎active‎ פשוט לא יימצא,
   והדף יוגש עם התגיות הכלליות. אין כאן שום הרשאה חדשה.

   ‏**2. מספר הבית ממוסך.** ‏docs/property-address-privacy.md קובע שדף
   הנכס מציג רחוב ושכונה ולא כתובת מלאה, ואומר במפורש שזה חל גם על מה
   שנראה בשיתוף. ‎maskHouseNumber‎ כאן היא העתק מדויק של זו שב-
   ‏property.html. **בלעדיה הפונקציה הזו הייתה מדליפה את מספר הבית לכל
   שיתוף בוואטסאפ** — כלומר הופכת את כלל הפרטיות לאות מתה.

   ‏**3. כישלון אינו noindex, ובנכס הוא גם אינו 200.** כל קריאת רשת עטופה
   ב-timeout קצר. כשל (‏5xx, ‏401, ‏timeout) **אינו** מקבל noindex: הסקה
   ממנו הייתה מוחקת נכסים חיים בגלל שנייה של Supabase איטי. בדף נכס הכשל
   יוצא 503 עם Retry-After ו-no-store, וה-HTML המקורי נשאר כדי שה-JS ימלא.
   בשאר דפי הפירוט הכשל עדיין מחזיר את התשובה המקורית כמו שהיא.

   ## ‏canonical, וכתובת אחת לכל דף

   ‏professional ו-article מקבלים גם ‎?slug=‎ וגם ‎?id=‎ (קישורים ישנים,
   ופרופיל שעוד לא נשמר פעם אחת). שתי הכתובות מגישות את אותו תוכן, וזה
   בדיוק המצב שגוגל קוראת לו תוכן משוכפל.

   לכן ה-‎canonical‎ כאן נבנה **מה-slug שחזר מהמסד**, ולא מהפרמטר שבכתובת:
   פנייה ב-‎?id=‎ מצהירה על ‎?slug=‎ כמקור. זו גם הכתובת היחידה שנכנסת
   ל-sitemap (‏docs/sitemap.md), ולכן השתיים מסכימות.

   ‏**ולכן דף פירוט אינו נושא תגית ‎canonical‎ סטטית בקובץ ה-HTML שלו** —
   בשונה מ-18 הדפים הסטטיים, שכן נושאים אחת (‏scripts/check_canonical.py).
   תגית סטטית ב-‎property.html‎ הייתה מצהירה ‎/property‎ בלי ‎?id=‎, ובמסלול
   הנפילה כאן — ‏Supabase איטי, נכס שאינו ‎active‎, כל ‎catch‎ בקובץ — היא
   הייתה נשארת בדף ומאחדת את **כל** הנכסים לכתובת אחת. כלומר תקלה זמנית
   בשרת הייתה מוחקת כל דפי הנכסים מהאינדקס. היום כשל כזה פשוט משאיר דף
   בלי ‎canonical‎, וזה מה שהיה לפני הפונקציה הזו.

   ## ודף פירוט שאין מאחוריו רשומה — ‎noindex‎

   ‏"דף בלי canonical" הוא מצב תקין כשהוא נדיר, אבל יש מצב שבו הוא **חוזר
   על עצמו בשבע כתובות זהות**: ‎/property‎ בלי ‎?id=‎, נכס שנמכר ואינו
   ‎active‎, ‎?slug=‎ שנמחק. בכל אלה הדף מציג "לא נמצא", וה-HTML זהה
   לחלוטין בין כתובת לכתובת. ‏Search Console קורא לאשכול הזה **"עותק
   משוכפל בלי שנבחר דף קנוני על ידי המשתמש"** — וזה בדיוק מה שהוא.

   התשובה כאן אינה ‎canonical‎ אלא ‎noindex,follow‎, ומההבחנה הזו נגזר גם
   ‎Fetched‎ למטה: המסלול נבחר **רק** כשהמסד ענה במפורש שאין רשומה
   (‏406/404), ולעולם לא כשלא הצלחנו לשאול. ‏canonical במקומו היה מאחד
   נכסים אמיתיים אל ‎/property‎ ברגע הראשון של Supabase איטי — הכשל שכל
   הסעיף שמעל נבנה כדי למנוע.

   בדף נכס, "אין רשומה" הוא **404** עם no-store (לא 200 שנשמר לדקה),
   והמשפט "הנכס לא נמצא" הוא פסקה ולא H1. H1 יחיד נשאר ‎#propTitle‎.
   אותו 404 גם למשרד ולסוכן/ת כשה-slug אינו קיים. ‎/agent‎ ו-‎/agency‎
   בלי slug מופנים (301) אל ‎/agents‎ ו-‎/agencies‎. שאר דפי הפירוט
   נשארים 200 עם noindex.

   ## מטמון

   תשובה שהתמלאה נשמרת ב-CDN של Netlify לדקה (‏stale-while-revalidate
   לחמש), כדי שלא תצא קריאה ל-Supabase על כל צפייה. הדפדפן עצמו מקבל
   ‎must-revalidate‎. ‏404 ו-503 של דף נכס הם no-store: נכס שפורסם אחר כך,
   או כשל של דקה, לא נתקעים במטמון. כשל מסד בדף נכס מגיש קודם את העותק
   המלא האחרון ב-200 (‏lib/last-good.ts); 503 רק כשאין עותק. שאר דפי
   הפירוט אינם עוברים ל-503 בכשל.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
/* ‏גוף הכתבה ו"על המשרד": אותו קוד שהדפדפן מריץ, מיובא לתופעת הלוואי שלו
   (‏globalThis.ShukArticleBody / ShukAgencyAbout) - כך מה שהשרת כותב והטקסט
   שה-JS כותב אחריו אינם יכולים להתפצל. */
import "../../assets/article-body.js";
import "../../assets/agency-about.js";
/* ‏עיר המשרד וכותרת הדף - אותו כלל ש-agency.js כותב אחרי הטעינה. */
import "../../assets/markets.js";
import "../../assets/agency-place.js";
import { lastGoodKey, recall, remember, waitUntilOf } from "./lib/last-good.ts";
import "../../assets/air-living.js";
import "../../assets/listing-title.js";

type ArticleBlock = { tag: "p" | "h2" | "blockquote" | "ul"; text?: string; items?: string[]; lead?: boolean };
const shared = globalThis as unknown as {
  ShukArticleBody: { parse: (text: string) => ArticleBlock[] };
  ShukAgencyAbout: { paragraphs: (a: Record<string, unknown>) => string[] };
  ShukAgencyPlace?: {
    officeCity: (a: Record<string, unknown>) => string;
    title: (name: unknown, city: string) => string;
  };
};

const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";

const SITE = "https://shuknadlan.co.il";
const DEFAULT_IMAGE = `${SITE}/assets/logo-shuknadlan.png`;
/* ‏לוגו הארגון בנתונים המובנים. ה-PNG של השיתוף הוא 512×610, וגוגל מבקשת
   לוגו ריבועי (לפחות 112). הריבוע הוא אותו סמל בריפוד, לא מתיחה. */
const ORG_LOGO = `${SITE}/assets/logo-shuknadlan-square.png`;
const SITE_NAME = "שוק נדל״ן";
const FETCH_TIMEOUT_MS = 1200;

/* ---------- עזרים ---------- */

/* אותה בריחה כמו assets/esc.js. הערכים כאן מגיעים מהמסד — כותרת שסוכן/ת
   הקליד/ה — ונכנסים ל-content="…" של תגית meta. */
function esc(s: unknown): string {
  return String(s === null || s === undefined ? "" : s)
    .replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
    );
}

/* העתק מדויק של maskHouseNumber ב-property.html. מוחקת מספר ולא מילה:
   דורשת גבול ספרה משני הצדדים, כדי ש-"52" לא ייחתך מתוך "152" ולא מתוך
   "128 מ״ר" שבאותה כותרת. */
function maskHouseNumber(text: unknown, houseNumber: unknown): string {
  const t = String(text || "");
  const hn = String(houseNumber ?? "").trim();
  if (!t || !hn) return t;
  const re = new RegExp(
    "(^|[^\\d])" + hn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d)",
    "g",
  );
  return t
    .replace(re, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([,·])/g, "$1")
    .replace(/^[\s,·—–-]+|[\s,·—–-]+$/g, "")
    .trim();
}

function clamp(s: string, max: number): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/* כתובת מוחלטת: הסורק של וואטסאפ אינו פותר נתיבים יחסיים ב-og:image. */
function absolute(u: unknown): string {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return SITE + (s.startsWith("/") ? s : "/" + s);
}

/* כתובת תמונה שנכנסת ל-src. רק http(s) על הדומיינים שלנו, או נתיב יחסי
   באתר. javascript: ומארח זר לא נכתבים לדף. אותו רעיון כמו safeImageUrl
   ב-agency.js, עם הגבלת דומיין כי כאן הכתובת מגיעה מהמסד אל ה-HTML. */
function safeImageUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s || s.startsWith("//")) return "";
  if (s.startsWith("/") || s.startsWith("assets/")) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const host = u.hostname.toLowerCase();
    if (host === "obookujgolazrwycsiyn.supabase.co" || host === "shuknadlan.co.il" || host === "www.shuknadlan.co.il") {
      return s;
    }
  } catch { /* לא כתובת */ }
  return "";
}

/* ‏שלוש תשובות ולא שתיים, וההפרדה בין השתיים האחרונות היא כל העניין:
   ‏"אין רשומה כזו" ו-"לא הצלחנו לשאול" נראים אותו דבר מכאן — שניהם חוסר
   מידע — אבל ההשלכה שלהם הפוכה. על הראשון מותר להסיק שאין דף לאנדקס
   (‏noindex למטה); על השני אסור להסיק דבר, כי הסקה ממנו הייתה מוחקת
   נכסים חיים מגוגל בגלל שנייה אחת של Supabase איטי. */
type Fetched =
  | { kind: "row"; row: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "error"; status?: number };

async function sbFetch(path: string): Promise<Fetched> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/vnd.pgrst.object+json",
      },
      signal: ctrl.signal,
    });
    /* ‏PostgREST עם ‎Accept: vnd.pgrst.object+json‎ מחזיר 406 (‏PGRST116)
       כשלא חזרה בדיוק שורה אחת, ו-404 לנתיב שאינו קיים. **רק שני אלה**
       הם "אין רשומה". ‏401/403 (מפתח שהוחלף, מדיניות RLS שהשתנתה), 5xx,
       ‏timeout ו-JSON פגום הם "לא יודעים" — ומי שיסווג אותם כאן כחוסר
       רשומה יקבל noindex על כל האתר בבת אחת, בשקט. */
    if (res.status === 404 || res.status === 406) return { kind: "missing" };
    if (!res.ok) return { kind: "error", status: res.status };
    const row = await res.json();
    // ‏גרסה עתידית שתחזיר 200 עם null במקום 406 עדיין תיקרא נכון
    return row && typeof row === "object" ? { kind: "row", row } : { kind: "missing" };
  } catch {
    return { kind: "error" }; // ‏timeout, רשת, JSON פגום — הדף יוצא כמו שהוא
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- בניית התגיות לכל סוג דף ---------- */

type Meta = {
  title: string;
  description: string;
  image: string;
  canonical: string;
  /* רק לכתבה — ‎article:published_time‎ */
  publishedAt?: string;
  /* ‏נתונים מובנים (JSON-LD): נכס, משרד, סוכן/ת וכתבה. ראו "תוכן לסורק" למטה. */
  jsonLd?: unknown;
  /* ‏אלמנטים בדף שמתמלאים בטקסט כבר בשרת, לפי id. ה-JS כותב אליהם שוב
     אחר כך, אותו ערך בדיוק - כך שבדפדפן אין שינוי, ומי שאינו מריץ JS
     רואה מודעה ולא "-". */
  fills?: { id: string; text: string }[];
  /* ‏אלמנטים שה-hidden שלהם יורד יחד עם המילוי (‏descSection) */
  reveal?: string[];
  /* ‏אלמנט ריק שמקבל מבנה ולא רק טקסט (‏גוף הכתבה, "על המשרד"). ה-HTML
     נבנה כאן בבריחה מלאה, וה-JS בונה אחריו את אותו מבנה ב-textContent. */
  inner?: { id: string; html: string }[];
  /* דף נכס: חושפים את המודעה, שומרים מקום לסרגל, ומכניסים את תמונת השער.
     placeholder: אין תמונה ואין פוסטר, והשער הוא קובץ הפלטפורמה. */
  paint?: { count: number; html: string; lcp: string; placeholder?: boolean };
  /* דף משרד: חושפים את התוכן כבר ב-HTML (agency-ready), ועם תמונת נושא
     גם has-cover. preloadImage היא תמונת ה-LCP, אותה כתובת כמו ה-img. */
  bodyClass?: string;
  preloadImage?: string;
  /* ‏דף נכס בלי עיר ומחוץ לתיבת השוק (‏P0-A2): 200 עם כל התגיות, ועוד noindex */
  noindex?: boolean;
};

/* ‏מה שפונקציית ה-meta מחזירה: תגיות, "אין רשומה" (‏noindex), או null —
   לא הצלחנו לברר, ואז הדף יוצא כמו שהוא בדיוק כמו קודם. */
type MetaResult = Meta | "missing" | null;

const nis = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? "₪" + v.toLocaleString("he-IL") : "";
};

/* ‏PostgREST מחזיר numeric כמחרוזת — ‎rooms‎ מגיע כ-"4.0", ו-‎`${p.rooms}`‎
   היה כותב "4.0 חד׳" בכל תצוגה מקדימה בוואטסאפ. חצי חדר קיים ומשמעותי
   ("3.5 חד׳"), ולכן רק האפס הסופי נופל ולא כל השבר. */
const num = (n: unknown): string => {
  // ‏null ומחרוזת ריקה הם שניהם 0 אחרי Number() — נכס מסחרי בלי חדרים היה
  // מקבל "0 חד׳" בתצוגה המקדימה. ערך חסר או אפס פשוט לא נכתב.
  if (n === null || n === undefined || String(n).trim() === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return String(Number(v.toFixed(1)));
};

/* ---------- תוכן לסורק: מה שמנועי AI ותוצאות עשירות צריכים ----------

   ‏og: מספיק לתצוגה מקדימה בוואטסאפ, אבל לא לשני קוראים אחרים:

   ‏1. **גוגל, לתוצאה עשירה.** בלי נתונים מובנים היא יודעת שיש כאן דף, לא
      שיש כאן נכס במחיר מסוים עם מספר חדרים. ‏RealEstateListing + Offer
      אומרים את זה במפורש.
   ‏2. **מנועי AI** (ChatGPT, Perplexity, Claude) **אינם מריצים JS.** עד
      9.10.2026 ה-H1 בדף נכס היה "-" והתיאור ריק, כי שניהם נכתבים ב-
      ‏assets/property.js אחרי הטעינה. סורק כזה ראה כותרת ותיאור קצר
      בתגיות, וגוף דף ריק - כלומר אין מה לצטט.

   לכן הכותרת והתיאור נכתבים כאן גם לתוך הדף עצמו (‏fills), באותו id
   שה-JS כותב אליו אחר כך - **אותו ערך בדיוק**, ולכן בדפדפן לא משתנה דבר.
   בחירת התיאור היא העתק של ‎renderDescription‎: הנוסח השיווקי, חוץ מנוסח
   מתיישן כשיש תיאור מודעה (‏docs/marketing-description.md).

   כותרת ה-H1, שורת הכתובת ו-streetAddress כוללים רחוב ומספר בית, אותו
   נוסח כמו publicHeadline ב-assets/property.js. גוש, חלקה וקואורדינטות
   לא נכנסים. docs/property-address-privacy.md. */

const APARTMENT_TYPES = new Set(["דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "טריפלקס"]);
const HOUSE_TYPES = new Set(["בית פרטי/קוטג'", "דו משפחתי"]);

/* ‏Accommodation (דירה/בית) נושא חדרים, שטח וקומה; נכס מסחרי או מגרש אינו
   "מקום לגור בו", ולכן הוא Place - בלי השדות שאינם שייכים לו. */
/* העתק של publicHeadline / publicStreetLine ב-assets/property.js.
   שינוי באחד מחייב את אותו שינוי בשני. */
function streetNameOf(p: Record<string, unknown>): string {
  const raw = String(p.street || p.address || "").trim();
  return maskHouseNumber(raw, p.house_number).replace(/^רחוב\s+/, "").replace(/\s+/g, " ").trim();
}

function publicStreetLine(p: Record<string, unknown>): string {
  const street = streetNameOf(p);
  const hn = String(p.house_number ?? "").trim();
  if (!street) return "";
  return hn ? `${street} ${hn}` : street;
}

function publicHeadline(p: Record<string, unknown>): string {
  const type = String(p.property_type || "").trim();
  const street = streetNameOf(p);
  const city = String(p.city || "").trim();
  const hn = String(p.house_number ?? "").trim();
  const rooms = num(p.rooms);
  const fallback = maskHouseNumber(p.title, p.house_number) || String(p.title || "נכס");
  if (!type || !street) return fallback;
  let head = type;
  if (rooms) head += ` ${rooms} חד׳`;
  head += ` ב${street}`;
  if (hn) head += ` ${hn}`;
  if (city) head += `, ${city}`;
  return head;
}

/* מבדיל כותרת רק כשיש עוד מודעה פעילה עם אותו publicHeadline
   (כמה משרדים באותה כתובת). כותרת יחידה נשארת בדיוק כמו שהייתה.
   אותו סדר ב-assets/property.js (‏distinctTitleSuffix). */
function bitSqm(p: Record<string, unknown>): string {
  const n = num(p.size_sqm);
  return n ? `${n} מ״ר` : "";
}
function bitFloor(p: Record<string, unknown>): string {
  if (p.floor === null || p.floor === undefined || String(p.floor).trim() === "") return "";
  const floor = Number(p.floor);
  if (!Number.isFinite(floor)) return "";
  return floor === 0 ? "קומת קרקע" : `קומה ${String(floor)}`;
}
function bitDeal(p: Record<string, unknown>): string {
  if (p.deal_type === "rent") return "להשכרה";
  if (p.deal_type === "sale") return "למכירה";
  return "";
}
/* מחיר חסר או 0 אינו מבדיל. nis(null) הוא "₪0", וזה אסור בכותרת. */
function bitPrice(p: Record<string, unknown>): string {
  const v = Number(p.price);
  if (!Number.isFinite(v) || v <= 0) return "";
  return "₪" + v.toLocaleString("he-IL");
}

function titleSuffix(self: Record<string, unknown>, rows: Record<string, unknown>[]): string {
  const base = publicHeadline(self);
  const group = rows.filter((row) => publicHeadline(row) === base);
  const selfId = String(self.id || "");
  if (!group.some((row) => String(row.id || "") === selfId)) group.push(self);
  if (group.length < 2) return "";
  const picks = [bitSqm, bitFloor, bitDeal, bitPrice];
  const parts: string[] = [];
  let left = group;
  for (const pick of picks) {
    const mine = pick(self);
    if (!mine) continue;
    const same = left.filter((row) => pick(row) === mine);
    if (same.length < left.length) {
      parts.push(mine);
      left = same;
      if (left.length < 2) break;
    }
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/* אותו pageTitle כמו ב-assets/listing-title.js: חותכים רק את הבסיס,
   הסיומת והמותג נשארים, והאורך הכולל עד 90. */
function pageTitle(base: string, suffix: string): string {
  const shared = (globalThis as unknown as {
    ShukListingTitle: { pageTitle: (base: string, suffix: string) => string };
  }).ShukListingTitle;
  return shared.pageTitle(base, suffix);
}

/* משפט קבוע לתיאור קצר מ-70 תווים. סוג העסקה וסוג הנכס נכנסים אליו.
   כיווני אוויר ושטח סלון (‏metaClause) נשארים בנוסח המספרי. */
const LISTING_NOUN: Record<string, string> = {
  "דירה": "דירה",
  "דירת גן": "דירת גן",
  "דירת גג": "דירת גג",
  "גג/פנטהאוז": "פנטהאוז",
  "דופלקס": "דופלקס",
  "טריפלקס": "טריפלקס",
  "בית פרטי/קוטג'": "בית פרטי",
  "דו משפחתי": "דו משפחתי",
  "משרדים": "משרד",
  "חנויות/שטח מסחרי": "חנות",
  "מגרש": "מגרש",
  "מחסן": "מחסן",
  "אולם": "אולם",
  "בניין": "בניין",
};

/* מקום הוא שם שכונה או שם עיר בלבד. רחוב ומספר בית לא נכנסים.
   מילה אחת לסוג העסקה: למכירה, או להשכרה. */
function tailSentence(p: Record<string, unknown>, place: string): string {
  const noun = LISTING_NOUN[String(p.property_type || "").trim()] || "נכס";
  const deal = p.deal_type === "rent" ? "להשכרה" : "למכירה";
  return `${noun} ${deal} ב${place}. תמונות, מפה ופנייה מהירה דרך האתר.`;
}

function listingPlace(p: Record<string, unknown>): string {
  const hood = String((p.neighborhoods as { name?: string } | null)?.name || "").trim();
  const city = String(p.city || "").trim();
  if (hood && hood !== city) return hood;
  return city;
}

const DESC_SHORT = 70;
const DESC_MAX = 155;

function listingDescription(
  facts: string[],
  air: string,
  tail: string,
): string {
  const lead = [...facts, air].filter(Boolean).join(" · ");
  if (lead.length >= DESC_SHORT) return clamp(lead, 200);
  let kept = facts.slice();
  const build = () => {
    const head = [...kept, air].filter(Boolean).join(" · ");
    return head ? `${head} ${tail}` : tail;
  };
  let text = build();
  while (kept.length && text.length > DESC_MAX) {
    kept.pop();
    text = build();
  }
  return text.length <= DESC_MAX ? text : clamp(text, DESC_MAX);
}

/* אותו siblingFilter כמו ב-assets/listing-title.js. בלי רחוב: עיר, סוג,
   ורחוב וכתובת ריקים. שכונה לא מסוננת. כשל או עמוד חסר: null, בלי מבדיל. */
function siblingFilter(p: Record<string, unknown>): string | null {
  const shared = (globalThis as unknown as {
    ShukListingTitle: {
      siblingFilter: (row: Record<string, unknown>) => string;
      SIBLING_PAGE: number;
    };
  }).ShukListingTitle;
  const filter = shared.siblingFilter({
    city: p.city,
    property_type: p.property_type,
    streetName: streetNameOf(p),
  });
  return filter || null;
}

function siblingPageSize(): number {
  return (globalThis as unknown as {
    ShukListingTitle: { SIBLING_PAGE: number };
  }).ShukListingTitle.SIBLING_PAGE;
}

async function siblingRows(p: Record<string, unknown>): Promise<Record<string, unknown>[] | null> {
  const filter = siblingFilter(p);
  if (!filter) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const all: Record<string, unknown>[] = [];
  try {
    const pageSize = siblingPageSize();
    for (let offset = 0; offset <= pageSize * 5; offset += pageSize) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/properties?${filter}&offset=${offset}`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Accept: "application/json",
          },
          signal: ctrl.signal,
        },
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data)) return null;
      all.push(...data as Record<string, unknown>[]);
      if (data.length < pageSize) return all;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* שכונות עפולה שה-slug שלהן ידוע (אותה רשימה כמו HOODS ב-silo-render.js).
   בלי slug לא ממציאים כתובת /n/. */
const AFULA_HOODS: Record<string, string> = {
  "אזור התעשייה": "אזור-התעשייה",
  "גבעת המורה": "גבעת-המורה",
  "דרום העיר": "דרום-העיר",
  "השכונה הצפון מערבית": "השכונה-הצפון-מערבית",
  "לב העמק C1": "לב-העמק-c1",
  "מזרח העיר": "מזרח-העיר",
  "מערב העיר (שיכון גאולים)": "מערב-העיר-שיכון-גאולים",
  "מרכז העיר": "מרכז-העיר",
  "עפולה הירוקה": "עפולה-הירוקה",
  "עפולה עלית": "עפולה-עלית",
  "רובע יזרעאל": "רובע-יזרעאל",
};

function listingCrumbs(p: Record<string, unknown>, title: string, url: string) {
  const city = String(p.city || "").trim();
  const hood = String((p.neighborhoods as { name?: string } | null)?.name || "").trim();
  const items: Record<string, unknown>[] = [
    { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE}/` },
  ];
  if (city) {
    const cityItem: Record<string, unknown> = { "@type": "ListItem", position: items.length + 1, name: city };
    if (city === "עפולה") cityItem.item = `${SITE}/`;
    items.push(cityItem);
  }
  if (hood && hood !== city) {
    const slug = city === "עפולה" ? AFULA_HOODS[hood] : "";
    const hoodItem: Record<string, unknown> = { "@type": "ListItem", position: items.length + 1, name: hood };
    if (slug) hoodItem.item = `${SITE}/n/afula/${encodeURIComponent(slug)}`;
    items.push(hoodItem);
  }
  items.push({ "@type": "ListItem", position: items.length + 1, name: title, item: url });
  return items;
}

function listingSubject(p: Record<string, unknown>, title: string, street: string) {
  const type = String(p.property_type || "");
  const kind = APARTMENT_TYPES.has(type) ? "Apartment" : HOUSE_TYPES.has(type) ? "SingleFamilyResidence" : "Place";
  const subject: Record<string, unknown> = {
    "@type": kind,
    name: title,
    address: {
      "@type": "PostalAddress",
      ...(street ? { streetAddress: street } : {}),
      ...(p.city ? { addressLocality: String(p.city) } : {}),
      addressCountry: "IL",
    },
  };
  if (kind !== "Place") {
    const rooms = num(p.rooms);
    if (rooms) subject.numberOfRooms = Number(rooms);
    const size = num(p.size_sqm);
    if (size) subject.floorSize = { "@type": "QuantitativeValue", value: Number(size), unitCode: "MTK" };
    if (p.floor !== null && p.floor !== undefined && String(p.floor).trim() !== "") {
      subject.floorLevel = String(p.floor);
    }
    const airLiving = (globalThis as { ShukAirLiving?: {
      jsonLd: (dirs: unknown, sqm: unknown) => Array<Record<string, unknown>>;
    } }).ShukAirLiving;
    const extra = airLiving ? airLiving.jsonLd(p.air_directions, p.living_room_sqm) : [];
    if (extra.length) subject.additionalProperty = extra;
  }
  return subject;
}

function listingJsonLd(
  p: Record<string, unknown>, url: string, title: string, description: string,
  images: string[], street: string,
) {
  const price = Number(p.price);
  const listing: Record<string, unknown> = {
    "@type": "RealEstateListing",
    "@id": `${url}#listing`,
    url,
    name: title,
    inLanguage: "he",
    about: listingSubject(p, title, street),
  };
  if (description) listing.description = clamp(description, 500);
  if (images.length) listing.image = images;
  if (p.updated_at) listing.dateModified = String(p.updated_at);
  if (Number.isFinite(price) && price > 0) {
    listing.offers = {
      "@type": "Offer",
      price,
      priceCurrency: "ILS",
      availability: "https://schema.org/InStock",
      businessFunction: p.deal_type === "rent"
        ? "http://purl.org/goodrelations/v1#LeaseOut"
        : "http://purl.org/goodrelations/v1#Sell",
    };
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      listing,
      {
        "@type": "BreadcrumbList",
        itemListElement: listingCrumbs(p, title, url),
      },
    ],
  };
}

/* ‏התוויות הן עותק של assets/property.js (‏FEATURE_LABELS, CONDITION_LABELS,
   PROJECT_STATUS_LABELS, CONDITION_HIGHLIGHTS). הקובץ אינו מודול, ולכן
   אי אפשר לייבא אותו לכאן. שינוי שם בעברית חייב לקרות בשני המקומות. */
const FEATURE_LABELS: Record<string, string> = {
  moshav_kibbutz_only: "במושב/קיבוץ", price_dropped: "המחיר ירד לאחרונה",
  parking: "חניה", elevator: "מעלית", balcony: "מרפסת", sun_balcony: "מרפסת שמש", ac: "מיזוג", bars: "סורגים",
  accessible: "גישה לנכים", renovated_feature: "משופצת", furnished: "מרוהטת", mamad: "ממ״ד", exclusive: "בבלעדיות",
  building_shelter: "מקלט בבניין", mamak: "ממ״ק", storage: "מחסן", high_ceiling: "תקרה גבוהה", cameras: "מצלמות",
  kitchenette: "מטבחון", alarm: "אזעקה", meeting_room: "חדר ישיבות", loading_ramp: "רמפת העמסה",
  comms: "תקשורת", cold_room: "חדר קירור", ev_charger: "עמדת טעינה לרכב חשמלי",
};
const CONDITION_LABELS: Record<string, string> = {
  new_from_contractor: "חדש מקבלן", new: "חדש", renovated: "משופץ",
  maintained: "שמור", needs_renovation: "דרוש שיפוץ",
};
const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: "תכנון ראשוני", permit_requested: "הוגשה בקשה להיתר",
  permit_issued: "ניתן היתר בנייה", construction_complete: "הבנייה הסתיימה",
};
const CONDITION_HIGHLIGHTS: Record<string, string> = {
  new_from_contractor: "חדש מקבלן", new: "נכס חדש", renovated: "משופץ", maintained: "במצב שמור",
};
const PROTECTION_FEATURES = ["mamad", "mamak", "building_shelter"];
const LOCATION_WORD: Record<string, string> = { unit: "בנכס", building: "בבניין" };

function heNum(n: unknown): string {
  if (n === null || n === undefined || String(n).trim() === "") return "";
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v.toLocaleString("he-IL") : "";
}

function agencyOf(p: Record<string, unknown>): string {
  const a = p.agencies;
  const row = Array.isArray(a) ? a[0] : a;
  if (!row || typeof row !== "object") return "";
  return String((row as { name?: string }).name || "");
}

/* ‏אותו פירוק של priceParts / priceFlat ב-property.js, בלי האייקון. */
function priceBits(p: Record<string, unknown>): { num: string; flat: string; html: string } | null {
  const n = heNum(p.price);
  if (!n) return null;
  const vat = p.category === "commercial" && p.price_includes_vat !== true ? " + מע״מ" : "";
  // יחידת המחיר (‏price_unit, docs/price-unit.md): 'sqm' = למ״ר, ריק = לפי סוג העסקה
  const unit = p.price_unit || (p.deal_type === "rent" ? "month" : "total");
  const per = unit === "sqm" ? (p.deal_type === "rent" ? " למ״ר / חודש" : " למ״ר") : unit === "month" ? " / חודש" : "";
  const suffix = per + vat;
  const num = `${n} ₪`;
  const html = esc(num) + (suffix ? `<span class="suffix">${esc(suffix)}</span>` : "");
  return { num, flat: num + suffix, html };
}

function floorLabel(p: Record<string, unknown>): string {
  if (p.floor === null || p.floor === undefined || p.floor === "") return "";
  const floor = Number(p.floor);
  if (!Number.isFinite(floor)) return "";
  const base = floor === 0 ? "קומת קרקע" : "קומה " + String(p.floor);
  return p.total_floors ? base + " מ־" + p.total_floors : base;
}

function specPillsHtml(p: Record<string, unknown>): string {
  const isRent = p.deal_type === "rent";
  const moveIn = p.move_in_date
    ? new Date(String(p.move_in_date)).toLocaleDateString("he-IL")
    : (p.move_in_soon ? "כניסה מיידית" : "");
  const pills: { v: string; k: string }[] = [];
  const add = (v: string, k: string) => { if (v) pills.push({ v, k }); };
  if (heNum(p.size_sqm)) add(heNum(p.size_sqm) + " מ״ר", "שטח הנכס");
  if (heNum(p.rooms)) add(heNum(p.rooms) + " חדרים", "חדרים");
  add(floorLabel(p), p.floor === 0 || p.floor === "0" ? "גישה ישירה" : "קומה");
  if (heNum(p.price_per_sqm)) add(heNum(p.price_per_sqm) + " ₪", isRent ? "למ״ר לחודש" : "מחיר למ״ר");
  if (heNum(p.built_size_sqm)) add(heNum(p.built_size_sqm) + " מ״ר", "שטח בנוי");
  if (heNum(p.garden_sqm)) add(heNum(p.garden_sqm) + " מ״ר", "גינה");
  const airLiving = (globalThis as { ShukAirLiving?: {
    customerLivingLine: (v: unknown) => string;
    customerAirLine: (v: unknown) => string;
  } }).ShukAirLiving;
  if (airLiving) {
    const living = airLiving.customerLivingLine(p.living_room_sqm);
    const air = airLiving.customerAirLine(p.air_directions);
    if (living) add(living, "");
    if (air) add(air, "");
  }
  add(CONDITION_LABELS[String(p.condition || "")] || "", "מצב הנכס");
  add(moveIn, "תאריך כניסה");
  add(PROJECT_STATUS_LABELS[String(p.project_status || "")] || "", "סטטוס הפרויקט");
  if (p.furniture_details) add(String(p.furniture_details), "ריהוט");
  if (heNum(p.maintenance_fee)) add(heNum(p.maintenance_fee) + " ₪ לחודש", "ועד בית / דמי ניהול");
  if (heNum(p.arnona)) {
    add(heNum(p.arnona) + (p.category === "commercial" ? " ₪ לחודש" : " ₪ לחודשיים"), "ארנונה");
  }
  return pills.map((c) =>
    `<div class="spec-pill"><span class="txt"><span class="v">${esc(c.v)}</span><span class="k">${esc(c.k)}</span></span></div>`
  ).join("");
}

function highlightsHtml(p: Record<string, unknown>): string {
  const features = Array.isArray(p.features) ? p.features.map(String) : [];
  const labels: string[] = [];
  const loc = (code: unknown, noun: string) =>
    LOCATION_WORD[String(code || "")] ? `${noun} ${LOCATION_WORD[String(code)]}` : "";
  const mamadLoc = loc(p.mamad_location, "ממ״ד");
  if (mamadLoc) labels.push(mamadLoc);
  for (const code of PROTECTION_FEATURES) {
    if (code === "mamad" && mamadLoc) continue;
    if (features.includes(code) && FEATURE_LABELS[code]) labels.push(FEATURE_LABELS[code]);
  }
  const cond = CONDITION_HIGHLIGHTS[String(p.condition || "")];
  if (cond) labels.push(cond);
  if (p.move_in_soon) labels.push("כניסה מיידית");
  const storageLoc = loc(p.storage_location, "מחסן");
  if (storageLoc) labels.push(storageLoc);
  const restLoc = loc(p.restrooms_location, "שירותים");
  if (restLoc) labels.push(restLoc);
  for (const code of features) {
    if (PROTECTION_FEATURES.includes(code)) continue;
    if (code === "storage" && storageLoc) continue;
    if (FEATURE_LABELS[code]) labels.push(FEATURE_LABELS[code]);
  }
  return labels.map((label) => `<div class="highlight"><span>${esc(label)}</span></div>`).join("");
}

/* קובץ מדיה, לא יוטיוב. אותו סיומת ש-videoEmbed ב-assets/property.js מכיר.
   בלי src על <video>: הניגון נשאר בלחיצה. */
function isFileVideo(raw: unknown): boolean {
  const s = String(raw || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    return /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(new URL(s).pathname);
  } catch {
    return false;
  }
}

/* תמונת שער מהאחסון שלנו יורדת בגודל התא, לא כ-JPEG המלא.
   הנוסחה זהה ל-posterForHero ב-assets/property.js: src ו-preload הם
   800, ו-srcset מוסיף 1200. כתובת אחרת ב-JS מוחקת את הצומת וההורדה
   מתחילה מחדש. כתובת שאינה object/public נשארת כמו שהיא. */
const HERO_OBJECT = "/storage/v1/object/public/";
const HERO_SIZES = "(min-width:640px) 640px, 100vw";

function heroRenderUrl(url: string, w: number, h: number): string {
  const at = url.indexOf(HERO_OBJECT);
  if (at < 0) return "";
  const path = url.slice(at + HERO_OBJECT.length).split(/[?#]/)[0];
  if (!path) return "";
  return url.slice(0, at) + "/storage/v1/render/image/public/" + path
    + `?width=${w}&height=${h}&resize=cover&quality=60`;
}

function heroImg(original: string, video: boolean): { tag: string; lcp: string } {
  const src800 = heroRenderUrl(original, 800, 500);
  const src1200 = heroRenderUrl(original, 1200, 800);
  const transformed = !!(src800 && src1200);
  const src = transformed ? src800 : original;
  const bits = [
    video ? 'class="bento-video-bg"' : "",
    'data-lcp="1"',
    `src="${esc(src)}"`,
    transformed ? `srcset="${esc(`${src800} 800w, ${src1200} 1200w`)}"` : "",
    transformed ? `sizes="${HERO_SIZES}"` : "",
    transformed ? `data-full="${esc(original)}"` : "",
    'alt=""',
    'fetchpriority="high"',
    video ? 'style="filter:none;transform:none"' : "",
    video ? 'aria-hidden="true"' : "",
    transformed
      ? 'onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')"'
      : "",
  ].filter(Boolean);
  return { tag: `<img ${bits.join(" ")}>`, lcp: src };
}

/* אותה ספירה ש-renderGallery כותב ל-data-count, כדי שהגובה לא יזוז
   כשה-JS מחליף את התאים. תמונת השער היא data-lcp.
   בלי תמונה ובלי פוסטר (גם סרטון בלי פוסטר) השער הוא img אמיתי של
   קובץ הפלטפורמה, לא רקע CSS שה-JS מוסיף אחרי השאילתה. lcp נשאר ריק
   כדי ש-heroHead לא יוסיף preload שני בסוף ה-head: ה-preload של
   הפלייסהולדר נכנס מיד אחרי charset, ורק במקרה הזה. */
const HERO_PLACEHOLDER = "/assets/property-placeholder.jpg";

function agencyLogoOf(p: Record<string, unknown>): { name: string; logo: string } {
  const a = p.agencies;
  const row = Array.isArray(a) ? a[0] : a;
  const name = row && typeof row === "object" ? String((row as { name?: string }).name || "").trim() : "";
  const raw = row && typeof row === "object" ? (row as { logo_url?: string }).logo_url : "";
  /* אותו סדר כמו agencyLogoOf / agencyNameOf ב-assets/property.js:
     לוגו המשרד, ובלי שם ובלי לוגו הלוגו של האתר. */
  const logo = absolute(raw) || (name ? "" : "assets/logo-shuknadlan.svg");
  return { name, logo };
}

/* 16/10 כמו .bento[data-count="1"] .bento-main. המידות על ה-img שומרות
   את היחס לפני שה-CSS נקרא. התא עצמו נשאר ביחס הזה, אז שום דבר לא זז
   כשה-JS מעביר לתוכו את תגית המחיר. */
function placeholderImg(): string {
  return `<img class="hero-placeholder" data-lcp="1" src="${HERO_PLACEHOLDER}" alt="" width="1600" height="1000" fetchpriority="high">`;
}

/* אותו מבנה ש-renderGallery בונה ל-.bento-empty. בלי זה שמירת הצומת
   הייתה משאירה תמונה בלי הלוגו וההודעה. */
function emptyHeroInner(p: Record<string, unknown>): string {
  const { name, logo } = agencyLogoOf(p);
  const mark = logo
    ? `<img class="empty-logo" src="${esc(logo)}" alt="${esc(name)}" onerror="this.remove()">`
    : `<span class="empty-logo empty-initial" aria-hidden="true">${esc((name || "?").trim()[0] || "?")}</span>`;
  const office = name ? `<div class="empty-agency">${esc(name)}</div>` : "";
  return `<div class="empty-inner">${mark}${office}<div class="empty-note">תמונות של הנכס יעלו בקרוב</div></div>`;
}

function heroPaint(p: Record<string, unknown>): { count: number; html: string; lcp: string; placeholder?: boolean } {
  const images = (Array.isArray(p.images) ? p.images : []).map(absolute).filter(Boolean);
  const video = isFileVideo(p.video_url);
  const poster = (video && absolute(p.video_poster_url)) || images[0] || "";
  if (!poster) {
    const cell = video
      ? `<div class="bento-cell bento-main bento-video">${placeholderImg()}</div>`
      : `<div class="bento-cell bento-main bento-empty">${placeholderImg()}${emptyHeroInner(p)}</div>`;
    return { count: 1, html: cell, lcp: "", placeholder: true };
  }
  const thumb = (src: string, last: boolean) =>
    `<div class="bento-cell bento-thumb${last ? " carries-count" : ""}"><img src="${esc(src)}" alt="" loading="lazy"></div>`;
  if (video) {
    const thumbEnd = Math.max(0, Math.min(images.length, 2));
    const count = 1 + thumbEnd;
    const shot = heroImg(poster, true);
    const main = `<div class="bento-cell bento-main bento-video">${shot.tag}</div>`;
    const thumbs = images.slice(0, thumbEnd).map((src, i) => thumb(src, i === thumbEnd - 1)).join("");
    return { count, html: main + thumbs, lcp: shot.lcp };
  }
  const thumbEnd = Math.max(1, Math.min(images.length, 3));
  const shot = heroImg(images[0], false);
  const main = `<div class="bento-cell bento-main">${shot.tag}</div>`;
  const extra = images.slice(1, thumbEnd);
  const thumbs = extra.map((src, i) => thumb(src, i === extra.length - 1)).join("");
  return { count: thumbEnd, html: main + thumbs, lcp: shot.lcp };
}

/* ‏המחיר, המאפיינים, המשרד והסוכן/ת - אותם id ש-renderProperty כותב.
   בלי אייקונים: ה-JS דורס את ה-innerHTML, והסורק צריך את הטקסט. */
function propertyVisible(p: Record<string, unknown>, agentDisplay: string): Pick<Meta, "fills" | "inner" | "reveal"> {
  const fills: { id: string; text: string }[] = [];
  const inner: { id: string; html: string }[] = [];
  const reveal: string[] = [];
  const price = priceBits(p);
  if (price) {
    inner.push({ id: "heroPriceNum", html: price.html });
    fills.push(
      { id: "heroPriceSub", text: heNum(p.price_per_sqm) ? heNum(p.price_per_sqm) + " ₪ למ״ר" : (p.deal_type === "rent" ? "להשכרה" : "למכירה") },
      { id: "agentPriceLabel", text: p.deal_type === "rent" ? "שכר דירה חודשי" : "מחיר מבוקש" },
      { id: "agentPriceValue", text: price.flat },
      { id: "sbPriceLabel", text: p.deal_type === "rent" ? "לחודש" : "מחיר" },
      { id: "sbPriceValue", text: price.flat },
    );
    reveal.push("heroPrice");
  }
  const office = agencyOf(p) || "משרד תיווך";
  fills.push({ id: "agencyName", text: office });
  fills.push({ id: "agentCardName", text: agentDisplay || agencyOf(p) || "צוות שוק נדל״ן" });
  if (p.agent2_name) {
    fills.push({ id: "agentName", text: "בשיתוף: " + String(p.agent2_name) });
    reveal.push("agentName");
  }
  const pills = specPillsHtml(p);
  if (pills) inner.push({ id: "specPills", html: pills });
  const highlights = highlightsHtml(p);
  if (highlights) {
    inner.push({ id: "highlightsList", html: highlights });
    reveal.push("highlightsSection");
  }
  return { fills, inner, reveal };
}

async function propertyMeta(id: string, canonical: string): Promise<MetaResult> {
  const cols =
    "title,house_number,address,street,city,sales_area,images,price,deal_type," +
    "rooms,size_sqm,status,neighborhoods(name)," +
    "description,marketing_description,marketing_description_stale,property_type,floor,updated_at," +
    "price_per_sqm,category,price_includes_vat,price_unit,total_floors,built_size_sqm,garden_sqm,condition," +
    "move_in_date,move_in_soon,project_status,furniture_details,maintenance_fee,arnona,features," +
    "air_directions,living_room_sqm," +
    "mamad_location,storage_location,restrooms_location,agent_id,agent2_name,agencies(name,logo_url)," +
    "video_url,video_poster_url,city_id,lat,lng";
  const base = `properties?id=eq.${encodeURIComponent(id)}&status=eq.active&select=`;
  let got = await sbFetch(base + encodeURIComponent(cols));
  // האתר עולה לפני המיגרציה. עמודה חסרה היא 400, לא "אין נכס".
  if (got.kind === "error" && got.status === 400) {
    const bare = cols.replace("air_directions,living_room_sqm,", "");
    got = await sbFetch(base + encodeURIComponent(bare));
  }
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const p = got.row;

  const title = publicHeadline(p);
  const hood = (p.neighborhoods as { name?: string } | null)?.name || p.sales_area || "";
  const street = publicStreetLine(p);
  const where = [street, hood && hood !== p.city ? hood : "", p.city]
    .filter(Boolean).join(", ");

  // יחידת המחיר (‏price_unit, docs/price-unit.md): 'sqm' = למ״ר, ריק = לפי סוג העסקה
  const unit = p.price_unit || (p.deal_type === "rent" ? "month" : "total");
  const facts = [
    nis(p.price) + (unit === "sqm" ? (p.deal_type === "rent" ? " למ״ר לחודש" : " למ״ר") : unit === "month" ? "/חוד׳" : ""),
    num(p.rooms) ? `${num(p.rooms)} חד׳` : "",
    num(p.size_sqm) ? `${num(p.size_sqm)} מ״ר` : "",
    where,
  ].filter(Boolean);
  const airClause = (globalThis as { ShukAirLiving?: {
    metaClause: (dirs: unknown, sqm: unknown) => string;
  } }).ShukAirLiving?.metaClause(p.air_directions, p.living_room_sqm) || "";
  const place = listingPlace(p);
  const description = place
    ? listingDescription(facts, airClause, tailSentence(p, place))
    : clamp([...facts, airClause].filter(Boolean).join(" · "), 200);

  const images = Array.isArray(p.images) ? p.images : [];

  // ‏העתק של renderDescription ב-assets/property.js - ראו "תוכן לסורק"
  const marketing = p.marketing_description_stale && p.description ? "" : p.marketing_description;
  const body = String(marketing || p.description || "").trim();

  /* הסוכן/ת והאחים באותה כתובת רצים יחד. כשל באחד אינו מפיל את הדף:
     בלי סוכן/ת נשאר שם המשרד, ובלי אחים הכותרת נשארת בלי מבדיל. */
  const agentP = p.agent_id
    ? sbFetch(
      `agency_members_public?id=eq.${encodeURIComponent(String(p.agent_id))}&select=${encodeURIComponent("display_name")}`,
    )
    : Promise.resolve(null);
  const [siblings, agent] = await Promise.all([siblingRows(p), agentP]);
  const suffix = siblings ? titleSuffix({ ...p, id }, siblings) : "";
  const agentDisplay = agent && agent.kind === "row" ? String(agent.row.display_name || "") : "";
  const visible = propertyVisible(p, agentDisplay);
  const offMarket = !p.city_id && !inMarketBox(p.lat, p.lng);

  return {
    title: pageTitle(title, suffix),
    description,
    image: absolute(images[0]) || DEFAULT_IMAGE,
    canonical,
    jsonLd: listingJsonLd(
      p, canonical, title, body,
      images.slice(0, 6).map(absolute).filter(Boolean), street,
    ),
    fills: [
      { id: "propTitle", text: title },
      { id: "propAddress", text: where },
      { id: "propDescription", text: body },
      ...(visible.fills || []),
    ],
    reveal: [...(body ? ["descSection"] : []), ...(visible.reveal || [])],
    inner: visible.inner,
    paint: heroPaint(p),
    noindex: offMarket,
  };
}

/* ‏תיבת השוק של עפולה והעמק - אותה DEFAULT_BOX של assets/market-scope.js
   ‏[latMin, lngMin, latMax, lngMax]. נכס בלי city_id נחשב בשוק רק אם הוא
   בתוכה (‏PR 1010, P0-A2); בלי קואורדינטות - מחוץ לשוק. */
const MARKET_BOX = [32.45, 35.05, 32.80, 35.60];
function inMarketBox(lat: unknown, lng: unknown): boolean {
  if (lat == null || lng == null || lat === "" || lng === "") return false;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a >= MARKET_BOX[0] && a <= MARKET_BOX[2] && b >= MARKET_BOX[1] && b <= MARKET_BOX[3];
}

/* ‏הסף של agency.html (‏MIN_REVIEWS_SHOWN) - מתחתיו הדף אינו מציג דירוג. */
const MIN_REVIEWS_RATED = 2;

/* ‏ספירת נכסים פעילים. כשל, timeout, או תשובה בלי Content-Range (הבדיקות
   שמחזירות את שורת המשרד לכל קריאה) מחזירים null - והדף יוצא בלי מספר,
   לא עם מספר מומצא. */
async function activeListingCount(agencyId: string): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?agency_id=eq.${encodeURIComponent(agencyId)}&status=eq.active&select=id`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
          Prefer: "count=exact",
          Range: "0-0",
        },
        signal: ctrl.signal,
      },
    );
    const range = res.headers.get("content-range") || "";
    const m = /\/(\d+)\s*$/.exec(range);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function countPhrase(n: number): string {
  if (n === 0) return "אין כרגע נכסים פעילים";
  if (n === 1) return "נכס פעיל אחד";
  return `${n} נכסים פעילים`;
}

/* ‏בלי עיר ובלי ספירה נשאר בדיוק הטקסט הישן (aboutText). */
function agencyBlurb(name: unknown, city: string, count: number | null, aboutText: string): string {
  if (!city && count == null) return aboutText;
  const who = String(name || "").trim() || "משרד תיווך";
  let lead = who + (city ? ` - משרד תיווך ב${city}` : " - משרד תיווך");
  if (count != null) lead += `, ${countPhrase(count)}`;
  return clamp(`${lead}. ${aboutText}`, 200);
}

async function agencyMeta(slug: string, canonical: string): Promise<MetaResult> {
  const got = await sbFetch(
    `agencies?slug=eq.${encodeURIComponent(slug)}&select=id,name,description,logo_url,cover_url,tagline,address,specialty_areas`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const a = got.row;
  /* ‏"על המשרד": התיאור שהמשרד כתב, או משפט עובדתי מהשם, הכתובת והאזורים -
     אותן פסקאות שאגף ה-JS של agency.html כותב (‏assets/agency-about.js). */
  const about = shared.ShukAgencyAbout.paragraphs(a);
  /* ‏הטקסט של "על המשרד" נשאר ה-description ב-JSON-LD, כמו קודם. תגית
     ה-meta מקבלת לפניו את העיר ואת מספר הנכסים, כשהספירה הצליחה. */
  const aboutText = clamp(
    about.join(" ") || `משרד התיווך ${a.name || ""} ב${SITE_NAME} - נכסים, סוכנים וחוות דעת.`,
    200,
  );
  const image = absolute(a.cover_url || a.logo_url) || DEFAULT_IMAGE;

  /* ‏משרד תיווך הוא עסק עם כתובת ציבורית - הכתובת כאן היא של המשרד, לא של
     אדם, ולכן היא נכנסת כמו שהיא (בשונה מנכס, שבו מספר הבית ממוסך). */
  const agency: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": `${canonical}#agency`,
    name: String(a.name || ""),
    url: canonical,
    description: aboutText,
    image,
  };
  if (a.logo_url) agency.logo = absolute(a.logo_url);
  if (a.tagline) agency.slogan = String(a.tagline);
  if (a.address) agency.address = { "@type": "PostalAddress", streetAddress: String(a.address), addressCountry: "IL" };

  /* ‏AggregateRating - רק מה שהדף עצמו מציג: אותו ציון (‏agency_ratings_public,
     ‏score) ואותו סף (‏MIN_REVIEWS_SHOWN = 2 ב-agency.html). דירוג בנתונים
     המובנים שאינו מופיע בדף הוא הפרה של הנחיות גוגל, ולכן מתחת לסף - כלום.
     כשל בשאילתה השנייה אינו מפיל את הדף: הוא יוצא בלי דירוג. */
  /* ‏הספירה משנית: כישלון שלה אינו מפיל את הדף, והכותרת יוצאת בלי מספר.
     ‏206/416 עם Content-Range עדיין מספר; בלי הכותרת הזו אין מספר אמיתי. */
  let listingCount: number | null = null;
  if (a.id) {
    const [r, counted] = await Promise.all([
      sbFetch(
        `agency_ratings_public?agency_id=eq.${encodeURIComponent(String(a.id))}&select=score,review_count`,
      ),
      activeListingCount(String(a.id)),
    ]);
    listingCount = counted;
    const score = r.kind === "row" ? Number(r.row.score) : NaN;
    const count = r.kind === "row" ? Number(r.row.review_count) : 0;
    if (r.kind === "row" && r.row.score != null && Number.isFinite(score) && count >= MIN_REVIEWS_RATED) {
      agency.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: Math.round(score * 10) / 10,
        reviewCount: count,
        bestRating: 5,
        worstRating: 1,
      };
    }
  }

  const city = shared.ShukAgencyPlace?.officeCity(a) || "";
  const title = shared.ShukAgencyPlace
    ? shared.ShukAgencyPlace.title(a.name, city)
    : clamp(`${a.name || "משרד תיווך"} | ${SITE_NAME}`, 90);

  /* תמונת הנושא היא ה-LCP. ה-og:image נשאר על הקובץ המלא; ה-img וה-preload
     על העותק המוקטן, אותה מחרוזת ש-coverRenderUrl ב-agency.js כותב.
     רק אחרי safeImageUrl: מארח זר לא נכנס ל-src. */
  const coverSafe = safeImageUrl(a.cover_url);
  const coverAbs = coverSafe ? absolute(coverSafe) : "";
  const coverLcp = coverAbs ? (heroRenderUrl(coverAbs, 1400, 800) || coverAbs) : "";
  const inner: { id: string; html: string }[] = [];
  if (about.length) inner.push({ id: "aboutText", html: about.map((t) => `<p>${esc(t)}</p>`).join("") });
  if (coverLcp) {
    inner.push({
      id: "bannerMedia",
      html: `<img class="banner-lcp" alt="" width="1400" height="800" fetchpriority="high" decoding="async" src="${esc(coverLcp)}">`,
    });
  }

  return {
    title,
    description: agencyBlurb(a.name, city, listingCount, aboutText),
    image,
    canonical,
    jsonLd: agency,
    fills: [{ id: "brandName", text: String(a.name || "") }],
    inner,
    reveal: about.length ? ["aboutSec"] : [],
    bodyClass: coverLcp ? "agency-ready has-cover" : "agency-ready",
    preloadImage: coverLcp || undefined,
  };
}

async function agentMeta(slug: string, canonical: string): Promise<MetaResult> {
  const got = await sbFetch(
    `agency_members_public?slug=eq.${encodeURIComponent(slug)}&select=display_name,bio,photo_url,cover_url,license_number`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const m = got.row;
  const description = clamp(
    String(m.bio || "") || `${m.display_name || ""} - נכסים, חוות דעת ודרכי יצירת קשר ב${SITE_NAME}.`,
    200,
  );

  /* ‏רישיון התיווך כ-hasCredential: מספר שמאומת מול רשם המתווכים
     (‏docs/broker-registry.md) הוא סיגנל אמון נדיר, ובחוק הוא ממילא מוצג
     בדף. ‏agency_members_public כבר מסננת למי שמותר להיות באוויר. */
  const person: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${canonical}#agent`,
    name: String(m.display_name || ""),
    url: canonical,
    jobTitle: "יועץ נדל״ן",
    description,
  };
  if (m.photo_url) person.image = absolute(m.photo_url);
  const license = String(m.license_number || "").trim();
  if (license) {
    person.hasCredential = {
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "רישיון תיווך במקרקעין",
      identifier: license,
      recognizedBy: { "@type": "GovernmentOrganization", name: "רשם המתווכים במקרקעין, משרד המשפטים" },
    };
  }

  return {
    title: clamp(`${m.display_name || "סוכן/ת"} | ${SITE_NAME}`, 90),
    description,
    image: absolute(m.cover_url || m.photo_url) || DEFAULT_IMAGE,
    canonical,
    jsonLd: person,
    /* ‏אותו טקסט ש-renderProfile ב-agent.html כותב, כולל ברירת המחדל לביו ריק */
    fills: [
      { id: "profileName", text: String(m.display_name || "") },
      { id: "profileBio", text: String(m.bio || "") || "סוכן/ת נדל״ן פעיל/ה באזור עפולה והעמק." },
    ],
  };
}

/* ‏שלושת הדפים הבאים בונים את הכותרת והתיאור **באותו כלל בדיוק** שבו
   ה-JS שבדף בונה אותם (‏renderMeta בכל אחד מהם). שינוי בצד אחד מחייב את
   אותו שינוי בשני, בדיוק כמו maskHouseNumber — אחרת הסורק והגולש/ת רואים
   שני דברים שונים, וזה גם מה שגוגל קוראת לו "תוכן שונה מהמובטח". */

/* ‏העתק של TYPE_LABELS ב-professional.html - יחיד, בלי לוכסן */
const TYPE_LABELS: Record<string, string> = {
  mortgage_advisor: "יועץ משכנתאות",
  appraiser: "שמאי מקרקעין",
  architect: "אדריכל",
  interior_designer: "מעצב פנים",
  cleaning: "חברת ניקיון",
  real_estate_lawyer: "עו״ד מקרקעין",
  general: "בעל מקצוע",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* ‏מזהה נכס מתוך ‎?id=‎ גם כשנדבק אליו טקסט: פוסט שבו שורת הקישור איבדה את
   ירידת השורה מגיע כ-‎<uuid>שוק‎ (27.10.2026). ה-UUID הראשון בערך הוא המזהה;
   ערך בלי UUID בכלל הוא "אין נכס" ודאי, בלי קריאה למסד. */
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function propertyIdFrom(raw: string): string {
  const m = UUID_IN.exec(raw || "");
  return m ? m[0].toLowerCase() : "";
}

/* ‏‎?slug=‎ היא הכתובת הקנונית גם כשנכנסו דרך ‎?id=‎. ברירת המחדל היא
   המפתח שהגיע, כדי שרשומה בלי slug עדיין תצהיר על כתובת שקיימת. */
function canonicalBySlug(page: string, row: Record<string, unknown>, key: string): string {
  const slug = String(row.slug || "").trim() || key;
  return `${SITE}/${page}?slug=${encodeURIComponent(slug)}`;
}

async function projectMeta(slug: string, canonical: string): Promise<MetaResult> {
  const got = await sbFetch(
    `projects_public?slug=eq.${encodeURIComponent(slug)}&select=name,city,tagline,description,cover_url,logo_url`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const p = got.row;

  const title = `${p.name || "פרויקט חדש"}${p.city ? " - " + p.city : ""}`;
  const desc =
    clamp(String(p.tagline || p.description || ""), 200) ||
    `פרויקט חדש מקבלן${p.city ? " ב" + p.city : ""} - תמהיל דירות, מחירים וגלריה.`;
  const image = absolute(p.cover_url || p.logo_url) || DEFAULT_IMAGE;
  const tagline = String(p.tagline || "").trim();
  const about = String(p.description || "").trim();

  const complex: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ApartmentComplex",
    "@id": `${canonical}#project`,
    name: String(p.name || "פרויקט חדש"),
    url: canonical,
    description: desc,
    image,
  };
  if (p.city) complex.address = { "@type": "PostalAddress", addressLocality: String(p.city), addressCountry: "IL" };

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: desc,
    image,
    canonical,
    jsonLd: complex,
    fills: [
      { id: "projectName", text: String(p.name || "") },
      { id: "projectTagline", text: tagline },
      { id: "projectDescription", text: about },
    ],
    reveal: [...(tagline ? ["projectTagline"] : []), ...(about ? ["aboutSec"] : [])],
  };
}

async function developerMeta(slug: string, canonical: string): Promise<MetaResult> {
  const got = await sbFetch(
    `developers_public?slug=eq.${encodeURIComponent(slug)}&select=name,city,tagline,description,cover_url,logo_url`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const d = got.row;

  const title = `${d.name || "חברה יזמית"}${d.city ? " - " + d.city : ""}`;
  const desc =
    clamp(String(d.tagline || d.description || ""), 200) ||
    `כל הפרויקטים החדשים של החברה${d.city ? " ב" + d.city : ""} במקום אחד.`;
  const image = absolute(d.cover_url || d.logo_url) || DEFAULT_IMAGE;
  const tagline = String(d.tagline || "").trim();
  const about = String(d.description || "").trim();

  const org: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${canonical}#developer`,
    name: String(d.name || "חברה יזמית"),
    url: canonical,
    description: desc,
    image,
  };
  if (d.logo_url) org.logo = absolute(d.logo_url);
  if (d.city) org.address = { "@type": "PostalAddress", addressLocality: String(d.city), addressCountry: "IL" };

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: desc,
    image,
    canonical,
    jsonLd: org,
    fills: [
      { id: "devName", text: String(d.name || "") },
      { id: "devTagline", text: tagline },
    ],
    inner: about ? [{ id: "devAbout", html: esc(about) }] : [],
    reveal: [...(tagline ? ["devTagline"] : []), ...(about ? ["aboutSec"] : [])],
  };
}

async function professionalMeta(key: string): Promise<MetaResult> {
  const cols = "slug,advertiser_name,business_name,advertiser_type,target_region,headline,description,cover_url,creative_url";
  const got = await sbFetch(
    `professional_cards_public?${UUID.test(key) ? "id" : "slug"}=eq.${encodeURIComponent(key)}&select=${cols}`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const p = got.row;

  const name = p.advertiser_name || "בעל מקצוע";
  const role = TYPE_LABELS[String(p.advertiser_type || "")] || TYPE_LABELS.general;
  const title = [name, p.business_name].filter(Boolean).join(" · ");
  const description = clamp(
    String(p.headline || p.description || "") ||
      `${role} באזור ${p.target_region || "עפולה והעמק"}.`,
    155,
  );
  const image = absolute(p.cover_url || p.creative_url) || DEFAULT_IMAGE;
  const canonical = canonicalBySlug("professional", p, key);
  const headline = String(p.headline || "").trim();
  const about = String(p.description || "").trim();
  const personName = String(p.advertiser_name || "").trim();
  const heading = String(p.business_name || "").trim() || personName || "בעל מקצוע";
  const person = personName && personName !== heading ? personName : "";

  const service: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${canonical}#professional`,
    name: String(p.business_name || name),
    url: canonical,
    description,
    image,
    serviceType: role,
    areaServed: String(p.target_region || "עפולה והעמק"),
  };
  if (p.business_name && p.advertiser_name) {
    service.employee = { "@type": "Person", name: String(p.advertiser_name), jobTitle: role };
  }

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description,
    image,
    canonical,
    jsonLd: service,
    fills: [
      // אותו כלל של renderHeader בדף: הכותרת היא שם העסק, ושם האדם
      // בשורת המשנה רק כשהוא שונה ממנה
      { id: "profileName", text: heading },
      { id: "profilePerson", text: person },
      { id: "profileHeadline", text: headline },
      { id: "profileDescription", text: about },
    ],
    reveal: [...(person || headline ? ["profileSub"] : []), ...(about ? ["aboutBlock"] : [])],
  };
}

async function articleMeta(key: string): Promise<MetaResult> {
  const cols = "slug,title,subtitle,body,cover_url,published_at,author_name";
  const got = await sbFetch(
    `articles_public?${UUID.test(key) ? "id" : "slug"}=eq.${encodeURIComponent(key)}&select=${cols}`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const a = got.row;

  /* ‏גוף הכתבה נכתב בעורך ועלול להכיל תגיות. הן יורדות לפני ה-clamp, אחרת
     תגית חתוכה באמצע נכנסת ל-content="…" של ה-meta. */
  const body = String(a.body || "").replace(/<[^>]*>/g, " ");

  const canonical = canonicalBySlug("article", a, key);
  const description = clamp(String(a.subtitle || "") || body, 155);
  const image = absolute(a.cover_url) || DEFAULT_IMAGE;
  const publishedAt = String(a.published_at || "").trim() || undefined;

  /* ‏author: שם המחבר/ת כשיש, ואחרת האתר עצמו כארגון - כתבה בלי author
     היא מה שגוגל מסמנת כחסר, וכרגע אף כתבה לא נושאת שם (9.10.2026). */
  const publisher = { "@type": "Organization", name: SITE_NAME, url: `${SITE}/`, logo: ORG_LOGO };
  const author = String(a.author_name || "").trim();
  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${canonical}#article`,
    headline: clamp(String(a.title || "כתבה"), 110),
    description,
    image: [image],
    inLanguage: "he",
    mainEntityOfPage: canonical,
    author: author ? { "@type": "Person", name: author } : publisher,
    publisher,
  };
  if (publishedAt) article.datePublished = publishedAt;

  /* ‏גוף הכתבה עצמו - הטקסט שמנוע AI יצטט. אותו מבנה ש-renderBody בונה,
     כאן ב-HTML מוברח: גוף שנכתב בעורך עם תגיות יוצא כטקסט, כמו בדפדפן. */
  const blocks = shared.ShukArticleBody.parse(String(a.body || ""));
  const bodyHtml = blocks.map((b) => {
    if (b.tag === "ul") return `<ul>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    const cls = b.lead ? ' class="lead-para"' : "";
    return `<${b.tag}${cls}>${esc(b.text || "")}</${b.tag}>`;
  }).join("");
  const subtitle = String(a.subtitle || "").trim();

  return {
    title: clamp(`${a.title || "כתבה"} | ${SITE_NAME}`, 90),
    description,
    image,
    canonical,
    publishedAt,
    jsonLd: article,
    fills: [
      { id: "articleTitle", text: String(a.title || "כתבה") },
      { id: "articleSubtitle", text: subtitle },
    ],
    reveal: subtitle ? ["articleSubtitle"] : [],
    inner: bodyHtml ? [{ id: "articleBody", html: bodyHtml }] : [],
  };
}

/* ---------- הזרקה ---------- */

/* ‏מילוי תגית קיימת לפי ה-id שלה, בלי לגעת בשאר המאפיינים — ובלי להסיר
   אותה. ‏ה-JS שבדף כותב אליה אחר כך לפי אותו id. */
function fillById(html: string, id: string, value: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*\\bid="${id}"[^>]*>`, "i");
  const found = html.match(re);
  if (!found) return null;

  const tag = /content="[^"]*"/i.test(found[0])
    ? found[0].replace(/content="[^"]*"/i, `content="${esc(value)}"`)
    : found[0].replace(/\s*\/?>$/, ` content="${esc(value)}">`);

  return html.replace(re, tag);
}

/* ‏מילוי טקסט של אלמנט פשוט לפי id - ‎<h1 id="propTitle">-</h1>‎. רק
   אלמנט שאין בתוכו תגיות: מבנה אחר בדף לא נדרס, ופשוט נשאר כמו שהוא. */
function fillText(html: string, id: string, text: string): string {
  if (!text) return html;
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)[^<]*(</\\2>)`, "i");
  return html.replace(re, (_m, open, _tag, close) => `${open}${esc(text)}${close}`);
}

/* ‏מילוי אלמנט **ריק** במבנה - ‎<div id="articleBody"></div>‎. אלמנט שכבר יש
   בו משהו אינו נדרס. ה-html כבר מוברח בידי מי שבנה אותו. */
function fillInner(html: string, id: string, inner: string): string {
  if (!inner) return html;
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)\\s*(</\\2>)`, "i");
  return html.replace(re, (_m, open, _tag, close) => `${open}${inner}${close}`);
}

function unhide(html: string, id: string): string {
  const re = new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`, "i");
  return html.replace(re, (tag) => tag.replace(/\s+hidden(?=[\s>])/i, ""));
}

function addBodyClass(html: string, cls: string): string {
  return html.replace(/<body(\s[^>]*)?>/i, (tag) => {
    if (/\bclass="/i.test(tag)) return tag.replace(/\bclass="/i, `class="${cls} `);
    return tag.replace(/<body/i, `<body class="${cls}"`);
  });
}

/* תמונת השער נכנסת לרשת הריקה. data-count זהה לזה שה-JS יכתוב. */
function fillHero(html: string, count: number, inner: string): string {
  if (!inner) return html;
  const re = /<div\b[^>]*\bid="bentoGrid"[^>]*>\s*<\/div>/i;
  return html.replace(re, (tag) => {
    const open = tag.replace(/\s*<\/div>\s*$/i, "").replace(/>\s*$/, "");
    const withCount = /\bdata-count=/.test(open)
      ? open.replace(/\bdata-count="[^"]*"/, `data-count="${count}"`)
      : `${open} data-count="${count}"`;
    return `${withCount}>${inner}</div>`;
  });
}

/* הפלייסהולדר בלבד. תמונת שער אמיתית נשארת ב-preload של heroHead,
   בסוף ה-head, ולא מקבלת את הקובץ הזה. */
function preloadPlaceholder(html: string): string {
  const tag = `<link rel="preload" as="image" href="${HERO_PLACEHOLDER}" fetchpriority="high">`;
  if (html.includes(`href="${HERO_PLACEHOLDER}"`)) return html;
  const withCharset = html.replace(/(<meta\b[^>]*\bcharset\b[^>]*>)/i, `$1\n${tag}`);
  if (withCharset !== html) return withCharset;
  return html.replace(/<head\b[^>]*>/i, (open) => `${open}\n${tag}`);
}

function heroHead(lcp: string): string[] {
  const tags = [
    `<link rel="preconnect" href="${SUPABASE_URL}" crossorigin>`,
    `<link rel="preconnect" href="${SUPABASE_URL}">`,
  ];
  if (!lcp) return tags;
  try {
    const origin = new URL(lcp).origin;
    if (origin && origin !== SUPABASE_URL && /^https?:$/i.test(new URL(lcp).protocol)) {
      tags.push(`<link rel="preconnect" href="${esc(origin)}">`);
    }
  } catch { /* כתובת יחסית כבר על הדומיין של האתר */ }
  tags.push(`<link rel="preload" as="image" href="${esc(lcp)}" fetchpriority="high">`);
  return tags;
}

/* התגיות שממולאות לפי id כשהן כבר בדף, ונכתבות מחדש כשאינן. */
const BY_ID: [string, (m: Meta) => string, string][] = [
  ["metaDescription", (m) => m.description, `<meta name="description" content="%s">`],
  ["ogTitle", (m) => m.title, `<meta property="og:title" content="%s">`],
  ["ogDescription", (m) => m.description, `<meta property="og:description" content="%s">`],
  ["ogImage", (m) => m.image, `<meta property="og:image" content="%s">`],
];

/* ‏מחזירה את ה-HTML אחרי מילוי מה שכבר קיים, ואת התגיות שנשאר להוסיף. */
function inject(html: string, m: Meta): string {
  let out = html;
  const add: string[] = [];

  for (const [id, pick, template] of BY_ID) {
    const filled = fillById(out, id, pick(m));
    if (filled) out = filled;
    else add.push(template.replace("%s", esc(pick(m))));
  }

  /* ‏canonical: דף פירוט אינו נושא תגית סטטית — ראו "canonical" בראש הקובץ
     ובסעיף של scripts/check_canonical.py — אבל אם אחת נשתלה שם בכל זאת,
     היא יורדת כאן. **שתי תגיות canonical גורמות לגוגל להתעלם משתיהן**,
     וזה כשל שקט לגמרי: הדף נטען, התגית שהזרקנו בתוכו, והאיחוד לא קורה. */
  out = out.replace(/<link\b[^>]*\brel="canonical"[^>]*>\s*/gi, "");
  /* ‏noindex בלי canonical: שתי ההצהרות יחד סותרות (‏scripts/og_tags_test.ts) */
  if (m.noindex) add.unshift(`<meta name="robots" content="noindex,follow">`);
  else add.unshift(`<link rel="canonical" href="${esc(m.canonical)}">`);
  if (!/<meta[^>]+property="og:type"/i.test(out)) {
    add.push(`<meta property="og:type" content="website">`);
  }
  add.push(
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:locale" content="he_IL">`,
    `<meta property="og:url" content="${esc(m.canonical)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    `<meta name="twitter:image" content="${esc(m.image)}">`,
  );
  if (m.publishedAt) {
    add.push(`<meta property="article:published_time" content="${esc(m.publishedAt)}">`);
  }

  // ‏<title> הקיים מוחלף, וגם הוא ממוסך — הוא מה שנראה בלשונית ובשיתוף
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`);

  for (const f of m.fills || []) out = fillText(out, f.id, f.text);
  for (const f of m.inner || []) out = fillInner(out, f.id, f.html);
  for (const id of m.reveal || []) out = unhide(out, id);
  if (m.bodyClass) out = addBodyClass(out, m.bodyClass);
  if (m.preloadImage) {
    add.push(`<link rel="preload" as="image" href="${esc(m.preloadImage)}" fetchpriority="high">`);
  }
  if (m.paint) {
    out = addBodyClass(out, "property-ready has-sticky-bar");
    if (m.paint.placeholder) out = preloadPlaceholder(out);
    if (m.paint.html) out = fillHero(out, m.paint.count, m.paint.html);
    add.push(...heroHead(m.paint.lcp));
  }
  if (m.jsonLd) {
    // ‏‎</script>‎ בתוך כותרת שסוכן/ת הקליד/ה היה סוגר את התגית - ולכן ‎<‎ מוברח
    const json = JSON.stringify(m.jsonLd).replace(/</g, "\\u003c");
    add.push(`<script type="application/ld+json">${json}</script>`);
  }

  // מה שנשאר נכנס מיד לפני </head>, אחרי ה-title ואחרי GTM
  return out.replace(/<\/head>/i, `${add.join("\n")}\n</head>`);
}

/* ‏דף פירוט שאין מאחוריו רשומה: ‎/property‎ בלי ‎?id=‎, נכס שכבר אינו
   ‎active‎, כתבה שנמחקה, ‎?slug=‎ שאינו קיים. שבעת הדפים האלה מגישים אז
   את **אותו שלד "לא נמצא" בדיוק** — ובלי ‎canonical‎, כי תגית סטטית
   אסורה כאן (ראו למעלה) ואין מה להזריק. גוגל רואה אשכול כתובות זהות
   שאף אחת מהן לא הצהירה על מקור, וקוראת לזה **"עותק משוכפל בלי שנבחר
   דף קנוני על ידי המשתמש"**.

   ‏noindex אומר את מה שנכון באמת: אין כאן דף לאנדקס. זו גם התשובה
   הזהירה מבין השתיים — ‎canonical‎ על ‎/property‎ היה מאחד אליו כתובות
   של נכסים אמיתיים ברגע שהבירור נכשל, וזה בדיוק הכשל שהקובץ הזה נמנע
   ממנו. לכן המסלול הזה נבחר **רק** כשהמסד ענה במפורש "אין רשומה"
   (‏‎Fetched.missing‎), ולעולם לא על כשל רשת.

   ‏follow נשאר: הפוטר בדף מקשר לכל האתר, ואין סיבה לעצור שם סריקה. */
function noindex(html: string): string {
  // דף שכבר נושא הנחיה משלו (‏sign, agreement) אינו נדרס
  if (/<meta\b[^>]*\bname="robots"/i.test(html)) return html;
  return html.replace(/<\/head>/i, `<meta name="robots" content="noindex,follow">\n</head>`);
}

/* ‏404 או 503 של דף נכס בלבד. דף שהתמלא, ודפי פירוט אחרים, אינם עוברים כאן. */
function failureHeaders(base: Headers, status: number): Headers {
  const headers = new Headers(base);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  if (status === 503) headers.set("Retry-After", "60");
  return headers;
}

/* ‏פסקה, לא H1. ‏#propTitle נשאר ה-H1 היחיד גם כשהנכס חסר. */
function missingProperty(html: string): string {
  let out = noindex(html);
  if (out.includes('id="notFoundState"')) return out;
  const block =
    `<div id="notFoundState" class="wrap" style="display:block">` +
    `<p class="prop-missing" style="font-size:1.3rem;font-weight:700">הנכס לא נמצא</p>` +
    `<p style="color:var(--ink-soft)">ייתכן שהמודעה הוסרה או שהקישור שגוי.</p>` +
    `<a href="/" class="btn btn-gold" style="margin-top:16px">חזרה לדף הבית</a></div>\n`;
  if (/<div id="loadingState"/.test(out)) return out.replace(/<div id="loadingState"/, block + `<div id="loadingState"`);
  return out.replace(/<\/body>/i, block + `</body>`);
}

export default async function handler(request: Request, context: Context) {
  /* ‏/agency.html ו-/agency?slug= מגישים אותו משרד. הפונקציה הזו רצה על
     שניהם ומחזירה 200 אחרי context.next(), ולכן הפניה ב-_redirects לבדה
     לא רצה. ה-301 כאן, לפני next, שומר את השאילתה. יעד יחסי כדי שתצוגת
     פריוויו לא תשלח לפרודקשן. */
  try {
    const early = new URL(request.url);
    /* ‏‎/property?id=<uuid><זנב>‎ - 301 לכתובת הקנונית, עם שאר השאילתה
       (‏utm, ‏fbclid). רק כשיש UUID תקין והערך אינו בדיוק הוא. */
    if ((early.pathname === "/property" || early.pathname === "/property.html") &&
        (request.method === "GET" || request.method === "HEAD")) {
      const raw = early.searchParams.get("id") || "";
      const clean = propertyIdFrom(raw);
      if (clean && raw !== clean) {
        early.searchParams.set("id", clean);
        return new Response(null, {
          status: 301,
          headers: {
            Location: "/property?" + early.searchParams.toString(),
            "Cache-Control": "public, max-age=3600",
            "Netlify-CDN-Cache-Control": "public, max-age=3600",
          },
        });
      }
    }
    /* בלי slug אין דף: לרשימה, לא לשלד "לא נמצא" ב-200. */
    if ((request.method === "GET" || request.method === "HEAD") && !early.searchParams.get("slug")) {
      const bare = early.pathname === "/agent" || early.pathname === "/agent.html"
        ? "/agents"
        : (early.pathname === "/agency" || early.pathname === "/agency.html" ? "/agencies" : "");
      if (bare) {
        return new Response(null, {
          status: 301,
          headers: {
            Location: bare,
            "Cache-Control": "public, max-age=3600",
            "Netlify-CDN-Cache-Control": "public, max-age=3600",
          },
        });
      }
    }
    if (early.pathname === "/agency.html" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: "/agency" + early.search,
          "Cache-Control": "public, max-age=3600",
          "Netlify-CDN-Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch { /* כתובת פגומה - ממשיכים לדף */ }

  const res = await context.next();

  // רק HTML. תמונות, CSS ו-JS עוברים כמו שהם.
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  try {
    const url = new URL(request.url);
    const page = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    const id = url.searchParams.get("id") || "";
    const slug = url.searchParams.get("slug") || "";
    // ‏professional ו-article מקבלים גם ?id= — ראו "canonical" בראש הקובץ
    const key = slug || id;

    /* הכתובת הקנונית היא הצורה בלי הסיומת — זו שהאתר מוגש בה בפרודקשן.
       ‏דף פירוט שהגיע **בלי המפתח שלו** (‏‎/property‎ בלי ‎?id=‎) אינו צריך
       קריאה למסד כדי שנדע שאין מאחוריו רשומה: זה "missing" ודאי. */
    let meta: MetaResult = null;
    if (page.endsWith("/property")) {
      // ערך שאין בו UUID - 404 ודאי, בלי 400 מ-PostgREST שהופך ל-503
      const pid = propertyIdFrom(id);
      meta = pid ? await propertyMeta(pid, `${SITE}/property?id=${pid}`) : "missing";
    } else if (page.endsWith("/agency")) {
      meta = slug ? await agencyMeta(slug, `${SITE}/agency?slug=${encodeURIComponent(slug)}`) : "missing";
    } else if (page.endsWith("/agent")) {
      meta = slug ? await agentMeta(slug, `${SITE}/agent?slug=${encodeURIComponent(slug)}`) : "missing";
    } else if (page.endsWith("/project")) {
      meta = slug ? await projectMeta(slug, `${SITE}/project?slug=${encodeURIComponent(slug)}`) : "missing";
    } else if (page.endsWith("/developer")) {
      meta = slug ? await developerMeta(slug, `${SITE}/developer?slug=${encodeURIComponent(slug)}`) : "missing";
    } else if (page.endsWith("/professional")) {
      meta = key ? await professionalMeta(key) : "missing";
    } else if (page.endsWith("/article")) {
      meta = key ? await articleMeta(key) : "missing";
    }
    const isProperty = page.endsWith("/property");
    // ‏null = לא ידענו. בנכס: עותק קודם ב-200, ואחרת 503 בלי noindex.
    // בשאר הדפים התשובה המקורית.
    if (!meta) {
      if (!isProperty) return res;
      const prev = await recall(lastGoodKey(request.url));
      if (prev) return prev;
      return new Response(res.body, { status: 503, headers: failureHeaders(res.headers, 503) });
    }

    const html = await res.text();
    /* נכס, משרד וסוכן/ת בלי רשומה: 404 עם noindex. פרויקט, יזם, בעל מקצוע
       וכתבה נשארים 200 עם noindex. */
    if (meta === "missing" && (isProperty || page.endsWith("/agent") || page.endsWith("/agency"))) {
      const body = isProperty ? missingProperty(html) : noindex(html);
      return new Response(body, { status: 404, headers: failureHeaders(res.headers, 404) });
    }
    const out = meta === "missing" ? noindex(html) : inject(html, meta);

    const headers = new Headers(res.headers);
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    const response = new Response(out, { status: res.status, headers });
    if (isProperty && meta !== "missing") {
      await remember(lastGoodKey(request.url), response, waitUntilOf(context));
    }
    return response;
  } catch {
    return res; // הזרקה שנכשלה לא תשבור דף
  }
}

/* ‏‎excludedPath‎ אינו נחוץ: ההתאמה כאן היא לנתיבים המדויקים בלבד, בשתי
   הצורות שבהן Netlify מגיש כל דף — עם הסיומת ובלעדיה. */
export const config: Config = {
  path: [
    "/property", "/property.html",
    "/agency", "/agency.html",
    "/agent", "/agent.html",
    "/project", "/project.html",
    "/developer", "/developer.html",
    "/professional", "/professional.html",
    "/article", "/article.html",
  ],
};
