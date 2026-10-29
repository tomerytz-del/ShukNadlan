// שאלה תפעולית לסוכן/ת אחד/ת, מתוך whatsapp-webhook?task=ops-question.
//
// רק service_role. אין טקסט חופשי: הקורא שולח purpose ו-agent_member_id,
// והנוסח והכפתורים באים מרשימה סגורה בקוד. רק בתוך 24 שעות מההודעה
// הנכנסת האחרונה. אותו שער מסלול כמו העוזרת (פעיל, חיוב פעיל, mid/premium).
//
// מזהה הכפתור הוא ops_q:<purpose>:<n>. לחיצה נתפסת לפני המודל. נרשמת
// רק אם השאלה נשלחה לסוכן/ת הזה/ו והמזהה ברשימת הכפתורים. אחרת היומן
// הוא unmatched בלי לשייך את השולח/ת.

export const OPS_Q_PREFIX = "ops_q:";
export const OPS_TAP_REPLY = "תודה, העברתי לבדיקה";
export const OPS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OPS_AGENT_DAILY_CAP = 1;
export const OPS_GLOBAL_DAILY_CAP = 5;

/** השער של העוזרת, של המייל ושל פעולה מהסיכום. השם נקרא ב-check_tier_gates. */
export const TIER_ALLOWED = new Set(["mid", "premium"]);

export const OPS_HISTORY_NOTE =
  "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: נשלחה אליך שאלה עם כפתורים. " +
  "לחיצה על כפתור כבר טופלה, ואין להגיב עליה ואין לבצע פעולה.]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPS_ID_RE = /^ops_q:([A-Za-z0-9_-]{1,40}):(\d{1,2})$/;
const MAX_TITLE = 20;

export interface OpsButton {
  id: string;
  title: string;
}

export interface OpsQuestion {
  body: string;
  buttons: readonly string[];
  followup: { body: string; buttons: readonly string[] };
  /** רשימה סגורה. ריקה = אף אחד/ת לא מקבל/ת את השאלה. */
  allowedAgentIds: readonly string[];
}

export const OPS_QUESTIONS: Record<string, OpsQuestion> = {
  shai_dup_warehouse_2026_10: {
    body: "היי שי, שמתי לב שיש אצלך שלושה מרלו\"גים של 4,800 מ\"ר להשכרה באותה נקודה במפה: שניים עם תקרה של 13 מטר (ב-65 ₪ וב-68 ₪ למ\"ר) ואחד עם תקרה של 9 מטר (ב-65 ₪ למ\"ר). זה אותו נכס שעלה כמה פעמים?",
    buttons: ["כולם אותו נכס", "13 ו-9 מ' שונים", "שלושה נכסים שונים"],
    followup: {
      body: "ועוד דבר קטן: שייכנו את ששת הנכסים שלך באזור השרון לנתניה, ואת נכס 1306 לגדרה, כדי שיופיעו בחיפוש לפי עיר. זה נכון?",
      buttons: ["נכון", "צריך לתקן"],
    },
    allowedAgentIds: ["83d91018-29f0-477c-9088-9ecabc3237f8"],
  },
};

for (const [purpose, q] of Object.entries(OPS_QUESTIONS)) {
  for (const title of [...q.buttons, ...q.followup.buttons]) {
    if (title.length < 1 || title.length > MAX_TITLE) {
      throw new Error(`ops button title length ${title.length} for ${purpose}`);
    }
  }
}

export interface OpsAgent {
  id: string;
  tier: string | null;
  phone: string | null;
  active: boolean;
  billing_status: string | null;
}

export interface OpsClaim {
  agentId: string;
  purpose: string;
  body: string;
  buttonIds: string[];
  followupBody: string | null;
  followupButtonIds: string[] | null;
  retry: boolean;
}

export interface OpsOutbound {
  agentId: string;
  phone: string;
  waMessageId: string | null;
  body: string;
  error: string | null;
}

export interface OpsQuestionDb {
  getAgent(id: string): Promise<OpsAgent | null>;
  /** כיבוי מלא של ערוץ הוואטסאפ (notification_push_opt_out). */
  whatsappOff(agentId: string): Promise<boolean>;
  lastInboundAt(phone: string): Promise<string | null>;
  claim(row: OpsClaim): Promise<string>;
  /** מזהי הודעות שכבר יצאו, לפי סדר (הודעה ראשונה, ואז השנייה). */
  priorWaIds(agentId: string, purpose: string): Promise<string[]>;
  markSent(
    agentId: string,
    purpose: string,
    waIds: string[],
    status: "sent" | "failed",
    error: string | null,
  ): Promise<void>;
  appendHistory(agentId: string, phone: string, lastInbound: string, assistantText: string): Promise<void>;
  logOutbound(row: OpsOutbound): Promise<void>;
}

