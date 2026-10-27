// ============================================================================
// אימות דו-שלבי (אימות כניסה בוואטסאפ) בפונקציות Edge.
//
// במסד האכיפה נעשית ב-pre-request של PostgREST (‏mfa_pre_request, מיגרציה
// 20270421090000): מי שחייב/ת אימות ולא אימת/ה הופך/ת שם לאורח/ת. אבל
// פונקציה שמזהה את המשתמש/ת ב-auth.getUser() ואז עובדת ב-service role
// אינה עוברת שם בכלל — ‏getUser מקבל טוקן aal1 בלי שאלות, וה-service role
// עוקף הכל. כאן נסגר הפער הזה.
//
// ‏**הקריאה נעשית אחרי getUser**, ולכן הטוקן כבר אומת. הפענוח כאן הוא רק
// כדי לדלג על הבדיקה כשהטוקן הוא aal2 (‏TOTP של Supabase, אם יופעל), בלי
// סיבוב רשת.
//
// ‏מקור האמת אחד: ‏mfa_status() במסד, שנקראת עם הטוקן של המשתמש/ת. כך
// "מי חייב/ת אימות" (הפעיל/ה אימות בוואטסאפ, או מנהל/ת פלטפורמה) מוגדר במקום אחד בלבד.
//
// ‏**כשל סגור.** אם הבדיקה כאן נכשלת, גם שאר הפונקציה - שעובדת מול אותו
// מסד - הייתה נכשלת, ולכן 503 mfa_check_failed. מ-20271027150000 גם
// ה-pre-request נכשל סגור לפי היקף (לא פתוח): מי שבטווח, או שבדיקת הטווח
// נשברה, בלי session מאומת הופך/ת לאורח/ת, ו-shuk.mfa_pending_sub נשמר.
// ‏mfa_status().pending נשאר true, והשער ממשיך להחזיר 403. הקובץ הזה לא
// שינה התנהגות, והוא אינו קורא את מפתח check_error.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

export type MfaGate = null | { error: "mfa_required" | "mfa_check_failed"; status: number };

function tokenAal(token: string): string {
  try {
    const part = token.split(".")[1] || "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return String(JSON.parse(atob(b64))?.aal || "");
  } catch {
    return "";
  }
}

/** מקבל/ת את הטוקן או את כותרת ה-Authorization כולה. מחזיר null כשמותר
 *  להמשיך, אחרת שגיאה ומעמד HTTP להחזיר כמו שהם. */
export async function mfaGate(authHeaderOrToken: string | null | undefined): Promise<MfaGate> {
  const token = String(authHeaderOrToken || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "mfa_check_failed", status: 401 };
  if (tokenAal(token) === "aal2") return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mfa_status`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      console.error("mfaGate: mfa_status", res.status, await res.text().catch(() => ""));
      return { error: "mfa_check_failed", status: 503 };
    }
    const s = await res.json();
    return s?.pending ? { error: "mfa_required", status: 403 } : null;
  } catch (err) {
    console.error("mfaGate:", err);
    return { error: "mfa_check_failed", status: 503 };
  }
}
