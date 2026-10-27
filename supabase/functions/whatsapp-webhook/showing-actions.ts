// רשימה וביטול של סיורי מיניסייט. הסיור יושב ב-client_showcase_meetings,
// לא ביומן, ולכן agenda_list לבד החזיר "אין פגישה" על סיור אמיתי.
//
// ביטול מסמן גם בקשות תיאום שאינן סופיות. הודעה למי שכבר קיבל/ה בקשה
// יוצאת רק כשהסוכן/ת אישר/ה (notify_targets או כפתור scn:).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { phoneE164 } from "../_shared/meeting-client.ts";
import { sendText } from "./whatsapp.ts";
import {
  NON_FINAL_COORD,
  NOTIFY_COORD,
  pickShowings,
} from "./showing-match.ts";

export interface ShowingView {
  meeting_id: string;
  client_id: string | null;
  client_name: string;
  starts_at: string;
  when: string;
  status: string;
  showcase_status: string;
  client_status: string | null;
  closed: boolean;
  note: string | null;
  properties: string[];
  agenda_item_id: string | null;
  coord_open: { name: string | null; status: string }[];
}

interface RawShowing {
  meeting_id: string;
  client_id: string | null;
  client_name: string;
  starts_at: string;
  status: string;
  showcase_status: string;
  client_status: string | null;
  note: string | null;
  property_ids: string[];
  agenda_item_id: string | null;
}

