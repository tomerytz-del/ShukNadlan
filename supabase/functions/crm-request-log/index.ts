import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// ‏crm-request-log - קליטת יומן הבקשות ל-/crm מה-Edge של Netlify.
//
// ‏netlify/edge-functions/crm-request-log.ts שולחת לכאן כל בקשה ל-/crm (IP,
// user-agent, referer, נתיב ו-query). הכתיבה עצמה ב-crm_request_log_add, עם
// תקרה יומית ומחיקה אחרי 30 יום. docs/crm-request-log.md.
//
// ‏verify_jwt = false: ה-Edge של Netlify אינו מחזיק JWT של Supabase. האימות הוא
// סוד משותף ב-x-crm-log-secret מול CRM_LOG_SECRET. **fail-closed:** בלי הסוד
// בסביבה כל קריאה מקבלת 503 - אין נקודת כתיבה פתוחה. כל תשובה אחרת שאינה
// 204 אינה נקראת על ידי הקורא (הרישום אופציונלי).
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY = 8 * 1024;

// השוואה בזמן קבוע. בלי תלות במודול משותף גדול בנקודה ציבורית.
function tokensMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const FIELDS = [
  "ip", "country", "city", "method", "path", "query", "status", "user_agent",
  "referer", "accept_lang", "sec_fetch", "ch_mobile", "ch_platform",
] as const;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const secret = Deno.env.get("CRM_LOG_SECRET") || "";
  if (secret.length < 32) return new Response(null, { status: 503 });
  const got = req.headers.get("x-crm-log-secret") || "";
  if (!tokensMatch(got, secret)) return new Response(null, { status: 401 });

  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) {
    return new Response(null, { status: 413 });
  }
  let text = "";
  try {
    text = await req.text();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return new Response(null, { status: 400 });
  }

  // רק השדות הידועים, ורק כמחרוזת (status כמספר). השאר נזרק.
  const entry: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = raw[f];
    if (v === null || v === undefined) continue;
    entry[f] = String(v).slice(0, 600);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase.rpc("crm_request_log_add", { p: entry });
  return new Response(null, { status: error ? 500 : 204 });
});
