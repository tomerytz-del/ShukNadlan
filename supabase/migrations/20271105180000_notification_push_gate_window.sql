-- ---------------------------------------------------------------------------
-- notification-push: השער של ה-cron זול, ו"ביקוש פתוח" הוא רקע
--
-- 1. מה שבור. ה-job ‏`notification-push` רץ כל 5 דקות, ו-`net.http_post`
--    שלו נקרא רק אם `notification_push_ready()` מחזירה true. הסוכן התפעולי
--    דיווח עליו כשאילתה איטית (‏`slow_query`, ‏high): ממוצע 1,335ms, ‏290
--    קריאות ביום, ‏387 שניות מסד ביום. ‏`pg_stat_xact_user_functions` ב-5.11.2026
--    הראתה שכל הזמן בשער ולא בקריאת ה-HTTP:
--
--      notification_push_has_backlog        1,141ms
--        notification_push_due_agents         302ms
--          whatsapp_template_cap_on()          4,598 קריאות - פעם לכל שורת יומן
--          notification_push_log_holds         4,571 קריאות - כל היומן, מאז 13.9
--        notification_push_stale_in_quiet    9,038 קריאות - כל התראה שלא נקראה
--        notification_push_is_ambient        9,036 קריאות
--
--    ‏9,038 התראות לא נקראו, ורק 341 מהן בתוך חלון הזמן שהפונקציה בודקת
--    בסוף. כל השאר עוברות קודם את כל הפונקציות, ורק אז נופלות על הזמן.
--
-- 2. מה נכנס, בלי לשנות תוצאה:
--    * ‏`notification_push_has_backlog`: ‏`greatest(created_at, push_deferred_at)`
--      מול החלון הרחב ביותר (‏72 שעות או הגבוה מבין שני ה-lookback), לפני כל
--      קריאה לפונקציה, על אינדקס חלקי חדש. ‏greatest אינו קטן מ-
--      ‏`coalesce(push_deferred_at, created_at)` של הענף הראשון ולא מ-
--      ‏`created_at` של השני, ולכן כל התראה שעוברת את אחד מהם עוברת גם אותו.
--      נבדק בפרודקשן: 341 מתוך 341, אפס שנחתכו.
--    * ‏`notification_push_due_agents`: ‏`whatsapp_template_cap_on()` פעם אחת
--      ב-cfg, ו-`recent` קורא רק את שורות היומן שמישהו למטה משווה אליהן -
--      הגדול מבין 24 שעות, ‏`notif_131049_hold_hours`, מרווח התבנית, המרווח
--      ושני חלונות תקציר. נבדק בפרודקשן מול הפונקציה הקיימת: 52 מול 52
--      שורות, אפס הבדלים; ‏buffers ‏21,450 → 1,330.
--    שתי הפונקציות הועתקו מהגוף שרץ בפרודקשן (‏md5 של prosrc זהה ל-
--    ‏20271031290000 ול-20271030000200), ושונו רק בשורות המסומנות.
--    ‏`notification_push_claim` אינה משתנה: הפרדיקט שחייב להיות זהה בשתיהן
--    (‏`notification_push_log_holds`) לא נגעו בו, והחלון מוסיף רק סינון
--    שהשער כבר מקיים.
--
-- 3. ‏`open_demand` הוא רקע (‏`notification_push_is_ambient`). בשבוע שעד
--    5.11.2026 ‏29 מתוך 32 הודעות התבנית שנכשלו היו `open_demand`, ו-27 מהן
--    ‏131049 (‏Meta מגבילה הודעות שיווק לאותו אדם): ביקוש פתוח מופץ לכל
--    הסוכנים בעיר, וכל פוסט שליח תבנית משלו. מעכשיו הוא אינו מעיר שליחה
--    לבד - הוא מצטרף להודעה הבאה שיש בה משהו אחר, ואם אין כזו יוצא כתקציר
--    כשהוותיק מחכה `notif_push_ambient_digest_minutes` (‏180). השורה בפעמון
--    ובלשונית "ביקוש פתוח" אינה משתנה. החלטת תומר, 5.11.2026.
--
-- אידמפוטנטית. ‏`docs/whatsapp-setup.md`, ‏`docs/scraped-leads.md`.
-- ---------------------------------------------------------------------------

create index if not exists notifications_push_window_idx
  on public.notifications (agent_id, (greatest(created_at, push_deferred_at)))
  where not read and not suppress_push;

-- ---------------------------------------------------------------------------
-- 1. due_agents: גוף 20271030000200, ‏cap_on פעם אחת ו-recent בחלון
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
             position('131049' in coalesce(l.last_error, '')) > 0
             and l.created_at > now() - make_interval(hours => (select hold_hours from cfg))
           ) as hit_131049
      from public.notification_push_log l
     cross join cfg c
     -- 20271105180000: רק השורות שמישהו למטה קורא. החלון רחב מכל השוואה
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
  'גוף 20271030000200. ‏20271105180000: cap_on פעם אחת, ו-recent קורא רק את חלון היומן שמשווים אליו. אותה תוצאה.';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 2. has_backlog: גוף 20271031290000, וחלון זמן זול לפני הפונקציות
-- ---------------------------------------------------------------------------

create or replace function public.notification_push_has_backlog(p_exempt_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select pg_catalog.now() - make_interval(hours => greatest(
             72,
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_push_priority_lookback_hours'), 72),
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_push_lookback_hours'), 12))) as since
  )
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
          -- 20271105180000: חלון גס וזול לפני כל קריאה לפונקציה, על האינדקס
          -- notifications_push_window_idx. ‏greatest אינו קטן מ-coalesce של
          -- הענף הראשון ולא מ-created_at של השני, ולכן אינו משנה את התוצאה.
          and greatest(n.created_at, n.push_deferred_at) > (select g.since from g)
          and n.type = any(a.whatsapp_types)
          and not (
            public.notif_cadence_button_on()
            and not public.whatsapp_template_cap_on()
            and exists (
              select 1 from public.notification_push_log lcad
               where lcad.agent_id = n.agent_id
                 and n.id = any(lcad.notification_ids)
                 and lcad.whatsapp_status = 'skipped_template_cap'
                 and public.whatsapp_template_local_day(lcad.created_at)
                     = public.whatsapp_template_local_day(pg_catalog.now())
            )
            and not public.lead_wa_digest_cap_allows(n.agent_id, null)
          )
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
  'פריט תקרה מעיר את הקרון בחלון תקציר רק אם מותרת תבנית: חריץ רגיל, או החריץ השמור אחרי 8 שעות, או טקסט בחלון 24 השעות. ‏20271105180000: חלון זמן על notifications_push_window_idx לפני הפונקציות.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. ביקוש פתוח הוא רקע
-- ---------------------------------------------------------------------------

create or replace function public.notification_push_is_ambient(p_type text, p_agent uuid, p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_type in ('platform_signup', 'open_demand')
      or (p_type = 'system' and p_property is not null and exists (
            select 1 from public.properties p
             where p.id = p_property
               and p.agent_id is distinct from p_agent
               and p.referred_by is distinct from p_agent));
$$;

comment on function public.notification_push_is_ambient(text, uuid, uuid) is
  'התראת רקע (שיתוף נכס ממשרד אחר, נרשם/ת חדש/ה, ביקוש פתוח): לא מעירה שליחה בוואטסאפ לבד, אלא מצטרפת להודעה הבאה או לתקציר (20270420090000, ביקוש פתוח מ-20271105180000).';

revoke all on function public.notification_push_is_ambient(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.notification_push_is_ambient(text, uuid, uuid) to service_role;
