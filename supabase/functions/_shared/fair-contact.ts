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

// כתובת שלא עברה אימות נופלת לאותו דלי. מי שמזייף את הכותרת או משמיט
// אותה אינו מקבל דלי חדש לכל בקשה.
export const SHARED_IP_KEY = "shared";

function isIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

function isIpv6(s: string): boolean {
  let v = s;
  const zone = v.indexOf("%");
  if (zone >= 0) {
    if (!/^[A-Za-z0-9]+$/.test(v.slice(zone + 1))) return false;
    v = v.slice(0, zone);
  }
  if (!v || !/^[0-9A-Fa-f:.]+$/.test(v)) return false;
  const lower = v.toLowerCase();
  const lastColon = lower.lastIndexOf(":");
  let head = lower;
  if (lastColon >= 0 && lower.slice(lastColon + 1).includes(".")) {
    if (!isIpv4(lower.slice(lastColon + 1))) return false;
    head = lower.slice(0, lastColon) + ":0";
  }
  if (head.includes(":::")) return false;
  const halves = head.split("::");
  if (halves.length > 2) return false;
  const groups = (side: string) => side === "" ? [] : side.split(":");
  const hex = (g: string) => /^[0-9a-f]{1,4}$/.test(g);
  if (halves.length === 2) {
    const left = groups(halves[0]);
    const right = groups(halves[1]);
    if (left.length + right.length > 7) return false;
    return [...left, ...right].every(hex);
  }
  const all = groups(head);
  return all.length === 8 && all.every(hex);
}

// מקלף סוגריים ויציאה, ומחזיר כתובת קנונית. כל השאר ריק.
export function normalizeIp(raw: string): string {
  let s = raw.trim();
  if (!s || s.length > 80 || /[\s,]/.test(s)) return "";
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end < 2) return "";
    const rest = s.slice(end + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return "";
    if (rest && Number(rest.slice(1)) > 65535) return "";
    s = s.slice(1, end);
  } else {
    const port = s.match(/^(.*):(\d{1,5})$/);
    if (port && isIpv4(port[1])) {
      if (Number(port[2]) > 65535) return "";
      s = port[1];
    }
  }
  if (isIpv4(s)) return s;
  if (!isIpv6(s)) return "";
  const zone = s.indexOf("%");
  return (zone >= 0 ? s.slice(0, zone) : s).toLowerCase();
}

// cf-connecting-ip נכתב על ידי הפלטפורמה ודורס ערך שהלקוח שלח.
// בלי זה, הקפיצה האחרונה ב-x-forwarded-for היא מה שהפרוקסי הוסיף.
// הקפיצה הראשונה היא מה שהדפדפן כתב, ולכן אינה נספרת.
export function clientIp(req: Request): string {
  const cf = normalizeIp(req.headers.get("cf-connecting-ip") || "");
  if (cf) return cf;
  const hops = (req.headers.get("x-forwarded-for") || "").split(",").map((h) => h.trim()).filter(Boolean);
  return normalizeIp(hops.length ? hops[hops.length - 1] : "");
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = normalizeIp(ip) || SHARED_IP_KEY;
  const pepper = salt || FALLBACK_SALT;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key + "|" + pepper),
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
