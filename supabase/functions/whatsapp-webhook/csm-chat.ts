// ============================================================================
// csm-chat.ts — גבריאלה מול צוות ההטמעה (docs/csm-adoption.md, "בוואטסאפ")
//
// אשת צוות ההטמעה מזוהה לפי הטלפון ב-csm_staff (index.ts, אחרי שלא נמצא/ה
// סוכן/ת). **התור כאן נפרד לגמרי מהעוזרת של הסוכנים**: פרומפט משלו, היסטוריה
// משלו (csm_whatsapp_conversations) והכלים של csm-tools.ts בלבד. כך אין לה
// גישה לנכסים, ללקוחות, ללידים או לניהול הפלטפורמה, ו-TOOLS/SYSTEM_STATIC של
// הסוכנים - והמטמון המשותף שלהם - לא השתנו.
//
// שלושה סוגי הודעה:
//   טקסט / כפתור            → תור עם הכלים
//   הודעה קולית (voice)     → תמלול → תור, כמו טקסט
//   קובץ שמע (הקלטת שיחה)   → csm_calls + processCsmCall → סיכום, המלצות ושאלה
//                              עם מי השיחה (csm_link_call בתור הבא)
// ============================================================================
import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type BusyCheck, type SendToAgent, CSM_TOOLS, csmCapabilities, CSM_GREETING, isCapabilitiesQuestion, runCsmTool } from "./csm-tools.ts";
import { accessTokenForStaff, freeBusy, GCAL_FREEBUSY_SCOPE } from "../_shared/google-calendar.ts";
import { flattenTemplateParam } from "../_shared/wa-send.ts";
import { formatForWhatsapp, notifyTemplateConfigured, sendNotifyTemplate, sendText } from "./whatsapp.ts";
import { askCsmMentor } from "../_shared/coach/csm.ts";
import { audioExtOf, processCsmCall } from "../_shared/csm-call.ts";
import { callAnalysisText } from "../_shared/csm-call-format.ts";
import { transcribeMedia } from "./media-intake.ts";
import { anthropicRow, logAiUsage } from "../_shared/ai-usage.ts";

const MODEL = Deno.env.get("WHATSAPP_CSM_MODEL") || "claude-sonnet-5-5";
const MAX_TOOL_ITERATIONS = 6;
const HISTORY_KEEP = 16;

export type CsmStaff = { id: string; display_name: string | null };
type Msg = { role: "user" | "assistant"; content: string };

/* קבוע לגמרי - בלי שם, תאריך או מזהה - כדי שיישמר במטמון. מה שמשתנה יושב
   בהודעה הנוכחית. */
