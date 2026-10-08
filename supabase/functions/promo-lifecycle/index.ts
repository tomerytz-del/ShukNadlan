import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";
import { PROMO_NOTICE_DAYS, PROMO_WHATSAPP_DAYS, TIER_NAMES, TIER_PRICES, type Tier } from "../_shared/launch-promo.ts";

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
//   • **שבוע לפני, ויום לפני** — תזכורת קצרה בוואטסאפ בלבד (פעמון ←
//     notification-push), בלי מייל. הסימון בטבלה promo_notices ולא בעמודה
//     (20270308090000).
//   • **ביום הסיום** — ‎expire_launch_promos‎ מעביר/ה למסלול ששולם מראש את
//     מי ששילם/ה (‏paid_tier), ומוריד/ה ל-Pay&GO את מי שלא בחר/ה מסלול.
//
// **ההתראות הן הדלת לרכישת המנוי (20270307090000).** ‏start_subscription_order
// מתירה רכישה בתקופת ההטבה רק ב-30 הימים האחרונים שלה - בדיוק החלון שבו
// יוצאות שתי ההתראות - והתקופה ששולמה מתחילה בסוף ההטבה. לכן הכפתור במייל
// מוביל ישירות לעמוד התשלום, והמחיר כתוב במכתב. מי שכבר שילם/ה מקבל/ת
// אישור במקום תזכורת: "ההטבה מסתיימת, בחר/י מסלול" למי שבחר/ה היא מטרד
// שמוביל לרכישה כפולה. כל התראה נכתבת גם לפעמון (‏notifications, ‏system),
// ומשם יוצאת בוואטסאפ דרך notification-push.
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

const PRICING_URL = `${SITE_BASE_URL}/pricing`;
const CRM_URL = `${SITE_BASE_URL}/crm`;
const checkoutUrl = (tier: Tier) => `${SITE_BASE_URL}/checkout?product=subscription&tier=${tier}`;
const priceLine = (tier: Tier) => `${TIER_NAMES[tier]} ₪${TIER_PRICES[tier]} לחודש + מע״מ`;

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
// בתאריך הזה, ומה לעשות. הכפתור מוביל למקום שבו פועלים: עמוד התשלום למי
// שעוד לא בחר/ה, וה-CRM (ניהול המנוי) למי שכבר שילם/ה.
// ---------------------------------------------------------------------------

