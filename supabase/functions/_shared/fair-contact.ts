// לחיצת וואטסאפ או חיוג על נכס ביריד. הגוף נשמר קטן, בלי שם ובלי טלפון.
// הגיבוב של ה-IP נעשה כאן ורק כאן: המלח אינו יוצא לדפדפן.
// הכתיבה עצמה ב-fair_contact_click (המיגרציה), לא כאן.

export const SOURCE_PAGES = ["property", "swipe", "open_house"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[a-f0-9]{32}$/;
// מלח חלופי כש-FAIR_CONTACT_IP_SALT עוד לא הוגדר. גיבוב בלי מלח סודי
// ניתן לפענוח ברשת כתובות, ולכן בסוד האמיתי מחליפים אותו. אינו נשלח ללקוח.
const FALLBACK_SALT = "fair-contact-v1";
export const MAX_BODY = 2048;

export type ClickChannel = "whatsapp" | "call";

export type ClickValue = {
  property_id: string;
  channel: ClickChannel;
  source_page: string | null;
  client_session: string | null;
};

export type FairContactArgs = {
  p_property_id: string;
  p_channel: string;
  p_source_page: string | null;
  p_ip_hash: string | null;
  p_client_session: string | null;
};

export type FairContactCall = (args: FairContactArgs) => Promise<{
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}>;

export function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const hop = fwd.split(",")[0].trim();
  if (!hop || hop.length > 64 || /\s/.test(hop)) return "";
  return hop;
}

export async function hashIp(ip: string, salt: string): Promise<string | null> {
  const clean = ip.trim();
  if (!clean) return null;
  const pepper = salt || FALLBACK_SALT;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(clean + "|" + pepper),
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// האפליקציה מזוהה מה-User-Agent, לא ממה שהדפדפן טוען. בלי זה כל גולש
// יכול לשלוח source_page=app.
export function sourcePage(claimed: unknown, userAgent: string): string | null {
  if (/ShukNadlanApp\//.test(userAgent)) return "app";
  if (typeof claimed === "string" && (SOURCE_PAGES as readonly string[]).includes(claimed)) {
    return claimed;
  }
  return null;
}

export function parseClick(
  body: unknown,
  userAgent: string,
): { ok: true; value: ClickValue } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_json" };
  }
  const row = body as Record<string, unknown>;
  const propertyId = typeof row.property_id === "string" ? row.property_id.trim().toLowerCase() : "";
  if (!UUID_RE.test(propertyId)) return { ok: false, error: "missing_fields" };
  if (row.channel !== "whatsapp" && row.channel !== "call") {
    return { ok: false, error: "bad_channel" };
  }
  const session = typeof row.client_session === "string" && SESSION_RE.test(row.client_session)
    ? row.client_session
    : null;
  return {
    ok: true,
    value: {
      property_id: propertyId,
      channel: row.channel,
      source_page: sourcePage(row.source_page, userAgent),
      client_session: session,
    },
  };
}

export function httpStatus(error: string): number {
  if (error === "rate_limited") return 429;
  if (error === "not_found" || error === "not_in_fair") return 404;
  if (error === "bad_channel" || error === "missing_fields" || error === "invalid_json" || error === "payload_too_large") {
    return 400;
  }
  return 500;
}

export async function handleFairContact(req: Request, deps: {
  salt: string;
  call: FairContactCall;
}): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (raw.length > MAX_BODY) return json({ error: "payload_too_large" }, 400);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseClick(body, req.headers.get("user-agent") || "");
  if (!parsed.ok) return json({ error: parsed.error }, httpStatus(parsed.error));

  const ipHash = await hashIp(clientIp(req), deps.salt);
  let data: Record<string, unknown> | null = null;
  let error: { message: string } | null = null;
  try {
    const out = await deps.call({
      p_property_id: parsed.value.property_id,
      p_channel: parsed.value.channel,
      p_source_page: parsed.value.source_page,
      p_ip_hash: ipHash,
      p_client_session: parsed.value.client_session,
    });
    data = out.data;
    error = out.error;
  } catch {
    return json({ error: "db_error" }, 500);
  }
  if (error || !data) return json({ error: "db_error" }, 500);
  if (data.ok !== true) {
    const code = typeof data.error === "string" ? data.error : "db_error";
    return json({ error: code }, httpStatus(code));
  }
  return json({
    ok: true,
    logged: true,
    duplicate: data.duplicate === true,
    ref: data.ref ?? null,
    created_at: data.created_at ?? null,
    fair_end: data.fair_end ?? null,
    channel: data.channel ?? null,
    status: data.status ?? null,
  });
}
