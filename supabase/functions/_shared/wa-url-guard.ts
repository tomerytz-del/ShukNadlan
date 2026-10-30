// כלל תומר, 30.10.2026: הודעה לסוכן/ת או ללקוח/ה אינה נושאת כתובת גלויה
// בגוף. קישור יוצא רק ככפתור. השכבה הזו רצה על כל גוף טקסט לפני שהוא
// נשלח ל-Meta: מוציאה http(s) ו-wa.me, והשולח הופך אותם לכפתור.
// כתובת .mp4 של אחסון יוצאת כמדיה, לא כקישור.
//
// עד שלוש הודעות וואטסאפ לתשובה, כולל טקסט, וידאו, כרטיס תמונה וכל כפתור.
// הסדר: קודם גוף הטקסט, אחר כך וידאו או תמונה, ואז כפתורי קישור לפי הסדר.
// קישור שאין לו מקום נרשם ביומן ולא נשלח. אין כפתור גנרי לדף הבית.
// גוף ארוך מ-1024 יוצא כטקסט, לא נחתך לתוך כפתור. נפילה לטקסט פעם אחת,
// ורק אם הגוף לא יצא.

import { withClickUrl } from "./agent-deep-link.ts";

export const WA_EMPTY_BODY = "הפרטים בכפתור.";
export const WA_FOLLOWUP_BODY = "עוד קישור:";
export const WA_NO_BUTTON = "פרטים ב-CRM";
export const MAX_WA_CTA = 5;
export const WA_TEXT_MAX = 4096;
export const WA_CTA_BODY_MAX = 1024;
/** עד שלוש הודעות לתשובה בסך הכל: טקסט, מדיה וכל כפתור. */
export const MAX_WA_MESSAGES = 3;

/**
 * אחרי דחייה: כפתור CRM בלי הגוף רק אם הטקסט כבר יצא.
 * אחרת הגוף עולה על כפתור ה-CRM. בלי יעד CRM - הערה, או הגוף אם הוא לא יצא.
 */
export type OutboxRetryPlan = "crm-short" | "crm-body" | "note" | "body";

export function outboxRetry(textWentOut: boolean, hasCrmRow: boolean): OutboxRetryPlan {
  if (hasCrmRow) return textWentOut ? "crm-short" : "crm-body";
  if (textWentOut) return "note";
  return "body";
}

const BUTTON_TITLE_MAX = 20;

export type WaLinkKind = "cta" | "video";

export type WaPlannedLink = {
  url: string;
  label: string;
  kind: WaLinkKind;
};

export type WaTextPlan = {
  text: string;
  links: WaPlannedLink[];
  stripped: boolean;
};

const URL_RE = /(?:https?:\/\/|wa\.me\/)[^\s<>"'`)\]}]+/gi;

function clipLabel(label: string): string {
  return Array.from(label).slice(0, BUTTON_TITLE_MAX).join("");
}

function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/g, "");
}

export function normalizeVisibleUrl(raw: string): string {
  const trimmed = trimUrl(raw);
  if (/^wa\.me\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function isStorageVideoUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".mp4");
  } catch {
    return /\.mp4(?:$|\?)/i.test(url);
  }
}

