// כפתורי "רלוונטי / לא רלוונטי" על ריכוז ההתאמות (match_digest).
//
// ‏notification-push מצמיד את הכפתורים לסיכום (matchDigestButtons), והוובהוק
// עונה על הלחיצה בלי מודל (matchFeedbackReply). המזהה נושא את ההתאמה או את
// הסיכום, כי הכותרת לבדה ("👍 רלוונטי") אינה אומרת על איזו התאמה עונים.
//
//   mfb:r:<alert>         רלוונטי
//   mfb:n:<alert>         לא רלוונטי
//   mfb:p:<alert>         בחירת התאמה מהרשימה -> שני הכפתורים עליה
//   mfb:l:<notification>  סיכום עם כמה התאמות -> רשימה לבחירה
//
// הקובץ מיובא גם מ-notification-push, ולכן אין בו ייבוא שאינו טיפוס.
// ‏docs/client-matching.md, "משוב מהוואטסאפ".

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const MF_RELEVANT = "👍 רלוונטי";
export const MF_NOT_RELEVANT = "👎 לא רלוונטי";
export const MF_MARK = "✅ סימון התאמות";
export const MF_LIST_BUTTON = "בחירת התאמה";
export const MF_LIST_SECTION = "התאמות מהסיכום";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
const BUTTON_RE = new RegExp(`^mfb:(r|n|p|l):(${UUID})$`, "i");

export type MatchRow = {
  alert_id: string;
  client_name: string | null;
  property_title: string | null;
  score: number | null;
  feedback: string | null;
  total: number | null;
};

export type ReplyButton = { id: string; title: string };

export type MatchFeedbackOut =
  | { kind: "text"; text: string }
  | { kind: "buttons"; body: string; buttons: ReplyButton[] }
  | {
    kind: "list";
    body: string;
    button: string;
    section: string;
    rows: { id: string; title: string; description: string }[];
  };

export function parseMatchFeedbackButton(
  buttonId: string,
): { action: "relevant" | "not_relevant" | "pick" | "list"; id: string } | null {
  const m = BUTTON_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const letter = m[1].toLowerCase();
  return {
    action: letter === "r" ? "relevant" : letter === "n" ? "not_relevant" : letter === "p" ? "pick" : "list",
    id: m[2].toLowerCase(),
  };
}

/** שני הכפתורים על התאמה אחת. */
export function feedbackButtons(alertId: string): ReplyButton[] | null {
  if (!UUID_RE.test(alertId)) return null;
  const id = alertId.toLowerCase();
  return [
    { id: `mfb:r:${id}`, title: MF_RELEVANT },
    { id: `mfb:n:${id}`, title: MF_NOT_RELEVANT },
  ];
}

/**
 * הכפתורים לסיכום: התאמה אחת - רלוונטי / לא רלוונטי ישירות; כמה - כפתור אחד
 * שפותח רשימה. אפס (סיכום שכולו "נכס שלך מתאים ללקוח/ה של...") - בלי כפתורים.
 * הכפתור השלישי, הקישור ל-CRM, מצטרף ב-notification-push.
 */
export function matchDigestButtons(notificationId: string, rows: MatchRow[]): ReplyButton[] | null {
  if (!UUID_RE.test(notificationId) || rows.length === 0) return null;
  const total = Number(rows[0].total ?? rows.length);
  if (total === 1) return feedbackButtons(rows[0].alert_id);
  return [{ id: `mfb:l:${notificationId.toLowerCase()}`, title: MF_MARK }];
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…";
}

function matchLine(row: { client_name: string | null; property_title: string | null; score: number | null }): string {
  const who = (row.client_name || "הלקוח/ה").trim();
  const what = (row.property_title || "הנכס").trim();
  const pct = row.score != null ? ` (${row.score}%)` : "";
  return `"${what}" ל${who}${pct}`;
}

/** הרשימה: שורה לכל התאמה, השם בכותרת (24) והנכס בתיאור (72). */
export function matchListRows(rows: MatchRow[]): { id: string; title: string; description: string }[] {
  return rows.slice(0, 10).filter((r) => UUID_RE.test(r.alert_id)).map((r) => ({
    id: `mfb:p:${r.alert_id.toLowerCase()}`,
    title: clip((r.client_name || "לקוח/ה").trim(), 24),
    description: clip(
      `"${(r.property_title || "נכס").trim()}"${r.score != null ? ` ${r.score}%` : ""}` +
        (r.feedback === "relevant" ? " · סומן רלוונטי" : ""),
      72,
    ),
  }));
}

