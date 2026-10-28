-- ============================================================================
-- כפתור "התאמת קצב התראות" בוואטסאפ. כבוי.
--
-- version 20271029310000.
-- app_config.notif_cadence_button_enabled = false. כל ערך שאינו
-- 1/true/on/yes משאיר את השליחה כמו היום: אין כפתור, וליד חדש יוצא
-- כמו עד עכשיו.
--
-- לא נוגעים ב-notify_agent_on_new_lead, ב-notifications_apply_preferences
-- ובקליטת ליד מהרשתות. האכיפה היא ב-notification_push_claim
-- (notification_push_lead_wa_sendable) ובשכבת השליחה.
-- בחירת קצב אינה כותבת התראה, ומסמנת lead_wa_since כדי שצבר ישן
-- לא יישפך לוואטסאפ.
-- ============================================================================

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  description text not null default ''
);

alter table public.app_config enable row level security;
revoke all on table public.app_config from public, anon, authenticated;
grant select, insert, update, delete on table public.app_config to service_role;

insert into public.app_config (key, value, description) values
  ('notif_cadence_button_enabled', 'false',
   'true: כפתור התאמת קצב התראות, וקצב הלידים נאכף. false: השליחה כמו היום.'),
  ('notif_lead_digest_daily_hour', '9',
   'שעת הסיכום היומי של לידים, שעון אסיה/ירושלים.'),
  ('notif_lead_digest_hours', '9,13,17',
   'שעות הסיכום של שלוש פעמים ביום, מופרדות בפסיק.'),
  ('notif_lead_digest_window_minutes', '15',
   'כמה דקות מתחילת השעה עדיין נחשבות לחלון השליחה.'),
  ('notif_lead_digest_outside', 'cap',
   'מחוץ לחלון 24 השעות: cap (לכל היותר תקרת התבניות, והשאר בפעמון), bell (רק פעמון), send (תבנית גם מעל התקרה).')
on conflict (key) do nothing;

alter table public.agent_notification_preferences
  add column if not exists lead_wa_cadence text not null default 'each',
  add column if not exists lead_wa_since timestamptz;

alter table public.agent_notification_preferences
  drop constraint if exists agent_notification_preferences_lead_wa_cadence_chk;
alter table public.agent_notification_preferences
  add constraint agent_notification_preferences_lead_wa_cadence_chk
  check (lead_wa_cadence in ('each', 'daily', 'thrice', 'off'));

comment on column public.agent_notification_preferences.lead_wa_cadence is
  'קצב וואטסאפ לליד חדש: each, daily, thrice, off. נאכף רק כש-notif_cadence_button_enabled דלוק. אותו שדה נשמר ממסך ההתראות.';
comment on column public.agent_notification_preferences.lead_wa_since is
  'לידים חדשים מלפני הרגע הזה לא יוצאים לוואטסאפ אחרי שינוי קצב, כדי שלא תהיה התפרצות.';

create table if not exists public.notif_cadence_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  event text not null,
  choice text,
  created_at timestamptz not null default now(),
  constraint notif_cadence_log_event_chk check (event in ('open', 'choose', 'ask', 'back')),
  constraint notif_cadence_log_choice_chk check (
    choice is null or choice in ('each', 'daily', 'thrice', 'off'))
);

comment on table public.notif_cadence_log is
  'מדידת לחיצות על התאמת הקצב ועל הבחירה. אין בה טלפון.';

create index if not exists notif_cadence_log_agent_idx
  on public.notif_cadence_log (agent_id, created_at desc);

alter table public.notif_cadence_log enable row level security;
revoke all on table public.notif_cadence_log from public, anon, authenticated;
grant select, insert, update, delete on table public.notif_cadence_log to service_role;

-- בחירת "ללא התראות" שלא אושרה. נמחקת אחרי 30 דקות בלי שמירה.
create table if not exists public.notif_cadence_pending (
  agent_id uuid primary key references public.agency_members(id) on delete cascade,
  expires_at timestamptz not null
);

comment on table public.notif_cadence_pending is
  'אישור שני לכיבוי התראות הוואטסאפ. בלי אישור בזמן לא נשמר דבר.';

alter table public.notif_cadence_pending enable row level security;
revoke all on table public.notif_cadence_pending from public, anon, authenticated;
grant select, insert, update, delete on table public.notif_cadence_pending to service_role;

