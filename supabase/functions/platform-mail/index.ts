import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// ============================================================================
// המייל של הפלטפורמה — נשלח ממקום אחד, לא מחמישה
//
// עד היום כל פונקציה ששלחה מייל החזיקה עותק משלה של הקוד ששולח: המפתח,
// כתובת השולח, וקריאת ה-HTTP ל-Resend. חמישה עותקים פירושם שכל שינוי במשלוח
// הוא חמש פריסות, ושאחת מהן תישכח.
//
// ‏שני מסלולים, ובסדר הזה:
//
//   ‏1. **Gmail SMTP** — כשמוגדרים GMAIL_USER ו-GMAIL_APP_PASSWORD. זה
//      המסלול שבו ההודעה יוצאת *באמת* מכתובת הפלטפורמה: השרתים של Google
//      הם שחותמים עליה, ולכן ה-From הוא shuknadlan@gmail.com והיא עוברת
//      אימות. ספק חיצוני אינו יכול לעשות זאת — ראו למטה.
//   ‏2. **Resend** — נשאר כרשת ביטחון. אם ה-SMTP נופל (סיסמת אפליקציה
//      שבוטלה, מכסה יומית, תקלה אצל Google), ההודעה עדיין יוצאת מהשולח
//      המאומת, עם reply_to לתיבת הפלטפורמה. עדיף מייל שיוצא מכתובת
//      פחות נכונה מאשר התראה שנעלמת.
//
// **למה לא פשוט לשים gmail.com כ-from ב-Resend.** ‏שולח חיצוני חותם על
// ההודעה בשם הדומיין שלו. הודעה שמצהירה `From: …@gmail.com` אבל נחתמה
// ב-resend.com נכשלת ביישור SPF/DKIM מול gmail.com, ו-Resend בכלל לא
// מאפשר להגדיר דומיין שאינו שלך. הדרך היחידה לשלוח באמת מהכתובת היא
// לשלוח דרך השרתים של Google — וזה בדיוק מסלול 1.
//
// **מכסות Gmail.** חשבון Gmail רגיל מוגבל ל-500 נמענים ביום ול-100 נמענים
// להודעה. בנפח הנוכחי זה רחוק, אבל זו הסיבה ש-`to` נגזר ל-40.
//
// הפונקציה אינה פתוחה: שליחה בשם הפלטפורמה למי שמבקש היא ממסר פתוח.
// הקורא חייב את מפתח ה-service_role של הפרויקט (או PLATFORM_MAIL_SECRET).
// ============================================================================

const GMAIL_USER = (Deno.env.get("GMAIL_USER") || "").trim();

/* Google מציג את סיסמת האפליקציה בארבע רביעיות מופרדות ברווח. מי שמעתיק
   אותה כפי שהיא מקבל 19 תווים במקום 16, וההתחברות נדחית עם "Username and
   Password not accepted" — שגיאה שנראית כמו סיסמה שגויה ואינה כזו. */
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") || "").replace(/\s+/g, "");

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const ALERTS_FROM_EMAIL = Deno.env.get("ALERTS_FROM_EMAIL") || "";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAIL_SECRET = Deno.env.get("PLATFORM_MAIL_SECRET") || "";

const FROM_NAME = Deno.env.get("PLATFORM_FROM_NAME") || "שוק הנדל״ן של עפולה והסביבה";
const PLATFORM_CONTACT_EMAIL =
  Deno.env.get("PLATFORM_CONTACT_EMAIL") || GMAIL_USER || "shuknadlan@gmail.com";

const MAX_RECIPIENTS = 40;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-platform-mail-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

/** רק מי שמחזיק/ה במפתח של הפרויקט. ‏anon אינו מספיק: הוא בדפדפן של כל גולש. */
function authorized(req: Request): boolean {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY) return true;
  if (MAIL_SECRET && req.headers.get("x-platform-mail-secret") === MAIL_SECRET) return true;
  return false;
}