/** כותרת כפתור לפי היעד. עד 20 יחידות UTF-16, בלי מספר טלפון. */
export function buttonLabelForUrl(url: string): string {
  let path = "";
  let host = "";
  try {
    const u = new URL(url);
    path = u.pathname.toLowerCase();
    host = u.hostname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  const full = `${host}${path}${url}`.toLowerCase();
  if (full.includes("wa.me/") || host === "wa.me") return "שליחת הודעה";
  if (path === "/" || path === "") return "לאתר";
  if (path.includes("/pricing") || path.includes("/checkout")) return "למסלולים";
  if (path.includes("/property")) return "לדף הנכס";
  // signup ו-invite מכילים את המחרוזת sign. הם נבדקים לפני /sign וגם לפני /agency.
  if (path.includes("signup") || path.includes("invite") || /\/join(?:\/|$)/.test(path)) return "להצטרפות";
  if (path === "/sign" || path.startsWith("/sign/")) return "לחתימה";
  if (path.includes("/agreement")) return "להסכם";
  if (path.includes("/showcase") || path.startsWith("/w/")) return "לעמוד האישי";
  if (path.includes("/plan")) return "מידע תכנוני";
  if (path.includes("/professional")) return "לכרטיס";
  if (path.includes("/agent")) return "לדף היועץ";
  if (path.includes("/agency")) return "לדף המשרד";
  if (path.includes("/meeting")) return "לפגישה";
  if (path.includes("/open-house")) return "ליריד";
  if (path.includes("/crm")) return "פתיחה ב-CRM";
  if (full.includes("unsubscribe")) return "הפסקת עדכונים";
  if (full.includes("action=click") || path.includes("/project")) return "לצפייה בנכס";
  if (path.includes("/calc") || url.includes("#calc")) return "למחשבון";
  return "לפתיחה";
}

export function planWaText(raw: string): WaTextPlan {
  const found: { index: number; raw: string; url: string }[] = [];
  const textIn = String(raw || "");
  for (const match of textIn.matchAll(URL_RE)) {
    const rawUrl = match[0];
    const url = normalizeVisibleUrl(rawUrl);
    if (!url) continue;
    found.push({ index: match.index ?? 0, raw: rawUrl, url });
  }
  if (!found.length) {
    return { text: textIn.trim(), links: [], stripped: false };
  }

  const seen = new Set<string>();
  const links: WaPlannedLink[] = [];
  for (const hit of found) {
    const key = hit.url.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (isStorageVideoUrl(hit.url)) {
      links.push({ url: hit.url, label: "", kind: "video" });
    } else {
      links.push({ url: hit.url, label: clipLabel(buttonLabelForUrl(hit.url)), kind: "cta" });
    }
  }

  let text = textIn;
  for (const hit of found) {
    text = text.replace(hit.raw, "");
  }
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+([.,:;!?])/g, "$1")
    .trim();
  if (!text && links.length) text = WA_EMPTY_BODY;
  return { text, links, stripped: true };
}

export function logWaUrlGuard(where: string, plan: WaTextPlan): void {
  if (!plan.stripped) return;
  const labels = plan.links.map((link) => link.kind === "video" ? "video" : link.label);
  console.warn("wa-url-guard", where, JSON.stringify({ n: plan.links.length, labels }));
}

/**
 * נפילה לטקסט רק אם החלק שנשא את הגוף נכשל ועוד לא יצא טקסט.
 * כפתור המשך שנדחה אחרי שהגוף כבר יצא לא שולח אותו שוב.
 * אם לא יצא כלום, נזרקת שגיאה כדי שהקורא ירשום כישלון.
 */
export function shouldPlainFallback(plainSent: boolean, delivered: number, type: string): boolean {
  return !plainSent && delivered === 0 && (type === "interactive" || type === "text");
}

export type WaDelivered = { id: string | null; type: string };

/** הגוף לא יצא. `delivered` הוא מה שכן נמסר, כולל כפתור שאחריו. */
export class WaBodyNotSentError extends Error {
  delivered: WaDelivered[];
  constructor(delivered: WaDelivered[]) {
    super("wa-url-guard body not sent");
    this.name = "WaBodyNotSentError";
    this.delivered = delivered;
  }
}

