import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { corsHeaders, json } from "../_shared/morning.ts";
import { PLATFORM_CONTACT_EMAIL, sendPlatformEmail } from "../_shared/platform-mail-client.ts";
import { isIsraelWorkday } from "../_shared/il-workday.ts";
import { unsubConfigured, unsubUrl } from "../_shared/onboarding-unsub.ts";

// ============================================================================
// תזכורות מדריך ההתחלה לבעלי מקצוע (docs/professional-cards.md, "מדריך ההתחלה")
//
// ‏pg_cron קורא לכאן ימים א'-ה' (20271128100000), ורק כשיש כרטיסייה שמחכה לתזכורת. **מי זכאי נקבע במסד**
// (professional_onboarding_reminders_due): תזכורת אחרי 3 ימים ואחת אחרי 10 (ולפחות שבוע אחרי הראשונה), רק
// אם נשאר צעד חובה פתוח, ורק ב-30 הימים הראשונים. כאן רק בונים את המייל מהמצב ושולחים, עם הקישור האישי לעריכה.
//
// **שבת וחג נדחים ליום החול הבא:** ריצה בשבת או בחג חוזרת בלי לשלוח (‏_shared/il-workday.ts). הזכאות נקבעת לפי
// זמן שעבר, ולכן הריצה הבאה תופסת אותה.
//
// **כל מייל נושא קישור הסרה** (‏_shared/onboarding-unsub.ts) שמסמן את שתי התזכורות כנשלחו. בלי סוד החתימה אין
// קישור, ולכן **לא שולחים** (נכשל סגור): הודעה בלי דרך הסרה גרועה מהודעה שלא יצאה.
//
// **סימון אחרי שליחה, לא לפניה, וכל סימון נבדק.** מייל שנכשל מעדכן רק את מועד הניסיון (בלי להעלות את המונה):
// ינסו שוב מחר, והוא יורד לסוף התור. ‏supabase-js אינו זורק, ולכן שגיאת סימון שלא נבדקה הייתה שולחת שוב מחר.
// **אימייל בלבד**, בלי וואטסאפ.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

// ‏escapeHtml של האתר חי ב-assets/esc.js, בדפדפן. כאן נבנה HTML של מייל בשרת, והשם מגיע מטופס פתוח.
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STEP_LINES: Record<string, string> = {
  photo: "תמונת פרופיל",
  intro: "משפט פתיחה ותיאור",
  offer: "שירותים ואזורי פעילות",
  phone: "טלפון",
};
// מה שמותר להופיע בסוגריים "חסר: ...". ערכי detail מגיעים מהמסד; **רק** תוויות בעברית מרשימה סגורה
// עוברות למייל, כך ששם שדה או ערך לא צפוי לעולם לא יגיע לבעל המקצוע.
const DETAIL_HE = new Set(["משפט פתיחה", "תיאור", "שירותים", "אזורי פעילות"]);

/** שורה לכל צעד חובה פתוח, עם מה שחסר בו. רשות אינה נכללת במייל. */
function missingLines(state: any): string[] {
  const lines: string[] = [];
  for (const s of state?.steps ?? []) {
    if (s.done || s.optional || !STEP_LINES[s.id]) continue;
    const detail: string[] = (Array.isArray(s.detail) ? s.detail : []).filter((d: string) => DETAIL_HE.has(d));
    lines.push(STEP_LINES[s.id] + (detail.length ? ` (חסר: ${detail.join(", ")})` : ""));
  }
  return lines;
}

