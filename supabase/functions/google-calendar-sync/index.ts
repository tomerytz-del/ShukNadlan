import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import {
  accessTokenFor,
  createCalendar,
  deleteEvent,
  disconnectAgent,
  GoogleApiError,
  googleCalendarConfigured,
  GoogleRevokedError,
  IL_TZ,
  upsertEvent,
} from "../_shared/google-calendar.ts";

// ============================================================================
// סנכרון היומן אל Google - נקרא מ-pg_cron כל דקה, רק כשיש מה לסנכרן
// (‏`google_calendar_sync_ready()` במיגרציה 20270126090000).
//
// כיוון אחד: מהמערכת אל Google. פגישה, סיור וחתימה נכתבים ליומן המשנה
// "שוק נדל"ן"; ביטול, מחיקת מועד או שינוי סוג מוחקים את האירוע. אין קריאה
// בחזרה - ההרשאה (`calendar.app.created`) ממילא אינה רואה את היומן האישי.
//
// ‏מה נקבע במסד ולא כאן: מי מסונכרן/ת (חיבור פעיל ומסלול בתוקף), ואם האירוע
// אמור להתקיים (`include`). כאן רק כותבים ומדווחים. התוצאה נכתבת רק אם
// הפריט עדיין `syncing` - שינוי שנעשה באמצע מחזיר אותו ל-`pending`, והסבב
// הבא יכתוב את הגרסה החדשה במקום שהישנה תדרוס אותו.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

const KIND_LABELS: Record<string, string> = {
  meeting: "פגישה", showing: "סיור בנכס", signing: "חתימה", call: "שיחה", task: "משימה",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

interface Claimed {
  item_id: string;
  agent_id: string;
  calendar_id: string | null;
  kind: string;
  title: string;
  notes: string | null;
  location: string | null;
  due_at: string | null;
  ends_at: string | null;
  status: string;
  client_name: string | null;
  client_phone: string | null;
  google_event_id: string | null;
  include: boolean;
}

function describe(it: Claimed): string {
  return [
    KIND_LABELS[it.kind] || "",
    it.client_name ? `לקוח/ה: ${it.client_name}${it.client_phone ? ` · ${it.client_phone}` : ""}` : null,
    it.notes,
    "",
    `נקבע ביומן של שוק נדל"ן: ${SITE}/crm?goto=accAgenda`,
  ].filter((l) => l !== null).join("\n").trim();
}

Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);
  if (!googleCalendarConfigured()) return json({ ok: false, error: "not_configured" }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // חשבונות שנסגרו: מחיקת יומן המשנה ב-Google וביטול ההרשאה.
  const { data: closedAgents } = await supabase.rpc("google_calendar_closed_agents");
  for (const row of (closedAgents || []) as Array<{ agent_id: string }>) {
    await disconnectAgent(supabase, row.agent_id, "revoked");
  }

  const { data: rows, error } = await supabase.rpc("google_calendar_sync_claim", { p_limit: 50 });
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const items = (rows || []) as Claimed[];
  const byAgent = new Map<string, Claimed[]>();
  for (const it of items) byAgent.set(it.agent_id, [...(byAgent.get(it.agent_id) || []), it]);

  const done = async (it: Claimed, patch: Record<string, unknown>) => {
    await supabase.from("agent_agenda_items").update(patch)
      .eq("id", it.item_id).eq("google_sync_state", "syncing");
  };

  let synced = 0, deleted = 0, failed = 0;

  for (const [agentId, list] of byAgent) {
    let token: string | null;
    try {
      token = await accessTokenFor(supabase, agentId);
    } catch (err) {
      if (err instanceof GoogleRevokedError) {
        // ההרשאה בוטלה ב-Google (או שהסיסמה שונתה). אין טעם לנסות שוב כל
        // דקה - החיבור מסומן, הטוקן נמחק, והסוכן/ת מקבל/ת הודעה בפעמון.
        await supabase.from("agent_calendar_secrets").delete().eq("agent_id", agentId);
        await supabase.from("agent_calendar_connections").update({
          status: "error",
          last_error: "ההרשאה ליומן בוטלה ב-Google. צריך לחבר מחדש.",
          updated_at: new Date().toISOString(),
        }).eq("agent_id", agentId);
        await supabase.from("notifications").insert({
          agent_id: agentId, type: "system",
          title: "יומן Google התנתק",
          body: "ההרשאה בוטלה ב-Google, ולכן הפגישות מפסיקות להופיע שם. לחיבור מחדש: יומן ומשימות ב-CRM.",
        });
      } else {
        console.error("gcal sync: token", agentId, String(err));
      }
      // חוזרים ל-pending: אחרי חיבור מחדש הם ייכתבו.
      for (const it of list) await done(it, { google_sync_state: "pending" });
      failed += list.length;
      continue;
    }
    if (!token) {
      // חיבור פעיל בלי טוקן שמור - מצב שאסור שיהיה. מסמנים אותו, אחרת
      // ‏google_calendar_sync_ready הייתה מעירה את הפונקציה כל דקה לשווא.
      await supabase.from("agent_calendar_connections").update({
        status: "error", last_error: "אין הרשאה שמורה. צריך לחבר מחדש.",
        updated_at: new Date().toISOString(),
      }).eq("agent_id", agentId);
      for (const it of list) await done(it, { google_sync_state: "pending" });
      continue;
    }

    let calendarId = list[0].calendar_id;
    for (const it of list) {
      try {
        if (!it.include) {
          if (it.google_event_id && calendarId) await deleteEvent(token, calendarId, it.google_event_id);
          await done(it, { google_event_id: null, google_sync_state: null, google_sync_error: null,
                           google_sync_at: new Date().toISOString() });
          deleted++;
          continue;
        }

        const start = new Date(String(it.due_at));
        const end = it.ends_at ? new Date(it.ends_at) : new Date(start.getTime() + 60 * 60000);
        const input = {
          summary: it.title,
          description: describe(it),
          location: it.location,
          start: start.toISOString(),
          end: end.toISOString(),
        };

        let eventId: string;
        try {
          if (!calendarId) throw new GoogleApiError("no_calendar", 404);
          eventId = await upsertEvent(token, calendarId, it.item_id, it.google_event_id, input);
        } catch (err) {
          // יומן המשנה נמחק ב-Google בידי הסוכן/ת. יוצרים חדש פעם אחת, ולא
          // משאירים את כל הפגישות תקועות על יומן שאינו קיים.
          if (!(err instanceof GoogleApiError) || err.status !== 404) throw err;
          calendarId = await createCalendar(token);
          await supabase.from("agent_calendar_connections")
            .update({ calendar_id: calendarId, updated_at: new Date().toISOString() })
            .eq("agent_id", agentId);
          eventId = await upsertEvent(token, calendarId, it.item_id, null, input);
        }

        await done(it, { google_event_id: eventId, google_sync_state: "synced", google_sync_error: null,
                         google_sync_at: new Date().toISOString() });
        synced++;
      } catch (err) {
        console.error("gcal sync: item", it.item_id, String(err));
        await done(it, { google_sync_state: "error",
                         google_sync_error: String((err as Error)?.message || err).slice(0, 300) });
        failed++;
      }
    }

    await supabase.from("agent_calendar_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("agent_id", agentId).eq("status", "active");
  }

  return json({ ok: true, claimed: items.length, synced, deleted, failed, tz: IL_TZ });
});
