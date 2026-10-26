-- ============================================================================
-- מרווח בין הודעות תבנית לאותו/ה סוכן/ת: נגד 131049 של Meta
-- ----------------------------------------------------------------------------
-- ‏25.10.2026: הסוכן התפעולי דיווח "הודעות התבנית לסוכנים לא מגיעות - 15%"
-- ‏(29 מתוך 188 בשבוע). ‏27 מה-29 הן 131049 - "This message was not delivered to
-- maintain healthy ecosystem engagement": ‏Meta מגבילה כמה הודעות **שיווק** אדם
-- אחד מקבל, והתבנית שלנו מסווגת שיווק (‏docs/whatsapp-setup.md).
--
-- ‏הכשלים לא מפוזרים - הם יושבים על הודעה שנייה סמוך לראשונה:
--
--   13:40  תקציר "נכס חדש שותף איתך" (רקע, 180 דקות אחרי 10:38)  34 נשלחו, 4 נכשלו
--   14:10  match_digest, ‏30 דקות אחרי                             18 נשלחו, 10 נכשלו
--
-- ו-22.10 אותה צורה: תקציר ב-10:25 ושני ב-14:20. המרווח היחיד בין הודעות היה
-- ‏`notif_push_gap_minutes` (‏10 דקות), שנועד לקיבוץ ולא לתקרה של Meta.
--
-- ‏התיקון: מחוץ לחלון 24 השעות (כלומר כשההודעה תצא כתבנית), ‏`notif_push_template_gap_minutes`
-- ‏(‏240) מאז התבנית הקודמת שיצאה. בתוכו - רק `notification_push_priority_types()`,
-- בדיוק כמו המרווח הקצר והתקרה. השאר אינו אובד: הוא מחכה ומצטרף לתבנית
-- הבאה (חלון המבט לאחור 12 שעות, ‏match_digest שלוש פעמים ביום). בתוך החלון
-- ההודעה היא טקסט חופשי, ש-Meta אינה סופרת כשיווק, ולכן אין שם שינוי.
--
-- ‏הגוף מועתק מ-20270420090000 (‏md5 של prosrc זהה לפרודקשן לפני השינוי:
-- ‏857a0bc44230632928250d613b898068). שלושה שינויים: ‏`tpl_gap` ב-cfg,
-- ‏`last_tpl_at` ב-recent, ו-`in_window` שעבר מה-select הסופי ל-agents כדי
-- שהתנאי יוכל להשתמש בו. העמודות שהפונקציה מחזירה לא השתנו.
--
-- אידמפוטנטית.
-- ============================================================================

insert into public.pricing_config (key, value, description)
values ('notif_push_template_gap_minutes', 240,
        'מרווח מינימלי בדקות בין שתי הודעות תבנית (מחוץ לחלון 24 השעות) לאותו/ה סוכן/ת. בתוכו יוצאים רק הסוגים שבעדיפות. נגד 131049 של Meta.')
on conflict (key) do nothing;

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
           -- מרווח בין תבניות - נגד 131049. ראו 20270822090000.
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_template_gap_minutes'), 240) as tpl_gap,
           -- עוקפים שקט. ראו סעיף 9 ב-20270125090000.
           array['agenda_reminder']::text[]                            as urgent,
           -- עוקפים מרווח ותקרה. ראו 20270420090000.
           public.notification_push_priority_types()                  as priority,
           public.notification_known_types()                          as known
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select t from unnest((select known from cfg)) t
              where t <> all (coalesce(np.whatsapp_off_types, '{}'::text[]))
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
           ) as fails24
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164, a.in_window,
           case
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to, a.quiet_days)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
               or coalesce(r.n24, 0) >= cfg.cap
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
  'סוכנים שמותר לשלוח להם עכשיו התראות בוואטסאפ, ואילו סוגים. שקט - רק agenda_reminder; מרווח, תקרה יומית, או תבנית קודמת לפני פחות מ-notif_push_template_gap_minutes מחוץ לחלון - רק notification_push_priority_types() (20270420090000, 20270822090000).';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;