export async function deliverWaPayloads(
  payloads: Record<string, unknown>[],
  post: (payload: Record<string, unknown>) => Promise<string | null>,
  fallbackPayload: () => Record<string, unknown>,
  visibleText = "",
): Promise<string | null> {
  let first: string | null = null;
  let delivered = 0;
  let plainSent = false;
  let bodyOut = !visibleText || visibleText === WA_EMPTY_BODY;
  let fallbackTried = false;
  const sentParts: WaDelivered[] = [];
  const carries = (payload: Record<string, unknown>) => {
    if (!visibleText || visibleText === WA_EMPTY_BODY) return false;
    const probe = visibleText.slice(0, 80);
    if (payload.type === "text") return String((payload.text as { body?: string } | undefined)?.body || "").includes(probe);
    const interactive = payload.interactive as { body?: { text?: string } } | undefined;
    return String(interactive?.body?.text || "").includes(probe);
  };
  for (const payload of payloads) {
    const type = String(payload.type || "");
    try {
      const id = await post(payload);
      if (first == null) first = id;
      delivered++;
      sentParts.push({ id, type });
      if (type === "text") plainSent = true;
      if (carries(payload)) bodyOut = true;
    } catch (err) {
      if (!fallbackTried && shouldPlainFallback(plainSent, delivered, type)) {
        fallbackTried = true;
        console.error("wa-url-guard body failed, text without url", err);
        try {
          const id = await post(fallbackPayload());
          if (first == null) first = id;
          delivered++;
          sentParts.push({ id, type: "text" });
          plainSent = true;
          bodyOut = true;
          continue;
        } catch (err2) {
          console.error("wa-url-guard text fallback failed", err2);
        }
      } else if (type === "video") {
        console.error("wa-url-guard video failed", err);
      } else {
        console.error("wa-url-guard follow-up failed", err);
      }
    }
  }
  if (!bodyOut || delivered === 0) {
    if (sentParts.length) console.error("wa-url-guard body not sent; delivered", JSON.stringify(sentParts));
    throw new WaBodyNotSentError(sentParts);
  }
  return first;
}

export function textPayload(to: string, body: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  };
}

export function videoPayload(to: string, url: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "video",
    video: { link: url },
  };
}

export function ctaPayload(to: string, body: string, label: string, url: string): Record<string, unknown> {
  // בלי חיתוך שקט. גוף ארוך מ-1024 נדחה אצל Meta, והקורא מפצל לטקסט ואז כפתור.
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: body },
      action: {
        name: "cta_url",
        parameters: {
          display_text: clipLabel(label || "לפתיחה"),
          url,
        },
      },
    },
  };
}

/**
 * עד שלוש הודעות בסך הכל. עם וידאו: קודם הטקסט, אחר כך הווידאו, ואז כפתור
 * כל עוד נשאר מקום. בלי וידאו: הגוף עם הכפתור הראשון, ואז כפתור לכל יעד נוסף.
 */
export function payloadsForText(to: string, body: string): {
  payloads: Record<string, unknown>[];
  visibleText: string;
  stripped: boolean;
  dropped: number;
} {
  const plan = planWaText(body);
  const ctas = plan.links.filter((link) => link.kind === "cta");
  const videos = plan.links.filter((link) => link.kind === "video");
  const visibleText = (plan.text || (ctas.length || videos.length ? WA_EMPTY_BODY : "")).slice(0, WA_TEXT_MAX);
  const payloads: Record<string, unknown>[] = [];
  const stamped = (url: string) => withClickUrl(url, "cta");
  const prose = visibleText && visibleText !== WA_EMPTY_BODY ? visibleText : "";
  const droppedLinks: WaPlannedLink[] = [];
  const room = () => payloads.length < MAX_WA_MESSAGES;
  const pushCtas = (links: WaPlannedLink[], firstBody?: string) => {
    let first = true;
    for (const link of links) {
      if (!room()) {
        droppedLinks.push(link);
        continue;
      }
      const buttonBody = first && firstBody ? firstBody : link.label;
      first = false;
      payloads.push(ctaPayload(to, buttonBody, link.label, stamped(link.url)));
    }
  };
  if (videos.length) {
    if (prose && room()) payloads.push(textPayload(to, prose));
    if (room()) payloads.push(videoPayload(to, videos[0].url));
    else droppedLinks.push(videos[0]);
    droppedLinks.push(...videos.slice(1));
    pushCtas(ctas);
  } else if (!ctas.length) {
    if (visibleText && room()) payloads.push(textPayload(to, visibleText));
  } else if (prose.length > WA_CTA_BODY_MAX) {
    if (room()) payloads.push(textPayload(to, prose));
    pushCtas(ctas);
  } else {
    pushCtas(ctas, prose || WA_EMPTY_BODY);
  }
  if (droppedLinks.length) logDroppedWaLinks(to, droppedLinks);
  return { payloads, visibleText, stripped: plan.stripped, dropped: droppedLinks.length };
}