create table if not exists public.notif_cadence_digest (
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  slot_key text not null,
  outcome text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (agent_id, slot_key),
  constraint notif_cadence_digest_outcome_chk check (outcome in ('pending', 'sent', 'bell'))
);

comment on table public.notif_cadence_digest is
  'משבצת סיכום לידים אחת לסוכן/ת. pending נתפס לפני השליחה, sent יצא, bell נשאר בפעמון.';

alter table public.notif_cadence_digest enable row level security;
revoke all on table public.notif_cadence_digest from public, anon, authenticated;
grant select, insert, update, delete on table public.notif_cadence_digest to service_role;

create or replace function public.notif_cadence_button_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce(
           (select c.value from public.app_config c
             where c.key = 'notif_cadence_button_enabled'),
           'false'))) in ('1', 'true', 'on', 'yes');
$$;

comment on function public.notif_cadence_button_on() is
  'האם כפתור הקצב והאכיפה דלוקים. ברירת המחדל false.';

revoke all on function public.notif_cadence_button_on() from public, anon, authenticated;
grant execute on function public.notif_cadence_button_on() to service_role;

create or replace function public.agent_lead_wa_cadence(p_agent uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.notif_cadence_button_on() then 'each'
    else coalesce(
      (select p.lead_wa_cadence
         from public.agent_notification_preferences p
        where p.agent_id = p_agent),
      'each')
  end;
$$;

revoke all on function public.agent_lead_wa_cadence(uuid) from public, anon, authenticated;
grant execute on function public.agent_lead_wa_cadence(uuid) to service_role;

create or replace function public.agent_lead_wa_since(p_agent uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.notif_cadence_button_on() then null
    else (select p.lead_wa_since
            from public.agent_notification_preferences p
           where p.agent_id = p_agent)
  end;
$$;

revoke all on function public.agent_lead_wa_since(uuid) from public, anon, authenticated;
grant execute on function public.agent_lead_wa_since(uuid) to service_role;

-- true: מותר לכלול את ההתראה בהודעת וואטסאפ מיידית.
-- off: ליד חדש והתאמות נשארים בפעמון. daily/thrice: רק הליד המיידי נדחה לסיכום.
create or replace function public.notification_push_lead_wa_sendable(
  p_agent uuid,
  p_type text,
  p_created timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.notif_cadence_button_on() then true
    when public.agent_lead_wa_cadence(p_agent) = 'off'
         and p_type in ('new_lead', 'client_match', 'match_digest') then false
    when p_type is distinct from 'new_lead' then true
    when public.agent_lead_wa_cadence(p_agent) <> 'each' then false
    when public.agent_lead_wa_since(p_agent) is null then true
    else p_created >= public.agent_lead_wa_since(p_agent)
  end;
$$;

comment on function public.notification_push_lead_wa_sendable(uuid, text, timestamptz) is
  'האם התראה מותרת בוואטסאפ המיידי. דגל כבוי: תמיד כן. off: בלי וואטסאפ על ליד והתאמה. daily/thrice: ליד חדש רק בסיכום.';

revoke all on function public.notification_push_lead_wa_sendable(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_lead_wa_sendable(uuid, text, timestamptz) to service_role;

-- send: לשלוח כמו שה-claim החזיר. strip: בלי לידים חדשים. drop: אין מה לשלוח.
create or replace function public.notification_push_prepare_lead_cadence(p_log_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid;
  v_ids uuid[];
  v_keep uuid[];
  v_types text[];
begin
  if not public.notif_cadence_button_on() then
    return 'send';
  end if;
  select l.agent_id, l.notification_ids
    into v_agent, v_ids
    from public.notification_push_log l
   where l.id = p_log_id;
  if not found then
    return 'drop';
  end if;

  select coalesce(array_agg(n.id), '{}'::uuid[]),
         coalesce(array_agg(distinct n.type), '{}'::text[])
    into v_keep, v_types
    from public.notifications n
   where n.id = any(coalesce(v_ids, '{}'::uuid[]))
     and public.notification_push_lead_wa_sendable(v_agent, n.type, n.created_at);

  if coalesce(array_length(v_keep, 1), 0) = 0 then
    update public.notification_push_log l
       set notification_ids = '{}'::uuid[],
           whatsapp_status = 'skipped',
           last_error = 'lead_cadence'
     where l.id = p_log_id
       and l.whatsapp_status = 'pending';
    return 'drop';
  end if;

  if v_keep is distinct from v_ids then
    update public.notification_push_log l
       set notification_ids = v_keep,
           types = v_types
     where l.id = p_log_id;
    return 'strip:' || coalesce((
      select string_agg(distinct n.type, ',')
        from public.notifications n
       where n.id = any(coalesce(v_ids, '{}'::uuid[]))
         and not (n.id = any(v_keep))
    ), '');
  end if;
  return 'send';
end;
$$;

comment on function public.notification_push_prepare_lead_cadence(uuid) is
  'לפני שליחה: מוריד ליד חדש שהקצב לא מאפשר. שורה ריקה מסומנת skipped בלי להחזיק את הלידים, כדי שהסיכום יוכל לקחת אותם.';

revoke all on function public.notification_push_prepare_lead_cadence(uuid) from public, anon, authenticated;
grant execute on function public.notification_push_prepare_lead_cadence(uuid) to service_role;

-- dow|hour|YYYY-MM-DD-hour, או null מחוץ לחלון. המפתח לא מוצג לסוכן/ת.
create or replace function public.lead_wa_digest_slot(
  p_at timestamptz,
  p_mode text,
  p_daily int,
  p_hours int[],
  p_window int
) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local timestamp;
  v_dow int;
  v_hour int;
  v_min int;
begin
  v_local := p_at at time zone 'Asia/Jerusalem';
  v_dow := extract(dow from v_local)::int;
  v_hour := extract(hour from v_local)::int;
  v_min := extract(minute from v_local)::int;
  if v_dow = 6 then
    return null;
  end if;
  if p_mode = 'daily' then
    if v_hour is distinct from p_daily then
      return null;
    end if;
  elsif not (v_hour = any(coalesce(p_hours, '{}'::int[]))) then
    return null;
  end if;
  if v_dow = 5 and v_hour >= 13 then
    return null;
  end if;
  if v_min < 0 or v_min >= greatest(coalesce(p_window, 15), 1) then
    return null;
  end if;
  return v_dow::text || '|' || v_hour::text || '|' || to_char(v_local, 'YYYY-MM-DD') || '-' || v_hour::text;
end;
$$;

comment on function public.lead_wa_digest_slot(timestamptz, text, int, int[], int) is
  'משבצת סיכום לידים. שבת אין. יום שישי רק לפני 13:00. המפתח פנימי.';

revoke all on function public.lead_wa_digest_slot(timestamptz, text, int, int[], int) from public, anon, authenticated;
grant execute on function public.lead_wa_digest_slot(timestamptz, text, int, int[], int) to service_role;


create or replace function public.notif_lead_digest_hours()
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(x::int order by x::int)
       from unnest(string_to_array(
         coalesce((select c.value from public.app_config c where c.key = 'notif_lead_digest_hours'), '9,13,17'),
         ',')) as t(x)
      where x ~ '^[0-9]+$' and x::int between 0 and 23),
    array[9, 13, 17]::int[]);
$$;

revoke all on function public.notif_lead_digest_hours() from public, anon, authenticated;
grant execute on function public.notif_lead_digest_hours() to service_role;

create or replace function public.notif_lead_digest_daily_hour()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when c.value ~ '^[0-9]+$' and c.value::int between 0 and 23 then c.value::int end
       from public.app_config c where c.key = 'notif_lead_digest_daily_hour'),
    9);
$$;

revoke all on function public.notif_lead_digest_daily_hour() from public, anon, authenticated;
grant execute on function public.notif_lead_digest_daily_hour() to service_role;

create or replace function public.notif_lead_digest_outside()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.value from public.app_config c
      where c.key = 'notif_lead_digest_outside'
        and c.value in ('cap', 'bell', 'send')),
    'cap');
