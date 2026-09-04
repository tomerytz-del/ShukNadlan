// ============================================================================
// ‏fal.ai — לקוח התור (queue API)
//
// למה תור ולא קריאה סינכרונית: יצירת וידאו מתמונה אורכת 40–120 שניות למודל
// ולקליפ. ‏Edge Function שממתינה לארבע קריאות כאלה בזו אחר זו נחתכת באמצע
// בגלל תקרת זמן הריצה, והתשלום ל-fal כבר בוצע — כלומר כל כישלון עולה כסף
// ולא מחזיר כלום. בתור, השליחה חוזרת מיד עם `request_id`, והתוצאה נאספת
// אחר כך: גם אם ההרצה שלנו מתה בדרך, ה-cron אוסף אותה בהרצה הבאה.
//
// **‏status_url ו-response_url נשמרים ולא נבנים.** ל-fal יש נקודות קצה
// מקוננות (‏fal-ai/ffmpeg-api/compose), ושם נתיב הסטטוס אינו הנתיב של
// השליחה בתוספת סיומת — הוא נגזר משורש האפליקציה. לבנות אותו בעצמנו זה
// לנחש, ותשובת השליחה ממילא מוסרת את שתי הכתובות המדויקות. הן נשמרות בשורה
// של הקליפ, ולכן החלפת מודל בסוד סביבה לא שוברת שום דבר.
// ============================================================================

const QUEUE_BASE = "https://queue.fal.run";

export interface FalSubmission {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

/** מצב בקשה בתור. `pending` מכסה גם IN_QUEUE וגם IN_PROGRESS — ההבדל ביניהם
    לא משנה לקורא, שניהם אומרים "עוד לא". */
export type FalState =
  | { state: "pending" }
  // deno-lint-ignore no-explicit-any
  | { state: "done"; payload: any }
  | { state: "failed"; reason: string };

function authHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    // ‏fal דורש את הסכמה `Key` ולא `Bearer`. עם Bearer התשובה היא 401 יבש
    // בלי הסבר, וזו טעות ההגדרה הנפוצה ביותר מול ה-API הזה.
    Authorization: `Key ${apiKey}`,
  };
}

async function bodyPreview(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
}

/**
 * שולחת בקשה לתור ומחזירה את מזהה הבקשה ואת שתי הכתובות למעקב.
 *
 * זורקת עם גוף התשובה: ‏422 מ-fal הוא כמעט תמיד שדה קלט שגוי, וההודעה שלו
 * אומרת בדיוק איזה. בלי הגוף הזה הדיבוג הוא ניחוש מול סכמה שלא רואים.
 */
export async function falSubmit(
  apiKey: string,
  model: string,
  input: Record<string, unknown>,
): Promise<FalSubmission> {
  const res = await fetch(`${QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`fal submit ${model} → HTTP ${res.status}: ${await bodyPreview(res)}`);
  }

  const json = await res.json();
  const requestId = json?.request_id;
  const statusUrl = json?.status_url;
  const responseUrl = json?.response_url;
  if (!requestId || !statusUrl || !responseUrl) {
    throw new Error(`fal submit ${model} → תשובה בלי request_id/status_url: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { requestId, statusUrl, responseUrl };
}

/**
 * בודקת מצב בקשה, ואם היא הסתיימה — מושכת גם את התוצאה.
 *
 * שתי הפעולות יחד בכוונה: הקורא רוצה לדעת "יש כבר וידאו?", ופיצול לשתי
 * קריאות היה מזמין מצב שבו הסטטוס נקרא, נשכח, ונקרא שוב בהרצה הבאה.
 */
export async function falPoll(apiKey: string, statusUrl: string, responseUrl: string): Promise<FalState> {
  const res = await fetch(statusUrl, { headers: authHeaders(apiKey) });

  // ‏404 על בקשה שנשלחה בהצלחה פירושו שהיא פגה מהתור (‏fal שומר תוצאות
  // לזמן מוגבל). זה סופי — המתנה נוספת לא תחזיר אותה, ולכן זה כישלון
  // ולא `pending`, אחרת השורה הייתה נסקרת לנצח.
  if (res.status === 404) return { state: "failed", reason: "הבקשה אינה קיימת יותר בתור של fal" };
  if (!res.ok) return { state: "failed", reason: `fal status → HTTP ${res.status}: ${await bodyPreview(res)}` };

  const status = (await res.json())?.status;
  if (status === "IN_QUEUE" || status === "IN_PROGRESS") return { state: "pending" };
  if (status !== "COMPLETED") {
    return { state: "failed", reason: `סטטוס לא צפוי מ-fal: ${status ?? "(ריק)"}` };
  }

  const out = await fetch(responseUrl, { headers: authHeaders(apiKey) });
  if (!out.ok) {
    return { state: "failed", reason: `fal result → HTTP ${out.status}: ${await bodyPreview(out)}` };
  }
  return { state: "done", payload: await out.json() };
}

/**
 * מוצאת את כתובת הווידאו בתשובה של fal.
 *
 * המודלים לא מסכימים על המבנה: חלקם מחזירים `video.url`, חלקם `video_url`,
 * וחלקם מערך `videos[0].url`. הבדיקה כאן מכסה את שלושתם כדי שהחלפת מודל
 * בסוד סביבה תישאר החלפה של שורה אחת ולא שינוי קוד.
 */
// deno-lint-ignore no-explicit-any
export function falVideoUrl(payload: any): string | null {
  return (
    payload?.video?.url ??
    payload?.video_url ??
    payload?.videos?.[0]?.url ??
    payload?.output?.video?.url ??
    null
  );
}
