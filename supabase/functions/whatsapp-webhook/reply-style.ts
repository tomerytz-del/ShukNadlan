// איך גבריאלה עונה לסוכן/ת. הכללים גם ב-SYSTEM_STATIC; כאן מה שהמודל מפספס
// חוזר בקוד: שאלה שכבר נענתה, תזכורת על נושא אחר, ותפריט כשיש קריאה אחת.
// ‏2.11.2026, משוב: "גבריאלה מוסיפה עבודה ולא עוזרת".

export interface HistoryMsg {
  role?: string;
  content?: unknown;
  /** מתי נשמרה ההודעה. בלי חותמת אין זיהוי שנסגר (חלון של 24 שעות). */
  at?: string;
}

export const ID_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SettledAnswer {
  q: string;
  a: string;
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => {
    if (typeof b === "string") return b;
    if (b && typeof b === "object" && "text" in b) return String((b as { text?: string }).text || "");
    return "";
  }).join("\n");
}

export function isClearAnswer(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.includes("?")) return false;
  // ‏\b אינו עובד על עברית: האותיות אינן \w.
  if (/^(כן|לא|נכון|בדיוק)(?![\u0590-\u05FF])/.test(t) && t.length < 160) return true;
  if (/הכוונה ל/.test(t)) return true;
  return false;
}

function questionsIn(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const bits = line.split(/(?<=\?)/);
    for (const bit of bits) {
      const q = bit.replace(/\s+/g, " ").trim();
      if (q.endsWith("?") && q.length > 2 && q.length < 220) out.push(q);
    }
  }
  return out;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "...";
}

/** הודעות עם חותמת מ-24 השעות האחרונות. בלי אף חותמת נשאר החלון הישן. */
export function historyInIdWindow(history: readonly HistoryMsg[], now = Date.now()): HistoryMsg[] {
  if (!history.some((m) => m.at)) return history.slice();
  const min = now - ID_WINDOW_MS;
  return history.filter((m) => {
    const t = Date.parse(String(m.at || ""));
    return Number.isFinite(t) && t >= min && t <= now + 60_000;
  });
}

/** שאלות שכבר נענו. "כן" נחשב תשובה. ההודעה הנוכחית עוד אינה בהיסטוריה. */
export function settledFromHistory(history: readonly HistoryMsg[], currentUserText = "", now = Date.now()): SettledAnswer[] {
  const recent = historyInIdWindow(history, now);
  const out: SettledAnswer[] = [];
  const seen = new Set<string>();
  const push = (q: string, a: string) => {
    const key = q.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key) || !isClearAnswer(a)) return;
    seen.add(key);
    out.push({ q: clip(key, 140), a: clip(a, 140) });
  };
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].role !== "assistant") continue;
    const qs = questionsIn(messageText(recent[i].content));
    if (!qs.length) continue;
    let answer = "";
    for (let j = i + 1; j < recent.length; j++) {
      if (recent[j].role === "user") {
        answer = messageText(recent[j].content);
        break;
      }
    }
    if (!answer && i === lastAssistant(recent)) answer = currentUserText;
    for (const q of qs) push(q, answer);
  }
  return out.slice(-6);
}

function lastAssistant(history: readonly HistoryMsg[]): number {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === "assistant") return i;
  return -1;
}

/**
 * "תתקני, הפגישה עם עליזה היא היום בקפה קפה. ולא עם חגי":
 * המקום הוא של עליזה. חגי אינו נשאל ואינו מבוטל.
 */
export function likelyReading(userText: string): string | null {
  const t = userText.replace(/\s+/g, " ").trim();
  if (!/תתקנ|תעדכנ|טעות|לא נכון/.test(t)) return null;
  const not = /(?:ולא|לא)\s+עם\s+([א-ת]{2,12})/.exec(t);
  if (!not) return null;
  const withWhom = /עם\s+([א-ת]{2,12})/.exec(t);
  if (!withWhom || withWhom[1] === not[1]) return null;
  return `קריאה אחת, בלי תפריט: העדכון חל על הפגישה עם ${withWhom[1]}. ` +
    `${not[1]} אינו חלק מהעדכון - אין לבטל, להזיז או לשאול על הפגישה הזו. ` +
    `אשר/י בשורה אחת מה שונה.`;
}

const OFFER_RE = /אפשר להוסיף את ([א-ת]{2,12}) לקובץ|אוסיף את ([א-ת]{2,12}) לקובץ|להוסיף את ([א-ת]{2,12}) לקובץ/g;

