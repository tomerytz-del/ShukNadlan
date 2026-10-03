import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import {
  downloadMedia,
  formatForWhatsapp,
  markReadAndTyping,
  sendContactCard,
  sendText,
  verifySignature,
} from "./whatsapp.ts";
import {
  type AgentRow,
  type ConversationState,
  loadProfile,
  profileGaps,
  runAgentTurn,
} from "./agent.ts";
import { type PublicConversationState, runPublicTurn } from "./public-agent.ts";
import { loadAgency } from "../_shared/agency-lookup.ts";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { runEmailIntake } from "./email-intake.ts";
import { handleWaSignVerify } from "../_shared/agreement-wa-verify.ts";

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
  }
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

// ---------------------------------------------------------------------------
// מדיה
// ---------------------------------------------------------------------------

/** מורידה תמונה מוואטסאפ, מעלה ל-Storage ומחזירה URL ציבורי (או null). */
async function storeImage(mediaId: string, agentId: string): Promise<string | null> {
  const { bytes, mimeType } = await downloadMedia(mediaId);

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

/** מתמללת הקלטה קולית דרך OpenAI Whisper. מחזירה null אם אין מפתח/נכשל. */
async function transcribeAudio(mediaId: string): Promise<string | null> {
  if (!openaiKey) return null;

  try {
    const { bytes, mimeType } = await downloadMedia(mediaId);
    // הקלטות וואטסאפ מגיעות כ-audio/ogg (קודק opus) — Whisper תומך בזה
    const ext = mimeType.includes("mpeg") ? "mp3" : mimeType.includes("mp4") ? "m4a" : "ogg";

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), `voice.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "he");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error("whisper failed", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return (data.text || "").trim() || null;
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
  const { data } = await supabase
    .from("whatsapp_public_conversations")
    .select("history, last_property_id, last_message_at, leads_created, leads_window_start")
    .eq("wa_phone", phone)
    .maybeSingle();

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
    leads_created: data?.leads_created || 0,
    leads_window_start: data?.leads_window_start || null,
  };
}

async function savePublicConversation(
  phone: string,
  conv: PublicConversationState,
): Promise<void> {
  const { error } = await supabase.from("whatsapp_public_conversations").upsert({
    wa_phone: phone,
    history: conv.history,
    last_property_id: conv.last_property_id,
    leads_created: conv.leads_created,
    leads_window_start: conv.leads_window_start,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "wa_phone" });
  if (error) console.error("public conversation save failed", error);
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
        await reply(from, "לא הצלחתי לשמוע את ההקלטה. אפשר לכתוב לי מה מחפשים?", null);
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

  let answer: string;
  let searched = false;
  try {
    ({ text: answer, searched } = await runPublicTurn({ supabase, conv, userText, waPhone: from }));
  } catch (err) {
    console.error("public turn failed", err);
    await supabase.from("whatsapp_messages")
      .update({ error: String((err as Error)?.message || err) })
      .eq("wa_message_id", msg.id);
    // נשמר גם בכשל: אם הכלי הספיק לפתוח ליד לפני שהתור נפל, המונה שלו כבר
    // עלה — ותקרה שנשכחת בכל שגיאה אינה תקרה.
    await savePublicConversation(from, conv);
    await reply(from, "משהו השתבש אצלי כרגע. אפשר לנסות שוב בעוד רגע.", null);
    return;
  }

  await savePublicConversation(from, conv);
  // ריק = התור נגמר בהודעת כפתורים שכבר נשלחה (offer_save_search)
  if (answer) await reply(from, answer, null);

  // ההצעה לשמור את גבריאלה באנשי הקשר - אחרי תור עם חיפוש, ולא באותו תור
  // שבו נשלחו הכפתורים: הכרטיס היה דוחף אותם למעלה, רגע לפני שלוחצים.
  if (searched && answer) await maybeShareContactCard(from);
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function freshPendingImages(agentId: string): Promise<string[]> {
  const { data } = await supabase.from("whatsapp_conversations")
    .select("pending_images").eq("agent_id", agentId).maybeSingle();
  return (data?.pending_images as string[]) || [];
}

/**
 * התמונה האחרונה באלבום: צירוף לנכס הפעיל בשיחה, או שאלה לאיזה נכס.
 *
 * ‏**אף פעם לא שתיקה.** עד כאן, בלי נכס פעיל, התמונות נשמרו בצד בלי מילה
 * (7 תמונות ב-20.9 לא קיבלו שום תשובה), והסוכן/ת לא ידע/ה אם הן הגיעו.
 */
async function flushImageBatch(
  agentId: string,
  from: string,
  conv: ConversationState,
  count: number,
): Promise<void> {
  const what = count === 1 ? "תמונה אחת" : `${count} תמונות`;

  if (conv.last_property_id) {
    const { data: property } = await supabase.from("properties")
      .select("id, title").eq("id", conv.last_property_id).eq("agent_id", agentId).maybeSingle();

    if (property) {
      const { data: taken } = await supabase.rpc("whatsapp_pending_images_take", { p_agent_id: agentId });
      const urls = (taken as string[]) || [];
      if (!urls.length) return; // טקסט מקביל כבר לקח אותן, והוא עונה עליהן
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
        return;
      }
      const added = urls.length === 1 ? "נוספה תמונה אחת" : `נוספו ${urls.length} תמונות`;
      await reply(from, `📸 ${added} ל"${property.title}" (${total} בסך הכול).`, agentId);
      return;
    }
  }

  await reply(
    from,
    `📸 קיבלתי ${what}. לאיזה נכס לצרף? אפשר לכתוב כתובת או מספר מודעה, ` +
      "או לכתוב את פרטי נכס חדש (סוג, עסקה ומחיר) ואפתח אותו עם התמונות. " +
      "תמונה שלך? כתוב/כתבי \"תמונת פרופיל\" או \"תמונת נושא\".",
    agentId,
  );
}

async function handleMessage(msg: Record<string, any>): Promise<void> {
  const from: string = msg.from;
  if (!from || !msg.id) return;

  if (!(await logInbound(msg))) return; // משלוח חוזר של Meta — כבר טופל
  markReadAndTyping(msg.id);

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

  // --- זיהוי הסוכן/ת לפי מספר הטלפון ---
  // phone_e164 היא עמודה מחושבת שמנרמלת את agency_members.phone לאותו פורמט
  // ש-Meta שולחת ב-from, כך שההשוואה היא שוויון פשוט ומאונדקס.
  const { data: agent } = await supabase
    .from("agency_members")
    .select("id, agency_id, display_name, tier, active, billing_status")
    .eq("phone_e164", from)
    .maybeSingle();

  if (!agent) {
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
      userText = forwardedPrefix(msg) + (msg.text?.body || "");
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
    case "voice": {
      const media = msg.audio || msg.voice;
      const transcript = await transcribeAudio(media.id);
      if (!transcript) {
        await supabase.from("whatsapp_messages")
          .update({ error: "transcription_failed" })
          .eq("wa_message_id", msg.id);
        await reply(
          from,
          openaiKey
            ? "לא הצלחתי לתמלל את ההקלטה. אפשר לשלוח את הפרטים כטקסט?"
            : "תמלול הקלטות עדיין לא מופעל אצלנו. אפשר לשלוח את הפרטים כטקסט?",
          agent.id,
        );
        return;
      }
      // הקלטה מועברת היא לרוב לקוח/ה שמתאר/ת מה מחפש/ת — הסימון הוא מה
      // שמבדיל אותה מהוראה קולית של הסוכן/ת עצמו/ה.
      userText = forwardedPrefix(msg) + transcript;
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

    // ‏Meta שולחת הודעה מסוג unsupported לפני כל אלבום (24 מתוך 24 ב-30 יום,
    // כולן תוך 10 שניות מתמונה). התשובה "אני יודע לקבל טקסט, תמונות..." הגיעה
    // בדיוק כשהסוכן/ת שלח/ה תמונות - נשמעה כמו סירוב, והוסיפה הודעה לספירה
    // של הגבלת הקצב (131056). ההודעה כבר רשומה ב-whatsapp_messages.
    case "unsupported":
      return;

    default:
      await reply(
        from,
        "אני יודעת לקבל טקסט, תמונות, הקלטות קוליות ואנשי קשר. מסמכים וסרטונים אפשר להעלות מהדשבורד.",
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
    await sleep(BURST_WAIT_MS);
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

  if (!userText.trim()) {
    await saveConversation(agent.id, from, conv);
    return;
  }

  // התמונה של התור הנוכחי נשלחת למודל כדי שיוכל לשפר את התיאור
  // ("דירה משופצת עם מרפסת") מתוך מה שרואים בפועל
  if (newImageUrl) {
    content.push({ type: "image", source: { type: "url", url: newImageUrl } });
  }
  content.push({ type: "text", text: userText });

  conv.introduce = !(await assistantIntroduced(agent.id));

  // --- הפעלת ה-LLM ---
  let answer: string;
  try {
    answer = await runAgentTurn({
      supabase,
      agent: agentRow as unknown as AgentRow,
      conv,
      userContent: content,
      userSummary: newImageUrl ? `[תמונה] ${userText}` : userText,
    });
  } catch (err) {
    console.error("agent turn failed", err);
    await supabase.from("whatsapp_messages")
      .update({ error: String((err as Error)?.message || err) })
      .eq("wa_message_id", msg.id);
    await reply(from, "משהו השתבש אצלי כרגע. אפשר לנסות שוב בעוד רגע.", agent.id);
    return;
  }

  await saveConversation(agent.id, from, conv);
  await reply(from, answer + (await profileNudge(agent.id, conv)), agent.id);
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
      for (const msg of change.value?.messages || []) {
        try {
          await handleMessage(msg);
        } catch (err) {
          console.error("message handling failed", err);
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