$$;

revoke all on function public.notif_lead_digest_outside() from public, anon, authenticated;
grant execute on function public.notif_lead_digest_outside() to service_role;

-- תקרת התבניות לסיכום, גם כשהדגל של התקרה כבוי: 1, שניה אחרי 8 שעות, גג 2.
create or replace function public.lead_wa_digest_cap_allows(p_agent uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  v_last timestamptz;
  v_hours numeric;
  v_daily int := 1;
  v_hard int := 2;
  v_gap numeric := 8;
begin
  if to_regprocedure('public.whatsapp_template_cap_usage(uuid,uuid)') is not null then
    execute 'select n, last_at from public.whatsapp_template_cap_usage($1, null)'
      into v_count, v_last
      using p_agent;
  else
    select count(*)::int, max(l.created_at)
      into v_count, v_last
      from public.notification_push_log l
     where l.agent_id = p_agent
       and l.created_at > now() - interval '2 days'
       and l.channel_mode = 'template'
       and l.whatsapp_status in ('sent', 'pending')
       and (l.created_at at time zone 'Asia/Jerusalem')::date
           = (now() at time zone 'Asia/Jerusalem')::date;
  end if;
  if v_last is not null then
    v_hours := extract(epoch from (now() - v_last)) / 3600.0;
  end if;
  if to_regprocedure('public.whatsapp_template_cap_decide(integer,numeric,boolean,integer,integer,numeric)') is not null then
    return public.whatsapp_template_cap_decide(v_count, v_hours, false, v_daily, v_hard, v_gap);
  end if;
  if coalesce(v_count, 0) < v_daily then
    return true;
  end if;
  if coalesce(v_count, 0) >= v_hard then
    return false;
  end if;
  return v_hours is not null and v_hours >= v_gap;
end;
$$;

revoke all on function public.lead_wa_digest_cap_allows(uuid) from public, anon, authenticated;
grant execute on function public.lead_wa_digest_cap_allows(uuid) to service_role;

-- תופס משבצת pending. מי שכבר נתפס לא חוזר.
create or replace function public.lead_wa_digest_claim()
returns table (
  agent_id uuid,
  phone_e164 text,
  display_name text,
  in_window boolean,
  slot_dow int,
  slot_hour int,
  slot_key text,
  outside_mode text,
  cap_allows boolean,
  leads jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily int := public.notif_lead_digest_daily_hour();
  v_hours int[] := public.notif_lead_digest_hours();
  v_window int := coalesce(
    (select case when c.value ~ '^[0-9]+$' then c.value::int end
       from public.app_config c where c.key = 'notif_lead_digest_window_minutes'),
    15);
  r record;
  v_slot text;
  v_mode text;
  v_leads jsonb;
  v_in boolean;
begin
  if not public.notif_cadence_button_on() then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('lead_wa_digest'));
  delete from public.notif_cadence_digest d
   where d.outcome = 'pending'
     and d.created_at < now() - interval '10 minutes';

  for r in
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone,
           p.lead_wa_cadence as cadence,
           p.lead_wa_since as since
      from public.agency_members m
      join public.agent_notification_preferences p on p.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
       and p.lead_wa_cadence in ('daily', 'thrice')
  loop
    if r.phone is null then
      continue;
    end if;
    v_slot := public.lead_wa_digest_slot(
      now(), r.cadence, v_daily, v_hours, v_window);
    if v_slot is null then
      continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', n.id,
             'lead_id', n.related_lead_id,
             'title', left(coalesce(n.title, 'ליד חדש'), 80)
           ) order by n.created_at desc), '[]'::jsonb)
      into v_leads
      from (
        select n.id, n.related_lead_id, n.title, n.created_at
          from public.notifications n
         where n.agent_id = r.id
           and n.type = 'new_lead'
           and not n.read
           and (r.since is null or n.created_at >= r.since)
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and l.whatsapp_status in ('sent', 'pending')
           )
         order by n.created_at desc
         limit 10
      ) n;
    if coalesce(jsonb_array_length(v_leads), 0) = 0 then
      continue;
    end if;
    begin
      insert into public.notif_cadence_digest (agent_id, slot_key, outcome)
      values (r.id, split_part(v_slot, '|', 3), 'pending');
    exception when unique_violation then
      continue;
    end;
    v_in := coalesce(
      (select c.last_message_at > now() - interval '23 hours'
         from public.whatsapp_conversations c
        where c.agent_id = r.id),
      false);
    agent_id := r.id;
    phone_e164 := r.phone;
    display_name := r.display_name;
    in_window := v_in;
    slot_dow := split_part(v_slot, '|', 1)::int;
    slot_hour := split_part(v_slot, '|', 2)::int;
    slot_key := split_part(v_slot, '|', 3);
    outside_mode := public.notif_lead_digest_outside();
    cap_allows := public.lead_wa_digest_cap_allows(r.id);
    leads := v_leads;
    return next;
  end loop;
