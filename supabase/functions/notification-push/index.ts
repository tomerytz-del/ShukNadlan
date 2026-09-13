import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { mapPool } from "../_shared/pool.ts";

// ============================================================================
// דחיפת התראות הפעמון לוואטסאפ.
//
// ‏נקראת מ-pg_cron כל חמש דקות, ורק כשיש מה לשלוח
// (‏`notification_push_ready()` במיגרציה 20261029090000).
//
// ## מה זה לא
//
// זו **אינה** `agent-reminders`. שם המקור הוא מצב שמחושב בכל קריאה (נכסים
// בלי תמונה, שבוע בלי מודעה) והקצב הוא שבועי; כאן המקור הוא טבלת
// ‏`notifications` — אירועים שקרו ברגע מסוים, שהערך שלהם נשחק בשעות. שתי
// הפונקציות חולקות את התבנית (‏claim→שליחה→mark) ואת שעות השקט של הסוכן/ת,
// ולא את התוכן ולא את הקצב.
//
// ## מה הפונקציה הזו לא מחליטה
//
// מי מקבל/ת, אילו סוגים, מתי מותר וכמה — הכול במסד:
//
//   ‏· `notification_push_due_agents` — ערוץ דלוק עם מספר, שעות שקט, תקרה, מרווח
//   ‏· `notification_push_claim`      — רושמת את שורת היומן ומחזירה מה לשלוח
//
// כאן רק מרכיבים הודעה משורה שהגיעה מוכנה, שולחים, ומדווחים.
//
// ## טקסט חופשי או תבנית — וההבדל שאינו קוסמטי
//
// ‏Meta מרשה לעסק לשלוח טקסט חופשי רק בתוך 24 שעות מההודעה האחרונה שהנמען/ת
// שלח/ה. סוכן/ת שכתב/ה לבוט בשעה האחרונה נמצא/ת בתוך החלון, ולכן מקבל/ת
// הודעה מלאה עם קישורים אמיתיים — וגם בחינם. מחוץ לחלון נדרשת תבנית מאושרת
// (`WHATSAPP_NOTIFY_TEMPLATE`), שמוגבלת בפרמטרים ועולה כסף.
//
// ההחלטה הזו נלקחת **במסד** (‏`channel_mode` שחוזר מה-claim, מחושב מ-
// ‏`whatsapp_conversations.last_message_at`) ולא כאן, כדי שהיא תישמר ביומן:
// כשל של "מחוץ לחלון" נראה אחרת בכל אחד מהמצבים, ובלי הרישום אין דרך לדעת
// איזה משלוח היה איזה.
//
// בלי תבנית מוגדרת נשלח טקסט חופשי גם מחוץ לחלון. זה נכשל אצל Meta — בכוונה:
// עדיף כשל שנרשם ב-`last_error` על הודעה שנעלמת בשקט, וזה גם המצב שמתאים
// לבדיקה מול מספר ששלח לנו הודעה עכשיו.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE") || "";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE_LANG") || "he";

const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il")
  .replace(/\/+$/, "");

// הקטגוריה שבה מכבים את הערוץ. מופיעה בכל הודעה: ערוץ יוצא שאין ממנו דרך
// לצאת הוא ערוץ שמסתיים בחסימה של המספר — וחסימה אחת מייקרת אותנו אצל כל
// הנמענים העתידיים דרך דירוג האיכות של Meta.
const MANAGE_ACC = "accNotifPrefs";

const BATCH = 40;

// כמה נמענים במקביל. לולאה בטור על ארבעים הודעות הייתה מגיעה לעשרות שניות,
// ו-pg_net מנתק — זה בדיוק מה שקרה ב-agent-reminders (ראו
// ‏20261030090000_cron_http_timeout.sql). מצד שני ארבעים קריאות בבת אחת
// ל-Graph API הן הדרך לקבל הגבלת קצב מ-Meta. ראו `_shared/pool.ts`.
const SEND_CONCURRENCY = 4;

// ‏131050 — הנמען/ת ביקש/ה מ-Meta להפסיק לקבל הודעות מהעסק.
const WA_OPTED_OUT = 131050;

