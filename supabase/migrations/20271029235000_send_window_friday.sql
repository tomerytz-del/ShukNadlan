-- ============================================================================
-- חלון שליחה: שישי עד 13:00, ושקט עד ראשון 08:00
-- ----------------------------------------------------------------------------
-- היום שישי שלם שקט (quiet_days ברירת מחדל {5,6}). הדגל
-- notif_send_window_friday_enabled נולד 0, ואז ההתנהגות נשארת.
-- כשהוא 1:
--   · ראשון-חמישי 08:00-21:00 שעון ישראל
--   · שישי 08:00-13:00
--   · משישי 13:00 עד ראשון 08:00 לא יוצא כלום
-- שעות השקט של הסוכן/ת עדיין חלות בתוך החלון, והן יכולות רק לצמצם.
-- שבת סגורה גם אם הסוכן/ת הוריד/ה אותה מ-quiet_days.
-- בחירה מפורשת של שישי כיום שקט נשארת. רק ברירת המחדל {5,6} נפתחת
-- בשישי בבוקר. שורות קיימות אינן נערכות.
-- agenda_reminder נשאר החריג היחיד שעוקף את השקט, כמו היום.
--
-- שני סוגי המענה אינם בעדיפות: הם נספרים בתקרה היומית, וכשהיא מלאה
-- נשארים בפעמון. רק new_lead ו-agenda_reminder (ו-showcase_meeting
-- שכבר היה) עוקפים את התקרה.
--
-- גוף ההסלמה ב-20271029250000. כאן רק החתימה, כדי שה-cron ייווצר.
-- הדגל נשאר 0.
-- ============================================================================

insert into public.pricing_config (key, value, description)
values ('notif_send_window_friday_enabled', 0,
        '1: שישי 08:00-13:00 פתוח, ומשישי 13:00 עד ראשון 08:00 סגור. 0: שישי שלם שקט כמו quiet_days.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. החלון של הפלטפורמה, בלי העדפות סוכן/ת
-- ---------------------------------------------------------------------------
create or replace function public.notification_send_window_open(p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case h.dow
           when 6 then false
           when 5 then h.h >= 8 and h.h < 13
           else h.h >= 8 and h.h < 21
         end
    from (select extract(hour from (p_at at time zone 'Asia/Jerusalem'))::int as h,
                 extract(dow  from (p_at at time zone 'Asia/Jerusalem'))::int as dow) h;
$$;

comment on function public.notification_send_window_open(timestamptz) is
  'חלון השליחה של הפלטפורמה, שעון ישראל: ראשון-חמישי 08:00-21:00, שישי 08:00-13:00, וסגור משישי 13:00 עד ראשון 08:00 (20271029235000).';

revoke all on function public.notification_send_window_open(timestamptz) from public, anon, authenticated;
grant execute on function public.notification_send_window_open(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. שקט אפקטיבי. דגל 0 = agent_reminder_quiet_at כמו היום.
--    דגל 1 = החלון של הפלטפורמה, ושעות/ימים של הסוכן/ת.
--    יום 5 יורד רק כש-quiet_days הוא בדיוק ברירת המחדל {5,6}.
--    מערך אחר, כולל שישי שנבחר במפורש, נשאר כמו שהוא.
-- ---------------------------------------------------------------------------
create or replace function public.notification_agent_send_quiet(
  p_from int,
  p_to int,
  p_days smallint[],
  p_at timestamptz,
  p_window_on int
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
           when coalesce(p_window_on, 0) = 1 then
             not public.notification_send_window_open(p_at)
             or public.agent_reminder_quiet_at(
                  p_at, p_from, p_to,
                  case
                    when coalesce(p_days, '{5,6}'::smallint[]) = '{5,6}'::smallint[]
                      then '{6}'::smallint[]
                    else coalesce(p_days, '{5,6}'::smallint[])
                  end)
           else
             public.agent_reminder_quiet_at(
               p_at, p_from, p_to, coalesce(p_days, '{5,6}'::smallint[]))
         end;
$$;

comment on function public.notification_agent_send_quiet(int, int, smallint[], timestamptz, int) is
  'האם הרגע שקט לשליחת התראות. דגל 0 שומר את שישי-שבת. דגל 1 פותח שישי 08:00-13:00 רק לברירת המחדל {5,6}. בחירת שישי נשארת (20271029235000).';

revoke all on function public.notification_agent_send_quiet(int, int, smallint[], timestamptz, int) from public, anon, authenticated;
grant execute on function public.notification_agent_send_quiet(int, int, smallint[], timestamptz, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. שני סוגים. הם אינם בעדיפות: התקרה היומית חלה עליהם, וכשהיא מלאה
--    notification_push_due_agents משאיר אותם מחוץ ל-whatsapp_types
--    והם נשארים בפעמון. new_lead ו-agenda_reminder ממשיכים לצאת.
-- ---------------------------------------------------------------------------
select public.notification_types_add(array['lead_response_reminder', 'lead_response_escalation']);

create or replace function public.notification_push_priority_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'agenda_reminder', 'showcase_meeting', 'new_lead'
  ]::text[];
$$;

comment on function public.notification_push_priority_types() is
  'סוגי התראה שעוקפים בוואטסאפ את התקרה היומית ואת מרווח הקיבוץ, ונשמרים 72 שעות ולא 12. lead_response_reminder ו-lead_response_escalation אינם כאן (20270420090000, 20271029235000).';

revoke all on function public.notification_push_priority_types() from public, anon, authenticated;
grant execute on function public.notification_push_priority_types() to service_role;

-- ---------------------------------------------------------------------------
-- 4. notification_push_due_agents - הגוף מ-20271029133000.
--    השינוי היחיד: עמודת window_on, והשקט דרך notification_agent_send_quiet.
--    urgent נשאר array['agenda_reminder'].
-- ---------------------------------------------------------------------------
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
  'סוכנים שמותר לשלוח להם עכשיו התראות בוואטסאפ, ואילו סוגים. דגל notif_send_window_friday_enabled כבוי ומשאיר את שישי שקט. agenda_reminder עדיין עוקף שקט (20271029235000).';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 5. החתימה בלבד. הגוף שכותב תזכורות והסלמות ב-20271029250000:
--    חותמת הדלקה, שעות פעילות, תקרה 10 בסבב, נמען אחד,
--    ואידמפוטנטיות ב-lead_escalations. הדגל נשאר 0, והפונקציה
--    הזו מחזירה 0 גם אם מישהו מדליק אותו לפני שהקובץ הבא רץ.
-- ---------------------------------------------------------------------------
create or replace function public.lead_response_escalations(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'notif_send_window_friday_enabled'), 0) <> 1
     or not public.notification_send_window_open(p_now) then
    return 0;
  end if;
  return 0;
end;
$$;

comment on function public.lead_response_escalations(timestamptz) is
  'חתימה. הגוף ב-20271029250000. דגל 0 או חלון סגור מחזיר 0, וגם דגל 1 מחזיר 0 עד שהקובץ הבא מחליף את הגוף (20271029235000).';

revoke all on function public.lead_response_escalations(timestamptz) from public, anon, authenticated;
grant execute on function public.lead_response_escalations(timestamptz) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;
  perform cron.unschedule('lead-response-escalations')
    where exists (select 1 from cron.job where jobname = 'lead-response-escalations');
  perform cron.schedule('lead-response-escalations', '*/15 * * * *',
                        'select public.lead_response_escalations();');
end $$;
