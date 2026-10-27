import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import {
  downloadMedia,
  formatForWhatsapp,
  markReadAndTyping,
  sendButtons,
  sendContactCard,
  sendCtaUrl,
  sendText,
  verifySignature,
} from "./whatsapp.ts";
import { prepareImportJob } from "./property-import.ts";
import { handleCsmMessage } from "./csm-chat.ts";
import { runCsmMentorTips, runCsmNotify } from "./csm-notify.ts";
import { offerButtonReply, runPropertyOffers } from "./property-offers.ts";
import { coordOfferButtonReply, parseCoordPayload, respondToCoord, runShowingCoord } from "./showing-coord.ts";
import { showingCancelNotifyReply } from "./showing-actions.ts";
import { loadRecentPushesNote, loadReplyPrefix, rememberReplyTo } from "./reply-context.ts";
import {
  type AgentRow,
  type ConversationState,
  loadProfile,
  type OutboxItem,
  profileGaps,
  runAgentTurn,
  showcaseButtonReply,
  warmPromptCache,
} from "./agent.ts";
import { type PublicConversationState, runPublicTurn, warmPublicPromptCache } from "./public-agent.ts";
import { loadAgency } from "../_shared/agency-lookup.ts";
import { setPairReserve } from "../_shared/wa-pair-pace.ts";
import { alertPlatformAdmins, fallbackReply, isModelCallError, llmErrorText, llmFailureKind } from "./llm-fallback.ts";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { runEmailIntake } from "./email-intake.ts";
import {
  docKind,
  documentToText,
  hasMediaBlock,
  MEDIA_TOOLS,
  MEDIA_TOOLS_DENIED,
  type MediaResult,
  mediaForHistory,
  transcribeMedia,
  wrapDocument,
  wrapRecording,
} from "./media-intake.ts";
import { handleWaSignVerify } from "../_shared/agreement-wa-verify.ts";
import { feedbackToMeeting, parseMeetingPayload, respondToMeeting } from "../_shared/meeting-client.ts";
import {
  catalogBlock,
  type CatalogLink,
  catalogFailureBlock,
  catalogImagesInTurn,
  fetchCatalogItem,
  findCatalogLinks,
  MAX_LINKS_PER_MESSAGE,
} from "./catalog-link.ts";

// ============================================================================
// ‏Webhook של Meta WhatsApp Cloud API.
//
// ‏verify_jwt = false: את הפונקציה קוראת Meta, לא הדפדפן, ואין לה JWT של
// Supabase. האימות היחיד הוא חתימת HMAC ‏(X-Hub-Signature-256) מול ה-App
// Secret — בלעדיה כל מי שיודע את הכתובת יכול להתחזות לסוכן/ת.
//
// זרימה: אימות חתימה -> 200 מיידי ל-Meta -> עיבוד ברקע (זיהוי סוכן/ת,
// תמלול/תמונות, LLM עם כלים, תשובה חזרה בוואטסאפ).
//
// ---------------------------------------------------------------------------
// שני ענפים על אותו מספר
// ---------------------------------------------------------------------------
// מספר שנמצא ב-agency_members מגיע ל-`agent.ts` — העוזר שכותב למסד בשמו/ה.
// מספר שאינו שם מגיע ל-`public-agent.ts` — בוט קריאה-בלבד שמחפש נכסים
// במאגר הציבורי (‏docs/whatsapp-public-bot.md).
//
// הפיצול נשען כרגע על **היעדר התאמה בטבלה**, כי שני הענפים חולקים מספר אחד.
// ברגע שיהיה מספר שני ל-WABA, הניתוב צריך לעבור להישען על
// ‏`value.metadata.phone_number_id` שמטא שולחת בכל הודעה — שדה מפורש עדיף על
// היעדר שורה, כי טעות בנתוני סוכן/ת לא אמורה להפיל אותו/ה לענף הציבורי.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";

const IMAGES_BUCKET = "property-images";
// מגבלות ה-bucket ב-Supabase Storage — תמונה שחורגת תידחה שם ממילא,
// עדיף להגיד לסוכן/ת מה קרה מאשר להיכשל בשקט
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const UNKNOWN_SENDER_MSG =
  "סליחה, איני מזהה את מספר הטלפון שלך כמורשה במערכת.";
const INACTIVE_AGENT_MSG =
  "החשבון שלך במערכת אינו פעיל כרגע. אפשר לפנות למנהל/ת המשרד.";

/* הבוט הציבורי כבוי כברירת מחדל, וזו הכוונה: פריסה של הפונקציה לא אמורה
   לפתוח את המספר לכל העולם באותו רגע. ‏WHATSAPP_PUBLIC_BOT=on ב-Secrets הוא
   המתג, וכיבויו מחזיר את המספר להתנהגות הקודמת בדיוק. */
const publicBotEnabled =
  (Deno.env.get("WHATSAPP_PUBLIC_BOT") || "").trim().toLowerCase() === "on";

/* בלם הקצב של הענף הציבורי. כל הודעה נכנסת עולה כסף (קריאת LLM, ולפעמים
   תמלול), והמספר חשוף לכל מי שראה אותו בדף הפייסבוק. התקרות נדיבות לאדם
   שמחפש דירה ברצינות, וצרות למי ששולח בלולאה. */
const PUBLIC_HOURLY_LIMIT = 30;
const PUBLIC_DAILY_LIMIT = 120;
const PUBLIC_LIMIT_MSG =
  "הגעת למכסת ההודעות לעכשיו. אפשר להמשיך לחפש באתר - https://shuknadlan.co.il - " +
  "ולחזור אליי מאוחר יותר.";
/* שיחה שנשכחה אינה ממשיכה מעצמה: מי שכותב שוב אחרי חצי יום מתחיל נקי, כדי
   שהבוט לא יענה על שאלה של אתמול ולא יגרור הקשר שכבר אינו רלוונטי. */
const PUBLIC_IDLE_RESET_HOURS = 12;

/* הסוכן העוזר בוואטסאפ זמין ב-PROFESSIONAL וב-Elite. ‏Pay&GO מקבל/ת תשובה
   שמסבירה מה זה ולאן ללכת, ולא שתיקה: הודעה שלא נענית נראית כמו תקלה, וזה
   בדיוק הרגע שבו כדאי להסביר מה המסלול נותן. */
const TIER_ALLOWED = new Set(["mid", "premium"]);
// ‏tier לבדו אינו מסלול: מנוי שהתשלום עליו נכשל (`past_due`) או בוטל
// (`canceled`) נשאר עם `tier = 'mid'` עד ש-`expire_paid_subscriptions` מורידה
// אותו, וכל שאר היכולות בתשלום כבר בודקות את זה (‏`.claude/skills/new-tier-capability`).
const BILLING_INACTIVE_MSG =
  "המנוי שלך אינו פעיל כרגע, ולכן העוזר בוואטסאפ מושהה. " +
  "לפרטים ולחידוש המנוי: https://shuknadlan.co.il/pricing";
const TIER_REQUIRED_MSG =
  "הסוכן העוזר בוואטסאפ זמין במסלולים PROFESSIONAL ו-Elite. " +
  "במסלול Pay&GO אפשר להוסיף ולעדכן נכסים ישירות באיזור הסוכנים. " +
  "לפרטים ולשדרוג: https://shuknadlan.co.il/pricing";

const supabase = createClient(supabaseUrl, serviceRoleKey);
const SITE_BASE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/$/, "");

// מרווח בין הודעות לאותו מספר, גם מול התראות שרצות בפונקציה אחרת.
// בלי המיגרציה ה-RPC נכשל והמרווח המקומי ב-wa-pair-pace נשאר.
setPairReserve(async (phone, gapMs) => {
  const { data, error } = await supabase.rpc("whatsapp_pair_reserve", {
    p_phone: phone,
    p_gap_ms: gapMs,
  });
  if (error) return 0;
  const n = Number(data);
  return Number.isFinite(n) ? n : 0;
});

async function outboundAfterInbound(phone: string, waMessageId: string): Promise<boolean> {
  const { data: inbound } = await supabase.from("whatsapp_messages")
    .select("created_at")
    .eq("wa_message_id", waMessageId)
    .eq("direction", "in")
    .maybeSingle();
  if (!inbound?.created_at) return false;
  const { data: out } = await supabase.from("whatsapp_messages")
    .select("id")
    .eq("wa_phone", phone)
    .eq("direction", "out")
    .gte("created_at", inbound.created_at)
    .limit(1);
  return !!out?.length;
}

async function replyAfterLlmFailure(
  to: string,
  agentId: string | null,
  err: unknown,
  inboundWaId: string | null,
): Promise<void> {
  const kind = llmFailureKind(err);
  const audience = agentId ? "agent" : "visitor";
  const detail = llmErrorText(err).slice(0, 300);
  console.error("llm turn failed", audience, kind, isModelCallError(err), detail);
  // תשובה שכבר יצאה בתור הזה לא מקבלת הודעת כשל שנייה.
  if (inboundWaId && await outboundAfterInbound(to, inboundWaId)) return;
  await reply(to, fallbackReply(kind, audience, SITE_BASE), agentId);
  if (!isModelCallError(err)) return;
  await alertPlatformAdmins({
    recentCount: async (type, title, since) => {
      const { count } = await supabase.from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("type", type)
        .eq("title", title)
        .gte("created_at", since);
      return count ?? 0;
    },
    adminIds: async () => {
      const { data } = await supabase.from("agency_members")
        .select("id")
        .eq("is_platform_admin", true)
        .eq("active", true);
      return (data || []).map((r) => String(r.id));
    },
    insert: async (rows) => {
      const { error } = await supabase.from("notifications").insert(rows);
      return error?.message ?? null;
    },
  }, kind, detail);
}

// ---------------------------------------------------------------------------
// יומן הודעות
// ---------------------------------------------------------------------------

/**
 * רושמת הודעה נכנסת. מחזירה false אם ה-wa_message_id כבר קיים — כלומר Meta
 * שלחה את אותה הודעה פעם נוספת (מה שהיא עושה כשלא ענינו 200 מספיק מהר),
 * ואסור לעבד אותה שוב ולייצר נכס כפול.
 */
async function logInbound(msg: Record<string, any>): Promise<boolean> {
  const { error } = await supabase.from("whatsapp_messages").insert({
    wa_message_id: msg.id,
    direction: "in",
    wa_phone: msg.from,
    msg_type: msg.type || "unknown",
    body: msg.text?.body || msg.image?.caption || contactsLogLine(msg.contacts) || null,
  });
  if (error) {
    if (error.code === "23505") return false; // כבר טופלה
    console.error("inbound log failed", error);
    return true;
  }
  await rememberReplyTo(supabase, String(msg.id || ""), msg);
  return true;
}

async function reply(
  to: string,
  raw: string,
  agentId: string | null,
): Promise<void> {
  // היומן רושם את מה שיצא בפועל, לא את מה שהמודל כתב. אחרת בדיקה ביומן
  // הייתה מראה מקף ארוך שהסוכן/ת מעולם לא קיבל/ה.
  const body = formatForWhatsapp(raw);
  try {
    // מזהה ההודעה של מטא נשמר כדי שאירועי המסירה שיחזרו יידעו על איזו שורה
    // לשבת. בלעדיו "נשלח" הוא כל מה שנדע לעולם — וזה בדיוק ההבדל בין הודעה
    // שלא הגיעה לבין הודעה שהגיעה ומישהו פספס.
    const waMessageId = await sendText(to, body);
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waMessageId,
      direction: "out",
      wa_phone: to,
      agent_id: agentId,
      msg_type: "text",
      body,
      status: waMessageId ? "sent" : null,
    });
  } catch (err) {
    console.error("reply failed", err);
    await supabase.from("whatsapp_messages").insert({
      direction: "out",
      wa_phone: to,
      agent_id: agentId,
      msg_type: "text",
      body,
      error: String((err as Error)?.message || err),
    });
  }
}

