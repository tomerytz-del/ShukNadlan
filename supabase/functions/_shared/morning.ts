// ============================================================================
// לקוח ה-API של מורנינג (חשבונית ירוקה) — סליקה והפקת חשבוניות
//
// **כל מה שתלוי בשמות השדות של מורנינג נמצא בקובץ הזה ורק בו.**
// זה לא סגנון, זו החלטה מכוונת: התיעוד הרשמי של מורנינג לא היה נגיש בזמן
// הכתיבה, ולכן חלק מהשדות למטה מבוססים על מקורות משניים ועל דפוסים מקובלים
// ב-API הזה. הם מסומנים ב-‏`// ‼ לאימות` ומרוכזים כאן כדי שהתיקון, כשמפתחות
// ה-API יגיעו, יהיה בקובץ אחד ובלי לגעת בלוגיקה של הכסף.
//
// ‏wallet-topup ו-wallet-topup-callback לא יודעות שום דבר על מורנינג מלבד מה
// שהקובץ הזה חושף. אם מחר יחליפו ספק סליקה — זה הקובץ שנכתב מחדש.
//
// **קריאה חשובה על אימות:** ‏verifyPayment() קוראת בחזרה למורנינג במקום
// להאמין לגוף ה-webhook. גוף webhook הוא טקסט שכל אחד יכול לשלוח לכתובת
// ציבורית; תשובת ה-API מול המפתח הפרטי שלנו — לא. ההפרש בין השניים הוא
// ההפרש בין "מישהו טוען שהתשלום עבר" לבין "התשלום עבר".
// ============================================================================

const KEY_ID = Deno.env.get("MORNING_API_KEY_ID") || "";
const KEY_SECRET = Deno.env.get("MORNING_API_KEY_SECRET") || "";

// ברירת המחדל היא **סנדבוקס** בכוונה. סביבה שלא הוגדרה במפורש לא אמורה
// להתחיל לגבות כסף אמיתי מאף אחד; מעבר לפרודקשן הוא פעולה מודעת של מי
// שמגדיר/ה את הסוד, לא תוצאה של שכחה.
const API_BASE = (Deno.env.get("MORNING_API_BASE") ||
  "https://sandbox.d.greeninvoice.co.il/api/v1").replace(/\/+$/, "");

// מזהה תוסף הסליקה בחשבון. חובה לחשבונות עם יותר מתוסף אחד; אופציונלי
// כשיש רק אחד, ואז מורנינג בוחר/ת בו לבד.
const PLUGIN_ID = Deno.env.get("MORNING_PLUGIN_ID") || "";

export function morningConfigured(): boolean {
  return Boolean(KEY_ID && KEY_SECRET);
}

export function morningEnvLabel(): string {
  return API_BASE.includes("sandbox") ? "sandbox" : "production";
}

// ---------------------------------------------------------------------------
// אסימון הגישה
//
// ה-JWT של מורנינג קצר-מועד ונוצר מחדש מהמפתחות. הוא **לא נשמר במסד** —
// אין סיבה לאחסן סוד שאפשר לייצר מחדש בקריאה אחת. המטמון כאן הוא ברמת
// ה-isolate בלבד: הוא חוסך קריאה כשאותה פונקציה מטפלת בכמה בקשות ברצף,
// ונעלם עם ה-isolate. שוליים של דקה לפני התפוגה כדי שלא נשלח טוקן שפג
// בדיוק בדרך.
// ---------------------------------------------------------------------------
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function morningToken(): Promise<{ token?: string; error?: string }> {
  if (!morningConfigured()) return { error: "morning_not_configured" };
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return { token: cachedToken.token };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/account/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: KEY_ID, secret: KEY_SECRET }),
    });
  } catch (err) {
    return { error: `morning_network: ${(err as Error).message}` };
  }

  const raw = await res.text();
  if (!res.ok) return { error: `morning_auth_failed: ${res.status} ${raw.slice(0, 200)}` };

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: "morning_auth_bad_json" };
  }

  const token = body?.token ?? body?.jwt;            // ‼ לאימות: שם שדה האסימון
  if (!token) return { error: "morning_auth_no_token" };

  // ‏expires מגיע כ-epoch בשניות. אם לא הגיע — 55 דקות, שמרני מול חצי שעה
  // שהיא התפוגה המקובלת שם.
  const expiresSec = Number(body?.expires);          // ‼ לאימות: שם שדה התפוגה
  cachedToken = {
    token,
    expiresAt: Number.isFinite(expiresSec) && expiresSec > 0
      ? expiresSec * 1000
      : Date.now() + 55 * 60_000,
  };
  return { token };
}

