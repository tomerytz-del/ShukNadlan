-- ============================================================================
-- כפתור "התאמת קצב התראות" בוואטסאפ. כבוי.
--
-- version 20271031270000.
-- notification_push_claim ו-has_backlog נבנים מ-20271031260000 (#1058), ואז נוסף הסינון של הקצב.
-- app_config.notif_cadence_button_enabled = false. כל ערך שאינו
-- 1/true/on/yes משאיר את השליחה כמו היום: אין כפתור, וליד חדש יוצא
-- כמו עד עכשיו.
--
-- לא נוגעים ב-notify_agent_on_new_lead, ב-notifications_apply_preferences
-- ובקליטת ליד מהרשתות. האכיפה היא ב-notification_push_claim
-- (notification_push_lead_wa_sendable) ובשכבת השליחה.
-- בחירת קצב אינה כותבת התראה, ומסמנת whatsapp_cadence_since כדי שצבר ישן
-- לא יישפך לוואטסאפ. בחירה של סוכן/ת אינה פוטרת מתקרת התבניות:
-- lead_wa_digest_cap_allows נקרא עם exempt=false, והסוג עדיין נספר.
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
   'מחוץ לחלון 24 השעות: cap (עד שתי תבניות ביום, 8 שעות ביניהן, והשאר בפעמון) או bell. אין send.')
on conflict (key) do nothing;

update public.app_config
   set value = 'cap',
       description = 'מחוץ לחלון 24 השעות: cap (עד שתי תבניות ביום, 8 שעות ביניהן) או bell. אין send.'
 where key = 'notif_lead_digest_outside'
   and value = 'send';

alter table public.agent_notification_preferences
  add column if not exists whatsapp_cadence jsonb not null default '{}'::jsonb,
  add column if not exists whatsapp_cadence_since jsonb not null default '{}'::jsonb;

comment on column public.agent_notification_preferences.whatsapp_cadence is
  'קצב וואטסאפ לפי סוג: each, daily, thrice, off. מפתח חסר הוא each, אלא אם הסוג ב-whatsapp_off_types ואז off. אותו שדה נקרא מהמסך ומ-whatsapp_alerts.';
comment on column public.agent_notification_preferences.whatsapp_cadence_since is
  'לכל סוג, מרגע השינוי. התראות מלפניו לא נשפכות לוואטסאפ.';

-- ברירת מחדל: סוג שכבוי בוואטסאפ נשאר off. כל השאר each, כמו היום.
update public.agent_notification_preferences p
   set whatsapp_cadence = coalesce((
         select jsonb_object_agg(t, 'off')
           from unnest(coalesce(p.whatsapp_off_types, '{}'::text[])) as t
       ), '{}'::jsonb)
 where p.whatsapp_cadence = '{}'::jsonb
   and coalesce(array_length(p.whatsapp_off_types, 1), 0) > 0;

create table if not exists public.notif_cadence_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  event text not null,
  notif_type text,
  choice text,
  created_at timestamptz not null default now(),
  constraint notif_cadence_log_event_chk check (event in ('open', 'choose', 'ask', 'back')),
  constraint notif_cadence_log_choice_chk check (
    choice is null or choice in ('each', 'daily', 'thrice', 'off', 'digest'))
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
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  notif_type text not null,
  expires_at timestamptz not null,
  primary key (agent_id, notif_type)
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
grant execute on function public.notif_cadence_button_on() to authenticated;

-- מיפוי סוג התראה לקבוצת קצב. סוג חסר נופל ל-system_mentor בפונקציה.
create table if not exists public.notif_cadence_group_map (
  notif_type text primary key,
  cadence_group text not null,
  constraint notif_cadence_group_map_group_chk check (
    cadence_group in ('new_leads', 'meetings', 'open_demand', 'matches', 'system_mentor'))
);

comment on table public.notif_cadence_group_map is
  'סוג התראה לקבוצת קצב. סוג שלא כאן ולא ברשימת ההחרגה הוא system_mentor.';

alter table public.notif_cadence_group_map enable row level security;
revoke all on table public.notif_cadence_group_map from public, anon, authenticated;
grant select, insert, update, delete on table public.notif_cadence_group_map to service_role;

insert into public.notif_cadence_group_map (notif_type, cadence_group) values
  ('new_lead', 'new_leads'),
  ('onboarding_lead', 'new_leads'),
  ('agenda_reminder', 'meetings'),
  ('showcase_meeting', 'meetings'),
  ('open_demand', 'open_demand'),
  ('listing_match', 'matches'),
  ('client_match', 'matches'),
  ('match_digest', 'matches'),
  ('showcase_activity', 'matches'),
  ('system', 'system_mentor'),
  ('coach_daily', 'system_mentor'),
  ('platform_coach', 'system_mentor'),
  ('marketing_copy', 'system_mentor'),
  ('review_request', 'system_mentor'),
  ('agreement_signed', 'system_mentor'),
  ('deal_closed', 'system_mentor'),
  ('lead_prefs_default', 'system_mentor'),
  ('onboarding_property', 'system_mentor'),
  ('onboarding_client', 'system_mentor'),
  ('onboarding_agreement', 'system_mentor'),
  ('onboarding_license', 'system_mentor')
on conflict (notif_type) do nothing;

