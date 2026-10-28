-- ============================================================================
-- תקרת תבניות וואטסאפ לסוכן/ת. כבויה.
--
-- version 20271030000200. סדר המיזוג: #1020 (20271029133000),
-- אחר כך #1025 (20271029140000), ואז הקובץ הזה.
-- 20271028120000_social_publish_handed_off כבר הוחל בפרודקשן.
-- holds של #1020 (20271029133000) כבר מכיר skipped. כאן נוסף skipped_template_cap.
--
-- app_config.whatsapp_template_cap_enabled = false. כל ערך שאינו
-- 1/true/on/yes משאיר את השליחה כמו היום: אין תקרה, אין שורת דילוג,
-- וטקסט חופשי בתוך חלון 24 השעות לא נספר.
--
-- כשהדגל דלוק, נספרות רק תבניות (מחוץ לחלון): שורות
-- notification_push_log עם channel_mode = template שכבר יצאו או שעדיין
-- pending ובחלון החסד, וגם whatsapp_messages יוצאות עם msg_type = template
-- בלי שגיאה. אין שם ערוץ ב-agent_reminder_log, ולכן תזכורת לא נספרת כאן.
-- היום הוא יום מקומי באסיה/ירושלים, לא UTC.
--
-- ברירת מחדל: תבנית אחת ביום. תבנית שנייה מותרת רק אם עברו 8 שעות
-- מהקודמת, ועד 2 ביום. 2 הוא גג, לא יעד.
-- רשימת הפטור ב-app_config.whatsapp_template_cap_exempt_types
-- (ברירת מחדל ["new_lead","agenda_reminder","showcase_meeting"]).
-- שינוי הרשימה בלי מיגרציה. סיור נשאר מחוץ לתבנית UTILITY (#1048).
-- פטור יוצא גם מעל הגג, ונחשב בספירה אחרי שיצא.
-- כל השאר (טיפ, ביקוש פתוח, שותף איתך, system, marketing_copy)
-- נרשם skipped_template_cap בזמן האמיתי, עם last_error באותו קוד,
-- נשאר בפעמון, ולא יוצא שוב לוואטסאפ. created_at לא מוזז אחורה.
--
-- notification_push_claim אחד, הגוף של #1025. notification_push_burst_prepare
-- רץ פעם אחת בראש הפונקציה, ו-whatsapp_template_cap_allow פעם אחת לסוכן/ת
-- אחרי שורת היומן. אין טריגר לכל שורה ואין עטיפה פנימית.
-- ============================================================================

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  description text not null default ''
);

comment on table public.app_config is
  'מתגים תפעוליים. whatsapp_template_cap_enabled כבוי עד שמדליקים אותו.';

alter table public.app_config enable row level security;

revoke all on table public.app_config from public, anon, authenticated;
grant select, insert, update, delete on table public.app_config to service_role;

insert into public.app_config (key, value, description) values
  ('whatsapp_template_cap_enabled', 'false',
   'true: תקרת תבניות וואטסאפ לסוכן/ת. false: אין תקרה, והשליחה כמו היום.'),
  ('whatsapp_template_cap_daily', '1',
   'כמה תבניות ביום מקומי (Asia/Jerusalem) לפני שהשניה דורשת מרווח. 1 הוא ברירת המחדל.'),
  ('whatsapp_template_cap_hard_max', '2',
   'גג תבניות ביום מקומי. 2 הוא גג, לא יעד. הפטור מההגדרה יוצא גם מעליו, ונחשב בספירה.'),
  ('whatsapp_template_cap_gap_hours', '8',
   'שעות מינימום בין התבנית הראשונה לשניה באותו יום מקומי.'),
  ('whatsapp_template_cap_exempt_types', '["new_lead","agenda_reminder","showcase_meeting"]',
   'מערך JSON של סוגי התראה שיוצאים גם מעל גג התבניות ונחשבים בספירה. ברירת המחדל new_lead, agenda_reminder ו-showcase_meeting.')
on conflict (key) do nothing;

alter table public.notification_push_log drop constraint if exists notification_push_log_status_chk;
alter table public.notification_push_log add constraint notification_push_log_status_chk
  check (whatsapp_status in ('pending', 'sent', 'failed', 'skipped', 'skipped_template_cap'));

