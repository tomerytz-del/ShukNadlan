/* מטמון משותף ל-/ ולעמודי התוצאות.
   אותו Netlify-Vary בכל תשובה: עוגיית שוק אחרת לא מקבלת את דף הבית
   מהמטמון (decide לא רץ על hit), ו-utm/gclid/fbclid לא פותחים מפתח נפרד.
   פרמטרי התוכן כן, כי הם משנים את ה-HTML. */

export const HOME_VARY =
  "cookie=shuk_market|shuk_soon, query=deal|type|ptype|rooms|minPrice|maxPrice|q|hoods|city|ai|page|features|listing|floorMin|floorMax|sizeMin|sizeMax|condition|status|moveIn|soon|text|restrooms|storageAt|mamadAt|ppsqmMin|ppsqmMax|newOnly|region";

const CDN = "public, s-maxage=3600, stale-while-revalidate=600";

/* תשובה עם Set-Cookie לא נשמרת. ה-Vary נכתב גם אז, כדי שכל התשובות
   של אותה כתובת ישאו אותו ערך. */
export function setHomeCache(headers: Headers): void {
  headers.set("Netlify-Vary", HOME_VARY);
  if (headers.has("set-cookie")) return;
  headers.set("Netlify-CDN-Cache-Control", CDN);
  headers.set("CDN-Cache-Control", CDN);
  headers.set("Cache-Control", "public, s-maxage=3600");
}
