// ============================================================================
// אזורי הפעילות - הרשימה הסגורה, לבוט של הסוכנים ולפתיחת משרד
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
  { slug: "kfar-saba-raanana", label: "כפר סבא ורעננה" },
  { slug: "herzliya", label: "הרצליה ורמת השרון" },
  { slug: "tel-aviv", label: "תל אביב-יפו" },
  { slug: "ramat-gan", label: "רמת גן וגבעתיים" },
  { slug: "bnei-brak-elad", label: "בני ברק ואלעד" },
  { slug: "petah-tikva", label: "פתח תקווה וראש העין" },
  { slug: "holon-bat-yam", label: "חולון ובת ים" },
  { slug: "rishon", label: "ראשון לציון" },
  { slug: "rehovot", label: "רחובות ונס ציונה" },
  { slug: "modiin", label: "מודיעין והסביבה" },
  { slug: "lod-ramla", label: "לוד ורמלה" },
  { slug: "ashdod", label: "אשדוד והסביבה" },
  { slug: "ashkelon", label: "אשקלון והסביבה" },
  { slug: "kiryat-gat", label: "קריית גת והסביבה" },
  { slug: "sderot-netivot", label: "שדרות, נתיבות ואופקים" },
  { slug: "beer-sheva", label: "באר שבע והסביבה" },
  { slug: "jerusalem", label: "ירושלים והסביבה" },
  { slug: "beit-shemesh", label: "בית שמש והסביבה" },
  { slug: "samaria", label: "אריאל והשומרון" },
  { slug: "binyamin", label: "בנימין ומודיעין עילית" },
  { slug: "gush-etzion", label: "גוש עציון והר חברון" },
  { slug: "dimona-arad", label: "דימונה, ערד וירוחם" },
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

/** ‏service_markets מגוף הבקשה של פתיחת משרד (agency-signup, create-own-agency):
 *  רק slug-ים מהרשימה, בלי כפילויות, עד 12 (‏agency_members_service_markets_check).
 *  ערך לא מוכר נזרק בשקט - האזורים ניתנים לעריכה בפרופיל, והם לא סיבה
 *  להפיל פתיחת משרד. */
export function cleanServiceMarkets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const slugs = raw.map(serviceMarketSlug).filter((s): s is string => !!s);
  return [...new Set(slugs)].slice(0, 12);
}
