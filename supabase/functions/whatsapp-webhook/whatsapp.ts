// עטיפה דקה מעל Meta WhatsApp Cloud API (Graph API).
// כל הקריאות היוצאות לוואטסאפ עוברות דרך כאן.

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

// מגבלת גוף הודעת טקסט ב-Cloud API. גזירה עדיפה על 400 מ-Meta ואפס תשובה לסוכן/ת.
const MAX_TEXT_LEN = 4096;

function authHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

/** שולחת הודעת טקסט לסוכן/ת. זורקת אם Meta החזירה שגיאה. */
export async function sendText(to: string, body: string): Promise<void> {
  const text = body.length > MAX_TEXT_LEN
    ? body.slice(0, MAX_TEXT_LEN - 1) + "…"
    : body;

  const res = await fetch(`${GRAPH_BASE}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  if (!res.ok) {
    throw new Error(`whatsapp send failed ${res.status}: ${await res.text()}`);
  }
}

/**
 * מסמנת את ההודעה כנקראה (הסימון הכחול) ומדליקה חיווי "מקליד…".
 * נכשלת בשקט: זה קישוט UX, לא חלק מהזרימה.
 */
export async function markReadAndTyping(messageId: string): Promise<void> {
  try {
    await fetch(`${GRAPH_BASE}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch (err) {
    console.warn("mark read failed", err);
  }
}

/**
 * מורידה מדיה (תמונה/אודיו) בשני שלבים כפי שה-Cloud API מחייב:
 * ‏GET על ה-media id מחזיר URL זמני, וההורדה ממנו דורשת שוב את ה-Bearer token.
 */
export async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: authHeaders(),
  });
  if (!metaRes.ok) {
    throw new Error(
      `media lookup failed ${metaRes.status}: ${await metaRes.text()}`,
    );
  }
  const meta = await metaRes.json();

  const fileRes = await fetch(meta.url, { headers: authHeaders() });
  if (!fileRes.ok) {
    throw new Error(`media download failed ${fileRes.status}`);
  }

  return {
    bytes: new Uint8Array(await fileRes.arrayBuffer()),
    mimeType: (meta.mime_type || "application/octet-stream").split(";")[0],
  };
}

/**
 * אימות חתימת הוובהוק (X-Hub-Signature-256) מול ה-App Secret.
 * בלי זה כל אחד שיודע את כתובת הפונקציה יכול להתחזות ל-Meta ולהפעיל
 * פעולות בשם סוכן/ת — הפונקציה חשופה בלי JWT, אז זו שכבת האימות היחידה.
 */
export async function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) return false;

  // השוואה בזמן קבוע — השוואת מחרוזות רגילה מדליפה כמה תווים התאימו
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}