function whenText(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function loadShowings(
  supabase: SupabaseClient,
  agentId: string,
  fromIso: string,
  toIso: string | null,
): Promise<{ ok: true; rows: RawShowing[] } | { ok: false; error: string }> {
  const { data: shows, error: showErr } = await supabase.from("client_showcases")
    .select("id, status, client_id")
    .eq("agent_id", agentId);
  if (showErr) return { ok: false, error: showErr.message };
  const showBy = new Map((shows || []).map((s) => [String(s.id), s]));
  const showIds = [...showBy.keys()];
  if (!showIds.length) return { ok: true, rows: [] };

  let q = supabase.from("client_showcase_meetings")
    .select("id, showcase_id, property_ids, starts_at, status, note, agenda_item_id")
    .in("showcase_id", showIds)
    .in("status", ["requested", "confirmed"])
    .gte("starts_at", fromIso)
    .order("starts_at", { ascending: true })
    .limit(40);
  if (toIso) q = q.lt("starts_at", toIso);
  const { data: meetings, error } = await q;
  if (error) return { ok: false, error: error.message };

  const clientIds = [...new Set((shows || []).map((s) => s.client_id).filter(Boolean))];
  const { data: clients } = clientIds.length
    ? await supabase.from("agent_clients").select("id, full_name, status").in("id", clientIds)
    : { data: [] as { id: string; full_name: string; status: string }[] };
  const clientBy = new Map((clients || []).map((c) => [String(c.id), c]));

  const rows: RawShowing[] = (meetings || []).map((m) => {
    const sc = showBy.get(String(m.showcase_id));
    const client = sc ? clientBy.get(String(sc.client_id)) : undefined;
    return {
      meeting_id: String(m.id),
      client_id: sc?.client_id ? String(sc.client_id) : null,
      client_name: String(client?.full_name || ""),
      starts_at: String(m.starts_at),
      status: String(m.status),
      showcase_status: String(sc?.status || ""),
      client_status: client?.status ? String(client.status) : null,
      note: m.note ? String(m.note) : null,
      property_ids: ((m.property_ids as string[]) || []).map(String),
      agenda_item_id: m.agenda_item_id ? String(m.agenda_item_id) : null,
    };
  });
  return { ok: true, rows };
}

async function propertyLines(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await supabase.from("properties")
    .select("id, street, house_number, city")
    .in("id", ids);
  for (const p of data || []) {
    const line = [p.street, p.house_number].filter(Boolean).join(" ");
    out.set(String(p.id), [line, p.city].filter(Boolean).join(", ") || "נכס");
  }
  return out;
}

export async function decorateShowings(
  supabase: SupabaseClient,
  rows: RawShowing[],
): Promise<ShowingView[]> {
  const propIds = [...new Set(rows.flatMap((r) => r.property_ids))];
  const meetIds = rows.map((r) => r.meeting_id);
  const [places, reqs] = await Promise.all([
    propertyLines(supabase, propIds),
    meetIds.length
      ? supabase.from("showing_coord_requests")
        .select("meeting_id, status, target_name")
        .in("meeting_id", meetIds)
        .in("status", [...NON_FINAL_COORD])
      : Promise.resolve({ data: [] as { meeting_id: string; status: string; target_name: string | null }[] }),
  ]);
  const coord = new Map<string, { name: string | null; status: string }[]>();
  for (const r of reqs.data || []) {
    const list = coord.get(String(r.meeting_id)) || [];
    list.push({ name: r.target_name ? String(r.target_name) : null, status: String(r.status) });
    coord.set(String(r.meeting_id), list);
  }
  return rows.map((r) => ({
    meeting_id: r.meeting_id,
    client_id: r.client_id,
    client_name: r.client_name || "לקוח/ה",
    starts_at: r.starts_at,
    when: whenText(r.starts_at),
    status: r.status,
    showcase_status: r.showcase_status,
    client_status: r.client_status,
    closed: r.showcase_status === "closed" || r.client_status === "closed",
    note: r.note,
    properties: r.property_ids.map((id) => places.get(id) || "נכס"),
    agenda_item_id: r.agenda_item_id,
    coord_open: coord.get(r.meeting_id) || [],
  }));
}

export async function listShowingsForAgent(
  supabase: SupabaseClient,
  agentId: string,
  opts: { fromIso: string; toIso: string | null; query?: string; clock?: string | null },
): Promise<{ ok: true; showings: ShowingView[] } | { ok: false; error: string }> {
  const loaded = await loadShowings(supabase, agentId, opts.fromIso, opts.toIso);
  if (!loaded.ok) return loaded;
  const picked = pickShowings(
    loaded.rows.map((r) => ({ ...r, client_name: r.client_name })),
    opts.query || "",
    opts.clock || null,
  );
  return { ok: true, showings: await decorateShowings(supabase, picked) };
}

async function ownedMeeting(
  supabase: SupabaseClient,
  agentId: string,
  meetingId: string,
): Promise<RawShowing | null> {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const loaded = await loadShowings(supabase, agentId, since, null);
  if (!loaded.ok) return null;
  return loaded.rows.find((r) => r.meeting_id === meetingId) || null;
}

export interface CancelOutcome {
  ok: boolean;
  error?: string;
  needs_confirm?: boolean;
  showings?: ShowingView[];
  canceled?: ShowingView;
  notified?: { name: string; sent: boolean }[];
  offer_notify?: boolean;
  guidance: string;
}

export async function cancelShowingForAgent(
  supabase: SupabaseClient,
  agentId: string,
  input: { meeting_id?: string; query?: string; clock?: string | null; confirm?: boolean; notify_targets?: boolean },
): Promise<CancelOutcome> {
  const meetingId = String(input.meeting_id || "");
  let chosen: RawShowing | null = null;
  if (meetingId) {
    chosen = await ownedMeeting(supabase, agentId, meetingId);
    if (!chosen) {
      return {
        ok: false,
        error: "הסיור לא נמצא אצל הסוכן/ת, או שכבר בוטל.",
        guidance: "list_showings עם השם. אל תאמרי שבוטל אם הכלי לא החזיר canceled.",
      };
    }
  } else {
    const loaded = await loadShowings(
      supabase, agentId, new Date(Date.now() - 6 * 3600_000).toISOString(), null,
    );
    if (!loaded.ok) return { ok: false, error: loaded.error, guidance: "נסי שוב." };
    const picked = pickShowings(loaded.rows, input.query || "", input.clock || null);
    if (!picked.length) {
      return {
        ok: false,
        error: "אין סיור מיניסייט שמתאים.",
        guidance: "אם יש התראה אחרונה בהקשר - אמרי מה כתוב בה. אל תאמרי שאין פגישה בלי agenda_list.",
      };
    }
    if (picked.length > 1 || !input.confirm) {
      const showings = await decorateShowings(supabase, picked);
      return {
        ok: true,
        needs_confirm: true,
        showings,
        guidance: picked.length > 1
          ? "יותר מסיור אחד. שאלי איזה (שם ושעה) ורק אז cancel_showing עם meeting_id ו-confirm."
          : "נמצא סיור אחד. אמרי את השם והשעה ושאלי אישור. confirm רק אחרי שהסוכן/ת אישר/ה את הסיור הזה.",
      };
    }
    chosen = picked[0];
  }

  if (!input.confirm) {
    const showings = await decorateShowings(supabase, [chosen]);
    return {
      ok: true,
      needs_confirm: true,
      showings,
      guidance: "עדיין לא בוטל. confirm:true רק אחרי אישור מפורש על הסיור הזה.",
    };
  }

  const views = await decorateShowings(supabase, [chosen]);
  const view = views[0];

  // לפני עדכון הסטטוס: הטריגר במסד מבטל את הבקשות הפתוחות ברגע שהסיור
  // עובר ל-canceled, ואז השאילתה הזו כבר לא רואה אותן.
  const { data: openReqs } = await supabase.from("showing_coord_requests")
    .select("id, status, target_name, target_phone, property_id")
    .eq("meeting_id", chosen.meeting_id)
    .eq("agent_id", agentId)
    .in("status", [...NON_FINAL_COORD]);
  const reqs = openReqs || [];

  const { error: meetErr } = await supabase.from("client_showcase_meetings")
    .update({ status: "canceled", decided_at: new Date().toISOString() })
    .eq("id", chosen.meeting_id)
    .in("status", ["requested", "confirmed"]);
  if (meetErr) return { ok: false, error: meetErr.message, guidance: "הביטול לא נשמר." };

  if (chosen.agenda_item_id) {
    await supabase.from("agent_agenda_items")
      .update({ status: "canceled" })
      .eq("id", chosen.agenda_item_id)
      .eq("agent_id", agentId)
      .eq("status", "open");
  }

  const tellRows = reqs.filter((r) => (NOTIFY_COORD as readonly string[]).includes(String(r.status)));
  const tellIds = tellRows.map((r) => String(r.id));
  if (tellIds.length) {
    const flagged = await supabase.from("showing_coord_requests")
      .update({ status: "canceled", cancel_unnotified: true })
      .in("id", tellIds);
    if (flagged.error) {
      await supabase.from("showing_coord_requests").update({ status: "canceled" }).in("id", tellIds);
    }
  }
  await supabase.from("showing_coord_requests")
    .update({ status: "canceled" })
    .eq("meeting_id", chosen.meeting_id)
    .eq("agent_id", agentId)
    .in("status", [...NON_FINAL_COORD]);

  let notified: { name: string; sent: boolean }[] | undefined;
  if (input.notify_targets && tellRows.length) {
    notified = await sendCancelNotices(supabase, agentId, chosen, tellRows);
    if (tellIds.length) {
      await supabase.from("showing_coord_requests")
        .update({ cancel_unnotified: false })
        .in("id", tellIds);
    }
  }

  const names = tellRows.map((t) => t.target_name).filter(Boolean).join(", ");
  return {
    ok: true,
    canceled: view,
    notified,
    offer_notify: !input.notify_targets && tellRows.length > 0,
    guidance: input.notify_targets
      ? "אמרי שבוטל, ולמי נשלחה הודעה ולמי לא."
      : tellRows.length
        ? `הסיור בוטל. בקשות התיאום נסגרו. ${names} כבר קיבלו בקשה - שאלי אם להודיע להם על הביטול, או שהכפתור ישאל.`
        : "הסיור בוטל. אין מי שכבר קיבל בקשת תיאום.",
  };
}

async function sendCancelNotices(
  supabase: SupabaseClient,
  agentId: string,
  meeting: RawShowing,
  rows: { target_name: string | null; target_phone: string | null; property_id: string }[],
): Promise<{ name: string; sent: boolean }[]> {
  const { data: member } = await supabase.from("agency_members")
    .select("display_name, agency_id")
    .eq("id", agentId)
    .maybeSingle();
  const places = await propertyLines(supabase, rows.map((r) => String(r.property_id)));
  const who = String(member?.display_name || "").trim();
  const out: { name: string; sent: boolean }[] = [];
  for (const row of rows) {
    const name = String(row.target_name || "").trim() || "שלום";
    const to = phoneE164(row.target_phone);
    const place = places.get(String(row.property_id)) || "הנכס";
    const from = who ? `כאן ${who}. ` : "";
    const text = `שלום ${name}, ${from}הביקור שתואם ${whenText(meeting.starts_at)} ב${place} בוטל. אין צורך להגיע. תודה.`;
    if (!to) {
      out.push({ name, sent: false });
      continue;
    }
    try {
      const waId = await sendText(to, text);
      await supabase.from("whatsapp_messages").insert({
        wa_message_id: waId,
        direction: "out",
        wa_phone: to,
        msg_type: "text",
        body: text.slice(0, 2000),
        status: waId ? "sent" : null,
      });
      out.push({ name, sent: !!waId });
    } catch (err) {
      console.error("showing cancel notice failed", err);
      out.push({ name, sent: false });
    }
  }
  return out;
}

/** כפתור "להודיע על הביטול" אחרי שכבר בוטל. null = לא הכפתור הזה. */
export async function showingCancelNotifyReply(
  supabase: SupabaseClient,
  agentId: string,
  buttonId: string,
): Promise<string | null> {
  const m = /^scn:([0-9a-f-]{36})$/i.exec(buttonId || "");
  if (!m) return null;
  const meetingId = m[1];
  const owned = await supabase.from("client_showcase_meetings")
    .select("id, starts_at, property_ids, showcase_id, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (owned.error || !owned.data) return "לא מצאתי את הסיור הזה.";
  const { data: sc } = await supabase.from("client_showcases")
    .select("agent_id")
    .eq("id", owned.data.showcase_id)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (!sc) return "הסיור הזה אינו שלך.";

  const { data, error } = await supabase.from("showing_coord_requests")
    .select("id, target_name, target_phone, property_id")
    .eq("meeting_id", meetingId)
    .eq("agent_id", agentId)
    .eq("cancel_unnotified", true);
  if (error) {
    return "עוד אי אפשר לשלוח מכאן את הודעת הביטול. אפשר לבקש ממני שוב אחרי עדכון המערכת.";
  }
  if (!data?.length) return "אין מי שמחכה לעדכון על הביטול.";
  const meeting: RawShowing = {
    meeting_id: meetingId,
    client_id: null,
    client_name: "",
    starts_at: String(owned.data.starts_at),
    status: String(owned.data.status),
    showcase_status: "",
    client_status: null,
    note: null,
    property_ids: ((owned.data.property_ids as string[]) || []).map(String),
    agenda_item_id: null,
  };
  const sent = await sendCancelNotices(supabase, agentId, meeting, data);
  await supabase.from("showing_coord_requests")
    .update({ cancel_unnotified: false })
    .in("id", data.map((r) => String(r.id)));
  const ok = sent.filter((s) => s.sent).map((s) => s.name);
  const no = sent.filter((s) => !s.sent).map((s) => s.name);
  const parts = ["שלחתי שהביקור בוטל."];
  if (ok.length) parts.push(`הגיע אל: ${ok.join(", ")}.`);
  if (no.length) parts.push(`לא יצא אל: ${no.join(", ")} (אין חלון וואטסאפ או אין מספר).`);
  return parts.join(" ");
}

