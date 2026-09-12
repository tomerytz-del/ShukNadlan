import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
 * החיתוך לחלקים הוא בגלל תקרת 75 התווים ל-encoded-word, והוא רץ על נקודות
 * קוד ולא על בתים — אחרת אימוג'י (⚠️, שני surrogates) היה נחתך באמצע.
 * רווח בין שני encoded-words סמוכים הוא חוקי ומתעלמים ממנו בפענוח; רווח
 * *בתוך* אחד מהם אינו חוקי, ולכן הוא לעולם לא נכנס לחלק עצמו.
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
//
// ‏כאן דיברה קודם denomailer@1.6.0, וכל הודעה בעברית יצאה שבורה. שלוש תקלות
// בקידוד הכותרות, כולן ב-config/mail/encoding.ts שלה:
//
//   ‏1. `quotedPrintableEncodeInline` מקודדת כל מחרוזת ש**מתחילה** ב-"=?" —
//      כלומר בדיוק כותרת שכבר מקודדת כהלכה. השורה שנועדה למנוע קידוד כפול
//      היא זו שגורמת לו.
//   ‏2. ה-Q-encoder שלה משאיר רווחים כלשונם. ‏encoded-word עם רווח אינו
//      חוקי, ו-Gmail מגיב בכך שהוא מאבד את כל בלוק הכותרות: From, To, Date
//      וגבולות ה-MIME נשפכים לגוף ההודעה, והנושא מוצג כמחרוזת מקודדת.
//   ‏3. היא מקפלת שורה כל 74 תווים, גם באמצע encoded-word. נושא בעברית
//      באורך רגיל חוצה את הסף.
//
// אי אפשר לעקוף את שלושתן מבחוץ: על שם השולח היא מריצה גם `trim()`, ולכן
// גם לא ניתן להסוות כותרת מקודדת מפני הבדיקה בסעיף 1.
//
// ‏SMTP הוא פרוטוקול קצר, וכאן מדברים אותו ישירות. היתרון אינו חיסכון
// בתלות אלא ודאות: כל בית שיוצא בחוט נכתב כאן.
// ---------------------------------------------------------------------------

const CRLF = "\r\n";
const SMTP_TIMEOUT_MS = 20_000;
const utf8 = new TextEncoder();

interface Session {
  conn: Deno.TlsConn;
  buf: string;
  dec: TextDecoder;
}

/** ‏write של socket אינו מבטיח כתיבה מלאה, וכתיבה חלקית של פקודה תוקעת. */
async function writeAll(conn: Deno.TlsConn, text: string): Promise<void> {
  const data = utf8.encode(text);
  let off = 0;
  while (off < data.length) {
    const n = await conn.write(data.subarray(off));
    if (n <= 0) throw new Error("smtp: הכתיבה לשקע נכשלה");
    off += n;
  }
}

/**
 * תשובת SMTP שלמה, אם כבר הגיעה במלואה. שורה "250-" היא המשך ושורה "250 "
 * היא הסוף, ולכן אי אפשר להסתפק בשורה הראשונה.
 */
function takeReply(s: Session): { code: number; text: string } | null {
  const parts = s.buf.split(CRLF);
  // האיבר האחרון הוא השארית שטרם הסתיימה ב-CRLF, ולכן אינו נבדק
  for (let i = 0; i < parts.length - 1; i++) {
    if (/^\d{3} /.test(parts[i])) {
      const lines = parts.slice(0, i + 1);
      s.buf = s.buf.slice(lines.join(CRLF).length + CRLF.length);
      return { code: Number(parts[i].slice(0, 3)), text: lines.join(" ") };
    }
    if (!/^\d{3}-/.test(parts[i])) {
      throw new Error(`smtp: תשובה לא תקינה ${JSON.stringify(parts[i]).slice(0, 80)}`);
    }
  }
  return null;
}

async function reply(s: Session, expected: number[]): Promise<string> {
  for (;;) {
    const r = takeReply(s);
    if (r) {
      if (!expected.includes(r.code)) throw new Error(`smtp ${r.code}: ${r.text.slice(0, 200)}`);
      return r.text;
    }
    const chunk = new Uint8Array(4096);
    const n = await s.conn.read(chunk);
    if (n === null) throw new Error("smtp: השרת סגר את החיבור");
    s.buf += s.dec.decode(chunk.subarray(0, n), { stream: true });
  }
}