export interface OpsAnswer {
  agent_id: string | null;
  purpose: string;
  button_id: string;
  button_title: string;
  answered_at: string;
}

export interface OpsTapDb {
  agentIdByPhone(phone: string): Promise<string | null>;
  /** השאלה נשלחה (status=sent) לסוכן/ת הזה/ו, והמזהה באחד ממערכי הכפתורים. */
  sentButton(agentId: string, purpose: string, buttonId: string): Promise<boolean>;
  insertAnswer(row: OpsAnswer): Promise<void>;
}

export interface OpsResult {
  status: number;
  body: Record<string, unknown>;
}

type Normalized = {
  agentId: string;
  purpose: string;
  retry: boolean;
  messages: { body: string; buttons: OpsButton[] }[];
};

/** אותו שער כמו העוזרת: חשבון פעיל, חיוב פעיל, מסלול mid או premium. */
export function whatsappAgentBlock(agent: {
  active: boolean;
  tier: string | null;
  billing_status: string | null;
}): "inactive" | "free_plan" | "billing_inactive" | null {
  if (!agent.active) return "inactive";
  if (!TIER_ALLOWED.has(String(agent.tier ?? ""))) return "free_plan";
  if (agent.billing_status !== "active") return "billing_inactive";
  return null;
}

/**
 * כיבוי מלא אחרי notification_push_opt_out: whatsapp_types מתרוקן וגם
 * whatsapp_off_types מקבל את כל הסוגים. מערך whatsapp_types ריק לבדו הוא
 * ברירת המחדל הדלוקה מאז 20270303090000, ולכן אינו כיבוי.
 * כיבוי של סוג אחד (רשימת off חלקית) אינו כיבוי הערוץ.
 */
export function whatsappFullyOptedOut(
  prefs: { whatsapp_types: string[] | null; whatsapp_off_types: string[] | null } | null,
  knownTypes: string[] | null,
): boolean {
  if (!prefs) return false;
  const on = prefs.whatsapp_types ?? [];
  const off = prefs.whatsapp_off_types ?? [];
  if (on.length !== 0 || off.length === 0) return false;
  const known = knownTypes ?? [];
  // רשימת הסוגים חסרה: אי אפשר להבדיל כיבוי מלא מכיבוי חלקי. לא שולחים.
  if (!known.length) return true;
  const set = new Set(off);
  return known.every((t) => set.has(t));
}

/** חלון פתוח רק כשההודעה הנכנסת האחרונה צעירה מ-24 שעות. */
export function customerWindowOpen(lastInboundIso: string | null, now: number): boolean {
  if (!lastInboundIso) return false;
  const at = Date.parse(lastInboundIso);
  if (!Number.isFinite(at)) return false;
  return now - at < OPS_WINDOW_MS;
}

export function opsQuestionAuthRefusal(auth: {
  ok: boolean;
  via?: "cron_secret" | "service_role";
  status?: number;
  error?: string;
  detail?: string;
}): { status: number; error: string; detail: string } | null {
  if (auth.ok && auth.via === "service_role") return null;
  if (!auth.ok) {
    return {
      status: auth.status ?? 401,
      error: auth.error ?? "unauthorized",
      detail: auth.detail ?? "נדרש מפתח service_role.",
    };
  }
  return {
    status: 401,
    error: "unauthorized",
    detail: "הפעולה הזו נפתחת רק עם מפתח service_role.",
  };
}

export function purposeOf(buttonId: string): string {
  const m = OPS_ID_RE.exec(buttonId);
  return m ? m[1] : "unparsed";
}

export function opsButtonId(purpose: string, index: number): string {
  return `${OPS_Q_PREFIX}${purpose}:${index}`;
}

export function questionMessages(purpose: string): { body: string; buttons: OpsButton[] }[] | null {
  const q = OPS_QUESTIONS[purpose];
  if (!q) return null;
  const first = q.buttons.map((title, i) => ({ id: opsButtonId(purpose, i), title }));
  const second = q.followup.buttons.map((title, i) => ({
    id: opsButtonId(purpose, first.length + i),
    title,
  }));
  return [
    { body: q.body, buttons: first },
    { body: q.followup.body, buttons: second },
  ];
}

