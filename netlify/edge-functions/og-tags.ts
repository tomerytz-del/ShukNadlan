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
   ומזריקה ל-‎<head>‎ תגיות ‎og:‎, ‎twitter:‎ ו-‎canonical‎. ה-HTML עצמו לא
   משתנה בשום דרך אחרת, וה-JS שבדף ממשיך לעבוד בדיוק כמו קודם.

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

   ‏**3. כישלון אינו שובר דף.** כל קריאת רשת עטופה ב-timeout קצר וב-
   ‏try/catch, וכל מסלול כושל מחזיר את התשובה המקורית כמו שהיא. דף בלי
   תגיות שיתוף הוא מה שיש היום; דף שנתקע בגלל Supabase איטי הוא הרעה.

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

   ## מטמון

   התשובה נשמרת ב-CDN של Netlify לדקה (‏stale-while-revalidate לחמש), כדי
   שלא תצא קריאה ל-Supabase על כל צפייה. הדפדפן עצמו מקבל
   ‎must-revalidate‎, כך שאין סיכון להגשת דף ישן אחרי פרסום.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";

const SITE = "https://shuknadlan.co.il";
const DEFAULT_IMAGE = `${SITE}/assets/logo-shuknadlan.png`;
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

/* ‏שלוש תשובות ולא שתיים, וההפרדה בין השתיים האחרונות היא כל העניין:
   ‏"אין רשומה כזו" ו-"לא הצלחנו לשאול" נראים אותו דבר מכאן — שניהם חוסר
   מידע — אבל ההשלכה שלהם הפוכה. על הראשון מותר להסיק שאין דף לאנדקס
   (‏noindex למטה); על השני אסור להסיק דבר, כי הסקה ממנו הייתה מוחקת
   נכסים חיים מגוגל בגלל שנייה אחת של Supabase איטי. */
type Fetched =
  | { kind: "row"; row: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "error" };

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
    if (!res.ok) return { kind: "error" };
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

   ‏**מה שאינו נכנס, בכוונה:** קואורדינטות ומספר בית. הכתובת כאן היא אותה
   כתובת ממוסכת שבתגיות (‏docs/property-address-privacy.md) - נתונים
   מובנים הם בדיוק המקום שבו כתובת מלאה הייתה נאספת ונשמרת אצל אחרים. */

const APARTMENT_TYPES = new Set(["דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "טריפלקס"]);
const HOUSE_TYPES = new Set(["בית פרטי/קוטג'", "דו משפחתי"]);

/* ‏Accommodation (דירה/בית) נושא חדרים, שטח וקומה; נכס מסחרי או מגרש אינו
   "מקום לגור בו", ולכן הוא Place - בלי השדות שאינם שייכים לו. */
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
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: title },
        ],
      },
    ],
  };
}

async function propertyMeta(id: string, canonical: string): Promise<MetaResult> {
  const cols =
    "title,house_number,address,street,city,sales_area,images,price,deal_type," +
    "rooms,size_sqm,status,neighborhoods(name)," +
    "description,marketing_description,marketing_description_stale,property_type,floor,updated_at";
  const got = await sbFetch(
    `properties?id=eq.${encodeURIComponent(id)}&status=eq.active&select=${encodeURIComponent(cols)}`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const p = got.row;

  const title = maskHouseNumber(p.title, p.house_number) || String(p.title || "נכס");
  const hood = (p.neighborhoods as { name?: string } | null)?.name || p.sales_area || "";
  const street = maskHouseNumber(p.address || p.street || "", p.house_number);
  const where = [street, hood && hood !== p.city ? hood : "", p.city]
    .filter(Boolean).join(", ");

  const bits = [
    p.deal_type === "rent" ? nis(p.price) + "/חוד׳" : nis(p.price),
    num(p.rooms) ? `${num(p.rooms)} חד׳` : "",
    num(p.size_sqm) ? `${num(p.size_sqm)} מ״ר` : "",
    where,
  ].filter(Boolean);

  const images = Array.isArray(p.images) ? p.images : [];

  // ‏העתק של renderDescription ב-assets/property.js - ראו "תוכן לסורק"
  const marketing = p.marketing_description_stale && p.description ? "" : p.marketing_description;
  const body = String(marketing || p.description || "").trim();

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: clamp(bits.join(" · "), 200),
    image: absolute(images[0]) || DEFAULT_IMAGE,
    canonical,
    jsonLd: listingJsonLd(
      p, canonical, title, body,
      images.slice(0, 6).map(absolute).filter(Boolean), street,
    ),
    fills: [
      { id: "propTitle", text: title },
      { id: "propDescription", text: body },
    ],
    reveal: body ? ["descSection"] : [],
  };
}

