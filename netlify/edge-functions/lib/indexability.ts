/* ============================================================================
   איזו כתובת מותרת באינדקס - אותו כלל לדף ול-sitemap
   ----------------------------------------------------------------------------
   שכונה ועסקאות לפי יישוב נשארות 200 לגולש/ת גם כשאין מה לאנדקס. הכלל כאן
   הוא רק ה-noindex וההשמטה מה-sitemap, והוא אחד לשניהם:

     · אפס מודעות פעילות - לא לאינדקס. שכונה נמדדת בנכסים שלה, יישוב
       במודעות הפעילות בעיר.
     · עיר שאינה בשוק חי (‏assets/markets.js, ‏live) - לא לאינדקס.
     · יישוב עם פחות מ-5 עסקאות בחלון שהדף עצמו מציג - לא לאינדקס.
       זה הסף שהיה, והוא נשאר.

   כשל מסד אינו החלטה. הקורא לא קורא לכאן כשהמספר לא ידוע.
   ========================================================================== */

import { registry } from "./markets.ts";

export const THIN_DEALS = 5;

/* null = קובץ השווקים לא נטען. אז לא מחליטים "מחוץ לאזור" על כולם. */
export function liveMarketSlugs(): Set<string> | null {
  const reg = registry();
  if (!reg) return null;
  const live = new Set<string>();
  for (const market of reg.list) {
    if (market.live && market.slug) live.add(market.slug);
  }
  return live;
}

export function neighborhoodIndexable(
  propsActive: number,
  marketSlug: string | null | undefined,
  live: Set<string> | null,
): boolean {
  if (!(Number(propsActive) > 0)) return false;
  if (!live) return true;
  const slug = String(marketSlug || "").trim();
  return slug.length > 0 && live.has(slug);
}

export function settlementIndexable(
  deals: number,
  activeListings: number,
  marketSlug: string | null | undefined,
  live: Set<string> | null,
): boolean {
  if (!(Number(deals) >= THIN_DEALS)) return false;
  if (!(Number(activeListings) > 0)) return false;
  if (!live) return true;
  const slug = String(marketSlug || "").trim();
  return slug.length > 0 && live.has(slug);
}
