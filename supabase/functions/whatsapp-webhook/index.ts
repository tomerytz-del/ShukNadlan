import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { downloadMedia, markReadAndTyping, sendText, verifySignature } from "./whatsapp.ts";
import { type AgentRow, type ConversationState, runAgentTurn } from "./agent.ts";
import { type PublicConversationState, runPublicTurn } from "./public-agent.ts";
import { loadAgency } from "../_shared/agency-lookup.ts";

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
const TIER_REQUIRED_MSG =
  "הסוכן העוזר בוואטסאפ זמין במסלולים PROFESSIONAL ו-Elite. " +
  "במסלול Pay&GO אפשר להוסיף ולעדכן נכסים ישירות באיזור הסוכנים. " +
  "לפרטים ולשדרוג: https://shuknadlan.co.il/pricing.html";

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
    body: msg.text?.body || msg.image?.caption || null,
  });
  if (error) {
    if (error.code === "23505") return false; // כבר טופלה
    console.error("inbound log failed", error);
  }
  return true;
}

async function reply(
  to: string,
  body: string,
  agentId: string | null,
): Promise<void> {
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
  const { error } = await supabase.from("whatsapp_conversations").upsert({
    agent_id: agentId,
    wa_phone: phone,
    history: conv.history,
    pending_images: conv.pending_images,
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
        "אני יודע לקרוא הודעות טקסט והקלטות קוליות. מה מחפשים? (למשל: " +
          "\"3 חדרים בעפולה עד מיליון ושלוש\")",
        null,
      );
      return;
  }

  if (!userText.trim()) return;

  const conv = await loadPublicConversation(from);

  let answer: string;
  try {
    answer = await runPublicTurn({ supabase, conv, userText, waPhone: from });
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
  await reply(from, answer, null);
}

// ---------------------------------------------------------------------------
// טיפול בהודעה בודדת
// ---------------------------------------------------------------------------
async function handleMessage(msg: Record<string, any>): Promise<void> {
  const from: string = msg.from;
  if (!from || !msg.id) return;

  if (!(await logInbound(msg))) return; // משלוח חוזר של Meta — כבר טופל
  markReadAndTyping(msg.id);

  // --- זיהוי הסוכן/ת לפי מספר הטלפון ---
  // phone_e164 היא עמודה מחושבת שמנרמלת את agency_members.phone לאותו פורמט
  // ש-Meta שולחת ב-from, כך שההשוואה היא שוויון פשוט ומאונדקס.
  const { data: agent } = await supabase
    .from("agency_members")
    .select("id, agency_id, display_name, tier, active")
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
      userText = msg.text?.body || "";
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
      conv.pending_images = [...conv.pending_images, newImageUrl];
      userText = msg.image?.caption || "";
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

    default:
      await reply(
        from,
        "אני יודע לקבל טקסט, תמונות והקלטות קוליות. מסמכים וסרטונים אפשר להעלות מהדשבורד.",
        agent.id,
      );
      return;
  }

  // תמונה בלי כיתוב: וואטסאפ שולחת אלבום כהודעות נפרדות, והכיתוב מגיע רק על
  // אחת מהן. הרצת ה-LLM על כל תמונה בנפרד הייתה מייצרת נכס כפול והצפת תשובות.
  // לכן: אם יש נכס פעיל בשיחה — מצרפים אליו מיד; אחרת שומרים בצד בשקט
  // וממתינים להודעת הטקסט שתגיע איתן.
  if (newImageUrl && !userText.trim()) {
    if (conv.last_property_id) {
      const { data: property } = await supabase
        .from("properties")
        .select("id, title, images")
        .eq("id", conv.last_property_id)
        .eq("agent_id", agent.id)
        .maybeSingle();

      if (property) {
        const merged = [...(property.images || []), ...conv.pending_images];
        await supabase.from("properties")
          .update({ images: merged, updated_at: new Date().toISOString() })
          .eq("id", property.id)
          .eq("agent_id", agent.id);
        conv.pending_images = [];
        await saveConversation(agent.id, from, conv);
        await reply(from, `📸 התמונה נוספה ל"${property.title}".`, agent.id);
        return;
      }
    }
    await saveConversation(agent.id, from, conv);
    return; // ממתינים לטקסט המלווה, בלי להציף את הסוכן/ת בתשובות
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
  await reply(from, answer, agent.id);
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
  EdgeRuntime.waitUntil(handlePayload(payload));

  return new Response("EVENT_RECEIVED", { status: 200 });
});
