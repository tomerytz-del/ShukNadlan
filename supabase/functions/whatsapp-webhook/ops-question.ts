// שאלה תפעולית לסוכן/ת אחד/ת, מתוך whatsapp-webhook?task=ops-question.
//
// רק service_role. הודעת טקסט חופשי עם עד 3 כפתורי תשובה, ורק בתוך 24
// השעות מההודעה הנכנסת האחרונה של אותו מספר (חלון שירות הלקוחות של Meta).
// מסלול חינם לא מקבל וואטסאפ. אותו purpose לא נשלח פעמיים.
//
// מזהה הכפתור הוא ops_q:<purpose>:<n>. לחיצה נתפסת לפני המודל: אין כתיבה
// לנתונים מלבד שורת יומן, והתשובה קבועה. גם מזהה שמתחיל ב-ops_q: ואינו
// מתפרש לא הופך לטקסט שהמודל קורא.

export const OPS_Q_PREFIX = "ops_q:";
export const OPS_TAP_REPLY = "תודה, העברתי לבדיקה";
export const OPS_WINDOW_MS = 24 * 60 * 60 * 1000;

export const OPS_HISTORY_NOTE =
  "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: נשלחה אליך שאלה עם כפתורים. " +
  "לחיצה על כפתור כבר טופלה, ואין להגיב עליה ואין לבצע פעולה.]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const OPS_ID_RE = /^ops_q:([A-Za-z0-9_-]{1,40}):(\d{1,2})$/;

const MAX_BUTTONS = 3;
const MAX_TITLE = 20;
const MAX_BODY = 1024;

export interface OpsButton {
  id: string;
  title: string;
}

export interface OpsAgent {
  id: string;
  tier: string | null;
  phone: string | null;
}

export interface OpsClaim {
  agentId: string;
  purpose: string;
  body: string;
  buttonIds: string[];
  followupBody: string | null;
  followupButtonIds: string[] | null;
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
  lastInboundAt(phone: string): Promise<string | null>;
  claim(row: OpsClaim): Promise<"claimed" | "exists">;
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
  insertAnswer(row: OpsAnswer): Promise<void>;
}

export interface OpsResult {
  status: number;
  body: Record<string, unknown>;
}

type Normalized = {
  agentId: string;
  purpose: string;
  body: string;
  buttons: OpsButton[];
  followup: { body: string; buttons: OpsButton[] } | null;
};

/** וואטסאפ לסוכנים רק ב-mid וב-premium. חינם, ריק, וכל מסלול אחר - לא. */
export function whatsappTierAllowed(tier: string | null): boolean {
  return tier === "mid" || tier === "premium";
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

/** מוסיף זוג user/assistant בלי לשכתב את ההיסטוריה הקיימת. */
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

/**
 * רושם את הלחיצה ולא נוגע בשום טבלה אחרת. כשל ביומן אינו זורק - הקורא
 * עדיין עונה את התשובה הקבועה ולא מעביר למודל.
 */
export async function recordOpsTap(
  db: OpsTapDb,
  phone: string,
  tap: { id: string; title: string },
  at: Date,
): Promise<string | null> {
  let agentId: string | null = null;
  try {
    agentId = await db.agentIdByPhone(phone);
  } catch (err) {
    console.error("ops tap agent lookup failed", err);
  }
  try {
    await db.insertAnswer({
      agent_id: agentId,
      purpose: purposeOf(tap.id),
      button_id: tap.id.slice(0, 256),
      button_title: tap.title.slice(0, 40),
      answered_at: at.toISOString(),
    });
  } catch (err) {
    console.error("ops tap log failed", err);
  }
  return agentId;
}

function bad(detail: string): { ok: false; error: string; detail: string } {
  return { ok: false, error: "bad_request", detail };
}

function cleanBody(raw: unknown, format: (s: string) => string): string | null {
  if (typeof raw !== "string") return null;
  const body = format(raw).trim();
  if (!body || body.length > MAX_BODY) return null;
  return body;
}

function cleanTitles(raw: unknown, format: (s: string) => string): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_BUTTONS) return null;
  const titles: string[] = [];
  for (const item of raw) {
    const titleRaw = item && typeof item === "object" ? (item as { title?: unknown }).title : null;
    if (typeof titleRaw !== "string") return null;
    const title = format(titleRaw).trim();
    if (!title || title.length > MAX_TITLE) return null;
    titles.push(title);
  }
  return titles;
}

