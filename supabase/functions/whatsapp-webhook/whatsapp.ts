// עטיפה דקה מעל Meta WhatsApp Cloud API (Graph API).
// כל הקריאות היוצאות לוואטסאפ עוברות דרך כאן.

import { encodeNavId, parseNavId, withClick, withClickUrl } from "../_shared/agent-deep-link.ts";
import { noLongDash } from "../_shared/marketing-copy.ts";
import { paceRecipient } from "../_shared/wa-pair-pace.ts";
import {
  ctaPayload,
  logWaUrlGuard,
  payloadsForText,
  planWaText,
  textPayload,
  videoPayload,
  WA_EMPTY_BODY,
  WA_FOLLOWUP_BODY,
  WA_NO_BUTTON,
  type WaPlannedLink,
} from "../_shared/wa-url-guard.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

// מגבלת גוף הודעת טקסט ב-Cloud API. גזירה עדיפה על 400 מ-Meta ואפס תשובה לסוכן/ת.
const MAX_TEXT_LEN = 4096;

/**
 * הטקסט כפי שהוא יוצא לוואטסאפ: בלי מקף ארוך, ועם הדגשה בתחביר של וואטסאפ.
 *
 * ‏**שתי בעיות שנמדדו ביומן, לא הנחות.** ב-30 הימים שעד 26.9.2026 הבוטים
 * שלחו 436 תשובות: 198 מהן עם מקף ארוך - מה שהמודל מייצר כברירת מחדל,
 * ומה שהכלל ב-CLAUDE.md אוסר בכל טקסט שהאתר מציג - ו-45 עם `**מודגש**`.
 * וואטסאפ מדגיש בכוכבית **אחת** (`*מודגש*`); שתיים מוצגות כמו שהן.
 *
 * ‏**למה כאן ולא רק בפרומפט:** אותה סיבה של `noLongDash` בתיאור השיווקי.
 * הנחיה היא בקשה, והמקף חוזר בדיוק כשהניסוח נעשה יפה יותר. כאן עוברת כל
 * הודעה של שני הבוטים, ולכן זה המקום שהופך את הבקשה לערובה.
 *
 * ‏**מה לא נוגעים בו:** כותרות, קישורי Markdown וקוד - לא הופיעו אף פעם
 * ביומן, ומה שלא נמדד לא מתוקן. ‏`**` בלי זוג באותה שורה נשאר כמו שהוא:
 * להחליף אותו היה מדביק כוכבית בודדת באמצע משפט.
 *
 * אידמפוטנטית: הרצה שנייה אינה משנה דבר, ולכן `reply` רושמת ביומן את מה
 * שיצא בפועל, ו-`sendText` מריצה אותה שוב בלי נזק.
 */
export function formatForWhatsapp(text: string): string {
  return noLongDash(text).replace(/\*\*([^*\n]+?)\*\*/g, "*$1*");
}

function authHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

/**
 * מחלצת את מזהה ההודעה שמטא מחזירה (`messages[0].id`, בפורמט `wamid.…`).
 *
 * **זה המפתח היחיד שמחבר בין מה ששלחנו לבין אירועי המסירה שיחזרו.** בלעדיו
 * ‏`status` של ההודעה נשאר לנצח "לא ידוע", ואי אפשר להבדיל בין הודעה שלא
 * הגיעה לבין הודעה שהגיעה ומישהו פספס אותה.
 *
 * ‏null אינו כישלון שליחה: מטא כבר החזירה 200, ורק הגוף לא נפרס כצפוי.
 * ההודעה תישלח, פשוט בלי מעקב — ולכן היא לא זורקת.
 */