function openingFor(reminderNo: number, cardStatus: string): string {
  if (reminderNo >= 2) return "רק מזכירים: נשארו הצעדים הבאים בעמוד שלכם:";
  return cardStatus === "pending_approval"
    ? "העמוד שלכם בשוק נדל״ן ממתין לאישור. בינתיים כדאי להשלים את הצעדים הבאים, כדי שהעמוד יהיה מלא:"
    : "העמוד שלכם בשוק נדל״ן כמעט מוכן. כדי שיוצג במלואו, נשארו כמה צעדים:";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  // שבת וחג נדחים ליום החול הבא (הזכאות נקבעת לפי זמן שעבר)
  if (!isIsraelWorkday()) return json({ ok: true, skipped: "not_workday" });
  // בלי קישור הסרה לא שולחים
  if (!unsubConfigured()) {
    console.error("professional-onboarding-reminders: ALERT_CRON_SECRET missing, no unsubscribe link, not sending");
    return json({ error: "unsubscribe_not_configured" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: due, error } = await supabase.rpc("professional_onboarding_reminders_due", { p_limit: 20 });
  if (error) {
    console.error("professional-onboarding-reminders: due failed", error.message);
    return json({ error: "db_error" }, 500);
  }

  const stats = { due: (due ?? []).length, sent: 0, skipped: 0, failed: 0 };
  // סימון נבדק ומנוסה פעמיים: מייל שיצא וסימון שנכשל היו נשלחים שוב ביום החול הבא. כישלון שני נרשם בנפרד
  // ("sent but unmarked" כשזה אחרי שליחה), כדי שיהיה גלוי שיש סיכון לכפילות
  const mark = async (placementId: string, no: number, what: string): Promise<boolean> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { error: markErr } = await supabase.rpc("mark_professional_onboarding_reminder", {
        p_placement_id: placementId, p_no: no,
      });
      if (!markErr) return true;
      console.error(`professional-onboarding-reminders: mark failed (${what}, attempt ${attempt})`, placementId, markErr.message);
    }
    if (what === "after send") console.error("professional-onboarding-reminders: SENT BUT UNMARKED, duplicate risk", placementId);
    return false;
  };

  for (const row of due ?? []) {
    const { data: state, error: stErr } = await supabase.rpc("professional_onboarding_state", {
      p_placement_id: row.placement_id,
    });
    if (stErr || state?.error) {
      console.error("professional-onboarding-reminders: state failed", row.placement_id, stErr?.message ?? state?.error);
      stats.failed++;
      continue;
    }
    const lines = missingLines(state);
    if (!lines.length) {
      // השלים/ה בינתיים: מסמנים כדי שלא ייבדק שוב
      if (!(await mark(row.placement_id, 2, "nothing to complete"))) { stats.failed++; continue; }
      stats.skipped++;
      continue;
    }

    const editUrl = `${siteBaseUrl}/professional-manage?token=${encodeURIComponent(row.manage_token)}`;
    const stopUrl = await unsubUrl("professional", row.placement_id);
    const last = row.reminder_no >= 2;
    const hello = row.advertiser_name ? `שלום ${row.advertiser_name},` : "שלום,";
    const intro = openingFor(row.reminder_no, row.card_status);
    const subject = last
      ? "נשארו עוד כמה צעדים בעמוד שלכם בשוק נדל״ן"
      : "כמה צעדים להשלמת העמוד שלכם בשוק נדל״ן";
    const lastLine = "זו התזכורת האחרונה שנשלח בנושא.";
    const privacyLine = "הקישור אישי לכם, עדיף לא להעביר אותו הלאה.";
    const questions = `יש שאלות? אפשר לכתוב לנו ל-${PLATFORM_CONTACT_EMAIL}`;
    const stopLine = "לא רוצים לקבל את התזכורות האלה?";

    const html =
      `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<p>${esc(hello)}</p><p>${esc(intro)}</p>` +
      `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
      (last ? `<p>${esc(lastLine)}</p>` : "") +
      `<p><a href="${esc(editUrl)}" style="display:inline-block;background:#0e2a6b;color:#ffffff;` +
      `padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">להשלמת העמוד</a></p>` +
      `<p style="color:#666;font-size:12px">${esc(privacyLine)}</p>` +
      `<p style="color:#666;font-size:13px">${esc(questions)}</p>` +
      `<p style="color:#888;font-size:12px">${esc(stopLine)} <a href="${esc(stopUrl)}">להסרה</a></p></div>`;
    const text = [
      hello, intro, ...lines.map((l) => `- ${l}`),
      ...(last ? [lastLine] : []),
      `להשלמת העמוד: ${editUrl}`, privacyLine, questions,
      `${stopLine} להסרה: ${stopUrl}`,
    ].join("\n\n");

    const sent = await sendPlatformEmail({ to: [row.email], subject, html, text });
    if (!sent.sent) {
      console.error("professional-onboarding-reminders: mail failed", row.placement_id, sent.error);
      // רק מועד הניסיון, בלי להעלות את המונה: ינסו שוב אחרי יום
      await mark(row.placement_id, row.reminder_no - 1, "after mail failure");
      stats.failed++;
      continue;
    }
    if (!(await mark(row.placement_id, row.reminder_no, "after send"))) { stats.failed++; continue; }
    stats.sent++;
  }

  return json({ ok: true, ...stats });
});
