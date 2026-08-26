// ============================================================================
// תצוגה מקדימה אמיתית לכל נכס / משרד / מתווך.
//
// הבעיה שזה פותר: property.html, agency.html ו-agent.html מושכים את התוכן
// שלהם מ-Supabase בצד הלקוח, וסורקי הקישורים של וואטסאפ, פייסבוק ו-X לא
// מריצים JavaScript. לכן עד עכשיו כל הנכסים חלקו תצוגה מקדימה אחת, זהה
// וכללית — ואי אפשר היה לתקן את זה מצד הלקוח, כי כשה-JS רץ הסורק כבר סיים
// למשוך את ה-HTML.
//
// Edge Function פותרת את זה בדיוק במקום הנכון: היא מקבלת את ה-HTML הסטטי
// מ-Netlify, מחליפה בו את תגיות ה-og לפני שהוא יוצא, ומחזירה. הסורק מקבל
// HTML מוכן בלי לדעת שקרה משהו.
//
// שלוש החלטות שכדאי להכיר:
//
// 1. הכתיבה מחדש חלה על *כל* המבקרים ולא רק על בוטים. זה פשוט יותר, מונע
//    cloaking (הגשת תוכן שונה לסורק — דבר שגוגל מעניש עליו), וכבונוס גם בני
//    אדם מקבלים <title> נכון מיד, לפני שה-JS בכלל רץ.
//
// 2. ה-og:image הוא התמונה הראשונה של הנכס עצמו, לא כרטיס מעוצב. וואטסאפ
//    יראה את הדירה. זה גם טוב יותר וגם לא דורש שום תשתית ליצירת תמונות.
//    נכס בלי תמונות נופל חזרה לכרטיס הכללי.
//
// 3. כל כשל כאן מחזיר את ה-HTML המקורי כמו שהוא. Supabase איטי, נופל, או
//    מחזיר שטות — העמוד עדיין נטען, פשוט עם התצוגה הכללית. שום דבר כאן
//    לא רשאי להפיל עמוד.
// ============================================================================

// מפתח publishable, אותו אחד שכבר מופיע גלוי ב-HTML של העמודים הציבוריים.
// ניתן לדרוס דרך משתני סביבה ב-Netlify בלי לגעת בקוד.
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";

const SITE = "https://shuknadlan.co.il";
const DEFAULT_IMAGE = `${SITE}/assets/share-default.png`;
const LOOKUP_TIMEOUT_MS = 1500;

/* ---------- בטיחות: הכל שנכנס ל-HTML עובר בריחה ----------
   הכותרות מגיעות ממסד הנתונים, כלומר מטקסט שסוכן/ת הקליד/ה. גרש בודד
   בכותרת ("דירת 3 חד' ") היה סוגר את מאפיין ה-content ושובר את התגית;
   תו < היה פותח אלמנט. זו הזרקת HTML לכל דבר, ולכן הבריחה כאן היא
   דרישת אבטחה ולא ניקיון. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setMeta(html: string, key: string, value: string): string {
  const attr = key.startsWith("og:") ? "property" : "name";
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(">)`);
  return html.replace(re, `$1${esc(value)}$2`);
}

function dropMeta(html: string, key: string): string {
  const attr = key.startsWith("og:") ? "property" : "name";
  return html.replace(new RegExp(`\\s*<meta ${attr}="${key}" content="[^"]*">`), "");
}

function setTitle(html: string, value: string): string {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${esc(value)}</title>`);
}

function setCanonical(html: string, url: string): string {
  return html.replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${esc(url)}$2`);
}

function shekels(n: unknown): string {
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  return "₪" + num.toLocaleString("he-IL");
}

async function lookup(path: string, params: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${params}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null; // timeout / רשת / JSON פגום — המתקשר יחזיר את העמוד כמו שהוא
  } finally {
    clearTimeout(timer);
  }
}

type Meta = { title: string; description: string; image?: string };

async function propertyMeta(id: string): Promise<Meta | null> {
  const p = await lookup(
    "properties",
    `id=eq.${encodeURIComponent(id)}&status=eq.active&select=title,price,deal_type,rooms,property_type,city,images&limit=1`,
  );
  if (!p) return null;

  const price = shekels(p.price);
  const priceLabel = p.deal_type === "rent" ? `${price}/חוד׳` : price;
  const bits = [
    p.rooms ? `${p.rooms} חדרים` : null,
    p.property_type || null,
    p.city || null,
  ].filter(Boolean);

  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];

  return {
    // המחיר ראשון בכותרת: בתצוגה מקדימה בוואטסאפ הוא הדבר היחיד שנקרא בוודאות
    title: [priceLabel, p.title].filter(Boolean).join(" · "),
    description: bits.length
      ? `${bits.join(" · ")} — לפרטים, מיקום על המפה ופנייה ישירה למתווך.`
      : "לפרטי הנכס, מיקום על המפה ופנייה ישירה למתווך.",
    image: typeof images[0] === "string" ? images[0] : undefined,
  };
}

async function agencyMeta(slug: string): Promise<Meta | null> {
  const a = await lookup(
    "agencies",
    `slug=eq.${encodeURIComponent(slug)}&select=name,cover_url,logo_url&limit=1`,
  );
  if (!a) return null;
  const cover = (a.cover_url || a.logo_url) as string | null;
  return {
    title: `${a.name} | שוק נדל״ן`,
    description: `הנכסים הפעילים של ${a.name}, היסטוריית עסקאות, נבחרת הסוכנים וביקורות לקוחות.`,
    image: typeof cover === "string" && cover ? cover : undefined,
  };
}

async function agentMeta(slug: string): Promise<Meta | null> {
  // agent.html מקבל או slug קריא או id גולמי; משכפלים כאן את אותה החלטה
  const isUuid = /^[0-9a-f-]{36}$/i.test(slug);
  const column = isUuid ? "id" : "slug";
  const m = await lookup(
    "agency_members_public",
    `${column}=eq.${encodeURIComponent(slug)}&select=display_name,bio,photo_url&limit=1`,
  );
  if (!m) return null;
  return {
    title: `${m.display_name} | שוק נדל״ן`,
    description:
      (typeof m.bio === "string" && m.bio.trim()) ||
      `הנכסים של ${m.display_name} ופנייה ישירה — בלי לעבור דרך אף אחד אחר.`,
    image: typeof m.photo_url === "string" && m.photo_url ? m.photo_url : undefined,
  };
}

/* הטיפוסים מוגדרים כאן במקום להיות מיובאים מ-"https://edge.netlify.com" או
   מ-"@netlify/edge-functions". רק ה-shape הזה נחוץ בפועל, טיפוסים נמחקים
   ממילא בזמן ה-build, וכל ייבוא חיצוני הוא עוד דבר שיכול לא להיפתר ולהפיל
   את הפריסה כולה. פחות תלויות = פחות מצבי כישלון. */
