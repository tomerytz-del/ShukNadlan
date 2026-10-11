-- ---------------------------------------------------------------------------
-- תזכורת מהיומן עוקפת שעות שקט רק כשהיא טרייה
--
-- ‏agenda_reminder יוצאת גם בשעות השקט, כי את השעה שלה הסוכן/ת קבע/ה בעצמו/ה
-- (סעיף 9 ב-20270125090000). הנימוק נכון לתזכורת שהגיע זמנה עכשיו, ולא
-- לתזכורת מלפני שעות שלא יצאה.
--
-- המקרה (12.10.2026, ‏02:05): ‏20270420090000 הפסיקה לחסום תזכורות בתקרה
-- היומית והאריכה את חלון המבט לאחור ל-72 שעות. שתי תזכורות "לחזור לליד חדש"
-- מ-12:38 ו-12:56 של אתמול, שהתקרה חסמה, יצאו בסבב הראשון אחרי המיגרציה -
-- בשתיים בלילה. אחרי המיגרציה ההיא תזכורת כמעט אינה מתעכבת, אבל כשל שליחה
-- או תקלה ב-cron יכולים עדיין להשאיר אחת כזו לשעות השקט.
--
-- מה משתנה: ‏`notification_push_stale_in_quiet()` - תזכורת שעוקפת שקט
-- (`agenda_reminder`) ונוצרה לפני יותר מ-`notif_push_urgent_fresh_minutes`
-- (‏30) דקות, אצל סוכן/ת שנמצא/ת עכשיו בשקט, אינה נלקחת. היא נשארת בתור
-- ויוצאת עם סוף השקט, בתוך חלון 72 השעות.
--
-- ‏notification_push_ready ו-notification_push_claim מועתקות מ-20270420090000
-- (אומתו מול הפרודקשן ב-md5), עם תנאי אחד נוסף בכל אחת.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

insert into public.pricing_config (key, value, description)
values ('notif_push_urgent_fresh_minutes', 30,
        'כמה דקות אחרי שנוצרה תזכורת מהיומן עוד יוצאת בשעות השקט. ישנה יותר מחכה לסוף השקט.')
on conflict (key) do nothing;

-- ‏השקט של הסוכן/ת - אותן ברירות מחדל כמו ב-notification_push_due_agents
-- (‏21→8, שישי-שבת), ואותה agent_reminder_quiet_now בת שלושת הפרמטרים.
create or replace function public.notification_push_stale_in_quiet(p_type text, p_agent uuid, p_created timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_type = 'agenda_reminder'
     and p_created < now() - make_interval(mins =>
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_urgent_fresh_minutes'), 30))
     and public.agent_reminder_quiet_now(
           coalesce(rp.quiet_from_hour, 21),
           coalesce(rp.quiet_to_hour, 8),
           coalesce(rp.quiet_days, '{5,6}'::smallint[]))
    from (select 1) one
    left join public.agent_reminder_preferences rp on rp.agent_id = p_agent;
$$;

comment on function public.notification_push_stale_in_quiet(text, uuid, timestamptz) is
  'תזכורת מהיומן שנוצרה לפני יותר מ-notif_push_urgent_fresh_minutes, אצל סוכן/ת שבשקט עכשיו: לא יוצאת בוואטסאפ עד סוף השקט (20270422090000).';

revoke all on function public.notification_push_stale_in_quiet(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_push_stale_in_quiet(text, uuid, timestamptz) to service_role;

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
          -- תזכורת ישנה אינה עוקפת שעות שקט (20270422090000)
          and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
          -- רקע מעיר שליחה רק כשהוא מחכה מספיק זמן (תקציר)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
     )
  );
$$;

comment on function public.notification_push_ready() is
  'האם יש בכלל התראה שממתינה לשליחה בוואטסאפ. נקראת מה-cron לפני net.http_post. התנאי על היומן, על חלון המבט לאחור ועל תזכורת ישנה בשעות השקט זהה לזה של notification_push_claim.';

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
  'תופסת לכל סוכן/ת שמותר לשלוח לו/ה את כל ההתראות הפתוחות, ורושמת שורה ב-notification_push_log. חלון המבט לאחור ארוך יותר לסוגים שבעדיפות, התראות רקע לבד יוצאות רק כתקציר (20270420090000), ותזכורת ישנה מחכה לסוף שעות השקט (20270422090000).';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
