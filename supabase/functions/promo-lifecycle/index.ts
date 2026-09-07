import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";
import { PROMO_NOTICE_DAYS, TIER_NAMES, type Tier } from "../_shared/launch-promo.ts";

// ============================================================================
// מחזור החיים של הטבת ההשקה — שתי התראות וסיום
//
// ההטבה עצמה ניתנת ברגע ההצטרפות (‏grant_launch_promo). הקובץ הזה מטפל בכל
// מה שקורה אחר כך, פעם ביום:
//
//   • **חודש לפני הסיום** — התראה ראשונה. חודש הוא הזמן שבו אפשר עוד
//     להחליט בלי לחץ.
//   • **שבועיים לפני** — התראה שנייה. שבועיים אחרי הראשונה, בדיוק כפי
//     שסוכם.
//   • **ביום הסיום** — ‎expire_launch_promos‎ מוריד/ה ל-Pay&GO את מי שלא
//     בחר/ה מסלול בעצמו/ה, ונשלחת הודעה שמפנה לדף המסלולים.
//
// שלוש החלטות שמסבירות את המבנה:
//
//   1. **הסימון קודם לשליחה.** כל התראה מסומנת על השורה (‏promo_notice_1_at)
//      לפני שהמייל יוצא. מייל כפול הוא מטרד; ריצה שנפלה באמצע ואז שלחה
//      לכולם שוב היא תלונה. הסדר הזה מעדיף את הכיוון הפחות מזיק.
//   2. **הסיום מופרד מהשליחה.** ‎expire_launch_promos‎ עושה את שינוי המסלול
//      בטרנזקציה אחת ומחזיר/ה את השורות; המיילים נשלחים אחר כך. מייל שנכשל
//      לא משאיר סוכן/ת על Elite לנצח.
//   3. **ריצה יומית ולא כל שעה.** ההתראות נמדדות בימים. הרצה תכופה יותר רק
//      מגדילה את הסיכוי לשלוח פעמיים.
//
// אימות: ‎_shared/cron-auth.ts‎ — ‏service_role או x-alert-cron-secret. הפונקציה
// רצה עם verify_jwt = false (ראו supabase/config.toml), ולכן היא **חייבת**
// לאמת בעצמה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

const PRICING_URL = `${SITE_BASE_URL}/pricing.html`;

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
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const hebDate = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
};

// ---------------------------------------------------------------------------
// המכתבים
//
// שלושתם אומרים את אותם שלושה דברים בסדר הזה: מה יש לך עכשיו, מה קורה
// בתאריך הזה, ומה לעשות. הכפתור מוביל תמיד לדף המסלולים — הוא המקום היחיד
// שבו אפשר לפעול.
// ---------------------------------------------------------------------------

