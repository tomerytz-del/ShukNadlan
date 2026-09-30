// ============================================================================
// יומן Google - הצפנת הטוקן, ה-state החתום, רענון, וקריאות ה-API.
//
// משותף ל-`google-calendar-connect`, ‏`google-calendar-callback`,
// ‏`google-calendar-sync`, ‏`close-account` ולעוזר בוואטסאפ
// (`agenda_free_slots`). ראו docs/google-calendar.md.
//
// שלושה סודות, וכולם חובה - בלי אחד מהם `googleCalendarConfigured()` מחזירה
// false והכפתור ב-CRM מסביר שהחיבור עוד לא הוגדר, במקום להוביל ל-Google
// ולהיכשל שם:
//
//   ‏GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET - לקוח OAuth
//     מסוג Web ב-Google Cloud, עם ה-redirect של `google-calendar-callback`.
//   ‏GOOGLE_CALENDAR_TOKEN_KEY - ‏32 בתים ב-base64. מצפין את ה-refresh token
//     במסד וחותם את ה-state. החלפה שלו מנתקת את כל החיבורים הקיימים.
// ============================================================================

export const GCAL_SCOPES = [
  "openid",
  "email",
  // יצירת יומן משנה, וכתיבה לאירועים שבו בלבד
  "https://www.googleapis.com/auth/calendar.app.created",
  // פנוי/תפוס מהיומן הראשי, בלי כותרות ובלי משתתפים
  "https://www.googleapis.com/auth/calendar.freebusy",
];
export const GCAL_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const GCAL_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

export const GCAL_CALENDAR_NAME = "שוק נדל\"ן";
export const IL_TZ = "Asia/Jerusalem";

const CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || "";
const TOKEN_KEY_B64 = Deno.env.get("GOOGLE_CALENDAR_TOKEN_KEY") || "";
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");