// ---------------------------------------------------------------------------
// יצירת טופס תשלום מתארח
//
// מחזיר כתובת שאליה מפנים את הסוכן/ת. פרטי הכרטיס נמסרים אצל מורנינג ואינם
// עוברים דרכנו בשום שלב — זו הסיבה המרכזית לבחור בטופס מתארח ולא בשדות
// אשראי משלנו: מה שלא עובר אצלנו, גם לא יכול לדלוף מאיתנו.
// ---------------------------------------------------------------------------
export type PaymentFormRequest = {
  amount: number;
  description: string;
  clientName: string;
  clientEmail?: string | null;
  /** ‏ח.פ / ע.מ, אם נמסר בעמוד התשלום. מה שהופך את המסמך לחשבונית לעסק. */
  clientTaxId?: string | null;
  /** טלפון ב-E.164, מעמוד התשלום. */
  clientPhone?: string | null;
  /** קוד מדינה דו-אותי (ISO 3166-1 alpha-2), מעמוד התשלום. */
  clientCountry?: string | null;
  successUrl: string;
  failureUrl: string;
  notifyUrl: string;
  /** מזהה הטעינה שלנו. חוזר אלינו ב-webhook וקושר את התשלום לשורה במסד. */
  reference: string;
};

export type PaymentFormResult =
  | { ok: true; formId: string; url: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// פרטי הלקוח/ה לחשבונית, מתוך גוף הבקשה
//
// עמוד התשלום אוסף שם פרטי, שם משפחה, טלפון, מדינה, שם עסק ו-ח.פ — דרישת
// חברת הסליקה מעמוד צ'קאאוט — וכל אלה מקומם על החשבונית. הם נכונים יותר
// מ-display_name של הפרופיל, שהוא כינוי תצוגה ועשוי להיות "משרד כהן" או שם
// פרטי בלבד.
//
// **אלה השדות היחידים שמותר להם להגיע מהדפדפן.** הסכום, המסלול והזכאות
// נקבעים בשרת בלבד ולעולם לא מגוף הבקשה — ההפרדה הזו היא מה שמונע מטופס
// לקבוע כמה נגבה.
//
// הניקוי אינו קישוט: אלה שדות טקסט חופשי שנשלחים לצד שלישי ומודפסים במסמך.
// שורה אחת, רווחים מכווצים, אורך סביר, ובטלפון וב-ח.פ ספרות בלבד.
// ---------------------------------------------------------------------------
type ClientDetails = {
  clientName: string;
  clientTaxId: string | null;
  clientPhone: string | null;
  clientCountry: string | null;
};

export function clientFrom(body: unknown, fallbackName?: string | null): ClientDetails {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

  // שם העסק גובר על השם הפרטי: כשיש ח.פ, החשבונית היא לעסק ולא לאדם.
  const person = text(b.client_name, 100);
  const business = text(b.client_business, 100);
  const taxId = text(b.client_tax_id, 20).replace(/\D/g, "");
  const phone = text(b.client_phone, 25).replace(/[^\d+]/g, "");
  const country = text(b.client_country, 2).toUpperCase();

  return {
    clientName: (business || person) || (fallbackName || "").trim() || "סוכן/ת",
    clientTaxId: taxId || null,
    clientPhone: phone || null,
    clientCountry: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

export async function createPaymentForm(req: PaymentFormRequest): Promise<PaymentFormResult> {
  const auth = await morningToken();
  if (!auth.token) return { ok: false, error: auth.error ?? "morning_not_configured" };

  // ‼ לאימות: כל גוף הבקשה. הערכים המספריים הם קודים של מורנינג —
  //   type 320  = חשבונית מס/קבלה (הפקה אוטומטית עם סיום התשלום)
  //   vatType 0 = כולל מע"מ
  //   lang/currency לפי התיעוד
  //
  // ‼ לאימות במיוחד: ‏taxId/phone/country ב-client. הם נשלחים כי בלעדיהם
  //   ה-ח.פ שהוקלד בעמוד התשלום לא מגיע לחשבונית — אבל שם שדה שגוי כאן
  //   מפיל את **פתיחת התשלום כולה**, ולא רק את השדה. לכן buildPayload
  //   מקבל דגל, וניסיון שנדחה חוזר מיד בלי השדות האלה (ראו למטה). זה מה
  //   שמאפשר לשלוח אותם לפני שהתיעוד אומת, בלי להמר על נתיב הכסף.
  const buildPayload = (withClientExtras: boolean): Record<string, unknown> => ({
    description: req.description,
    type: 320,
    lang: "he",
    currency: "ILS",
    vatType: 0,
    amount: req.amount,
    maxPayments: 1,
    group: 100,
    client: {
      name: req.clientName,
      ...(req.clientEmail ? { emails: [req.clientEmail] } : {}),
      ...(withClientExtras
        ? {
          ...(req.clientTaxId ? { taxId: req.clientTaxId } : {}),
          ...(req.clientPhone ? { phone: req.clientPhone } : {}),
          ...(req.clientCountry ? { country: req.clientCountry } : {}),
        }
        : {}),
    },
    income: [{
      description: req.description,
      quantity: 1,
      price: req.amount,
      currency: "ILS",
      vatType: 0,
    }],
    successUrl: req.successUrl,
    failureUrl: req.failureUrl,
    notifyUrl: req.notifyUrl,
    // מזהה חופשי שחוזר אלינו כמו שהוא. זה מה שמחבר תשלום לשורה שלנו —
    // בלעדיו היינו צריכים לנחש לפי סכום וזמן, וזה לא ניחוש שעושים על כסף.
    remarks: req.reference,
    ...(PLUGIN_ID ? { pluginId: PLUGIN_ID } : {}),
  });

  const post = async (payload: Record<string, unknown>) =>
    await fetch(`${API_BASE}/payments/form`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${auth.token}`,
      },
      body: JSON.stringify(payload),
    });

  const hasExtras = Boolean(req.clientTaxId || req.clientPhone || req.clientCountry);
  let res: Response;
  try {
    res = await post(buildPayload(hasExtras));
    // דחייה בטווח 4xx על בקשה שנשאה שדות שטרם אומתו: מנסים פעם אחת בלי
    // אותם שדות. עדיף חשבונית בלי ח.פ מאשר תשלום שלא נפתח — ומי שקורא/ת
    // את הלוג רואה בדיוק מה נדחה ומה תוקן.
    if (!res.ok && hasExtras && res.status >= 400 && res.status < 500) {
      console.warn("morning: client extras rejected, retrying without them",
        res.status, (await res.clone().text()).slice(0, 300));
      res = await post(buildPayload(false));
    }
  } catch (err) {
    return { ok: false, error: `morning_network: ${(err as Error).message}` };
  }

  const raw = await res.text();
  if (!res.ok) return { ok: false, error: `morning_form_failed: ${res.status} ${raw.slice(0, 300)}` };

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "morning_form_bad_json" };
  }

  if (body?.errorCode) {
    return { ok: false, error: `morning_error ${body.errorCode}: ${String(body.errorMessage ?? "").slice(0, 200)}` };
  }

  const url = body?.url ?? body?.paymentUrl;         // ‼ לאימות: שם שדה הכתובת
  const formId = body?.id ?? body?.formId ?? "";     // ‼ לאימות: שם שדה המזהה
  if (!url) return { ok: false, error: "morning_form_no_url" };

  return { ok: true, formId: String(formId), url: String(url) };
}

// ---------------------------------------------------------------------------
// אימות תשלום מול מורנינג
//
// **זו הפונקציה שקובעת אם מזכים ארנק.** היא נקראת משני מקומות — מה-webhook
// ומה-reconcile — ובשניהם עם אותה שאלה: מה מורנינג אומר/ת שקרה, לא מה הקורא
// טוען שקרה.
//
// ההחזרה `paid: false` אינה שגיאה. היא תשובה לגיטימית שמשמעותה "עדיין לא"
// או "לא יקרה", והקורא הוא שמחליט מה לעשות איתה.
// ---------------------------------------------------------------------------
export type PaymentStatus = {
  ok: boolean;
  /** ‏true רק כשמורנינג מאשר/ת שהעסקה נגבתה. */
  paid: boolean;
  /** הסכום שנגבה בפועל, לפי מורנינג. מושווה מול מה שאנחנו רשמנו. */
  amount: number | null;
  transactionId: string | null;
  documentId: string | null;
  pdfUrl: string | null;
  error?: string;
  raw?: string;
};

export async function verifyPayment(formId: string): Promise<PaymentStatus> {
  const empty = { paid: false, amount: null, transactionId: null, documentId: null, pdfUrl: null };

  const auth = await morningToken();
  if (!auth.token) return { ok: false, ...empty, error: auth.error ?? "morning_not_configured" };

  let res: Response;
  try {
    // ‼ לאימות: הנתיב לשליפת מצב תשלום לפי מזהה טופס
    res = await fetch(`${API_BASE}/payments/${encodeURIComponent(formId)}`, {
      headers: { "Authorization": `Bearer ${auth.token}` },
    });
  } catch (err) {
    return { ok: false, ...empty, error: `morning_network: ${(err as Error).message}` };
  }

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, ...empty, error: `morning_lookup_failed: ${res.status}`, raw: raw.slice(0, 300) };
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, ...empty, error: "morning_lookup_bad_json" };
  }

  return { ok: true, ...readPaymentShape(body), raw: raw.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// קריאת צורת התשובה
//
// מופרד מ-verifyPayment כדי שיהיה אפשר להריץ עליו בדיקה עם תשובה אמיתית
// שהודבקה מהסנדבוקס, בלי לקרוא לרשת. **זו הפונקציה שתשתנה כשנראה תשובה
// אמיתית ראשונה** — ומדובר בשינוי בטוח, כי היא לא מקבלת החלטות ולא נוגעת
// במסד; היא רק מתרגמת צורה אחת לאחרת.
//
// הקריאה מקבלת כמה שמות אפשריים לכל שדה בכוונה: עדיף לקרוא נכון שדה
// שהתיעוד קורא לו אחרת, מאשר לפספס תשלום שנגבה ולהשאיר סוכן/ת בלי הכסף.
// ‏paid, לעומת זאת, מחמיר/ה — רק סימן חיובי מפורש נחשב.
// ---------------------------------------------------------------------------
export function readPaymentShape(body: any): Omit<PaymentStatus, "ok" | "error" | "raw"> {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string | null =>
    v === null || v === undefined || v === "" ? null : String(v);

  // ‼ לאימות: קוד/שדה הסטטוס. במורנינג מקובל status מספרי שבו 1 = שולם.
  const rawStatus = body?.status ?? body?.paymentStatus;
  const paid =
    rawStatus === 1 || rawStatus === "1" ||
    String(rawStatus).toLowerCase() === "paid" ||
    String(rawStatus).toLowerCase() === "success" ||
    body?.paid === true;

  return {
    paid,
    amount: num(body?.amount ?? body?.sum ?? body?.total),
    transactionId: str(body?.transactionId ?? body?.paymentId ?? body?.id),
    documentId: str(body?.documentId ?? body?.document?.id),
    pdfUrl: str(body?.documentUrl ?? body?.document?.url ?? body?.url),
  };
}

// ---------------------------------------------------------------------------
// חילוץ המזהה שלנו מגוף ה-webhook
//
// גוף ה-webhook הוא **קלט לא מהימן** ומשמש כאן למטרה אחת בלבד: להצביע על
// השורה שצריך לבדוק. שום ערך ממנו לא נכנס למסד ולא משפיע על סכום — האימות
// עצמו נעשה ב-verifyPayment מול ה-API. לכן גם אין סיכון בכך שאנחנו קוראים
// ממנו כמה שדות אפשריים.
// ---------------------------------------------------------------------------
export function extractReference(body: any): { topupId: string | null; formId: string | null } {
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // ‼ לאימות: השדה שבו מורנינג מחזיר/ה את ה-remarks שלנו
  const candidates = [
    body?.remarks, body?.reference, body?.custom, body?.custom?.topupId,
    body?.data?.remarks, body?.payment?.remarks,
  ];
  let topupId: string | null = null;
  for (const c of candidates) {
    const m = typeof c === "string" ? c.match(uuidRe) : null;
    if (m) { topupId = m[0]; break; }
  }

  const formId = body?.id ?? body?.formId ?? body?.paymentId ?? body?.data?.id ?? null;
  return { topupId, formId: formId ? String(formId) : null };
}

export function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

// השוואה בזמן קבוע, מאותו טעם כמו ב-cron-auth.ts: ‏=== יוצא בתו הראשון
// שנבדל, וזמן התשובה מדליף כמה תווים נוחשו נכון.
export function secretsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