-- skipped ו-skipped_template_cap חוסמים לתמיד, כמו sent.
-- pending חוסם רק בחלון החסד (20261101090000).
create or replace function public.notification_push_log_holds(
  p_status  text,
  p_created timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('sent', 'skipped', 'skipped_template_cap')
      or (p_status = 'pending'
          and p_created > now() - make_interval(mins => coalesce(
                (select value::int from public.pricing_config
                  where key = 'notif_push_pending_grace_minutes'), 30)));
$$;

comment on function public.notification_push_log_holds(text, timestamptz) is
  'האם שורת יומן דחיפה חוסמת הודעה נוספת על אותן התראות. sent, skipped ו-skipped_template_cap חוסמים תמיד. pending חוסם רק בחלון החסד.';

revoke all on function public.notification_push_log_holds(text, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_log_holds(text, timestamptz) to service_role;

create or replace function public.whatsapp_template_local_day(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Jerusalem')::date;
$$;

comment on function public.whatsapp_template_local_day(timestamptz) is
  'היום המקומי של חותמת, שעון אסיה/ירושלים. גבול היממה של תקרת התבניות.';

revoke all on function public.whatsapp_template_local_day(timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_template_local_day(timestamptz) to service_role;

-- true = מותר לשלוח. p_exempt עוקף את הגג. 2 הוא גג: שניה רק אחרי המרווח.
create or replace function public.whatsapp_template_cap_decide(
  p_count int,
  p_hours numeric,
  p_exempt boolean,
  p_daily int,
  p_hard int,
  p_gap_hours numeric
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_exempt, false) then true
    when coalesce(p_count, 0) < greatest(coalesce(p_daily, 1), 0) then true
    when coalesce(p_count, 0) >= greatest(
           coalesce(p_hard, 2),
           greatest(coalesce(p_daily, 1), 0)) then false
    when p_hours is not null and p_hours >= coalesce(p_gap_hours, 8) then true
    else false
  end;
$$;

comment on function public.whatsapp_template_cap_decide(int, numeric, boolean, int, int, numeric) is
  'האם תבנית נוספת מותרת. ליד ותזכורת (p_exempt) יוצאים גם מעל הגג. בלי פטור: מתחת לברירת היום כן, בגג לא, ובין לבין רק אחרי מרווח השעות.';

revoke all on function public.whatsapp_template_cap_decide(int, numeric, boolean, int, int, numeric) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_decide(int, numeric, boolean, int, int, numeric) to service_role;

create or replace function public.whatsapp_template_cap_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce(
           (select c.value from public.app_config c
             where c.key = 'whatsapp_template_cap_enabled'),
           'false'))) in ('1', 'true', 'on', 'yes');
$$;

comment on function public.whatsapp_template_cap_on() is
  'האם תקרת התבניות דלוקה. ברירת המחדל false, וכל ערך אחר מ-1/true/on/yes נשאר כבוי.';

revoke all on function public.whatsapp_template_cap_on() from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_on() to service_role;


-- רשימת הפטור. ערך ריק, חסר או שאינו מערך JSON חוזר לברירת המחדל.
create or replace function public.whatsapp_template_cap_exempt_parse(p_value text)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v text[];
begin
  if p_value is null or btrim(p_value) = '' then
    return array['new_lead', 'agenda_reminder', 'showcase_meeting']::text[];
  end if;
  begin
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}'::text[])
      into v
      from jsonb_array_elements_text(btrim(p_value)::jsonb) as t(x);
  exception when others then
    return array['new_lead', 'agenda_reminder', 'showcase_meeting']::text[];
  end;
  if v is null or cardinality(v) = 0 then
    return array['new_lead', 'agenda_reminder', 'showcase_meeting']::text[];
  end if;
  return v;
end;
$$;

comment on function public.whatsapp_template_cap_exempt_parse(text) is
  'מפרש את whatsapp_template_cap_exempt_types. ברירת המחדל new_lead, agenda_reminder ו-showcase_meeting.';

revoke all on function public.whatsapp_template_cap_exempt_parse(text) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_exempt_parse(text) to service_role;

create or replace function public.whatsapp_template_cap_exempt_types()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select public.whatsapp_template_cap_exempt_parse(
    (select c.value from public.app_config c
      where c.key = 'whatsapp_template_cap_exempt_types'));
$$;

comment on function public.whatsapp_template_cap_exempt_types() is
  'סוגי ההתראה שיוצאים גם מעל גג התבניות. נקרא מ-app_config, בלי מיגרציה לשינוי.';

revoke all on function public.whatsapp_template_cap_exempt_types() from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_exempt_types() to service_role;

-- ספירה אחת לסוכן/ת: חלון של יומיים כדי שהאינדקס (agent_id, created_at) ישרת,
-- ואז רק היום המקומי. skipped_template_cap לא נספר. פטור שיצא (new_lead,
-- agenda_reminder, showcase_meeting) נספר כמו כל תבנית. p_except הוא השורה שנבדקת.
create or replace function public.whatsapp_template_cap_usage(
  p_agent uuid,
  p_except uuid
)
returns table (n int, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int, max(s.created_at)
    from (
      select l.created_at
        from public.notification_push_log l
       where l.agent_id = p_agent
         and l.created_at > now() - interval '2 days'
         and l.id is distinct from p_except
         and l.channel_mode = 'template'
         and l.whatsapp_status in ('sent', 'pending')
         and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
         and public.whatsapp_template_local_day(l.created_at)
             = public.whatsapp_template_local_day(now())
      union all
      select m.created_at
        from public.whatsapp_messages m
       where m.agent_id = p_agent
         and m.created_at > now() - interval '2 days'
         and m.direction = 'out'
         and m.msg_type = 'template'
         and coalesce(m.error, '') = ''
         and public.whatsapp_template_local_day(m.created_at)
             = public.whatsapp_template_local_day(now())
    ) s;
$$;

comment on function public.whatsapp_template_cap_usage(uuid, uuid) is
  'כמה תבניות יצאו לסוכן/ת היום המקומי, ומתי האחרונה. חלון של יומיים לאינדקס. דילוג תקרה לא נספר.';

revoke all on function public.whatsapp_template_cap_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_usage(uuid, uuid) to service_role;

-- true = מותר לשלוח. נקרא פעם אחת לסוכן/ת מתוך claim, ושוב בשליחה.
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
  v_ids    uuid[];
  v_daily  int;
  v_hard   int;
  v_gap    numeric;
  v_count  int;
  v_last   timestamptz;
  v_hours  numeric;
  v_exempt boolean;
begin
  select l.agent_id, l.channel_mode, l.whatsapp_status, l.last_error, l.types, l.notification_ids
    into v_agent, v_mode, v_status, v_error, v_types, v_ids
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

  select u.n, u.last_at
    into v_count, v_last
    from public.whatsapp_template_cap_usage(v_agent, p_log_id) u;

  if v_last is not null then
    v_hours := extract(epoch from (now() - v_last)) / 3600.0;
  end if;

  select case when c.value ~ '^[0-9]+$' then c.value::int else null end
    into v_daily
    from public.app_config c
   where c.key = 'whatsapp_template_cap_daily';
  v_daily := coalesce(v_daily, 1);

  select case when c.value ~ '^[0-9]+$' then c.value::int else null end
    into v_hard
    from public.app_config c
   where c.key = 'whatsapp_template_cap_hard_max';
  v_hard := coalesce(v_hard, 2);

  select case when c.value ~ '^[0-9]+(\.[0-9]+)?$' then c.value::numeric else null end
    into v_gap
    from public.app_config c
   where c.key = 'whatsapp_template_cap_gap_hours';
  v_gap := coalesce(v_gap, 8);

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

  if v_ids is not null then
    update public.notifications n
       set suppress_push = true
     where n.id = any(v_ids);
  end if;

  return false;
end;
$$;

comment on function public.whatsapp_template_cap_allow(uuid) is
  'האם שורת יומן תבנית מותרת לשליחה. כבוי: תמיד כן, חוץ משורה שכבר דולגה. דלוק: מעל התקרה מסמן skipped_template_cap בזמן האמיתי ולא שולח שוב. הפטור מ-app_config יוצא גם מעל הגג.';

revoke all on function public.whatsapp_template_cap_allow(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_template_cap_allow(uuid) to service_role;

-- אין טריגר לכל שורה. הספירה רצה פעם אחת לסוכן/ת ב-claim, ושוב בשליחה.
drop trigger if exists notification_push_log_template_cap on public.notification_push_log;
drop function if exists public.notification_push_log_template_cap();


-- המרווח ותקרת 24 השעות לא רואים דילוג. holds עדיין חוסם את אותן התראות.

-- due_agents: גוף #1055, והמסננים רק כשהתקרה דלוקה.
create or replace function public.notification_push_due_agents()
returns table (agent_id uuid, display_name text, phone_e164 text,
               whatsapp_types text[], in_service_window boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg0 as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10)      as gap_min,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_per_day'), 12)      as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_failures_24h'), 3)  as max_fail,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_template_gap_minutes'), 240) as tpl_gap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_enabled'), 0)         as digest_on,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_daily_cap'), 4)       as digest_cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15) as digest_win,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_stop_131049'), 0)            as stop_131049,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_send_window_friday_enabled'), 0) as window_on,
           greatest(1, least(
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_131049_hold_hours'), 72),
             24 * 30))                                                as hold_hours,
           array['agenda_reminder']::text[]                            as urgent,
           public.notification_push_priority_types()                  as priority,
           public.notification_known_types()                          as known
  ),
  cfg as (
    select cfg0.*,
           public.notif_il_digest_open(cfg0.digest_win) as digest_open
      from cfg0
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select t from unnest((select known from cfg)) t
              where t <> all (coalesce(np.whatsapp_off_types, '{}'::text[]))
           )                                             as whatsapp_types,
           array(
             select less.notif_type
               from public.agent_notif_less less
              where less.agent_id = m.id
                and less.expires_at > now()
                and not public.notification_push_less_kept(less.notif_type)
           )                                             as less_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[])     as quiet_days,
           coalesce(
             (select c.last_message_at > now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false)                                      as in_window
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences     rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ),
  recent as (
    select l.agent_id,
           max(l.created_at) filter (
             where not public.whatsapp_template_cap_on()
                or l.whatsapp_status not in ('skipped', 'skipped_template_cap')
           ) as last_at,
           max(l.created_at) filter (
             where l.channel_mode = 'template'
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and (
                 not public.whatsapp_template_cap_on()
                 or l.whatsapp_status in ('sent', 'pending')
               )
           ) as last_tpl_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
               and (
                 not public.whatsapp_template_cap_on()
                 or l.whatsapp_status in ('sent', 'pending')
               )
           ) as n24,
           count(*) filter (
             where not public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24,
           bool_or(
             position('131049' in coalesce(l.last_error, '')) > 0
             and l.created_at > now() - make_interval(hours => (select hold_hours from cfg))
           ) as hit_131049
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164, a.in_window,
           case
             when public.notification_agent_send_quiet(
                    a.quiet_from, a.quiet_to, a.quiet_days, now(), cfg.window_on)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when coalesce((select value::int from public.pricing_config
                             where key = 'agent_holiday_window_enabled'), 0) = 1
              and public.agent_backlog_waiting(a.id, pg_catalog.now())
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
             )
             when cfg.stop_131049 = 1
              and not a.in_window
              and coalesce(r.hit_131049, false)
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or public.notification_push_less_kept(t)
             )
             when cfg.digest_on = 1
              and not cfg.digest_open
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or public.notification_push_less_kept(t)
             )
             when (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
               or coalesce(r.n24, 0) >= case
                    when cfg.digest_on = 1 then least(cfg.digest_cap, cfg.cap)
                    else cfg.cap
                  end
               or (not a.in_window
                   and r.last_tpl_at is not null
                   and r.last_tpl_at >= now() - make_interval(mins => cfg.tpl_gap))
             then array(
               select t from unnest(a.whatsapp_types) t
                where t = any(cfg.priority)
                   or (cfg.digest_on = 1 and public.notification_push_less_kept(t))
             )
             else a.whatsapp_types
           end as raw_types,
           a.less_types,
           cfg.digest_open,
           cfg.digest_win,
           r.last_at,
           r.fails24, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  ),
  gated as (
    select s.id, s.display_name, s.phone_e164, s.in_window, s.fails24, s.max_fail,
           case
             when s.digest_open
              and (s.last_at is null
                   or s.last_at < now() - make_interval(mins => greatest(s.digest_win, 1) * 2))
             then s.raw_types
             else array(
               select t from unnest(s.raw_types) t
                where t <> all (coalesce(s.less_types, '{}'::text[]))
             )
           end as types
      from shaped s
  )
  select g.id, g.display_name, g.phone_e164, g.types, g.in_window
    from gated g
   where coalesce(array_length(g.types, 1), 0) > 0
     and g.phone_e164 is not null
     and coalesce(g.fails24, 0) < g.max_fail;
