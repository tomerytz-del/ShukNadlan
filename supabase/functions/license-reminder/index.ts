import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";

// ============================================================================
// תזכורת לאימות רישיון - 48 שעות ו-7 ימים אחרי ההרשמה
//
// הבחירה, הסימון והפעמון יושבים במסד (‏license_reminders_run, מיגרציה
// 20270723090000_license_reminder.sql), בטרנזקציה אחת. כאן נשלח רק המייל,
// על השורות שהריצה החזירה - כלומר מייל שנכשל אינו נשלח שוב מחר, והפעמון
// (ומשם הוואטסאפ) כבר יצא. ‏?dry_run=1 קורא את המועמדים בלי לסמן ובלי לשלוח.
//
// הקישור מוביל ל-/crm?goto=license: כרטיס הרישיון בראש הדשבורד, שממנו
// מעלים אישור או מתקנים מספר (‏handleGotoParam ב-assets/crm.js).
//
// אימות: ‎_shared/cron-auth.ts‎ - ‏service_role או x-alert-cron-secret. הפונקציה
// רצה עם verify_jwt = false (ראו supabase/config.toml), ולכן היא **חייבת**
// לאמת בעצמה. ‏docs/broker-registry.md, "תזכורת".
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
const LICENSE_URL = `${SITE_BASE_URL}/crm?goto=license`;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Row {
  member_id: string;
  stage: number;
  display_name: string | null;
  email: string | null;
  is_manager: boolean;
  no_number: boolean;
  held: number;
}

// המכתב אומר שלושה דברים: מה מחכה, כמה זה לוקח, ואיפה עושים את זה. הנוסח
// הוא הזמנה ולא אזהרה, כמו הכרטיס בדשבורד ("החשבון שלך מוכן לעבודה!").
function reminderMail(r: Row) {
  const name = (r.display_name || "").trim().split(/\s+/)[0] || "שלום";
  const what = r.is_manager ? "דף המשרד והדף שלך עוד לא מוצגים" : "הדף שלך עוד לא מוצג";
  const subject = `${r.stage === 2 ? "תזכורת: " : ""}${name}, ${what} לגולשים`;
  const action = r.no_number
    ? "חסר מספר רישיון התיווך. הוספת המספר לוקחת דקה"
    : "המספר שנרשם עוד לא אושר מול פנקס המתווכים (רישיון חדש מופיע שם רק אחרי העדכון הרבעוני). העלאת צילום של אישור הרישיון לוקחת דקה";
  const held = r.held === 1 ? "מודעה אחת שלך ממתינה" : r.held > 1 ? `${r.held} מודעות שלך ממתינות` : "";
  const lines = [
    `החשבון שלך פעיל, ואפשר לעבוד בו כרגיל. מה שמחכה הוא הפרסום: ${what} לגולשים${held ? `, ו${held}` : ""} - עד שהרישיון יאושר.`,
    `${action}, והכול עולה לאוויר מעצמו עם האישור.`,
  ];
  const cta = r.no_number ? "להוספת מספר הרישיון" : "להעלאת אישור הרישיון";

  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#3D4A5C">${esc(t)}</p>`;
  const html = `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#F5F2ED;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:26px">
      <h1 style="margin:0 0 14px;font-size:21px;line-height:1.35">${esc(subject)}</h1>
      ${lines.map(p).join("")}
      <a href="${esc(LICENSE_URL)}"
         style="display:inline-block;margin-top:8px;background:#0e2a6b;color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px;font-weight:bold">
        ${esc(cta)}
      </a>
    </div>
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center;line-height:1.6">
      שוק נדל״ן · <a href="${esc(SITE_BASE_URL)}" style="color:#7A8899">${esc(SITE_BASE_URL)}</a>
    </p>
  </div>
</body></html>`;
  const text = [`${name},`, "", ...lines, "", `${cta}: ${LICENSE_URL}`].join("\n");
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";
  const summary = { stage_1: 0, stage_2: 0, mailed: 0, mail_failed: 0, no_email: 0, dry_run: dryRun };

  try {
    const { data, error } = await supabase.rpc(dryRun ? "license_reminder_candidates" : "license_reminders_run");
    if (error) return json({ error: "db_error", detail: error.message, summary }, 500);

    for (const r of (data || []) as Row[]) {
      summary[r.stage === 2 ? "stage_2" : "stage_1"]++;
      if (dryRun) continue;
      if (!r.email) { summary.no_email++; continue; }
      const sent = await sendPlatformEmail({ to: [r.email], ...reminderMail(r) });
      if (sent.sent) summary.mailed++;
      else { summary.mail_failed++; console.error("license reminder mail failed", r.member_id, sent.error); }
    }
    return json({ success: true, ...summary });
  } catch (err) {
    return json({ error: "unhandled", detail: String((err as Error)?.message ?? err), summary }, 500);
  }
});