/**
 * הודעות כפתורים שכלי הכין בתור (‏`OutboxItem`, למשל create_showcase), אחרי
 * התשובה - כדי שהכפתור יהיה הדבר האחרון במסך. כל אחת נרשמת ביומן כמו `reply`.
 * כישלון אחת אינו עוצר את הבאה; ושורת היומן נושאת את השגיאה.
 */
async function sendOutbox(to: string, items: OutboxItem[], agentId: string | null): Promise<void> {
  // אותו כפתור פעמיים בתור אחד (יצירת נכס ואז עדכון שלו) - פעם אחת
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.kind === "cta" ? item.url : item.buttons.map((b) => b.id).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const logBody = item.kind === "cta"
      ? `${item.body}\n[${item.label}] ${item.url}`
      : `${item.body}\n[${item.buttons.map((b) => b.title).join(" | ")}]`;
    try {
      const waMessageId = item.kind === "cta"
        ? await sendCtaUrl(to, item.body, item.label, item.url)
        : await sendButtons(to, item.body, item.buttons);
      await supabase.from("whatsapp_messages").insert({
        wa_message_id: waMessageId, direction: "out", wa_phone: to, agent_id: agentId,
        msg_type: "interactive", body: logBody, status: waMessageId ? "sent" : null,
      });
    } catch (err) {
      console.error("outbox send failed", err);
      await supabase.from("whatsapp_messages").insert({
        direction: "out", wa_phone: to, agent_id: agentId, msg_type: "interactive",
        body: logBody, error: String((err as Error)?.message || err),
      });
      // הכפתור לא יצא - הקישור בטקסט, כדי שהסוכן/ת לא יישאר/תישאר בלי דרך לשלוח
      if (item.kind === "cta") await reply(to, `${item.label}: ${item.url}`, agentId);
    }
  }
}

// ---------------------------------------------------------------------------
// מדיה
// ---------------------------------------------------------------------------

/** מורידה תמונה מוואטסאפ, מעלה ל-Storage ומחזירה URL ציבורי (או null). */
async function storeImage(mediaId: string, agentId: string): Promise<string | null> {
  const { bytes, mimeType } = await downloadMedia(mediaId);
  return storeImageBytes(bytes, mimeType, agentId);
}

