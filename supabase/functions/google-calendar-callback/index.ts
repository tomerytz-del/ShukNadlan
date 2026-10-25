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
  stateSubject,
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
//
// צוות ההטמעה עובר באותה כתובת (לקוח OAuth אחד, redirect URI אחד): state
// של `csm:<staff_id>` (‏stateSubject) נשמר ב-csm_calendar_* וחוזר ל-
// ‏`/csm?tab=settings&gcal=…`. ‏docs/csm-adoption.md, "יומן Google".
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

function back(result: string, csm = false): Response {
  const path = csm ? "/csm?tab=settings&gcal=" : "/crm?goto=accGcal&gcal=";
  return new Response(null, {
    status: 302,
    headers: { Location: `${SITE}${path}${encodeURIComponent(result)}` },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response("method_not_allowed", { status: 405 });
  const url = new URL(req.url);

  // ‏state נקרא קודם, כדי שגם ביטול יחזור לדף הנכון. בלי חתימה תקפה - CRM.
  const subject = googleCalendarConfigured() ? await verifyState(url.searchParams.get("state") || "") : null;
  const isCsm = !!subject && stateSubject(subject).kind === "csm";

  // ביטול במסך של Google (‏access_denied) אינו תקלה - רק חזרה.
  if (url.searchParams.get("error")) {
    return back(url.searchParams.get("error") === "access_denied" ? "denied" : "error", isCsm);
  }
  if (!googleCalendarConfigured()) return back("not_configured");
  if (!subject) return back("expired");
  const code = url.searchParams.get("code");
  if (!code) return back("error", isCsm);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (isCsm) return await connectStaff(supabase, stateSubject(subject).id, code);
  const agentId = subject;
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

// ---------------------------------------------------------------------------
// צוות ההטמעה: אותו תהליך, טבלאות csm_calendar_*. בלי גייט מסלול - היא אינה
// במסלול; הגייט הוא csm_staff פעיל/ה.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function connectStaff(supabase: any, staffId: string, code: string): Promise<Response> {
  const { data: staff } = await supabase.from("csm_staff").select("id").eq("id", staffId).eq("active", true).maybeSingle();
  if (!staff) return back("error", true);

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("gcal callback (csm): exchange failed", String(err));
    return back("error", true);
  }
  const granted = String(tokens.scope || "").split(/\s+/);
  if (!granted.includes(GCAL_WRITE_SCOPE)) {
    await revokeToken(tokens.refresh_token || tokens.access_token);
    return back("scope_missing", true);
  }

  let refresh = tokens.refresh_token || null;
  if (!refresh) {
    const { data: sec } = await supabase.from("csm_calendar_secrets")
      .select("refresh_token_enc").eq("staff_id", staffId).maybeSingle();
    if (sec?.refresh_token_enc) {
      try { refresh = await decryptToken(sec.refresh_token_enc); } catch { refresh = null; }
    }
  }
  if (!refresh) return back("error", true);

  try {
    const access = tokens.access_token || await refreshAccessToken(refresh);
    const { data: prev } = await supabase.from("csm_calendar_connections")
      .select("calendar_id").eq("staff_id", staffId).maybeSingle();
    let calendarId = prev?.calendar_id || null;
    if (!calendarId || !(await calendarExists(access, calendarId))) {
      calendarId = await createCalendar(access);
    }
    await supabase.from("csm_calendar_secrets").upsert({
      staff_id: staffId, refresh_token_enc: await encryptToken(refresh), updated_at: new Date().toISOString(),
    }, { onConflict: "staff_id" });
    const { error } = await supabase.from("csm_calendar_connections").upsert({
      staff_id: staffId,
      google_email: emailFromIdToken(tokens.id_token),
      calendar_id: calendarId,
      scopes: granted.filter((s) => s === GCAL_WRITE_SCOPE || s === GCAL_FREEBUSY_SCOPE),
      status: "active",
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "staff_id" });
    if (error) throw error;
    await supabase.rpc("csm_calendar_mark_backfill", { p_staff_id: staffId });
  } catch (err) {
    console.error("gcal callback (csm): setup failed", String(err));
    return back("error", true);
  }
  return back(granted.includes(GCAL_FREEBUSY_SCOPE) ? "connected" : "connected_no_freebusy", true);
}
