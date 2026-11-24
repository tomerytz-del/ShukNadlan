-- ---------------------------------------------------------------------------
-- notification-push: השער של ה-cron אחרי הדלקת התקציר
--
-- 1. מה שבור. ה-job ‏`notification-push` רץ כל 5 דקות, ו-`net.http_post` שלו
--    נקרא רק אם `notification_push_ready()` מחזירה true. הסוכן התפעולי פתח
--    עליו `slow_query` ב-23.11.2026 (ממוצע 225ms, ‏288 קריאות ביום).
--    ‏`cron.job_run_details` מראה מדרגה ולא זחילה: ממוצע שעתי של 132-151ms עד
--    22.11 בשעה 18:00 UTC, ו-285-348ms מ-20:00 - השעה שבה 20271130100000
--    הדליקה את `notif_digest_enabled`. ‏`explain analyze` על השער ב-24.11:
--    ‏303ms, מהם 172ms ב-`notification_push_due_agents`.
--
--    כשהתקציר דלוק והחלון סגור (רוב היום), הענף `digest_on and not digest_open`
--    קורא ל-`notification_push_less_kept(t)` לכל סוג התראה של כל סוכן/ת - 4,416
--    קריאות בבדיקה אחת - ו-`notification_digest_sent_this_window` נקראת לכל
--    סוכן/ת ומתחילה באותה בדיקת שעון. שתיהן פונקציות SQL עם `set search_path`,
--    שאינן נפרסות לתוך השאילתה, ולכן כל קריאה משלמת הפעלה מלאה.
--
-- 2. מה נכנס, בלי לשנות תוצאה. שני ערכים שאינם תלויים בסוכן/ת מחושבים פעם
--    אחת ב-cfg0:
--    * ‏`less_kept` = ‏`notification_push_less_kept_types()`. ‏`less_kept(t)` היא
--      בהגדרתה `t = any(less_kept_types())`, ולכן שלושת המקומות שקראו לה
--      משווים עכשיו למערך.
--    * ‏`tpl_open` = ‏`whatsapp_template_cap_digest_open_at(now())`, התנאי הראשון
--      של `notification_digest_sent_this_window`. כשהוא false היא false לכל
--      סוכן/ת, ולכן לא קוראים לה. כשהוא true הקריאה נשארת כמו שהייתה. ‏`case`
--      ולא `and`, כי רק `case` מבטיח את סדר ההערכה.
--    הגוף הועתק ממה שרץ בפרודקשן (‏md5 של prosrc ‏8d134c0346f3c8db605416175739cda5,
--    זהה ל-20271130100000), ושונו רק השורות המסומנות.
--
-- 3. איך נבדק, בקריאה בלבד מול הפרודקשן (24.11.2026, חלון התקציר סגור):
--    הגוף החדש כשאילתה מול הפונקציה הקיימת - 50 מול 50 שורות, אפס הבדלים
--    בשני הכיוונים (‏except), ו-29.5ms מול 150ms ו-131ms בשתי הרצות של הקיימת.
--    בחלון פתוח הקריאה ל-`notification_digest_sent_this_window` זהה לקודמת,
--    והשוויון שם נובע מההגדרה ולא ממדידה.
--
-- החתימה וההרשאות לא משתנות. ‏`notification_push_claim` ו-
-- ‏`notification_push_has_backlog` קוראות לפונקציה ואינן משתנות.
-- אידמפוטנטית. ‏`docs/whatsapp-setup.md`, ‏`docs/ops-agent.md`.
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
           public.whatsapp_template_cap_on()                          as cap_on,
           public.notification_known_types()                          as known,
           -- 20271201120000: שני ערכים שאינם תלויים בסוכן/ת, פעם אחת במקום
           -- פעם לכל סוכן/ת ולכל סוג התראה.
           public.notification_push_less_kept_types()                 as less_kept,
           public.whatsapp_template_cap_digest_open_at(pg_catalog.now()) as tpl_open
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
                and not (less.notif_type = any((select less_kept from cfg)::text[]))
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
                   or t = any(cfg.less_kept)
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
                   or (cfg.digest_on = 1 and t = any(cfg.less_kept))
             )
             else a.whatsapp_types
           end as raw_types,
           a.less_types,
           cfg.digest_open,
           cfg.digest_win,
           cfg.tpl_open,
           r.last_at,
           r.fails24, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  ),
  gated as (
    select s.id, s.display_name, s.phone_e164, s.in_window, s.fails24, s.max_fail,
           s.tpl_open,
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
  select s.id, s.display_name, s.phone_e164, s.types, s.in_window
    from (
      select g.id, g.display_name, g.phone_e164, g.in_window, g.fails24, g.max_fail,
             case
               -- notification_digest_sent_this_window מתחילה באותה בדיקת שעון.
               -- מחוץ לחלון התקציר היא false לכל סוכן/ת, ולכן לא קוראים לה.
               when not g.tpl_open then g.types
               when public.notification_digest_sent_this_window(g.id)
               then array(
                 select t from unnest(g.types) t
                  where not public.notification_wa_digest_type(t)
               )
               else g.types
             end as types
        from gated g
    ) s
   where coalesce(array_length(s.types, 1), 0) > 0
     and s.phone_e164 is not null
     and coalesce(s.fails24, 0) < s.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'גוף 20271130100000. 20271201120000: less_kept ובדיקת שעון התקציר מחושבים פעם אחת ב-cfg0 במקום לכל סוכן/ת ולכל סוג. התוצאה זהה.';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;