export function feedbackDoneText(
  feedback: "relevant" | "not_relevant",
  row: { client_name: string | null; property_title: string | null },
): string {
  const who = (row.client_name || "הלקוח/ה").trim();
  const what = (row.property_title || "הנכס").trim();
  return feedback === "relevant"
    ? `סימנתי ש"${what}" רלוונטי ל${who}. אפשר לבקש ממני מיניסייט ל${who} עם הנכס.`
    : `הורדתי את "${what}" מההתאמות של ${who}. הוא לא יופיע שוב בסיכומים.`;
}

async function rpcRows<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T[] | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`${fn} failed`, error.message);
    return null;
  }
  return Array.isArray(data) ? data as T[] : [];
}

/** התשובה ללחיצה. null = המזהה אינו שלנו. */
export async function matchFeedbackReply(
  supabase: SupabaseClient,
  agentId: string,
  buttonId: string,
): Promise<MatchFeedbackOut | null> {
  const parsed = parseMatchFeedbackButton(buttonId);
  if (!parsed) return null;
  const failed: MatchFeedbackOut = {
    kind: "text",
    text: "לא הצלחתי לשמור את הסימון. אפשר לסמן את ההתאמה ב-CRM, בהתראות ההתאמה.",
  };

  if (parsed.action === "relevant" || parsed.action === "not_relevant") {
    const rows = await rpcRows<{ client_name: string | null; property_title: string | null }>(
      supabase, "match_feedback_set", { p_agent: agentId, p_alert: parsed.id, p_feedback: parsed.action },
    );
    if (rows == null) return failed;
    if (rows.length === 0) {
      return { kind: "text", text: "ההתאמה הזו כבר לא קיימת אצלך (הלקוח/ה או הנכס נסגרו או נמחקו)." };
    }
    return { kind: "text", text: feedbackDoneText(parsed.action, rows[0]) };
  }

  if (parsed.action === "pick") {
    const { data, error } = await supabase
      .from("client_match_alerts")
      .select("id, score, agent_clients(full_name), properties(title)")
      .eq("id", parsed.id)
      .eq("agent_id", agentId)
      .maybeSingle();
    if (error) {
      console.error("match pick failed", error.message);
      return failed;
    }
    const buttons = data ? feedbackButtons(String(data.id)) : null;
    if (!data || !buttons) {
      return { kind: "text", text: "ההתאמה הזו כבר לא קיימת אצלך (הלקוח/ה או הנכס נסגרו או נמחקו)." };
    }
    const one = (v: unknown, key: string): string | null => {
      const row = Array.isArray(v) ? v[0] : v;
      const val = row && typeof row === "object" ? (row as Record<string, unknown>)[key] : null;
      return typeof val === "string" ? val : null;
    };
    const line = matchLine({
      client_name: one(data.agent_clients, "full_name"),
      property_title: one(data.properties, "title"),
      score: typeof data.score === "number" ? data.score : null,
    });
    return { kind: "buttons", body: `${line}. רלוונטי?`, buttons };
  }

  const rows = await rpcRows<MatchRow>(
    supabase, "match_digest_alerts", { p_agent: agentId, p_notification: parsed.id, p_limit: 10 },
  );
  if (rows == null) return failed;
  if (rows.length === 0) {
    return { kind: "text", text: "אין בסיכום הזה התאמות פתוחות לסימון. הרשימה המלאה ב-CRM, בהתראות ההתאמה." };
  }
  if (rows.length === 1) {
    const buttons = feedbackButtons(rows[0].alert_id);
    if (!buttons) return failed;
    return { kind: "buttons", body: `${matchLine(rows[0])}. רלוונטי?`, buttons };
  }
  const total = Number(rows[0].total ?? rows.length);
  const more = total > rows.length ? ` מוצגות ${rows.length} הראשונות מתוך ${total}, השאר ב-CRM.` : "";
  return {
    kind: "list",
    body: `על איזו התאמה לסמן?${more}`,
    button: MF_LIST_BUTTON,
    section: MF_LIST_SECTION,
    rows: matchListRows(rows),
  };
}