export const GCAL_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-callback`;

export function googleCalendarConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && TOKEN_KEY_B64);
}

// ---------------------------------------------------------------------------
// base64 / base64url
// ---------------------------------------------------------------------------
function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
// ‏ArrayBuffer מפורש ולא ArrayBufferLike: ‏crypto.subtle אינו מקבל
// ‏SharedArrayBuffer, והטיפוס הכללי כולל אותו.
function unb64(str: string): Uint8Array<ArrayBuffer> {
  const s = atob(str);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(str: string): Uint8Array<ArrayBuffer> {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  return unb64(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

// ---------------------------------------------------------------------------
// המפתחות. שניים מתוך סוד אחד: AES להצפנה ו-HMAC ל-state. גזירה ולא שימוש
// ישיר באותו מפתח לשני האלגוריתמים.
// ---------------------------------------------------------------------------
let keysPromise: Promise<{ aes: CryptoKey; hmac: CryptoKey }> | null = null;

function keys() {
  if (!keysPromise) {
    keysPromise = (async () => {
      const raw = unb64(TOKEN_KEY_B64);
      if (raw.length !== 32) throw new Error("GOOGLE_CALENDAR_TOKEN_KEY חייב להיות 32 בתים ב-base64");
      const base = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const derive = async (label: string) =>
        new Uint8Array(await crypto.subtle.sign("HMAC", base, new TextEncoder().encode(label)));
      const aes = await crypto.subtle.importKey("raw", await derive("gcal-token-aes"), "AES-GCM", false,
        ["encrypt", "decrypt"]);
      const hmac = await crypto.subtle.importKey("raw", await derive("gcal-state-hmac"),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      return { aes, hmac };
    })();
  }
  return keysPromise;
}

export async function encryptToken(plain: string): Promise<string> {
  const { aes } = await keys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes,
    new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptToken(enc: string): Promise<string> {
  const [v, iv, ct] = String(enc || "").split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("token_format");
  const { aes } = await keys();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, aes, unb64(ct));
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// ה-state: מי ביקש/ה, ועד מתי. חתום, כדי שאיש לא יוכל לחבר יומן לחשבון של
// אחר/ת על ידי שליחת קישור עם מזהה שלו/ה.
// ---------------------------------------------------------------------------
const STATE_TTL_MS = 15 * 60 * 1000;

export async function signState(agentId: string): Promise<string> {
  const { hmac } = await keys();
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    a: agentId, e: Date.now() + STATE_TTL_MS, n: b64url(crypto.getRandomValues(new Uint8Array(9))),
  })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyState(state: string): Promise<string | null> {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return null;
  const { hmac } = await keys();
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", hmac, unb64url(sig), new TextEncoder().encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (typeof data?.a !== "string" || typeof data?.e !== "number" || data.e < Date.now()) return null;
    return data.a;
  } catch {
    return null;
  }
}

export async function authUrl(agentId: string, loginHint?: string | null): Promise<string> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: GCAL_REDIRECT_URI,
    response_type: "code",
    scope: GCAL_SCOPES.join(" "),
    // ‏offline + consent: בלעדיהם Google אינה מחזירה refresh token בחיבור
    // חוזר, והחיבור היה עובד שעה אחת ונשבר.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: await signState(agentId),
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ---------------------------------------------------------------------------
// טוקנים
// ---------------------------------------------------------------------------
export class GoogleRevokedError extends Error {}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  expires_in?: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: GCAL_REDIRECT_URI, grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`token_exchange_failed: ${data.error || res.status}`);
  }
  return data as TokenResponse;
}

/** ‏invalid_grant = הסוכן/ת ביטל/ה את ההרשאה ב-Google, או שהטוקן פג. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.error === "invalid_grant") throw new GoogleRevokedError("invalid_grant");
  if (!res.ok || !data.access_token) throw new Error(`token_refresh_failed: ${data.error || res.status}`);
  return data.access_token as string;
}

export async function revokeToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {});
}

/**
 * האימייל מתוך ה-id_token. בלי אימות חתימה, ובמודע: הטוקן הגיע עכשיו
 * ישירות מ-Google ב-TLS, בתשובה לקוד שרק אנחנו יכולים להמיר. הוא משמש
 * לתצוגה בלבד ("מחובר: x@gmail.com"), לא לזיהוי.
 */
export function emailFromIdToken(idToken?: string): string | null {
  try {
    const part = String(idToken || "").split(".")[1];
    if (!part) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64url(part)));
    return typeof data?.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ה-API
// ---------------------------------------------------------------------------
export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const API = "https://www.googleapis.com/calendar/v3";

async function api(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GoogleApiError(String(data?.error?.message || `google_${res.status}`).slice(0, 300), res.status);
  }
  return data;
}

export async function createCalendar(token: string): Promise<string> {
  const cal = await api(token, "POST", "/calendars", { summary: GCAL_CALENDAR_NAME, timeZone: IL_TZ });
  return String(cal.id);
}

export async function calendarExists(token: string, calendarId: string): Promise<boolean> {
  try {
    await api(token, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
    return true;
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 403)) return false;
    throw err;
  }
}

export async function deleteCalendar(token: string, calendarId: string): Promise<void> {
  try {
    await api(token, "DELETE", `/calendars/${encodeURIComponent(calendarId)}`);
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

/**
 * מזהה האירוע נגזר ממזהה הפריט: Google מקבלת מזהה מהלקוח בתווי base32hex
 * (‏a-v, 0-9), ו-uuid בלי מקפים הוא hex - תת-קבוצה שלהם. ניסיון חוזר אחרי
 * נפילה מקבל 409 ולא יוצר אירוע שני.
 */
export function eventIdFor(itemId: string): string {
  return "shk" + itemId.replace(/-/g, "").toLowerCase();
}

export interface EventInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
}

function eventBody(e: EventInput) {
  return {
    summary: e.summary,
    description: e.description || undefined,
    location: e.location || undefined,
    start: { dateTime: e.start, timeZone: IL_TZ },
    end: { dateTime: e.end, timeZone: IL_TZ },
    // התזכורות יוצאות מאיתנו (וואטסאפ ופעמון). תזכורת של Google בנוסף
    // הייתה מצלצלת פעמיים על אותה פגישה.
    reminders: { useDefault: false, overrides: [] },
  };
}

/** יוצר או מעדכן. מחזיר את מזהה האירוע. */
export async function upsertEvent(
  token: string, calendarId: string, itemId: string, existingId: string | null, e: EventInput,
): Promise<string> {
  const cal = encodeURIComponent(calendarId);
  const id = existingId || eventIdFor(itemId);
  try {
    await api(token, "PATCH", `/calendars/${cal}/events/${encodeURIComponent(id)}`,
      { ...eventBody(e), status: "confirmed" });
    return id;
  } catch (err) {
    if (!(err instanceof GoogleApiError) || (err.status !== 404 && err.status !== 410)) throw err;
  }
  try {
    await api(token, "POST", `/calendars/${cal}/events`, { id, ...eventBody(e) });
  } catch (err) {
    // ‏409: אירוע שנמחק ב-Google משאיר את המזהה תפוס. במקרה כזה - מזהה חדש
    // שנוצר בצד שלהם.
    if (!(err instanceof GoogleApiError) || err.status !== 409) throw err;
    const created = await api(token, "POST", `/calendars/${cal}/events`, eventBody(e));
    return String(created.id);
  }
  return id;
}

export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await api(token, "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

/** פנוי/תפוס מהיומן הראשי בלבד - בלי כותרות. */
export async function freeBusy(token: string, fromIso: string, toIso: string): Promise<Array<{ start: string; end: string }>> {
  const data = await api(token, "POST", "/freeBusy", {
    timeMin: fromIso, timeMax: toIso, timeZone: IL_TZ, items: [{ id: "primary" }],
  });
  const busy = data?.calendars?.primary?.busy;
  return Array.isArray(busy) ? busy : [];
}

// ---------------------------------------------------------------------------
// טוקן גישה לסוכן/ת מתוך המסד
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
type Db = any;

export async function accessTokenFor(supabase: Db, agentId: string): Promise<string | null> {
  const { data } = await supabase.from("agent_calendar_secrets")
    .select("refresh_token_enc").eq("agent_id", agentId).maybeSingle();
  if (!data?.refresh_token_enc) return null;
  return await refreshAccessToken(await decryptToken(data.refresh_token_enc));
}

/**
 * ניתוק מלא: מחיקת יומן המשנה ב-Google (כך שהאירועים שלנו לא נשארים שם
 * יתומים), ביטול ההרשאה, ומחיקת הטוקן. כל שלב best-effort - טוקן שכבר בוטל
 * ב-Google אינו סיבה להשאיר אותו אצלנו.
 */
export async function disconnectAgent(supabase: Db, agentId: string, reason: "revoked" | "error" = "revoked") {
  const { data: conn } = await supabase.from("agent_calendar_connections")
    .select("calendar_id").eq("agent_id", agentId).maybeSingle();
  const { data: sec } = await supabase.from("agent_calendar_secrets")
    .select("refresh_token_enc").eq("agent_id", agentId).maybeSingle();

  let calendarDeleted = false;
  if (sec?.refresh_token_enc && googleCalendarConfigured()) {
    try {
      const refresh = await decryptToken(sec.refresh_token_enc);
      try {
        const access = await refreshAccessToken(refresh);
        if (conn?.calendar_id) {
          await deleteCalendar(access, conn.calendar_id);
          calendarDeleted = true;
        }
      } catch (err) {
        console.warn("gcal disconnect: calendar cleanup skipped", String(err));
      }
      await revokeToken(refresh);
    } catch (err) {
      console.warn("gcal disconnect: token unreadable", String(err));
    }
  }

  await supabase.from("agent_calendar_secrets").delete().eq("agent_id", agentId);
  await supabase.from("agent_calendar_connections").update({
    status: reason, calendar_id: null, updated_at: new Date().toISOString(),
  }).eq("agent_id", agentId);
  await supabase.rpc("agent_calendar_clear_items", { p_agent_id: agentId });
  return { calendarDeleted };
}
