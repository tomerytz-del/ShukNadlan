import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/morning.ts";

// ============================================================================
// החזר יתרה שלא מומשה
//
// המדיניות: סוכן/ת רשאי/ת לבקש בכל עת החזר על כסף שנטען ולא מומש. המימוש
// הוא בקשה + אישור ידני — ראו ההסבר המלא במיגרציה 20261008090000.
//
// חמש פעולות בשתי רמות הרשאה:
//
//   סוכן/ת         request, cancel   — על עצמו/ה בלבד
//   מנהל/ת פלטפורמה list, complete, reject
//
// **הפונקציה הזו לא מזיזה כסף החוצה.** היא רק מנהלת את מצב הבקשה; ההחזר
// עצמו מתבצע בידי אדם בממשק של מורנינג, ו-complete רק רושם שזה קרה ומול
// איזה מסמך זיכוי. זו הייתה החלטה מודעת: קריאת API שמוציאה כסף מהחשבון
// בלי שאדם אישר היא בדיוק סוג הנתיב שלא כדאי שיהיה קיים, גם אם לעולם לא
// ייקרא בטעות.
//
// היתרה יורדת כבר ב-request ולא ב-complete. כך אי אפשר לבקש החזר ואז
// להוציא את אותו כסף על לידים — בלי לגעת באף אחת מפונקציות הרכישה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Caller = { agentId: string; isAdmin: boolean };

async function resolveCaller(req: Request, supabase: any): Promise<Caller | { error: string; status: number }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "missing_authorization", status: 401 };

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return { error: "unauthorized", status: 401 };

  const { data: agent, error } = await supabase
    .from("agency_members")
    .select("id, active, is_platform_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error || !agent) return { error: "no_matching_agent_profile", status: 403 };
  if (!agent.active) return { error: "agent_inactive", status: 403 };

  return { agentId: agent.id, isAdmin: agent.is_platform_admin === true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const caller = await resolveCaller(req, supabase);
  if ("error" in caller) return json({ error: caller.error }, caller.status);

  const action = String(body?.action ?? "");

  // ---- סוכן/ת: פתיחת בקשה ---------------------------------------------
  if (action === "request") {
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "invalid_amount" }, 400);

    const { data, error } = await supabase.rpc("request_wallet_refund", {
      p_agent_id: caller.agentId,
      p_amount: amount,
      p_note: typeof body?.note === "string" ? body.note : null,
    });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (data?.error) return json(data, 400);
    return json(data);
  }

  // ---- סוכן/ת: ביטול בקשה שלה/ו ---------------------------------------
  // הבעלות נבדקת גם כאן וגם בתוך ה-RPC. כפילות מכוונת: הפונקציה שמחזירה
  // כסף לא סומכת על כך שהקורא כבר בדק.
  if (action === "cancel") {
    const refundId = String(body?.refund_id ?? "");
    if (!refundId) return json({ error: "missing_refund_id" }, 400);

    const { data, error } = await supabase.rpc("cancel_wallet_refund", {
      p_refund_id: refundId,
      p_agent_id: caller.agentId,
    });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (data?.error) return json(data, 400);
    return json(data);
  }

  // ---- מכאן והלאה: מנהל/ת פלטפורמה בלבד --------------------------------
  if (!caller.isAdmin) return json({ error: "not_platform_admin" }, 403);

  if (action === "list") {
    const status = typeof body?.status === "string" ? body.status : "requested";
    const { data, error } = await supabase
      .from("wallet_refunds")
      .select("id, agent_id, amount, status, allocation, agent_note, requested_at, " +
              "resolved_at, resolution_note, provider_credit_note_id, " +
              "agency_members!wallet_refunds_agent_id_fkey(display_name)")
      .eq("status", status)
      .order("requested_at", { ascending: true })
      .limit(100);
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    return json({ success: true, refunds: data ?? [] });
  }

  if (action === "complete") {
    const refundId = String(body?.refund_id ?? "");
    if (!refundId) return json({ error: "missing_refund_id" }, 400);

    const { data, error } = await supabase.rpc("complete_wallet_refund", {
      p_refund_id: refundId,
      p_admin_id: caller.agentId,
      p_credit_note_id: typeof body?.credit_note_id === "string" ? body.credit_note_id : null,
      p_note: typeof body?.note === "string" ? body.note : null,
    });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (data?.error) return json(data, 400);
    return json(data);
  }

  if (action === "reject") {
    const refundId = String(body?.refund_id ?? "");
    if (!refundId) return json({ error: "missing_refund_id" }, 400);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    // דחייה בלי נימוק היא מבוי סתום עבור מי שקיבל/ה אותה: היתרה חוזרת ואין
    // שום רמז מה לעשות אחרת. הנימוק מוצג לסוכן/ת בממשק.
    if (!reason) return json({ error: "missing_reason" }, 400);

    const { data, error } = await supabase.rpc("reject_wallet_refund", {
      p_refund_id: refundId,
      p_admin_id: caller.agentId,
      p_reason: reason,
    });
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if (data?.error) return json(data, 400);
    return json(data);
  }

  return json({ error: "unknown_action" }, 400);
});
