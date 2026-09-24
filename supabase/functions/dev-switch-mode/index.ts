import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// כלי בדיקה בלבד — החלפת מסלול (free/mid/premium) ותפקיד (agent/manager)
// של המשתמש המחובר, כדי לבדוק את המערכת מכל זווית בלי לפתוח חשבונות נפרדים.
//
// שדות tier/role נעולים בטריגר protect_sensitive_agency_member_fields, ולכן
// לא ניתן לשנות אותם מהדפדפן ישירות — השינוי חייב לעבור כאן, עם service_role.
// הגישה מוגבלת ל-is_platform_admin=true בלבד, כדי שסוכן רגיל לא יוכל
// לשדרג את עצמו למסלול בתשלום בחינם.
//
// ‏action: "ensure_developer" — חשבון יזם לבדיקה על אותו משתמש, כדי לבדוק
// את אזור היזמים (developer-crm) ואת חיוב הכרטיס בטעינת הארנק שלו בלי
// לפתוח חשבון Auth נפרד. ‏developer-crm מזהה חברה לפי developers.user_id,
// והסשן משותף לשני הדפים (אותו origin), ולכן שורה אחת מספיקה.
//
// החברה נוצרת **בלי slug**: בלעדיו אין לה דף חברה ציבורי, והיא אינה נכנסת
// ל-sitemap (‏sitemap.ts מסנן slug=not.is.null). ח״פ הבדיקה אינו עובר ברשם
// החברות בכוונה — הוא אינו אמיתי, ו-registry_status נשאר unverified.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIERS = ["free", "mid", "premium"];
const ROLES = ["agent", "manager"];

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const action = typeof body.action === "string" ? body.action : null;

  const tier = body.tier === undefined || body.tier === null ? null : String(body.tier);
  const role = body.role === undefined || body.role === null ? null : String(body.role);
  if (action !== null && action !== "ensure_developer") return json({ error: "unknown_action" }, 400);
  if (action === null && tier === null && role === null) return json({ error: "nothing_to_change" }, 400);
  if (tier !== null && !TIERS.includes(tier)) return json({ error: "invalid_tier" }, 400);
  if (role !== null && !ROLES.includes(role)) return json({ error: "invalid_role" }, 400);

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: agentRow, error: agentErr } = await supabase
    .from("agency_members")
    .select("id, tier, role, is_platform_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (agentErr || !agentRow) return json({ error: "no_matching_agent_profile" }, 403);
  if (!agentRow.is_platform_admin) return json({ error: "not_platform_admin" }, 403);

  if (action === "ensure_developer") return ensureTestDeveloper(supabase, userData.user, agentRow.id);

  const changes: Record<string, string> = {};
  if (tier !== null) changes.tier = tier;
  if (role !== null) changes.role = role;

  const { data: updated, error: updErr } = await supabase
    .from("agency_members")
    .update(changes)
    .eq("id", agentRow.id)
    .select("tier, role")
    .single();
  if (updErr) return json({ error: "db_error", detail: updErr.message }, 500);

  return json({ ok: true, tier: updated.tier, role: updated.role, test_mode: true }, 200);
});

// הח״פ נגזר מה-uuid של המשתמש כדי שיהיה יציב, ומתחיל ב-0 כדי שלא ייראה
// כמו ח״פ של חברה (5…). ‏unique על company_number — בהתנגשות נופלים לאקראי.
function testCompanyNumber(userId: string, attempt: number): string {
  const n = attempt === 0
    ? parseInt(userId.replace(/-/g, "").slice(0, 8), 16) % 100_000_000
    : Math.floor(Math.random() * 100_000_000);
  return "0" + String(n).padStart(8, "0");
}

// deno-lint-ignore no-explicit-any
async function ensureTestDeveloper(supabase: any, user: { id: string; email?: string }, adminAgentId: string) {
  const { data: existing, error: exErr } = await supabase
    .from("developers").select("id, name, status").eq("user_id", user.id).maybeSingle();
  if (exErr) return json({ error: "db_error", detail: exErr.message }, 500);
  if (existing) {
    return json({ ok: true, created: false, developer_id: existing.id, name: existing.name, status: existing.status });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: created, error } = await supabase
      .from("developers")
      .insert({
        user_id: user.id,
        slug: null,
        name: "יזם בדיקה - שוק נדל\"ן",
        legal_name: "חשבון בדיקה פנימי",
        company_number: testCompanyNumber(user.id, attempt),
        contact_name: "מנהל/ת פלטפורמה",
        phone: "0500000000",
        address: "כתובת בדיקה",
        city: "תל אביב - יפו",
        email: user.email ?? null,
        tagline: "חשבון בדיקה - לא לפרסום",
      })
      .select("id, name, status")
      .single();
    if (!error) {
      console.log("dev-switch-mode: test developer created", created.id, "by admin", adminAgentId);
      return json({ ok: true, created: true, developer_id: created.id, name: created.name, status: created.status });
    }
    if (!/developers_company_number_key/.test(error.message)) {
      return json({ error: "db_error", detail: error.message }, 500);
    }
  }
  return json({ error: "company_number_collision" }, 500);
}