async function messageIdFrom(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    const id = data?.messages?.[0]?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * כל הודעה לנמען עוברת במרווח (‏131056). קריאת סטטוס והורדת מדיה לא.
 * השרשרת חיה ב-`wa-pair-pace`, משותפת גם ל-notification-push.
 */
function postMessage(to: string, payload: unknown, failLabel: string): Promise<string | null> {
  return paceRecipient(to, async () => {
    const res = await fetch(`${GRAPH_BASE}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`${failLabel} ${res.status}: ${await res.text()}`);
    }
    return await messageIdFrom(res);
  });
}

/**
 * שולחת הודעת טקסט. זורקת אם Meta החזירה שגיאה, ומחזירה את מזהה ההודעה
 * שלה למעקב מסירה.
 */
async function postGuardedFollowups(to: string, links: WaPlannedLink[], skipUrl?: string): Promise<void> {
  for (const link of links) {
    if (link.kind === "video") {
      try {
        await postMessage(to, videoPayload(to, link.url), "whatsapp video send failed");
      } catch (err) {
        console.error("wa-url-guard video failed", err);
      }
      continue;
    }
    if (skipUrl && link.url === skipUrl) continue;
    try {
      await postMessage(to, ctaPayload(to, WA_FOLLOWUP_BODY, link.label, link.url), "whatsapp cta_url send failed");
    } catch (err) {
      console.error("wa-url-guard follow-up failed", err);
    }
  }
}

export async function sendText(to: string, body: string): Promise<string | null> {
  const clean = formatForWhatsapp(body);
  const plan = planWaText(clean);
  if (plan.stripped) logWaUrlGuard("sendText", plan);
  const planned = payloadsForText(to, clean);
  if (!planned.payloads.length) {
    return postMessage(to, textPayload(to, clean.slice(0, MAX_TEXT_LEN)), "whatsapp send failed");
  }
  let first: string | null = null;
  for (let i = 0; i < planned.payloads.length; i++) {
    const payload = planned.payloads[i];
    try {
      const id = await postMessage(to, payload, "whatsapp send failed");
      if (first == null) first = id;
    } catch (err) {
      if (i === 0 && payload.type === "interactive") {
        console.error("wa-url-guard cta failed, text without url", err);
        const fallback = (planned.visibleText || WA_NO_BUTTON).slice(0, MAX_TEXT_LEN);
        return await postMessage(to, textPayload(to, fallback), "whatsapp send failed");
      }
      if (i === 0) throw err;
      console.error("wa-url-guard follow-up failed", err);
    }
  }
  return first;
}

// כיתוב של הודעת תמונה מוגבל ל-1024 תווים, ולא ל-4096 כמו טקסט. הודעה
// שחורגת נדחית כולה, כלומר גם התמונה אינה נשלחת.
const MAX_CAPTION_LEN = 1024;

/**
 * שולחת תמונה עם כיתוב. ‏WhatsApp מושכת את הקובץ מהכתובת בעצמה, ולכן היא
 * חייבת להיות ציבורית — תמונות הנכסים ב-Storage הן.
 */
export async function sendImage(
  to: string,
  imageUrl: string,
  caption: string,
): Promise<string | null> {
  const plan = planWaText(formatForWhatsapp(caption));
  if (plan.stripped) logWaUrlGuard("sendImage", plan);
  const text = (plan.text || "").length > MAX_CAPTION_LEN
    ? plan.text.slice(0, MAX_CAPTION_LEN - 1) + "…"
    : plan.text;

  const id = await postMessage(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { link: imageUrl, caption: text },
  }, "whatsapp image send failed");
  if (plan.links.length) await postGuardedFollowups(to, plan.links);
  return id;
}

/** סרטון לפי קישור (קובץ אחסון). הכתובת לא נכתבת בגוף. */
export async function sendVideo(to: string, videoUrl: string): Promise<string | null> {
  return postMessage(to, videoPayload(to, videoUrl), "whatsapp video send failed");
}

/**
 * כרטיס: תמונה בכותרת וכפתור קישור אחד. אם Meta דוחה את הכותרת, תמונה
 * ואחריה כפתור נפרד. הגוף בלי כתובת.
 */
export async function sendImageCta(
  to: string,
  imageUrl: string,
  body: string,
  label: string,
  url: string,
): Promise<string | null> {
  const plan = planWaText(formatForWhatsapp(body));
  if (plan.stripped) logWaUrlGuard("sendImageCta", plan);
  const text = (plan.text || WA_EMPTY_BODY).slice(0, MAX_BUTTON_BODY);
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: { type: "image", image: { link: imageUrl } },
      body: { text },
      action: {
        name: "cta_url",
        parameters: {
          display_text: Array.from(formatForWhatsapp(label)).slice(0, MAX_BUTTON_TITLE).join(""),
          url: withClickUrl(url, "cta"),
        },
      },
    },
  };
  try {
    const id = await postMessage(to, payload, "whatsapp image cta send failed");
    if (plan.links.length) await postGuardedFollowups(to, plan.links, url);
    return id;
  } catch (err) {
    console.error("wa-url-guard image cta failed, image then button", err);
    await sendImage(to, imageUrl, plan.text);
    return await sendCtaUrl(to, plan.text || WA_EMPTY_BODY, label, url);
  }
}

/** קובץ שמע לפי קישור (עד 16MB). הקישור חייב להיות נגיש ל-Meta - כתובת חתומה
 *  של Storage עובדת. משמש את ההקלטות של צוות ההטמעה (csm-notify.ts). */
export async function sendAudio(to: string, audioUrl: string): Promise<string | null> {
  return postMessage(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "audio",
    audio: { link: audioUrl },
  }, "whatsapp audio send failed");
}

// מגבלות של הודעת כפתורים ב-Cloud API: עד שלושה כפתורים, כותרת של עד 20
// תווים לכל אחד, וגוף של עד 1024. חריגה באחת מהן דוחה את ההודעה כולה.
const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE = 20;
const MAX_BUTTON_BODY = 1024;

export interface ReplyButton {
  id: string;
  title: string;
}

/**
 * הודעה עם כפתורי תשובה מהירה (interactive · button). ‏הלחיצה חוזרת לוובהוק
 * כהודעה מסוג `interactive`, ו-`index.ts` מעביר את **כותרת** הכפתור לבוט
 * כאילו נכתבה ביד — ולכן הכותרת היא מה שהמודל קורא, וצריכה להיות ברורה
 * גם בלי ההקשר של המסך.
 */
export async function sendButtons(
  to: string,
  body: string,
  buttons: ReplyButton[],
): Promise<string | null> {
  const plan = planWaText(formatForWhatsapp(body));
  if (plan.stripped) logWaUrlGuard("sendButtons", plan);
  const clean = plan.text || WA_EMPTY_BODY;
  const text = clean.length > MAX_BUTTON_BODY
    ? clean.slice(0, MAX_BUTTON_BODY - 1) + "…"
    : clean;

  const id = await postMessage(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: {
        buttons: buttons.slice(0, MAX_BUTTONS).map((b) => ({
          type: "reply",
          reply: {
            id: b.id.slice(0, 256),
            // ‏Array.from ולא slice: אימוג'י הוא שתי יחידות UTF-16, וחיתוך
            // באמצע שלו משאיר תו שבור שמטא דוחה.
            title: Array.from(formatForWhatsapp(b.title)).slice(0, MAX_BUTTON_TITLE).join(""),
          },
        })),
      },
    },
  }, "whatsapp buttons send failed");
  // כפתורי תשובה וכפתור קישור אינם באותה הודעה. הכתובת יוצאת בהמשך.
  if (plan.links.length) await postGuardedFollowups(to, plan.links);
  return id;
}

const MAX_LIST_ROWS = 10;
const MAX_LIST_TITLE = 24;
const MAX_LIST_BUTTON = 20;
const MAX_LIST_DESC = 72;
const MAX_LIST_SECTION = 24;

/**
 * רשימת בחירה אחת (interactive · list). הלחיצה חוזרת כ-list_reply.id.
 * כפתור הפתיחה עד 20, כותרת שורה עד 24, תיאור עד 72, מזהה עד 200, עד 10 שורות.
 */
export async function sendList(
  to: string,
  body: string,
  button: string,
  section: string,
  rows: { id: string; title: string; description?: string }[],
): Promise<string | null> {
  const plan = planWaText(formatForWhatsapp(body));
  if (plan.stripped) logWaUrlGuard("sendList", plan);
  const clean = plan.text || WA_EMPTY_BODY;
  const text = clean.length > MAX_BUTTON_BODY ? clean.slice(0, MAX_BUTTON_BODY - 1) + "…" : clean;
  const sliced = rows.slice(0, MAX_LIST_ROWS).map((row) => {
    const description = row.description
      ? Array.from(formatForWhatsapp(row.description)).slice(0, MAX_LIST_DESC).join("")
      : "";
    const path = parseNavId(row.id);
    const id = path ? (encodeNavId(withClick(path, "list")) || row.id) : row.id;
    return {
      id: id.slice(0, 200),
      title: Array.from(formatForWhatsapp(row.title)).slice(0, MAX_LIST_TITLE).join(""),
      ...(description ? { description } : {}),
    };
  });
  const sent = await postMessage(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text },
      action: {
        button: Array.from(formatForWhatsapp(button)).slice(0, MAX_LIST_BUTTON).join(""),
        sections: [{
          title: Array.from(formatForWhatsapp(section)).slice(0, MAX_LIST_SECTION).join(""),
          rows: sliced,
        }],
      },
    },
  }, "whatsapp list send failed");
  if (plan.links.length) await postGuardedFollowups(to, plan.links);
  return sent;
}

/**
 * הודעה עם כפתור אחד שפותח קישור (interactive · cta_url). ‏**כפתור אחד בלבד**
 * להודעה - זו המגבלה של Meta, ולכן פעולה שנייה שפותחת קישור היא הודעה נפרדת
 * או כפתור תשובה שמחזיר הודעה כזו. כותרת הכפתור עד 20 תווים, כמו ב-
 * `sendButtons`. בתוך חלון 24 השעות בלבד, כמו כל הודעה שאינה תבנית.
 */
export async function sendCtaUrl(
  to: string,
  body: string,
  label: string,
  url: string,
): Promise<string | null> {
  const plan = planWaText(formatForWhatsapp(body));
  if (plan.stripped) logWaUrlGuard("sendCtaUrl", plan);
  const clean = plan.text || WA_EMPTY_BODY;
  const text = clean.length > MAX_BUTTON_BODY ? clean.slice(0, MAX_BUTTON_BODY - 1) + "…" : clean;
  const stamped = withClickUrl(url, "cta");
  const id = await postMessage(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text },
      action: {
        name: "cta_url",
        parameters: {
          display_text: Array.from(formatForWhatsapp(label)).slice(0, MAX_BUTTON_TITLE).join(""),
          url: stamped,
        },
      },
    },
  }, "whatsapp cta_url send failed");
  if (plan.links.length) await postGuardedFollowups(to, plan.links, url);
  return id;
}

/**
 * כרטיס איש קשר (type `contacts`). בוואטסאפ הוא מוצג עם כפתור "שמירה",
 * כלומר מי שמקבל/ת אותו שומר/ת בלחיצה אחת, בלי להקליד מספר.
 */
export async function sendContactCard(
  to: string,
  contact: { name: string; company: string; phoneDigits: string; url?: string },
): Promise<string | null> {
  return postMessage(to, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "contacts",
    contacts: [{
        name: {
          formatted_name: `${contact.name} - ${contact.company}`,
          first_name: contact.name,
        },
        org: { company: contact.company },
        phones: [{
          phone: `+${contact.phoneDigits}`,
          type: "WORK",
          // ‏wa_id הוא מה שמוסיף לכרטיס את הכפתור "שליחת הודעה" ישר לצ'אט.
          wa_id: contact.phoneDigits,
        }],
        ...(contact.url ? { urls: [{ url: contact.url, type: "WORK" }] } : {}),
      }],
  }, "whatsapp contact send failed");
}

const NOTIFY_TEMPLATE = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE") || "";
const NOTIFY_TEMPLATE_LANG = Deno.env.get("WHATSAPP_NOTIFY_TEMPLATE_LANG") || "he";

export function notifyTemplateConfigured(): boolean {
  return !!NOTIFY_TEMPLATE;
}

/**
 * הודעה יזומה מחוץ לחלון 24 השעות — דרך אותה תבנית של `notification-push`
 * (‏{{1}} שם פרטי · {{2}} שורת תוכן · כפתור URL עם סיומת כתובת).
 *
 * ‏**שורה אחת.** ‏Meta דוחה פרמטר של תבנית שמכיל שורה חדשה, טאב או יותר
 * מארבעה רווחים רצופים — ההסבר המלא ב-`templateSummary` שם.
 */
export async function sendNotifyTemplate(
  to: string,
  firstName: string,
  summary: string,
  urlSuffix: string,
): Promise<string | null> {
  if (!NOTIFY_TEMPLATE) throw new Error("WHATSAPP_NOTIFY_TEMPLATE is not configured");
  const planned = planWaText(formatForWhatsapp(summary));
  if (planned.stripped) logWaUrlGuard("sendNotifyTemplate", planned);
  const line = (planned.text || WA_NO_BUTTON)
    .replace(/\s*[\r\n\t]+\s*/g, " ")
    .replace(/ {4,}/g, "   ")
    .slice(0, 900);

  return postMessage(to, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
        name: NOTIFY_TEMPLATE,
        language: { code: NOTIFY_TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: (firstName || "שלום").slice(0, 60) },
              { type: "text", text: line },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: urlSuffix }],
          },
        ],
      },
  }, "whatsapp template send failed");
}

/**
 * מסמנת את ההודעה כנקראה (הסימון הכחול) ומדליקה חיווי "מקליד…".
 * נכשלת בשקט: זה קישוט UX, לא חלק מהזרימה.
 */
export async function markReadAndTyping(messageId: string): Promise<void> {
  try {
    await fetch(`${GRAPH_BASE}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch (err) {
    console.warn("mark read failed", err);
  }
}

/**
 * מורידה מדיה (תמונה/אודיו) בשני שלבים כפי שה-Cloud API מחייב:
 * ‏GET על ה-media id מחזיר URL זמני, וההורדה ממנו דורשת שוב את ה-Bearer token.
 */
export async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: authHeaders(),
  });
  if (!metaRes.ok) {
    throw new Error(
      `media lookup failed ${metaRes.status}: ${await metaRes.text()}`,
    );
  }
  const meta = await metaRes.json();

  const fileRes = await fetch(meta.url, { headers: authHeaders() });
  if (!fileRes.ok) {
    throw new Error(`media download failed ${fileRes.status}`);
  }

  return {
    bytes: new Uint8Array(await fileRes.arrayBuffer()),
    mimeType: (meta.mime_type || "application/octet-stream").split(";")[0],
  };
}

/**
 * אימות חתימת הוובהוק (X-Hub-Signature-256) מול ה-App Secret.
 * בלי זה כל אחד שיודע את כתובת הפונקציה יכול להתחזות ל-Meta ולהפעיל
 * פעולות בשם סוכן/ת — הפונקציה חשופה בלי JWT, אז זו שכבת האימות היחידה.
 */
export async function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) return false;

  // השוואה בזמן קבוע — השוואת מחרוזות רגילה מדליפה כמה תווים התאימו
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}