function shell(title: string, bodyHtml: string, ctaLabel: string) {
  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#F5F2ED;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:26px">
      <h1 style="margin:0 0 14px;font-size:21px;line-height:1.35">${esc(title)}</h1>
      ${bodyHtml}
      <a href="${esc(PRICING_URL)}"
         style="display:inline-block;margin-top:8px;background:#0e2a6b;color:#fff;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px;font-weight:bold">
        ${esc(ctaLabel)}
      </a>
    </div>
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center;line-height:1.6">
      שוק הנדל״ן של עפולה והסביבה · <a href="${esc(PRICING_URL)}" style="color:#7A8899">${esc(PRICING_URL)}</a>
    </p>
  </div>
</body></html>`;
}

const p = (text: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#3D4A5C">${text}</p>`;

function noticeMail(name: string, endsAt: string, daysLeft: number) {
  const when = hebDate(endsAt);
  const title = daysLeft > 20
    ? `${name}, נשאר חודש להטבת ההשקה שלך`
    : `${name}, עוד שבועיים — וההטבה מסתיימת`;
  const html = shell(title, [
    p(`מסלול <b>Elite</b> שקיבלת במתנה עם ההצטרפות מסתיים ב-<b>${esc(when)}</b>.`),
    p("עד אז הכול ממשיך כרגיל: לידי בעל-נכס ללא עלות, סרטונים שיווקיים, הדמיות AI, דוחות CMA ומידע תכנוני."),
    p("<b>מה קורה אחר כך:</b> אפשר להמשיך ב-Elite או ב-PROFESSIONAL, ומי שלא בוחר/ת ממשיך/ה אוטומטית ב-Pay&GO — בלי דמי מנוי, עם 10 לידים בחודש. הנכסים, הלידים והלקוחות נשארים במקומם בכל מקרה."),
  ].join(""), "לבחירת המסלול שלי");

  const text = [
    `${name}, מסלול Elite שקיבלת במתנה מסתיים ב-${when}.`,
    "",
    "עד אז הכול ממשיך כרגיל. אחר כך אפשר להמשיך ב-Elite או ב-PROFESSIONAL,",
    "ומי שלא בוחר/ת ממשיך/ה ב-Pay&GO — בלי דמי מנוי, עם 10 לידים בחודש.",
    "",
    `לבחירת המסלול: ${PRICING_URL}`,
  ].join("\n");

  return { subject: title, html, text };
}

function endedMail(name: string, downgraded: boolean) {
  const title = `${name}, תקופת ההטבה הסתיימה`;
  const body = downgraded
    ? [
        p("שישה חודשים של <b>Elite</b> במתנה הסתיימו, והחשבון שלך עבר ל-<b>Pay&GO</b> — בלי דמי מנוי, עם 10 לידי קונה/שוכר בחודש ו-₪10 לליד נוסף."),
        p("<b>שום דבר לא אבד:</b> הנכסים, הלידים, הלקוחות, דף הסוכן/ת ויתרת הארנק נשארו בדיוק כפי שהיו."),
        p("מה שכן השתנה: לידי בעל-נכס, דוחות CMA, המידע התכנוני, הסרטונים וההדמיות זמינים במסלולים בתשלום. אפשר לחזור אליהם בכל רגע."),
      ].join("")
    : [
        p("תקופת הטבת ההשקה הסתיימה, והמסלול שבחרת ממשיך כרגיל."),
        p("אפשר לעדכן אותו בכל עת בדף המסלולים."),
      ].join("");

  const text = downgraded
    ? [
        `${name}, שישה חודשי Elite במתנה הסתיימו והחשבון עבר ל-Pay&GO.`,
        "",
        "הנכסים, הלידים, הלקוחות והארנק נשארו כמו שהם.",
        "לידי בעל-נכס, דוח CMA, מידע תכנוני, סרטונים והדמיות זמינים במסלולים בתשלום.",
        "",
        `לבחירת מסלול: ${PRICING_URL}`,
      ].join("\n")
    : [`${name}, תקופת ההטבה הסתיימה והמסלול שבחרת ממשיך כרגיל.`, "", `דף המסלולים: ${PRICING_URL}`].join("\n");

  return { subject: title, html: shell(title, body, downgraded ? "בחירת מסלול" : "לדף המסלולים"), text };
}

// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  display_name: string | null;
  email: string | null;
  promo_ends_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

  const summary = { notice_1: 0, notice_2: 0, expired: 0, downgraded: 0, mail_failed: 0, dry_run: dryRun };

  try {
    // ---- שתי ההתראות ----
    // ‏[0] = 30 יום לפני, ‏[1] = 14 יום לפני. העמודה שמסמנת כל אחת נגזרת
    // מהאינדקס, ולכן הוספת התראה שלישית דורשת עמודה — וזה בכוונה: התראה
    // בלי עמודה משלה נשלחת כל יום מחדש.
    const noticeColumns = ["promo_notice_1_at", "promo_notice_2_at"] as const;

    for (let i = 0; i < PROMO_NOTICE_DAYS.length; i++) {
      const days = PROMO_NOTICE_DAYS[i];
      const column = noticeColumns[i];
      const cutoff = new Date(Date.now() + days * 86400000).toISOString();

      const { data: due, error } = await supabase
        .from("agency_members")
        .select("id, display_name, email, promo_ends_at")
        .not("promo_ends_at", "is", null)
        .is("promo_ended_at", null)
        .is(column, null)
        .lte("promo_ends_at", cutoff)
        .gt("promo_ends_at", new Date().toISOString())
        .limit(200);

      if (error) {
        console.error(`notice ${days} query failed`, error.message);
        continue;
      }

      for (const member of (due || []) as MemberRow[]) {
        if (dryRun) { summary[i === 0 ? "notice_1" : "notice_2"]++; continue; }

        // סימון לפני שליחה — ראו ההסבר בראש הקובץ.
        const { error: markErr } = await supabase
          .from("agency_members").update({ [column]: new Date().toISOString() }).eq("id", member.id);
        if (markErr) { console.error("notice mark failed", markErr.message); continue; }

        summary[i === 0 ? "notice_1" : "notice_2"]++;
        if (!member.email) continue;

        const daysLeft = Math.max(1, Math.ceil((new Date(member.promo_ends_at).getTime() - Date.now()) / 86400000));
        const mail = noticeMail(member.display_name || "שלום", member.promo_ends_at, daysLeft);
        const sent = await sendPlatformEmail({ to: [member.email], ...mail });
        if (!sent.sent) { summary.mail_failed++; console.error("notice mail failed", member.id, sent.error); }
      }
    }

    // ---- הסיום ----
    if (!dryRun) {
      const { data: closed, error: expErr } = await supabase.rpc("expire_launch_promos");
      if (expErr) {
        console.error("expire_launch_promos failed", expErr.message);
        return json({ error: "db_error", detail: expErr.message, summary }, 500);
      }

      for (const row of (closed || []) as Array<{
        member: string; member_name: string | null; member_email: string | null;
        previous_tier: Tier | null; new_tier: Tier; downgraded: boolean;
      }>) {
        summary.expired++;
        if (row.downgraded) summary.downgraded++;
        if (!row.member_email) continue;

        const mail = endedMail(row.member_name || "שלום", row.downgraded);
        const sent = await sendPlatformEmail({ to: [row.member_email], ...mail });
        if (!sent.sent) { summary.mail_failed++; console.error("ended mail failed", row.member, sent.error); }
      }
    }

    return json({ success: true, ...summary, tier_names: TIER_NAMES });
  } catch (err) {
    return json({ error: "unhandled", detail: String((err as Error)?.message ?? err), summary }, 500);
  }
});
