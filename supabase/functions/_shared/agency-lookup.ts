// ============================================================================
// שם המשרד של סוכן/ת — בשאילתה נפרדת, לעולם לא ב-embed
//
// ‏`agency_members` מחזיקה מפתח זר יחיד ל-`agencies`, ולכן `agencies(name)`
// נראה כמו הדרך הטבעית לצרף את שם המשרד לשורת הסוכן/ת. הוא אינו עובד:
// ל-`agent_share_exclusions` יש מפתח ראשי מורכב **‏(agent_id, agency_id)**,
// וזו בדיוק ההגדרה של טבלת-קישור בעיני PostgREST. לכן הוא רואה שני נתיבים
// בין שתי הטבלאות — המפתח הזר הישיר, וקשר רבים-לרבים דרך טבלת ההסרות —
// מסרב לבחור, ומחזיר **‏PGRST201 (HTTP 300)**:
//
//     Could not embed because more than one relationship was found
//     for 'agency_members' and 'agencies'
//
// ‏supabase-js מחזיר את זה כשגיאה רגילה עם `data: null`, ולכן קוד שלא בודק
// ‏`error` פשוט ממשיך עם "לא נמצאה שורה". זה מה שהופך את התקלה הזו לשקטה:
// **השאילתה כולה נכשלת, לא רק ה-embed.**
//
// ‏⚠️ שני זוגות שנראים דומים ואינם: `properties → agencies` ו-
// ‏`properties → neighborhoods` עובדים כרגיל, ואין לשנות אותם. ‏`property_shares`
// אמנם מחזיקה מפתחות זרים ל-`properties` ול-`agencies`, אבל המפתח הראשי שלה
// הוא `id` בודד — ולכן היא אינה נספרת כטבלת קישור, ואין שם דו-משמעות. הגבול
// עובר במפתח הראשי המורכב, לא בקיומם של שני מפתחות זרים.
//
// שלושה כשלים אמיתיים שנבעו מזה עד היום:
//
//   ‏· `_shared/platform-signup-alert.ts` — מנהל/ת הפלטפורמה לא קיבל/ה ולו
//     התראת הצטרפות אחת. אפס שורות `platform_signup` במשך שבועות.
//   ‏· `whatsapp-webhook/index.ts` — זיהוי הסוכן/ת נפל לגמרי.
//   ‏· `create-own-agency` — כרטיס מנותק לא זוהה, והאימוץ נפל ב-23505.
//
// ‏`scripts/check_agency_embed.py` חוסם ב-CI כל embed חדש כזה. מי שצריך את
// שם המשרד קורא לכאן.
// ============================================================================

type QueryResult<T> = PromiseLike<{ data: T; error: { message: string } | null }>;
type Client = { from: (table: string) => any };

export interface AgencyBrief {
  name: string | null;
  slug: string | null;
}

/**
 * שורת המשרד לפי `agency_members.agency_id`.
 *
 * ‏`fields` מאפשר להוסיף עמודות (למשל `address` להסכמים); ברירת המחדל היא
 * מה שרוב הקוראים צריכים. כשל מוחזר כ-null ונרשם ללוג — שם המשרד הוא פרט
 * בהודעה ולא תנאי לה, וזו כל הנקודה של הפרדת השאילתה.
 */
export async function loadAgency(
  supabase: Client,
  agencyId: string | null | undefined,
  fields = "name, slug",
): Promise<Record<string, unknown> | null> {
  if (!agencyId) return null;
  const { data, error } = await (supabase
    .from("agencies")
    .select(fields)
    .eq("id", agencyId)
    .maybeSingle() as QueryResult<Record<string, unknown> | null>);
  if (error) {
    console.error("agency lookup failed", error.message);
    return null;
  }
  return data ?? null;
}

/** קיצור למקרה הנפוץ: רק השם, או null. */
export async function agencyName(
  supabase: Client,
  agencyId: string | null | undefined,
): Promise<string | null> {
  const row = await loadAgency(supabase, agencyId, "name");
  return (row?.name as string | undefined) ?? null;
}
