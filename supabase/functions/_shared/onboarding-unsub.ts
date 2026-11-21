// ============================================================================
// קישור הסרה מתזכורות מדריך ההתחלה (יזמים ובעלי מקצוע)
//
// הקישור בתחתית כל מייל תזכורת מסמן את שתי התזכורות כנשלחו. **ההרשאה היא חתימה**: ‏HMAC-SHA256 על
// "סוג.מזהה" בסוד שכבר קיים (‏ALERT_CRON_SECRET), ולכן אין עמודת טוקן במסד ואין סוד חדש לנהל. הקישור
// מזהה שורה אחת בלבד ואינו חושף את קישור העריכה האישי. בלי הסוד (לא מוגדר) אין קישור: **נכשל סגור**,
// כמו _shared/cron-auth.ts, והפונקציה ששולחת מדלגת על המייל במקום לשלוח הודעה בלי דרך הסרה.
// ============================================================================

const SECRET = Deno.env.get("ALERT_CRON_SECRET") || "";
const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

export type UnsubKind = "developer" | "professional";
const KIND_CODE: Record<UnsubKind, string> = { developer: "d", professional: "p" };
const CODE_KIND: Record<string, UnsubKind> = { d: "developer", p: "professional" };

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** השוואה בזמן קבוע (‏=== יוצא ברגע שהתו הראשון נבדל). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function unsubConfigured(): boolean {
  return SECRET.length > 0;
}

/** כתובת ההסרה, או null כשהסוד אינו מוגדר. */
export async function unsubUrl(kind: UnsubKind, id: string): Promise<string | null> {
  if (!SECRET) return null;
  const sig = await hmacHex(`${KIND_CODE[kind]}.${id}`);
  const token = `${KIND_CODE[kind]}.${id}.${sig}`;
  return `${FUNCTIONS_BASE}/onboarding-reminders-unsubscribe?t=${encodeURIComponent(token)}`;
}

/** מאמת טוקן ומחזיר את הסוג והמזהה, או null כשהחתימה שגויה. */
export async function verifyUnsubToken(token: string): Promise<{ kind: UnsubKind; id: string } | null> {
  if (!SECRET) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [code, id, sig] = parts;
  const kind = CODE_KIND[code];
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = await hmacHex(`${code}.${id}`);
  return timingSafeEqual(expected, sig) ? { kind, id } : null;
}