/** אותה שמירה, לבתים שכבר בידינו (תמונה מקטלוג וואטסאפ). */
async function storeImageBytes(
  bytes: Uint8Array | ArrayBuffer,
  mimeType: string,
  agentId: string,
): Promise<string | null> {
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    console.warn("unsupported image type", mimeType);
    return null;
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    console.warn("image too large", bytes.byteLength);
    return null;
  }

  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  // אותו bucket ואותה חלוקה לפי סוכן/ת כמו בדשבורד; תיקיית whatsapp מבדילה
  // בין תמונות שהגיעו בצ'אט (עוד בלי property_id) לתמונות שהועלו מהטופס
  const path = `${agentId}/whatsapp/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(IMAGES_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    console.error("image upload failed", error);
    return null;
  }

  return supabase.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** מתמללת הודעה קולית דרך Whisper. מחזירה null אם אין מפתח/נכשל.
 *  הצינור המשותף (‏_shared/whisper.ts) מנסה שוב בשם אחר כשהקובץ נדחה
 *  כ-"Invalid file format" - הקלטות מאנדרואיד (מעטפת 3gp, ‏aac) נדחו כאן
 *  כשהסיומת נגזרה מהסוג בלבד (11.10.2026, ‏AUD-....). */
async function transcribeAudio(mediaId: string): Promise<string | null> {
  try {
    const { bytes, mimeType } = await downloadMedia(mediaId);
    const r = await transcribeMedia({
      supabase, openaiKey, agentId: "", bytes, mime: mimeType, call: false,
    });
    return r.ok ? r.text : null;
  } catch (err) {
    console.error("transcription failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// כרטיסי איש קשר והודעות מועברות
//
// מה שהטלפון לא מוסר לאתר, וואטסאפ כן מוסר: סוכן/ת פותח/ת את השיחות
// האחרונות, "שתף איש קשר" ← העוזר, והכרטיס מגיע כאן כהודעה מסוג `contacts`.
// זו הדרך היחידה שעובדת גם באייפון — דפדפן אינו רואה את יומן השיחות ואת
// אנשי הקשר בשום מכשיר (‏docs/crm-contacts-import.md).
//
// הבדיקה אם המספר כבר בקובץ נעשית כאן בקוד ולא מבוקשת מהמודל: היא זולה,
// דטרמיניסטית, ו"הוא כבר לקוח שלך" היא בדיוק השורה שחוסכת כרטיס כפול.
// ---------------------------------------------------------------------------

/** כמה כרטיסים לכל היותר מעובדים מהודעה אחת. שיתוף של מאה אנשי קשר הוא
 *  כמעט תמיד טעות, והוא היה ממלא את ההקשר של המודל. */
const MAX_SHARED_CONTACTS = 20;

type SharedContact = { name: string; phones: string[]; emails: string[]; company: string };

function parseSharedContacts(raw: unknown): SharedContact[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SHARED_CONTACTS).map((c: Record<string, any>) => {
    const n = c?.name || {};
    const name = String(
      n.formatted_name || [n.first_name, n.middle_name, n.last_name].filter(Boolean).join(" ") || "",
    ).trim();
    const phones = (Array.isArray(c?.phones) ? c.phones : [])
      .map((p: Record<string, any>) => localPhone(String(p?.wa_id || p?.phone || "")))
      .filter(Boolean);
    const emails = (Array.isArray(c?.emails) ? c.emails : [])
      .map((e: Record<string, any>) => String(e?.email || "").trim())
      .filter(Boolean);
    return {
      name,
      phones: [...new Set(phones)] as string[],
      emails: [...new Set(emails)] as string[],
      company: String(c?.org?.company || "").trim(),
    };
  }).filter((c) => c.name || c.phones.length);
}

/** ‏972521234567 / +972-52-123-4567 → 0521234567. מספר זר נשאר כמו שהוא. */
function localPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972") && digits.length >= 11) return "0" + digits.slice(3);
  return raw.trim().startsWith("+") ? "+" + digits : digits;
}

function phoneKey(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-9);
}

function contactsLogLine(raw: unknown): string | null {
  const list = parseSharedContacts(raw);
  return list.length ? `[איש קשר] ${list.map((c) => c.name || c.phones[0]).join(", ")}` : null;
}

/**
 * הופכת כרטיסי איש קשר לטקסט שהמודל מבין, ומסמנת מי כבר בקובץ הלקוחות.
 * ההשוואה לפי תשע הספרות האחרונות, בדיוק כמו בדיקת הכפילות ב-`create_client`.
 */
async function contactsToText(raw: unknown, agentId: string): Promise<string> {
  const list = parseSharedContacts(raw);
  if (!list.length) return "";

  const { data: clients } = await supabase
    .from("agent_clients")
    .select("full_name, phone, status")
    .eq("agent_id", agentId)
    .not("phone", "is", null)
    .limit(2000);
  const byPhone = new Map<string, { full_name: string; status: string }>();
  for (const c of clients || []) {
    const k = phoneKey(c.phone);
    if (k.length === 9) byPhone.set(k, c);
  }

  const lines = list.map((c, i) => {
    const parts = [c.name || "(ללא שם)", ...c.phones, ...c.emails];
    if (c.company) parts.push(`חברה: ${c.company}`);
    const hit = c.phones.map((p) => byPhone.get(phoneKey(p))).find(Boolean);
    const mark = hit
      ? ` - כבר בקובץ הלקוחות בשם "${hit.full_name}" (סטטוס ${hit.status})`
      : " - לא בקובץ הלקוחות";
    return `${i + 1}. ${parts.join(" | ")}${mark}`;
  });
  return `[איש קשר ששותף]\n${lines.join("\n")}`;
}

/** ‏Meta מסמנת הודעה מועברת ב-`context.forwarded`. בלי הסימון הזה המודל היה
 *  קורא "תוריד לי את המחיר" של לקוח/ה כהוראה של הסוכן/ת. */
function forwardedPrefix(msg: Record<string, any>): string {
  return msg.context?.forwarded || msg.context?.frequently_forwarded
    ? "[הודעה מועברת - נכתבה במקור על ידי מישהו אחר]\n"
    : "";
}

// ---------------------------------------------------------------------------
// קישור לפריט בקטלוג וואטסאפ (‏catalog-link.ts)
//
// הקישור נקרא כאן, לפני הרצף, ולא בכלי של המודל: זה דטרמיניסטי, וכך המודל
// רואה את הפריט באותו תור שבו הסוכן/ת שלח/ה אותו. התמונה **אינה** נכנסת
// לרשימת התמונות הממתינות כאן - רק אחרי שהרצף נאסף (‏`attachCatalogImage`),
// כי שני פריטים ברצף אחד היו מחברים את שתי התמונות לנכס הראשון.
// ---------------------------------------------------------------------------

const CATALOG_IMAGE_TIMEOUT_MS = 10000;

/** מורידה את תמונת הפריט מה-CDN של Meta ושומרת אותה כמו תמונה מהצ'אט.
 *  הכתובת שם חתומה ופגה תוך ימים, ולכן שומרים עותק ולא קישור. */
async function storeCatalogImage(url: string, agentId: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CATALOG_IMAGE_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn("catalog image fetch failed", res.status);
      return null;
    }
    const mimeType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await storeImageBytes(bytes, mimeType, agentId);
  } catch (err) {
    console.error("catalog image failed", err);
    return null;
  }
}

const CATALOG_FALLBACK_WAIT_MS = 12000;
const CATALOG_FALLBACK_POLL_MS = 700;

/**
 * הדף דרך המסד (pg_net), כשהבקשה הישירה מהפונקציה נכשלה. wa.me ענה 400
 * לבקשה מכאן ו-200 לאותו קישור מהמסד (מיגרציה 20270217090000). ‏pg_net
 * אסינכרוני: הבקשה יוצאת כשה-RPC הראשון נסגר, והתשובה נשאלת עד שהיא מגיעה.
 */
async function catalogPageViaDb(link: CatalogLink): Promise<string | null> {
  const { data: id, error } = await supabase.rpc("whatsapp_catalog_fetch_start", {
    p_product: link.productId, p_phone: link.phone,
  });
  if (error || id == null) {
    console.error("catalog db fetch start failed", error);
    return null;
  }
  const deadline = Date.now() + CATALOG_FALLBACK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(CATALOG_FALLBACK_POLL_MS);
    const { data: rows, error: readErr } = await supabase.rpc("whatsapp_catalog_fetch_result", { p_id: id });
    if (readErr) {
      console.error("catalog db fetch result failed", readErr);
      return null;
    }
    const row = (rows as { status_code: number | null; content: string | null; error_msg: string | null }[] | null)?.[0];
    if (!row) continue;
    if (row.status_code !== 200 || !row.content) {
      console.warn("catalog db fetch failed", row.status_code, row.error_msg);
      return null;
    }
    return row.content;
  }
  console.warn("catalog db fetch timed out", link.url);
  return null;
}

/** הטקסט שמתווסף להודעה עם קישור לקטלוג: בלוק הפריט, או "לא הצלחתי לקרוא". */
async function catalogLinksToText(body: string, agentId: string, from: string): Promise<string> {
  const links = findCatalogLinks(body);
  if (!links.length) return "";

  const blocks: string[] = [];
  for (const link of links.slice(0, MAX_LINKS_PER_MESSAGE)) {
    const got = await fetchCatalogItem(link, fetch, catalogPageViaDb);
    if ("error" in got) {
      blocks.push(catalogFailureBlock(link, got.error));
      continue;
    }
    const stored = got.item.imageUrl ? await storeCatalogImage(got.item.imageUrl, agentId) : null;
    blocks.push(catalogBlock(link, got.item, stored, from));
  }
  if (links.length > MAX_LINKS_PER_MESSAGE) {
    blocks.push(
      `[בהודעה ${links.length} קישורים לקטלוג, ונקרא רק הראשון. ` +
        "בקשי לשלוח כל פריט בהודעה נפרדת, אחרי שהנוכחי טופל.]",
    );
  }
  return "\n\n" + blocks.join("\n\n");
}

/**
 * אחרי שהרצף נאסף: פריט קטלוג אחד = התמונה שלו מצטרפת לתמונות הממתינות,
 * ו-`create_property` יחבר אותה לנכס כמו תמונה שנשלחה בצ'אט. כמה פריטים =
 * אף תמונה לא מצטרפת (אין דרך לדעת איזו שייכת לאיזה נכס), והמודל מתבקש
 * לטפל בהם אחד אחד. מחזירה את הכתובת שצורפה, או null.
 */
async function attachCatalogImage(
  agentId: string,
  from: string,
  conv: ConversationState,
  userText: string,
): Promise<{ image: string | null; note: string }> {
  const prefix = supabase.storage.from(IMAGES_BUCKET).getPublicUrl(`${agentId}/whatsapp/`).data.publicUrl;
  const { items, images } = catalogImagesInTurn(userText, prefix);
  if (!items) return { image: null, note: "" };
  if (items > 1) {
    return {
      image: null,
      note: `\n\n[בתור הזה ${items} פריטי קטלוג. התמונות שלהם לא צורפו לאף נכס. ` +
        "אל תפתחי מהם נכס: בקשי לשלוח את הקישורים שוב, אחד בכל פעם.]",
    };
  }
  if (images.length !== 1) return { image: null, note: "" };

  const { error } = await supabase.rpc("whatsapp_pending_image_add", {
    p_agent_id: agentId, p_phone: from, p_url: images[0],
  });
  if (error) {
    console.error("catalog image pending add failed", error);
    return { image: null, note: "\n\n[התמונה מהקטלוג לא נשמרה לצירוף. אמרי לסוכן/ת לשלוח אותה בנפרד.]" };
  }
  conv.pending_images = await freshPendingImages(agentId);
  return { image: images[0], note: "" };
}

// ---------------------------------------------------------------------------
// מצב שיחה
// ---------------------------------------------------------------------------
async function loadConversation(
  agentId: string,
  phone: string,
): Promise<ConversationState> {
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("history, pending_images, last_property_id, last_client_id")
    .eq("agent_id", agentId)
    .maybeSingle();

  return {
    history: (data?.history as Anthropic.MessageParam[]) || [],
    pending_images: data?.pending_images || [],
    last_property_id: data?.last_property_id || null,
    last_client_id: data?.last_client_id || null,
  };
}

async function saveConversation(
  agentId: string,
  phone: string,
  conv: ConversationState,
): Promise<void> {
  // ‏**בלי `pending_images`.** הרשימה משתנה רק דרך הפונקציות האטומיות
  // (‏`whatsapp_pending_image_add` / `_take`, מיגרציה 20270115095000). כתיבה
  // שלה מכאן היא מה שאיבד תמונות: אלבום מגיע כבקשות מקבילות, וכל אחת כתבה
  // את הרשימה שקראה - בלי התמונות שהמקבילות הוסיפו בינתיים.
  const { error } = await supabase.from("whatsapp_conversations").upsert({
    agent_id: agentId,
    wa_phone: phone,
    history: conv.history,
    last_property_id: conv.last_property_id,
    last_client_id: conv.last_client_id,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_id" });
  if (error) console.error("conversation save failed", error);
}

// ---------------------------------------------------------------------------
// הענף הציבורי
// ---------------------------------------------------------------------------

/**
 * האם המספר חרג מהמכסה. שאילתה אחת ליממה האחרונה, והספירה לשעה נגזרת ממנה
 * בזיכרון — הרצה פעמיים למסד על כל הודעה נכנסת היא מחיר מיותר.
 */
async function publicRateExceeded(phone: string): Promise<boolean> {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("created_at")
    .eq("wa_phone", phone)
    .eq("direction", "in")
    .gte("created_at", new Date(dayAgo).toISOString())
    .limit(PUBLIC_DAILY_LIMIT + 1);

  // כשל בספירה לא אמור להשתיק אדם שמחפש דירה. פותחים, ומתעדים.
  if (error) {
    console.error("public rate count failed", error);
    return false;
  }

  const rows = data || [];
  if (rows.length > PUBLIC_DAILY_LIMIT) return true;

  const hourAgo = Date.now() - 60 * 60 * 1000;
  const lastHour = rows.filter((r) => Date.parse(r.created_at) >= hourAgo).length;
  return lastHour > PUBLIC_HOURLY_LIMIT;
}

/**
 * הודעת המכסה נשלחת פעם אחת לשעה ולא על כל הודעה: מי שחרג ממשיך לרוב לשלוח,
 * ובלי הבלם הזה הבלם עצמו היה הופך למנוע ההוצאה.
 */
async function limitNoticeAlreadySent(phone: string): Promise<boolean> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("wa_phone", phone)
    .eq("direction", "out")
    .eq("body", PUBLIC_LIMIT_MSG)
    .gte("created_at", hourAgo)
    .limit(1);
  return !!(data && data.length);
}

async function loadPublicConversation(
  phone: string,
): Promise<PublicConversationState> {
  const BASE_COLS = "history, last_property_id, last_message_at, leads_created, leads_window_start";
  let { data, error } = await supabase
    .from("whatsapp_public_conversations")
    .select(`${BASE_COLS}, last_saved_search_id`)
    .eq("wa_phone", phone)
    .maybeSingle();
  // הפונקציה והמיגרציה נפרסות בשני workflows בלי סדר מובטח. עד שהעמודה
  // ‏(20270214091000) קיימת, select שלה נכשל - ושיחה שנטענת כריקה הייתה
  // מאבדת את ההיסטוריה ואת מונה הלידים. לכן נופלים לעמודות הישנות.
  if (error) {
    ({ data, error } = await supabase
      .from("whatsapp_public_conversations")
      .select(BASE_COLS)
      .eq("wa_phone", phone)
      .maybeSingle() as any);
  }

  const idleMs = PUBLIC_IDLE_RESET_HOURS * 60 * 60 * 1000;
  const stale = data?.last_message_at
    ? Date.now() - Date.parse(data.last_message_at) > idleMs
    : false;

  // מונה הלידים **אינו** מתאפס עם השיחה. שיחה שנשכחה מתחילה נקייה כדי שהבוט
  // לא יגרור הקשר של אתמול; התקרה קיימת כדי למנוע הצפה, ושתיקה של 12 שעות
  // היא בדיוק מה שמי שרוצה לעקוף אותה היה עושה.
  return {
    history: (!data || stale ? [] : (data.history as Anthropic.MessageParam[]) || []),
    last_property_id: (!data || stale ? null : data.last_property_id) || null,
    last_saved_search_id: (!data || stale ? null : data.last_saved_search_id) || null,
    leads_created: data?.leads_created || 0,
    leads_window_start: data?.leads_window_start || null,
  };
}

async function savePublicConversation(
  phone: string,
  conv: PublicConversationState,
): Promise<void> {
  const row = {
    wa_phone: phone,
    history: conv.history,
    last_property_id: conv.last_property_id,
    leads_created: conv.leads_created,
    leads_window_start: conv.leads_window_start,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("whatsapp_public_conversations").upsert({
    ...row,
    last_saved_search_id: conv.last_saved_search_id,
  }, { onConflict: "wa_phone" });
  // אותה נפילה לאחור כמו ב-load: עמודה שעוד לא קיימת לא מפילה את השמירה
  if (error) {
    ({ error } = await supabase.from("whatsapp_public_conversations")
      .upsert(row, { onConflict: "wa_phone" }));
  }
  if (error) console.error("public conversation save failed", error);
}

/* מאיפה הגיע/ה הפונה - לפי הודעת הפתיחה שהכפתור באתר ממלא מראש.
   ‏wa.me אינו מעביר שום פרמטר מלבד הטקסט, ולכן הטקסט הוא הסימן היחיד.
   הביטויים חייבים להופיע בהודעות הפתיחה ב-assets/home.js
   (‏GAB_HELLO, ‏renderEmptyBotLink) וב-FALLBACK_HELLO ב-assets/bot-link.js -
   ‏scripts/check_bot_entry.py מצליב, כי ניסוח מחדש של הודעה היה מעביר את
   כל הפניות שלה ל-direct בלי שום סימן. מי שמחק/ה את ההודעה המוכנה וכתב/ה
   משהו משלו/ה נספר/ת direct, וזה המחיר הידוע.
   ‏SITE_ENTRY_PHRASES משוכפל במיגרציה 20270214090000 (המילוי למפרע). */
const SITE_ENTRY_PHRASES: ReadonlyArray<[string, string]> = [
  ["מדף הבית", "homepage"],
  ["חיפשתי באתר", "search_empty"],
  ["הגעתי מהאתר", "site"],
];

/* תג המקור שחלונית גבריאלה (‏assets/gabriela-widget.js) מוסיפה בסוף ההודעה:
   "[site:property]". גובר על הביטויים, כי הוא אומר מאיזה **עמוד** (הביטוי
   "מדף הבית" נכתב רק בכרטיס שב-hero). ‏data-page בדפים חייב להופיע כאן -
   ‏scripts/check_bot_entry.py מצליב, וערך חדש כאן נכנס גם לאילוץ במסד
   (‏whatsapp_messages_public_entry_check). התג יורד מהטקסט לפני גבריאלה. */
const SITE_TAGS: Readonly<Record<string, string>> = {
  home: "homepage",
  property: "property",
  agent: "agent",
  agency: "agency",
  page: "site",
};
const SITE_TAG_RE = /\s*\[site:([a-z]{2,12})\]/;

function siteEntryOf(text: string): string {
  const tag = text.match(SITE_TAG_RE);
  if (tag && SITE_TAGS[tag[1]]) return SITE_TAGS[tag[1]];
  for (const [phrase, entry] of SITE_ENTRY_PHRASES) {
    if (text.includes(phrase)) return entry;
  }
  return "direct";
}

/* מאיזו מודעה - שני מקורות, וזה שמגיע מ-Meta גובר:
   1. מודעת "שליחת הודעה בוואטסאפ" במטא (click-to-WhatsApp): Meta מצמידה
      להודעה הראשונה `referral` עם `source_type: "ad"` ו-`source_id` = מזהה
      המודעה. לא תלוי בטקסט, ולכן שורד גם מי שמחק/ה את ההודעה המוכנה.
      הכניסה נחתמת `ad` (לא "מהאתר" - הפונה לא עבר/ה באתר).
   2. מודעה שנחתה באתר: ‏assets/bot-link.js מוסיף להודעת הפתיחה
      "(מודעה <מקור>:<קמפיין>[:<גרסה>])" מה-UTM של דף הנחיתה. הכניסה נשארת
      לפי הכפתור (‏homepage וכו'), והקוד נשמר לצידה.
   התווים מוגבלים כאן ובמסד (‏whatsapp_messages_public_entry_ref_check): זה
   שם קמפיין, וטקסט חופשי של פונה אינו נכנס לעמודה הזו.
   ‏docs/whatsapp-public-bot.md, "מאיזו מודעה". */
const AD_REF_RE = /\(מודעה ([a-z0-9._-]{1,30}:[a-z0-9._-]{1,30}(?::[a-z0-9._-]{1,30})?)\)/;

function adEntryOf(msg: Record<string, any>, text: string): { entry: string | null; ref: string | null } {
  const r = msg?.referral;
  if (r && r.source_type === "ad" && /^\d{5,25}$/.test(String(r.source_id || ""))) {
    return { entry: "ad", ref: "meta:" + String(r.source_id) };
  }
  const m = text.match(AD_REF_RE);
  return { entry: null, ref: m ? m[1] : null };
}

/**
 * פונה שאינו סוכן/ת. הכול כאן קריאה בלבד: אין שמירת מדיה, אין כתיבה לנכסים,
 * ואין נגיעה בנתוני סוכנים — למעט מה שממילא פתוח באתר.
 */
async function handlePublicMessage(msg: Record<string, any>): Promise<void> {
  const from: string = msg.from;

  // הבדיקה קודמת לכל דבר שעולה כסף — תמלול, LLM — בדיוק כמו שגייטינג
  // המסלולים קודם לו בענף של הסוכנים.
  if (await publicRateExceeded(from)) {
    if (!(await limitNoticeAlreadySent(from))) {
      await reply(from, PUBLIC_LIMIT_MSG, null);
    }
    return;
  }

  let userText = "";

  switch (msg.type) {
    case "text":
      userText = msg.text?.body || "";
      break;

    case "audio":
    case "voice": {
      const media = msg.audio || msg.voice;
      const transcript = await transcribeAudio(media.id);
      if (!transcript) {
        await reply(from, "לא הצלחתי לשמוע את ההקלטה, גם אחרי ניסיון נוסף. אפשר לכתוב לי מה מחפשים?", null);
        return;
      }
      userText = transcript;
      await supabase.from("whatsapp_messages")
        .update({ body: transcript })
        .eq("wa_message_id", msg.id);
      break;
    }

    case "interactive":
      userText = msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title || "";
      break;

    case "button":
      userText = msg.button?.text || "";
      break;

    // תמונות מפונה ציבורי אינן נשמרות. ‏storeImage כותבת ל-bucket של הנכסים
    // תחת תיקייה של סוכן/ת — לאלמוני אין כזו, ופתיחת אחסון לכל מי שיודע את
    // המספר היא בדיוק סוג הדלת שלא צריך לפתוח בשביל נוחות.
    default:
      await reply(
        from,
        "אני יודעת לקרוא הודעות טקסט והקלטות קוליות. מה מחפשים? (למשל: " +
          "\"3 חדרים בעפולה עד מיליון ושלוש\")",
        null,
      );
      return;
  }

  if (!userText.trim()) return;

  const conv = await loadPublicConversation(from);

  // היסטוריה ריקה = פנייה חדשה (גם אחרי 12 שעות שקט). זה מה שנספר בפאנל
  // "פניות לגבריאלה" ב-crm, ולכן נחתם עכשיו: ה-body נמחק אחרי 30 יום.
  if (!conv.history.length) {
    const ad = adEntryOf(msg, userText);
    const stamp: Record<string, string> = { public_entry: ad.entry || siteEntryOf(userText) };
    if (ad.ref) stamp.public_entry_ref = ad.ref;
    let { error } = await supabase.from("whatsapp_messages").update(stamp).eq("wa_message_id", msg.id);
    // עמודה או ערך שעוד לא במסד (הפונקציה נפרסה לפני המיגרציה): חותמים
    // לפחות את מה שהיה נחתם קודם, ולא מאבדים את הפנייה.
    // עמוד שעוד אינו באילוץ (‏property / agent / agency) נחתם 'site' - מהאתר.
    if (error) {
      const entry = siteEntryOf(userText);
      const legacy = ["homepage", "search_empty", "site", "direct"].includes(entry) ? entry : "site";
      ({ error } = await supabase.from("whatsapp_messages")
        .update({ public_entry: legacy }).eq("wa_message_id", msg.id));
    }
    if (error) console.error("public entry stamp failed", error);
  }
  // הקוד נחתם; לגבריאלה הוא רעש, והיא עלולה לצטט אותו לפונה.
  userText = userText.replace(AD_REF_RE, "").replace(SITE_TAG_RE, "").trim() || userText;

  let answer: string;
  let shareContact = false;
  try {
    ({ text: answer, shareContact } = await runPublicTurn({
      supabase,
      conv,
      userText,
      waPhone: from,
      profileName: msg._profile_name || null,
    }));
  } catch (err) {
    console.error("public turn failed", err);
    await supabase.from("whatsapp_messages")
      .update({ error: String((err as Error)?.message || err) })
      .eq("wa_message_id", msg.id);
    // נשמר גם בכשל: אם הכלי הספיק לפתוח ליד לפני שהתור נפל, המונה שלו כבר
    // עלה — ותקרה שנשכחת בכל שגיאה אינה תקרה.
    await savePublicConversation(from, conv);
    await replyAfterLlmFailure(from, null, err, String(msg.id || ""));
    return;
  }

  await savePublicConversation(from, conv);
  // ריק = התור נגמר בהודעת כפתורים שכבר נשלחה (offer_save_search)
  if (answer) await reply(from, answer, null);

  // ההצעה לשמור את גבריאלה באנשי הקשר - בעיקר אחרי שמירת חיפוש, ולעולם לא
  // באותו תור שבו נשלחו הכפתורים: הכרטיס היה דוחף אותם למעלה, רגע לפני
  // שלוחצים. ‏runPublicTurn מחליט מתי (‏shareContact).
  if (shareContact && answer) await maybeShareContactCard(from);
}

// ---------------------------------------------------------------------------
// גבריאלה באנשי הקשר
// ---------------------------------------------------------------------------

// המספר העסקי של העוזרת - אותו מספר כמו ב-assets/bot-link.js וב-crm.js. מזהה
// ציבורי ולא סוד; המשתנה קיים כדי שהחלפת מספר ב-Meta לא תחכה לפריסה של קוד.
const ASSISTANT_PHONE = (Deno.env.get("WHATSAPP_DISPLAY_NUMBER") || "972532494740")
  .replace(/\D/g, "");
const CONTACT_CARD_NOTE =
  "ועוד משהו קטן - שווה לשמור אותי באנשי הקשר 📇 ככה יהיה קל למצוא אותי " +
  "בחיפוש הבא: פשוט לכתוב לי מה מחפשים.";

/**
 * כרטיס איש קשר של גבריאלה, **פעם אחת למספר** - לא לשיחה. מי שכבר קיבל/ה
 * אותו לא צריך/ה אותו שוב, וכרטיס בכל שיחה הוא ספאם.
 *
 * ‏"פעם אחת" נבדק ביומן (`whatsapp_messages`, ‏msg_type `contacts`) ולא בעמודה
 * חדשה - היומן ממילא רושם כל הודעה יוצאת, ומקור אמת שני היה מתפצל ממנו.
 */
async function maybeShareContactCard(phone: string): Promise<void> {
  if (!ASSISTANT_PHONE) return;
  const { data: sent } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("wa_phone", phone)
    .eq("direction", "out")
    .eq("msg_type", "contacts")
    .limit(1);
  if (sent && sent.length) return;

  await reply(phone, CONTACT_CARD_NOTE, null);
  const body = `גבריאלה - שוק נדל"ן (+${ASSISTANT_PHONE})`;
  try {
    const waMessageId = await sendContactCard(phone, {
      name: "גבריאלה",
      company: "שוק נדל\"ן",
      phoneDigits: ASSISTANT_PHONE,
      url: "https://shuknadlan.co.il",
    });
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waMessageId,
      direction: "out",
      wa_phone: phone,
      msg_type: "contacts",
      body,
      status: waMessageId ? "sent" : null,
    });
  } catch (err) {
    console.error("contact card send failed", err);
    // נרשם עם השגיאה, ולכן לא יישלח שוב: ההזמנה כבר יצאה בטקסט, וניסיון
    // חוזר בכל חיפוש היה מוסיף אותה שוב ושוב בלי הכרטיס.
    await supabase.from("whatsapp_messages").insert({
      direction: "out",
      wa_phone: phone,
      msg_type: "contacts",
      body,
      error: String((err as Error)?.message || err),
    });
  }
}

