-- ============================================================================
-- התראה שיצאה פעמיים בוואטסאפ: נעילה ב-notification_push_claim
-- ----------------------------------------------------------------------------
-- ‏12.10.2026, 16:00: ארבעה סוכנים קיבלו את "פגישה בעוד שעה" פעמיים. בטבלת
-- ‏notifications הייתה שורה אחת; ב-notification_push_log שתיים, בהפרש 43ms.
--
-- ‏שלושה cron-ים קוראים ל-notification-push: ‏`notification-push` (כל 5 דקות),
-- ‏`agent-agenda-dispatch` ו-`showing-coord-briefs` (כל דקה, כשנוצר משהו). ב-13:00
-- הכללי והיומן נורו באותה שנייה, ושתי קריאות ל-claim רצו במקביל. ההגנה מפני
-- כפילות היא `not exists` על notification_push_log - והיא אינה רואה שורה של
-- טרנזקציה שעוד לא הסתיימה. כל אחת מהשתיים רשמה שורה ושלחה.
--
-- ‏התיקון: `pg_advisory_xact_lock` בראש הפונקציה. ‏claim היא טרנזקציה אחת (קריאת
-- ‏rpc), ולכן הנעילה מוחזקת עד שהשורות נרשמו, והקריאה השנייה ממתינה ואז רואה
-- אותן. ההמתנה קצרה - claim רק רושמת, השליחה עצמה בפונקציה ולא בנעילה.
--
-- ‏הגוף הועתק מ-20270422090000 (‏md5 של prosrc זהה לפרודקשן לפני השינוי), ונוספה
-- לו שורה אחת בלבד. מי שמגדיר/ה את הפונקציה מחדש - להעתיק מכאן, עם הנעילה.
-- ============================================================================

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
  'תופסת לכל סוכן/ת שמותר לשלוח לו/ה את כל ההתראות הפתוחות, ורושמת שורה ב-notification_push_log. חלון המבט לאחור ארוך יותר לסוגים שבעדיפות, התראות רקע לבד יוצאות רק כתקציר (20270420090000), ותזכורת ישנה מחכה לסוף שעות השקט (20270422090000). קריאה אחת בכל רגע, בנעילה (20270425090000).';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
