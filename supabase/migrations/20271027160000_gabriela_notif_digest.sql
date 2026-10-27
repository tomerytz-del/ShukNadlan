-- גבריאלה: תקציר התראות. הכל כבוי בברירת המחדל.
--
-- notif_digest_enabled = 0: אותה התנהגות כמו 20270825090000.
-- כשהדגל 1: התראות שאינן בעדיפות יוצאות רק בחלון (08:30, 13:00, 17:30
-- שעון ישראל, ברירת רדיוס 15 דקות) ועם תקרה יומית 4 במקום 12.
-- notif_stop_131049 = 0: לא נוגעים. כשהוא 1, מי שקיבל 131049 בחלון
-- ההמתנה לא מקבל תבנית שיווקית מחוץ לחלון 24 השעות. בתוך החלון הטקסט
-- יוצא כרגיל.
-- "פחות כאלה" נשמר ב-agent_notif_less ומוציא את הסוג מהרשימה תמיד,
-- גם כשהדגל כבוי: בלי שורות בטבלה אין שינוי.

insert into public.pricing_config (key, value, description) values
  ('notif_digest_enabled', 0, '1: התראות שאינן בעדיפות יוצאות רק בחלונות התקציר, עם תקרה יומית נמוכה יותר.'),
  ('notif_digest_daily_cap', 4, 'תקרה יומית כש-notif_digest_enabled = 1. כשהדגל 0 נשארת notif_push_max_per_day.'),
  ('notif_digest_window_1', 510, 'דקות מחצות, שעון ישראל. 510 = 08:30.'),
  ('notif_digest_window_2', 780, 'דקות מחצות, שעון ישראל. 780 = 13:00.'),
  ('notif_digest_window_3', 1050, 'דקות מחצות, שעון ישראל. 1050 = 17:30.'),
  ('notif_digest_window_minutes', 15, 'כמה דקות סביב כל חלון תקציר ההתראה עדיין יוצאת.'),
  ('notif_stop_131049', 0, '1: לא שולחים תבנית שיווקית למי שקיבל 131049 לאחרונה, מחוץ לחלון 24 השעות.'),
  ('notif_131049_hold_hours', 72, 'כמה שעות אחרי 131049 לא שולחים תבנית, כש-notif_stop_131049 = 1.'),
  ('notif_topic_group', 0, '1: הודעת הוואטסאפ מקבצת לפי נושא. דורש גם notif_digest_enabled = 1.')
on conflict (key) do nothing;

create table if not exists public.agent_notif_less (
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  notif_type  text not null,
  created_at  timestamptz not null default now(),
  primary key (agent_id, notif_type),
  constraint agent_notif_less_type_chk check (notif_type ~ '^[a-z][a-z0-9_]{0,39}$')
);

comment on table public.agent_notif_less is
  'סוגי התראה שהסוכן/ת ביקש/ה פחות מהם בכפתור פחות כאלה. השורה מוציאה את הסוג מהדחיפה לוואטסאפ.';

alter table public.agent_notif_less enable row level security;

revoke all on table public.agent_notif_less from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_notif_less to service_role;

create or replace function public.notif_il_digest_open(p_window_minutes integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with clock as (
    select
      extract(hour from (now() at time zone 'Asia/Jerusalem'))::int * 60
      + extract(minute from (now() at time zone 'Asia/Jerusalem'))::int as minute
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
     where abs(clock.minute - wins.w) <= greatest(0, least(coalesce(p_window_minutes, 15), 120))
  );
$$;

comment on function public.notif_il_digest_open(integer) is
  'האם עכשיו בתוך אחד מחלון תקציר ההתראות, שעון ישראל. נקראת רק מ-notification_push_due_agents.';

revoke all on function public.notif_il_digest_open(integer) from public, anon, authenticated;
grant execute on function public.notif_il_digest_open(integer) to service_role;

-- הגוף מ-20270825090000, עם שלושה תנאים שקטים כשהדגלים 0:
-- תקרת התקציר, חלון התקציר, ועצירת תבנית אחרי 131049.
create or replace function public.notification_push_due_agents()
returns table (agent_id uuid, display_name text, phone_e164 text,
               whatsapp_types text[], in_service_window boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
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
                      where key = 'notif_131049_hold_hours'), 72)     as hold_hours,
           array['agenda_reminder']::text[]                            as urgent,
           public.notification_push_priority_types()                  as priority,
           public.notification_known_types()                          as known
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select t from unnest((select known from cfg)) t
              where t <> all (coalesce(np.whatsapp_off_types, '{}'::text[]))
                and not exists (
                  select 1 from public.agent_notif_less less
                   where less.agent_id = m.id and less.notif_type = t
                )
           )                                             as whatsapp_types,
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
           max(l.created_at) as last_at,
           max(l.created_at) filter (
             where l.channel_mode = 'template'
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
           ) as last_tpl_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as n24,
           count(*) filter (
             where not public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24,
           bool_or(
             position('131049' in coalesce(l.last_error, '')) > 0
             and l.created_at > now() - make_interval(hours => greatest(1, least(
               coalesce((select value::int from public.pricing_config where key = 'notif_131049_hold_hours'), 72),
               24 * 30)))
           ) as hit_131049
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164, a.in_window,
           case
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to, a.quiet_days)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when cfg.stop_131049 = 1
              and not a.in_window
              and coalesce(r.hit_131049, false)
             then '{}'::text[]
             when cfg.digest_on = 1
              and not public.notif_il_digest_open(cfg.digest_win)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.priority))
             when (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
               or coalesce(r.n24, 0) >= case
                    when cfg.digest_on = 1 then least(cfg.digest_cap, cfg.cap)
                    else cfg.cap
                  end
               or (not a.in_window
                   and r.last_tpl_at is not null
                   and r.last_tpl_at >= now() - make_interval(mins => cfg.tpl_gap))
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.priority))
             else a.whatsapp_types
           end as types,
           r.fails24, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  )
  select s.id, s.display_name, s.phone_e164, s.types, s.in_window
    from shaped s
   where coalesce(array_length(s.types, 1), 0) > 0
     and s.phone_e164 is not null
     and coalesce(s.fails24, 0) < s.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'סוכנים שמותר לשלוח להם עכשיו התראות בוואטסאפ, ואילו סוגים. דגלי התקציר ו-131049 כבויים בברירת המחדל ומשאירים את 20270825090000. agent_notif_less מוציא סוג שהסוכן/ת ביקש/ה פחות ממנו.';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;
