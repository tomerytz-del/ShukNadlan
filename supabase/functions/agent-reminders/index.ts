import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";

// ============================================================================
// שרת התזכורות לסוכנים — מוציא את הודעת התזכורת המקובצת במייל ובוואטסאפ.
//
// ‏נקרא מ-pg_cron פעם בשעה ב-:15, ורק כשיש למי לשלוח (‏`agent_reminders_ready()`
// במיגרציה 20261026090000). למה שעתי ולא יומי בשעה קבועה: שעות השקט הן פר
// סוכן/ת, ולכן החלון הראשון שמותר לשלוח בו שונה מאחד/ת לאחר/ת.
//
// ## מה הפונקציה הזו *לא* מחליטה
//
// מי מקבל/ת, מה כתוב, מתי מותר, וכמה. כל אלה יושבים במסד:
//
//   ‏· `agent_reminder_findings`  — מה יש להזכיר (מחושב מהמצב, לא מתור)
//   ‏· `agent_reminder_due_agents` — למי מותר עכשיו (קצב, תקרה, שעות שקט)
//   ‏· `agent_reminders_claim`     — רושם/ת את שורת היומן ומחזיר/ה מה לשלוח
//
// כאן רק מרכיבים את ההודעה משורה שהגיעה מוכנה, שולחים, ומדווחים. ההפרדה
// הזו היא מה שמאפשר לשנות סף או נוסח בלי לפרוס פונקציה מחדש.
//
// ## שני ערוצים, שני סטטוסים נפרדים
//
// סוכן/ת שביקש/ה גם מייל וגם וואטסאפ, וקיבל/ה את המייל בזמן שהוואטסאפ נכשל,
// צריך/ה שהניסיון החוזר יהיה על הוואטסאפ בלבד — ולא שהמייל יישלח פעמיים
// ולא שההודעה כולה תיחשב "נשלחה".
//
// ## על תבנית הוואטסאפ
//
// ‏Meta מרשה לעסק לפתוח שיחה מחוץ לחלון 24 השעות **רק** דרך תבנית מאושרת
// מראש. סוכן/ת שלא כתב/ה לבוט היום הוא/היא בדיוק המצב הזה, ולכן
// ‏`WHATSAPP_REMINDER_TEMPLATE` הוא הדרך הנכונה בפרודקשן. בלעדיו נשלח טקסט
// חופשי — מצב שמתאים לבדיקה מול מספר ששלח לנו הודעה בשעות האחרונות, ולא
// לפרודקשן. אותו שיקול בדיוק כמו ב-saved-search-notify.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_REMINDER_TEMPLATE") || "";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_REMINDER_TEMPLATE_LANG") || "he";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

// הקטגוריה בדשבורד שבה מנהלים את התזכורות עצמן. מופיעה בכל הודעה, בשני
// הערוצים: הודעה שאין ממנה דרך להנמיך את הקצב היא הודעה שמובילה לחסימה.
const MANAGE_ACC = "accReminders";

const BATCH = 40;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// הרכבת ההודעה
//
// ‏items הגיע מהמסד כמערך של ‎{kind,title,body,action,count}‎ כבר בסדר הנכון
// (‏sort_order ב-findings), ולכן כאן אין מיון ואין חיתוך של תוכן — רק עטיפה.
// ---------------------------------------------------------------------------

type Item = {
  kind: string;
  title: string;
  body: string;
  action: string | null;
  count: number | null;
};

/** הקישור שמנחית את הסוכן/ת בקטגוריה שבה באמת מטפלים בממצא. */
function actionUrl(acc: string | null): string {
  const safe = /^acc[A-Za-z0-9]+$/.test(acc || "") ? acc : MANAGE_ACC;
  return `${SITE_BASE}/crm.html?goto=${encodeURIComponent(safe!)}`;
}

const manageUrl = () => actionUrl(MANAGE_ACC);

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function greeting(name: string | null): string {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? `${first},` : "שלום,";
}

