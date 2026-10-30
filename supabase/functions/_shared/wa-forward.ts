// נוסח שהסוכן/ת מעביר/ה ללקוח/ה מהוואטסאפ האישי. אין שם כפתור של Meta,
// אז הקישור נשאר גלוי, בשורה משלו, ובצורה הקצרה: /p/<מספר מודעה> לנכס
// ו-/m/<טוקן> למיניסייט. בלי פרמטרי מעקב ובלי מספר טלפון.

/**
 * הקישור שמופיע בהודעה שהסוכן/ת מעביר/ה.
 * ‏/p/ נפתח רק למודעה באוויר. מודעה שאינה active נופלת שם לדף הבית,
 * אז ההודעה נושאת את הכתובת המלאה.
 */
export function forwardPropertyLink(status: unknown, shortUrl: string | undefined, longUrl: string): string {
  if (String(status || "") === "active" && shortUrl) return shortUrl;
  return longUrl;
}

/** מספר המודעה הציבורי של /p/ (listing_number). */
export function propertyPublicUrl(siteBase: string, listingNumber: unknown): string | undefined {
  const base = String(siteBase || "").replace(/\/$/, "");
  const n = typeof listingNumber === "number" ? listingNumber : Number(String(listingNumber ?? "").trim());
  // ‏/p/ ב-short-link.ts מקבל רק \d{1,9}. מספר ארוך יותר נופל לדף הבית.
  if (!base || !Number.isSafeInteger(n) || n < 1 || n >= 1e9) return undefined;
  return `${base}/p/${n}`;
}

/** אותו טוקן שכבר בכתובת הארוכה, בלי query. */
export function showcasePublicUrl(siteBase: string, token: string): string | undefined {
  const base = String(siteBase || "").replace(/\/$/, "");
  const t = String(token || "").trim().toLowerCase();
  if (!base || !/^[0-9a-f]{32,64}$/.test(t)) return undefined;
  return `${base}/m/${t}`;
}

/** יעד ההפניה של /m/<טוקן>. טוקן שאינו בצורה הזו אינו נפתח. */
export function minisiteRedirectPath(pathname: string): string | null {
  const m = String(pathname || "").match(/^\/m\/([0-9a-f]{32,64})\/?$/i);
  return m ? `/showcase?t=${m[1].toLowerCase()}` : null;
}

export function showcaseForwardMessage(firstName: string, link: string): string {
  return `היי ${firstName}, ריכזתי בשבילך עמוד אישי עם הנכסים שמתאימים למה שחיפשת:\n${link}\n\n` +
    "העמוד הזה שלך וזמין תמיד, אפשר לחזור אליו מתי שנוח, לראות את הנכסים שמעניינים אותך, " +
    "לסמן מה אהבת ומה לא, לשאול על כל נכס ולבקש סיור. נכסים חדשים שאמצא יתווספו לאותו עמוד.\n\n" +
    "רוצה להתייעץ? אפשר לשתף את העמוד עם בני הזוג או המשפחה, והם יראו בדיוק את אותו עמוד.";
}

/** הודעת הנכס: כותרת, רחוב ושכונה בלי מספר בית, מפרט, והקישור בשורה האחרונה. */
export function propertyForwardMessage(parts: {
  greeting?: string;
  title?: string;
  address?: string;
  facts?: string;
  note?: string;
  link: string;
}): string {
  return [parts.greeting, parts.title, parts.address, parts.facts, parts.note, parts.link]
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
}