create or replace function public.notif_cadence_group(p_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_type = any(array[
      'ops_alert', 'security_alert', 'platform_signup', 'deal_sync_summary', 'deal_data_gap'
    ]::text[]) then null
    else coalesce(
      (select g.cadence_group from public.notif_cadence_group_map g where g.notif_type = p_type),
      'system_mentor')
  end;
$$;

comment on function public.notif_cadence_group(text) is
  'קבוצת הקצב של סוג. null להתראות אדמין שלא בתפריט. כל סוג אחר שלא מופה הוא system_mentor.';

revoke all on function public.notif_cadence_group(text) from public, anon, authenticated;
grant execute on function public.notif_cadence_group(text) to service_role;

create or replace function public.notif_cadence_digestable(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type = any(array[
    'new_lead', 'open_demand', 'match_digest', 'client_match', 'system',
    'review_new', 'review_request', 'marketing_copy'
  ]::text[]);
$$;

revoke all on function public.notif_cadence_digestable(text) from public, anon, authenticated;
grant execute on function public.notif_cadence_digestable(text) to service_role;

create or replace function public.agent_type_cadence(p_agent uuid, p_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_type in ('new_leads', 'open_demand', 'matches') then coalesce((
      select case when mode in ('each', 'daily', 'thrice', 'off') then mode else 'each' end
        from (
          select nullif(p.whatsapp_cadence ->> p_type, '') as mode
            from public.agent_notification_preferences p
           where p.agent_id = p_agent
        ) s
    ), 'each')
    when p_type = 'meetings' then 'each'
    when p_type = 'system_mentor' then coalesce((
      select case when mode in ('digest', 'off') then mode else 'digest' end
        from (
          select nullif(p.whatsapp_cadence ->> 'system_mentor', '') as mode
            from public.agent_notification_preferences p
           where p.agent_id = p_agent
        ) s
    ), 'digest')
    when public.notif_cadence_group(p_type) is null then 'each'
    when public.notif_cadence_group(p_type) = 'meetings' then 'each'
    when public.notif_cadence_group(p_type) = 'system_mentor' then
      coalesce((
        select case
          when mode in ('digest', 'off') then mode
          else 'digest'
        end
        from (
          select nullif(p.whatsapp_cadence ->> 'system_mentor', '') as mode
            from public.agent_notification_preferences p
           where p.agent_id = p_agent
        ) s
      ), 'digest')
    else coalesce((
      select case
        when mode in ('each', 'daily', 'thrice', 'off') then mode
        else 'each'
      end
      from (
        select coalesce(
          nullif(p.whatsapp_cadence ->> public.notif_cadence_group(p_type), ''),
          case when p_type = any(coalesce(p.whatsapp_off_types, '{}'::text[])) then 'off' else 'each' end
        ) as mode
        from public.agent_notification_preferences p
        where p.agent_id = p_agent
      ) s
    ), 'each')
  end;
$$;

revoke all on function public.agent_type_cadence(uuid, text) from public, anon, authenticated;
grant execute on function public.agent_type_cadence(uuid, text) to service_role;

create or replace function public.agent_type_cadence_since(p_agent uuid, p_type text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_type in ('new_leads', 'meetings', 'open_demand', 'matches', 'system_mentor') then
      case when nullif(p.whatsapp_cadence_since ->> p_type, '') is null then null
           else (p.whatsapp_cadence_since ->> p_type)::timestamptz end
    when public.notif_cadence_group(p_type) is null then null
    when nullif(p.whatsapp_cadence_since ->> public.notif_cadence_group(p_type), '') is null then null
    else (p.whatsapp_cadence_since ->> public.notif_cadence_group(p_type))::timestamptz
  end
  from public.agent_notification_preferences p
  where p.agent_id = p_agent;
$$;

revoke all on function public.agent_type_cadence_since(uuid, text) from public, anon, authenticated;
grant execute on function public.agent_type_cadence_since(uuid, text) to service_role;

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
    when public.notif_cadence_group(p_type) is null then true
    when public.notif_cadence_group(p_type) = 'meetings' then true
    when public.notif_cadence_group(p_type) = 'system_mentor' then false
    when public.agent_type_cadence(p_agent, p_type) in ('off', 'digest', 'daily', 'thrice') then false
    when public.agent_type_cadence(p_agent, p_type) = 'each' then
      public.agent_type_cadence_since(p_agent, p_type) is null
      or p_created >= public.agent_type_cadence_since(p_agent, p_type)
    else false
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
        and c.value in ('cap', 'bell')),
    'cap');
$$;

revoke all on function public.notif_lead_digest_outside() from public, anon, authenticated;
grant execute on function public.notif_lead_digest_outside() to service_role;

-- תקרת התבניות, גם כשהדגל של התקרה כבוי: 1, שניה אחרי 8 שעות, גג 2.
-- p_except הוא השורה שנבדקת, כדי שהיא לא תספור את עצמה. exempt תמיד false:
-- בחירת קצב אינה "תמיד נשלח", והסוגים שפטורים במקום אחר עדיין נספרים.
create or replace function public.lead_wa_digest_cap_allows(
  p_agent uuid,
  p_except uuid default null
)
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
    execute 'select n, last_at from public.whatsapp_template_cap_usage($1, $2)'
      into v_count, v_last
      using p_agent, p_except;
  else
    select count(*)::int, max(l.created_at)
      into v_count, v_last
      from public.notification_push_log l
     where l.agent_id = p_agent
       and l.id is distinct from p_except
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

revoke all on function public.lead_wa_digest_cap_allows(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lead_wa_digest_cap_allows(uuid, uuid) to service_role;

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
  notif_type text,
  outside_mode text,
  cap_allows boolean,
  digest_ordinal int,
  allow_template boolean,
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
           e.key as notif_type,
           e.value as cadence,
           nullif(p.whatsapp_cadence_since ->> e.key, '')::timestamptz as since
      from public.agency_members m
      join public.agent_notification_preferences p on p.agent_id = m.id
      cross join lateral jsonb_each_text(p.whatsapp_cadence) e
     where m.active
       and m.closed_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
       and (
         (e.key in ('new_leads', 'open_demand', 'matches') and e.value in ('daily', 'thrice'))
         or (e.key = 'system_mentor' and e.value = 'digest')
       )
  loop
    if r.phone is null then
      continue;
    end if;
    v_slot := public.lead_wa_digest_slot(
      now(), case when r.cadence = 'digest' then 'daily' else r.cadence end,
      v_daily, v_hours, v_window);
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
           and public.notif_cadence_group(n.type) = r.notif_type
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
      values (r.id, split_part(v_slot, '|', 3) || ':' || r.notif_type, 'pending');
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
    slot_key := split_part(v_slot, '|', 3) || ':' || r.notif_type;
    notif_type := r.notif_type;
    outside_mode := public.notif_lead_digest_outside();
    cap_allows := public.lead_wa_digest_cap_allows(r.id);
    allow_template := r.notif_type is distinct from 'system_mentor';
    select count(*)::int into digest_ordinal
      from public.notif_cadence_digest d
     where d.agent_id = r.id
       and d.slot_key like to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD') || '%'
       and split_part(d.slot_key, ':', 2) = r.notif_type
       and d.outcome in ('pending', 'sent', 'bell');
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
declare
  v_ordinal int;
  v_mode text := p_mode;
begin
  if p_outcome not in ('sent', 'bell') then
    return;
  end if;
  select count(*)::int into v_ordinal
    from public.notif_cadence_digest d
   where d.agent_id = p_agent
     and d.slot_key like to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD') || '%'
     and split_part(d.slot_key, ':', 2) = split_part(p_slot, ':', 2)
     and d.outcome in ('pending', 'sent', 'bell');
  -- הסיכום השלישי ביום אינו נרשם כתבנית.
  if coalesce(v_ordinal, 1) >= 3 or split_part(p_slot, ':', 2) = 'system_mentor' then
    v_mode := 'text';
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
      case when v_mode = 'template' then 'template' else 'text' end,
      'sent'
    );
  end if;
end;
$$;

revoke all on function public.notif_cadence_digest_finish(uuid, text, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.notif_cadence_digest_finish(uuid, text, text, uuid[], text) to service_role;

create or replace function public.notif_cadence_apply(
  p_agent uuid,
  p_type text,
  p_event text,
  p_choice text
) returns table (
  enabled boolean,
  changed boolean,
  needs_confirm boolean,
  expired boolean,
  choice text,
  notif_type text,
  cadences jsonb,
  off_types text[],
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
  v_type text;
  v_exp timestamptz;
  v_event text;
  v_map jsonb;
  v_off text[];
begin
  v_type := nullif(btrim(coalesce(p_type, '')), '');
  if v_type is not null and v_type not in (
    'new_leads', 'meetings', 'open_demand', 'matches', 'system_mentor'
  ) then
    v_type := public.notif_cadence_group(v_type);
  end if;
  v_choice := case
    when p_choice in ('each', 'daily', 'thrice', 'off', 'digest') then p_choice
    else null
  end;
  if v_type = 'system_mentor' and v_choice in ('each', 'daily', 'thrice') then
    v_choice := 'digest';
  end if;
  if v_type = 'meetings' then
    v_choice := null;
  end if;
  if v_type in ('new_leads', 'open_demand', 'matches') and v_choice = 'digest' then
    v_choice := 'each';
  end if;
  v_event := case p_event
    when 'choose' then 'choose'
    when 'ask' then 'ask'
    when 'back' then 'back'
    else 'open'
  end;
  insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
  values (p_agent, v_type, v_event, v_choice);

  select coalesce(p.whatsapp_cadence, '{}'::jsonb),
         coalesce(p.whatsapp_off_types, '{}'::text[])
    into v_map, v_off
    from public.agent_notification_preferences p
   where p.agent_id = p_agent;
  v_map := coalesce(v_map, '{}'::jsonb);
  v_off := coalesce(v_off, '{}'::text[]);

  enabled := v_on;
  daily_hour := public.notif_lead_digest_daily_hour();
  hours := public.notif_lead_digest_hours();
  notif_type := v_type;
  cadences := v_map;
  off_types := v_off;
  choice := case when v_type is null then null else public.agent_type_cadence(p_agent, v_type) end;
  changed := false;
  needs_confirm := false;
  expired := false;

  if not v_on or v_type is null then
    return next;
    return;
  end if;

  if p_event = 'back' then
    delete from public.notif_cadence_pending d
     where d.agent_id = p_agent and d.notif_type = v_type;
    return next;
    return;
  end if;

  if v_type = 'meetings' then
    choice := 'each';
    return next;
    return;
  end if;

  if p_event = 'ask' and v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then
    insert into public.notif_cadence_pending (agent_id, notif_type, expires_at)
    values (p_agent, v_type, now() + interval '30 minutes')
    on conflict (agent_id, notif_type) do update
      set expires_at = excluded.expires_at;
    needs_confirm := true;
    choice := 'off';
    return next;
    return;
  end if;

  if p_event = 'choose' and v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches', 'system_mentor') then
    select d.expires_at into v_exp
      from public.notif_cadence_pending d
     where d.agent_id = p_agent and d.notif_type = v_type;
    if v_exp is null or v_exp < now() then
      delete from public.notif_cadence_pending d
       where d.agent_id = p_agent and d.notif_type = v_type;
      expired := true;
      choice := public.agent_type_cadence(p_agent, v_type);
      return next;
      return;
    end if;
    delete from public.notif_cadence_pending d
     where d.agent_id = p_agent and d.notif_type = v_type;
  elsif p_event is distinct from 'choose' or v_choice is null then
    return next;
    return;
  end if;

  v_old := public.agent_type_cadence(p_agent, v_type);
  if v_old is not distinct from v_choice then
    choice := v_choice;
    return next;
    return;
  end if;

  insert into public.agent_notification_preferences (agent_id, whatsapp_cadence, whatsapp_cadence_since, whatsapp_off_types)
  values (
    p_agent,
    jsonb_build_object(v_type, v_choice),
    jsonb_build_object(v_type, now()),
    case when v_choice = 'off' then array[v_type] else '{}'::text[] end
  )
  on conflict (agent_id) do update
    set whatsapp_cadence = public.agent_notification_preferences.whatsapp_cadence || jsonb_build_object(v_type, v_choice),
        whatsapp_cadence_since = public.agent_notification_preferences.whatsapp_cadence_since || jsonb_build_object(v_type, now()),
        whatsapp_off_types = case
          when v_choice = 'off' and v_type in ('new_leads', 'open_demand', 'matches') then (
            select coalesce(array_agg(distinct t), '{}'::text[])
              from unnest(
                coalesce(public.agent_notification_preferences.whatsapp_off_types, '{}'::text[])
                || coalesce((
                  select array_agg(g.notif_type)
                    from public.notif_cadence_group_map g
                   where g.cadence_group = v_type
                ), '{}'::text[])
              ) t
          )
          when v_type in ('new_leads', 'open_demand', 'matches') then (
            select coalesce(array_agg(t), '{}'::text[])
              from unnest(coalesce(public.agent_notification_preferences.whatsapp_off_types, '{}'::text[])) t
             where t not in (
               select g.notif_type from public.notif_cadence_group_map g where g.cadence_group = v_type
             )
          )
          else public.agent_notification_preferences.whatsapp_off_types
        end,
        updated_at = now();
  changed := true;
  choice := v_choice;
  select q.whatsapp_cadence, coalesce(q.whatsapp_off_types, '{}'::text[])
    into cadences, off_types
    from public.agent_notification_preferences q
   where q.agent_id = p_agent;
  return next;
end;
$$;

comment on function public.notif_cadence_apply(uuid, text, text, text) is
  'קצב לפי סוג. ללא נשמר רק אחרי אישור בתוך 30 דקות. בחירה זהה לא מזיזה את since ולא כותבת התראה. off נכנס גם ל-whatsapp_off_types.';

revoke all on function public.notif_cadence_apply(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notif_cadence_apply(uuid, text, text, text) to service_role;


-- הפונקציות המשותפות: הגוף של 20271031260000 (#1058), וה-claim עם סינון הקצב.
-- חריץ תבנית שמור לתקציר היומי, מעל גג 2, רק כששני הדגלים דלוקים.
-- whatsapp_template_cap_digest_reserved נולד 1. כבוי: אין שינוי.
--
-- החריץ הוא לתקציר בלבד (פריטים שכבר נעצרו ב-skipped_template_cap).
-- הוא יוצא בחלון תקציר הראשון (08:30, 13:00, 17:30) שחלפו בו 8 שעות
-- מהתבנית האחרונה. אם אין חלון כזה היום, החלון הראשון של מחר, כל עוד
-- הפריט בתוך 72 השעות. בתוך חלון 24 השעות זה טקסט חופשי, בלי תבנית
-- ובלי לספור. ליד, תזכורת וסיור לא משתמשים בחריץ.

insert into public.app_config (key, value, description) values
  ('whatsapp_template_cap_digest_reserved', '1',
   'כמה תבניות תקציר מעל הגג לסוכן ביום מקומי. 1. 0 מבטל את החריץ. לא חל על סוג אחר.')
on conflict (key) do nothing;

create or replace function public.whatsapp_template_cap_limit(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when p_key in ('whatsapp_template_cap_daily', 'whatsapp_template_cap_hard_max', 'whatsapp_template_cap_digest_reserved')
                   and c.value ~ '^[0-9]+$' then c.value::numeric
              when p_key not in ('whatsapp_template_cap_daily', 'whatsapp_template_cap_hard_max', 'whatsapp_template_cap_digest_reserved')
                   and c.value ~ '^[0-9]+(\.[0-9]+)?$' then c.value::numeric
              else null
            end
       from public.app_config c
      where c.key = p_key),
    p_default);
$$;

comment on function public.whatsapp_template_cap_limit(text, numeric) is
  'ערך מספרי מתקרת התבניות ב-app_config. חסר או לא-מספר חוזר לברירת המחדל.';

revoke all on function public.whatsapp_template_cap_limit(text, numeric) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_limit(text, numeric) to service_role;


create or replace function public.whatsapp_template_cap_digest_open_at(p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with clock as (
    select
      extract(hour from (p_now at time zone 'Asia/Jerusalem'))::int * 60
      + extract(minute from (p_now at time zone 'Asia/Jerusalem'))::int as minute
  ),
  wins as (
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_1'), 510) as w
    union all
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_2'), 780)
    union all
    select coalesce((select value::int from public.pricing_config where key = 'notif_digest_window_3'), 1050)
  )
  select exists (
    select 1
      from clock, wins
     where abs(clock.minute - wins.w) <= greatest(0, least(coalesce(
             (select value::int from public.pricing_config where key = 'notif_digest_window_minutes'), 15), 120))
  );
$$;

comment on function public.whatsapp_template_cap_digest_open_at(timestamptz) is
  'האם חותמת נתונה היא בתוך חלון תקציר (08:30, 13:00, 17:30, שעון ישראל).';

revoke all on function public.whatsapp_template_cap_digest_open_at(timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_open_at(timestamptz) to service_role;

-- normal: חריץ רגיל (מתחת לגג, ואחרי 8 שעות אם זו השניה).
-- reserved: מעל הגג, תקציר בלבד, אחרי 8 שעות, ועדיין לא נוצל היום.
-- wait: לא עכשיו.
create or replace function public.whatsapp_template_cap_digest_kind(
  p_now timestamptz,
  p_last timestamptz,
  p_count int,
  p_reserved_used int
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours numeric;
  v_daily numeric;
  v_hard numeric;
  v_gap numeric;
  v_limit numeric;
begin
  if p_now is null or not public.whatsapp_template_cap_digest_open_at(p_now) then
    return 'wait';
  end if;
  v_daily := public.whatsapp_template_cap_limit('whatsapp_template_cap_daily', 1);
  v_hard := public.whatsapp_template_cap_limit('whatsapp_template_cap_hard_max', 2);
  v_gap := public.whatsapp_template_cap_limit('whatsapp_template_cap_gap_hours', 8);
  v_limit := public.whatsapp_template_cap_limit('whatsapp_template_cap_digest_reserved', 1);
  if p_last is not null then
    v_hours := extract(epoch from (p_now - p_last)) / 3600.0;
  end if;
  if public.whatsapp_template_cap_decide(
       coalesce(p_count, 0), v_hours, false, v_daily, v_hard, v_gap) then
    return 'normal';
  end if;
  if v_hours is not null
     and v_hours >= coalesce(v_gap, 8)
     and coalesce(p_reserved_used, 0) < greatest(coalesce(v_limit, 1), 0) then
    return 'reserved';
  end if;
  return 'wait';
end;
$$;

comment on function public.whatsapp_template_cap_digest_kind(timestamptz, timestamptz, int, int) is
  'איך תקציר יוצא עכשיו: normal בתוך הגג, reserved מעל הגג אחרי 8 שעות, או wait. לא חל על ליד, תזכורת או סיור.';

revoke all on function public.whatsapp_template_cap_digest_kind(timestamptz, timestamptz, int, int) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_kind(timestamptz, timestamptz, int, int) to service_role;

-- בחלון 24 השעות תמיד טקסט, בלי תבנית ובלי חריץ. none = לא שולחים עכשיו.
create or replace function public.whatsapp_template_cap_digest_channel(
  p_in_service_window boolean,
  p_kind text
) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_in_service_window, false) then 'text'
    when p_kind in ('normal', 'reserved') then 'template'
    else 'none'
  end;
$$;

comment on function public.whatsapp_template_cap_digest_channel(boolean, text) is
  'ערוץ התקציר. חלון 24 שעות הוא טקסט חופשי ואינו נספר כתבנית. אחרת תבנית רק ל-normal או reserved.';

revoke all on function public.whatsapp_template_cap_digest_channel(boolean, text) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_channel(boolean, text) to service_role;

create or replace function public.whatsapp_template_cap_digest_reserved_used(
  p_agent uuid,
  p_except uuid
) returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.notification_push_log l
   where l.agent_id = p_agent
     and l.id is distinct from p_except
     and l.channel_mode = 'template'
     and l.whatsapp_status in ('sent', 'pending')
     and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
     and 'template_cap_digest_reserved' = any(coalesce(l.types, '{}'::text[]))
     and l.created_at > now() - interval '2 days'
     and public.whatsapp_template_local_day(l.created_at)
         = public.whatsapp_template_local_day(now());
$$;

comment on function public.whatsapp_template_cap_digest_reserved_used(uuid, uuid) is
  'כמה חריצי תקציר שמורים כבר יצאו לסוכן/ת היום המקומי. טקסט חופשי אינו נספר.';

revoke all on function public.whatsapp_template_cap_digest_reserved_used(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_reserved_used(uuid, uuid) to service_role;

-- true רק אם זו שורת תקציר שנעצרה, המרווח 8 שעות מתקיים, והחריץ היומי פנוי.
create or replace function public.whatsapp_template_cap_digest_allow_reserved(
  p_agent uuid,
  p_log uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_last timestamptz;
  v_used int;
  v_ids uuid[];
  v_held boolean;
begin
  select l.notification_ids into v_ids
    from public.notification_push_log l
   where l.id = p_log
     and l.agent_id = p_agent;
  if v_ids is null or coalesce(array_length(v_ids, 1), 0) = 0 then
    return false;
  end if;
  select coalesce(bool_and(exists (
           select 1
             from public.notification_push_log h
            where h.agent_id = p_agent
              and h.id is distinct from p_log
              and nid = any(h.notification_ids)
              and h.whatsapp_status = 'skipped_template_cap'
              and h.created_at > now() - interval '72 hours'
         )), false)
    into v_held
    from unnest(v_ids) as nid;
  if not v_held then
    return false;
  end if;
  select u.n, u.last_at into v_n, v_last
    from public.whatsapp_template_cap_usage(p_agent, p_log) u;
  v_used := public.whatsapp_template_cap_digest_reserved_used(p_agent, p_log);
  return public.whatsapp_template_cap_digest_kind(now(), v_last, v_n, v_used) = 'reserved';
end;
$$;

comment on function public.whatsapp_template_cap_digest_allow_reserved(uuid, uuid) is
  'האם שורת היומן הזו היא התקציר השמור: כל פריט בה נעצר בתקרה, המרווח 8 שעות, והחריץ היומי עוד לא נוצל.';

revoke all on function public.whatsapp_template_cap_digest_allow_reserved(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_digest_allow_reserved(uuid, uuid) to service_role;

create or replace function public.whatsapp_template_cap_allow(p_log_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent  uuid;
  v_mode   text;
  v_status text;
  v_error  text;
  v_types  text[];
  v_daily  numeric;
  v_hard   numeric;
  v_gap    numeric;
  v_count  int;
  v_last   timestamptz;
  v_hours  numeric;
  v_exempt boolean;
begin
  select l.agent_id, l.channel_mode, l.whatsapp_status, l.last_error, l.types
    into v_agent, v_mode, v_status, v_error, v_types
    from public.notification_push_log l
   where l.id = p_log_id;

  if not found then
    return false;
  end if;

  if v_status = 'skipped_template_cap'
     or v_error = 'skipped_template_cap' then
    return false;
  end if;

  -- טקסט בתוך החלון, או שורה שכבר נסגרה, לא נכנסים לתקרה.
  if v_status is distinct from 'pending' or v_mode is distinct from 'template' then
    return true;
  end if;

  if not public.whatsapp_template_cap_on() then
    return true;
  end if;

  v_exempt := coalesce(v_types, '{}'::text[])
              && public.whatsapp_template_cap_exempt_types();
  if v_exempt then
    return true;
  end if;

  -- חריץ שמור לתקציר בלבד. ליד, תזכורת וסיור כבר חזרו למעלה.
  if 'template_cap_digest_reserved' = any(coalesce(v_types, '{}'::text[]))
     and public.whatsapp_template_cap_digest_allow_reserved(v_agent, p_log_id) then
    return true;
  end if;

  select u.n, u.last_at
    into v_count, v_last
    from public.whatsapp_template_cap_usage(v_agent, p_log_id) u;

  if v_last is not null then
    v_hours := extract(epoch from (now() - v_last)) / 3600.0;
  end if;

  v_daily := public.whatsapp_template_cap_limit('whatsapp_template_cap_daily', 1);
  v_hard := public.whatsapp_template_cap_limit('whatsapp_template_cap_hard_max', 2);
  v_gap := public.whatsapp_template_cap_limit('whatsapp_template_cap_gap_hours', 8);

  if public.whatsapp_template_cap_decide(v_count, v_hours, false, v_daily, v_hard, v_gap) then
    return true;
  end if;

  -- הזמן נשאר created_at האמיתי. קוד הסיבה בסטטוס וב-last_error.
  -- delivery_at נשאר ריק: הוא הדיווח של Meta, וההודעה לא יצאה.
  -- הספירה מסננת לפי סטטוס, לא לפי הזזת השעון.
  update public.notification_push_log l
     set whatsapp_status = 'skipped_template_cap',
         last_error = 'skipped_template_cap'
   where l.id = p_log_id
     and l.whatsapp_status = 'pending';

  return false;
end;
$$;

comment on function public.whatsapp_template_cap_allow(uuid) is
  'האם שורת יומן תבנית מותרת לשליחה. כבוי: תמיד כן, חוץ משורה שכבר דולגה. דלוק: מעל התקרה מסמן skipped_template_cap בזמן האמיתי ולא שולח שוב. הפטור מ-app_config יוצא גם מעל הגג.';

revoke all on function public.whatsapp_template_cap_allow(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_allow(uuid) to service_role;

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
  v_stale   int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_stale_hours'), 12));
  v_urgent  int := greatest(v_stale, coalesce((select value::int from public.pricing_config where key = 'notif_burst_urgent_hours'), 72));
  v_max_items int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_max_items'), 24));
  v_hour_cap int;
  v_day_cap int;
  v_sent_hour int;
  v_sent_day int;
  v_all_lead boolean;
  v_all_showing boolean;
  v_over boolean;
  v_digest_sent boolean;
  v_guard int;
  v_manual int;
  v_breaker int;
  v_pending_max int;
  v_pause boolean;
  v_ex_items jsonb;
  v_ex_ids uuid[];
  v_ex_types text[];
  v_gen_ids uuid[];
  v_gen_types text[];
  v_gen_n int;
  v_agent_hot boolean;
  v_too_many boolean;
  v_hold_general boolean;
  v_lane_over boolean;
  v_cap_ok boolean;
  v_cap_held boolean;
  v_digest_kind text;
begin
  perform public.notification_push_burst_prepare();

  select coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_manual_pause'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_breaker'), 0),
         greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_agent_pending'), 30))
    into v_guard, v_manual, v_breaker, v_pending_max;
  v_pause := v_guard = 1 and (v_manual = 1 or v_breaker = 1);

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(s.item order by s.created_at desc),
           array_agg(s.id order by s.created_at desc),
           array_agg(distinct s.type),
           bool_or(s.wake_part),
           jsonb_agg(s.item order by s.created_at desc) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where s.exempt),
           array_agg(distinct s.type) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where not s.exempt),
           array_agg(distinct s.type) filter (where not s.exempt),
           (count(*) filter (where not s.exempt))::int
      into v_items, v_ids, v_types, v_wake,
           v_ex_items, v_ex_ids, v_ex_types,
           v_gen_ids, v_gen_types, v_gen_n
      from (
        select n.id, n.type, n.created_at,
               public.notification_push_burst_exempt(n.type, ld.source) as exempt,
               (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                 or n.created_at <= now() - make_interval(mins => v_digest)) as wake_part,
               jsonb_build_object(
                 'type',        n.type,
                 'title',       n.title,
                 'body',        n.body,
                 'source',      ld.source,
                 'property_id', n.related_property_id,
                 'client_id',   coalesce(n.related_client_id,
                                         (select sc.client_id from public.client_showcases sc
                                           where sc.id = n.related_showcase_id)),
                 'lead_id',     n.related_lead_id,
                 'action_path', n.action_path,
                 'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                     from public.properties p where p.id = n.related_property_id),
                 'agenda_item_id', n.related_agenda_item_id,
                 'agreement_id',  n.related_agreement_id,
                 'meeting_id',    n.related_meeting_id,
                 'showcase_id',   n.related_showcase_id,
                 'review_id', (select rv.id from public.reviews rv
                                where rv.id = n.related_review_id and rv.status = 'pending'
                                  and rv.agent_id is distinct from n.agent_id),
                 'review_agent_slug', (select m.slug from public.reviews rv
                                         join public.agency_members m on m.id = rv.agent_id
                                        where rv.id = n.related_review_id and rv.status = 'published')
               ) as item
          from public.notifications n
          left join public.leads ld on ld.id = n.related_lead_id
         where n.agent_id = a.agent_id
           and not n.read
           and not n.suppress_push
           and n.type = any(a.whatsapp_types)
           and public.notification_push_lead_wa_sendable(n.agent_id, n.type, n.created_at)
           and (n.created_at > now() - make_interval(hours =>
                  case
                    when n.type = any(v_prio) then least(v_look_p, v_urgent)
                    when v_digest_on = 1 and public.notification_push_less_kept(n.type) then least(v_look_p, v_urgent)
                    else least(v_look, v_stale)
                  end)
                or (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
                or (
                  public.whatsapp_template_cap_on()
                  and v_digest_on = 1
                  and n.created_at > pg_catalog.now() - interval '72 hours'
                  and exists (
                    select 1 from public.notification_push_log lheld
                     where lheld.agent_id = n.agent_id
                       and n.id = any(lheld.notification_ids)
                       and lheld.whatsapp_status = 'skipped_template_cap'
                       and lheld.created_at > pg_catalog.now() - interval '72 hours'
                  )
                ))
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
           and (
             not public.whatsapp_template_cap_on()
             or not exists (
               select 1 from public.notification_push_log lcap
                where lcap.agent_id = n.agent_id
                  and n.id = any(lcap.notification_ids)
                  and lcap.whatsapp_status = 'skipped_template_cap'
             )
             or (
               v_digest_on = 1
               and public.notif_il_digest_open(coalesce(
                     (select value::int from public.pricing_config
                       where key = 'notif_digest_window_minutes'), 15))
               and (
                 a.in_service_window
                 or public.whatsapp_template_cap_digest_kind(
                      pg_catalog.now(),
                      (select u.last_at from public.whatsapp_template_cap_usage(a.agent_id, null) u),
                      coalesce((select u.n from public.whatsapp_template_cap_usage(a.agent_id, null) u), 0),
                      public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null)
                    ) in ('normal', 'reserved')
               )
             )
           )
           and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
      ) s;

    continue when v_items is null or not v_wake;

    -- פריט שנעצר בתקרה יוצא רק בחלון תקציר (08:30, 13:00, 17:30).
    -- תבנית רק אם decide מרשה (גג 2, מרווח 8 שעות, הפטור יוצא תמיד ונחשב).
    -- תקרה מלאה ובחלון 24 השעות: טקסט חופשי. בלי חלון: נשאר בפעמון
    -- עד התקציר הראשון של היום הבא. לא פרץ וואטסאפ ולא תבנית שלישית.
    v_cap_held := public.whatsapp_template_cap_on()
      and v_digest_on = 1
      and coalesce(array_length(v_ids, 1), 0) > 0
      and not exists (
        select 1 from unnest(v_ids) as held(id)
         where not exists (
           select 1 from public.notification_push_log lheld
            where lheld.agent_id = a.agent_id
              and held.id = any(lheld.notification_ids)
              and lheld.whatsapp_status = 'skipped_template_cap'
              and lheld.created_at > pg_catalog.now() - interval '72 hours'
         )
      );

    -- המפסק והמפסק הידני נבדקים תמיד. פריט תקרה מדלג רק על תקרת השעה, היום ומספר הפריטים.
    if v_guard = 1 then
      if v_pause then
        if coalesce(array_length(v_ex_ids, 1), 0) = 0 then
          continue;
        end if;
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif not v_cap_held then
      v_hour_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_hour_cap'), 12));
      v_day_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_day_cap'), 30));

      select count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*) filter (where l.created_at > now() - interval '1 day')
        into v_sent_hour, v_sent_day
        from public.notification_push_log l
       where l.agent_id = a.agent_id
         and l.whatsapp_status = 'sent';

      v_over := v_sent_hour >= v_hour_cap or v_sent_day >= v_day_cap;
      v_digest_sent := exists (
        select 1 from public.notification_push_log l
         where l.agent_id = a.agent_id
           and l.created_at > now() - interval '1 hour'
           and l.whatsapp_status in ('sent', 'pending')
           and 'burst_digest' = any(l.types));
      v_agent_hot := coalesce(v_gen_n, 0) > v_pending_max;
      v_too_many := coalesce(v_gen_n, 0) > v_max_items;
      v_hold_general := v_agent_hot or v_over or v_too_many;

      v_all_lead := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'new_lead');
      v_all_showing := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'showcase_meeting');
      v_lane_over := false;
      if v_all_lead then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_day_cap'), 40));
      elsif v_all_showing then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_day_cap'), 40));
      end if;

      if v_lane_over then
        -- תקרת המסלול של ליד או סיור: נדחה, לא תקציר ולא skipped.
        continue;
      elsif v_hold_general and coalesce(array_length(v_ex_ids, 1), 0) > 0 then
        -- ערבוב: המוגן יוצא עכשיו בפרטים. השאר מחכה לתקציר, בלי להירשם.
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_hold_general and v_digest_sent then
        -- overflow_defer: מחכה לתקציר הבא. לא skipped.
        continue;
      elsif v_hold_general then
        v_items := jsonb_build_array(jsonb_build_object(
          'type', 'burst_digest',
          'title', 'יש לך ' || coalesce(v_gen_n, 0) || ' התראות חדשות באתר',
          'body', null,
          'count', coalesce(v_gen_n, 0)));
        v_ids := v_gen_ids;
        v_types := coalesce(v_gen_types, '{}') || array['burst_digest'];
      end if;
      end if;
    end if;

    v_digest_kind := 'wait';
    if v_cap_held and public.whatsapp_template_cap_on() then
      select public.whatsapp_template_cap_digest_kind(
               pg_catalog.now(), u.last_at, u.n,
               public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null))
        into v_digest_kind
        from public.whatsapp_template_cap_usage(a.agent_id, null) u;
      v_mode := public.whatsapp_template_cap_digest_channel(a.in_service_window, v_digest_kind);
      if v_mode = 'none' then
        continue;
      end if;
      if v_digest_kind = 'reserved' and v_mode = 'template' then
        v_types := coalesce(v_types, '{}'::text[]) || array['template_cap_digest_reserved']::text[];
      end if;
    else
      v_mode := case when a.in_service_window then 'text' else 'template' end;
    end if;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    -- תקרת התבניות, פעם אחת לסוכן/ת בסבב. כבויה: כל שורה עוברת.
    v_cap_ok := true;
    if v_mode = 'template' then
      begin
        v_cap_ok := public.whatsapp_template_cap_allow(v_log);
      exception when others then
        v_cap_ok := true;
        raise warning 'whatsapp template cap: %', sqlerrm;
      end;
    end if;
    if not v_cap_ok then
      continue;
    end if;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'גוף 20271031260000 ועוד notification_push_lead_wa_sendable. החריץ השמור נשמר. דגל הקצב כבוי: הסינון תמיד כן.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

create or replace function public.notification_push_has_backlog(p_exempt_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notification_push_due_agents() a
     where exists (
       select 1
         from public.notifications n
         left join public.leads ld on ld.id = n.related_lead_id
        where n.agent_id = a.agent_id
          and not n.read
          and not n.suppress_push
          and n.type = any(a.whatsapp_types)
          and (not coalesce(p_exempt_only, false)
               or public.notification_push_burst_exempt(n.type, ld.source))
          and (
            (
              coalesce(n.push_deferred_at, n.created_at) > now() - make_interval(hours =>
                  case when n.type = any(public.notification_push_priority_types())
                       then coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_priority_lookback_hours'), 72)
                       else coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_lookback_hours'), 12)
                  end)
              and not (
                public.whatsapp_template_cap_on()
                and exists (
                  select 1 from public.notification_push_log lheld
                   where lheld.agent_id = n.agent_id
                     and n.id = any(lheld.notification_ids)
                     and lheld.whatsapp_status = 'skipped_template_cap'
                     and lheld.created_at > pg_catalog.now() - interval '72 hours'
                )
              )
            )
            or (
              public.whatsapp_template_cap_on()
              and public.notif_il_digest_open(coalesce(
                    (select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15))
              and n.created_at > pg_catalog.now() - interval '72 hours'
              and exists (
                select 1 from public.notification_push_log lheld
                 where lheld.agent_id = n.agent_id
                   and n.id = any(lheld.notification_ids)
                   and lheld.whatsapp_status = 'skipped_template_cap'
                   and lheld.created_at > pg_catalog.now() - interval '72 hours'
              )
              and (
                a.in_service_window
                or public.whatsapp_template_cap_digest_kind(
                     pg_catalog.now(),
                     (select u.last_at from public.whatsapp_template_cap_usage(a.agent_id, null) u),
                     coalesce((select u.n from public.whatsapp_template_cap_usage(a.agent_id, null) u), 0),
                     public.whatsapp_template_cap_digest_reserved_used(a.agent_id, null)
                   ) in ('normal', 'reserved')
              )
            )
          )
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids)
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
          and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
     )
  );
$$;


comment on function public.notification_push_has_backlog(boolean) is
  'פריט תקרה מעיר את הקרון בחלון תקציר רק אם מותרת תבנית: חריץ רגיל, או החריץ השמור אחרי 8 שעות, או טקסט בחלון 24 השעות.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;


-- שאילתה אחת. הלשונית ב-CRM והעטיפה של גבריאלה קוראות רק לה.
-- תקרת #1037 (8-10) מגבילה רק את דחיפת הוואטסאפ, לא את הרשימה הזו.
create or replace function public.open_demand_rows(p_agent uuid)
returns table (id uuid, lead_type text, source text, source_detail text, post_url text, posted_at timestamptz,
               city text, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
               budget numeric, move_in text, summary text, open_demand_at timestamptz,
               no_broker text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.lead_type, s.source, s.source_detail,
         case when coalesce(s.post_url, '') like '%tab=demand%' then null else s.post_url end,
         s.posted_at, s.city, s.neighborhood_id,
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

comment on function public.open_demand_rows(uuid) is
  'רשימת הביקוש הפתוח. ערי העבודה ומי שתפס/ה. לא לקרוא מהדפדפן.';

revoke all on function public.open_demand_rows(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_rows(uuid) to service_role;

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
  select * from public.open_demand_rows(public.current_agent_id());
$$;

comment on function public.open_demand_list() is
  'ביקוש פתוח לסוכן/ת המחובר/ת. אותה שאילתה כמו open_demand_rows.';

revoke all on function public.open_demand_list() from public, anon, authenticated;
grant execute on function public.open_demand_list() to authenticated, service_role;

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
  select * from public.open_demand_rows(p_agent);
$$;

comment on function public.open_demand_list_for_agent(uuid) is
  'אותה רשימה כמו open_demand_list, לסוכן/ת שגבריאלה מזהה. service_role בלבד.';

revoke all on function public.open_demand_list_for_agent(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_list_for_agent(uuid) to service_role;

create or replace function public.open_demand_stats_core(p_agent uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p_agent as id,
           (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') as day0
  ),
  cap as (
    select coalesce((select value from public.pricing_config where key = 'open_demand_claims_daily'), 2)::int as n
  )
  select jsonb_build_object(
    'claimed_today', (select count(*) from public.scraped_leads s, me
                       where s.claimed_at >= me.day0 and public.agent_works_city(me.id, s.city_id)),
    'my_today', (select count(*) from public.scraped_leads s, me
                  where s.claimed_by = me.id and s.claimed_at >= me.day0),
    'daily_cap', (select n from cap));
$$;

revoke all on function public.open_demand_stats_core(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_stats_core(uuid) to service_role;

create or replace function public.open_demand_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.open_demand_stats_core(public.current_agent_id());
$$;

comment on function public.open_demand_stats() is
  'ביקוש פתוח: כמה נתפסו היום בערים של הסוכן/ת, כמה תפס/ה, והתקרה היומית.';

revoke all on function public.open_demand_stats() from public, anon, authenticated;
grant execute on function public.open_demand_stats() to authenticated, service_role;

create or replace function public.open_demand_stats_for_agent(p_agent uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.open_demand_stats_core(p_agent);
$$;

revoke all on function public.open_demand_stats_for_agent(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_stats_for_agent(uuid) to service_role;

-- "אני פונה". הגוף היחיד. העטיפות רק בוחרות מי הסוכן/ת.
create or replace function public.open_demand_claim_core(p_agent uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       public.scraped_leads%rowtype;
  v_cap   int;
  v_used  int;
  v_source text;
  v_day0  timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
begin
  if p_agent is null then
    return jsonb_build_object('error', 'not_agent');
  end if;
  perform pg_advisory_xact_lock(hashtext('open_demand_claim:' || p_agent::text));

  select * into s from public.scraped_leads where id = p_id for update;
  if not found
     or not public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     or not public.agent_works_city(p_agent, s.city_id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'scraped_leads' and column_name = 'source_post_url'
  ) then
    execute 'select source_post_url from public.scraped_leads where id = $1'
      into v_source using p_id;
  end if;
  if s.claimed_by = p_agent then
    return jsonb_build_object(
      'success', true,
      'post_url', case when coalesce(s.post_url, '') like '%tab=demand%' then null else s.post_url end,
      'source_post_url', v_source,
      'already_mine', true);
  end if;
  if s.claimed_by is not null then
    return jsonb_build_object('error', 'claimed');
  end if;

  v_cap := coalesce((select value from public.pricing_config where key = 'open_demand_claims_daily'), 2)::int;
  select count(*) into v_used from public.scraped_leads
   where claimed_by = p_agent and claimed_at >= v_day0;
  if v_used >= v_cap then
    return jsonb_build_object('error', 'daily_cap', 'daily_cap', v_cap);
  end if;

  update public.scraped_leads set claimed_by = p_agent, claimed_at = now() where id = p_id;
  return jsonb_build_object(
    'success', true,
    'post_url', case when coalesce(s.post_url, '') like '%tab=demand%' then null else s.post_url end,
    'source_post_url', v_source,
    'my_today', v_used + 1, 'daily_cap', v_cap);
end;
$$;

revoke all on function public.open_demand_claim_core(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_demand_claim_core(uuid, uuid) to service_role;

create or replace function public.open_demand_claim(p_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.open_demand_claim_core(public.current_agent_id(), p_id);
$$;

comment on function public.open_demand_claim(uuid) is
  '"אני פונה" של הסוכן/ת המחובר/ת. הגוף ב-open_demand_claim_core.';

revoke all on function public.open_demand_claim(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_claim(uuid) to authenticated, service_role;

create or replace function public.open_demand_claim_for_agent(p_agent uuid, p_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.open_demand_claim_core(p_agent, p_id);
$$;

comment on function public.open_demand_claim_for_agent(uuid, uuid) is
  '"אני פונה" לסוכן/ת שגבריאלה מזהה. service_role בלבד. פרטי הקשר רק בתשובת הצלחה, לפי כללי התפיסה.';

revoke all on function public.open_demand_claim_for_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_demand_claim_for_agent(uuid, uuid) to service_role;