export const CSM_BOT_SYSTEM = `את גבריאלה, העוזרת בוואטסאפ של "שוק נדל״ן". את מדברת עכשיו עם מנהלת ההדרכות וההטמעה - צוות פנימי שמלווה סוכני נדל"ן ומשרדי תיווך בהטמעת המערכת. היא אינה סוכנת: אין לה נכסים, לקוחות או לידים, ואין לה ניהול של הפלטפורמה. את מדברת על עצמך בלשון נקבה ופונה אליה בלשון נקבה.

מה את עושה בשבילה, רק דרך הכלים:
- תמונת מצב: מי בסיכון (5 ימים ומעלה בלי הודעה לגבריאלה), למי לחזור היום, כמה בכל שלב - csm_overview.
- כרטיס סוכן/ת עם טלפון, מייל, משרד וכתובתו ורמת השימוש - csm_find_agent. משרד עם המנהלים וכל הסוכנים - csm_office. פרטי הקשר של הסוכנים מותרים לה, ותני אותם כשהיא מבקשת.
- העברת שלב בצנרת ומועד קשר - csm_set_stage. רישום פגישה או שיחת מעקב - csm_log_session. בקשת פיתוח שסוכן/ת העלה/תה - csm_add_feedback.
- הקלטות שיחה: היא שולחת קובץ שמע, והמערכת מתמללת ומסכמת לבד. ואם יש לה מספר וירטואלי - כל שיחה אליו מוקלטת, והסיכום וההקלטה נשלחים אליה מעצמם (התראה בסוגריים מרובעים עם call_id); סוכן/ת שהתקשר/ה מהנייד הרשום משויך/ת לבד, ומספר לא מוכר - לשאול עם מי ולשייך ב-csm_link_call. שיוך שיחה לסוכן/ת - csm_link_call; שיחות קודמות - csm_recent_calls.
- היומן שלה: מה יש לה היום או השבוע - csm_agenda_list; קביעת פגישה עם סוכן/ת או משרד - csm_agenda_add (כשיומן Google שלה מחובר - הפגישה עוברת לשם לבד, ואם השעה תפוסה ביומן האישי שלה - לציין; כשלא - הקישור "הוספה ליומן Google" בתשובה, והחיבור עצמו נעשה בהגדרות באזור ההטמעה); הזזה, ביטול או "התקיימה" - csm_agenda_update. "מחר", "ביום שלישי" - לפי התאריך שבהקשר. פגישה שהתקיימה עם סוכן/ת - להציע לרשום אותה (csm_log_session).
- ההתראות שלה (תזכורת לפני פגישה, סוכן/ת חדש/ה, 5 ימים בלי גבריאלה, הקלטה שהסתיימה, סיכום בוקר, ועצה מהמנטור כל בוקר) - csm_notifications. שאלת המשך על העצה של הבוקר - csm_ask_mentor. התראה שנשלחה אליה מופיעה בשיחה בסוגריים מרובעים.
- ההגדרות שלה - csm_settings: השם, התראות בוואטסאפ ואילו סוגים, שעת סיכום הבוקר, ימי עבודה, שעות שקט, אורך פגישה, כמה זמן לפני התזכורת, וקישור קבוע לפגישות וידאו. הנייד והמייל - רק באזור ההטמעה.
- ניסוח הודעה לסוכן/ת מהנתונים שלו/ה ("תכתבי ליוסי הודעה שמחזירה אותו", "הודעת תודה לדנה אחרי הפגישה") - csm_draft_message מחזיר את הנתונים וההנחיה למטרה; את כותבת טיוטה אחת קצרה לפי ההנחיה (בגוף ראשון שלה, עם פעולה אחת), ואז csm_send_to_agent לתצוגה ולאישור כרגיל.
- אחרי סיכום שיחה ("שלחי לו", "תשלחי לו את מה שהצעת") - csm_send_to_agent עם call_id (מההיסטוריה): ההודעה המוצעת מהניתוח והסוכן/ת שהשיחה משויכת אליו/ה. שיחה לא משויכת - קודם csm_link_call. גם כאן: תצוגה, אישור, ורק אז שליחה; שינוי שהיא מבקשת - message חדש.
- קישורים לסוכנים: מה הקישור למסך או לדף - csm_links (רשימה סגורה; קישור שאינו שם - אין). שליחה לסוכן/ת מהמספר שלך, בשמה - csm_send_to_agent: קודם בלי confirmed, להראות לה את הנוסח המדויק ולשאול "לשלוח?", ורק אחרי "כן" / "שלחי" מפורש על הנוסח הזה - שוב עם confirmed=true. שינוי בנוסח = תצוגה חדשה ואישור חדש. הודעה אחת לסוכן/ת אחד/ת; לא רצפים ולא תפוצה. למי שעוד לא במערכת (משרד שמגייסים, "תשלחי למשרד אלון את המסלולים, 052-...") - אותו כלי עם phone ו-name: הכלי מחזיר compose_url, קישור שפותח את הוואטסאפ שלה עם ההודעה מוכנה, ואת נותנת לה אותו כמו שהוא. זה לא נשלח מהמספר שלך, ולכן לא צריך את שלב האישור; רק דפים ציבוריים (המסלולים, הרשמת משרד, שאלות נפוצות) - לא מסכי CRM. המסלולים = link_key "pricing".
- שאלה מקצועית (עם מי להתחיל, איך לגשת למשרד, מה לענות על התנגדות, איך להחזיר מי שנשר/ה) - csm_ask_mentor, ואת מעבירה את התשובה כמו שהיא ופותחת במילים "המנטור עונה:".

כללים:
- לפני כלי שכותב (csm_set_stage, csm_log_session, csm_link_call, csm_agenda_add, csm_send_to_agent) על שם שמתאים ליותר מסוכן/ת אחד/ת - לשאול איזה/איזו. כשלא נמצא - לומר ולהציע חיפוש אחר, לא לנחש.
- אחרי כתיבה - משפט אחד שאומר מה נשמר.
- בקשה שאינה בתחום (נכסים, לקוחות, לידים, מסלולים, תשלומים, ניהול האתר) - להסביר בנימוס שזה מחוץ לכלים של אזור ההטמעה.
- לא ממציאים נתונים. מספר שלא חזר מכלי - לא נאמר.
- שאלה על מה אפשר לעשות כאן - לפרט את היכולות שלמעלה עם דוגמה לכל אחת.
- תשובות קצרות לוואטסאפ: שורות קצרות, רשימה עם "- ", הדגשה בכוכבית אחת. מקף רגיל בלבד, לעולם לא מקף ארוך. בלי טבלאות.`;

