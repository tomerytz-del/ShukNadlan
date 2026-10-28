// הסוכן/ת משיב/ה על התראה, או אומר/ת "הפגישה" בלי לצטט אותה.
// הדחיפות אינן נכנסות להיסטוריית השיחה, ו-context.id של וואטסאפ לא נקרא.
// כאן רק הניסוח. הקריאה למסד ב-reply-context.ts.

export interface InboundContext {
  id?: string;
  forwarded?: boolean;
  frequently_forwarded?: boolean;
}

/** מזהה ההודעה שעונים עליה. העברה אינה תשובה. */
export function inboundReplyId(msg: { context?: InboundContext | null }): string | null {
  const id = String(msg.context?.id || "").trim();
  if (!id) return null;
  if (msg.context?.forwarded || msg.context?.frequently_forwarded) return null;
  return id;
}

export function replyPrefix(found: { title?: string | null; body?: string | null } | null): string {
  if (!found) return "";
  const text = [found.title, found.body].filter(Boolean).join(" - ").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) return "";
  return `[הסוכן/ת משיב/ה על הודעה שנשלחה: ${text}]\n`;
}

export function recentPushesNote(items: { at: string; text: string }[]): string {
  const lines = items
    .map((i) => `- ${i.at}: ${i.text.replace(/\s+/g, " ").trim().slice(0, 180)}`)
    .filter((l) => l.length > 4)
    .slice(0, 8);
  if (!lines.length) return "";
  return "התראות שנשלחו אליך בוואטסאפ בשעתיים האחרונות " +
    "(הסוכן/ת עלול/ה להתייחס אליהן בלי לצטט, למשל \"תבטל את זה\"):\n" +
    lines.join("\n");
}

export function ilShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
