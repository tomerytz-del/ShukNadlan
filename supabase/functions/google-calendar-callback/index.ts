import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  calendarExists,
  createCalendar,
  decryptToken,
  emailFromIdToken,
  encryptToken,
  exchangeCode,
  GCAL_FREEBUSY_SCOPE,
  GCAL_WRITE_SCOPE,
  googleCalendarConfigured,
  refreshAccessToken,
  revokeToken,
  verifyState,
} from "../_shared/google-calendar.ts";

// ============================================================================
// החזרה מ-Google אחרי מסך ההסכמה.
//
// ‏verify_jwt = false, ובהכרח: זה ניווט של הדפדפן מ-Google, בלי Authorization.
// האימות הוא ה-`state` - חתום ב-HMAC, נושא את מזהה הסוכן/ת ותוקף של רבע
// שעה. בלעדיו אפשר היה לשלוח למישהו קישור שמחבר את היומן **שלו/ה** לחשבון
// של התוקף/ת.
//
// תמיד מסתיים בהפניה חזרה ל-CRM (`/crm?goto=accGcal&gcal=…`), גם בכשל:
// מסך JSON של שרת באמצע תהליך התחברות הוא מבוי סתום.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

function back(result: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${SITE}/crm?goto=accGcal&gcal=${encodeURIComponent(result)}` },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("method_not_allowed", { status: 405 });
  const url = new URL(req.url);

  // ביטול במסך של Google (‏access_denied) אינו תקלה - רק חזרה.
  if (url.searchParams.get("error")) {
    return back(url.searchParams.get("error") === "access_denied" ? "denied" : "error");
  }
  if (!googleCalendarConfigured()) return back("not_configured");

  const agentId = await verifyState(url.searchParams.get("state") || "");
  if (!agentId) return back("expired");
  const code = url.searchParams.get("code");
  if (!code) return back("error");

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: enabled } = await supabase.rpc("agent_agenda_enabled", { p_agent_id: agentId });
  if (!enabled) return back("tier_required");

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("gcal callback: exchange failed", String(err));
    return back("error");
  }

  // מסך ההסכמה של Google מאפשר להוריד סימון מהרשאה בודדת. בלי הרשאת
  // הכתיבה אין מה לחבר; בלי פנוי/תפוס - החיבור עובד, רק בלי הזמינות.
  const granted = String(tokens.scope || "").split(/\s+/);
  if (!granted.includes(GCAL_WRITE_SCOPE)) {
    await revokeToken(tokens.refresh_token || tokens.access_token);
    return back("scope_missing");
  }

  // חיבור חוזר בלי refresh token (Google מחזירה אותו רק בהסכמה מלאה): אם יש
  // כבר אחד שמור - משתמשים בו.
  let refresh = tokens.refresh_token || null;
  if (!refresh) {
    const { data: sec } = await supabase.from("agent_calendar_secrets")
      .select("refresh_token_enc").eq("agent_id", agentId).maybeSingle();
    if (sec?.refresh_token_enc) {
      try { refresh = await decryptToken(sec.refresh_token_enc); } catch { refresh = null; }
    }
  }
  if (!refresh) return back("error");

  try {
    const access = tokens.access_token || await refreshAccessToken(refresh);

    // יומן המשנה: אותו יומן בחיבור חוזר, אם הוא עוד קיים. אחרת - חדש.
    const { data: prev } = await supabase.from("agent_calendar_connections")
      .select("calendar_id").eq("agent_id", agentId).maybeSingle();
    let calendarId = prev?.calendar_id || null;
    if (!calendarId || !(await calendarExists(access, calendarId))) {
      calendarId = await createCalendar(access);
    }

    await supabase.from("agent_calendar_secrets").upsert({
      agent_id: agentId,
      refresh_token_enc: await encryptToken(refresh),
      updated_at: new Date().toISOString(),
    }, { onConflict: "agent_id" });

    const { error } = await supabase.from("agent_calendar_connections").upsert({
      agent_id: agentId,
      google_email: emailFromIdToken(tokens.id_token),
      calendar_id: calendarId,
      scopes: granted.filter((s) => s === GCAL_WRITE_SCOPE || s === GCAL_FREEBUSY_SCOPE),
      status: "active",
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "agent_id" });
    if (error) throw error;

    // כל הפגישות הפתוחות מהיום והלאה עוברות ל-Google בסבב הבא של ה-cron.
    await supabase.rpc("agent_calendar_mark_backfill", { p_agent_id: agentId });
  } catch (err) {
    console.error("gcal callback: setup failed", String(err));
    return back("error");
  }

  return back(granted.includes(GCAL_FREEBUSY_SCOPE) ? "connected" : "connected_no_freebusy");
});