export function offeredNames(history: readonly HistoryMsg[]): string[] {
  const names: string[] = [];
  for (const m of history) {
    if (m.role !== "assistant") continue;
    const text = messageText(m.content);
    for (const hit of text.matchAll(OFFER_RE)) {
      const name = hit[1] || hit[2] || hit[3];
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

export function offerAlready(history: readonly HistoryMsg[], name: string): boolean {
  return offeredNames(history).includes(name);
}

export function clientOfferLine(name: string): string {
  return `אפשר להוסיף את ${name} לקובץ הלקוחות.`;
}

const NOT_A_PERSON = new Set([
  "היום", "מחר", "מחרתיים", "השבוע", "הבוקר", "הערב", "צהריים", "אחר",
  "מרפסת", "חניה", "דירה", "נכס", "פגישה", "סיור", "תזכורת", "הודעה",
  "משרד", "לקוח", "לקוחה", "קפה",
]);
/** גבול מילה בעברית. \b אינו תופס אותיות עבריות. */
export function hebrewBounded(word: string): RegExp {
  return new RegExp(`(?<![\\u0590-\\u05FF])${word}(?![\\u0590-\\u05FF])`);
}

function isPersonToken(name: string): boolean {
  return name.length >= 2 && !NOT_A_PERSON.has(name);
}

export interface NameLink {
  /** השם המדויק שנשאל, מילה שלמה. */
  spoken: string;
  /** השם המלא שאושר, רק לאותו spoken. */
  full: string;
}

function wholeTokens(text: string): string[] {
  return normQ(text).split(" ").filter((w) => w.length >= 2);
}

/**
 * זיהוי שנסגר: "אבירם" = "אבירם כהן", רק כשהתשובה מאשרת את אותו שם.
 * אדם אחר לאותו שם פרטי מבטל את הזיהוי. אין כאן קישור לכרטיס.
 */
function walkNameLinks(
  history: readonly HistoryMsg[],
  currentUserText: string,
  now = Date.now(),
): { live: NameLink[]; voided: Set<string> } {
  history = historyInIdWindow(history, now);
  const found: NameLink[] = [];
  const voided = new Set<string>();
  const consider = (text: string) => {
    for (const link of found) {
      if (contradictsLink(link, text)) voided.add(link.spoken);
    }
  };
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "user") consider(messageText(history[i].content));
    if (history[i].role !== "assistant") continue;
    const answer = answerAfter(history, i, currentUserText);
    for (const q of questionsIn(messageText(history[i].content))) {
      const link = linkFromQa(q, answer);
      if (!link) continue;
      if (contradictsLink(link, answer)) {
        voided.add(link.spoken);
        continue;
      }
      const prev = found.findIndex((x) => x.spoken === link.spoken);
      if (prev >= 0) found[prev] = link;
      else found.push(link);
    }
  }
  consider(currentUserText);
  return { live: found.filter((link) => !voided.has(link.spoken)), voided };
}

export function closedNameLinks(history: readonly HistoryMsg[], currentUserText = "", now = Date.now()): NameLink[] {
  return walkNameLinks(history, currentUserText, now).live;
}

function answerAfter(history: readonly HistoryMsg[], i: number, currentUserText: string): string {
  for (let j = i + 1; j < history.length; j++) {
    if (history[j].role === "user") return messageText(history[j].content);
  }
  if (i === lastAssistant(history)) return currentUserText;
  return "";
}

function linkFromQa(q: string, a: string): NameLink | null {
  if (!isClearAnswer(a)) return null;
  const m = q.match(/(?<![א-ת])([א-ת]{2,12}) זה ([א-ת]{2,12}(?: [א-ת]{2,12})?)(?![א-ת])/);
  if (!m) return null;
  const spoken = m[1];
  let full = m[2];
  const intent = a.match(/הכוונה ל([א-ת]{2,12}(?: [א-ת]{2,12})?)/);
  if (intent) full = intent[1];
  else if (!/^(כן|נכון|בדיוק)(?![\u0590-\u05FF])/.test(a.trim())) return null;
  if (full !== spoken && !full.startsWith(spoken + " ")) return null;
  if (full === spoken) return null;
  if (!isPersonToken(spoken)) return null;
  return { spoken, full };
}

function contradictsLink(link: NameLink, text: string): boolean {
  if (!text) return false;
  // "הכוונה ל" מדביקה ל לפני השם, אז גבול מילה רגיל מפספס אותו.
  const intent = text.match(/הכוונה ל([א-ת]{2,12}(?: [א-ת]{2,12})?)/);
  if (intent && intent[1] !== link.full && intent[1].startsWith(link.spoken)) return true;
  if (!hebrewBounded(link.spoken).test(text)) return false;
  if (new RegExp(`לא ${link.full}(?![א-ת])`).test(text)) return true;
  if (new RegExp(`(?<![א-ת])${link.spoken} אחר(?![א-ת])`).test(text)) return true;
  const next = new RegExp(`(?<![א-ת])${link.spoken} ([א-ת]{2,12})(?![א-ת])`, "g");
  for (const hit of text.matchAll(next)) {
    if (NOT_A_PERSON.has(hit[1]) || hit[1] === "זה" || hit[1] === "מקובץ") continue;
    if (`${link.spoken} ${hit[1]}` !== link.full) return true;
  }
  return false;
}

export function sameClockMinute(aIso: string, bIso: string): boolean {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.floor(a / 60000) === Math.floor(b / 60000);
}

export function sameTimeConflictLine(
  kind: string,
  createdDue: string | null,
  others: ReadonlyArray<{ id?: string; title?: string; due_at?: string | null; kind?: string; status?: string }>,
  selfId: string,
): string | null {
  if (!createdDue || !["meeting", "showing", "signing"].includes(kind)) return null;
  const hit = others.find((o) =>
    String(o.id || "") !== String(selfId) &&
    o.status !== "canceled" && o.status !== "done" &&
    ["meeting", "showing", "signing"].includes(String(o.kind || "")) &&
    !!o.due_at && sameClockMinute(createdDue, String(o.due_at))
  );
  if (!hit) return null;
  const title = String(hit.title || "פגישה").replace(/\s+/g, " ").trim().slice(0, 80);
  return `באותה שעה כבר קבוע: ${title}.`;
}

export function styleContext(history: readonly HistoryMsg[], userText: string): string {
  const lines: string[] = [];
  const settled = activeSettled(history, userText);
  if (settled.length) {
    lines.push("כבר נענה בשיחה הזו, ואין לשאול שוב (גם לא \"ועוד דבר אחד\". \"כן\" הוא תשובה):");
    for (const s of settled) lines.push(`- ${s.q} = ${s.a}`);
  }
  for (const link of closedNameLinks(history, userText)) {
    lines.push(
      `זיהוי שנסגר בשיחה הזו רק לשם המדויק "${link.spoken}": ${link.full}. ` +
        "אין להחיל אותו על אדם אחר ואין לקשר איתו לקוח/ה אחר/ת. אם נאמר שם אחר, הזיהוי בטל.",
    );
  }
  const reading = likelyReading(userText);
  if (reading) lines.push(reading);
  const offered = offeredNames(history);
  if (offered.length) lines.push(`כבר הוצע להוסיף לקובץ, ואין להציע שוב: ${offered.join(", ")}.`);
  return lines.join("\n");
}

function activeSettled(history: readonly HistoryMsg[], currentUserText: string): SettledAnswer[] {
  const voided = voidedSpokenNames(history, currentUserText);
  return settledFromHistory(history, currentUserText).filter((s) => {
    const spoken = spokenInQuestion(s.q);
    return !spoken || !voided.has(spoken);
  });
}

function spokenInQuestion(q: string): string | null {
  const m = q.match(/(?<![א-ת])([א-ת]{2,12}) זה /);
  return m ? m[1] : null;
}

function voidedSpokenNames(history: readonly HistoryMsg[], currentUserText: string): Set<string> {
  return walkNameLinks(history, currentUserText).voided;
}

const SAME_TIME_OK = /באותה שעה כבר קבוע/;
const MENU = /לבטל|להזיז|להשאיר|אפשרות/;
const STOP = new Set([
  "זה", "זאת", "הוא", "היא", "האם", "של", "את", "על", "עם", "מקובץ", "הלקוחות",
  "לא", "ועוד", "דבר", "אחד", "אחת", "מה", "מי", "יש", "אין", "גם", "רק", "איך",
]);

function normQ(s: string): string {
  return s.replace(/[^\u0590-\u05FFA-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function contentTokens(text: string): string[] {
  const seen: string[] = [];
  for (const w of wholeTokens(text)) {
    if (w.length < 3 || STOP.has(w) || seen.includes(w)) continue;
    seen.push(w);
  }
  return seen;
}

function isUnsolicitedAside(line: string, userText: string): boolean {
  if (SAME_TIME_OK.test(line)) return false;
  if (/\[הקלטת שיחה|\[מסמך|\[ייבוא נכסים/.test(userText)) return false;
  if (/מה יש לי|היומן|תזכיר|תזכורת/.test(userText)) return false;
  // שורת אישור שמתחילה ב"תזכורת" נשארת. יורדות רק הערות צד על פגישה אחרת.
  if (/שים לב|שימי לב|יש לך גם|להזיז אחת/.test(line)) {
    return /פגישה|סיור|\d{1,2}:\d{2}/.test(line);
  }
  return false;
}

/** אותה שאלה על אותו אדם, מילה שלמה מול מילה שלמה. "מחר" אינו "מחרתיים". */
export function repeatsSettled(line: string, settled: readonly SettledAnswer[]): boolean {
  if (!line.includes("?")) return false;
  const q = new Set(contentTokens(line));
  return settled.some((s) => {
    const st = contentTokens(s.q);
    if (st.length < 2 || !st.every((w) => q.has(w))) return false;
    const spoken = spokenInQuestion(s.q);
    if (spoken && !q.has(spoken)) return false;
    const extra = [...q].filter((w) => !st.includes(w));
    return !extra.some((w) => /מחיר|טלפון|קומה|עיר|חדר|עסקה|קנייה|שכירות|בעל|בעלת/.test(w));
  });
}

function isChoiceMenu(line: string, userText: string): boolean {
  if (!likelyReading(userText)) return false;
  if (/^\s*\d+[.)]/.test(line)) return true;
  if (/^(לבטל|להזיז|להשאיר)(?![\u0590-\u05FF])/.test(line.trim())) return true;
  if (!line.includes("?")) return false;
  const not = /(?:ולא|לא)\s+עם\s+([א-ת]{2,12})/.exec(userText);
  if (not && hebrewBounded(not[1]).test(line)) return true;
  return MENU.test(line);
}

function isCustomerDraft(block: string): boolean {
  const t = block.trim();
  if (/^(הודעה ללקוח|נוסח ללקוח|נוסח להעברה)/.test(t)) return true;
  // גם בלי קישור. "היי דנה," ואחריו מועד הם נוסח ללקוח/ה.
  if (/^(היי|הי|שלום)\s+[א-ת]/.test(t)) return true;
  return false;
}

function splitLines(text: string): string[] {
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/** שאלות שהכלי החזיר ב-ask בתור הזה. הן נשארות גם אם מסנן אחר היה מוריד אותן. */
export function collectToolAsks(into: string[], result: unknown): void {
  if (!result || typeof result !== "object") return;
  const ask = (result as { ask?: unknown }).ask;
  const list = Array.isArray(ask) ? ask : ask == null ? [] : [ask];
  for (const item of list) {
    const s = String(item || "").trim();
    if (s && !into.includes(s)) into.push(s);
  }
}

export function lineCarriesToolAsk(line: string, asks: readonly string[]): boolean {
  const n = normQ(line);
  return asks.some((ask) => {
    const a = normQ(ask).replace(/\?+$/, "").trim();
    return a.length >= 4 && n.includes(a);
  });
}

/**
 * מוריד רק שאלה שכבר נענתה על אותו אדם, תפריט כשיש קריאה אחת, והערת צד
 * על פגישה אחרת. שאלה חוסמת נשארת, וכך גם ask שהכלי החזיר בתור הזה.
 * טיוטת הודעה ללקוח/ה אינה נגע בה. תשובה שהתרוקנה נשארת כמו שהמודל כתב.
 */
export function shapeAgentReply(
  text: string,
  opts: { userText: string; history: readonly HistoryMsg[]; toolAsks?: readonly string[] },
): string {
  const settled = activeSettled(opts.history, opts.userText);
  const asks = opts.toolAsks || [];
  const blocks = text.split(/\n{2,}/);
  const shaped = blocks.map((block) => {
    if (isCustomerDraft(block)) {
      const keptDraft = splitLines(block).filter((line) =>
        !line.includes("?") ||
        lineCarriesToolAsk(line, asks) ||
        (!repeatsSettled(line, settled) && !isChoiceMenu(line, opts.userText))
      );
      return keptDraft.join("\n");
    }
    const kept = splitLines(block).filter((line) =>
      lineCarriesToolAsk(line, asks) ||
      (!isUnsolicitedAside(line, opts.userText) &&
        !repeatsSettled(line, settled) &&
        !isChoiceMenu(line, opts.userText))
    );
    return kept.join("\n");
  }).filter(Boolean);
  const out = shaped.join("\n\n").trim();
  return out || text.trim();
}
