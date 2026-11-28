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
// אילו התאמות סיכום כיסה - notifications.match_alert_ids, שהסיכום כותב בעצמו.
// הקובץ מיובא גם מ-notification-push, ולכן מה שהוא מייבא הוא טיפוסים או
// photo-target.ts (בלי תלויות). ‏docs/client-matching.md, "משוב מהוואטסאפ".

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { OutboxItem } from "./lookup_turn.ts";
import { clipTitle } from "./photo-target.ts";

export const MF_RELEVANT = "👍 רלוונטי";
export const MF_NOT_RELEVANT = "👎 לא רלוונטי";
export const MF_MARK = "✅ סימון התאמות";
export const MF_LIST_BUTTON = "בחירת התאמה";
export const MF_LIST_SECTION = "התאמות מהסיכום";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
const BUTTON_RE = new RegExp(`^mfb:(r|n|p|l):(${UUID})$`, "i");
const ACTIONS = { r: "relevant", n: "not_relevant", p: "pick", l: "list" } as const;

const IN_CRM = "ב-CRM, בהתראות ההתאמה";
const GONE = "ההתאמה הזו כבר לא קיימת אצלך (הלקוח/ה או הנכס נסגרו או נמחקו).";
const FAILED = `לא הצלחתי לשמור את הסימון. אפשר לסמן את ההתאמה ${IN_CRM}.`;

export type MatchRow = {
  alert_id: string;
  client_name: string | null;
  property_title: string | null;
  score: number | null;
  feedback: string | null;
  total: number | null;
};

export type ReplyButton = { id: string; title: string };

/** אותה צורה כמו listingActionReply: טקסט, או פריט אחד ל-sendOutbox. */
export type MatchFeedbackOut = { text?: string; outbox?: OutboxItem[] };

export function parseMatchFeedbackButton(
  buttonId: string,
): { action: (typeof ACTIONS)[keyof typeof ACTIONS]; id: string } | null {
  const m = BUTTON_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  return { action: ACTIONS[m[1].toLowerCase() as keyof typeof ACTIONS], id: m[2].toLowerCase() };
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

function names(row: { client_name: string | null; property_title: string | null }): { who: string; what: string } {
  return { who: (row.client_name || "").trim() || "הלקוח/ה", what: (row.property_title || "").trim() || "הנכס" };
}

function ask(row: {
  alert_id: string;
  client_name: string | null;
  property_title: string | null;
  score: number | null;
  dismissed?: boolean;
}): MatchFeedbackOut {
  const buttons = feedbackButtons(row.alert_id);
  if (!buttons) return { text: FAILED };
  const { who, what } = names(row);
  const pct = row.score != null ? ` (${row.score}%)` : "";
  // התאמה שסומנה "לא רלוונטי" (שורה ברשימה ישנה) נשארת לבחירה בכוונה: "רלוונטי"
  // מחזיר אותה. כאן רק אומרים לסוכן/ת שהיא מסומנת.
  const note = row.dismissed ? " כרגע מסומנת לא רלוונטית." : "";
  return { outbox: [{ kind: "buttons", body: `"${what}" ל${who}${pct}.${note} רלוונטי?`, buttons }] };
}

/** הרשימה: שורה לכל התאמה, השם בכותרת (24) והנכס בתיאור (72). */
export function matchListRows(rows: MatchRow[]): { id: string; title: string; description: string }[] {
  return rows.slice(0, 10).map((r) => {
    const { who, what } = names(r);
    return {
      id: `mfb:p:${r.alert_id.toLowerCase()}`,
      title: clipTitle(who, 24),
      description: clipTitle(
        `"${what}"${r.score != null ? ` ${r.score}%` : ""}${r.feedback === "relevant" ? " · סומן רלוונטי" : ""}`,
        72,
      ),
    };
  });
}

export function feedbackDoneText(
  feedback: "relevant" | "not_relevant",
  row: { client_name: string | null; property_title: string | null },
): string {
  const { who, what } = names(row);
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

  if (parsed.action === "relevant" || parsed.action === "not_relevant") {
    const rows = await rpcRows<{ client_name: string | null; property_title: string | null }>(
      supabase, "match_feedback_set", { p_agent: agentId, p_alert: parsed.id, p_feedback: parsed.action },
    );
    if (rows == null) return { text: FAILED };
    return { text: rows.length ? feedbackDoneText(parsed.action, rows[0]) : GONE };
  }

  if (parsed.action === "pick") {
    // שני ה-embeds רבים-לאחד, עם מפתח זר אחד כל אחד, ולכן PostgREST מחזיר
    // אותם כאובייקט (הטיפוסים של הלקוח הלא-מוקלד אומרים מערך, ולכן ה-cast).
    // לקוח/ה או נכס שאינם פעילים - כמו ב-match_feedback_set: ההתאמה כבר לא קיימת.
    const { data, error } = await supabase
      .from("client_match_alerts")
      .select("id, score, status, agent_clients(full_name, status), properties(title, status)")
      .eq("id", parsed.id)
      .eq("agent_id", agentId)
      .maybeSingle();
    if (error) {
      console.error("match pick failed", error.message);
      return { text: FAILED };
    }
    const row = data as unknown as {
      score: number | null;
      status: string | null;
      agent_clients: { full_name: string | null; status: string | null } | null;
      properties: { title: string | null; status: string | null } | null;
    } | null;
    if (!row || row.agent_clients?.status !== "active" || row.properties?.status !== "active") return { text: GONE };
    return ask({
      alert_id: parsed.id,
      client_name: row.agent_clients?.full_name ?? null,
      property_title: row.properties?.title ?? null,
      score: row.score ?? null,
      dismissed: row.status === "dismissed",
    });
  }

  const rows = await rpcRows<MatchRow>(
    supabase, "match_digest_alerts", { p_agent: agentId, p_notification: parsed.id, p_limit: 10 },
  );
  if (rows == null) return { text: FAILED };
  if (rows.length === 0) return { text: `אין בסיכום הזה התאמות פתוחות לסימון. הרשימה המלאה ${IN_CRM}.` };
  if (rows.length === 1) return ask(rows[0]);
  const total = Number(rows[0].total ?? rows.length);
  const more = total > rows.length ? ` מוצגות ${rows.length} הראשונות מתוך ${total}, השאר ${IN_CRM}.` : "";
  return {
    outbox: [{
      kind: "list",
      body: `על איזו התאמה לסמן?${more}`,
      button: MF_LIST_BUTTON,
      section: MF_LIST_SECTION,
      rows: matchListRows(rows),
    }],
  };
}