// הקטגוריה בדשבורד שבה מטפלים בכל סוג התראה. אותו מיפוי שב-NOTIF_TYPES
// ב-crm.html — סוג שאינו כאן מקבל את הפעמון עצמו, שממילא מוביל הלאה.
const ACC_BY_TYPE: Record<string, string> = {
  new_lead: "accLeads",
  client_match: "accAlerts",
  agreement_signed: "accAgreements",
  review_new: "accReviews",
  review_request: "accLeads",
  deal_closed: "accTeam",
  marketing_copy: "accProperties",
  system: "accSharedWithMe",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Item = { type: string; title: string; body: string | null };

class WhatsappError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

function firstName(name: string | null): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function gotoUrl(acc: string): string {
  return `${SITE_BASE}/crm.html?goto=${encodeURIComponent(acc)}`;
}

/**
 * גוף ההודעה בטקסט חופשי.
 *
 * שורה לכל התראה, וקישור אחד לכל **קטגוריה** ולא לכל התראה: שלוש התאמות
 * מובילות לאותו מסך, ושלושה קישורים זהים ברצף הופכים הודעה קצרה לקיר.
 */
function textBody(name: string | null, items: Item[]): string {
  const first = firstName(name);
  const accs = [...new Set(items.map((it) => ACC_BY_TYPE[it.type] || MANAGE_ACC))];

  const lines = [
    first ? `${first}, מה שחדש אצלך:` : "מה שחדש אצלך:",
    "",
    ...items.map((it) => `🔔 ${it.title}${it.body ? `\n   ${it.body}` : ""}`),
    "",
    ...accs.map((acc) => gotoUrl(acc)),
    "",
    `להפסקת ההתראות בוואטסאפ: ${gotoUrl(MANAGE_ACC)}`,
  ];
  // ‏4000 ולא 4096: חיתוך שלנו עדיף על 400 מ-Meta ואפס הודעה.
  return lines.join("\n").slice(0, 4000);
}

/**
 * רשימת ההתראות כפרמטר לתבנית — **שורה אחת, בלי תווי שורה חדשה.**
 *
 * ‏Meta דוחה פרמטר של תבנית שמכיל `\n`, טאב או יותר מארבעה רווחים רצופים.
 * הגרסה הראשונה כאן חיברה ב-`\n` כדי שהרשימה תיראה כמו רשימה, וזה היה נדחה
 * בשליחה הראשונה מחוץ לחלון 24 השעות — כלומר בדיוק במצב שהתבנית קיימת בשבילו.
 *
 * ה-`•` שבראש כל פריט הוא גם המפריד, ולכן החיבור הוא ברווח בודד ולא בתו
 * הפרדה נוסף: גופי ההתראות מכילים פסיקים ונקודות משל עצמם, ו-`•` הוא הגבול
 * היחיד שנשאר חד. התבנית עצמה עדיין שמה את `{{2}}` בשורה נפרדת — המגבלה היא
 * על הפרמטר, לא על הנוסח.
 */
function templateSummary(items: Item[]): string {
  return items
    .map((it) => `• ${it.title}${it.body ? `: ${it.body}` : ""}`)
    .join(" ")
    // ‏replace לפני החיתוך: גוף התראה נכתב במסד ועשוי להכיל שורה חדשה בעצמו
    // (למשל ציטוט מביקורת), ולכן לא די בהחלפת המפריד.
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .slice(0, 900);
}

async function sendWhatsapp(
  to: string,
  name: string | null,
  items: Item[],
  mode: string,
): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new WhatsappError("whatsapp not configured", null);

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WA_TOKEN}`,
    "Content-Type": "application/json",
  };

  let payload: Record<string, unknown>;

  if (mode === "template" && WA_TEMPLATE) {
    // שני פרמטרים בגוף התבנית: ‏{{1}} השם הפרטי · {{2}} רשימת ההתראות.
    // וכפתור URL דינמי אחד שמוביל לניהול ההתראות; הפרמטר הוא **סיומת
    // הכתובת בלבד**, כך Meta מגדירה כפתור דינמי, ולכן הקידומת נקבעת בתבנית.
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
              { type: "text", text: (firstName(name) || "שלום").slice(0, 60) },
              { type: "text", text: templateSummary(items) },
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
      // ‏preview_url false: ההודעה נושאת קישור לדשבורד, ותצוגה מקדימה שלו
      // תופסת חצי מסך בשביל כלום.
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
Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // ‏claim רושמת את שורות היומן **לפני** השליחה. נפילה מכאן והלאה משאירה
  // שורה עם status='pending' — "יצא, לא ידוע אם הגיע" — ולא אותן התראות
  // בסבב הבא.
  const { data: batch, error } = await sb.rpc("notification_push_claim", { p_limit: BATCH });
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  if (!batch || batch.length === 0) return json({ sent: 0, failed: 0, empty: true });

  let sent = 0, failed = 0;

  await mapPool(batch as Record<string, any>[], SEND_CONCURRENCY, async (row) => {
    const items = (row.items || []) as Item[];
    let status = "failed";
    let lastError: string | null = null;

    try {
      await sendWhatsapp(row.phone_e164, row.display_name, items, row.channel_mode);
      status = "sent";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      // ביטול מול Meta הוא ביטול, גם אם לא נעשה דרך הדשבורד שלנו. מכבים את
      // הערוץ מיד, אחרת נמשיך לשלוח לאותו מספר בכל סבב ולצבור דחיות. הפעמון
      // בדשבורד ו-`muted_types` אינם נוגעים בזה — זה כיבוי של ערוץ, לא של
      // ההתראות עצמן.
      if (err instanceof WhatsappError && err.code === WA_OPTED_OUT) {
        const { error: offErr } = await sb.rpc("notification_push_opt_out", {
          p_agent_id: row.agent_id,
        });
        if (offErr) console.error("opt-out failed", offErr.message);
        else console.log("whatsapp alerts disabled after Meta opt-out", row.agent_id);
      }
    }

    const { error: markErr } = await sb.rpc("notification_push_mark", {
      p_log_id: row.log_id,
      p_status: status,
      p_error: lastError ? lastError.slice(0, 500) : null,
    });
    if (markErr) console.error("mark failed", row.log_id, markErr.message);

    if (status === "sent") sent++;
    else failed++;
  });

  return json({ sent, failed, processed: batch.length });
});
