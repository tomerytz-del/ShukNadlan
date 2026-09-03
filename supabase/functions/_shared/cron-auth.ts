// ============================================================================
// אימות הקוראים הפנימיים — ‏pg_cron, ‏pg_net ו-backfill ידני.
//
// שלוש הפונקציות שמשתמשות בקובץ הזה רצות עם verify_jwt = false, כלומר
// ה-Gateway של Supabase מעביר אליהן כל בקשה בלי לבדוק כלום. הן חייבות
// לאמת את הקורא בעצמן, אחרת כל מי שיודע את הכתובת מפעיל אותן.
//
// למה קובץ משותף ולא שלוש בדיקות מקומיות: הבדיקה שהייתה כאן קודם נכתבה
// פעמיים, ובשתי הפעמים בנוסח `if (CRON_SECRET && ...)` — כלומר כשהסוד לא
// מוגדר בסביבה, הבדיקה מדלגת על עצמה והפונקציה פתוחה לגמרי. זה בדיוק
// המצב שנמצא בפרודקשן: ‏ALERT_CRON_SECRET לא הוגדר מעולם, ולכן שתי
// הפונקציות ה"מוגנות" ענו 200 לכל קורא. הגדרה שגויה חייבת להיכשל ברעש,
// לא להתפרש כ"אין צורך באימות" — ולכן כאן זה fail-closed.
//
// שני מסלולים לגיטימיים:
//   1. ‏x-alert-cron-secret ששווה ל-ALERT_CRON_SECRET — המסלול של pg_cron.
//      ה-cron שולף את הערך מ-Vault (‏alert_cron_secret), ולכן שני המקומות
//      חייבים להחזיק את אותו ערך.
//   2. ‏Authorization: Bearer <service_role> — המסלול של קריאה פנימית
//      וקריאה ידנית מהדשבורד.
// ============================================================================

const CRON_SECRET = Deno.env.get("ALERT_CRON_SECRET") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

export type InternalAuth =
  | { ok: true; via: "cron_secret" | "service_role" }
  | { ok: false; status: number; error: string; detail: string };

// השוואה בזמן קבוע. ‏=== יוצא ברגע שהתו הראשון נבדל, ולכן זמן התשובה מדליף
// כמה תווים נכונים ניחשו. הסוד הוא 64 תווים ולכן העלות כאן זניחה.
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorizeInternalCaller(req: Request): InternalAuth {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (SERVICE_ROLE_KEY && secretsMatch(bearer, SERVICE_ROLE_KEY)) {
    return { ok: true, via: "service_role" };
  }

  // ‏503 ולא 401: הבקשה אולי לגיטימית לגמרי, השרת הוא זה שלא הוגדר. ‏401
  // היה שולח את מי שמתחזק את המערכת לחפש את הבעיה בצד הקורא.
  if (!CRON_SECRET) {
    return {
      ok: false,
      status: 503,
      error: "cron_secret_not_configured",
      detail: "‏ALERT_CRON_SECRET אינו מוגדר ב-Edge Functions → Secrets. ראו docs/edge-functions-deploy.md.",
    };
  }

  const provided = req.headers.get("x-alert-cron-secret") || "";
  if (provided && secretsMatch(provided, CRON_SECRET)) {
    return { ok: true, via: "cron_secret" };
  }

  return {
    ok: false,
    status: 401,
    error: "unauthorized",
    detail: "נדרשת כותרת x-alert-cron-secret תקינה או מפתח service_role.",
  };
}
