-- גבריאלה: סיורי מיניסייט.
--
-- ביטול או דחייה של סיור סגרו רק בקשות תיאום ב-pending. בקשה שכבר יצאה
-- (sending, sent, postpone, confirmed) נשארה פתוחה, והתזכורת המשיכה.
-- סגירת לקוח/ה סגרה את המיניסייט והשאירה סיורים עתידיים ובקשות פתוחות.
-- סיכום התיאום לא בדק אם המיניסייט או הלקוח/ה סגורים, ולא כתב
-- related_showcase_id.
--
-- אין כאן עדכון של שורות קיימות. ניקוי חד-פעמי של סיורים שכבר פתוחים
-- תחת מיניסייט סגור הוא שאילתת קריאה בתיאור ה-PR, לא חלק מהמיגרציה.

alter table public.whatsapp_messages
  add column if not exists reply_to_wa_id text;

comment on column public.whatsapp_messages.reply_to_wa_id is
  'מזהה הודעת וואטסאפ שעונים עליה (context.id). העברה אינה תשובה.';

alter table public.showing_coord_requests
  add column if not exists cancel_unnotified boolean not null default false;

comment on column public.showing_coord_requests.cancel_unnotified is
  'הבקשה כבר נשלחה (sent, postpone, confirmed) ואז הסיור בוטל, ועוד לא יצאה הודעת ביטול.';

create index if not exists showing_coord_requests_cancel_unnotified_idx
  on public.showing_coord_requests (meeting_id)
  where cancel_unnotified;

-- ---------------------------------------------------------------------------
-- ביטול סיור: כל בקשה שאינה סופית, לא רק pending.
-- צד ימין של SET רואה את השורה הישנה, ולכן cancel_unnotified לפי הסטטוס
-- שלפני העדכון. declined, canceled, opted_out, failed, no_phone, no_channel
-- נשארים כמו שהם.
-- ---------------------------------------------------------------------------
create or replace function public.client_showcase_meetings_cancel_coord()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.showing_coord_requests
     set status = 'canceled',
         cancel_unnotified = status in ('sent', 'postpone', 'confirmed')
   where meeting_id = new.id
     and status in ('pending', 'sending', 'sent', 'postpone', 'confirmed');
  return null;
end;
$$;

revoke all on function public.client_showcase_meetings_cancel_coord() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- סגירת מיניסייט (גם כשלקוח/ה נסגר/ה, דרך agent_clients_close_showcase)
-- מבטלת סיורים עתידיים שעוד לא התקיימו. עדכון הסטטוס מפעיל את
-- client_showcase_meetings_cancel_coord, ושם נסגרות הבקשות הפתוחות.
-- סיור שכבר עבר לא נוגעים בו.
-- ---------------------------------------------------------------------------
create or replace function public.client_showcases_cancel_future_meetings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_showcase_meetings
     set status = 'canceled',
         decided_at = now()
   where showcase_id = new.id
     and status in ('requested', 'confirmed')
     and starts_at > now();
  return null;
end;
$$;

revoke all on function public.client_showcases_cancel_future_meetings() from public, anon, authenticated;

drop trigger if exists client_showcases_cancel_future_meetings on public.client_showcases;
create trigger client_showcases_cancel_future_meetings
  after update of status on public.client_showcases
  for each row
  when (new.status = 'closed' and old.status is distinct from new.status)
  execute function public.client_showcases_cancel_future_meetings();

-- ---------------------------------------------------------------------------
-- סיכום לפני הסיור: מדלג על מיניסייט או לקוח/ה סגורים, ונושא את המיניסייט.
-- הגוף זהה ל-20270419090000, עם הסינון והעמודה.
-- ---------------------------------------------------------------------------
create or replace function public.showing_coord_briefs()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_kind   text;
  v_total  int;
  v_ok     int;
  v_wait   int;
  v_neg    int;
  v_miss   int;
  v_lines  text;
  v_sum    text;
  v_title  text;
  v_n      int := 0;
