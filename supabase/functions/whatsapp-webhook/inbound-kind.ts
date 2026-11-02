/** תגובת אימוג'י על הודעה (type reaction). אין תשובה ואין קריאה למודל. */
export function isReactionMessage(msg: { type?: unknown } | null | undefined): boolean {
  return String(msg?.type || "") === "reaction";
}
