/* ============================================================================
   תגיות שיתוף לדפי הפירוט — מוזרקות בשרת, לפני שהדפדפן מקבל את הדף
   ----------------------------------------------------------------------------
   ## הבעיה

   ‏property.html, agency.html ו-agent.html הם קבצים סטטיים: הכותרת בהם היא
   "נכס | שוק נדל״ן", והתוכן האמיתי נטען ב-JS אחרי שהדף כבר בדפדפן.

   הסורק של וואטסאפ **אינו מריץ JS**. הוא מושך את ה-HTML, מחפש תגיות
   ‎og:‎ — ולא מוצא אף אחת. התוצאה היא שקישור לנכס שסוכן/ת שולח/ת ללקוח/ה
   מופיע בשיחה ככתובת עירומה: בלי תמונה, בלי כותרת, בלי מחיר.

   בשוק שבו וואטסאפ הוא ערוץ ההפצה העיקרי, זה מחיר ישיר על כל שיתוף.
   אותו דבר בפייסבוק, בטלגרם ובתצוגה המקדימה של גוגל.

   ## מה הפונקציה עושה

   רצה על ה-edge לפני שהתשובה יוצאת, מושכת את הנכס/המשרד/הסוכן מ-Supabase,
   ומזריקה ל-‎<head>‎ תגיות ‎og:‎, ‎twitter:‎ ו-‎canonical‎. ה-HTML עצמו לא
   משתנה בשום דרך אחרת, וה-JS שבדף ממשיך לעבוד בדיוק כמו קודם.

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

async function sbFetch(path: string): Promise<Record<string, unknown> | null> {
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
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // ‏timeout, רשת, JSON פגום — בכל מקרה הדף יוצא בלי התגיות
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- בניית התגיות לכל סוג דף ---------- */

type Meta = { title: string; description: string; image: string; canonical: string };

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

async function propertyMeta(id: string, canonical: string): Promise<Meta | null> {
  const cols =
    "title,house_number,address,street,city,sales_area,images,price,deal_type," +
    "rooms,size_sqm,status,neighborhoods(name)";
  const p = await sbFetch(
    `properties?id=eq.${encodeURIComponent(id)}&status=eq.active&select=${encodeURIComponent(cols)}`,
  );
  if (!p) return null;

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
  return {
    title: clamp(`${title} | ${SITE_NAME}`, 90),
    description: clamp(bits.join(" · "), 200),
    image: absolute(images[0]) || DEFAULT_IMAGE,
    canonical,
  };
}

async function agencyMeta(slug: string, canonical: string): Promise<Meta | null> {
  const a = await sbFetch(
    `agencies?slug=eq.${encodeURIComponent(slug)}&select=name,description,logo_url,cover_url`,
  );
  if (!a) return null;
  return {
    title: clamp(`${a.name || "משרד תיווך"} | ${SITE_NAME}`, 90),
    description: clamp(
      String(a.description || "") || `משרד התיווך ${a.name || ""} ב${SITE_NAME} — נכסים, סוכנים וחוות דעת.`,
      200,
    ),
    image: absolute(a.cover_url || a.logo_url) || DEFAULT_IMAGE,
    canonical,
  };
}

async function agentMeta(slug: string, canonical: string): Promise<Meta | null> {
  const m = await sbFetch(
    `agency_members_public?slug=eq.${encodeURIComponent(slug)}&select=display_name,bio,photo_url,cover_url`,
  );
  if (!m) return null;
  return {
    title: clamp(`${m.display_name || "סוכן/ת"} | ${SITE_NAME}`, 90),
    description: clamp(
      String(m.bio || "") || `${m.display_name || ""} — נכסים, חוות דעת ודרכי יצירת קשר ב${SITE_NAME}.`,
      200,
    ),
    image: absolute(m.cover_url || m.photo_url) || DEFAULT_IMAGE,
    canonical,
  };
}

/* ---------- הזרקה ---------- */

function tagsHtml(m: Meta): string {
  return [
    `<link rel="canonical" href="${esc(m.canonical)}">`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:locale" content="he_IL">`,
    `<meta property="og:url" content="${esc(m.canonical)}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:image" content="${esc(m.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    `<meta name="twitter:image" content="${esc(m.image)}">`,
  ].join("\n");
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

    // הכתובת הקנונית היא הצורה בלי הסיומת — זו שהאתר מוגש בה בפרודקשן
    let meta: Meta | null = null;
    if (page.endsWith("/property") && id) {
      meta = await propertyMeta(id, `${SITE}/property?id=${encodeURIComponent(id)}`);
    } else if (page.endsWith("/agency") && slug) {
      meta = await agencyMeta(slug, `${SITE}/agency?slug=${encodeURIComponent(slug)}`);
    } else if (page.endsWith("/agent") && slug) {
      meta = await agentMeta(slug, `${SITE}/agent?slug=${encodeURIComponent(slug)}`);
    }
    if (!meta) return res;

    const html = await res.text();

    // ‏<title> הקיים מוחלף, וגם הוא ממוסך — הוא מה שנראה בלשונית ובשיתוף
    let out = html.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${esc(meta.title)}</title>`,
    );
    // התגיות נכנסות מיד לפני </head>, אחרי ה-title ואחרי GTM
    out = out.replace(/<\/head>/i, `${tagsHtml(meta)}\n</head>`);

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
  path: ["/property", "/property.html", "/agency", "/agency.html", "/agent", "/agent.html"],
};