/** כותרת ההודעה. הממצא הראשון הוא הדחוף ביותר, ולכן הוא זה שנכנס לשורת הנושא. */
function subjectLine(items: Item[]): string {
  const head = items[0];
  const rest = items.length - 1;
  const base = head ? head.title : "תזכורת משוק נדל״ן";
  return rest > 0 ? `${base} · ועוד ${rest}` : base;
}

function textBody(name: string | null, items: Item[]): string {
  const lines = [
    greeting(name),
    "כמה דברים שכדאי לדעת על המודעות שלך:",
    "",
    ...items.map((it) => `• ${it.title}\n  ${it.body}\n  ${actionUrl(it.action)}`),
    "",
    `לשינוי כמות ההודעות, הערוצים והסוגים: ${manageUrl()}`,
  ];
  // ‏4000 ולא 4096: הגוף נשלח גם כ-preview בוואטסאפ, ועדיף חיתוך שלנו על 400
  // מ-Meta ואפס הודעה.
  return lines.join("\n").slice(0, 4000);
}

function emailHtml(name: string | null, items: Item[]): string {
  const rows = items.map((it) => `
      <div style="border:1px solid #E4DFD6;border-radius:12px;padding:14px 16px;margin:0 0 10px;background:#fff">
        <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:#1B2A41">${esc(it.title)}</p>
        <p style="margin:0 0 12px;font-size:13.5px;line-height:1.65;color:#5A6675">${esc(it.body)}</p>
        <a href="${esc(actionUrl(it.action))}"
           style="display:inline-block;background:#1B2A41;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:13.5px">
          לטיפול בדשבורד
        </a>
      </div>`).join("");

  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<body style="margin:0;background:#F5F3EF;font-family:Arial,Helvetica,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <p style="margin:0 0 4px;font-size:15px;font-weight:bold">${esc(greeting(name))}</p>
    <p style="margin:0 0 16px;font-size:13px;color:#7A8899">כמה דברים שכדאי לדעת על המודעות שלך.</p>
    ${rows}
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center;line-height:1.7">
      קיבלת את ההודעה כי התזכורות מופעלות בחשבון שלך בשוק נדל״ן.<br>
      <a href="${esc(manageUrl())}" style="color:#98A2B0">שינוי כמות ההודעות, הערוצים והסוגים</a>
    </p>
  </div>
</body></html>`;
}

/* ‏sendPlatformEmail אינה זורקת — היא מחזירה ‎{sent,error}‎ — ולכן הכישלון
   מומר כאן לחריגה, כדי שהלולאה למטה תסמן failed בענף אחד ולא בשני. */
async function sendEmail(to: string, name: string | null, items: Item[]): Promise<void> {
  const result = await sendPlatformEmail({
    to: [to],
    subject: `🔔 ${subjectLine(items)}`,
    html: emailHtml(name, items),
    text: textBody(name, items),
  });
  if (!result.sent) throw new Error(result.error || "email failed");
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

// ‏131050 — הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק. זהו ביטול לכל
// דבר, גם אם לא נעשה דרך הדשבורד שלנו, ולכן הוא מכבה את ערוץ הוואטסאפ אצלנו.
// בלעדיו היינו ממשיכים לשלוח לאותו מספר בכל סבב ולצבור דחיות מול Meta.
const WA_OPTED_OUT = 131050;

/** שורה אחת לכל ממצא, קצרה — התבנית מוגבלת באורך פרמטר. */
function waSummary(items: Item[]): string {
  return items.map((it) => `• ${it.title}: ${it.body}`).join("\n").slice(0, 900);
}

async function sendWhatsapp(to: string, name: string | null, items: Item[]): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new WhatsappError("whatsapp not configured", null);

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WA_TOKEN}`,
    "Content-Type": "application/json",
  };

  let payload: Record<string, unknown>;

  if (WA_TEMPLATE) {
    // שני פרמטרים בגוף התבנית, בסדר הזה:
    //   {{1}} השם הפרטי  ·  {{2}} רשימת הממצאים
    //
    // וכפתור URL דינמי אחד שמוביל לניהול התזכורות. הפרמטר הוא **סיומת
    // הכתובת בלבד** — כך Meta מגדירה כפתור דינמי — ולכן הקידומת
    // (‏https://shuknadlan.co.il/) נקבעת בתבנית עצמה ולא כאן.
    //
    // הכפתור הזה אינו נימוס אלא תנאי: תבנית שאין ממנה דרך להנמיך את הקצב
    // נפסלת באישור, וסוכן/ת שמוצף/ת ולא מוצא/ת איך לעצור חוסם/ת את המספר —
    // וזה עולה לנו בכל הנמענים.
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: WA_TEMPLATE,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: (String(name || "").trim().split(/\s+/)[0] || "שלום").slice(0, 60) },
              { type: "text", text: waSummary(items) },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: `crm.html?goto=${MANAGE_ACC}` }],
          },
        ],
      },
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: textBody(name, items) },
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
// הלולאה
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // ‏claim רושם/ת את שורות היומן **לפני** שאנחנו שולחים. נפילה מכאן והלאה
  // משאירה שורה עם status='pending' — כלומר "יצא, לא ידוע אם הגיע" — ולא
  // סוכן/ת שבשל/ה לסבב נוסף בעוד שעה.
  const { data: batch, error } = await sb.rpc("agent_reminders_claim", { p_limit: BATCH });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  if (!batch || batch.length === 0) return json({ sent: 0, failed: 0, empty: true });

  let sent = 0, failed = 0;

  for (const row of batch as any[]) {
    const items = (row.items || []) as Item[];
    const channels: string[] = row.channels || [];

    const wantEmail = channels.includes("email") && !!row.email;
    const wantWhatsapp = channels.includes("whatsapp") && !!row.phone_e164;

    let emStatus = wantEmail ? "pending" : "not_requested";
    let waStatus = wantWhatsapp ? "pending" : "not_requested";
    const errors: string[] = [];

    if (wantEmail) {
      try {
        await sendEmail(row.email, row.display_name, items);
        emStatus = "sent";
      } catch (err) {
        emStatus = "failed";
        errors.push(`email: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (wantWhatsapp) {
      try {
        await sendWhatsapp(row.phone_e164, row.display_name, items);
        waStatus = "sent";
      } catch (err) {
        waStatus = "failed";
        errors.push(`whatsapp: ${err instanceof Error ? err.message : String(err)}`);

        // ביטול שנעשה מול Meta הוא ביטול. מורידים את הערוץ מההעדפות כאן,
        // אחרת נמשיך לשלוח לאותו מספר בכל סבב. שאר ההעדפות — הקצב, התקרה
        // והסוגים — לא נגענו בהן, וגם המייל נשאר אם הוא היה מסומן.
        //
        // ‏update ולא upsert, ובכוונה: ערוץ הוואטסאפ יכול להיות דלוק **רק**
        // כשיש שורת העדפות (ברירת המחדל היא `{email}`), ולכן אין כאן מה
        // ליצור — ו-upsert היה עלול לכתוב שורה חדשה עם ברירות מחדל על סוכן/ת
        // שהשורה שלו/ה נמחקה בינתיים.
        if (err instanceof WhatsappError && err.code === WA_OPTED_OUT) {
          const { error: offErr } = await sb
            .from("agent_reminder_preferences")
            .update({
              channels: channels.filter((c) => c !== "whatsapp"),
              updated_at: new Date().toISOString(),
            })
            .eq("agent_id", row.agent_id);
          if (offErr) console.error("opt-out channel removal failed", offErr.message);
          else console.log("whatsapp channel removed after Meta opt-out", row.agent_id);
        }
      }
    }

    const { error: markErr } = await sb.rpc("agent_reminders_mark", {
      p_log_id: row.log_id,
      p_email_status: emStatus,
      p_whatsapp_status: waStatus,
      p_error: errors.length ? errors.join(" | ").slice(0, 500) : null,
    });
    if (markErr) console.error("mark failed", row.log_id, markErr.message);

    if (emStatus === "sent" || waStatus === "sent") sent++;
    else failed++;
  }

  return json({ sent, failed, processed: batch.length });
});
