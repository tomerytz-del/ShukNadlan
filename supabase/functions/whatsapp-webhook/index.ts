import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import { downloadMedia, markReadAndTyping, sendText, verifySignature } from "./whatsapp.ts";
import { type AgentRow, type ConversationState, runAgentTurn } from "./agent.ts";

// ============================================================================
// ‏Webhook של Meta WhatsApp Cloud API.
//
// ‏verify_jwt = false: את הפונקציה קוראת Meta, לא הדפדפן, ואין לה JWT של
// Supabase. האימות היחיד הוא חתימת HMAC ‏(X-Hub-Signature-256) מול ה-App
// Secret — בלעדיה כל מי שיודע את הכתובת יכול להתחזות לסוכן/ת.
//
// זרימה: אימות חתימה -> 200 מיידי ל-Meta -> עיבוד ברקע (זיהוי סוכן/ת,
// תמלול/תמונות, LLM עם כלים, תשובה חזרה בוואטסאפ).
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
    await sendText(to, body);
    await supabase.from("whatsapp_messages").insert({
      direction: "out",
      wa_phone: to,
      agent_id: agentId,
      msg_type: "text",
      body,
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
    .select("history, pending_images, last_property_id")
    .eq("agent_id", agentId)
    .maybeSingle();

  return {
    history: (data?.history as Anthropic.MessageParam[]) || [],
    pending_images: data?.pending_images || [],
    last_property_id: data?.last_property_id || null,
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
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_id" });
  if (error) console.error("conversation save failed", error);
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
    .select("id, agency_id, display_name, tier, active, agencies(name)")
    .eq("phone_e164", from)
    .maybeSingle();

  if (!agent) {
    await reply(from, UNKNOWN_SENDER_MSG, null);
    return;
  }
  if (!agent.active) {
    await reply(from, INACTIVE_AGENT_MSG, agent.id);
    return;
  }

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
      agent: agent as unknown as AgentRow,
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

async function handlePayload(payload: Record<string, any>): Promise<void> {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      // ‏statuses (נמסר/נקרא) מגיעים לאותו וובהוק ואין מה לעשות איתם
      for (const msg of change.value?.messages || []) {
        try {
          await handleMessage(msg);
        } catch (err) {
          console.error("message handling failed", err);
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
    console.error("WHATSAPP_APP_SECRET is not configured — refusing to process");
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