/**
 * האם גבריאלה כבר הציגה את עצמה לסוכן/ת. ההיסטוריה של הסוכנים אינה מתאפסת,
 * ולכן "היסטוריה ריקה" הייתה מציגה אותה רק לסוכנים חדשים - ולא לאלה שהכירו
 * את העוזר בלי שם. היומן אומר אם השם כבר נאמר אי פעם.
 */
async function assistantIntroduced(agentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("agent_id", agentId)
    .eq("direction", "out")
    .ilike("body", "%גבריאלה%")
    .limit(1);
  // בכשל קריאה - לא להציג שוב. היכרות כפולה מביכה יותר מהיכרות שנדחתה בתור.
  if (error) return true;
  return !!(data && data.length);
}

// ---------------------------------------------------------------------------
// טיפול בהודעה בודדת
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// אלבומים
// ---------------------------------------------------------------------------

// חלון השקט שאחריו רצף הודעות נחשב גמור. נמדד (30 יום): 190 הודעות הגיעו
// 0-4 שניות אחרי הקודמת - אלבומים ומודעות מועברות - **אף אחת** בין 4 ל-5,
// ומשם רק הקלדה ידנית. כל הודעה פותחת חלון משלה, כך שהחלון נמדד מהאחרונה.
// מיגרציה 20270115099000.
const BURST_WAIT_MS = 4000;

// ‏**טקסט מוקלד מחכה פחות** (14.10.2026). ההמתנה של 4 שניות נוספה לכל
// הודעה, כולל ה-98% שאחריהן לא הגיע דבר - והייתה רבע מזמן התגובה של
// גבריאלה (חציון 16.5 שניות). נמדד (30 יום): מתוך ~1,500 הודעות טקסט, קול
// וכפתור, 50 בלבד קיבלו הודעה נוספת תוך 4 שניות, ו-29 מהן תוך 1.5. אלבום,
// מסמך והודעה מועברת - וכל רצף שכבר יש בו תמונות - ממשיכים לחכות 4 שניות.
const QUICK_BURST_WAIT_MS = 1500;

