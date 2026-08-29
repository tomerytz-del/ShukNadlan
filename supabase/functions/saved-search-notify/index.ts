import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// שרת ההתראות של הסוכן החכם — מרוקן את תור saved_search_alerts.
//
// ‏נקרא מ-pg_cron כל שתי דקות (ראו §8 במיגרציה). הטריגר על properties כותב
// לתור ברגע שהנכס נשמר, וכאן ההודעות יוצאות בפועל. ההפרדה מכוונת: קריאת
// ‏HTTP יוצאת מתוך טריגר הייתה כובלת את זמן שמירת הנכס לזמן התגובה של Meta,
// ונפילה של ספק חיצוני הייתה נפילה של פרסום מודעה.
//
// ‏מה שהפונקציה הזו *לא* מחליטה: מי מקבל/ת, מתי מותר לשלוח, וכמה. כל אלה
// יושבים ב-saved_search_pending_alerts (שעות שקט, תקרה יומית, חיפוש ונכס
// שעדיין פעילים). כאן רק בונים את ההודעה, שולחים, ומדווחים.
//
// ‏שני ערוצים, שני סטטוסים נפרדים: מי שביקש/ה "both" וקיבל/ה מייל אבל
// הוואטסאפ נכשל צריך/ה שהוואטסאפ יינסה שוב — ולא שההתראה תיחשב "נשלחה"
// או שהמייל יישלח פעמיים.
//
// --- על תבנית הוואטסאפ ------------------------------------------------------
// ‏Meta מרשה לעסק לפתוח שיחה עם מי שלא כתב/ה אליו **רק** דרך תבנית מאושרת
// מראש. מחפש/ת דירה לא כתב/ה לנו מעולם, ולכן הודעת טקסט חופשי אליו/ה תיכשל
// מחוץ לחלון 24 השעות. לכן ברירת המחדל כאן היא template, ו-WHATSAPP_ALERT_TEMPLATE
// הוא שם התבנית המאושרת. בלעדיו נשלח טקסט חופשי — מצב שמתאים לבדיקות מול
// מספר שכן כתב לנו, ולא לפרודקשן. ראו docs/smart-search-agent.md.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_ALERT_TEMPLATE") || "";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_ALERT_TEMPLATE_LANG") || "he";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const ALERTS_FROM_EMAIL = Deno.env.get("ALERTS_FROM_EMAIL") || "";

const FUNCTIONS_BASE = `${supabaseUrl}/functions/v1`;
const CRON_SECRET = Deno.env.get("ALERT_CRON_SECRET") || "";

const BATCH = 40;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// הרכבת ההודעה
// ---------------------------------------------------------------------------

const nis = (n: number | null) =>
  n === null || n === undefined ? "" : "₪" + Math.round(n).toLocaleString("he-IL");

/** "4 חדרים · 98 מ״ר · קומה 3" — רק מה שבאמת קיים במודעה. */
function specLine(a: any): string {
  return [
    a.rooms ? `${a.rooms} חדרים` : null,
    a.size_sqm ? `${Math.round(a.size_sqm)} מ״ר` : null,
    a.floor !== null && a.floor !== undefined ? `קומה ${a.floor}` : null,
  ].filter(Boolean).join(" · ");
}

/** "רובע יזרעאל, עפולה" — השכונה קודמת, כי היא מה שהמחפש/ת ביקש/ה. */
function placeLine(a: any): string {
  return [a.neighborhood, a.street, a.city].filter(Boolean).join(", ");
}

/**
 * הקישור עובר דרך saved-search-manage כדי שהקליק ייספר. זהו מדד ההתעניינות
 * היחיד שיש לנו על אדם שאינו רשום לאתר, והוא מה שקובע את ערך הליד.
 */
const clickUrl = (token: string) =>
  `${FUNCTIONS_BASE}/saved-search-manage?action=click&token=${encodeURIComponent(token)}`;
const unsubUrl = (token: string) =>
  `${FUNCTIONS_BASE}/saved-search-manage?action=unsubscribe&token=${encodeURIComponent(token)}`;