$$;


comment on function public.notification_push_due_agents() is
  'גוף 20271030000100. מסנני skipped_template_cap חלים רק כש-whatsapp_template_cap_on(). כבוי: אותו חלון, אותו פיזור ואותו שקט.';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;


-- claim: גוף 210000, ותקרת התבניות פעם אחת.
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
begin
  perform public.notification_push_burst_prepare();

  select coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 1),
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
           and (n.created_at > now() - make_interval(hours =>
                  case
                    when n.type = any(v_prio) then least(v_look_p, v_urgent)
                    when v_digest_on = 1 and public.notification_push_less_kept(n.type) then least(v_look_p, v_urgent)
                    else least(v_look, v_stale)
                  end)
                or (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)))
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
           and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
      ) s;

    continue when v_items is null or not v_wake;

    -- מתג כבוי: אותה הודעה כמו בלי תקרת ההתפרצות. ישן ומילוי כבר סוננו בהכנה.
    if v_guard = 1 then
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

      -- מפסק: ליד אמיתי ומוגן יוצאים בפרטים. בלי מוגן אין שליחה, ואין skipped.
      if v_pause then
        if coalesce(array_length(v_ex_ids, 1), 0) = 0 then
          continue;
        end if;
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_lane_over then
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

    v_mode := case when a.in_service_window then 'text' else 'template' end;

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
  'גוף 20271029210000, כולל action_path. תקרת התבניות נוספת פעם אחת אחרי השמירה. כבויה: אין דילוג.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