// ‏**ותמונה - 3 שניות** (17.10.2026). אחרי 1.5 לטקסט, החציון אצל הסוכנים ירד
// רק ב-1.4 שניות, כי חלק גדול מההודעות הן תמונות נכסים שחיכו 4. נמדד (30
// יום): 661 מתוך 662 פערים בין תמונה לתמונה באותו אלבום - עד 2.5 שניות, והארוך
// מתחת ל-3. הסיכון: טקסט שמגיע 3-4 שניות אחרי התמונה האחרונה (3 בחודש) נענה
// בנפרד. הודעה מועברת ומסמך נשארים 4.
const IMAGE_BURST_WAIT_MS = 3000;
const QUICK_BURST_TYPES = new Set(["text", "audio", "interactive", "button"]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function freshPendingImages(agentId: string): Promise<string[]> {
  const { data } = await supabase.from("whatsapp_conversations")
    .select("pending_images").eq("agent_id", agentId).maybeSingle();
  return (data?.pending_images as string[]) || [];
}

/** מתי נכנסה הממתינה הוותיקה ביותר (מיגרציה 20270906090000), או null. */
async function pendingImagesSince(agentId: string): Promise<number | null> {
  const { data } = await supabase.from("whatsapp_conversations")
    .select("pending_images_since").eq("agent_id", agentId).maybeSingle();
  const at = Date.parse(String(data?.pending_images_since || ""));
  return Number.isFinite(at) ? at : null;
}

/** "מ-24.10 בשעה 23:11" - מתי נשלחה תמונה ממתינה, בשעון ישראל. */
function sentAtLabel(at: number): string {
  const d = new Date(at);
  const tz = { timeZone: "Asia/Jerusalem" } as const;
  const day = d.toLocaleDateString("he-IL", { ...tz, day: "numeric", month: "numeric" });
  const today = new Date().toLocaleDateString("he-IL", { ...tz, day: "numeric", month: "numeric" });
  const time = d.toLocaleTimeString("he-IL", { ...tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return day === today ? `מהשעה ${time}` : `מ-${day} בשעה ${time}`;
}

/**
 * ‏**מה שהוובהוק עשה בלי המודל נכנס להיסטוריה** (27.10.2026). הצירוף, השאלה
 * וההסרה יוצאים מכאן ולא מגבריאלה, ולכן היא לא ראתה אותם: צילום מסך צורף
 * ל"משרד בגולד סנטר" ב-12:23, ושלוש פעמים אחר כך היא אמרה לסוכן "הצילום לא
 * צורף לאף נכס" - בביטחון, בזמן שהוא היה באתר. זוג user/assistant כמו
 * ‏`rememberForBot` ב-`twilio-voice`, כדי שהסדר יישאר תקין. הקורא שומר.
 */
function rememberPhotoAction(conv: ConversationState, text: string): void {
  conv.history = [
    ...conv.history,
    { role: "user", content: "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: טיפול בתמונות שהסוכן/ת שלח/ה]" },
    { role: "assistant", content: text },
  ];
}

/**
 * התמונה האחרונה באלבום: צירוף לנכס הפעיל בשיחה, או שאלה לאיזה נכס.
 *
 * ‏**אף פעם לא שתיקה.** עד כאן, בלי נכס פעיל, התמונות נשמרו בצד בלי מילה
 * (7 תמונות ב-20.9 לא קיבלו שום תשובה), והסוכן/ת לא ידע/ה אם הן הגיעו.
 */
async function attachPendingImages(
  agentId: string,
  from: string,
  property: { id: string; title: string },
  conv: ConversationState,
): Promise<boolean> {
  const { data: taken } = await supabase.rpc("whatsapp_pending_images_take", { p_agent_id: agentId });
  const urls = (taken as string[]) || [];
  if (!urls.length) return false; // טקסט מקביל כבר לקח אותן, והוא עונה עליהן
  const { data: total, error } = await supabase.rpc("property_images_append", {
    p_property_id: property.id, p_agent_id: agentId, p_urls: urls,
  });
  if (error || total == null) {
    console.error("property images append failed", error);
    // ההחזרה לרשימה: עדיף שיישארו ממתינות מאשר ייעלמו
    for (const u of urls) {
      await supabase.rpc("whatsapp_pending_image_add", { p_agent_id: agentId, p_phone: from, p_url: u });
    }
    await reply(from, `לא הצלחתי לצרף את התמונות ל"${property.title}". הן שמורות בצד - אפשר לכתוב לאיזה נכס לצרף.`, agentId);
    return true;
  }
  const added = urls.length === 1 ? "נוספה תמונה אחת" : `נוספו ${urls.length} תמונות`;
  const text = `📸 ${added} ל"${property.title}" (${total} בסך הכול).`;
  await reply(from, text, agentId);
  // המיקום ברשימה, כדי ש"תמחקי את מה שנוסף" יגיע ל-manage_images בלי ניחוש
  const from1 = Number(total) - urls.length + 1;
  rememberPhotoAction(conv,
    `${text} (נכס ${property.id}, תמונות ${from1}-${total}. ` +
      "צורפו אוטומטית, בלי שהסוכן/ת אישר/ה. להסרה: manage_images עם remove ומספרים אלה.)");
  conv.last_property_id = property.id;
  return true;
}

// ‏**תמונות אחרי הפסקה - שואלים, לא מצרפים** (17.10.2026). סוכן/ת שמתחיל/ה
// נכס חדש בתמונות, שעה אחרי שהכניס/ה נכס אחר, קיבל/ה את התמונות על הנכס
// הקודם. נמדד (60 יום, הפער שלפני אלבום של סוכן/ת): 63 עד 5 דקות (המשך של
// אותו נכס), 6 בין 5 ל-15, ו-10 מעל 15 דקות. מעל 20 דקות של שקט - כפתורים.
const PHOTO_ASK_GAP_MS = 20 * 60 * 1000;
// הודעות נכנסות שהפער ביניהן עד דקה הן אותו רצף (האלבום, וה-unsupported שלפניו)
const PHOTO_RUN_LINK_MS = 60 * 1000;
const PHOTO_ASK_MARK = "או שזה נכס חדש?";
const PHOTO_BTN_RE = /^pimg:(p|n|d)(?::([0-9a-f-]{36}))?$/;

/**
 * האם האלבום הזה פותח את השיחה מחדש: לפני הרצף הנכנס הנוכחי היה שקט של
 * יותר מ-`PHOTO_ASK_GAP_MS`, או שההודעה האחרונה לפניו היא השאלה עצמה ועוד
 * לא נענתה (אלבום שני אחרי השאלה אינו "המשך" של הנכס הקודם).
 */
async function photoBurstNeedsAsk(from: string): Promise<boolean> {
  const { data } = await supabase.from("whatsapp_messages")
    .select("direction, body, created_at").eq("wa_phone", from)
    .order("created_at", { ascending: false }).limit(80);
  const rows = (data || []) as { direction: string; body: string | null; created_at: string }[];
  if (!rows.length) return false;
  let t = Date.parse(rows[0].created_at);
  for (let i = 1; i < rows.length; i++) {
    const at = Date.parse(rows[i].created_at);
    if (rows[i].direction === "in" && t - at <= PHOTO_RUN_LINK_MS) {
      t = at;
      continue;
    }
    if (rows[i].direction === "out" && String(rows[i].body || "").includes(PHOTO_ASK_MARK)) return true;
    return t - at > PHOTO_ASK_GAP_MS;
  }
  return false; // אין היסטוריה לפני הרצף - וגם אין נכס קודם
}

/**
 * "📎 לנכס הקודם" / "🏠 נכס חדש" (‏`pimg:p:<id>` / `pimg:n`). המזהה נבדק לפני
 * הכותרת, כמו כל כפתור אחר כאן: הכותרת לבדה אינה אומרת על איזה נכס עונים.
 */
async function photoButtonReply(
  agentId: string,
  from: string,
  conv: ConversationState,
  buttonId: string,
): Promise<boolean> {
  const m = PHOTO_BTN_RE.exec(buttonId || "");
  if (!m) return false;
  const pending = await freshPendingImages(agentId);
  if (m[1] === "p") {
    const { data: property } = await supabase.from("properties")
      .select("id, title").eq("id", m[2] || "").eq("agent_id", agentId).maybeSingle();
    if (!property) {
      await reply(from, "לא מצאתי את הנכס הזה אצלך. לאיזה נכס לצרף? אפשר לכתוב כתובת או מספר מודעה.", agentId);
      return true;
    }
    if (!(await attachPendingImages(agentId, from, property, conv))) {
      await reply(from, `התמונות כבר שויכו. אם חסרות ב"${property.title}" - אפשר לשלוח אותן שוב.`, agentId);
      return true;
    }
    await saveConversation(agentId, from, conv);
    return true;
  }
  // ‏"🗑 לא לשום נכס": צילום מסך, מסמך, תמונה שנשלחה בטעות. הן יורדות
  // מהרשימה ולא יצורפו לשום נכס - לא לקודם, וגם לא לחדש הבא (27.10.2026).
  if (m[1] === "d") {
    const { data: taken } = await supabase.rpc("whatsapp_pending_images_take", { p_agent_id: agentId });
    const n = ((taken as string[]) || []).length;
    const text = n
      ? `👍 ${n === 1 ? "התמונה לא תצורף" : `${n} התמונות לא יצורפו`} לשום נכס.`
      : "אין תמונות שממתינות לשיוך.";
    await reply(from, text, agentId);
    if (n) {
      rememberPhotoAction(conv, `${text} (הוסרו מהרשימה הממתינה לבקשת הסוכן/ת.)`);
      await saveConversation(agentId, from, conv);
    }
    return true;
  }
  // ‏**לחיצה מאוחרת** (24.10.2026): הסוכן/ת כבר כתב/ה את פרטי הנכס החדש,
  // הנכס נפתח עם התמונות, ורק אז נלחץ "נכס חדש" - והתשובה "מה הנכס?" שאלה
  // על נכס שכבר קיים (19.10). בלי תמונות ממתינות אין מה לשאול: לא נוגעים
  // ב-last_property_id (הוא כבר הנכס החדש) ואומרים איפה התמונות.
  if (!pending.length) {
    const { data: recent } = await supabase.from("properties")
      .select("title").eq("agent_id", agentId)
      .gte("created_at", new Date(Date.now() - PHOTO_ASK_GAP_MS).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    await reply(
      from,
      recent
        ? `הנכס החדש כבר נפתח עם התמונות: "${recent.title}" 🏠`
        : "התמונות כבר שויכו. לנכס חדש - סוג, עסקה ומחיר (וכתובת אם יש).",
      agentId,
    );
    return true;
  }
  // נכס חדש: "הנכס האחרון" מתנקה, כדי שהתור הבא לא יצרף אליו, והתמונות
  // נשארות ממתינות - יצירת הנכס מצרפת אותן (agent.ts, create_property).
  // הסוכן/ת אישר/ה אותן עכשיו, ולכן הן נלקחות ומוחזרות: ‏`pending_images_since`
  // מתחיל מחדש, ו-create_property לא יעצור עליהן כ"ותיקות" ויישאל שוב.
  const { data: confirmed } = await supabase.rpc("whatsapp_pending_images_take", { p_agent_id: agentId });
  for (const u of (confirmed as string[]) || []) {
    await supabase.rpc("whatsapp_pending_image_add", { p_agent_id: agentId, p_phone: from, p_url: u });
  }
  conv.last_property_id = null;
  rememberPhotoAction(conv, "הסוכן/ת לחץ/ה \"🏠 נכס חדש\": התמונות הממתינות שייכות לנכס החדש שייפתח.");
  await saveConversation(agentId, from, conv);
  await reply(
    from,
    "מעולה, נכס חדש 🏠 התמונות שמורות בצד. מה הנכס? סוג, עסקה ומחיר (וכתובת אם יש), ואפתח אותו עם התמונות.",
    agentId,
  );
  return true;
}

async function flushImageBatch(
  agentId: string,
  from: string,
  conv: ConversationState,
  count: number,
): Promise<void> {
  const what = count === 1 ? "תמונה אחת" : `${count} תמונות`;

  // תמונות שממתינות מלפני הרצף הזה (שאלה שלא נענתה, צילום מסך מהבוקר)
  const since = await pendingImagesSince(agentId);
  const olderWaiting = since != null && Date.now() - since > PHOTO_ASK_GAP_MS;

  if (conv.last_property_id) {
    const { data: property } = await supabase.from("properties")
      .select("id, title, updated_at").eq("id", conv.last_property_id).eq("agent_id", agentId).maybeSingle();

    if (property) {
      // ‏**השקט נמדד גם מהנכס, לא רק מהשיחה** (27.10.2026). צילום מסך של
      // דיון בבית משפט נשלח 33 שניות אחרי הודעה על היומן - "בלי שקט" - וצורף
      // למשרד בגולד סנטר, שאיש לא נגע בו מאז 25.10. כל צירוף ועדכון מרעננים
      // את updated_at, ולכן אלבום שני של אותו נכס עדיין מצטרף בלי שאלה.
      const propertyIdle = Date.now() - Date.parse(String(property.updated_at || "")) > PHOTO_ASK_GAP_MS;
      if (olderWaiting || propertyIdle || await photoBurstNeedsAsk(from)) {
        const older = olderWaiting ? ` (הראשונה ${sentAtLabel(since!)})` : "";
        const body = formatForWhatsapp(
          `📸 יש ${what} שממתינות לשיוך${older}. לצרף ל"${property.title}" שעבדנו עליו קודם, ${PHOTO_ASK_MARK}`);
        const buttons = [
          { id: `pimg:p:${property.id}`, title: "📎 לנכס הקודם" },
          { id: "pimg:n", title: "🏠 נכס חדש" },
          { id: "pimg:d", title: "🗑 לא לשום נכס" },
        ];
        let waMessageId: string | null = null;
        let sendError: string | null = null;
        try {
          waMessageId = await sendButtons(from, body, buttons);
        } catch (err) {
          sendError = String((err as Error)?.message || err);
          console.error("photo ask buttons failed", err);
        }
        await supabase.from("whatsapp_messages").insert({
          wa_message_id: waMessageId, direction: "out", wa_phone: from, agent_id: agentId,
          msg_type: "interactive", body: `${body}\n[${buttons.map((b) => b.title).join(" | ")}]`,
          status: waMessageId ? "sent" : null, error: sendError,
        });
        // הכפתורים לא יצאו - אותה שאלה בטקסט, כדי שהתמונות לא יישארו בלי מילה
        if (sendError) {
          await reply(from, `${body} אפשר לכתוב "לקודם", "לא שייכות", או את פרטי הנכס החדש.`, agentId);
        }
        rememberPhotoAction(conv,
          `${body} (נשאל בכפתורים; התמונות לא צורפו לשום נכס עד תשובה. "לא שייכות" = ` +
            "discard_pending_images.)");
        await saveConversation(agentId, from, conv);
        return;
      }
      if (await attachPendingImages(agentId, from, property, conv)) {
        await saveConversation(agentId, from, conv);
      }
      return;
    }
  }

  const older = olderWaiting ? ` (הראשונה ${sentAtLabel(since!)})` : "";
  const text = `📸 יש ${what} שממתינות לשיוך${older}. לאיזה נכס לצרף? אפשר לכתוב כתובת או מספר מודעה, ` +
    "או לכתוב את פרטי נכס חדש (סוג, עסקה ומחיר) ואפתח אותו עם התמונות. " +
    "תמונה שלך? כתוב/כתבי \"תמונת פרופיל\". לא לשום נכס? כתוב/כתבי \"לא שייכות\".";
  await reply(from, text, agentId);
  rememberPhotoAction(conv, `${text} (התמונות לא צורפו לשום נכס עד תשובה.)`);
  await saveConversation(agentId, from, conv);
}

async function handleMessage(msg: Record<string, any>): Promise<void> {
  const from: string = msg.from;
  if (!from || !msg.id) return;

  if (!(await logInbound(msg))) return; // משלוח חוזר של Meta — כבר טופל
  markReadAndTyping(msg.id);

  // --- תשובה של לקוח/ה לתזכורת על פגישה (אישור / ביטול / מועד אחר),
  //     או משוב אחרי סיור (אהבתי / מתלבט/ת / לא בשבילי) ---
  // לפני זיהוי הסוכן/ת ולפני הבוט הציבורי: השולח/ת הוא/היא לקוח/ה של
  // סוכן/ת, וה-payload ‏(`mtg:<c|x|r>:<token>`) הוא כל מה שצריך. בתבנית הוא
  // מגיע ב-button.payload, ובהודעת כפתורים רגילה ב-button_reply.id.
  // ‏docs/meeting-client-followup.md
  const meetingBtn = parseMeetingPayload(
    msg.type === "button" ? msg.button?.payload
      : msg.type === "interactive" ? msg.interactive?.button_reply?.id
      : null,
  );
  if (meetingBtn) {
    const res = meetingBtn.type === "response"
      ? await respondToMeeting(supabase, meetingBtn.token, meetingBtn.response)
      : await feedbackToMeeting(supabase, meetingBtn.token, meetingBtn.feedback);
    await reply(from, res.reply, null);
    return;
  }

  // --- בעלים או מתווך/ת עונה לבקשת תיאום ביקור (מאשר/ת / לדחות / מועד אחר) ---
  // מאותה סיבה ובאותו מקום: הבעלים אינו/ה סוכן/ת, ומתווך/ת בשת"פ הוא/היא
  // סוכן/ת שהלחיצה שלו/ה אסור שתגיע לגבריאלה כאילו נכתבה ביד.
  // ‏docs/showing-coordination.md
  const coordBtn = parseCoordPayload(
    msg.type === "button" ? msg.button?.payload
      : msg.type === "interactive" ? msg.interactive?.button_reply?.id
      : null,
  );
  if (coordBtn) {
    await reply(from, await respondToCoord(supabase, coordBtn.token, coordBtn.answer), null);
    return;
  }

  // --- אימות חותם/ת על הסכם ("אימות חתימה 482193") ---
  // לפני זיהוי הסוכן/ת: השולח/ת הוא/היא לקוח/ה, ובלי זה היה/הייתה מקבל/ת
  // "איני מזהה את מספר הטלפון שלך". ‏_shared/agreement-wa-verify.ts.
  if (msg.type === "text") {
    const verifyReply = await handleWaSignVerify(supabase, from, String(msg.text?.body || ""));
    if (verifyReply) {
      await reply(from, verifyReply, null);
      return;
    }
  }

  // --- אימות כניסה ל-CRM ("אימות כניסה 482193") ---
  // לפני זיהוי הסוכן/ת, כדי שההודעה לא תגיע לגבריאלה כבקשה. כל הבדיקה
  // (הקוד, התוקף, והנייד שבכרטיס מול from) במסד, ב-wa_login_verify.
  // ‏docs/mfa.md.
  if (msg.type === "text") {
    const m = /אימות\s*כניסה[\s‎‏:#-]*(\d{6})/.exec(String(msg.text?.body || ""));
    if (m) {
      const { data, error } = await supabase.rpc("wa_login_verify", { p_nonce: m[1], p_from: from });
      if (error) console.error("wa login verify failed", error.message);
      await reply(from, error ? "לא הצלחנו לאמת כרגע. נסו לשלוח שוב בעוד דקה." : String(data), null);
      return;
    }
  }

  // --- זיהוי הסוכן/ת לפי מספר הטלפון ---
  // phone_e164 היא עמודה מחושבת שמנרמלת את agency_members.phone לאותו פורמט
  // ש-Meta שולחת ב-from, כך שההשוואה היא שוויון פשוט ומאונדקס.
  const { data: agent } = await supabase
    .from("agency_members")
    .select("id, agency_id, display_name, tier, active, billing_status")
    .eq("phone_e164", from)
    .maybeSingle();

  if (!agent) {
    // --- צוות ההטמעה (csm_staff): לא סוכן/ת ולא גולש/ת. תור נפרד עם כלי
    // ההטמעה בלבד (csm-chat.ts, ‏docs/csm-adoption.md). אחרי הסוכנים, ולכן
    // csm_staff_save דוחה טלפון של סוכן/ת.
    const { data: staff } = await supabase.from("csm_staff")
      .select("id, display_name").eq("phone_e164", from).eq("active", true).maybeSingle();
    if (staff) {
      await handleCsmMessage({
        supabase, msg, staff, openaiKey, downloadMedia,
        reply: (text: string) => reply(from, text, null),
      });
      return;
    }
    if (!publicBotEnabled) {
      await reply(from, UNKNOWN_SENDER_MSG, null);
      return;
    }
    await handlePublicMessage(msg);
    return;
  }
  if (!agent.active) {
    await reply(from, INACTIVE_AGENT_MSG, agent.id);
    return;
  }
  // הגייטינג נעשה כאן, לפני שההודעה מומרת לקלט ל-LLM: הבדיקה חייבת לקדום
  // לכל דבר שעולה כסף (Whisper, Claude, אחסון תמונה) ולכל דבר שכותב למסד.
  if (!TIER_ALLOWED.has(String(agent.tier))) {
    await reply(from, TIER_REQUIRED_MSG, agent.id);
    return;
  }
  if (agent.billing_status !== "active") {
    await reply(from, BILLING_INACTIVE_MSG, agent.id);
    return;
  }

  // שם המשרד נטען בשאילתה נפרדת ולא ב-embed‏ (agencies(name)): PostgREST מחזיר
  // ‏PGRST201 (HTTP 300) על embed מ-agency_members ל-agencies, ומפיל את **כל**
  // השאילתה — מה שהיה מפיל כאן את זיהוי הסוכן/ת לגמרי. ההסבר המלא (ומי הטבלה
  // שיוצרת את הדו-משמעות) ב-`_shared/agency-lookup.ts`.
  const agentRow = {
    ...agent,
    agencies: (await loadAgency(supabase, agent.agency_id, "name")) as
      | { name?: string }
      | null,
  };

  await supabase.from("whatsapp_messages")
    .update({ agent_id: agent.id })
    .eq("wa_message_id", msg.id);

  const conv = await loadConversation(agent.id, from);

  // --- המרת ההודעה לקלט טקסטואלי/ויזואלי ל-LLM ---
  const content: Anthropic.ContentBlockParam[] = [];
  let userText = "";
  let newImageUrl: string | null = null;

  switch (msg.type) {
    case "text":
      userText = forwardedPrefix(msg) + (msg.text?.body || "") +
        (await catalogLinksToText(String(msg.text?.body || ""), agent.id, from));
      break;

    case "contacts":
      userText = await contactsToText(msg.contacts, agent.id);
      if (!userText) {
        await reply(from, "קיבלתי כרטיס איש קשר, אבל לא היו בו שם או טלפון.", agent.id);
        return;
      }
      break;

    case "image": {
      try {
        newImageUrl = await storeImage(msg.image.id, agent.id);
      } catch (err) {
        console.error("image handling failed", err);
      }
      if (!newImageUrl) {
        await reply(from, "לא הצלחתי לשמור את התמונה. אפשר לנסות לשלוח אותה שוב?", agent.id);
        return;
      }
      userText = msg.image?.caption ? forwardedPrefix(msg) + msg.image.caption : "";
      break;
    }

    case "audio":
    case "voice":
    case "document": {
      // הודעה קולית (‏voice: true - הוקלטה בוואטסאפ) היא הוראה של הסוכן/ת,
      // ונכנסת כטקסט כמו תמיד. קובץ שמע (‏AUD-..., הקלטה ממקליט השיחות) או
      // מסמך הם תוכן של אחרים: הם נעטפים בסימון, והתור שקורא אותם רק מציע.
      // ‏media-intake.ts, ‏docs/whatsapp-setup.md "הקלטת שיחה ומסמכים".
      const media = msg.audio || msg.voice || msg.document || {};
      const fileName = String(msg.document?.filename || "").slice(0, 120);
      const caption = String(msg.document?.caption || "").trim();
      const forwarded = !!(msg.context?.forwarded || msg.context?.frequently_forwarded);
      const kind = msg.type === "document" ? docKind(String(media.mime_type || ""), fileName) : "audio";
      // ‏Meta מסמנת הודעה קולית ב-`audio.voice`. בלי השדה - לפי הסוג: הודעה
      // קולית של וואטסאפ היא תמיד ogg/opus, ומקליט שיחות שומר m4a/mp3/aac.
      // טעות לכיוון "הקלטת שיחה" הייתה מורידה כלי כתיבה מכל הוראה קולית.
      const voiceNote = msg.type === "voice" || (msg.type === "audio" && (
        media.voice === true ||
        (media.voice === undefined && /^audio\/(ogg|opus)/.test(String(media.mime_type || "")))
      ));

      let file: { bytes: Uint8Array; mimeType: string };
      try {
        file = await downloadMedia(media.id);
      } catch (err) {
        console.error("media download failed", err);
        await supabase.from("whatsapp_messages").update({ error: "media_download_failed" })
          .eq("wa_message_id", msg.id);
        await reply(from, "לא הצלחתי להוריד את הקובץ. אפשר לנסות לשלוח אותו שוב?", agent.id);
        return;
      }

      // תמונה שנשלחה כקובץ ולא כתמונה - אותו טיפול כמו תמונה רגילה.
      if (kind === "image") {
        newImageUrl = await storeImageBytes(file.bytes, file.mimeType, agent.id).catch(() => null);
        if (!newImageUrl) {
          await reply(from, "לא הצלחתי לשמור את התמונה. אפשר לנסות לשלוח אותה שוב?", agent.id);
          return;
        }
        userText = caption ? forwardedPrefix(msg) + caption : "";
        break;
      }

      let result: MediaResult;
      if (kind === "audio") {
        result = await transcribeMedia({
          supabase, openaiKey, agentId: agent.id, bytes: file.bytes, mime: file.mimeType,
          fileName, call: !voiceNote,
        });
      } else {
        result = await documentToText(file.bytes, file.mimeType, fileName);
      }
      if (!result.ok) {
        await supabase.from("whatsapp_messages").update({ error: result.error.slice(0, 200) })
          .eq("wa_message_id", msg.id);
        await reply(from, result.reply, agent.id);
        return;
      }

      if (kind === "audio" && voiceNote) {
        // הקלטה מועברת היא לרוב לקוח/ה שמתאר/ת מה מחפש/ת — הסימון הוא מה
        // שמבדיל אותה מהוראה קולית של הסוכן/ת עצמו/ה.
        userText = forwardedPrefix(msg) + result.text;
      } else if (kind === "audio") {
        userText = wrapRecording(result.text, fileName, forwarded) +
          (caption ? `\nהסוכן/ת כתב/ה עם הקובץ: ${caption}` : "");
      } else {
        userText = wrapDocument(result.text, fileName, caption, forwarded);
        // קובץ נכסים (Excel/CSV, כולל יד2): עותק לקליטה וסיכום יבש באותה ליבה
        // של האשף ב-CRM. אחרי "כן" הקובץ כבר אינו בשיחה (ההיסטוריה שומרת ממנו
        // 2,500 תווים), ולכן הקליטה עצמה רצה מהעותק (property-import.ts).
        if (kind === "sheet" || (kind === "text" && /\.(csv|tsv)$/i.test(fileName))) {
          const importBlock = await prepareImportJob(supabase, agent, file.bytes, fileName);
          if (importBlock) userText += "\n\n" + importBlock;
        }
      }
      // ביומן: התמלול (כמו בהודעה קולית), ומסמך - רק שמו. תוכן המסמך אינו
      // נשמר בשום מקום מעבר לתור.
      await supabase.from("whatsapp_messages")
        .update({ body: kind === "audio" ? result.text.slice(0, 20000) : `[מסמך] ${fileName || file.mimeType}` })
        .eq("wa_message_id", msg.id);
      break;
    }

    case "interactive": {
      // ‏"לנכס הקודם" / "נכס חדש" אחרי אלבום שפתח את השיחה (flushImageBatch)
      if (await photoButtonReply(agent.id, from, conv, String(msg.interactive?.button_reply?.id || ""))) {
        return;
      }
      // ‏"תצוגה מקדימה" / "נוסח להעתקה" אחרי פתיחת מיניסייט (agent.ts): המזהה
      // נושא את המיניסייט, והתשובה קבועה ובלי מודל.
      const sc = await showcaseButtonReply(
        supabase, agent.id, String(msg.interactive?.button_reply?.id || ""));
      if (sc) {
        if (sc.text) await reply(from, sc.text, agent.id);
        if (sc.outbox?.length) await sendOutbox(from, sc.outbox, agent.id);
        return;
      }
      // ‏"לשלוח בקשות תיאום לבעלים ולמתווכים?" (showing-coord.ts): המזהה נושא
      // את בקשת הסיור, והתשובה קבועה ובלי מודל.
      const coordReply = await coordOfferButtonReply(
        supabase, agent.id, String(msg.interactive?.button_reply?.id || ""));
      if (coordReply) {
        await reply(from, coordReply, agent.id);
        return;
      }
      // "להודיע על הביטול" אחרי cancel_showing (showing-actions.ts).
      const cancelNote = await showingCancelNotifyReply(
        supabase, agent.id, String(msg.interactive?.button_reply?.id || ""));
      if (cancelNote) {
        await reply(from, cancelNote, agent.id);
        return;
      }
      // כפתור של הצעת שת"פ/סרטון (property-offers.ts): המזהה נושא את הנכס,
      // והכותרת לבדה ("כן, לפתוח לשת״פ") אינה אומרת על איזה נכס עונים.
      const offer = await offerButtonReply(
        supabase, agent.id, String(msg.interactive?.button_reply?.id || ""));
      if (offer?.reply) {
        await reply(from, offer.reply, agent.id);
        return;
      }
      if (offer?.text) {
        userText = offer.text;
        if (offer.propertyId) conv.last_property_id = offer.propertyId;
        break;
      }
      userText = msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title || "";
      break;
    }

    case "button":
      userText = msg.button?.text || "";
      break;

    // ‏Meta שולחת הודעה מסוג unsupported לפני כל אלבום (24 מתוך 24 ב-30 יום,
    // כולן תוך 10 שניות מתמונה). התשובה "אני יודע לקבל טקסט, תמונות..." הגיעה
    // בדיוק כשהסוכן/ת שלח/ה תמונות - נשמעה כמו סירוב, והוסיפה הודעה לספירה
    // של הגבלת הקצב (131056). ההודעה כבר רשומה ב-whatsapp_messages.
    case "unsupported":
      return;

    default:
      await reply(
        from,
        "אני יודעת לקבל טקסט, תמונות, הודעות קוליות, הקלטות שיחה, מסמכים (PDF, ‏Word, ‏Excel) ואנשי קשר. " +
          "סרטונים אפשר להעלות מהדשבורד.",
        agent.id,
      );
      return;
  }

  // ‏**רצף = כמה בקשות מקבילות.** אלבום מגיע כתמונה להודעה, ומודעה מועברת
  // כתיאור, תמונות ו"מחיר X תפרסם" בהודעות נפרדות. כל הודעה מוסיפה את עצמה
  // לרצף וממתינה; בסוף החלון רק האחרונה (זו שהמספר שלה עדיין האחרון) מריצה
  // תור אחד על כל מה שנאסף. בלי זה כל טקסט הריץ תור משלו, והתשובות סתרו זו
  // את זו (22.9: "רק חסר מחיר" ו"חסר לי סוג הנכס" באותה שנייה).
  // ‏docs/whatsapp-setup.md, מיגרציות 20270115095000 ו-20270115099000.
  const replyLead = await loadReplyPrefix(supabase, agent.id, msg);
  if (replyLead) userText = replyLead + userText;

  const { data: mySeq, error: burstErr } = await supabase.rpc("whatsapp_burst_add", {
    p_agent_id: agent.id, p_phone: from, p_text: userText, p_image_url: newImageUrl,
  });
  if (burstErr) {
    console.error("burst add failed", burstErr);
    if (newImageUrl) {
      await reply(from, "לא הצלחתי לשמור את התמונה. אפשר לנסות לשלוח אותה שוב?", agent.id);
      return;
    }
    // טקסט בלי רצף: עדיף לענות עליו לבד מאשר לא לענות.
  } else {
    const typed = QUICK_BURST_TYPES.has(String(msg.type)) && !forwardedPrefix(msg) && !newImageUrl &&
      !(await freshPendingImages(agent.id)).length;
    const photo = msg.type === "image" && !forwardedPrefix(msg);
    await sleep(typed ? QUICK_BURST_WAIT_MS : photo ? IMAGE_BURST_WAIT_MS : BURST_WAIT_MS);
    const { data: nowSeq } = await supabase.rpc("whatsapp_burst_seq", { p_agent_id: agent.id });
    if (Number(nowSeq) !== Number(mySeq)) return; // הודעה מאוחרת יותר עונה על כל הרצף

    // השיחה נטענה לפני ההמתנה. תור קודם שהסתיים בינתיים כבר שמר היסטוריה,
    // ונכס שנוצר בו הוא "הנכס האחרון" - בלי טעינה מחדש, השמירה שלנו דורסת אותם.
    Object.assign(conv, await loadConversation(agent.id, from));
    const { data: texts } = await supabase.rpc("whatsapp_pending_texts_take", { p_agent_id: agent.id });
    userText = ((texts as string[]) || []).join("\n");
    conv.pending_images = await freshPendingImages(agent.id);

    if (!userText.trim()) {
      // רצף של תמונות בלבד: צירוף לנכס הפעיל, או שאלה לאיזה נכס.
      if (conv.pending_images.length) {
        await flushImageBatch(agent.id, from, conv, conv.pending_images.length);
      }
      return;
    }
    // התמונה שהמודל רואה: האחרונה ברצף (קודם - התמונה של ההודעה הנוכחית).
    newImageUrl = conv.pending_images[conv.pending_images.length - 1] || null;
  }

  // פריט מקטלוג וואטסאפ: התמונה שלו מצטרפת רק עכשיו, כשידוע כמה פריטים ברצף.
  const catalog = await attachCatalogImage(agent.id, from, conv, userText);
  if (catalog.image) newImageUrl = catalog.image;
  userText += catalog.note;

  if (!userText.trim()) {
    await saveConversation(agent.id, from, conv);
    return;
  }

  // אחרי טעינת השיחה מחדש: אחרת Object.assign מוחק את ההערה.
  conv.recent_note = await loadRecentPushesNote(supabase, agent.id);

  // התמונה של התור הנוכחי נשלחת למודל כדי שיוכל לשפר את התיאור
  // ("דירה משופצת עם מרפסת") מתוך מה שרואים בפועל
  if (newImageUrl) {
    content.push({ type: "image", source: { type: "url", url: newImageUrl } });
  }
  content.push({ type: "text", text: userText });

  conv.introduce = !(await assistantIntroduced(agent.id));
  const mediaTurn = hasMediaBlock(userText);

  // --- הפעלת ה-LLM ---
  let answer: string;
  const outbox: OutboxItem[] = [];
  try {
    answer = await runAgentTurn({
      supabase,
      agent: agentRow as unknown as AgentRow,
      conv,
      outbox,
      userContent: content,
      userSummary: (newImageUrl ? "[תמונה] " : "") + (mediaTurn ? mediaForHistory(userText) : userText),
      // תור שקורא הקלטה או מסמך רק מציע - ‏media-intake.ts
      ...(mediaTurn ? { allowedTools: MEDIA_TOOLS, deniedToolMessage: MEDIA_TOOLS_DENIED } : {}),
    });
  } catch (err) {
    console.error("agent turn failed", err);
    await supabase.from("whatsapp_messages")
      .update({ error: String((err as Error)?.message || err) })
      .eq("wa_message_id", msg.id);
    await replyAfterLlmFailure(from, agent.id, err, String(msg.id || ""));
    return;
  }

  await saveConversation(agent.id, from, conv);
  await reply(from, answer + (await profileNudge(agent.id, conv)), agent.id);
  if (outbox.length) await sendOutbox(from, outbox, agent.id);
}

/**
 * שורת תזכורת על פרופיל חסר, או מחרוזת ריקה.
 *
 * נכתבת בקוד ולא מבוקשת מהמודל: הוראה בפרומפט הייתה חוזרת בכל תשובה או
 * נשכחת, ואין דרך לדעת איזה מהשניים. כאן יש תקרה - פעם בשבוע
 * (‏`whatsapp_profile_nudge_claim`, אטומית) - ואין תזכורת בתור שבו הסוכן/ת
 * כבר עוסק/ת בפרופיל. הקריאה מחדש של הפרופיל היא **אחרי** התור, כדי שמה
 * שנשלח בו עצמו לא יוזכר כחסר.
 */
async function profileNudge(agentId: string, conv: ConversationState): Promise<string> {
  if (conv.profile_touched) return "";
  const gaps = profileGaps(await loadProfile(supabase, agentId));
  if (!gaps.length) return "";
  const { data: ok, error } = await supabase.rpc("whatsapp_profile_nudge_claim", { p_agent_id: agentId });
  if (error || !ok) return "";
  const example = gaps[0] === "תמונת פרופיל"
    ? "למשל תמונה שלך עם הכיתוב \"תמונת פרופיל\""
    : "למשל \"אני 12 שנה בתחום, מתמחה במגורים בעפולה\"";
  return `\n\n💡 בדף הסוכן/ת שלך באתר עדיין חסר: ${gaps.join(", ")}. ` +
    `אפשר פשוט לשלוח לי את זה כאן - ${example}.`;
}

/**
 * אירוע מסירה על הודעה **יוצאת** שלנו: sent → delivered → read, או failed.
 *
 * הדירוג והכתיבה נעשים ב-`record_whatsapp_status` במסד ולא כאן, כי האירועים
 * מגיעים בסדר לא מובטח — `delivered` אחרי `read` הוא מצב תקין ברשת איטית,
 * ובדיקה-ואז-עדכון משני שלבים בקוד הייתה מורידה הודעה שנקראה בחזרה
 * ל"נמסרה". שם זו שאילתה אחת אטומית.
 */
async function handleStatus(st: Record<string, any>): Promise<void> {
  const id: string | undefined = st?.id;
  const status: string | undefined = st?.status;
  if (!id || !status) return;

  // ‏timestamp מגיע כשניות (מחרוזת), לא כמילישניות
  const seconds = Number(st.timestamp);
  const at = Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;

  // הקוד והכותרת הם כל מה שמסביר למה הודעה לא הגיעה — בלעדיהם failed הוא
  // "נכשל" בלי סיבה, וזה לא שווה הרבה יותר משתיקה
  const err = Array.isArray(st.errors) ? st.errors[0] : null;
  const detail = err
    ? [err.code, err.title, err.message].filter(Boolean).join(" · ").slice(0, 300)
    : null;

  const { error } = await supabase.rpc("record_whatsapp_status", {
    p_wa_message_id: id,
    p_status: status,
    p_at: at,
    p_detail: detail,
  });
  if (error) console.error("status update failed", error);
}

async function handlePayload(payload: Record<string, any>): Promise<void> {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      // ‏Meta שולחת את שם הפרופיל בוואטסאפ לצד ההודעה (‏contacts[].profile.name),
      // לא בתוכה. הוא מוצמד להודעה כאן כדי שהבוט הציבורי יוכל לשמור חיפוש
      // בלחיצה אחת, בלי לעצור לשאול "איך קוראים לך?".
      const profileNames = new Map<string, string>();
      for (const c of change.value?.contacts || []) {
        const name = String(c?.profile?.name || "").trim();
        if (c?.wa_id && name) profileNames.set(String(c.wa_id), name);
      }
      for (const msg of change.value?.messages || []) {
        try {
          if (profileNames.has(msg.from)) msg._profile_name = profileNames.get(msg.from);
          await handleMessage(msg);
        } catch (err) {
          console.error("message handling failed", err);
          // גם כשל מחוץ ל-try של המודל לא משאיר את הפונה בלי תשובה.
          // סוכן/ת פעיל/ה מקבל/ת קישור לאזור האישי. לקוח/ה, בעלים, חותם/ת
          // וגולש/ת לא. כשל בשליחה כאן לא מונע טיפול ב-statuses שבהמשך.
          const from = String(msg?.from || "");
          if (!from) continue;
          try {
            const { data: who } = await supabase.from("agency_members")
              .select("id")
              .eq("phone_e164", from)
              .eq("active", true)
              .limit(1);
            const agentId = who?.[0]?.id ? String(who[0].id) : null;
            // בוט ציבורי כבוי: שולח/ת לא מוכר/ת לא מקבל/ת הודעת כשל.
            // ההודעה הקבועה יוצאת רק במסלול הרגיל, כמו קודם.
            if (!agentId && !publicBotEnabled) continue;
            await replyAfterLlmFailure(from, agentId, err, msg?.id ? String(msg.id) : null);
          } catch (sendErr) {
            console.error("llm failure reply failed", sendErr);
          }
        }
      }
      // ‏statuses מגיעים לאותו וובהוק. עד היום הם נזרקו, ולכן "נשלח" היה כל
      // מה שהיומן ידע לומר על הודעה יוצאת.
      for (const st of change.value?.statuses || []) {
        try {
          await handleStatus(st);
        } catch (err) {
          console.error("status handling failed", err);
        }
      }
    }
  }
}

// ‏waitUntil של ה-Edge Runtime - גלובלי של Supabase ש-deno check אינו מכיר
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

/** עבודה שממשיכה אחרי שהתשובה חזרה לקורא (Meta, או pg_cron). */
function inBackground(work: Promise<unknown>): void {
  EdgeRuntime.waitUntil(work);
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // אימות הוובהוק מול Meta בהגדרה הראשונית (וכל פעם שמעדכנים את הכתובת)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && verifyToken && token === verifyToken) {
      return new Response(challenge || "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // ‏קליטה מהמייל (‏docs/email-intake.md). ‏pg_cron קורא לאותה פונקציה ולא
  // לפונקציה נפרדת, כי המייל נכנס **לאותה שיחה**: אותו עוזר, אותה היסטוריה,
  // ואותה `reply` — והתשובה של הסוכן/ת בוואטסאפ ממשיכה ממנו. הקורא כאן אינו
  // Meta ואין לו חתימת HMAC, ולכן האימות הוא של הקוראים הפנימיים.
  // ‏הצעות של גבריאלה על נכס חדש - שת"פ וסרטון (‏property-offers.ts). אותו
  // אימות פנימי של קליטת המייל, מאותה סיבה: הקורא הוא pg_cron ולא Meta.
  if (url.searchParams.get("task") === "property-offers") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    inBackground(
      runPropertyOffers(supabase)
        .then((r) => console.log("property offers", JSON.stringify(r)))
        .catch((err) => console.error("property offers failed", err)),
    );
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ‏תיאום ביקור עם הבעלים והמתווכים (‏showing-coord.ts) - כל דקה, רק כשיש מה
  // לשלוח. אותו אימות פנימי.
  if (url.searchParams.get("task") === "showing-coord") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    inBackground(
      runShowingCoord(supabase)
        .then((r) => console.log("showing coord", JSON.stringify(r)))
        .catch((err) => console.error("showing coord failed", err)),
    );
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ‏שמירת המטמון של שני הבוטים בשעות היום (‏docs/platform-costs.md, "המטמון של
  // גבריאלה"). ‏pg_cron קורא כל 5 דקות, ורק כש-`ai_cache_warm_targets()` מחזירה
  // בוט שהמטמון שלו עומד לפוג; היא גם מה שנבדק כאן שוב, כדי שקריאה ידנית לא
  // תכתוב מטמון של שעה סתם.
  if (url.searchParams.get("task") === "cache-warm") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { data: targets, error } = await supabase.rpc("ai_cache_warm_targets");
    if (error) {
      console.error("cache warm targets failed", error.message);
      return new Response(JSON.stringify({ error: "targets_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const due = (targets ?? []) as string[];
    const warm = async (name: string, fn: () => Promise<Anthropic.Message>) => {
      try {
        const r = await fn();
        const u = r.usage as unknown as Record<string, number | undefined>;
        return { name, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 };
      } catch (err) {
        console.error("cache warm failed", name, err);
        return { name, error: String((err as Error).message || err).slice(0, 200) };
      }
    };
    const results = await Promise.all([
      ...(due.includes("gabriela_agent") ? [warm("gabriela_agent", warmPromptCache)] : []),
      ...(due.includes("gabriela_public") ? [warm("gabriela_public", warmPublicPromptCache)] : []),
    ]);
    console.log("cache warm", JSON.stringify(results));
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ‏התראות צוות ההטמעה (‏csm-notify.ts, ‏docs/csm-adoption.md) - pg_cron כל דקה,
  // רק כש-csm_notify_wa_ready(). אותו אימות פנימי.
  if (url.searchParams.get("task") === "csm-notify") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    inBackground(
      runCsmNotify(supabase)
        .then((r) => console.log("csm notify", JSON.stringify(r)))
        .catch((err) => console.error("csm notify failed", err)),
    );
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ‏העצה היומית מהמנטור לצוות ההטמעה (‏csm-notify.ts) - pg_cron כל 10 דקות, רק
  // כש-csm_mentor_tip_ready(). אותו אימות פנימי.
  if (url.searchParams.get("task") === "csm-mentor-tips") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    inBackground(
      runCsmMentorTips(supabase)
        .then((r) => console.log("csm mentor tips", JSON.stringify(r)))
        .catch((err) => console.error("csm mentor tips failed", err)),
    );
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.searchParams.get("task") === "email-intake") {
    const auth = authorizeInternalCaller(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error, detail: auth.detail }), {
        status: auth.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    inBackground(
      runEmailIntake({ supabase, reply, loadConversation, saveConversation })
        .then((r) => console.log("email intake", JSON.stringify(r)))
        .catch((err) => console.error("email intake failed", err)),
    );
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();

  if (!appSecret) {
    console.error("WHATSAPP_APP_SECRET is not configured - refusing to process");
    return new Response("misconfigured", { status: 500 });
  }
  const signatureOk = await verifySignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
    appSecret,
  );
  if (!signatureOk) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // גוף פגום לא ישתפר בניסיון חוזר — 200 כדי ש-Meta תפסיק לשלוח אותו
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  // ‏Meta מצפה ל-200 תוך שניות ספורות ומנסה שוב אחרת. סבב LLM + כלים לוקח
  // יותר מזה, לכן מאשרים מיד וממשיכים לעבד ברקע.
  inBackground(handlePayload(payload));

  return new Response("EVENT_RECEIVED", { status: 200 });
});
