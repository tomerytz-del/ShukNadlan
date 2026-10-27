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

-- מזהה הסיור על ההתראה לסוכן/ת, כדי שכפתור scn: ייצא בלי לשלוח ללקוח/ה.
alter table public.notifications
  add column if not exists related_meeting_id uuid
  references public.client_showcase_meetings(id) on delete set null;

comment on column public.notifications.related_meeting_id is
  'סיור מיניסייט שההתראה עוסקת בו. סגירת מיניסייט כותבת אותו כדי שכפתור scn: יוכל לעדכן את מי שכבר קיבל בקשה.';

-- ---------------------------------------------------------------------------
-- סגירת מיניסייט (גם כשלקוח/ה נסגר/ה, דרך agent_clients_close_showcase)
-- מבטלת סיורים עתידיים שעוד לא התקיימו. עדכון הסטטוס מפעיל את
-- client_showcase_meetings_cancel_coord, ושם נסגרות הבקשות הפתוחות.
-- סיור שכבר עבר לא נוגעים בו. אם מישהו כבר קיבל בקשה, נכתבת התראה
-- לסוכן/ת (לא הודעה ללקוח/ה) עם related_meeting_id.
-- ---------------------------------------------------------------------------
create or replace function public.client_showcases_cancel_future_meetings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_names    text;
  v_client   uuid;
  v_agent    uuid;
  v_who      text;
begin
  select s.agent_id, s.client_id, nullif(btrim(c.full_name), '')
    into v_agent, v_client, v_who
    from public.client_showcases s
    left join public.agent_clients c on c.id = s.client_id
   where s.id = new.id;

  for r in
    update public.client_showcase_meetings
       set status = 'canceled',
           decided_at = now()
     where showcase_id = new.id
       and status in ('requested', 'confirmed')
       and starts_at > now()
    returning id, starts_at, agenda_item_id
  loop
    -- הטריגר על הסיור כבר סימן cancel_unnotified למי שקיבל בקשה.
    -- ההודעה אליהם לא יוצאת מכאן. בתוך חלון 24 השעות notification-push
    -- מוסיף כפתור scn: על התראה אחת. מחוץ לחלון יוצאת תבנית בלי הכפתור,
    -- ולכן גוף ההתראה לא מבטיח כפתור: הוא מפנה לכרטיס הלקוח.
    select string_agg(coalesce(nullif(btrim(q.target_name), ''), 'ללא שם'), ', ' order by q.created_at)
      into v_names
      from public.showing_coord_requests q
     where q.meeting_id = r.id
       and q.cancel_unnotified;

    if v_agent is null or v_names is null then
      continue;
    end if;

    insert into public.notifications
      (agent_id, type, title, body, related_client_id, related_showcase_id,
       related_agenda_item_id, related_meeting_id)
    values (
      v_agent,
      'showcase_meeting',
      left('סיור בוטל' || coalesce(' עם ' || v_who, '') || ' - המיניסייט נסגר', 200),
      left(
        'הביקור ב-' || to_char(r.starts_at at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI')
        || ' בוטל כי המיניסייט נסגר. בקשת תיאום כבר יצאה אל: ' || v_names
        || '. ההודעה אליהם לא נשלחה. עדכון למי שכבר קיבל בקשה נעשה רק אחרי אישור, מכרטיס הלקוח.',
        400),
      v_client,
      new.id,
      r.agenda_item_id,
      r.id);
  end loop;
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

-- ---------------------------------------------------------------------------
-- notification_push_claim: אותו גוף כמו 20270902090000, ועוד meeting_id.
-- העמודה חסרה לפני המיגרציה הזו, ולכן הפונקציה מוחלפת רק כאן.
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_claim(p_limit int default 20)
returns table (log_id uuid, agent_id uuid, display_name text, phone_e164 text,
               channel_mode text, items jsonb, item_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
  v_look_p  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_priority_lookback_hours'), 72);
  v_prio    text[] := public.notification_push_priority_types();
  v_digest  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_ambient_digest_minutes'), 180);
  v_wake    boolean;
begin
  -- קריאה אחת בכל רגע (20270425090000). שלושה cron-ים קוראים ל-notification-push
  -- (הכללי כל 5 דקות, היומן וסיכומי הסיור כל דקה), וכשהם נפגשים באותה שנייה
  -- שתי קריאות רצו במקביל, אף אחת לא ראתה את שורת היומן של השנייה, ושתיהן
  -- שלחו. הנעילה משתחררת בסוף הטרנזקציה, והקריאה השנייה רואה את מה שנרשם.
  perform pg_advisory_xact_lock(hashtext('notification_push_claim'));

  -- רישום בלבד; החסימה כבר שוחררה על ידי הפרדיקט.
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    -- המזהים נוסעים עם ההתראה: ‏notification-push בונה מהם את הקישור הישיר
    -- לפריט (itemPath), במקום קישור לקטגוריה.
    select jsonb_agg(jsonb_build_object(
             'type',        n.type,
             'title',       n.title,
             'body',        n.body,
             'property_id', n.related_property_id,
             'client_id',   coalesce(n.related_client_id,
                                     (select s.client_id from public.client_showcases s
                                       where s.id = n.related_showcase_id)),
             'lead_id',     n.related_lead_id,
             -- נכס של משרד אחר (שיתוף) נפתח ב"שותפו איתי", לא ב"הנכסים שלי"
             'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                 from public.properties p where p.id = n.related_property_id),
             'agenda_item_id', n.related_agenda_item_id,
             'agreement_id',  n.related_agreement_id,
             'meeting_id',    n.related_meeting_id,
             -- ביקורת ממתינה - למי שמאשר/ת אותה; מפורסמת - לדף הסוכן/ת. לסוכן/ת
             -- שהביקורת עליו/ה וממתינה אין מה לעשות איתה, ולכן אין לה יעד.
             'review_id', (select rv.id from public.reviews rv
                            where rv.id = n.related_review_id and rv.status = 'pending'
                              and rv.agent_id is distinct from n.agent_id),
             'review_agent_slug', (select m.slug from public.reviews rv
                                     join public.agency_members m on m.id = rv.agent_id
                                    where rv.id = n.related_review_id and rv.status = 'published')
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type),
           -- יש כאן משהו שמצדיק הודעה: התראה שאינה רקע, או רקע שחיכה עד התקציר
           bool_or(not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                   or n.created_at <= now() - make_interval(mins => v_digest))
      into v_items, v_ids, v_types, v_wake
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and (n.created_at > now() - make_interval(hours =>
              case when n.type = any(v_prio) then v_look_p else v_look end)
            -- רילס ותוכן שיווקי שנוצרו בשקט מחכים לסוף השקט (20270902090000)
            or public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
       -- תזכורת ישנה אינה עוקפת שעות שקט: היא מחכה לבוקר (20270422090000)
       and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at);

    continue when v_items is null or not v_wake;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;


comment on function public.notification_push_claim(int) is
<<<<<<<< HEAD:supabase/migrations/20271029121000_gabriela_showings.sql
  'כמו 20270902090000, ובנוסף meeting_id מ-related_meeting_id כדי שסגירת מיניסייט תוכל לשלוח כפתור scn: בלי הודעה ללקוח/ה (20271029121000).';
========
  'כמו 20270902090000, ובנוסף meeting_id מ-related_meeting_id כדי שסגירת מיניסייט תוכל לשלוח כפתור scn: בלי הודעה ללקוח/ה (20271028121000).';
>>>>>>>> 06f75d03 (מיגרציות: סיורים 121000, ניצחונות 122000, תקציר 133000):supabase/migrations/20271028121000_gabriela_showings.sql

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
