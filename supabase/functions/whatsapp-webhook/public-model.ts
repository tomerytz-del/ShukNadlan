// המודל של הבוט הציבורי. הסוד גובר. בלי סוד, Opus 5.5 דולק רק כשהדגל 1.
// חסר, 0, או קריאה שנכשלה: נשאר Opus 5, כמו לפני ה-PR הזה.

export const PUBLIC_MODEL_CURRENT = "claude-opus-5";
export const PUBLIC_MODEL_NEXT = "claude-opus-5-5";
export const PUBLIC_MODEL_FLAG = "gabriela_public_opus_55";

export function publicBotModel(envValue: string | null | undefined, flagValue: unknown): string {
  const env = String(envValue ?? "").trim();
  if (env) return env;
  if (flagValue == null || flagValue === "") return PUBLIC_MODEL_CURRENT;
  const n = Number(flagValue);
  if (!Number.isFinite(n) || n === 0) return PUBLIC_MODEL_CURRENT;
  return PUBLIC_MODEL_NEXT;
}
