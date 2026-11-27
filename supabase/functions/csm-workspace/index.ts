// ============================================================================
// csm-workspace — אזור ההטמעה (/csm): מנטור ההטמעה וניתוח הקלטות שיחה
//
// ‏verify_jwt = true, ואשת הצוות נגזרת מה-JWT בלבד: ‏csm_staff.user_id, פעילה.
// מנהל/ת פלטפורמה שאינו/ה בצוות אינו/ה נכנס/ת לכאן - המנטור וההקלטות הם
// כלי עבודה של הצוות, והיומן שלהם רשום על איש/אשת צוות.
//
// פעולות (גוף הבקשה { action, ... }):
//   ask_mentor    { question }  → { answer, remaining }     (_shared/coach/csm.ts)
//   analyze_call  { call_id }   → { ok: true } מיד, והעבודה ממשיכה ברקע
//                                 (_shared/csm-call.ts). הדפדפן קורא את השורה
//                                 ב-csm_calls עד done/failed.
//   gcal_start                  → { url } - מסך ההסכמה של Google. ה-state נושא
//                                 `csm:<staff_id>`, וה-callback המשותף לסוכנים
//                                 (google-calendar-callback) מחזיר ל-/csm.
//   gcal_disconnect             → מחיקת יומן המשנה ב-Google, ביטול ההרשאה
//                                 ומחיקת הטוקן (_shared/google-calendar.ts).
//
// כל השאר (הצנרת, הפגישות, המשוב) נכתב מהדפדפן ישירות, תחת RLS של
// current_is_csm(). docs/csm-adoption.md.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { askCsmMentor } from "../_shared/coach/csm.ts";
import { background } from "../_shared/background.ts";
import { processAndReviewCsmCall, reviewCsmCall } from "../_shared/csm-review.ts";
import { runInsightsReport } from "../_shared/csm-insights.ts";
import {
  authUrl, CSM_STATE_PREFIX, disconnectStaff, GCAL_PUBLISHED, googleCalendarConfigured,
} from "../_shared/google-calendar.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: staff, error: staffErr } = await service.from("csm_staff")
    .select("id, email").eq("user_id", userData.user.id).eq("active", true).maybeSingle();
  if (staffErr) return json({ error: "db_error" }, 500);
  if (!staff) return json({ error: "forbidden" }, 403);

  if (body.action === "ask_mentor") {
    const r = await askCsmMentor(service, staff.id as string, body.question, "web");
    if ("error" in r) return json({ error: r.error, ...(r.remaining != null ? { remaining: r.remaining } : {}) }, r.status);
    return json(r);
  }

  if (body.action === "analyze_call") {
    const id = String(body.call_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "missing_fields" }, 400);
    const { data: call } = await service.from("csm_calls").select("id, status").eq("id", id).maybeSingle();
    if (!call) return json({ error: "not_found" }, 404);
    if (call.status === "processing") return json({ ok: true, already: true });
    // תמלול של שעת שיחה וסיכום לוקחים יותר מבקשה סבירה - ממשיכים ברקע
    const work = processAndReviewCsmCall(service, id)
      .catch(async (err) => {
        console.error("csm call processing threw", err);
        await service.from("csm_calls").update({ status: "failed", error: "העיבוד נכשל. אפשר לנסות שוב." }).eq("id", id);
      });
    await background(work);
    return json({ ok: true });
  }

  // ניתוח המנטור לשיחה שכבר מתומללת (שיחות מלפני התכונה, או ניתוח חוזר)
  if (body.action === "review_call") {
    const id = String(body.call_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "missing_fields" }, 400);
    const { data: call } = await service.from("csm_calls").select("id, status, transcript").eq("id", id).maybeSingle();
    if (!call) return json({ error: "not_found" }, 404);
    if (!call.transcript) return json({ error: "no_transcript" }, 409);
    await background(reviewCsmCall(service, id).catch((err) => console.error("csm review threw", err)));
    return json({ ok: true });
  }

  // הניתוח הכולל: שורה ב-csm_insight_reports שהדף קורא עד שהיא done או failed
  if (body.action === "insights_report") {
    const days = Math.min(365, Math.max(7, Math.round(Number(body.days) || 90)));
    const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: running } = await service.from("csm_insight_reports").select("id")
      .eq("status", "processing").gte("created_at", recent).limit(1).maybeSingle();
    if (running) return json({ ok: true, already: true, report_id: running.id });
    const { data: row, error: insErr } = await service.from("csm_insight_reports")
      .insert({ staff_id: staff.id, days }).select("id").single();
    if (insErr || !row) return json({ error: "db_error" }, 500);
    await background(runInsightsReport(service, row.id as string, days).catch(async (err) => {
      console.error("csm insights threw", err);
      await service.from("csm_insight_reports")
        .update({ status: "failed", error: "הניתוח הכולל נכשל. אפשר לנסות שוב.", finished_at: new Date().toISOString() }).eq("id", row.id);
    }));
    return json({ ok: true, report_id: row.id });
  }

  if (body.action === "gcal_start") {
    if (!googleCalendarConfigured()) {
      return json({ error: "not_configured", detail: "החיבור ליומן Google עוד לא הוגדר במערכת. לפנות לתומר." }, 503);
    }
    if (!GCAL_PUBLISHED) {
      return json({ error: "not_available_yet", detail: "החיבור ליומן Google ייפתח בקרוב." }, 403);
    }
    return json({ ok: true, url: await authUrl(CSM_STATE_PREFIX + staff.id, (staff.email as string) || userData.user.email) });
  }

  if (body.action === "gcal_disconnect") {
    return json({ ok: true, ...(await disconnectStaff(service, staff.id as string, "revoked")) });
  }

  return json({ error: "unknown_action" }, 400);
});
