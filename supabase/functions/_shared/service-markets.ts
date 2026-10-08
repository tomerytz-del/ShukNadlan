// ============================================================================
// אזורי הפעילות - הרשימה הסגורה, לבוט של הסוכנים
//
// אותם שווקים של `assets/markets.js` (slug ושם), פעילים ושאינם. הבוט אינו
// יכול לייבא את הקובץ ההוא (הוא נפרס ב-Netlify, לא ב-Supabase), ולכן הרשימה
// מועתקת כאן, ו-`scripts/check_markets.py` מוודא ששתיהן זהות - שוק חדש
// שנוסף רק שם נכשל ב-CI ולא נעלם מגבריאלה בשקט.
//
// נשמר ב-`agency_members.service_markets` (slug-ים), ושמות האזורים נכתבים
// גם ל-`service_area` - בדיוק כמו `marketsAreaText` ב-`assets/crm.js`.
// docs/regional-pages.md, "כתובת המשרד ואזורי הפעילות".
// ============================================================================

export const SERVICE_MARKETS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "afula-emek", label: "עפולה והעמק" },
  { slug: "haifa", label: "חיפה והסביבה" },
  { slug: "krayot", label: "הקריות והסביבה" },
  { slug: "akko-nahariya", label: "עכו ונהריה" },
  { slug: "karmiel-misgav", label: "כרמיאל ומשגב" },
  { slug: "nof-hagalil-migdal", label: "נוף הגליל ומגדל העמק" },
  { slug: "hadera", label: "חדרה והסביבה" },
  { slug: "netanya", label: "נתניה והסביבה" },
];

export const SERVICE_MARKET_LABELS: string[] = SERVICE_MARKETS.map((m) => m.label);

/** שם או slug → slug. מה שאינו ברשימה - null (לא מנחשים). */
export function serviceMarketSlug(value: unknown): string | null {
  const v = String(value ?? "").trim();
  const hit = SERVICE_MARKETS.find((m) => m.label === v || m.slug === v);
  return hit ? hit.slug : null;
}

/** slug-ים → שמות, לפי סדר הרשימה. */
export function serviceMarketLabels(slugs: unknown): string[] {
  const list = Array.isArray(slugs) ? slugs.map(String) : [];
  return SERVICE_MARKETS.filter((m) => list.includes(m.slug)).map((m) => m.label);
}

/** הטקסט ל-`service_area`: השמות, עד 60 תווים, בלי לחתוך שם באמצע. */
export function serviceAreaText(slugs: string[]): string {
  let out = "";
  for (const label of serviceMarketLabels(slugs)) {
    const next = out ? `${out}, ${label}` : label;
    if (next.length > 60) break;
    out = next;
  }
  return out;
}