begin
  for r in
    select m.id, m.starts_at, m.agenda_item_id, m.coord_briefs,
           s.agent_id, s.client_id, s.id as showcase_id, c.full_name as client_name
      from public.client_showcase_meetings m
      join public.client_showcases s on s.id = m.showcase_id
      left join public.agent_clients c on c.id = s.client_id
     where m.status in ('requested','confirmed')
       and s.status = 'active'
       and coalesce(c.status, '') <> 'closed'
       and m.starts_at > now()
       and m.starts_at <= now() + interval '2 hours'
       and exists (select 1 from public.showing_coord_requests q
                    where q.meeting_id = m.id and q.status <> 'canceled')
     for update of m skip locked
  loop
    v_kind := case
      when now() >= r.starts_at - interval '30 minutes' then 'final'
      when now() <  r.starts_at - interval '40 minutes' then 'early'
    end;
    continue when v_kind is null or v_kind = any (r.coord_briefs);
    continue when not public.agent_agenda_enabled(r.agent_id);

    select count(*),
           count(*) filter (where q.status = 'confirmed'),
           count(*) filter (where q.status in ('pending','sending','sent')),
           count(*) filter (where q.status in ('postpone','declined')),
           count(*) filter (where q.status in ('no_phone','no_channel','failed','opted_out')),
           string_agg(
             case q.status
               when 'confirmed' then '✅'
               when 'postpone'  then '🕒'
               when 'declined'  then '📆'
               when 'sent'      then '⏳'
               when 'pending'   then '⏳'
               when 'sending'   then '⏳'
               else '⚠️' end
             || ' ' || coalesce(nullif(btrim(q.target_name), ''), 'ללא שם')
             || coalesce(' - ' || nullif(btrim(concat_ws(' ', p.street, p.house_number)), ''), ''),
             ' · ' order by q.status = 'confirmed', q.created_at)
      into v_total, v_ok, v_wait, v_neg, v_miss, v_lines
      from public.showing_coord_requests q
      join public.properties p on p.id = q.property_id
     where q.meeting_id = r.id and q.status <> 'canceled';

    if v_kind = 'final' and v_ok = v_total then
      update public.client_showcase_meetings
         set coord_briefs = coord_briefs || 'final'::text where id = r.id;
      continue;
    end if;

    v_sum := case when v_ok = v_total then 'כולם אישרו ✅'
      else concat_ws(', ',
        case when v_ok   > 0 then v_ok   || ' אישרו' end,
        case when v_wait > 0 then v_wait || ' עוד לא ענו' end,
        case when v_neg  > 0 then v_neg  || ' ביקשו לדחות או מועד אחר' end,
        case when v_miss > 0 then v_miss || ' לא קיבלו את הבקשה' end) end;

    v_title := case v_kind
      when 'early' then '📋 לפני הסיור'
      else '⏰ עוד חצי שעה סיור' end
      || coalesce(' עם ' || nullif(btrim(r.client_name), ''), '')
      || ' ב-' || to_char(r.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
      || ': ' || v_sum;

    insert into public.notifications
      (agent_id, type, title, body, related_client_id, related_agenda_item_id, related_showcase_id)
    values (r.agent_id, 'agenda_reminder', left(v_title, 200), left(v_lines, 400),
            r.client_id, r.agenda_item_id, r.showcase_id);

    update public.client_showcase_meetings
       set coord_briefs = coord_briefs || v_kind where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.showing_coord_briefs() is
  'סיכום תיאום הביקור לסוכן/ת: שעתיים לפני הסיור, ושוב חצי שעה לפני אם מישהו/י עוד לא אישר/ה. מדלג על מיניסייט או לקוח/ה סגורים. מחזירה כמה התראות נוצרו.';

revoke all on function public.showing_coord_briefs() from public, anon, authenticated;
grant execute on function public.showing_coord_briefs() to service_role;

create or replace function public.showing_coord_nudge_claim(p_limit int default 30)
returns table (
  request_id   uuid,
  token        text,
  target       text,
  target_name  text,
  target_phone text,
  window_start timestamptz,
  agent_id     uuid,
  agent_name   text,
  agent_gender text,
  agency_name  text,
  property_line text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hour int := extract(hour from now() at time zone 'Asia/Jerusalem');
begin
  if v_hour < 8 or v_hour >= 21 then
    return;
  end if;

  return query
  with picked as (
    select r.id from public.showing_coord_requests r
      join public.client_showcase_meetings m on m.id = r.meeting_id
      join public.client_showcases s on s.id = m.showcase_id
     where r.status = 'sent'
       and r.nudged_at is null
       and r.sent_at is not null
       and m.status in ('requested','confirmed')
       and s.status = 'active'
       and not exists (
         select 1 from public.agent_clients c
          where c.id = s.client_id and c.status = 'closed')
       and r.window_start - r.sent_at >= interval '2 hours'
       and now() >= r.sent_at + greatest(interval '1 hour', (r.window_start - r.sent_at) / 2)
       and now() <= r.window_start - interval '1 hour'
     order by r.sent_at
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
     for update of r skip locked
  ),
  upd as (
    update public.showing_coord_requests r
       set nudged_at = now()
      from picked
     where r.id = picked.id
    returning r.*
  )
  select upd.id, upd.token, upd.target, upd.target_name, upd.target_phone, upd.window_start,
         upd.agent_id, m.display_name, m.gender, a.name,
         concat_ws(', ', nullif(btrim(concat_ws(' ', p.street, p.house_number)), ''), p.city)
    from upd
    join public.agency_members m on m.id = upd.agent_id
    left join public.agencies a on a.id = m.agency_id
    join public.properties p on p.id = upd.property_id;
end;
$$;

revoke all on function public.showing_coord_nudge_claim(int) from public, anon, authenticated;
grant execute on function public.showing_coord_nudge_claim(int) to service_role;

-- ה-cron מתעורר רק כשיש מה לעשות על מיניסייט פעיל ולקוח/ה שלא נסגר/ה.
create or replace function public.showing_coord_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
        select 1 from public.showing_coord_requests r
          join public.client_showcase_meetings m on m.id = r.meeting_id
          join public.client_showcases s on s.id = m.showcase_id
          left join public.agent_clients c on c.id = s.client_id
         where r.status = 'pending'
           and s.status = 'active'
           and coalesce(c.status, '') <> 'closed')
      or exists (
        select 1 from public.showing_coord_requests r
          join public.client_showcase_meetings m on m.id = r.meeting_id
          join public.client_showcases s on s.id = m.showcase_id
          left join public.agent_clients c on c.id = s.client_id
         where r.status = 'sent' and r.nudged_at is null and r.sent_at is not null
           and m.status in ('requested','confirmed')
           and s.status = 'active'
           and coalesce(c.status, '') <> 'closed'
           and r.window_start - r.sent_at >= interval '2 hours'
           and now() >= r.sent_at + greatest(interval '1 hour', (r.window_start - r.sent_at) / 2)
           and now() <= r.window_start - interval '1 hour'
           and extract(hour from now() at time zone 'Asia/Jerusalem') between 8 and 20)
      or exists (
        select 1 from public.client_showcase_meetings m
          join public.client_showcases s on s.id = m.showcase_id
          left join public.agent_clients c on c.id = s.client_id
          join public.whatsapp_conversations cv
            on cv.agent_id = s.agent_id and cv.last_message_at > now() - interval '23 hours'
         where m.coord_offer is null
           and m.status in ('requested','confirmed')
           and s.status = 'active'
           and coalesce(c.status, '') <> 'closed'
           and m.starts_at > now() + interval '30 minutes'
           and m.created_at > now() - interval '3 days');
$$;

revoke all on function public.showing_coord_ready() from public, anon, authenticated;
grant execute on function public.showing_coord_ready() to service_role;
