// ============================================================================
// שליחת מייל בשם הפלטפורמה — הצד של הקורא
//
// ‏המשלוח עצמו יושב ב-Edge Function אחת (platform-mail), שהיא היחידה שמכירה
// את סיסמת האפליקציה של Gmail ואת מפתח Resend. כאן רק פונים אליה.
//
// ‏כלל אחד: **שליחה שנכשלה אינה זורקת.** אף אחד מהקוראים לא נכשל בגלל מייל
// — ליד נקלט, הזמנה נוצרת, התראה נרשמת. התוצאה חוזרת כאובייקט, והקורא
// מחליט מה לעשות איתה.
// ============================================================================

const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** כתובת הקשר של הפלטפורמה, כפי שהיא מופיעה *בתוך* גוף ההודעות. */
export const PLATFORM_CONTACT_EMAIL =
  Deno.env.get("PLATFORM_CONTACT_EMAIL") ||
  (Deno.env.get("GMAIL_USER") || "").trim() ||
  "shuknadlan@gmail.com";

export interface PlatformEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  sent: boolean;
  via: string | null;
  error: string | null;
}

export async function sendPlatformEmail(msg: PlatformEmail): Promise<MailResult> {
  const to = (msg.to || []).filter(Boolean);
  if (to.length === 0) return { sent: false, via: null, error: "no_recipients" };

  try {
    const res = await fetch(`${FUNCTIONS_BASE}/platform-mail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out?.sent) {
      return {
        sent: false,
        via: out?.via ?? null,
        error: String(out?.error ?? `platform-mail ${res.status}`).slice(0, 300),
      };
    }
    return { sent: true, via: out.via ?? "unknown", error: null };
  } catch (err) {
    return { sent: false, via: null, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}