function shell(title: string, bodyHtml: string, ctaLabel: string, ctaHref = PRICING_URL) {
  return `<!doctype html>
<html lang="he" dir="rtl"><body style="margin:0;background:#F5F2ED;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;padding:26px">
      <h1 style="margin:0 0 14px;font-size:21px;line-height:1.35">${esc(title)}</h1>
      ${bodyHtml}
      <a href="${esc(ctaHref)}"
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

/** מנוי ששולם מראש ומתחיל בסוף ההטבה. ‏null = לא שולם. */
interface PrePaid { tier: Tier; until: string }

function prePaidOf(m: { paid_tier: string | null; paid_tier_until: string | null; promo_ends_at: string }):
  PrePaid | null {
  if (m.paid_tier !== "mid" && m.paid_tier !== "premium") return null;
  if (!m.paid_tier_until || new Date(m.paid_tier_until) <= new Date(m.promo_ends_at)) return null;
  return { tier: m.paid_tier, until: m.paid_tier_until };
}

function noticeMail(name: string, endsAt: string, daysLeft: number, prePaid: PrePaid | null) {
  const when = hebDate(endsAt);

  if (prePaid) {
    const tierName = TIER_NAMES[prePaid.tier];
    const title = `${name}, המנוי שלך ל-${tierName} מוכן`;
    const html = shell(title, [
      p(`הטבת ההשקה מסתיימת ב-<b>${esc(when)}</b>, ומאותו יום החשבון ממשיך ב-<b>${esc(tierName)}</b> ששילמת עליו - בלי הפסקה ובלי פעולה נוספת.`),
      p(`ימי ההטבה שנותרו לא נגבו. התקופה ששולמה מתחילה בסוף ההטבה, ומשם המנוי מתחדש חודשית. אפשר לבטל את החידוש בכל עת ב-CRM, תחת "ארנק וחיובים".`),
    ].join(""), "לניהול המנוי", CRM_URL);
    const text = [
      `${name}, הטבת ההשקה מסתיימת ב-${when}, ומאותו יום החשבון ממשיך ב-${tierName} ששילמת עליו.`,
      "",
      "ימי ההטבה שנותרו לא נגבו. המנוי מתחדש חודשית, ואפשר לבטל את החידוש בכל עת ב-CRM.",
      "",
      `לניהול המנוי: ${CRM_URL}`,
    ].join("\n");
    return { subject: title, html, text };
  }

  const title = daysLeft > 20
    ? `${name}, נשאר חודש להטבת ההשקה שלך`
    : `${name}, עוד שבועיים - וההטבה מסתיימת`;
  const html = shell(title, [
    p(`מסלול <b>Elite</b> שקיבלת במתנה עם ההצטרפות מסתיים ב-<b>${esc(when)}</b>.`),
    p("עד אז הכול ממשיך כרגיל: לידי בעל-נכס ללא עלות, סרטונים שיווקיים, הדמיות AI, דוחות CMA ומידע תכנוני."),
    p(`<b>להמשיך בלי הפסקה:</b> ${esc(priceLine("premium"))}, או ${esc(priceLine("mid"))}. התשלום כבר עכשיו אינו גובה דבר על ימי ההטבה שנותרו - החודש ששולם מתחיל ב-${esc(when)}, ומשם המנוי מתחדש חודשית וניתן לביטול בכל עת.`),
    p(`מי שלא בוחר/ת ממשיך/ה אוטומטית ב-<b>Pay&GO</b> - בלי דמי מנוי, עם 10 לידים בחודש. הנכסים, הלידים והלקוחות נשארים במקומם בכל מקרה.`),
    p(`<a href="${esc(checkoutUrl("mid"))}" style="color:#0e2a6b">להמשיך ב-PROFESSIONAL</a> · <a href="${esc(PRICING_URL)}" style="color:#0e2a6b">השוואת המסלולים</a>`),
  ].join(""), "להמשיך ב-Elite", checkoutUrl("premium"));

  const text = [
    `${name}, מסלול Elite שקיבלת במתנה מסתיים ב-${when}.`,
    "",
    `להמשיך בלי הפסקה: ${priceLine("premium")}, או ${priceLine("mid")}.`,
    `התשלום עכשיו אינו גובה על ימי ההטבה שנותרו - החודש ששולם מתחיל ב-${when}, ומתחדש חודשית.`,
    "מי שלא בוחר/ת ממשיך/ה ב-Pay&GO - בלי דמי מנוי, עם 10 לידים בחודש.",
    "",
    `להמשיך ב-Elite: ${checkoutUrl("premium")}`,
    `להמשיך ב-PROFESSIONAL: ${checkoutUrl("mid")}`,
    `השוואת המסלולים: ${PRICING_URL}`,
  ].join("\n");

  return { subject: title, html, text };
}

/** סוף ההטבה, משלושה מצבים: עבר/ה למנוי ששילם/ה, ירד/ה ל-Pay&GO, או ממשיך/ה במסלול שנבחר אחרת. */
function endedMail(name: string, downgraded: boolean, paidTier: Tier | null, paidUntil: string | null) {
  if (paidTier) {
    const tierName = TIER_NAMES[paidTier];
    const title = `${name}, המנוי שלך ל-${tierName} התחיל`;
    const body = [
      p(`שישה חודשים של <b>Elite</b> במתנה הסתיימו, והחשבון ממשיך ב-<b>${esc(tierName)}</b> ששילמת עליו.`),
      p(`החודש ששולם בתוקף עד <b>${esc(hebDate(paidUntil))}</b>, ומשם המנוי מתחדש חודשית (${esc(priceLine(paidTier))}). אפשר לבטל את החידוש בכל עת ב-CRM, תחת "ארנק וחיובים".`),
    ].join("");
    const text = [
      `${name}, הטבת ההשקה הסתיימה והחשבון ממשיך ב-${tierName} ששילמת עליו.`,
      "",
      `החודש ששולם בתוקף עד ${hebDate(paidUntil)}, ומשם המנוי מתחדש חודשית. ביטול החידוש ב-CRM.`,
      "",
      `לניהול המנוי: ${CRM_URL}`,
    ].join("\n");
    return { subject: title, html: shell(title, body, "לניהול המנוי", CRM_URL), text };
  }

  const title = `${name}, תקופת ההטבה הסתיימה`;
  const body = downgraded
    ? [
        p("שישה חודשים של <b>Elite</b> במתנה הסתיימו, והחשבון שלך עבר ל-<b>Pay&GO</b> - בלי דמי מנוי, עם 10 לידי קונה/שוכר בחודש ו-₪25 לליד נוסף."),
        p("<b>שום דבר לא אבד:</b> הנכסים, הלידים, הלקוחות, דף הסוכן/ת ויתרת הארנק נשארו בדיוק כפי שהיו."),
        p(`מה שכן השתנה: לידי בעל-נכס, דוחות CMA, המידע התכנוני, הסרטונים וההדמיות זמינים במסלולים בתשלום (${esc(priceLine("mid"))}, ${esc(priceLine("premium"))}). אפשר לחזור אליהם בכל רגע.`),
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
        `לחזור ל-Elite: ${checkoutUrl("premium")}`,
        `השוואת המסלולים: ${PRICING_URL}`,
      ].join("\n")
    : [`${name}, תקופת ההטבה הסתיימה והמסלול שבחרת ממשיך כרגיל.`, "", `דף המסלולים: ${PRICING_URL}`].join("\n");

  return {
    subject: title,
    html: downgraded
      ? shell(title, body, "לחזור ל-Elite", checkoutUrl("premium"))
      : shell(title, body, "לדף המסלולים"),
    text,
  };
}

// ---------------------------------------------------------------------------
// הפעמון
//
// המייל לבדו אינו מספיק: חלק מהסוכנים אינם קוראים את התיבה שנרשמו איתה,
// והפעמון יוצא גם בוואטסאפ. הנוסח קצר, ונושא את הקישור לפעולה.
// ---------------------------------------------------------------------------

type Bell = { agent_id: string; type: "system"; title: string; body: string };

function noticeBell(agentId: string, endsAt: string, prePaid: PrePaid | null): Bell {
  const when = hebDate(endsAt);
  if (prePaid) {
    return {
      agent_id: agentId, type: "system",
      title: `ההטבה מסתיימת ב-${when}, וה-${TIER_NAMES[prePaid.tier]} שלך ממשיך`,
      body: "המנוי ששילמת עליו מתחיל בסוף ההטבה, בלי הפסקה. ניהול וביטול החידוש ב\"ארנק וחיובים\".",
    };
  }
  return {
    agent_id: agentId, type: "system",
    title: `הטבת ה-Elite מסתיימת ב-${when}`,
    body: `להמשיך בלי הפסקה: ${priceLine("premium")} או ${priceLine("mid")}, ` +
      `והחודש ששולם מתחיל בסוף ההטבה. בלי בחירה - Pay&GO. ${checkoutUrl("premium")}`,
  };
}

/** "מחר" / "היום" / "בעוד N ימים" לפי התאריך בישראל, לא לפי 24 שעות: הריצה
 *  ב-09:40, וההטבה יכולה להסתיים באותו יום אחר הצהריים. */
function whenWords(endsAt: string): string {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const end = new Date(endsAt);
  const diff = Math.round((Date.parse(day(end)) - Date.parse(day(new Date()))) / 86400000);
  if (diff <= 0) return "היום";
  if (diff === 1) return "מחר";
  if (diff === 7) return "בעוד שבוע";
  return `בעוד ${diff} ימים`;
}

function reminderBell(agentId: string, endsAt: string, prePaid: PrePaid | null): Bell {
  const words = whenWords(endsAt);
  if (prePaid) {
    return {
      agent_id: agentId, type: "system",
      title: `הטבת ההשקה מסתיימת ${words} - ה-${TIER_NAMES[prePaid.tier]} שלך ממשיך`,
      body: "המנוי ששילמת עליו מתחיל בסוף ההטבה, בלי הפסקה ובלי פעולה נוספת.",
    };
  }
  return {
    agent_id: agentId, type: "system",
    title: `הטבת ה-Elite מסתיימת ${words} (${hebDate(endsAt)})`,
    body: `להמשיך בלי הפסקה: ${priceLine("premium")} או ${priceLine("mid")}. ` +
      `בלי בחירה החשבון עובר ל-Pay&GO. ${checkoutUrl("premium")}`,
  };
}

function endedBell(agentId: string, downgraded: boolean, paidTier: Tier | null): Bell | null {
  if (paidTier) {
    return {
      agent_id: agentId, type: "system",
      title: `המנוי ל-${TIER_NAMES[paidTier]} התחיל`,
      body: "הטבת ההשקה הסתיימה והחשבון ממשיך במסלול ששילמת עליו. המנוי מתחדש חודשית.",
    };
  }
  if (!downgraded) return null;
  return {
    agent_id: agentId, type: "system",
    title: "הטבת ההשקה הסתיימה - החשבון עבר ל-Pay&GO",
    body: `הנכסים, הלידים והארנק נשארו. לחזור ל-Elite: ${checkoutUrl("premium")}`,
  };
}

async function ring(supabase: any, bell: Bell | null) {
  if (!bell) return;
  const { error } = await supabase.from("notifications").insert(bell);
  if (error) console.error("promo bell failed", bell.agent_id, error.message);
}

// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  display_name: string | null;
  email: string | null;
  promo_ends_at: string;
  paid_tier: string | null;
  paid_tier_until: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

  const summary = { notice_1: 0, notice_2: 0, whatsapp_7: 0, whatsapp_1: 0, expired: 0, downgraded: 0, mail_failed: 0, dry_run: dryRun };

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
        .select("id, display_name, email, promo_ends_at, paid_tier, paid_tier_until")
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
        const prePaid = prePaidOf(member);
        await ring(supabase, noticeBell(member.id, member.promo_ends_at, prePaid));
        if (!member.email) continue;

        const daysLeft = Math.max(1, Math.ceil((new Date(member.promo_ends_at).getTime() - Date.now()) / 86400000));
        const mail = noticeMail(member.display_name || "שלום", member.promo_ends_at, daysLeft, prePaid);
        const sent = await sendPlatformEmail({ to: [member.email], ...mail });
        if (!sent.sent) { summary.mail_failed++; console.error("notice mail failed", member.id, sent.error); }
      }
    }

    // ---- התזכורות בוואטסאפ: שבוע ויום לפני ----
    // יום-לפני קודם: מי שנכנס/ה לשתיהן באותה ריצה (הטבה קצרה, או ריצה
    // שהוחמצה) מקבל/ת רק את הקרובה לסוף, וזו של השבוע נרשמת כאילו נשלחה.
    // הסדר יורד לפי promo_ends_at: מי שכבר קיבל/ה יושב/ת בתחתית, כך שתקרת
    // ה-200 לעולם אינה נתפסת כולה בשורות שכבר טופלו.
    const waDays = [...PROMO_WHATSAPP_DAYS].sort((a, b) => a - b);
    for (const days of waDays) {
      const cutoff = new Date(Date.now() + days * 86400000).toISOString();
      const { data: due, error } = await supabase
        .from("agency_members")
        .select("id, display_name, email, promo_ends_at, paid_tier, paid_tier_until")
        .not("promo_ends_at", "is", null)
        .is("promo_ended_at", null)
        .lte("promo_ends_at", cutoff)
        .gt("promo_ends_at", new Date().toISOString())
        .order("promo_ends_at", { ascending: false })
        .limit(200);
      if (error) { console.error(`whatsapp ${days} query failed`, error.message); continue; }

      for (const member of (due || []) as MemberRow[]) {
        if (dryRun) {
          const { count } = await supabase.from("promo_notices").select("member_id", { count: "exact", head: true })
            .eq("member_id", member.id).eq("days_before", days);
          if (!count) summary[days === 1 ? "whatsapp_1" : "whatsapp_7"]++;
          continue;
        }
        // הסימון הוא ה-insert: שורה שחזרה = זו הפעם הראשונה. התזכורות
        // המוקדמות יותר (7 כשזו של יום) נרשמות יחד איתה, כדי שלא יצאו אחריה.
        const rows = PROMO_WHATSAPP_DAYS.filter((d) => d >= days)
          .map((d) => ({ member_id: member.id, days_before: d, promo_ends_at: member.promo_ends_at }));
        const { data: marked, error: markErr } = await supabase.from("promo_notices")
          .upsert(rows, { onConflict: "member_id,days_before", ignoreDuplicates: true })
          .select("days_before");
        if (markErr) { console.error("whatsapp mark failed", member.id, markErr.message); continue; }
        if (!(marked || []).some((r: { days_before: number }) => r.days_before === days)) continue;

        summary[days === 1 ? "whatsapp_1" : "whatsapp_7"]++;
        await ring(supabase, reminderBell(member.id, member.promo_ends_at, prePaidOf(member)));
      }
    }

    // ---- הסיום ----
    if (!dryRun) {
      const { data: closed, error: expErr } = await supabase.rpc("expire_launch_promos");
      if (expErr) {
        console.error("expire_launch_promos failed", expErr.message);
        return json({ error: "db_error", detail: expErr.message, summary }, 500);
      }

      const rows = (closed || []) as Array<{
        member: string; member_name: string | null; member_email: string | null;
        previous_tier: Tier | null; new_tier: Tier; downgraded: boolean;
      }>;

      // מי עבר/ה למנוי ששילם/ה. ‏expire_launch_promos אינה מחזירה את
      // tier_source, ולכן נקרא כאן - אחרי העדכון, כך שזה המצב שנקבע בפועל.
      const paid = new Map<string, { tier: Tier; until: string | null }>();
      if (rows.length) {
        const { data: src } = await supabase.from("agency_members")
          .select("id, tier, tier_source, paid_tier_until")
          .in("id", rows.map((r) => r.member));
        for (const m of src || []) {
          if (m.tier_source === "paid" && (m.tier === "mid" || m.tier === "premium")) {
            paid.set(m.id, { tier: m.tier, until: m.paid_tier_until });
          }
        }
      }

      for (const row of rows) {
        summary.expired++;
        if (row.downgraded) summary.downgraded++;
        const pt = paid.get(row.member) ?? null;
        await ring(supabase, endedBell(row.member, row.downgraded, pt?.tier ?? null));
        if (!row.member_email) continue;

        const mail = endedMail(row.member_name || "שלום", row.downgraded, pt?.tier ?? null, pt?.until ?? null);
        const sent = await sendPlatformEmail({ to: [row.member_email], ...mail });
        if (!sent.sent) { summary.mail_failed++; console.error("ended mail failed", row.member, sent.error); }
      }
    }

    return json({ success: true, ...summary, tier_names: TIER_NAMES });
  } catch (err) {
    return json({ error: "unhandled", detail: String((err as Error)?.message ?? err), summary }, 500);
  }
});