function normalize(input: unknown, format: (s: string) => string):
  | { ok: true; value: Normalized }
  | { ok: false; error: string; detail: string } {
  if (!input || typeof input !== "object") return bad("גוף הבקשה אינו אובייקט.");
  const raw = input as Record<string, unknown>;
  const agentId = typeof raw.agent_id === "string" ? raw.agent_id.trim() : "";
  if (!UUID_RE.test(agentId)) return bad("agent_id חייב להיות מזהה של סוכן/ת.");
  const purpose = typeof raw.purpose === "string" ? raw.purpose.trim() : "";
  if (!PURPOSE_RE.test(purpose)) {
    return bad("purpose יכול להכיל רק אותיות באנגלית, ספרות, מקף וקו תחתון, עד 40.");
  }
  const body = cleanBody(raw.body, format);
  if (!body) return bad("גוף ההודעה ריק או ארוך מ-1024 תווים.");
  const titles = cleanTitles(raw.buttons, format);
  if (!titles) return bad("נדרשים 1 עד 3 כפתורים, וכותרת של עד 20 תווים.");
  const buttons = titles.map((title, i) => ({ id: opsButtonId(purpose, i), title }));

  let followup: Normalized["followup"] = null;
  if (raw.followup != null) {
    if (typeof raw.followup !== "object") return bad("ההודעה השנייה אינה תקינה.");
    const second = raw.followup as Record<string, unknown>;
    const followBody = cleanBody(second.body, format);
    if (!followBody) return bad("גוף ההודעה השנייה ריק או ארוך מ-1024 תווים.");
    const followTitles = cleanTitles(second.buttons, format);
    if (!followTitles) return bad("להודעה השנייה נדרשים 1 עד 3 כפתורים, וכותרת של עד 20 תווים.");
    followup = {
      body: followBody,
      buttons: followTitles.map((title, i) => ({ id: opsButtonId(purpose, buttons.length + i), title })),
    };
  }
  return { ok: true, value: { agentId, purpose, body, buttons, followup } };
}

function result(status: number, body: Record<string, unknown>): OpsResult {
  return { status, body };
}

/**
 * שולח שאלה אחת (ואולי הודעה שנייה מיד אחריה). לא שולח כשהמסלול חינם,
 * כשהחלון סגור, או כשאותו purpose כבר נתפס. התפיסה נרשמת לפני השליחה,
 * כדי ששתי קריאות במקביל לא ישלחו פעמיים.
 */
export async function runOpsQuestion(opts: {
  db: OpsQuestionDb;
  input: unknown;
  sendButtons: (to: string, body: string, buttons: OpsButton[]) => Promise<string | null>;
  format?: (s: string) => string;
  now?: number;
}): Promise<OpsResult> {
  const format = opts.format ?? ((s: string) => s);
  const now = opts.now ?? Date.now();
  const parsed = normalize(opts.input, format);
  if (!parsed.ok) return result(400, { error: parsed.error, detail: parsed.detail });
  const value = parsed.value;

  const agent = await opts.db.getAgent(value.agentId);
  if (!agent) return result(404, { error: "not_found", detail: "הסוכן/ת לא נמצא/ה." });
  if (!whatsappTierAllowed(agent.tier)) {
    return result(403, { error: "free_plan", detail: "מסלול חינם לא מקבל וואטסאפ." });
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

  const claimed = await opts.db.claim({
    agentId: value.agentId,
    purpose: value.purpose,
    body: value.body,
    buttonIds: value.buttons.map((b) => b.id),
    followupBody: value.followup?.body ?? null,
    followupButtonIds: value.followup ? value.followup.buttons.map((b) => b.id) : null,
  });
  if (claimed === "exists") {
    return result(409, {
      error: "already_sent",
      detail: "כבר נשלחה שאלה עם אותו purpose לסוכן/ת הזה.",
    });
  }

  const messages = [{ body: value.body, buttons: value.buttons }];
  if (value.followup) messages.push(value.followup);
  const waIds: string[] = [];
  for (const message of messages) {
    let waId: string | null;
    try {
      waId = await opts.sendButtons(phone, message.body, message.buttons);
    } catch (err) {
      console.error("ops question send failed", err);
      const detail = waIds.length
        ? "ההודעה הראשונה יצאה. ההודעה השנייה נכשלה, ולא נשלח שוב לאותו purpose."
        : "השליחה לוואטסאפ נכשלה, ולא נשלח שוב לאותו purpose.";
      await opts.db.markSent(
        value.agentId,
        value.purpose,
        waIds,
        "failed",
        String((err as Error)?.message || err).slice(0, 300),
      ).catch((markErr) => console.error("ops question mark failed", markErr));
      return result(502, { error: "send_failed", detail });
    }
    if (waId) waIds.push(waId);
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
    button_ids: value.buttons.map((b) => b.id),
    followup_button_ids: value.followup ? value.followup.buttons.map((b) => b.id) : null,
    wa_message_ids: waIds,
  });
}
