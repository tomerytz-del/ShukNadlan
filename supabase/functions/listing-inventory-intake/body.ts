// קריאת גוף מוגבלת בבתים. Content-Length מעל התקרה נדחה לפני הקריאה.
// בלי הכותרת, או כשהיא קטנה מהגוף, הזרם נעצר ברגע שעוברים את התקרה.

export const MAX_BODY_BYTES = 1_000_000;

export interface LimitedBodySource {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export async function readLimitedBody(
  req: LimitedBodySource,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ ok: true; raw: string } | { ok: false; error: "payload_too_large" }> {
  const declared = req.headers.get("content-length");
  if (declared !== null && declared !== "") {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0 || n > maxBytes) {
      return { ok: false, error: "payload_too_large" };
    }
  }

  const stream = req.body;
  if (!stream) return { ok: true, raw: "" };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // הזרם כבר נסגר
      }
      return { ok: false, error: "payload_too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, raw: new TextDecoder().decode(bytes) };
}