function textBody(a: any): string {
  const parts = [
    "🔔 נכס חדש שמתאים לחיפוש שלך",
    a.label ? `— ${a.label}` : "",
    "",
    a.title || "",
    placeLine(a),
    [nis(a.price), specLine(a)].filter(Boolean).join(" · "),
    "",
    `לצפייה: ${clickUrl(a.click_token)}`,
    "",
    `להפסקת ההתראות: ${unsubUrl(a.unsubscribe_token)}`,
  ];
  return parts.filter((p) => p !== "").join("\n").slice(0, 4000);
}

// ---------------------------------------------------------------------------
// וואטסאפ
// ---------------------------------------------------------------------------

/** שגיאה שנושאת את קוד השגיאה של Meta, כדי שהלולאה תוכל לפעול לפיו. */
class WhatsappError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

// ‏131050 — הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות שיווקיות מהעסק. זהו
// ביטול לכל דבר, גם אם לא נעשה דרך הקישור שלנו, ולכן הוא מכבה את החיפוש
// אצלנו. בלעדיו היינו ממשיכים לתייג את האדם הזה בכל נכס חדש לנצח.
const WA_OPTED_OUT = 131050;

async function sendWhatsapp(a: any): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new WhatsappError("whatsapp not configured", null);

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WA_TOKEN}`,
    "Content-Type": "application/json",
  };

  let payload: Record<string, unknown>;

  if (WA_TEMPLATE) {
    // שלושה פרמטרים בגוף התבנית, בסדר הזה:
    //   {{1}} הנכס והמיקום  ·  {{2}} מחיר ומאפיינים  ·  {{3}} שם החיפוש השמור
    payload = {
      messaging_product: "whatsapp",
      to: a.phone_e164,
      type: "template",
      template: {
        name: WA_TEMPLATE,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: [a.title, placeLine(a)].filter(Boolean).join(" — ").slice(0, 300) || "נכס חדש" },
              { type: "text", text: [nis(a.price), specLine(a)].filter(Boolean).join(" · ").slice(0, 300) || "פרטים באתר" },
              { type: "text", text: a.label ? String(a.label).slice(0, 300) : "החיפוש השמור שלך" },
            ],
          },
          // שני כפתורי URL דינמיים, בסדר הזה: צפייה בנכס, והפסקת התראות.
          // ‏הפרמטר הוא סיומת הכתובת בלבד — כך Meta מגדירה כפתור דינמי,
          // ולכן הטוקן לבדו ולא הכתובת המלאה.
          //
          // כפתור הביטול הוא לא נימוס אלא תנאי: תבנית שיווקית שאין ממנה
          // דרך יציאה נפסלת באישור, ומחפש/ת דירה שקיבל/ה הודעה ולא יכול/ה
          // לעצור אותה יחסום/תחסום את המספר — וזה עולה לנו בכל הנמענים.
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: a.click_token }],
          },
          {
            type: "button",
            sub_type: "url",
            index: "1",
            parameters: [{ type: "text", text: a.unsubscribe_token }],
          },
        ],
      },
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: a.phone_e164,
      type: "text",
      text: { preview_url: true, body: textBody(a) },
    };
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const raw = await res.text();
    let code: number | null = null;
    try {
      code = JSON.parse(raw)?.error?.code ?? null;
    } catch { /* גוף שאינו JSON — נשמר כטקסט ב-last_error */ }
    throw new WhatsappError(`whatsapp ${res.status}: ${raw.slice(0, 300)}`, code);
  }
}

// ---------------------------------------------------------------------------
// מייל
// ---------------------------------------------------------------------------
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function emailHtml(a: any): string {
  const spec = specLine(a);
  const place = placeLine(a);
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<body style="margin:0;background:#F5F3EF;font-family:Arial,Helvetica,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <p style="font-size:13px;color:#7A8899;margin:0 0 6px">🔔 נכס חדש שמתאים לחיפוש שלך${
      a.label ? ` — ${esc(a.label)}` : ""
    }</p>
    <div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;overflow:hidden">
      ${a.image_url ? `<img src="${esc(a.image_url)}" alt="" style="display:block;width:100%;max-height:280px;object-fit:cover">` : ""}
      <div style="padding:18px">
        <h1 style="margin:0 0 8px;font-size:19px;line-height:1.35">${esc(a.title || "נכס חדש")}</h1>
        ${place ? `<p style="margin:0 0 10px;color:#5A6675;font-size:14px">${esc(place)}</p>` : ""}
        <p style="margin:0 0 16px;font-size:17px;font-weight:bold">${esc(nis(a.price))}${
          spec ? `<span style="font-weight:normal;color:#5A6675;font-size:14px"> · ${esc(spec)}</span>` : ""
        }</p>
        <a href="${esc(clickUrl(a.click_token))}"
           style="display:inline-block;background:#1B2A41;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:15px">
          לצפייה בנכס
        </a>
      </div>
    </div>
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center">
      קיבלת את ההודעה כי הגדרת חיפוש שמור בשוק נדל״ן.<br>
      <a href="${esc(unsubUrl(a.unsubscribe_token))}" style="color:#98A2B0">הפסקת ההתראות</a>
    </p>
  </div>
</body></html>`;
}

