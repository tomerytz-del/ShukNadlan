// איך גבריאלה עונה לסוכן/ת. הכללים גם ב-SYSTEM_STATIC; כאן מה שהמודל מפספס
// חוזר בקוד: שאלה שכבר נענתה, תזכורת על נושא אחר, ותפריט כשיש קריאה אחת.
// ‏2.11.2026, משוב: "גבריאלה מוסיפה עבודה ולא עוזרת".

export interface HistoryMsg {
  role?: string;
  content?: unknown;
}

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

/** שאלות שכבר נענו. "כן" נחשב תשובה. ההודעה הנוכחית עוד אינה בהיסטוריה. */
export function settledFromHistory(history: readonly HistoryMsg[], currentUserText = ""): SettledAnswer[] {
  const out: SettledAnswer[] = [];
  const seen = new Set<string>();
  const push = (q: string, a: string) => {
    const key = q.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key) || !isClearAnswer(a)) return;
    seen.add(key);
    out.push({ q: clip(key, 140), a: clip(a, 140) });
  };
  for (let i = 0; i < history.length; i++) {
    if (history[i].role !== "assistant") continue;
    const qs = questionsIn(messageText(history[i].content));
    if (!qs.length) continue;
    let answer = "";
    for (let j = i + 1; j < history.length; j++) {
      if (history[j].role === "user") {
        answer = messageText(history[j].content);
        break;
      }
    }
    if (!answer && i === lastAssistant(history)) answer = currentUserText;
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

const NOT_A_PERSON = new Set(["היום", "מחר", "השבוע", "הבוקר", "הערב", "צהריים", "אחר"]);

/** "פגישה עם עליזה" / "להתקשר לרונית" - השם הפרטי, בלי מקום. */
export function personNameFromTitle(title: string): string | null {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = /(?:^|\s)(?:עם|ל)\s+([א-ת]{2,12})/.exec(t);
  if (!m || NOT_A_PERSON.has(m[1])) return null;
  return m[1];
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
  const settled = settledFromHistory(history, userText);
  if (settled.length) {
    lines.push("כבר נענה בשיחה הזו, ואין לשאול שוב (גם לא \"ועוד דבר אחד\". \"כן\" הוא תשובה):");
    for (const s of settled) lines.push(`- ${s.q} = ${s.a}`);
  }
  const reading = likelyReading(userText);
  if (reading) lines.push(reading);
  const offered = offeredNames(history);
  if (offered.length) lines.push(`כבר הוצע להוסיף לקובץ, ואין להציע שוב: ${offered.join(", ")}.`);
  return lines.join("\n");
}

const SAME_TIME_OK = /באותה שעה כבר קבוע/;
const ENRICH_Q = /קנייה|שכירות|בעל|טלפון|לקובץ הלקוחות|כלקוח/;
const MENU = /לבטל|להזיז|להשאיר|אפשרות/;

function isUnsolicitedAside(line: string, userText: string): boolean {
  if (SAME_TIME_OK.test(line)) return false;
  // סיכום הקלטה או מסמך הוא רשימת פעולות, לא תוספת על נושא אחר.
  if (/\[הקלטת שיחה|\[מסמך|\[ייבוא נכסים/.test(userText)) return false;
  if (/מה יש לי|היומן|תזכיר|תזכורת/.test(userText)) return false;
  // "שים לב שיש גם פגישה" ו"תזכורת: היום ב-13:00 פגישה עם חגי" הן תוספת.
  // "קבעתי תזכורת למחר" היא האישור עצמו, והיא לא מתחילה במילה תזכורת.
  if (/שים לב|שימי לב|יש לך גם|להזיז אחת|התנגשות/.test(line)) {
    return /פגישה|סיור|שעה|\d{1,2}:\d{2}/.test(line);
  }
  return /^תזכורת[:\s]/.test(line);
}

function normQ(s: string): string {
  return s.replace(/[^\u0590-\u05FFA-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function repeatsSettled(line: string, settled: readonly SettledAnswer[]): boolean {
  if (!line.includes("?")) return false;
  const n = normQ(line);
  return settled.some((s) => {
    const tokens = normQ(s.q).split(" ").filter((w) => w.length >= 3);
    const hit = tokens.filter((w) => n.includes(w));
    return hit.length >= 2;
  });
}

function isEnrichmentQuestion(line: string): boolean {
  if (!ENRICH_Q.test(line)) return false;
  if (line.includes("?")) return true;
  // "תגידי קנייה או שכירות ותשלחי טלפון" בלי סימן שאלה, אחרי שבירת השורה.
  return /תגיד|תשלח|כתבי|כתוב|קנייה או|שכירות או/.test(line);
}

function isChoiceMenu(line: string, userText: string): boolean {
  if (!likelyReading(userText)) return false;
  if (/^\s*\d+[.)]/.test(line)) return true;
  if (/^(לבטל|להזיז|להשאיר)\b/.test(line.trim())) return true;
  if (!line.includes("?")) return false;
  const not = /(?:ולא|לא)\s+עם\s+([א-ת]{2,12})/.exec(userText);
  if (not && line.includes(not[1])) return true;
  return MENU.test(line);
}

function splitLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\n+/)) {
    for (const part of raw.split(/(?<=\?)\s+/)) {
      const s = part.trim();
      if (s) lines.push(s);
    }
  }
  return lines;
}

function nameIn(text: string): string | null {
  const m = /(?:את|עם|ל)\s+([א-ת]{2,12})/.exec(text);
  return m && !NOT_A_PERSON.has(m[1]) ? m[1] : null;
}

/**
 * מוריד מהתשובה מה שהכלל אוסר: שאלה שנייה, תזכורת על נושא אחר, תפריט,
 * ושאלה על העשרה. שורת "באותה שעה כבר קבוע" נשארת. תשובה שהתרוקנה נשארת
 * כמו שהמודל כתב - עדיף משתיקה.
 */
export function shapeAgentReply(
  text: string,
  opts: { userText: string; history: readonly HistoryMsg[] },
): string {
  const settled = settledFromHistory(opts.history, opts.userText);
  const kept: string[] = [];
  let strippedOfferName: string | null = null;
  for (const line of splitLines(text)) {
    if (isUnsolicitedAside(line, opts.userText)) continue;
    if (repeatsSettled(line, settled)) continue;
    if (isChoiceMenu(line, opts.userText)) continue;
    if (isEnrichmentQuestion(line)) {
      strippedOfferName = strippedOfferName || nameIn(line) || nameIn(opts.userText);
      continue;
    }
    kept.push(line);
  }
  const qAt = kept.map((line, i) => line.includes("?") ? i : -1).filter((i) => i >= 0);
  if (qAt.length > 1) {
    for (let i = qAt.length - 2; i >= 0; i--) kept.splice(qAt[i], 1);
  }
  const offerName = strippedOfferName;
  if (offerName && !offerAlready(opts.history, offerName) && !kept.some((line) => line.includes(offerName) && line.includes("קובץ"))) {
    kept.push(clientOfferLine(offerName));
  }
  const out = kept.join("\n").trim();
  return out || text.trim();
}
