// שאלה תפעולית לסוכן/ת אחד/ת, מתוך whatsapp-webhook?task=ops-question.
// התור ops_question_queue מתרוקן מ-?task=ops-question-drain בסוד ה-cron
// הקיים, בלי שמפתח service_role יוצא מהשרת.
//
// רק service_role. אין טקסט חופשי: הקורא שולח purpose ו-agent_member_id,
// והנוסח והכפתורים באים מרשימה סגורה בקוד. רק בתוך 24 שעות מההודעה
// הנכנסת האחרונה, ורק כש-notification_send_window_open פתוח (שקט,
// שישי אחרי 13:00 ושבת). אותו שער מסלול כמו העוזרת (פעיל, חיוב פעיל,
// mid/premium).
//
// מזהה כפתור תשובה הוא ops_q:<purpose>:<n>. לחיצה נתפסת לפני המודל.
// נרשמת רק אם השאלה נשלחה לסוכן/ת הזה/ו והמזהה ברשימת הכפתורים. אחרת
// היומן הוא unmatched בלי לשייך את השולח/ת.
//
// שאלת תמונות היא כפתור קישור, אחד להודעה. אין בה מזהה תשובה, ואין
// בגוף כתובת. תשובה בטקסט אינה מעבירה תמונות.

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

/** תשובה בטקסט על בדיקת התמונות אינה אישור. רק כפתור pmv: מזיז. */
export const OPS_PHOTO_HISTORY_NOTE =
  "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: נשלחו קישורים לבדיקת תמונות. " +
  "תשובה בטקסט אינה אישור להעביר או להעתיק תמונות בנכסים 1147, 1148, 1336 או 1385. " +
  "העברה או העתקה רק בכפתור האישור המפורש שכבר קיים, ולא אוטומטית.]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPS_ID_RE = /^ops_q:([A-Za-z0-9_-]{1,40}):(\d{1,2})$/;
const MAX_TITLE = 20;

export interface OpsButton {
  id: string;
  title: string;
}

/** כפתור אחד שפותח קישור. Meta מתירה cta_url אחד להודעה. */
export interface OpsCta {
  label: string;
  url: string;
}

export interface OpsQuestion {
  body: string;
  buttons: readonly string[];
  /**
   * הודעה שנייה. בלי followup, או עם גוף ריק ובלי כפתורים, יוצאת הודעה
   * אחת. הודעה בלי כפתורים ובלי cta יוצאת כטקסט, לא כהודעת כפתורים ריקה.
   */
  followup?: { body: string; buttons: readonly string[] };
  /** רשימה סגורה. ריקה = אף אחד/ת לא מקבל/ת את השאלה. agency_members.id. */
  allowedAgentIds: readonly string[];
  /** שתי הודעות: הגוף עם הכפתור הראשון, ואז followup עם השני. */
  ctas?: readonly OpsCta[];
  /** הערת היסטוריה. בלי זה OPS_HISTORY_NOTE. */
  historyNote?: string;
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
  photo_check_1147_2026_10: {
    body: "היי, שמנו לב שבנכס 1147 (4 חדרים להשכרה ברובע יזרעאל) תמונות 9 עד 13 נראות של נכס 1148 (דירת הגן בארלוזורוב). להעביר אותן ל־1148? בנוסף, תמונה 6 ב־1147 לא נטענת, אז כדאי להעלות אותה מחדש.",
    buttons: [],
    followup: { body: "וזה נכס 1148, להשוואה:", buttons: [] },
    ctas: [
      { label: "נכס 1147", url: "https://shuknadlan.co.il/p/1147" },
      { label: "נכס 1148", url: "https://shuknadlan.co.il/p/1148" },
    ],
    allowedAgentIds: ["ad2b60a0-e2c1-4d1f-8a10-9bbea8026c19"],
    historyNote: OPS_PHOTO_HISTORY_NOTE,
  },
  photo_check_1336_2026_10: {
    body: "היי, הנכסים 1336 (מגרש באומן) ו־1385 (חנות בקהילת ציון) עודכנו ביום חמישי בהפרש של שתי דקות. אפשר לוודא שהתמונות בכל אחד מהם נכונות? אם משהו התחלף, נעביר אותו לנכס הנכון.",
    buttons: [],
    followup: { body: "וזה נכס 1385:", buttons: [] },
    ctas: [
      { label: "נכס 1336", url: "https://shuknadlan.co.il/p/1336" },
      { label: "נכס 1385", url: "https://shuknadlan.co.il/p/1385" },
    ],
    allowedAgentIds: ["248e9455-53d6-4e82-80b5-582cea77f80f"],
    historyNote: OPS_PHOTO_HISTORY_NOTE,
  },
  // הודעת מידע אחת, בלי כפתור ובלי המשך. המזהה הוא agency_members.id.
  yaakov_lead_email_2026_11: {
    body: "היי יעקב, המייל עם הליד מפייסבוק הגיע. השדות בו הם נתוני הבדיקה של מטא, אז לא הכנסתי אותו. בנוסף, אני מקבלת לידים במייל רק מהכתובת הרשומה שלך, ycschutz@gmail.com, והמייל הזה נשלח מ-schutz-digital. בינתיים אפשר להעביר לי ליד אמיתי מהכתובת הרשומה או כאן בוואטסאפ, ואז אכניס אותו כמוכר. על ההתאמות אעדכן אותך בנפרד.",
    buttons: [],
    allowedAgentIds: ["4dd1148b-bddd-405a-ae5b-9c836325f3bb"],
    historyNote:
      "[הודעת מערכת, לא נכתבה בידי הסוכן/ת: נשלחה הודעת מידע על המייל עם הליד שלו. אין פעולה נדרשת.]",
  },
};

