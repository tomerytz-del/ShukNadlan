// ============================================================================
// ה-slug של דף הסוכן/ת — הגדרה אחת
//
// הוא נוצר בשני רגעים שונים: כשמנהל/ת המשרד מזמין/ה (`add-team-member`),
// וכשהסוכן/ת ממלא/ת את שמו/ה במסך הפתיחה על כרטיס שנוצר בלי שם
// (`join-agency`). שתי הגדרות נפרדות לאותו כלל הן בדיוק הסיפור של
// `escapeHtml` ב-CLAUDE.md: הן נראות זהות עד שאחת מהן מתוקנת.
//
// וכאן ההבדל היה נראה: ה-slug הוא **כתובת הדף הציבורי** של הסוכן/ת. נרמול
// שונה בשתי הנקודות פירושו שאותו שם מייצר שתי כתובות שונות, תלוי מי הקליד
// אותו קודם.
// ============================================================================

/** עברית, לטינית, ספרות ומקפים. כל השאר יורד, ורווחים הופכים למקף אחד. */
export function slugifyName(text: string): string {
  return String(text ?? "").trim().toLowerCase()
    .replace(/[^\u0590-\u05FFa-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * ‏slug פנוי לשם שנמסר. ‏`agency_members.slug` הוא `unique`, ולכן ההתנגשות
 * נפתרת כאן ולא בשגיאת מסד: שם נפוץ הוא המצב הרגיל, לא התקלה.
 *
 * ‏`client` הוא לקוח service role — ‏RLS על `agency_members` אינו מאפשר
 * לראות שורות של אחרים, ובדיקת תפוסה שאינה רואה את כולן היא בדיקה שתמיד
 * אומרת "פנוי".
 */
export async function freeAgentSlug(
  // deno-lint-ignore no-explicit-any
  client: any,
  name: string,
): Promise<string> {
  const base = slugifyName(name) || "agent";
  let slug = base;
  for (let n = 2; ; n++) {
    const { data: taken } = await client
      .from("agency_members").select("id").eq("slug", slug).maybeSingle();
    if (!taken) return slug;
    slug = `${base}-${n}`;
  }
}
