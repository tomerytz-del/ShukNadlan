// ============================================================================
// הזמנת סוכן/ת בוואטסאפ
//
// **למה זו תבנית מאושרת ולא הודעת טקסט.** ‏Meta מרשה לעסק לשלוח טקסט חופשי
// רק בתוך 24 שעות מההודעה האחרונה שהנמען/ת שלח/ה. סוכן/ת שמוזמן/ת למשרד
// מעולם לא שלח/ה לנו כלום — זו ההגדרה של הזמנה — ולכן **כל הזמנה היא מחוץ
// לחלון, תמיד**, ושליחת טקסט חופשי אליה תיענה בשגיאה מ-Meta. זה ההבדל
// מ-`notification-push`, שם רוב הנמענים דווקא כן בתוך החלון.
//
// אותה דוקטרינה של המייל (`platform-mail-client`): **כישלון שליחה אינו
// מפיל את ההזמנה.** ההזמנה נוצרת, הכישלון נרשם ב-`agency_invitations.wa_error`,
// והקישור מוצג למנהל/ת עם כפתור וואטסאפ ידני — שעובד תמיד, כי שם *אדם*
// שולח את ההודעה ולא העסק.
//
// בלי תבנית מוגדרת נשלח טקסט חופשי בכל זאת, מאותה סיבה שב-notification-push:
// כשל שנרשם עדיף על הודעה שנעלמת בשקט, וזה גם המצב שמתאים לבדיקה מול מספר
// שכבר בשיחה איתנו.
// ============================================================================

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const WA_TEMPLATE = Deno.env.get("WHATSAPP_INVITE_TEMPLATE") || "";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_INVITE_TEMPLATE_LANG") || "he";

export type WhatsappSendResult = { sent: boolean; error: string | null };

/**
 * ניקוי ערך שנכנס כפרמטר של תבנית.
 *
 * **‏Meta דוחה פרמטר שמכיל שורה חדשה, טאב, או יותר מארבעה רווחים רצופים** —
 * ההודעה כולה נדחית, לא הפרמטר. זו בדיוק התקלה שנתפסה ב-`notification-push`
 * (ראו `templateSummary` שם), ושם היא התגלתה רק בשליחה הראשונה מחוץ לחלון
 * 24 השעות. כאן **כל** שליחה היא מחוץ לחלון, ולכן אין רשת שתתפוס אותה
 * מאוחר יותר.
 *
 * שניים מהערכים כאן הם שם פרטי ושם משרד — שדות טקסט חופשי שאדם הקליד. שם
 * משרד עם שורה חדשה או עם רצף רווחים אינו תרחיש תיאורטי כשהוא מודבק מאיפשהו.
 *
 * ‏`max` הוא ארגומנט ולא קבוע, כי הפרמטר השלישי הוא **הקישור**: ‏60 תווים
 * חותכים אותו באמצע האסימון, וקישור חתוך נראה בדיוק כמו קישור תקין עד
 * שלוחצים עליו.
 */
function param(value: string, max = 60): string {
  return value
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim()
    .slice(0, max);
}

/**
 * מספר ישראלי מקומי (`0521112222`) → הצורה ש-Meta מצפה לה: ספרות בלבד עם
 * קידומת המדינה ובלי `+`.
 */
export function toWhatsappMsisdn(localPhone: string | null | undefined): string | null {
  const d = String(localPhone ?? "").replace(/\D/g, "");
  if (/^05\d{8}$/.test(d)) return "972" + d.slice(1);
  if (/^9725\d{8}$/.test(d)) return d;
  return null;
}

/**
 * ‏`to` הוא מספר מנורמל מ-`toWhatsappMsisdn`, ו-`url` קישור ההזמנה המלא.
 *
 * **שני פרמטרים בגוף, וכפתור URL דינמי אחד.** ההודעה נגמרת בשורה שמזמינה
 * ללחוץ ("להפעלת דף הסוכן וכניסה למערכת בקליק:"), והכפתור יושב מיד אחריה —
 * שם Meta מציבה כפתורים ממילא, אחרי גוף ההודעה כולו.
 *
 * **הפרמטר של הכפתור הוא סיומת הכתובת בלבד** (`crm.html?invite=…`): כך
 * Meta מגדירה כפתור URL דינמי — הקידומת (`https://shuknadlan.co.il/`)
 * קבועה בתבנית עצמה, והפרמטר משורשר אחריה. הסיומת נחתכת מהכתובת המלאה ולא
 * נבנית מחדש, כדי שיהיה מקור אחד לכתובת (`SITE_BASE_URL` אצל הקורא) ולא
 * שניים שעלולים להיפרד.
 *
 * שתי צורות של אי-התאמה מפילות **כל** הודעה ולא אחת: רכיב `button` שנשלח
 * לתבנית בלי כפתור, וכפתור בתבנית שאינו מקבל פרמטר. ראו
 * `docs/agent-invitations.md`.
 */
export async function sendWhatsappInvite(
  to: string,
  a: { name: string; agency: string; url: string },
): Promise<WhatsappSendResult> {
  if (!WA_TOKEN || !WA_PHONE_ID) return { sent: false, error: "whatsapp_not_configured" };

  const greeting = param((a.name || "").trim().split(/\s+/)[0] || "שלום");
  const agency = param(a.agency || "המשרד");
  // הסיומת בלי חיתוך — ראו `param`. היא בת כ-50 תווים, וברירת המחדל של 60
  // הייתה קרובה מדי לגבול: אסימון ארוך יותר היה נחתך באמצע, וקישור חתוך
  // נראה בדיוק כמו קישור תקין עד שלוחצים עליו.
  const suffix = param(a.url.replace(/^https?:\/\/[^/]+\/?/, ""), 512);

  const payload = WA_TEMPLATE
    ? {
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
              { type: "text", text: greeting },
              { type: "text", text: agency },
            ],
          },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: suffix }] },
        ],
      },
    }
    : {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: `${greeting}, הוזמנת להצטרף לצוות ${a.agency || "המשרד"} בשוק נדל״ן — ` +
          `כל הנכסים, הלידים והלקוחות שלך במקום אחד, ודף סוכן/ת אישי מול כל מי שמחפש דירה בעפולה והעמק.\n` +
          `ההצטרפות כאן: ${a.url}`,
      },
    };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const raw = await res.text();
      return { sent: false, error: `whatsapp ${res.status}: ${raw.slice(0, 300)}` };
    }
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: `whatsapp_network: ${(err as Error).message}`.slice(0, 300) };
  }
}