const MENTOR_ERRORS: Record<string, string> = {
  coach_ask_quota: "נגמרו השאלות למנטור ל-24 השעות האחרונות. אפשר לשאול שוב מחר.",
  bad_question: "צריך שאלה של כמה מילים לפחות.",
};

async function loadHistory(supabase: SupabaseClient, staffId: string): Promise<Msg[]> {
  const { data } = await supabase.from("csm_whatsapp_conversations").select("history").eq("staff_id", staffId).maybeSingle();
  return Array.isArray(data?.history) ? (data!.history as Msg[]).filter((m) => m && typeof m.content === "string") : [];
}

async function saveHistory(supabase: SupabaseClient, staffId: string, history: Msg[]) {
  // ההיסטוריה מתחילה תמיד בהודעה של המשתמשת - אחרת ה-API דוחה אותה
  let h = history.slice(-HISTORY_KEEP);
  while (h.length && h[0].role !== "user") h = h.slice(1);
  const { error } = await supabase.from("csm_whatsapp_conversations")
    .upsert({ staff_id: staffId, history: h, updated_at: new Date().toISOString() }, { onConflict: "staff_id" });
  if (error) console.error("csm history save failed", error.message);
}

export async function runCsmTurn(supabase: SupabaseClient, staff: CsmStaff, userText: string): Promise<string> {
  const history = await loadHistory(supabase, staff.id);
  const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const context = `[הקשר: ${staff.display_name ? "השולחת: " + staff.display_name + ". " : ""}עכשיו (שעון ישראל): ${now}.]`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: context + "\n" + userText },
  ];
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "" });
  const askMentor = async (q: unknown) => {
    const r = await askCsmMentor(supabase, staff.id, q, "whatsapp");
    return "error" in r
      ? { ok: false, error: r.error, message: MENTOR_ERRORS[r.error] || "המנטור לא זמין כרגע. אפשר לנסות שוב בעוד כמה דקות." }
      : { ok: true, answer: r.answer, remaining_24h: r.remaining };
  };

  // פנוי/תפוס מהיומן הראשי שלה ב-Google - רק עם חיבור פעיל והרשאת freebusy
  const busyCheck: BusyCheck = async (fromIso, toIso) => {
    const { data: conn } = await supabase.from("csm_calendar_connections")
      .select("status, scopes").eq("staff_id", staff.id).maybeSingle();
    if (conn?.status !== "active" || !(conn.scopes || []).includes(GCAL_FREEBUSY_SCOPE)) return null;
    const token = await accessTokenForStaff(supabase, staff.id);
    return token ? await freeBusy(token, fromIso, toIso) : null;
  };

  // הודעה לסוכן/ת מהמספר של גבריאלה (csm_send_to_agent). נרשמת ביומן ההודעות
  // ובהיסטוריה של העוזרת של הסוכן/ת - אחרת "תודה, איפה זה?" מגיע אליה בלי הקשר.
  const sendToAgent: SendToAgent = async (a) => {
    let waId: string | null = null;
    let error: string | undefined;
    try {
      if (a.inWindow) {
        waId = await sendText(a.phone, formatForWhatsapp(a.text));
      } else if (notifyTemplateConfigured()) {
        waId = await sendNotifyTemplate(a.phone, a.firstName, flattenTemplateParam(a.text, 900), a.path || "/crm");
      } else {
        throw new Error("הסוכן/ת לא כתב/ה לגבריאלה ב-24 השעות האחרונות, ותבנית ההתראות לא מוגדרת");
      }
    } catch (err) {
      error = String((err as Error)?.message || err).slice(0, 300);
    }
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waId, direction: "out", wa_phone: a.phone, agent_id: a.agentId,
      msg_type: a.inWindow ? "text" : "template", body: formatForWhatsapp(a.text),
      status: waId ? "sent" : null, error: error ?? null,
    });
    if (!error) {
      const { data } = await supabase.from("whatsapp_conversations").select("history").eq("agent_id", a.agentId).maybeSingle();
      if (data) {
        const history = Array.isArray(data.history) ? data.history : [];
        const next = [...history,
          { role: "user", content: "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: מנהלת ההטמעה שלחה לסוכן/ת הודעה דרך גבריאלה]" },
          { role: "assistant", content: formatForWhatsapp(a.text).slice(0, 3000) }].slice(-12);
        await supabase.from("whatsapp_conversations").update({ history: next }).eq("agent_id", a.agentId);
      }
    }
    return { ok: !error, waMessageId: waId, error };
  };

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: [{ type: "text", text: CSM_BOT_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: CSM_TOOLS,
      messages,
    });
    logAiUsage(anthropicRow("gabriela_csm", response.model || MODEL, response.usage));
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) finalText = text;
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length || response.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      let result: unknown;
      try {
        result = await runCsmTool(supabase, staff, use.name, (use.input ?? {}) as Record<string, unknown>, askMentor, busyCheck, sendToAgent);
      } catch (err) {
        console.error(`csm tool ${use.name} threw`, err);
        result = { ok: false, error: String((err as Error)?.message || err) };
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result).slice(0, 60000) });
    }
    messages.push({ role: "user", content: results });
  }
  if (!finalText) finalText = "לא הצלחתי להשלים את הבקשה. אפשר לנסח אותה שוב?";
  await saveHistory(supabase, staff.id, [...history, { role: "user", content: userText }, { role: "assistant", content: finalText }]);
  return finalText;
}

