-- ============================================================================
-- התראה על רילס שנוצרה בשקט: לא פגה לפני שהשקט נגמר
-- ----------------------------------------------------------------------------
-- ‏notification_push_claim שולחת בוואטסאפ רק התראות מ-notif_push_lookback_hours
-- ‏(12) השעות האחרונות, והחלון נספר בשעון קיר. שעות השקט ממילא עוצרות כל סוג
-- שאינו agenda_reminder (notification_push_due_agents), ולכן התראה שנוצרה בשקט
-- מחכה - אבל החלון שלה ממשיך לרוץ. לילה (21:00-08:00) קצר מ-12 שעות ועובר;
-- יום שקט מלא אינו עובר. בברירת המחדל שישי ושבת שקטים, כלומר:
--
--   · הרילס היומי שנשמר (attach_daily_reel) בשישי או בשבת - לא הגיע לוואטסאפ
--     של הסוכן/ת בכלל, רק לפעמון.
--   · וכך גם רילס שנשמר בחמישי אחרי 21:00 (השקט נמשך עד ראשון 08:00).
--
-- ‏התיקון, לסוגים שב-notification_push_quiet_wait_types() בלבד (היום
-- ‏marketing_copy - הרילס היומי, הסרטון והתיאור השיווקי): החלון נספר רק בזמן
-- שאינו שקט לפי ההגדרות של הסוכן/ת. רילס של חמישי בלילה יוצא ביום ראשון ב-08:00,
-- והחלון של 12 השעות מתחיל משם. הכלל הקיים נשאר כמו שהוא (OR), ולכן אף התראה
-- שיצאה עד היום לא נחסמת. תקרה של 7 ימים, כדי שסוכן/ת עם שקט קבוע לא יקבל/תקבל
-- ערימה ישנה ביום שהשקט יבוטל.
--
-- ‏הגוף של notification_push_claim הועתק מ-20270425090000 (‏md5 של prosrc זהה
-- לפרודקשן לפני השינוי), ונוסף לו תנאי אחד בחלון. מי שמגדיר/ה אותה מחדש -
-- להעתיק מכאן.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. שקט ברגע נתון - כמו agent_reminder_quiet_now, אבל לכל זמן ולא רק עכשיו
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_quiet_at(
  p_at   timestamptz,
  p_from int,
  p_to   int,
  p_days smallint[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when p_from is null or p_to is null or p_from = p_to then false
           when p_from < p_to then h.h >= p_from and h.h < p_to
           else h.h >= p_from or h.h < p_to
         end
      or h.dow = any(coalesce(p_days, '{}'::smallint[]))
    from (select extract(hour from (p_at at time zone 'Asia/Jerusalem'))::int      as h,
                 extract(dow  from (p_at at time zone 'Asia/Jerusalem'))::smallint as dow) h;
$$;

comment on function public.agent_reminder_quiet_at(timestamptz, int, int, smallint[]) is
  'האם הרגע p_at בתוך שעות השקט או ביום שקט (שעון ישראל). אותה הגדרה כמו agent_reminder_quiet_now בת שלושת הפרמטרים (20270902090000).';

revoke all on function public.agent_reminder_quiet_at(timestamptz, int, int, smallint[]) from public, anon, authenticated;
grant execute on function public.agent_reminder_quiet_at(timestamptz, int, int, smallint[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. הסוגים שמחכים לסוף השקט
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_quiet_wait_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['marketing_copy']::text[];
$$;

comment on function public.notification_push_quiet_wait_types() is
  'סוגי התראה שהחלון שלהם בוואטסאפ נספר רק בזמן שאינו שקט (20270902090000).';

revoke all on function public.notification_push_quiet_wait_types() from public, anon, authenticated;
grant execute on function public.notification_push_quiet_wait_types() to service_role;

-- ---------------------------------------------------------------------------
-- 3. האם ההתראה עדיין בחלון, כשזמן השקט אינו נספר
--
-- ‏plpgsql ולא sql: הבדיקות הזולות (סוג, גיל) חייבות לרוץ לפני הספירה, והספירה
-- נעשית רק להתראה שכבר יצאה מהחלון הרגיל. דגימה כל 15 דקות - עד 672 נקודות
-- בשבוע, להתראה אחת.
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_quiet_hold(
  p_type    text,
  p_agent   uuid,
  p_created timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_look  int := coalesce((select value::int from public.pricing_config
                            where key = 'notif_push_lookback_hours'), 12);
  v_from  int;
  v_to    int;
  v_days  smallint[];
  v_awake int;
begin
  if p_type is null or not (p_type = any(public.notification_push_quiet_wait_types())) then
    return false;
  end if;
  if p_created is null or p_created <= now() - interval '7 days' then
    return false;
  end if;

  select coalesce(rp.quiet_from_hour, 21),
         coalesce(rp.quiet_to_hour, 8),
         coalesce(rp.quiet_days, '{5,6}'::smallint[])
    into v_from, v_to, v_days
    from (select 1) one
    left join public.agent_reminder_preferences rp on rp.agent_id = p_agent;

  select count(*) * 15
    into v_awake
    from generate_series(p_created, now(), interval '15 minutes') t
   where not public.agent_reminder_quiet_at(t, v_from, v_to, v_days);

  return v_awake < v_look * 60;
end;
$$;

comment on function public.notification_push_quiet_hold(text, uuid, timestamptz) is
  'התראה מסוג שב-notification_push_quiet_wait_types שעדיין בחלון notif_push_lookback_hours כשזמן השקט של הסוכן/ת אינו נספר. עד 7 ימים (20270902090000).';

revoke all on function public.notification_push_quiet_hold(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_quiet_hold(text, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. notification_push_claim - תנאי אחד נוסף בחלון
-- ---------------------------------------------------------------------------
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
  -- קריאה אחת בכל רגע (20270425090000). שלושה cron-ים קוראים ל-notification-push
  -- (הכללי כל 5 דקות, היומן וסיכומי הסיור כל דקה), וכשהם נפגשים באותה שנייה
  -- שתי קריאות רצו במקביל, אף אחת לא ראתה את שורת היומן של השנייה, ושתיהן
  -- שלחו. הנעילה משתחררת בסוף הטרנזקציה, והקריאה השנייה רואה את מה שנרשם.
  perform pg_advisory_xact_lock(hashtext('notification_push_claim'));

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
       and (n.created_at > now() - make_interval(hours =>
              case when n.type = any(v_prio) then v_look_p else v_look end)
            -- רילס ותוכן שיווקי שנוצרו בשקט מחכים לסוף השקט (20270902090000)
            or public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
       -- תזכורת ישנה אינה עוקפת שעות שקט: היא מחכה לבוקר (20270422090000)
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
  'תופסת לכל סוכן/ת שמותר לשלוח לו/ה את כל ההתראות הפתוחות, ורושמת שורה ב-notification_push_log. חלון המבט לאחור ארוך יותר לסוגים שבעדיפות, התראות רקע לבד יוצאות רק כתקציר (20270420090000), ותזכורת ישנה מחכה לסוף שעות השקט (20270422090000). קריאה אחת בכל רגע, בנעילה (20270425090000). ‏marketing_copy שנוצרה בשקט אינה פגה בו: החלון נספר רק בזמן שאינו שקט (20270902090000).';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