end;
$$;

comment on function public.lead_wa_digest_claim() is
  'סוכנים שמשבצת הסיכום שלהם פתוחה עכשיו ויש להם לידים חדשים. דגל כבוי: אפס שורות.';

revoke all on function public.lead_wa_digest_claim() from public, anon, authenticated;
grant execute on function public.lead_wa_digest_claim() to service_role;

create or replace function public.notif_cadence_digest_finish(
  p_agent uuid,
  p_slot text,
  p_outcome text,
  p_ids uuid[],
  p_mode text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('sent', 'bell') then
    return;
  end if;
  update public.notif_cadence_digest d
     set outcome = p_outcome
   where d.agent_id = p_agent
     and d.slot_key = p_slot;
  if p_outcome = 'sent' and coalesce(array_length(p_ids, 1), 0) > 0 then
    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (
      p_agent,
      p_ids,
      array['lead_digest'],
      case when p_mode = 'template' then 'template' else 'text' end,
      'sent'
    );
  end if;
end;
$$;

revoke all on function public.notif_cadence_digest_finish(uuid, text, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.notif_cadence_digest_finish(uuid, text, text, uuid[], text) to service_role;

create or replace function public.notif_cadence_apply(
  p_agent uuid,
  p_event text,
  p_choice text
) returns table (
  enabled boolean,
  changed boolean,
  needs_confirm boolean,
  expired boolean,
  choice text,
  daily_hour int,
  hours int[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on boolean := public.notif_cadence_button_on();
  v_old text;
  v_choice text;
  v_exp timestamptz;
  v_event text;
begin
  v_choice := case
    when p_choice in ('each', 'daily', 'thrice', 'off') then p_choice
    else null
  end;
  v_event := case p_event
    when 'choose' then 'choose'
    when 'ask' then 'ask'
    when 'back' then 'back'
    else 'open'
  end;
  insert into public.notif_cadence_log (agent_id, event, choice)
  values (p_agent, v_event, v_choice);

  enabled := v_on;
  daily_hour := public.notif_lead_digest_daily_hour();
  hours := public.notif_lead_digest_hours();
  choice := coalesce(v_choice, public.agent_lead_wa_cadence(p_agent));
  changed := false;
  needs_confirm := false;
  expired := false;

  if not v_on then
    return next;
    return;
  end if;

  if p_event = 'back' then
    delete from public.notif_cadence_pending where agent_id = p_agent;
    return next;
    return;
  end if;

  -- "ללא התראות" לא נשמר לפני האישור השני.
  if p_event = 'ask' and v_choice = 'off' then
    insert into public.notif_cadence_pending (agent_id, expires_at)
    values (p_agent, now() + interval '30 minutes')
    on conflict (agent_id) do update
      set expires_at = excluded.expires_at;
    needs_confirm := true;
    choice := 'off';
    return next;
    return;
  end if;

  if p_event = 'choose' and v_choice = 'off' then
    select d.expires_at into v_exp
      from public.notif_cadence_pending d
     where d.agent_id = p_agent;
    if v_exp is null or v_exp < now() then
      delete from public.notif_cadence_pending where agent_id = p_agent;
      expired := true;
      changed := false;
      choice := public.agent_lead_wa_cadence(p_agent);
      return next;
      return;
    end if;
    delete from public.notif_cadence_pending where agent_id = p_agent;
  elsif p_event is distinct from 'choose' or v_choice is null then
    return next;
    return;
  end if;

  select p.lead_wa_cadence into v_old
    from public.agent_notification_preferences p
   where p.agent_id = p_agent;

  if v_old is not distinct from v_choice then
    choice := v_choice;
    return next;
    return;
  end if;

  insert into public.agent_notification_preferences (agent_id, lead_wa_cadence, lead_wa_since)
  values (p_agent, v_choice, now())
  on conflict (agent_id) do update
    set lead_wa_cadence = excluded.lead_wa_cadence,
        lead_wa_since = now(),
        updated_at = now();
  changed := true;
  choice := v_choice;
  return next;
end;
$$;

comment on function public.notif_cadence_apply(uuid, text, text) is
  'רושם לחיצה או בחירה. ללא התראות נשמר רק אחרי אישור בתוך 30 דקות. בחירה זהה לא מזיזה את lead_wa_since ולא כותבת התראה.';

revoke all on function public.notif_cadence_apply(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notif_cadence_apply(uuid, text, text) to service_role;

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
  v_digest_on int := coalesce((select value::int from public.pricing_config
                                where key = 'notif_digest_enabled'), 0);
  v_digest  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_ambient_digest_minutes'), 180);
  v_wake    boolean;
begin
  perform pg_advisory_xact_lock(hashtext('notification_push_claim'));
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(jsonb_build_object(
             'type',        n.type,
             'title',       n.title,
             'body',        n.body,
             'property_id', n.related_property_id,
             'client_id',   coalesce(n.related_client_id,
                                     (select s.client_id from public.client_showcases s
                                       where s.id = n.related_showcase_id)),
             'lead_id',     n.related_lead_id,
             'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                 from public.properties p where p.id = n.related_property_id),
             'agenda_item_id', n.related_agenda_item_id,
             'agreement_id',  n.related_agreement_id,
             'meeting_id',    n.related_meeting_id,
             'review_id', (select rv.id from public.reviews rv
                            where rv.id = n.related_review_id and rv.status = 'pending'
                              and rv.agent_id is distinct from n.agent_id),
             'review_agent_slug', (select m.slug from public.reviews rv
                                     join public.agency_members m on m.id = rv.agent_id
                                    where rv.id = n.related_review_id and rv.status = 'published')
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type),
           bool_or(not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                   or n.created_at <= now() - make_interval(mins => v_digest))
      into v_items, v_ids, v_types, v_wake
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and public.notification_push_lead_wa_sendable(n.agent_id, n.type, n.created_at)
       and (n.created_at > now() - make_interval(hours =>
              case
                when n.type = any(v_prio) then v_look_p
                when v_digest_on = 1 and public.notification_push_less_kept(n.type) then v_look_p
                when v_digest_on = 1 then 24 * 7
                else v_look
              end)
            or public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)
            or (v_digest_on = 1 and public.notification_push_less_hold(n.type, n.agent_id, n.created_at)))
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
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
  'כמו 20271029133000, ו-notification_push_lead_wa_sendable: דגל הקצב כבוי משאיר כל ליד. דלוק: קצב שאינו each לא שולח ליד חדש מיד, וצבר מלפני lead_wa_since לא נשפך.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

-- אותה שאילתה של open_demand_list() ב-CRM, עם סוכן/ת מפורש/ת.
-- הדפדפן נשאר על הפונקציה בלי ארגומנט (current_agent_id).
create or replace function public.open_demand_list_for_agent(p_agent uuid)
returns table (id uuid, lead_type text, source text, source_detail text, post_url text, posted_at timestamptz,
               city text, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
               budget numeric, move_in text, summary text, open_demand_at timestamptz,
               no_broker text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.lead_type, s.source, s.source_detail, s.post_url, s.posted_at, s.city, s.neighborhood_id,
         s.deal_type, s.property_type, s.rooms, s.budget, s.move_in, s.demand_summary,
         coalesce(s.open_demand_at, s.created_at), s.no_broker,
         s.claimed_by is not null
    from public.scraped_leads s
   where p_agent is not null
     and public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     and (s.claimed_by is null or s.claimed_by = p_agent)
     and public.agent_works_city(p_agent, s.city_id)
   order by s.claimed_by is not null, s.posted_at desc
   limit 200;
$$;

comment on function public.open_demand_list_for_agent(uuid) is
  'ביקוש פתוח לאותו סינון של open_demand_list, לסוכן/ת שגבריאלה מזהה. service_role בלבד.';

revoke all on function public.open_demand_list_for_agent(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_list_for_agent(uuid) to service_role;

create or replace function public.open_demand_list()
returns table (id uuid, lead_type text, source text, source_detail text, post_url text, posted_at timestamptz,
               city text, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
               budget numeric, move_in text, summary text, open_demand_at timestamptz,
               no_broker text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.open_demand_list_for_agent(public.current_agent_id());
$$;

comment on function public.open_demand_list() is
  'ביקוש פתוח (אנונימי) בערים שהסוכן/ת המחובר/ת עובד/ת בהן. אותה שאילתה כמו open_demand_list_for_agent.';

create or replace function public.open_demand_cap_full(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select count(*)
      from public.scraped_leads s
     where s.claimed_by = p_agent
       and s.claimed_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')
  ), 0) >= coalesce((select value from public.pricing_config where key = 'open_demand_claims_daily'), 2)::int;
$$;

comment on function public.open_demand_cap_full(uuid) is
  'האם הסוכן/ת מיצה/תה את תקרת "אני פונה" להיום, באותו יום מקומי של open_demand_stats.';

revoke all on function public.open_demand_cap_full(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_cap_full(uuid) to service_role;

revoke all on function public.open_demand_list() from public, anon, authenticated;
grant execute on function public.open_demand_list() to authenticated, service_role;