/* ההודעה הנכנסת. ‏reply ו-downloadMedia מגיעים מ-index.ts, שרושם ביומן. */
export async function handleCsmMessage(opts: {
  supabase: SupabaseClient;
  // deno-lint-ignore no-explicit-any
  msg: Record<string, any>;
  staff: CsmStaff;
  openaiKey: string;
  reply: (text: string) => Promise<void>;
  downloadMedia: (id: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
}): Promise<void> {
  const { supabase, msg, staff, reply } = opts;
  let userText = "";
  // חלון 24 השעות של Meta: ההתראות (csm-notify.ts) נשלחות כטקסט רק בתוכו
  const { error: winErr } = await supabase.from("csm_whatsapp_conversations")
    .upsert({ staff_id: staff.id, last_inbound_at: new Date().toISOString() }, { onConflict: "staff_id" });
  if (winErr) console.error("csm inbound mark failed", winErr.message);

  switch (msg.type) {
    case "text":
      userText = String(msg.text?.body || "");
      break;
    case "interactive":
      userText = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
      break;
    case "button":
      userText = msg.button?.text || "";
      break;
    case "audio":
    case "voice":
    case "document": {
      const media = msg.audio || msg.voice || msg.document || {};
      const mime = String(media.mime_type || "");
      const fileName = String(msg.document?.filename || "").slice(0, 120);
      const isAudio = msg.type !== "document" || /^audio\//.test(mime) || /\.(m4a|mp3|aac|ogg|opus|wav|amr|3gp|webm)$/i.test(fileName);
      if (!isAudio) {
        await reply("כאן אני מקבלת הודעות, הודעות קוליות והקלטות שיחה. מסמכים אחרים - דרך אזור ההטמעה.");
        return;
      }
      // אותה הבחנה של העוזרת של הסוכנים (index.ts): הודעה קולית היא הוראה,
      // קובץ שמע הוא הקלטת שיחה
      const voiceNote = msg.type === "voice" || (msg.type === "audio" && (
        media.voice === true || (media.voice === undefined && /^audio\/(ogg|opus)/.test(mime))));
      let file: { bytes: Uint8Array; mimeType: string };
      try {
        file = await opts.downloadMedia(media.id);
      } catch (err) {
        console.error("csm media download failed", err);
        await reply("לא הצלחתי להוריד את הקובץ. אפשר לשלוח אותו שוב?");
        return;
      }

      if (voiceNote) {
        const r = await transcribeMedia({
          supabase, openaiKey: opts.openaiKey, agentId: "", bytes: file.bytes, mime: file.mimeType, call: false,
        });
        if (!r.ok) {
          await reply("לא הצלחתי לשמוע את ההודעה. אפשר לכתוב אותה?");
          return;
        }
        userText = r.text;
        await supabase.from("whatsapp_messages").update({ body: r.text }).eq("wa_message_id", msg.id);
        break;
      }

      // הקלטת שיחה: נשמרת, מתומללת ומנותחת - ואז שאלה עם מי היא הייתה
      const ext = audioExtOf(fileName, file.mimeType);
      const path = `wa/${staff.id}/${msg.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from("csm-calls")
        .upload(path, file.bytes, { contentType: file.mimeType || "audio/mpeg", upsert: true });
      if (upErr) {
        console.error("csm recording upload failed", upErr.message);
        await reply("לא הצלחתי לשמור את ההקלטה. אפשר לשלוח אותה שוב?");
        return;
      }
      const { data: call, error: insErr } = await supabase.from("csm_calls").insert({
        staff_id: staff.id, source: "whatsapp", audio_path: path,
        title: fileName || String(msg.audio?.caption || msg.document?.caption || "").slice(0, 200) || "הקלטה מוואטסאפ",
      }).select("id").single();
      if (insErr || !call) {
        await reply("לא הצלחתי לרשום את ההקלטה. אפשר לשלוח אותה שוב?");
        return;
      }
      await reply("קיבלתי את ההקלטה. מתמללת ומסכמת - זה לוקח דקה-שתיים.");
      const res = await processCsmCall(supabase, call.id as string);
      if (!res.ok) {
        await reply(res.error);
        return;
      }
      const text = callAnalysisText(res.analysis) +
        "\n\nעם מי הייתה השיחה? כתבי את השם, ואשייך אותה ואעדכן את מועד הקשר. אחרי זה אפשר לכתוב \"שלחי לו\" ואשלח את ההודעה המוצעת (אחרי שתאשרי). הניתוח המלא גם באזור ההטמעה.";
      await reply(text);
      // התור הבא צריך לדעת על איזו שיחה מדובר
      const history = await loadHistory(supabase, staff.id);
      await saveHistory(supabase, staff.id, [
        ...history,
        { role: "user", content: `[שלחתי הקלטת שיחה. call_id=${call.id}]` },
        { role: "assistant", content: text },
      ]);
      return;
    }
    default:
      await reply("כאן אני מקבלת הודעות, הודעות קוליות והקלטות שיחה.");
      return;
  }

  if (!userText.trim()) return;

  // ההיכרות: בהודעה הראשונה שלה (היסטוריה ריקה), ותמיד כשהיא שואלת מה אפשר
  const history = await loadHistory(supabase, staff.id);
  const first = history.length === 0;
  if (first || isCapabilitiesQuestion(userText)) {
    const intro = csmCapabilities(staff.display_name, first);
    await reply(intro);
    await saveHistory(supabase, staff.id, [...history, { role: "user", content: userText }, { role: "assistant", content: intro }]);
    // ברכה או שאלה על היכולות - ההיכרות היא התשובה. בקשה אמיתית - ממשיכים אליה
    if (isCapabilitiesQuestion(userText) || CSM_GREETING.test(userText.trim())) return;
  }
  let answer: string;
  try {
    answer = await runCsmTurn(supabase, staff, userText);
  } catch (err) {
    console.error("csm turn failed", err);
    answer = "משהו השתבש אצלי. אפשר לנסות שוב בעוד דקה?";
  }
  await reply(answer);
}
