import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { corsHeaders, json } from "../_shared/morning.ts";
import { PLATFORM_CONTACT_EMAIL, sendPlatformEmail } from "../_shared/platform-mail-client.ts";
import { isIsraelWorkday } from "../_shared/il-workday.ts";
import { unsubConfigured, unsubUrl } from "../_shared/onboarding-unsub.ts";

// ============================================================================
// תזכורות מדריך ההתחלה ליזמים, לקבלנים ולמשווקים (docs/new-projects.md, "מדריך ההתחלה")
//
// ‏pg_cron קורא לכאן פעם ביום, ורק כשיש חשבון שמחכה לתזכורת (20271127110000). **מי זכאי נקבע במסד**
// (developer_onboarding_reminders_due): תזכורת אחרי 3 ימים ואחת אחרי 10, רק אם נשאר צעד פתוח. כאן רק
// בונים את המייל מהמצב (developer_onboarding_state) ושולחים.
//
// **סימון אחרי שליחה, לא לפניה.** מייל שנכשל נשאר זכאי לריצה הבאה; סימון לפני השליחה היה מאבד אותו.
// הסימון הוא "קדימה בלבד" (mark_developer_onboarding_reminder), ולכן ריצה כפולה אינה שולחת פעמיים
// לאותה תזכורת בפועל: אחרי הסימון החשבון כבר אינו זכאי.
//
// **שבת וחג נדחים ליום החול הבא** (‏_shared/il-workday.ts): הזכאות נקבעת לפי זמן שעבר, והריצה הבאה תופסת אותה.
// **כל מייל נושא קישור הסרה** (‏_shared/onboarding-unsub.ts) שמסמן את שתי התזכורות כנשלחו; בלי סוד החתימה
// **לא שולחים**. כל סימון נבדק (‏supabase-js אינו זורק).
//
// **אימייל בלבד.** בלי וואטסאפ: הודעה יזומה בתבנית עולה כסף ומחייבת אישור תבנית והסכמה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

// ‏escapeHtml של האתר חי ב-assets/esc.js, בדפדפן. כאן נבנה HTML של מייל בשרת, ושם החברה ושמות
// הפרויקטים מגיעים מטופס פתוח: כל חמשת התווים.
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** שורה אחת לכל צעד פתוח (חובה בלבד). צעד חסום (אין עדיין פרויקט) אינו מוצג: אין מה לבקש ממנו. */
function missingLines(state: any): string[] {
  const lines: string[] = [];
  for (const s of state?.steps ?? []) {
    if (s.done || s.optional || s.blocked) continue;
    const detail: string[] = Array.isArray(s.detail) ? s.detail : [];
    switch (s.id) {
      case "brand":
        lines.push(`לוגו ותמונת שער לחברה${detail.length ? ` (חסר: ${detail.join(", ")})` : ""}`); break;
      case "company":
        lines.push(`פרטי החברה${detail.length ? ` (חסר: ${detail.join(", ")})` : ""}`); break;
      case "first_project":
        lines.push("הפרויקט הראשון שלכם"); break;
      case "photos":
        lines.push(`תמונות לפרויקט: תמונת שער ולפחות ארבע תמונות בגלריה${detail.length ? ` (בפרויקט: ${detail.join(", ")})` : ""}`); break;
      case "live":
        lines.push("העלאת פרויקט לאוויר"); break;
      case "contact":
        lines.push(`פרטי קשר לפרויקט: איש קשר, וטלפון או וואטסאפ${detail.length ? ` (בפרויקט: ${detail.join(", ")})` : ""}`); break;
    }
  }
  return lines;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  if (!isIsraelWorkday()) return json({ ok: true, skipped: "not_workday" });
  if (!unsubConfigured()) {
    console.error("developer-onboarding-reminders: ALERT_CRON_SECRET missing, no unsubscribe link, not sending");
    return json({ error: "unsubscribe_not_configured" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: due, error } = await supabase.rpc("developer_onboarding_reminders_due", { p_limit: 20 });
  if (error) {
    console.error("developer-onboarding-reminders: due failed", error.message);
    return json({ error: "db_error" }, 500);
  }

  const stats = { due: (due ?? []).length, sent: 0, skipped: 0, failed: 0 };
  const crmUrl = `${siteBaseUrl}/developer-crm`;
  const mark = async (developerId: string, no: number, what: string): Promise<boolean> => {
    const { error: markErr } = await supabase.rpc("mark_developer_onboarding_reminder", {
      p_developer_id: developerId, p_no: no,
    });
    if (markErr) console.error(`developer-onboarding-reminders: mark failed (${what})`, developerId, markErr.message);
    return !markErr;
  };

  for (const row of due ?? []) {
    const { data: state, error: stErr } = await supabase.rpc("developer_onboarding_state", {
      p_developer_id: row.developer_id,
    });
    if (stErr || state?.error) {
      console.error("developer-onboarding-reminders: state failed", row.developer_id, stErr?.message ?? state?.error);
      stats.failed++;
      continue;
    }
    const lines = missingLines(state);
    if (!lines.length) {
      // השלים/ה בינתיים: מסמנים כדי שלא ייבדק שוב
      if (!(await mark(row.developer_id, 2, "nothing to complete"))) { stats.failed++; continue; }
      stats.skipped++;
      continue;
    }

    const stopUrl = await unsubUrl("developer", row.developer_id);
    const stopLine = "לא רוצים לקבל את התזכורות האלה?";
    const hello = row.contact_name ? `שלום ${row.contact_name},` : "שלום,";
    const intro = row.reminder_no === 1
      ? `הצטרפתם לשוק נדל״ן${row.company_name ? ` עם ${row.company_name}` : ""}. כדי שהדף שלכם יוצג במלואו, נשארו כמה צעדים:`
      : "תזכורת אחרונה: כדי שהדף שלכם יוצג במלואו, נשארו הצעדים הבאים:";
    const subject = row.reminder_no === 1
      ? "כמה צעדים להשלמת הדף שלכם בשוק נדל״ן"
      : "תזכורת אחרונה: השלמת הדף שלכם בשוק נדל״ן";

    const html =
      `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<p>${esc(hello)}</p><p>${esc(intro)}</p>` +
      `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
      `<p><a href="${esc(crmUrl)}">לדשבורד היזמים</a></p>` +
      `<p style="color:#666;font-size:13px">שאלות? ${esc(PLATFORM_CONTACT_EMAIL)}</p>` +
      `<p style="color:#888;font-size:12px">${esc(stopLine)} <a href="${esc(stopUrl)}">להסרה</a></p></div>`;
    const text = [hello, intro, ...lines.map((l) => `- ${l}`), `דשבורד היזמים: ${crmUrl}`,
      `שאלות? ${PLATFORM_CONTACT_EMAIL}`, `${stopLine} להסרה: ${stopUrl}`].join("\n\n");

    const sent = await sendPlatformEmail({ to: [row.email], subject, html, text });
    if (!sent.sent) {
      console.error("developer-onboarding-reminders: mail failed", row.developer_id, sent.error);
      // מעדכנים רק את מועד הניסיון, בלי להעלות את המונה: ינסו שוב מחר, ואינו חוסם את שאר התור
      await mark(row.developer_id, row.reminder_no - 1, "after mail failure");
      stats.failed++;
      continue;
    }
    if (!(await mark(row.developer_id, row.reminder_no, "after send"))) { stats.failed++; continue; }
    stats.sent++;
  }

  return json({ ok: true, ...stats });
});
