-- ---------------------------------------------------------------------------
-- התראות בוואטסאפ: בקשת סיור, ליד ותזכורת לא נחסמות בתקרה היומית
--
-- המקרה (11.10.2026): לקוח ביקש במיניסייט סיור ב-13:10, ההתראה נכתבה לפעמון
-- תוך שנייה - ובוואטסאפ לא יצאה לעולם. הסוכן קיבל 12 הודעות בין 09:00 ל-12:10
-- (חמש מהן "מתווך/ת חדש/ה" למנהל הפלטפורמה), ‏`notif_push_max_per_day = 12`
-- הוציא אותו מ-`notification_push_due_agents` לכל שאר היום, וב-01:10 ההתראה
-- יצאה מחלון 12 השעות (`notif_push_lookback_hours`) ונזרקה. אותו דבר קרה
-- לשתי תזכורות "לחזור לליד חדש" באותו אחר צהריים: ‏agenda_reminder עקף שקט
-- ומרווח, אבל לא את התקרה.
--
-- מה משתנה:
--
-- 1. סוג חדש, `showcase_meeting` - "הלקוח/ה מבקש/ת לתאם סיור". עד היום זה
--    היה `showcase_activity`, אותו סוג כמו "פתח/ה את המיניסייט", ולכן לא היה
--    אפשר לתת לו עדיפות בלי לתת אותה לכל פתיחה.
--
-- 2. ‏`notification_push_priority_types()` - סוגים שאדם מחכה בצד השני שלהם:
--    ‏agenda_reminder, ‏showcase_meeting, ‏new_lead. הם **לא נחסמים בתקרה
--    היומית ולא מחכים למרווח הקיבוץ**. שעות השקט חלות עליהם (חוץ מ-
--    agenda_reminder, כמו קודם): ליד בעשר בלילה ממתין לבוקר.
--    הם עדיין נספרים בתקרה, ולכן אינם מוסיפים מקום לסוגים הרגילים.
--
-- 3. חלון מבט לאחור ארוך יותר לסוגים האלה (`notif_push_priority_lookback_hours`,
--    ‏72): שקט משישי בתשע בערב עד ראשון בבוקר הוא 60 שעות, ובקשת סיור מחמישי
--    בלילה לא אמורה להיזרק לפני שהיא יוצאת.
--
-- 4. רקע: "נכס חדש שותף איתך" ו"מתווך/ת חדש/ה" (‏`notification_push_is_ambient`)
--    אינם מעירים שליחה לבד. הם יוצאים עם ההודעה הבאה שיש בה משהו אחר, ואם
--    אין כזו - כתקציר כשהוותיק/ה מביניהם מחכה שלוש שעות
--    (`notif_push_ambient_digest_minutes`). ב-11.10.2026 נכתבו 678 התראות
--    שיתוף, ו-15 סוכנים הגיעו לתקרה של 12 הודעות. בהודעה עצמה הם מתקפלים
--    לשורה אחת (‏arrange ב-notification-push).
--
-- ‏notification_push_due_agents מועתקת מ-20270412090000 (הגרסה עם
-- quiet_days), ‏notification_push_claim מ-20270321093000, ו-
-- notification_push_ready מ-20261101090000 - כולן אומתו מול הפרודקשן.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. הסוג החדש
-- ---------------------------------------------------------------------------
-- מוסיפה לרשימה שקיימת ברגע הריצה, ולא כותבת רשימה מלאה: PR מקביל
-- (‏#702, ‏security_alert) מחליף את אותו אילוץ, ורשימה קשיחה כאן הייתה מוחקת
-- את הסוג שלו - או נמחקת על ידו - לפי סדר המיזוג. נכתב בצורת `in ('..')`
-- כדי ש-notification_known_types() (שקורא את הסוגים מהגדרת האילוץ) ימשיך
-- לזהות אותם.
--
-- מכאן והלאה סוג התראה חדש נכנס **רק** דרך notification_types_add, ו-
-- scripts/check_notif_type_constraint.py חוסם ב-CI רשימה קשיחה במיגרציה חדשה.
create or replace function public.notification_types_add(p_types text[])
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_types text[] := public.notification_known_types();
  v_new   text[];
begin
  if coalesce(array_length(v_types, 1), 0) < 10 then
    raise exception 'notifications_type_check: לא נמצאה רשימת הסוגים הקיימת (%), לא מחליפים', v_types;
  end if;
  if exists (select 1 from unnest(p_types) t where t !~ '^[a-z0-9_]+$') then
    raise exception 'notification_types_add: שם סוג לא חוקי (%)', p_types;
  end if;
  v_new := array(select t from unnest(p_types) t where t <> all(v_types));
  if coalesce(array_length(v_new, 1), 0) = 0 then
    return v_types;
  end if;
  v_types := v_types || v_new;
  alter table public.notifications drop constraint if exists notifications_type_check;
  -- בצורת in ('..'): ‏notification_known_types() קוראת את הסוגים מהגדרת האילוץ
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ',' order by t) from unnest(v_types) t));
  return v_types;
end;
$$;

comment on function public.notification_types_add(text[]) is
  'מוסיפה סוגים ל-notifications_type_check בלי לגעת בקיימים. הדרך היחידה להוסיף סוג התראה במיגרציה (20270420090000) - רשימה קשיחה דורסת PR מקביל.';