export type WaDropRow = { wa_phone: string; body: string; error: string };

type DropLogger = (row: WaDropRow) => Promise<void> | void;

let dropLogger: DropLogger | null = null;
let dropChain: Promise<void> = Promise.resolve();

/** רישום קישור שנזרק ליומן (`whatsapp_messages`). בלי חיבור נשארת האזהרה. */
export function setWaDropLogger(fn: DropLogger | null): void {
  dropLogger = fn;
}

export function flushWaDropLog(): Promise<void> {
  return dropChain;
}

export function logDroppedWaLinks(to: string, links: WaPlannedLink[]): void {
  if (!links.length) return;
  console.warn("wa-url-guard dropped links", links.length);
  const logger = dropLogger;
  if (!logger) return;
  const row: WaDropRow = {
    wa_phone: to,
    body: links.map((link) => link.kind === "video" ? "video" : (link.label || "קישור")).join(" | ").slice(0, 500),
    error: `dropped links ${links.length}`,
  };
  dropChain = dropChain.then(() => Promise.resolve(logger(row))).then(() => undefined, (err) => {
    console.error("wa-url-guard drop log failed", err);
  });
}

/**
 * כמה הודעות כבר יצאו לפני קישורי ההמשך: טקסט אם הגוף ארוך מ-1024, ועוד
 * ההודעה האינטראקטיבית עצמה (כפתורי תשובה, רשימה, או כרטיס תמונה עם הכפתור שלו).
 */
export function countBeforeFollowups(text: string): number {
  const clean = text && text !== WA_EMPTY_BODY ? text : "";
  return (clean.length > WA_CTA_BODY_MAX ? 1 : 0) + 1;
}

export type BurstFollowups = {
  video: WaPlannedLink | null;
  ctas: WaPlannedLink[];
  dropped: WaPlannedLink[];
};

/** וידאו קודם לכפתורי קישור. מה שאין לו מקום במכסה נזרק. */
export function selectBurstFollowups(
  alreadySent: number,
  links: WaPlannedLink[],
  skipUrl?: string,
): BurstFollowups {
  let room = Math.max(0, MAX_WA_MESSAGES - alreadySent);
  const videos = links.filter((link) => link.kind === "video");
  const ctas = links.filter((link) => link.kind === "cta" && link.url !== skipUrl);
  const dropped: WaPlannedLink[] = [];
  let video: WaPlannedLink | null = null;
  if (videos.length) {
    if (room > 0) {
      video = videos[0];
      room--;
    } else dropped.push(videos[0]);
    dropped.push(...videos.slice(1));
  }
  const take = ctas.slice(0, room);
  dropped.push(...ctas.slice(take.length));
  return { video, ctas: take, dropped };
}

/** סדר השליחה של ההמשך: וידאו, ואז כפתורי קישור. */
export function followupKinds(plan: BurstFollowups): string[] {
  const kinds: string[] = [];
  if (plan.video) kinds.push("video");
  for (let i = 0; i < plan.ctas.length; i++) kinds.push("interactive");
  return kinds;
}

export type OutboxPart = { id: string | null; kind: "text" | "interactive" | "video" | "image"; body: string };

export type OutboxLogRow = {
  wa_message_id?: string | null;
  msg_type: string;
  body: string;
  status?: string | null;
  error?: string | null;
};

export type OutboxSendItem =
  | { kind: "cta"; body: string; label: string; url: string }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | {
    kind: "list";
    body: string;
    button: string;
    section: string;
    rows: { id: string; title: string; description?: string }[];
  };

