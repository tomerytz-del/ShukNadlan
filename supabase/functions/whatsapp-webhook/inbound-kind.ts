/** תגובת אימוג'י על הודעה (type reaction). אין תשובה ואין קריאה למודל. */
export function isReactionMessage(msg: { type?: unknown } | null | undefined): boolean {
  return String(msg?.type || "") === "reaction";
}

/** תגובה אינה הודעה נכנסת: לא פותחת את חלון 24 השעות ולא נספרת במכסה. */
export function countsAsInbound(msgType: unknown): boolean {
  return String(msgType || "") !== "reaction";
}

/** ההודעה הנכנסת האחרונה שאינה תגובה. */
export function latestRealInbound(
  rows: readonly { created_at?: unknown; msg_type?: unknown }[],
): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const row of rows) {
    if (!countsAsInbound(row.msg_type)) continue;
    const at = String(row.created_at || "");
    const ms = Date.parse(at);
    if (!at || !Number.isFinite(ms) || ms < bestMs) continue;
    best = at;
    bestMs = ms;
  }
  return best;
}