type EdgeContext = { next: () => Promise<Response> };

export default async function handler(request: Request, context: EdgeContext) {
  const response = await context.next();

  try {
    // רק HTML נכתב מחדש; כל השאר עובר כמו שהוא
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return response;

    const url = new URL(request.url);
    const key = url.searchParams.get("id") || url.searchParams.get("slug");
    if (!key) return response; // ללא מזהה אין מה להעשיר

    let meta: Meta | null = null;
    if (url.pathname.startsWith("/property")) meta = await propertyMeta(key);
    else if (url.pathname.startsWith("/agency")) meta = await agencyMeta(key);
    else if (url.pathname.startsWith("/agent")) meta = await agentMeta(key);

    if (!meta) return response; // לא נמצא / השאילתה נכשלה — התצוגה הכללית תקפה

    let html = await response.text();
    const canonical = `${SITE}${url.pathname}${url.search}`;

    html = setTitle(html, meta.title);
    html = setCanonical(html, canonical);
    html = setMeta(html, "description", meta.description);
    html = setMeta(html, "og:title", meta.title);
    html = setMeta(html, "og:description", meta.description);
    html = setMeta(html, "og:url", canonical);
    html = setMeta(html, "twitter:title", meta.title);
    html = setMeta(html, "twitter:description", meta.description);

    if (meta.image) {
      html = setMeta(html, "og:image", meta.image);
      html = setMeta(html, "twitter:image", meta.image);
      html = setMeta(html, "og:image:alt", meta.title);
      html = setMeta(html, "twitter:image:alt", meta.title);
      // המידות והטיפוס תוארו את כרטיס ברירת המחדל (1200×630 PNG). תמונת נכס
      // היא בכל יחס ופורמט, ומידות שגויות גורמות לחיתוך מוזר בתצוגה — עדיף
      // להשמיט ולתת לסורק למדוד בעצמו.
      html = dropMeta(html, "og:image:width");
      html = dropMeta(html, "og:image:height");
      html = dropMeta(html, "og:image:type");
    }

    const headers = new Headers(response.headers);
    // ה-HTML תלוי עכשיו ב-query string, ולכן חייב להתפצל במטמון לפיו
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    headers.set("Netlify-CDN-Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    headers.delete("content-length"); // האורך השתנה אחרי הכתיבה מחדש

    return new Response(html, { status: response.status, headers });
  } catch (e) {
    console.error("share-meta rewrite failed, serving page unchanged:", e);
    return response;
  }
}

export const config = {
  path: ["/property.html", "/agency.html", "/agent.html"],
};
