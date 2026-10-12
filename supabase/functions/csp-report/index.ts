import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// ‏csp-report - קליטת דיווחי הפרה של ה-CSP (‏report-uri ב-_headers).
//
// הדפדפן שולח דיווח בכל פעם שמשהו בדף היה נחסם אילו ה-CSP היה נאכף. מכאן
// נשמרת ספירה יומית בלבד (‏csp_violations, מיגרציה 20270423100000): הנחיה,
// ה-origin של המקור החסום, ונתיב הדף בלי query. בלי IP ובלי user-agent.
//
// ‏verify_jwt = false: הדפדפן שולח את הדיווח בעצמו, בלי שום כותרת שלנו.
// לכן הכל כאן חשדני: גוף עד 16KB, שדות נחתכים, ותקרה יומית במסד.
// התשובה תמיד 204 - לדפדפן אין מה לעשות עם שגיאה, ולמי שבודק/ת את
// הנקודה אין מה ללמוד ממנה. docs/security-headers.md.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY = 16 * 1024;

const done = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });

// מקור חסום: רק origin. ‏inline / eval / data נשארים כמילה; תוספי דפדפן נזרקים -
// הם של הגולש/ת, לא של האתר.
function blockedOrigin(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return "?";
  if (/^(chrome|moz|safari|ms-browser)-extension:/i.test(v)) return null;
  if (/^(inline|eval|data|blob|self|wasm-eval)$/i.test(v)) return v.toLowerCase();
  try {
    const u = new URL(v);
    if (/^(data|blob):$/.test(u.protocol)) return u.protocol.slice(0, -1);
    return u.origin;
  } catch {
    return v.slice(0, 40);
  }
}

function pagePath(raw: unknown): string {
  try {
    return new URL(String(raw ?? "")).pathname.replace(/\.html$/, "") || "/";
  } catch {
    return "?";
  }
}

type Report = { directive: string; blocked: string; page: string };

// שני הפורמטים: ‏report-uri ‏({"csp-report": {...}}) ו-Reporting API (מערך).
function parse(body: unknown): Report[] {
  const out: Report[] = [];
  const add = (r: Record<string, unknown> | undefined) => {
    if (!r) return;
    const blocked = blockedOrigin(r["blocked-uri"] ?? r["blockedURL"]);
    if (blocked === null) return;
    const directive = String(r["effective-directive"] ?? r["effectiveDirective"] ??
      r["violated-directive"] ?? "?").split(" ")[0];
    out.push({ directive, blocked, page: pagePath(r["document-uri"] ?? r["documentURL"]) });
  };
  if (Array.isArray(body)) {
    for (const item of body.slice(0, 20)) {
      if (item && typeof item === "object" && (item as Record<string, unknown>).type === "csp-violation") {
        add((item as Record<string, unknown>).body as Record<string, unknown>);
      }
    }
  } else if (body && typeof body === "object") {
    add((body as Record<string, unknown>)["csp-report"] as Record<string, unknown>);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      },
    });
  }
  if (req.method !== "POST") return done();

  let text = "";
  try {
    text = await req.text();
  } catch {
    return done();
  }
  if (!text || text.length > MAX_BODY) return done();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done();
  }

  const reports = parse(body);
  if (!reports.length) return done();

  const db = createClient(supabaseUrl, serviceRoleKey);
  for (const r of reports.slice(0, 5)) {
    const { error } = await db.rpc("csp_report_add", {
      p_directive: r.directive, p_blocked: r.blocked, p_page: r.page,
    });
    if (error) console.error("csp_report_add failed", error.message);
  }
  return done();
});