async function agencyMeta(slug: string, canonical: string): Promise<MetaResult> {
  const got = await sbFetch(
    `agencies?slug=eq.${encodeURIComponent(slug)}&select=name,description,logo_url,cover_url,tagline,address`,
  );
  if (got.kind !== "row") return got.kind === "missing" ? "missing" : null;
  const a = got.row;
  const description = clamp(
    String(a.description || "") || `משרד התיווך ${a.name || ""} ב${SITE_NAME} - נכסים, סוכנים וחוות דעת.`,
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
    description,
    image,
  };
  if (a.logo_url) agency.logo = absolute(a.logo_url);
  if (a.tagline) agency.slogan = String(a.tagline);
  if (a.address) agency.address = { "@type": "PostalAddress", streetAddress: String(a.address), addressCountry: "IL" };

  return {
    title: clamp(`${a.name || "משרד תיווך"} | ${SITE_NAME}`, 90),
    description,
    image,
    canonical,
    jsonLd: agency,
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
    jobTitle: "מתווך/ת נדל״ן",
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
  };
}

/* ‏שלושת הדפים הבאים בונים את הכותרת והתיאור **באותו כלל בדיוק** שבו
   ה-JS שבדף בונה אותם (‏renderMeta בכל אחד מהם). שינוי בצד אחד מחייב את
   אותו שינוי בשני, בדיוק כמו maskHouseNumber — אחרת הסורק והגולש/ת רואים
   שני דברים שונים, וזה גם מה שגוגל קוראת לו "תוכן שונה מהמובטח". */

/* ‏העתק של TYPE_LABELS ב-professional.html */
const TYPE_LABELS: Record<string, string> = {
  mortgage_advisor: "יועץ/ת משכנתאות",
  appraiser: "שמאי/ת מקרקעין",
  architect: "אדריכל/ית",
  interior_designer: "מעצב/ת פנים",
  cleaning: "חברת ניקיון",
  real_estate_lawyer: "עו״ד מקרקעין",
  general: "בעל/ת מקצוע",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: desc,
    image: absolute(p.cover_url || p.logo_url) || DEFAULT_IMAGE,
    canonical,
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

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: desc,
    image: absolute(d.cover_url || d.logo_url) || DEFAULT_IMAGE,
    canonical,
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
  const role = TYPE_LABELS[String(p.advertiser_type || "")] || "בעל/ת מקצוע";
  const title = [name, p.business_name].filter(Boolean).join(" · ");

  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: clamp(
      String(p.headline || p.description || "") ||
        `${role} באזור ${p.target_region || "עפולה והעמק"}.`,
      155,
    ),
    image: absolute(p.cover_url || p.creative_url) || DEFAULT_IMAGE,
    canonical: canonicalBySlug("professional", p, key),
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
  const publisher = { "@type": "Organization", name: SITE_NAME, url: `${SITE}/`, logo: DEFAULT_IMAGE };
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

  return {
    title: clamp(`${a.title || "כתבה"} | ${SITE_NAME}`, 90),
    description,
    image,
    canonical,
    publishedAt,
    jsonLd: article,
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

function unhide(html: string, id: string): string {
  const re = new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`, "i");
  return html.replace(re, (tag) => tag.replace(/\s+hidden(?=[\s>])/i, ""));
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
  add.unshift(`<link rel="canonical" href="${esc(m.canonical)}">`);
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
  for (const id of m.reveal || []) out = unhide(out, id);
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

export default async function handler(request: Request, context: Context) {
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
      meta = id ? await propertyMeta(id, `${SITE}/property?id=${encodeURIComponent(id)}`) : "missing";
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
    // ‏null = לא ידענו (‏Supabase איטי, 5xx, הרשאה). הדף יוצא כמו שהוא.
    if (!meta) return res;

    const html = await res.text();
    const out = meta === "missing" ? noindex(html) : inject(html, meta);

    const headers = new Headers(res.headers);
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return new Response(out, { status: res.status, headers });
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
