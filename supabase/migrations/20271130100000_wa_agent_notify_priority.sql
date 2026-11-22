-- ---------------------------------------------------------------------------
-- וואטסאפ לסוכנים: סדר משבצות, עצירת 131049, והדלקת התקציר.
--
-- 1. משבצת התבנית מוגבלת (1 ביום, שניה אחרי 8 שעות, גג 2). השורה הגבוהה
--    יוצאת קודם. שורה נמוכה לא נכנסת לאותה תבנית כשיש שורה גבוהה ממתינה:
--    new_lead / showcase_meeting / agenda_reminder / ops_alert, ואז
--    open_demand, ואז match_digest ושאר הסיכומים. מה שנדחה נשאר בפעמון
--    ויוצא בתקציר. השקט, שישי מ-13:00 והשבת, ותקרות 1/8/2 לא משתנים.
--    הפיצול עצמו ב-notification-push (template-priority.ts), כי שם נבנית
--    ההודעה. כאן רק השערים שהמסד כבר מחזיק.
--
-- 2. 131049 של Meta נשמר ב-delivery_detail כשהסטטוס sent, לא ב-last_error.
--    notification_log_hit_131049 קורא את שניהם. notif_stop_131049 = 1.
--    ההחזקה היא notif_131049_hold_hours (72). מחוץ לחלון 24 השעות אין
--    תבנית בכלל, גם לא לליד. ההתראה נשארת בפעמון. הודעה נכנסת לגבריאלה
--    פותחת את החלון, והמותר יוצא כטקסט שיחה.
--
-- 3. notif_digest_enabled = 1. סוגי שורה 1 לא מחכים לחלון. ביקוש פתוח
--    שלא נכנס למשבצת, match_digest וסיכומים יוצאים בחלון 08:30 / 13:00 /
--    17:30. הדגל מדליק גם את whatsapp_template_cap_on, כי דגל התקרה כבר
--    true: בלי תקציר פריט שנעצר היה נשאר בפעמון.
--
-- אין מחיקה. כיבוי: מיגרציה שמחזירה את שני הדגלים ל-0.
-- ---------------------------------------------------------------------------

create or replace function public.notification_log_hit_131049(
  p_error text,
  p_detail text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select position('131049' in coalesce(p_error, '')) > 0
      or position('131049' in coalesce(p_detail, '')) > 0;
$$;

comment on function public.notification_log_hit_131049(text, text) is
  'האם שורת יומן נחסמה ב-131049. הקוד יושב ב-last_error או ב-delivery_detail (סטטוס sent).';

revoke all on function public.notification_log_hit_131049(text, text) from public, anon, authenticated;
grant execute on function public.notification_log_hit_131049(text, text) to service_role;

insert into public.pricing_config (key, value, description) values
  ('notif_digest_enabled', 1, '1: התראות שאינן בעדיפות יוצאות רק בחלונות התקציר.'),
  ('notif_stop_131049', 1, '1: אין תבנית למי שקיבל 131049 בחלון ההחזקה, מחוץ לחלון 24 השעות.')
on conflict (key) do update
  set value = excluded.value
  where public.pricing_config.value is distinct from excluded.value;

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
           public.whatsapp_template_cap_on()                          as cap_on,
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
             where not c.cap_on
                or l.whatsapp_status not in ('skipped', 'skipped_template_cap')
           ) as last_at,
           max(l.created_at) filter (
             where l.channel_mode = 'template'
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and (
                 not c.cap_on
                 or l.whatsapp_status in ('sent', 'pending')
               )
           ) as last_tpl_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
               and (
                 not c.cap_on
                 or l.whatsapp_status in ('sent', 'pending')
               )
           ) as n24,
           count(*) filter (
             where l.whatsapp_status = 'failed'
               and l.created_at > now() - interval '24 hours'
           ) as fails24,
           bool_or(
             public.notification_log_hit_131049(l.last_error, l.delivery_detail)
             and l.created_at > now() - make_interval(hours => (select hold_hours from cfg))
           ) as hit_131049
      from public.notification_push_log l
     cross join cfg c
     -- 20271109130000: רק השורות שמישהו למטה קורא. החלון רחב מכל השוואה
     -- (מרווח, תקציר, מרווח תבנית, 24 שעות, 131049), ולכן התוצאה זהה.
     where l.created_at > pg_catalog.now() - greatest(
             make_interval(hours => greatest(c.hold_hours, 24)),
             make_interval(mins => greatest(c.tpl_gap, c.gap_min,
                                            greatest(c.digest_win, 1) * 2)))
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
             -- 20271130100000: אין תבנית למי שמטא חסמה. ההתראות נשארות בפעמון.
             -- בתוך חלון 24 השעות הענף הזה לא חל, והשליחה היא טקסט שיחה.
             then '{}'::text[]
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
  'גוף 20271109130000. 20271130100000: 131049 נקרא גם מ-delivery_detail. מחוץ לחלון 24 השעות אין תבנית למי שנחסם. השקט, השבת והתקרות לא השתנו.';


revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;