revoke all on function public.notification_types_add(text[]) from public, anon, authenticated;

select public.notification_types_add(array['showcase_meeting']);

insert into public.pricing_config (key, value, description)
values ('notif_push_priority_lookback_hours', 72,
        'שעות שבהן התראה בעדיפות (סיור, ליד, תזכורת) עוד יכולה לצאת בוואטסאפ. לשאר: notif_push_lookback_hours.')
on conflict (key) do nothing;

insert into public.pricing_config (key, value, description)
values ('notif_push_ambient_digest_minutes', 180,
        'כמה דקות שיתוף נכס או נרשם/ת חדש/ה מחכים לבד לפני שיוצא עליהם תקציר בוואטסאפ. עד אז הם מצטרפים להודעה הבאה.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. הסוגים בעדיפות
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_priority_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['agenda_reminder', 'showcase_meeting', 'new_lead']::text[];
$$;

comment on function public.notification_push_priority_types() is
  'סוגי התראה שעוקפים בוואטסאפ את התקרה היומית ואת מרווח הקיבוץ, ונשמרים 72 שעות ולא 12 (20270420090000).';

revoke all on function public.notification_push_priority_types() from public, anon, authenticated;
grant execute on function public.notification_push_priority_types() to service_role;

-- ‏"של מי הנכס" - כמו property_mine ב-notification_push_claim. ‏system נושא
-- גם שיחה שהוקלטה, נכס שנמסר אליך בהפנייה ויומן Google; רק נכס של משרד אחר
-- הוא שיתוף.
create or replace function public.notification_push_is_ambient(p_type text, p_agent uuid, p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_type = 'platform_signup'
      or (p_type = 'system' and p_property is not null and exists (
            select 1 from public.properties p
             where p.id = p_property
               and p.agent_id is distinct from p_agent
               and p.referred_by is distinct from p_agent));
$$;

comment on function public.notification_push_is_ambient(text, uuid, uuid) is
  'התראת רקע (שיתוף נכס ממשרד אחר, נרשם/ת חדש/ה): לא מעירה שליחה בוואטסאפ לבד, אלא מצטרפת להודעה הבאה או לתקציר (20270420090000).';

revoke all on function public.notification_push_is_ambient(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.notification_push_is_ambient(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. מי מקבל/ת עכשיו, ואילו סוגים
--
-- השינוי מול 20270412090000: תקרה שהתמלאה כבר אינה מוציאה את הסוכן/ת מהרשימה.
-- היא מצמצמת את הסוגים לאלה שבעדיפות, בדיוק כמו שהמרווח עושה.
-- ---------------------------------------------------------------------------
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
           coalesce(rp.quiet_days, '{5,6}'::smallint[])     as quiet_days
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
    select a.id, a.display_name, a.phone_e164,
           case
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to, a.quiet_days)
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             when (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
               or coalesce(r.n24, 0) >= cfg.cap
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.priority))
             else a.whatsapp_types
           end as types,
           r.fails24, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  )
  select s.id, s.display_name, s.phone_e164, s.types,
         coalesce(
           (select c.last_message_at > now() - interval '23 hours'
              from public.whatsapp_conversations c
             where c.agent_id = s.id),
           false)
    from shaped s
   where coalesce(array_length(s.types, 1), 0) > 0
     and s.phone_e164 is not null
     and coalesce(s.fails24, 0) < s.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'סוכנים שמותר לשלוח להם עכשיו התראות בוואטסאפ, ואילו סוגים. שקט - רק agenda_reminder; מרווח או תקרה יומית - רק notification_push_priority_types() (20270420090000).';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 4. חלון המבט לאחור - לפי סוג
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_ready()
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
        where n.agent_id = a.agent_id
          and not n.read
          and n.type = any(a.whatsapp_types)
          and n.created_at > now() - make_interval(hours =>
                case when n.type = any(public.notification_push_priority_types())
                     then coalesce((select value::int from public.pricing_config
                                     where key = 'notif_push_priority_lookback_hours'), 72)
                     else coalesce((select value::int from public.pricing_config
                                     where key = 'notif_push_lookback_hours'), 12)
                end)
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids)
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
          -- רקע מעיר שליחה רק כשהוא מחכה מספיק זמן (תקציר)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
     )
  );
$$;

comment on function public.notification_push_ready() is
  'האם יש בכלל התראה שממתינה לשליחה בוואטסאפ. נקראת מה-cron לפני net.http_post. התנאי על היומן ועל חלון המבט לאחור זהה לזה של notification_push_claim.';

revoke all on function public.notification_push_ready() from public, anon, authenticated;
grant execute on function public.notification_push_ready() to service_role;

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
       and n.created_at > now() - make_interval(hours =>
             case when n.type = any(v_prio) then v_look_p else v_look end)
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at));

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
  'תופסת לכל סוכן/ת שמותר לשלוח לו/ה את כל ההתראות הפתוחות, ורושמת שורה ב-notification_push_log. חלון המבט לאחור ארוך יותר לסוגים שבעדיפות, והתראות רקע לבד יוצאות רק כתקציר (20270420090000).';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
