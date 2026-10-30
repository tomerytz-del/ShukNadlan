// כלל תומר, 30.10.2026: הודעה לסוכן/ת או ללקוח/ה אינה נושאת כתובת גלויה
// בגוף. קישור יוצא רק ככפתור. השכבה הזו רצה על כל גוף טקסט לפני שהוא
// נשלח ל-Meta: מוציאה http(s) ו-wa.me, והשולח הופך אותם לכפתור.
// כתובת .mp4 של אחסון יוצאת כמדיה, לא כקישור.
//
// מקסימום כפתור קישור אחד להודעה (מגבלת Meta). עוד כתובות הן הודעות
// המשך. אם הכפתור נדחה, השולח שולח את הטקסט בלי הכתובת.
// גוף ארוך מ-1024 לא נחתך לתוך כפתור: הטקסט יוצא במלואו, והכפתור אחריו.

import { withClickUrl } from "./agent-deep-link.ts";

export const WA_EMPTY_BODY = "הפרטים בכפתור.";
export const WA_FOLLOWUP_BODY = "עוד קישור:";
export const WA_NO_BUTTON = "פרטים ב-CRM";
export const MAX_WA_CTA = 5;
export const WA_TEXT_MAX = 4096;
export const WA_CTA_BODY_MAX = 1024;
/** לכל היותר שתי הודעות לתשובה: הגוף, ואז כפתור אחד. */
export const MAX_WA_MESSAGES = 2;
const WA_SITE = "https://shuknadlan.co.il/";

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
 * לכל היותר שתי הודעות. גוף ארוך מ-1024 יוצא כטקסט, ואחריו כפתור
 * שהגוף שלו "הפרטים בכפתור.". המשך של יעד אחד: הגוף הוא שם היעד.
 * כמה יעדים שנשארו: כפתור "לאתר" אחד.
 */
export function payloadsForText(to: string, body: string): {
  payloads: Record<string, unknown>[];
  visibleText: string;
  stripped: boolean;
} {
  const plan = planWaText(body);
  const ctas = plan.links.filter((link) => link.kind === "cta");
  const videos = plan.links.filter((link) => link.kind === "video");
  const visibleText = (plan.text || (ctas.length || videos.length ? WA_EMPTY_BODY : "")).slice(0, WA_TEXT_MAX);
  const payloads: Record<string, unknown>[] = [];
  const stamped = (url: string) => withClickUrl(url, "cta");
  const oneFollowUp = (links: WaPlannedLink[]) => {
    if (links.length === 1) {
      payloads.push(ctaPayload(to, links[0].label, links[0].label, stamped(links[0].url)));
    } else if (links.length > 1) {
      payloads.push(ctaPayload(to, "לאתר", "לאתר", WA_SITE));
    }
  };
  if (videos.length && ctas.length) {
    payloads.push(videoPayload(to, videos[0].url));
    const link = ctas.length === 1 ? ctas[0] : null;
    const buttonBody = visibleText.length > 0 && visibleText.length <= WA_CTA_BODY_MAX && visibleText !== WA_EMPTY_BODY
      ? visibleText
      : (link ? link.label : "לאתר");
    if (link) payloads.push(ctaPayload(to, buttonBody, link.label, stamped(link.url)));
    else payloads.push(ctaPayload(to, buttonBody, "לאתר", WA_SITE));
  } else if (videos.length) {
    if (visibleText && visibleText !== WA_EMPTY_BODY) payloads.push(textPayload(to, visibleText));
    payloads.push(videoPayload(to, videos[0].url));
  } else if (!ctas.length) {
    if (visibleText) payloads.push(textPayload(to, visibleText));
  } else if (visibleText.length > WA_CTA_BODY_MAX) {
    payloads.push(textPayload(to, visibleText));
    if (ctas.length === 1) {
      payloads.push(ctaPayload(to, WA_EMPTY_BODY, ctas[0].label, stamped(ctas[0].url)));
    } else {
      payloads.push(ctaPayload(to, WA_EMPTY_BODY, "לאתר", WA_SITE));
    }
  } else {
    payloads.push(ctaPayload(to, visibleText || WA_EMPTY_BODY, ctas[0].label, stamped(ctas[0].url)));
    oneFollowUp(ctas.slice(1));
  }
  return { payloads: payloads.slice(0, MAX_WA_MESSAGES), visibleText, stripped: plan.stripped };
}