/* ---------------------------------------------------------------------------
 * קידוד כותרות בעברית — RFC 2047
 *
 * ‏denomailer 1.6.0 מקודד כותרות שאינן ASCII ב-Q-encoding **ומשאיר בתוכן
 * רווחים**. ‏encoded-word עם רווח הוא לא חוקי, והתוצאה בפועל (נבדק מול
 * Gmail): הנמען רואה כנושא את המחרוזת המקודדת עצמה, והפרסר מאבד את כל בלוק
 * הכותרות — כך ש-From, To, Date וגבולות ה-MIME נשפכים לגוף ההודעה.
 *
 * לכן הכותרות מקודדות כאן, ב-base64, לפני שהן מגיעות לספרייה: התוצאה היא
 * ‏ASCII נקי, ולכן היא עוברת דרכה כמו שהיא ולא מקודדת פעם שנייה.
 *
 * החיתוך לחלקים הוא בגלל תקרת 75 התווים ל-encoded-word, והוא רץ על נקודות
 * קוד ולא על בתים — אחרת אימוג'י (⚠️, שני surrogates) היה נחתך באמצע.
 * ------------------------------------------------------------------------- */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeHeader(text: string): string {
  if (!/[^\x20-\x7E]/.test(text)) return text;   // ASCII — אין מה לקודד
  const enc = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  for (const ch of text) {
    // 30 בתים → 40 תווי base64, ועם העטיפה ‎=?UTF-8?B?…?=‎ נשארים הרבה מתחת ל-75
    if (enc.encode(current + ch).length > 30) {
      chunks.push(current);
      current = "";
    }
    current += ch;
  }
  if (current) chunks.push(current);
  return chunks.map((c) => `=?UTF-8?B?${base64(enc.encode(c))}?=`).join(" ");
}

// ---------------------------------------------------------------------------
// מסלול 1 — Gmail SMTP
// ---------------------------------------------------------------------------
async function sendViaGmail(to: string[], subject: string, text: string, html: string) {
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });
  try {
    // ‏Gmail מחייב שה-From יהיה החשבון המאומת עצמו (או כינוי מאושר בתוכו).
    // שם התצוגה חופשי, הכתובת אינה.
    await client.send({
      from: `${encodeHeader(FROM_NAME)} <${GMAIL_USER}>`,
      to,
      subject: encodeHeader(subject),
      content: text,
      html,
    });
  } finally {
    // חיבור SMTP שלא נסגר משאיר socket פתוח עד סוף חיי ה-worker.
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// מסלול 2 — Resend (רשת ביטחון)
// ---------------------------------------------------------------------------
async function sendViaResend(to: string[], subject: string, text: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: ALERTS_FROM_EMAIL,
      reply_to: PLATFORM_CONTACT_EMAIL,
      to,
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ sent: false, error: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ sent: false, error: "unauthorized" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ sent: false, error: "invalid_json" }, 400);
  }

  const to = (Array.isArray(body?.to) ? body.to : [body?.to])
    .filter((x: unknown) => typeof x === "string" && x.includes("@"))
    .map((x: string) => x.trim())
    .slice(0, MAX_RECIPIENTS);
  const subject = String(body?.subject ?? "").slice(0, 200);
  const text = String(body?.text ?? "");
  const html = String(body?.html ?? "");

  if (to.length === 0) return json({ sent: false, error: "no_recipients" }, 400);
  if (!subject) return json({ sent: false, error: "missing_subject" }, 400);
  if (!text && !html) return json({ sent: false, error: "empty_body" }, 400);

  const attempts: string[] = [];

  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      await sendViaGmail(to, subject, text || " ", html || text);
      return json({ sent: true, via: "gmail", from: GMAIL_USER, recipients: to.length });
    } catch (err) {
      const detail = String((err as Error)?.message ?? err).slice(0, 300);
      /* ‏535 BadCredentials הוא כמעט תמיד אי-התאמה בין החשבון לסיסמה, ולא
         סיסמה שגויה: סיסמת אפליקציה תקפה רק לחשבון שבו נוצרה, ו-GMAIL_USER
         חייב להיות אותה כתובת בדיוק. בלי השורה הזו אין שום דרך להבדיל בין
         שלושת המקרים מבחוץ — הסוד אינו קריא, וההודעה של Google זהה בכולם.

         מודפסים החשבון ו**אורך** הסיסמה בלבד. התוכן לעולם לא נכנס ללוג. */
      console.warn(
        `gmail smtp failed (user=${GMAIL_USER || "(unset)"}, ` +
          `app_password_length=${GMAIL_APP_PASSWORD.length} expected=16):`,
        detail,
      );
      attempts.push(`gmail: ${detail}`);
    }
  } else {
    attempts.push("gmail: not_configured");
  }

  if (RESEND_KEY && ALERTS_FROM_EMAIL) {
    try {
      await sendViaResend(to, subject, text, html || text);
      return json({ sent: true, via: "resend", from: ALERTS_FROM_EMAIL, recipients: to.length, fallback_after: attempts });
    } catch (err) {
      attempts.push(`resend: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
    }
  } else {
    attempts.push("resend: not_configured");
  }

  // ‏502 ולא 500: הכשל הוא אצל ספק המשלוח, והקורא מבדיל בין "לא נשלח" לבין
  // בקשה פגומה שלו. הקוראים לא נופלים בגלל זה — הם רושמים וממשיכים.
  return json({ sent: false, via: null, error: attempts.join(" | ").slice(0, 500) }, 502);
});
