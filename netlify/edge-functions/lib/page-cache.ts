/* מטמון משותף ל-/ ולעמודי התוצאות.
   אותו Netlify-Vary בכל תשובה: עוגיית שוק אחרת לא מקבלת את דף הבית
   מהמטמון (decide לא רץ על hit), ו-utm/gclid/fbclid לא פותחים מפתח נפרד.
   פרמטרי התוכן כן, כי הם משנים את ה-HTML. */

export const HOME_VARY =
  "cookie=shuk_market|shuk_soon, query=deal|type|ptype|rooms|minPrice|maxPrice|q|hoods|city|ai|page|features|listing|floorMin|floorMax|sizeMin|sizeMax|condition|status|moveIn|soon|text|restrooms|storageAt|mamadAt|ppsqmMin|ppsqmMax|newOnly|region";

const CDN = "public, s-maxage=3600, stale-while-revalidate=600";
/* הדפדפן ופרוקסי שאינו Netlify לא שומרים. s-maxage רק בכותרת של Netlify,
   כי פרוקסי משותף מתעלם מ-Netlify-Vary. */
const SHARED = "public, max-age=0, must-revalidate";

/* תשובה עם Set-Cookie לא נשמרת. ה-Vary נכתב גם אז, כדי שכל התשובות
   של אותה כתובת ישאו אותו ערך. */
export function setHomeCache(headers: Headers): void {
  headers.set("Netlify-Vary", HOME_VARY);
  if (headers.has("set-cookie")) return;
  headers.set("Netlify-CDN-Cache-Control", CDN);
  headers.delete("CDN-Cache-Control");
  headers.set("Cache-Control", SHARED);
}

/* יציאה בלי מטמון (כשל, מעבר, דף שאינו עמוד תוצאות) עדיין נושאת
   את אותו Vary, כדי שתשובה שנשמרת אחר כך לא תנעל מפתח בלי העוגיות. */
export function withHomeVary(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Netlify-Vary", HOME_VARY);
  if (res.bodyUsed) {
    try { res.headers.set("Netlify-Vary", HOME_VARY); } catch { /* כותרות נעולות */ }
    return res;
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