/**
 * שליחת פריט אחד מהתור, כולל הניסיון השני אחרי דחייה.
 * כפתור CRM בלי הגוף רק אחרי שהטקסט יצא. אם גם הוא נדחה, נרשמת השגיאה
 * ויוצא טקסט עם הגוף.
 */
export async function sendOutboxItem(
  item: OutboxSendItem,
  io: {
    sendCtaUrl: (body: string, label: string, url: string, parts: OutboxPart[]) => Promise<string | null>;
    sendList: (
      body: string,
      button: string,
      section: string,
      rows: { id: string; title: string; description?: string }[],
      parts: OutboxPart[],
    ) => Promise<string | null>;
    sendButtons: (body: string, buttons: { id: string; title: string }[], parts: OutboxPart[]) => Promise<string | null>;
    reply: (text: string) => Promise<void>;
    log: (row: OutboxLogRow) => Promise<void>;
    crmUrl: (rowId: string) => string | null;
  },
): Promise<void> {
  const logBody = item.kind === "cta"
    ? `${item.body}\n[${item.label}] ${item.url}`
    : item.kind === "list"
    ? `${item.body}\n[${item.rows.map((row) => row.title).join(" | ")}]`
    : `${item.body}\n[${item.buttons.map((b) => b.title).join(" | ")}]`;
  const parts: OutboxPart[] = [];
  let errorLogged = false;
  const textOut = () => parts.some((part) => part.kind === "text");
  const crmRow = item.kind === "list"
    ? (item.rows.filter((row) => io.crmUrl(row.id)).find((row) => row.title === "הכול")
      || item.rows.find((row) => io.crmUrl(row.id)))
    : undefined;
  const logError = async (error: string) => {
    if (errorLogged) return;
    errorLogged = true;
    await io.log({ msg_type: "interactive", body: logBody, error });
  };
  const shortRetry = async () => {
    const plan = outboxRetry(textOut(), !!crmRow);
    if ((plan === "crm-short" || plan === "crm-body") && crmRow) {
      const url = io.crmUrl(crmRow.id);
      if (url) {
        const buttonBody = plan === "crm-body" ? item.body : crmRow.title;
        try {
          const retryId = await io.sendCtaUrl(buttonBody, "פתיחה ב-CRM", url, parts);
          await io.log({
            wa_message_id: retryId,
            msg_type: "interactive",
            body: buttonBody,
            status: retryId ? "sent" : null,
          });
        } catch (retryErr) {
          console.error("outbox crm retry failed", retryErr);
          await io.log({
            msg_type: "interactive",
            body: buttonBody,
            error: String((retryErr as Error)?.message || retryErr),
          });
          const note = WA_NO_BUTTON;
          await io.reply(textOut() ? note : `${item.body}\n${note}`);
        }
        return;
      }
    }
    const note = item.kind === "cta" ? `${item.label}.\n${WA_NO_BUTTON}` : WA_NO_BUTTON;
    await io.reply(plan === "body" ? `${item.body}\n${note}` : note);
  };
  try {
    const waMessageId = item.kind === "cta"
      ? await io.sendCtaUrl(item.body, item.label, item.url, parts)
      : item.kind === "list"
      ? await io.sendList(item.body, item.button, item.section, item.rows, parts)
      : await io.sendButtons(item.body, item.buttons, parts);
    if (parts.length) {
      for (const part of parts) {
        await io.log({
          wa_message_id: part.id,
          msg_type: part.kind,
          body: part.body || logBody,
          status: part.id ? "sent" : null,
        });
      }
      if (!parts.some((part) => part.kind === "interactive")) {
        await logError("button rejected after text");
        await shortRetry();
      }
    } else {
      await io.log({
        wa_message_id: waMessageId,
        msg_type: "interactive",
        body: logBody,
        status: waMessageId ? "sent" : null,
      });
    }
  } catch (err) {
    console.error("outbox send failed", err);
    await logError(String((err as Error)?.message || err));
    await shortRetry();
  }
}