/** ‏השגיאה נושאת את תשובת השרת בלבד — הפקודה שנשלחה אינה נכנסת אליה,
    כי אחת מהן היא הסיסמה. */
async function cmd(s: Session, line: string, expected: number[]): Promise<string> {
  await writeAll(s.conn, line + CRLF);
  return reply(s, expected);
}

function base64Lines(bytes: Uint8Array): string {
  const b = base64(bytes);
  const out: string[] = [];
  for (let i = 0; i < b.length; i += 76) out.push(b.slice(i, i + 76));
  return out.join(CRLF);
}

/** ‏toUTCString מחזיר "GMT", שהוא צורה מיושנת. RFC 5322 רוצה היסט מספרי. */
function rfc2822Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/**
 * ‏שני החלקים מקודדים ב-base64 ולא ב-quoted-printable. זו לא העדפה: base64
 * מבטיח שורות באורך קבוע שאינן מתחילות בנקודה, וכך נופלות מאליהן שתי
 * המלכודות של DATA — שורה ארוכה מ-998 תווים, ושורה שנפתחת בנקודה ומסיימת
 * את ההודעה באמצע.
 */
function buildMessage(to: string[], subject: string, text: string, html: string): string {
  const boundary = `__shuknadlan_${crypto.randomUUID().replace(/-/g, "")}`;
  const domain = GMAIL_USER.split("@")[1] || "gmail.com";
  return [
    // ‏Gmail מחייב שה-From יהיה החשבון המאומת עצמו. שם התצוגה חופשי,
    // הכתובת אינה.
    `From: ${encodeHeader(FROM_NAME)} <${GMAIL_USER}>`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${rfc2822Date(new Date())}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(utf8.encode(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(utf8.encode(html)),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

async function sendViaGmail(to: string[], subject: string, text: string, html: string) {
  // ‏465 הוא TLS משתמעת: המנהרה קמה לפני הבאנר, ואין STARTTLS שאפשר להוריד.
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  const s: Session = { conn, buf: "", dec: new TextDecoder() };

  // ‏שרת ששותק אינו מחזיר שגיאה — הקריאה פשוט לא נענית, וה-worker מחזיק
  // את החיבור עד סוף חייו. סגירה כפויה הופכת את השתיקה לכישלון מדווח.
  const deadline = setTimeout(() => {
    try { conn.close(); } catch { /* כבר נסגר */ }
  }, SMTP_TIMEOUT_MS);

  try {
    await reply(s, [220]);
    await cmd(s, "EHLO shuknadlan.co.il", [250]);
    await cmd(s, "AUTH LOGIN", [334]);
    await cmd(s, base64(utf8.encode(GMAIL_USER)), [334]);
    await cmd(s, base64(utf8.encode(GMAIL_APP_PASSWORD)), [235]);
    await cmd(s, `MAIL FROM:<${GMAIL_USER}>`, [250]);
    // ‏251 = הכתובת מנותבת הלאה. זו קבלה, לא דחייה.
    for (const rcpt of to) await cmd(s, `RCPT TO:<${rcpt}>`, [250, 251]);
    await cmd(s, "DATA", [354]);

    // הכפלת נקודה בתחילת שורה היא דרישת הפרוטוקול. הגוף כולו ב-base64 ולכן
    // אין שם שורה כזו — זו הגנה על שינוי עתידי בקידוד, לא תיקון של היום.
    const message = buildMessage(to, subject, text, html).replaceAll(`${CRLF}.`, `${CRLF}..`);
    await writeAll(conn, message + CRLF + "." + CRLF);
    await reply(s, [250]);

    // ‏ה-250 שלמעלה הוא הקבלה. פרידה לא מסודרת אחריו אינה כישלון משלוח.
    try { await cmd(s, "QUIT", [221]); } catch { /* ההודעה כבר התקבלה */ }
  } finally {
    clearTimeout(deadline);
    try { conn.close(); } catch { /* נסגר ב-QUIT או בפסק הזמן */ }
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