/** null כשזו אינה לחיצה על כפתור ops_q. כל מזהה עם הקידומת נתפס, גם שבור. */
export function inboundOpsButton(msg: {
  type?: string;
  button?: { payload?: string; text?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}): { id: string; title: string } | null {
  const id = msg.type === "button"
    ? String(msg.button?.payload || "")
    : msg.type === "interactive"
    ? String(msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "")
    : "";
  if (!id.startsWith(OPS_Q_PREFIX)) return null;
  const title = msg.type === "button"
    ? String(msg.button?.text || "")
    : String(msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "");
  return { id, title };
}

export function opsOutboundBody(body: string, buttons: OpsButton[]): string {
  return `${body}\n[${buttons.map((b) => `${b.id} ${b.title}`).join(" | ")}]`;
}

/** זוג user/assistant להצמדה אטומית. לא קורא היסטוריה קיימת. */
export function appendOpsHistory(history: unknown, assistantText: string): unknown[] {
  const list = Array.isArray(history) ? history.slice() : [];
  const last = list[list.length - 1] as { role?: string } | undefined;
  if (last?.role === "user") {
    list.push({ role: "assistant", content: `${OPS_HISTORY_NOTE}\n${assistantText}` });
    return list;
  }
  list.push({ role: "user", content: OPS_HISTORY_NOTE });
  list.push({ role: "assistant", content: assistantText });
  return list;
}

/** תשובת whatsapp_ops_question_claim. null = להמשיך לשליחה. */
export function claimDecision(code: string): OpsResult | null {
  if (code === "claimed" || code === "reclaimed") return null;
  if (code === "already_sent") {
    return result(409, { error: "already_sent", detail: "כבר נשלחה השאלה הזו לסוכן/ת הזה." });
  }
  if (code === "failed") {
    return result(409, {
      error: "send_failed",
      detail: "השליחה הקודמת נכשלה ולא נשרפה. לניסיון חוזר: retry=true.",
    });
  }
  if (code === "in_progress") {
    return result(409, {
      error: "in_progress",
      detail: "שליחה קודמת נתקעה לפני סיום. לניסיון חוזר: retry=true.",
    });
  }
  if (code === "agent_cap") {
    return result(429, { error: "agent_daily_cap", detail: "לסוכן/ת כבר נשלחה שאלה היום." });
  }
  if (code === "global_cap") {
    return result(429, { error: "global_daily_cap", detail: "התקרה היומית של שאלות תפעוליות מלאה." });
  }
  return result(500, { error: "db_error", detail: "תפיסת השאלה החזירה תשובה לא מוכרת." });
}

/**
 * רושם את הלחיצה רק כשהשאלה נשלחה לסוכן/ת שלחץ/ה והמזהה שלו/ה.
 * אחרת unmatched בלי agent_id. כשל ביומן אינו זורק.
 */
export async function recordOpsTap(
  db: OpsTapDb,
  phone: string,
  tap: { id: string; title: string },
  at: Date,
): Promise<string | null> {
  const purpose = purposeOf(tap.id);
  let agentId: string | null = null;
  let matched = false;
  try {
    const sender = await db.agentIdByPhone(phone);
    if (sender && purpose !== "unparsed" && await db.sentButton(sender, purpose, tap.id)) {
      agentId = sender;
      matched = true;
    }
  } catch (err) {
    console.error("ops tap match failed", err);
  }
  try {
    await db.insertAnswer({
      agent_id: matched ? agentId : null,
      purpose: matched ? purpose : "unmatched",
      button_id: tap.id.slice(0, 256),
      button_title: tap.title.slice(0, 40),
      answered_at: at.toISOString(),
    });
  } catch (err) {
    console.error("ops tap log failed", err);
  }
  return matched ? agentId : null;
}

function result(status: number, body: Record<string, unknown>): OpsResult {
  return { status, body };
}

function normalize(input: unknown):
  | { ok: true; value: Normalized }
  | OpsResult {
  if (!input || typeof input !== "object") {
    return result(400, { error: "bad_request", detail: "גוף הבקשה אינו אובייקט." });
  }
  const raw = input as Record<string, unknown>;
  const agentId = typeof raw.agent_member_id === "string" ? raw.agent_member_id.trim() : "";
  if (!UUID_RE.test(agentId)) {
    return result(400, { error: "bad_request", detail: "agent_member_id חייב להיות מזהה של סוכן/ת." });
  }
  const purpose = typeof raw.purpose === "string" ? raw.purpose.trim() : "";
  const messages = questionMessages(purpose);
  if (!messages) {
    return result(400, { error: "unknown_purpose", detail: "purpose אינו ברשימת השאלות המאושרות." });
  }
  const allowed = OPS_QUESTIONS[purpose].allowedAgentIds;
  if (!allowed.includes(agentId)) {
    return result(403, { error: "agent_not_allowed", detail: "השאלה הזו אינה מאושרת לסוכן/ת הזה/ו." });
  }
  return { ok: true, value: { agentId, purpose, retry: raw.retry === true, messages } };
}

const BLOCK_DETAIL: Record<string, string> = {
  inactive: "החשבון אינו פעיל.",
  free_plan: "מסלול חינם לא מקבל וואטסאפ.",
  billing_inactive: "החיוב אינו פעיל.",
};

/**
 * שולח שאלה מהרשימה הסגורה. גוף וכפתורים מהבקשה אינם נקראים.
 * כישלון או תפיסה שנתקעה אינם שורפים את ה-purpose: retry=true מנסה שוב.
 */
export async function runOpsQuestion(opts: {
  db: OpsQuestionDb;
  input: unknown;
  sendButtons: (to: string, body: string, buttons: OpsButton[]) => Promise<string | null>;
  now?: number;
}): Promise<OpsResult> {
  const now = opts.now ?? Date.now();
  const parsed = normalize(opts.input);
  if (!("ok" in parsed)) return parsed;
  const value = parsed.value;
  const first = value.messages[0];
  const follow = value.messages[1] ?? null;

  const agent = await opts.db.getAgent(value.agentId);
  if (!agent) return result(404, { error: "not_found", detail: "הסוכן/ת לא נמצא/ה." });
  const block = whatsappAgentBlock(agent);
  if (block) return result(403, { error: block, detail: BLOCK_DETAIL[block] });
  if (await opts.db.whatsappOff(value.agentId)) {
    return result(403, { error: "whatsapp_off", detail: "הסוכן/ת כיבה/כיבתה את הוואטסאפ." });
  }
  const phone = (agent.phone || "").trim();
  if (!phone) return result(400, { error: "no_phone", detail: "אין לסוכן/ת מספר וואטסאפ." });

  const lastInbound = await opts.db.lastInboundAt(phone);
  if (!customerWindowOpen(lastInbound, now)) {
    return result(409, {
      error: "window_closed",
      detail: "אין הודעה נכנסת ב-24 השעות האחרונות.",
      last_inbound: lastInbound,
    });
  }

  const code = await opts.db.claim({
    agentId: value.agentId,
    purpose: value.purpose,
    body: first.body,
    buttonIds: first.buttons.map((b) => b.id),
    followupBody: follow?.body ?? null,
    followupButtonIds: follow ? follow.buttons.map((b) => b.id) : null,
    retry: value.retry,
  });
  const decided = claimDecision(code);
  if (decided) return decided;

  const prior = value.retry ? await opts.db.priorWaIds(value.agentId, value.purpose) : [];
  const waIds: string[] = [];
  for (let i = 0; i < value.messages.length; i++) {
    const message = value.messages[i];
    if (prior[i]) {
      waIds.push(prior[i]);
      continue;
    }
    let waId: string | null;
    try {
      waId = await opts.sendButtons(phone, message.body, message.buttons);
    } catch (err) {
      console.error("ops question send failed", err);
      const detail = waIds.length
        ? "חלק מההודעות יצא. retry=true שולח רק את מה שלא יצא."
        : "השליחה לוואטסאפ נכשלה. לניסיון חוזר: retry=true.";
      await opts.db.markSent(
        value.agentId,
        value.purpose,
        waIds,
        "failed",
        String((err as Error)?.message || err).slice(0, 300),
      ).catch((markErr) => console.error("ops question mark failed", markErr));
      return result(502, { error: "send_failed", detail });
    }
    waIds.push(waId || "sent");
    const logged = opsOutboundBody(message.body, message.buttons);
    await opts.db.logOutbound({
      agentId: value.agentId,
      phone,
      waMessageId: waId,
      body: logged,
      error: null,
    }).catch((err) => console.error("ops question log failed", err));
    await opts.db.appendHistory(value.agentId, phone, lastInbound || new Date(now).toISOString(), logged)
      .catch((err) => console.error("ops question history failed", err));
  }
  await opts.db.markSent(value.agentId, value.purpose, waIds, "sent", null)
    .catch((err) => console.error("ops question mark failed", err));
  return result(200, {
    ok: true,
    purpose: value.purpose,
    button_ids: first.buttons.map((b) => b.id),
    followup_button_ids: follow ? follow.buttons.map((b) => b.id) : null,
    wa_message_ids: waIds,
  });
}
