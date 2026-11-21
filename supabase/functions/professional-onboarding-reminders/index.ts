import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { corsHeaders, json } from "../_shared/morning.ts";
import { PLATFORM_CONTACT_EMAIL, sendPlatformEmail } from "../_shared/platform-mail-client.ts";

// ============================================================================
// תזכורות מדריך ההתחלה לבעלי מקצוע (docs/professional-cards.md, "מדריך ההתחלה")
//
// ‏pg_cron קורא לכאן פעם ביום, ורק כשיש כרטיסייה שמחכה לתזכורת (20271128100000). **מי זכאי נקבע במסד**
// (professional_onboarding_reminders_due): תזכורת אחרי 3 ימים ואחת אחרי 10, רק אם נשאר צעד חובה פתוח.
// כאן רק בונים את המייל מהמצב (professional_onboarding_state) ושולחים, עם הקישור האישי לעריכה.
//
// **סימון אחרי שליחה, לא לפניה.** מייל שנכשל מעדכן רק את מועד הניסיון (בלי להעלות את המונה): ינסו
// שוב מחר, והוא יורד לסוף התור ואינו חוסם את האחרים. **אימייל בלבד**, בלי וואטסאפ.
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

/** שורה לכל צעד חובה פתוח, עם מה שחסר בו. רשות אינה נכללת במייל. */
function missingLines(state: any): string[] {
  const lines: string[] = [];
  for (const s of state?.steps ?? []) {
    if (s.done || s.optional || !STEP_LINES[s.id]) continue;
    const detail: string[] = Array.isArray(s.detail) ? s.detail : [];
    lines.push(STEP_LINES[s.id] + (detail.length ? ` (חסר: ${detail.join(", ")})` : ""));
  }
  return lines;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: due, error } = await supabase.rpc("professional_onboarding_reminders_due", { p_limit: 20 });
  if (error) {
    console.error("professional-onboarding-reminders: due failed", error.message);
    return json({ error: "db_error" }, 500);
  }

  const stats = { due: (due ?? []).length, sent: 0, skipped: 0, failed: 0 };

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
      await supabase.rpc("mark_professional_onboarding_reminder", { p_placement_id: row.placement_id, p_no: 2 });
      stats.skipped++;
      continue;
    }

    const editUrl = `${siteBaseUrl}/professional-manage?token=${encodeURIComponent(row.manage_token)}`;
    const hello = row.advertiser_name ? `שלום ${row.advertiser_name},` : "שלום,";
    const intro = row.reminder_no === 1
      ? "הצטרפתם לשוק נדל״ן. כדי שהעמוד שלכם יוצג במלואו, נשארו כמה צעדים:"
      : "תזכורת אחרונה: כדי שהעמוד שלכם יוצג במלואו, נשארו הצעדים הבאים:";
    const subject = row.reminder_no === 1
      ? "כמה צעדים להשלמת העמוד שלכם בשוק נדל״ן"
      : "תזכורת אחרונה: השלמת העמוד שלכם בשוק נדל״ן";

    const html =
      `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<p>${esc(hello)}</p><p>${esc(intro)}</p>` +
      `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` +
      `<p><a href="${esc(editUrl)}">למסך העריכה</a></p>` +
      `<p style="color:#666;font-size:13px">שאלות? ${esc(PLATFORM_CONTACT_EMAIL)}</p></div>`;
    const text = [hello, intro, ...lines.map((l) => `- ${l}`), `מסך העריכה: ${editUrl}`,
      `שאלות? ${PLATFORM_CONTACT_EMAIL}`].join("\n\n");

    const sent = await sendPlatformEmail({ to: [row.email], subject, html, text });
    if (!sent.sent) {
      console.error("professional-onboarding-reminders: mail failed", row.placement_id, sent.error);
      // מעדכנים רק את מועד הניסיון, בלי להעלות את המונה
      await supabase.rpc("mark_professional_onboarding_reminder", {
        p_placement_id: row.placement_id, p_no: row.reminder_no - 1,
      });
      stats.failed++;
      continue;
    }
    await supabase.rpc("mark_professional_onboarding_reminder", {
      p_placement_id: row.placement_id, p_no: row.reminder_no,
    });
    stats.sent++;
  }

  return json({ ok: true, ...stats });
});