const CTA_URL_RE = /^https:\/\/shuknadlan\.co\.il\/p\/\d+$/;

function assertNoUrl(text: string, purpose: string): void {
  if (/https?:\/\//i.test(text) || text.includes("shuknadlan.co.il")) {
    throw new Error(`ops body contains a url for ${purpose}`);
  }
}

function followupSends(q: OpsQuestion): boolean {
  return !!q.followup && (q.followup.body.trim().length > 0 || q.followup.buttons.length > 0);
}

for (const [purpose, q] of Object.entries(OPS_QUESTIONS)) {
  assertNoUrl(q.body, purpose);
  if (q.followup) assertNoUrl(q.followup.body, purpose);
  if (q.ctas) {
    if (!q.followup || q.ctas.length !== 2 || q.buttons.length !== 0 || q.followup.buttons.length !== 0) {
      throw new Error(`ops cta shape for ${purpose}`);
    }
    for (const cta of q.ctas) {
      if (cta.label.length < 1 || cta.label.length > MAX_TITLE) {
        throw new Error(`ops cta label length ${cta.label.length} for ${purpose}`);
      }
      if (!CTA_URL_RE.test(cta.url) || q.body.includes(cta.url) || q.followup.body.includes(cta.url)) {
        throw new Error(`ops cta url for ${purpose}`);
      }
    }
    continue;
  }
  for (const title of [...q.buttons, ...(q.followup?.buttons ?? [])]) {
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
  kind: "text" | "interactive";
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
    status: "sent" | "failed" | "partial_sent",
    error: string | null,
  ): Promise<void>;
  appendHistory(
    agentId: string,
    phone: string,
    lastInbound: string,
    assistantText: string,
    note?: string,
  ): Promise<void>;
  logOutbound(row: OpsOutbound): Promise<void>;
  /**
   * notification_send_window_open. false בשעות השקט (לפני 08:00 ואחרי
   * 21:00), בשישי מ-13:00, ובכל השבת עד ראשון 08:00.
   */
  sendWindowOpen(atIso: string): Promise<boolean>;
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

export interface OpsOutboundMessage {
  body: string;
  buttons: OpsButton[];
  cta: OpsCta | null;
}

type Normalized = {
  agentId: string;
  purpose: string;
  retry: boolean;
  messages: OpsOutboundMessage[];
  historyNote?: string;
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

export function questionMessages(purpose: string): OpsOutboundMessage[] | null {
  const q = OPS_QUESTIONS[purpose];
  if (!q) return null;
  if (q.ctas) {
    if (!q.followup) return null;
    return [
      { body: q.body, buttons: [], cta: q.ctas[0] },
      { body: q.followup.body, buttons: [], cta: q.ctas[1] },
    ];
  }
  const first = q.buttons.map((title, i) => ({ id: opsButtonId(purpose, i), title }));
  const messages: OpsOutboundMessage[] = [{ body: q.body, buttons: first, cta: null }];
  if (followupSends(q) && q.followup) {
    const second = q.followup.buttons.map((title, i) => ({
      id: opsButtonId(purpose, first.length + i),
      title,
    }));
    messages.push({ body: q.followup.body, buttons: second, cta: null });
  }
  return messages;
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

export function opsOutboundBody(body: string, buttons: OpsButton[], cta?: OpsCta | null): string {
  if (cta) return `${body}\n[${cta.label}]`;
  if (buttons.length === 0) return body;
  return `${body}\n[${buttons.map((b) => `${b.id} ${b.title}`).join(" | ")}]`;
}

/** זוג user/assistant להצמדה אטומית. לא קורא היסטוריה קיימת. */
export function appendOpsHistory(history: unknown, assistantText: string, note?: string): unknown[] {
  const system = note && note.trim() ? note : OPS_HISTORY_NOTE;
  const list = Array.isArray(history) ? history.slice() : [];
  const last = list[list.length - 1] as { role?: string } | undefined;
  if (last?.role === "user") {
    list.push({ role: "assistant", content: `${system}\n${assistantText}` });
    return list;
  }
  list.push({ role: "user", content: system });
  list.push({ role: "assistant", content: assistantText });
  return list;
}

/** תשובת whatsapp_ops_question_claim. null = להמשיך לשליחה. */
export function claimDecision(code: string): OpsResult | null {
  if (code === "claimed" || code === "reclaimed") return null;
  if (code === "already_sent") {
    return result(409, { error: "already_sent", detail: "כבר נשלחה השאלה הזו לסוכן/ת הזה." });
  }
  if (code === "partial_sent") {
    return result(409, {
      error: "partial_sent",
      detail: "חלק מההודעות כבר יצא. מה שיצא לא נשלח שוב.",
    });
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
  return {
    ok: true,
    value: {
      agentId,
      purpose,
      retry: raw.retry === true,
      messages,
      historyNote: OPS_QUESTIONS[purpose].historyNote,
    },
  };
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
  /** כפתור קישור. חובה כשלשאלה יש ctas. אחד להודעה. */
  sendCta?: (to: string, body: string, label: string, url: string) => Promise<string | null>;
  /** הודעת טקסט. חובה כשאין כפתורים ואין cta. מטא דוחה כפתורים ריקים. */
  sendText?: (to: string, body: string) => Promise<string | null>;
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
  if (!await opts.db.sendWindowOpen(new Date(now).toISOString())) {
    return result(409, {
      error: "quiet_hours",
      detail: "שעות שקט או שבת. לא נשלח כלום.",
    });
  }
  if (value.messages.some((m) => m.cta) && !opts.sendCta) {
    return result(500, { error: "misconfigured", detail: "לשאלה הזו אין שולח כפתור קישור." });
  }
  if (value.messages.some((m) => !m.cta && m.buttons.length === 0) && !opts.sendText) {
    return result(500, { error: "misconfigured", detail: "לשאלה הזו אין שולח הודעת טקסט." });
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
  const stamp = lastInbound || new Date(now).toISOString();
  const remember = (status: "sent" | "failed" | "partial_sent", errorText: string | null) =>
    opts.db.markSent(value.agentId, value.purpose, waIds, status, errorText)
      .catch((err) => console.error("ops question mark failed", err));
  for (let i = 0; i < value.messages.length; i++) {
    const message = value.messages[i];
    if (prior[i]) {
      waIds.push(prior[i]);
      continue;
    }
    let waId: string | null;
    try {
      waId = message.cta
        ? await opts.sendCta!(phone, message.body, message.cta.label, message.cta.url)
        : message.buttons.length === 0
        ? await opts.sendText!(phone, message.body)
        : await opts.sendButtons(phone, message.body, message.buttons);
    } catch (err) {
      console.error("ops question send failed", err);
      const partial = waIds.length > 0;
      const detail = partial
        ? "חלק מההודעות יצא. מה שיצא לא נשלח שוב."
        : "השליחה לוואטסאפ נכשלה. לניסיון חוזר: retry=true.";
      await remember(partial ? "partial_sent" : "failed", String((err as Error)?.message || err).slice(0, 300));
      return result(502, { error: partial ? "partial_sent" : "send_failed", detail });
    }
    waIds.push(waId || "sent");
    const logged = opsOutboundBody(message.body, message.buttons, message.cta);
    const kind = message.cta || message.buttons.length > 0 ? "interactive" : "text";
    await opts.db.logOutbound({
      agentId: value.agentId,
      phone,
      waMessageId: waId,
      body: logged,
      error: null,
      kind,
    }).catch((err) => console.error("ops question log failed", err));
    await opts.db.appendHistory(value.agentId, phone, stamp, logged, value.historyNote)
      .catch((err) => console.error("ops question history failed", err));
    // אחרי הודעה שיצאה, לפני הבאה: לא נשארים claimed. כשל בהמשך הוא partial_sent,
    // וההודעה שכבר יצאה לא נשלחת שוב.
    if (i < value.messages.length - 1) await remember("partial_sent", null);
  }
  await remember("sent", null);
  return result(200, {
    ok: true,
    purpose: value.purpose,
    button_ids: first.buttons.map((b) => b.id),
    followup_button_ids: follow ? follow.buttons.map((b) => b.id) : null,
    ctas: value.messages.map((m) => m.cta),
    wa_message_ids: waIds,
  });
}

/** שער זמני: השורה נשארת pending והסבב הבא מנסה שוב. */
export const OPS_QUEUE_PENDING_REASONS = new Set([
  "window_closed",
  "quiet_hours",
  "agent_daily_cap",
  "global_daily_cap",
]);

/**
 * כשל שהתפיסה כבר רשמה כ-failed או claimed תקוע. הסבב הבא קורא עם
 * retry=true. partial_sent אינו כאן: מה שיצא לא נשלח שוב.
 */
export const OPS_QUEUE_RETRY_REASONS = new Set([
  "send_failed",
  "in_progress",
  "db_error",
]);

const OPS_QUEUE_SKIP_REASONS = new Set([
  "unknown_purpose",
  "agent_not_allowed",
  "inactive",
  "free_plan",
  "billing_inactive",
  "whatsapp_off",
  "no_phone",
  "not_found",
  "bad_request",
]);

export type OpsQueueStatus = "pending" | "sent" | "skipped" | "failed";

export interface OpsQueueRow {
  id: string;
  purpose: string;
  agentMemberId: string;
  status: string;
  reason: string | null;
}

export interface OpsQueueDb {
  /** pending, ואז failed שסיבתם ניתנת לניסיון חוזר. לפי created_at. */
  due(limit: number): Promise<OpsQueueRow[]>;
  /**
   * מעדכן רק אם הסטטוס עדיין fromStatus. שורה שכבר זזה (sent מקביל)
   * אינה נדרסת.
   */
  mark(id: string, fromStatus: string, status: OpsQueueStatus, reason: string | null): Promise<void>;
}

export function opsQueueNeedsRetry(row: { status: string; reason: string | null }): boolean {
  return row.status === "failed" && !!row.reason && OPS_QUEUE_RETRY_REASONS.has(row.reason);
}

/** מיפוי תוצאת runOpsQuestion לשורת התור. אינו שולח בעצמו. */
export function opsQueueDecision(result: OpsResult): { status: OpsQueueStatus; reason: string | null } {
  if (result.status === 200) return { status: "sent", reason: null };
  const code = typeof result.body.error === "string" ? result.body.error : "unknown";
  if (OPS_QUEUE_PENDING_REASONS.has(code)) return { status: "pending", reason: code };
  if (code === "already_sent") return { status: "sent", reason: "already_sent" };
  if (OPS_QUEUE_SKIP_REASONS.has(code)) return { status: "skipped", reason: code };
  return { status: "failed", reason: code };
}

/**
 * מרוקן את ops_question_queue. כל שורה עוברת ב-runOpsQuestion (הרשימה
 * הסגורה וכל השערים). אין כאן ניסיון חוזר מיידי על in_progress: סבב
 * מקביל עלול עדיין לשלוח, והניסיון הבא מגיע רק אחרי שהשורה סומנה failed.
 */
export async function runOpsQuestionDrain(opts: {
  queue: OpsQueueDb;
  ask: (input: { purpose: string; agent_member_id: string; retry: boolean }) => Promise<OpsResult>;
  limit?: number;
}): Promise<{ processed: number; outcomes: { id: string; status: OpsQueueStatus; reason: string | null }[] }> {
  const due = await opts.queue.due(opts.limit ?? 5);
  const outcomes: { id: string; status: OpsQueueStatus; reason: string | null }[] = [];
  for (const row of due) {
    const result = await opts.ask({
      purpose: row.purpose,
      agent_member_id: row.agentMemberId,
      retry: opsQueueNeedsRetry(row),
    });
    const decision = opsQueueDecision(result);
    await opts.queue.mark(row.id, row.status, decision.status, decision.reason);
    outcomes.push({ id: row.id, status: decision.status, reason: decision.reason });
  }
  return { processed: outcomes.length, outcomes };
}