async function sendEmail(a: any): Promise<void> {
  if (!RESEND_KEY || !ALERTS_FROM_EMAIL) throw new Error("email not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: ALERTS_FROM_EMAIL,
      to: [a.email],
      subject: `🔔 ${a.title || "נכס חדש"} — ${nis(a.price)}`,
      html: emailHtml(a),
      text: textBody(a),
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// הלולאה
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // ‏ALERT_CRON_SECRET הוא אופציונלי בכוונה: בלעדיו המנגנון עובד מיד אחרי
  // הפריסה, וההידוק הוא צעד אחד בתיעוד. הפונקציה אינה מקבלת תוכן מהקורא
  // אלא רק מרוקנת תור קיים, ולכן החשיפה מוגבלת להאצת משלוח שממילא היה יוצא.
  if (CRON_SECRET && req.headers.get("x-alert-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  const { data: alerts, error } = await sb.rpc("saved_search_pending_alerts", {
    p_limit: BATCH,
  });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  if (!alerts || alerts.length === 0) return json({ sent: 0, failed: 0, empty: true });

  let sent = 0, failed = 0;

  for (const a of alerts as any[]) {
    const wantWhatsapp = (a.contact_channel === "whatsapp" || a.contact_channel === "both") && !!a.phone_e164;
    const wantEmail = (a.contact_channel === "email" || a.contact_channel === "both") && !!a.email;

    let waStatus = wantWhatsapp ? "pending" : "not_requested";
    let emStatus = wantEmail ? "pending" : "not_requested";
    const errors: string[] = [];

    if (wantWhatsapp) {
      try {
        await sendWhatsapp(a);
        waStatus = "sent";
      } catch (err) {
        waStatus = "failed";
        errors.push(`whatsapp: ${err instanceof Error ? err.message : String(err)}`);

        // ביטול שנעשה מול Meta הוא ביטול. מכבים את החיפוש כאן, אחרת נמשיך
        // לתייג את האדם הזה בכל נכס חדש לנצח — ולצבור דחיות מול Meta.
        if (err instanceof WhatsappError && err.code === WA_OPTED_OUT) {
          const { error: unsubErr } = await sb.rpc("manage_saved_search", {
            p_token: a.unsubscribe_token,
            p_action: "unsubscribe",
          });
          if (unsubErr) console.error("opt-out unsubscribe failed", unsubErr.message);
          else console.log("unsubscribed after Meta opt-out", a.search_id);
        }
      }
    }

    if (wantEmail) {
      try {
        await sendEmail(a);
        emStatus = "sent";
      } catch (err) {
        emStatus = "failed";
        errors.push(`email: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // הסטטוס הכולל נגזר במסד מהשניים, ולא נשלח מכאן — "נשלחה" הוא החלטה
    // של המוצר (ערוץ אחד שהצליח מספיק), לא של הקוד ששלח.
    const { error: markErr } = await sb.rpc("mark_saved_search_alert", {
      p_alert_id: a.alert_id,
      p_whatsapp_status: waStatus,
      p_email_status: emStatus,
      p_error: errors.length ? errors.join(" | ").slice(0, 500) : null,
    });
    if (markErr) console.error("mark failed", a.alert_id, markErr.message);

    if (waStatus === "sent" || emStatus === "sent") sent++;
    else failed++;
  }

  return json({ sent, failed, processed: alerts.length });
});
