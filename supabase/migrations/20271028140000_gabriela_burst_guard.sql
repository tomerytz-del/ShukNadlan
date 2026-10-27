-- גבריאלה: שמירה מפני התפרצות וואטסאפ לסוכנים.
--
-- התקרות הקיימות (12 ביום, מרווח 10 דקות, פער תבנית 240, מבט 12/72
-- ו-quiet_hold) לא זזות. notification_push_due_agents לא מוחלפת.
-- המספרים מעל המקסימום שנמדד ב-30 הימים
-- שלפני 27.10.2026 (notification_push_log, whatsapp_status = sent):
--   הודעות: ממוצע 3.09 לסוכן ביום, מקסימום יום 18, שעה 7.
--   new_lead: יום 3, שעה 2. showcase_meeting: יום 2, שעה 2.
--   agenda_reminder: יום 12, שעה 4. system: יום 9, שעה 4.
--   שעה גלובלית: מקסימום 72, p95 כ-43.
--   התראות שנוצרו ב-15 דקות: p99 156, מקסימום 1855 (system).
-- יום רגיל לא מגיע לתקרות. מה שמעבר, אם אינו מוגן, נדחה לתקציר
-- הבא ("יש לך N התראות חדשות באתר") או מחכה בלי רישום skipped.
-- skipped נשמר לישן מ-12 שעות, למילוי, ולבקשת תמונות כפולה.
-- ליד אמיתי, סיור וסוג מוגן יוצאים בפרטים גם כשהמפסק דלוק.
-- notification_burst_guard_enabled = 0 מכבה מפסקים ותקרות בלי דיפלוי.
-- ישן, מילוי ובקשת תמונות נשארים גם כשהמתג כבוי.
--
-- דגל התקציר כבוי: quiet_hold נשאר. דגל דלוק: סוג שאינו דחוף מעל
-- 12 שעות לא יוצא לוואטסאפ, גם אם ההחזקה של 7 הימים שמרה אותו לפעמון.
-- שורת skipped נכתבת 25 שעות אחורה, כדי שלא תזיז מרווח ולא תיספר
-- בתקרה, וחוסמת לתמיד כדי ששינוי מבט לא יקים שורות ישנות.

insert into public.pricing_config (key, value, description) values
  ('notif_burst_hour_cap', 12, 'תקרת הודעות וואטסאפ לסוכן בשעה מתגלגלת, לכל סוג שאינו ליד אמיתי או סיור. מעל המקסימום שנמדד (7).'),
  ('notif_burst_day_cap', 30, 'תקרת הודעות וואטסאפ לסוכן ביממה מתגלגלת. מעל המקסימום שנמדד (18). התקרה של 12 ב-due_agents נשארת.'),
  ('notif_burst_lead_hour_cap', 20, 'תקרה שעתית נפרדת ל-new_lead שאינו בקשת תמונות. מעל המקסימום שנמדד (2).'),
  ('notif_burst_lead_day_cap', 40, 'תקרה יומית נפרדת ל-new_lead שאינו בקשת תמונות. מעל המקסימום שנמדד (3).'),
  ('notif_burst_showing_hour_cap', 20, 'תקרה שעתית נפרדת ל-showcase_meeting. מעל המקסימום שנמדד (2).'),
  ('notif_burst_showing_day_cap', 40, 'תקרה יומית נפרדת ל-showcase_meeting. מעל המקסימום שנמדד (2).'),
  ('notif_burst_stale_hours', 12, 'לא דוחפים לוואטסאפ התראה ישנה מזה, אלא אם היא דחופה ועדיין בחלון הדחוף.'),
  ('notif_burst_urgent_hours', 72, 'חלון לסוג דחוף (עדיפות, ומוגן כשהתקציר דלוק). מעבר לזה רק באתר.'),
  ('notif_burst_agent_pending', 30, 'מעל זה פריטים לא-מוגנים בהודעה: תקציר, ואחר כך דחייה. מוגן לא נספר ולא נבלע.'),
  ('notif_burst_created_minutes', 15, 'חלון הספירה. נספר רק מה שעדיין ממתין לדחיפה, בלי נקרא, בלי מילוי, בלי מוגן, ובלי שורה שכבר נרשמה.'),
  ('notif_burst_created_max', 300, 'מעל זה בחלון: מפסק גלובלי. לא מסמן skipped. מעל p99 (156) ומתחת לשיטפון 1855.'),
  ('notif_burst_global_hour', 130, 'מעל זה הודעות sent בשעה האחרונה, לכל הסוכנים: מפסק. בערך פי שלושה מ-p95, מעל המקסימום 72.'),
  ('notif_burst_max_items', 24, 'מעל זה פריטים בהודעה אחת: גוף קצר עם קישור לאתר, לא רשימה. מעל מקסימום יום שנמדד (18).'),
  ('notif_burst_scraped_stale_days', 14, 'ביקוש פתוח שפורסם לפני זה יוצא רק לאתר. יום 7 של מחזור החיים עדיין נדחף.'),
  ('notif_burst_breaker', 0, '1: מפסק גלובלי דלוק. יורד לבד כשהחלון חזר מתחת לסף, אלא אם notif_burst_manual_pause דלוק. לא מסמן skipped.'),
  ('notif_burst_manual_pause', 0, '1: מפסק גלובלי עד שמנהל/ת מאפס/ת. ליד אמיתי, סיור ומוגן עדיין יוצאים. השאר נדחה.'),
  ('notification_burst_guard_enabled', 1, '1: מפסקי ההתפרצות והתקרות פעילים. 0: הם כבויים בלי דיפלוי. ישן, מילוי ובקשת תמונות נשארים.')
on conflict (key) do nothing;

alter table public.notifications
  add column if not exists suppress_push boolean not null default false;

comment on column public.notifications.suppress_push is
  'true: ההתראה נשארת בפעמון ולא יוצאת לוואטסאפ. נקבע בטריגר כש-app.suppress_push דלוק, או ישירות ב-insert של מילוי חוזר.';

create index if not exists notifications_pushable_idx
  on public.notifications (agent_id, created_at)
  where not read and not suppress_push;

-- ---------------------------------------------------------------------------
-- דגל לטרנזקציה. מיגרציה וסקריפט מילוי קוראים לו לפני insert.
-- הוא לא שורד ל-cron מאוחר יותר: שם ההחלטה חייבת להיות עמודה.
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_suppress(p_on boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.suppress_push', case when coalesce(p_on, true) then 'on' else 'off' end, true);
end;
$$;

comment on function public.notification_push_suppress(boolean) is
  'set_config(app.suppress_push) לטרנזקציה הנוכחית בלבד. חובה לפני insert של התראות במיגרציה או בעדכון כיסוי. לא נשאר ל-cron.';

revoke all on function public.notification_push_suppress(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_suppress(boolean) to service_role;

alter table public.client_match_alerts
  add column if not exists push_site_only boolean not null default false;

comment on column public.client_match_alerts.push_site_only is
  'true: ההתאמה נכנסה ממילוי או משינוי כיסוי. סיכום שכולו כאלה לא יוצא לוואטסאפ. התאמה חיה נשארת false וכן יוצאת.';

alter table public.scraped_leads
  add column if not exists push_site_only boolean not null default false;

comment on column public.scraped_leads.push_site_only is
  'true: ההתראה על הביקוש נשארת באתר. מיגרציית מיפוי מחדש קוראת ל-scraped_leads_mark_remap. לא מעדכנים כאן שורות קיימות.';

create or replace function public.notifications_suppress_on()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.suppress_push', true), '') in ('on', 'true', '1');
$$;

comment on function public.notifications_suppress_on() is
  'האם הטרנזקציה הנוכחית ביקשה לא לדחוף לוואטסאפ. current_setting עם missing_ok.';

revoke all on function public.notifications_suppress_on() from public, anon, authenticated;
grant execute on function public.notifications_suppress_on() to service_role;

create or replace function public.notifications_stamp_suppress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
begin
  if public.notifications_suppress_on() then
    new.suppress_push := true;
  end if;

  -- סיכום התאמות: אם כל ההתאמות בחלון סומנו לאתר, גם הסיכום לא יוצא.
  -- התאמה אחת חיה (push_site_only = false) משאירה את הסיכום כרגיל.
  if new.type = 'match_digest' and not new.suppress_push then
    select d.last_sent_at into v_from
      from public.agent_match_digest d
     where d.agent_id = new.agent_id;
    -- בלי שורת סיכום, או last_sent_at ריק: כל ההתאמות הן החלון.
    -- אחרת מילוי לסוכן/ת שמעולם לא קיבל/ה סיכום יוצא לוואטסאפ.
    if exists (
         select 1 from public.client_match_alerts a
          where a.agent_id = new.agent_id
            and (v_from is null or a.created_at > v_from)
            and a.status <> 'dismissed')
       and not exists (
         select 1 from public.client_match_alerts a
          where a.agent_id = new.agent_id
            and (v_from is null or a.created_at > v_from)
            and a.status <> 'dismissed'
            and not a.push_site_only)
    then
      new.suppress_push := true;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.notifications_stamp_suppress() is
  'לפני insert: app.suppress_push מדליק suppress_push. סיכום התאמות שכולו ממילוי נשאר באתר.';

revoke all on function public.notifications_stamp_suppress() from public, anon, authenticated;

drop trigger if exists notifications_stamp_suppress on public.notifications;
create trigger notifications_stamp_suppress
  before insert on public.notifications
  for each row execute function public.notifications_stamp_suppress();

create or replace function public.client_match_alerts_stamp_suppress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.notifications_suppress_on() then
    new.push_site_only := true;
  end if;
  return new;
end;
$$;

comment on function public.client_match_alerts_stamp_suppress() is
  'התאמה שנוצרה בזמן app.suppress_push מסומנת לאתר. ה-cron של הסיכום קורא את העמודה, לא את הדגל.';

revoke all on function public.client_match_alerts_stamp_suppress() from public, anon, authenticated;

drop trigger if exists client_match_alerts_stamp_suppress on public.client_match_alerts;
create trigger client_match_alerts_stamp_suppress
  before insert on public.client_match_alerts
  for each row execute function public.client_match_alerts_stamp_suppress();

-- ---------------------------------------------------------------------------
-- ביקוש פתוח. הגוף זהה ל-20270823090000, עם סימון לאתר.
-- פוסט בן פחות מ-14 יום (כולל היום השביעי של scraped_leads_lifecycle)
-- עדיין נדחף. ישן יותר, או push_site_only, נשאר באתר.
-- agent_works_city לא מוחלפת: נקראת כמו שהיא אחרי 20271028090000.
-- ---------------------------------------------------------------------------
create or replace function public.scraped_lead_notify_demand(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.scraped_leads%rowtype;
  v_title text;
  v_body  text;
  v_n     int;
  v_days  int := greatest(1, coalesce(
            (select value::int from public.pricing_config
              where key = 'notif_burst_scraped_stale_days'), 14));
  v_site  boolean;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.claimed_by is not null
     or not public.scraped_lead_is_demand(r.status, r.lead_type, r.no_broker, r.posted_at, r.city_id) then
    return 0;
  end if;

  v_site := coalesce(r.push_site_only, false)
    or (r.posted_at is not null and r.posted_at < now() - make_interval(days => v_days))
    or public.notifications_suppress_on();

  v_title := 'ביקוש פתוח: '
    || case when r.lead_type = 'owner_inbound'
            then case r.deal_type when 'rent' then 'משכיר/ה' else 'מוכר/ת' end
            else case r.deal_type when 'rent' then 'מחפש/ת לשכור' else 'מחפש/ת לקנות' end end
    || ' ב' || r.city;
  v_body := concat_ws(' · ', r.property_type,
                      case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
                      case when r.budget is not null
                           then case when r.lead_type = 'owner_inbound' then '₪' else 'עד ₪' end
                                || to_char(r.budget, 'FM999,999,999') end,
                      case when r.move_in is not null then 'כניסה: ' || r.move_in end,
                      case when r.no_broker is not null then 'כתבו ללא תיווך' end)
    || '. חינם, לסוכן/ת הראשון/ה שלוחץ/ת "אני פונה". אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.';

  insert into public.notifications (agent_id, type, title, body, suppress_push)
  select m.id, 'open_demand', v_title, left(v_body, 500), v_site
    from public.agency_members m
   where m.active and public.agent_works_city(m.id, r.city_id)
     and public.agent_handles_type(m.id, r.property_type, r.deal_type);
  get diagnostics v_n = row_count;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;

comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand לכל סוכן/ת בעיר ובסוג, פעם אחת לפוסט. פוסט ישן מ-14 יום או push_site_only נשאר באתר. docs/scraped-leads.md';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

-- לא רצה לבד. מיגרציה שממפה עיר מחדש קוראת לה, ואז ה-cron לא דוחף ישנים.
-- לא מסמנת פוסט צעיר מ-14 יום, כדי שיום 7 של הביקוש הפתוח יישאר דחיפה.
create or replace function public.scraped_leads_mark_remap()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int := greatest(1, coalesce(
            (select value::int from public.pricing_config
              where key = 'notif_burst_scraped_stale_days'), 14));
  v_n int;
begin
  update public.scraped_leads
     set push_site_only = true
   where demand_notified_at is null
     and posted_at is not null
     and posted_at < now() - make_interval(days => v_days)
     and status in ('pending_consent', 'open_demand')
     and not coalesce(push_site_only, false);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.scraped_leads_mark_remap() is
  'מסמנת ביקוש שטרם הופץ וישן מ-14 יום כאתר בלבד. קוראים לה ממיגרציית מיפוי עיר. לא רצה במיגרציה הזו.';

revoke all on function public.scraped_leads_mark_remap() from public, anon, authenticated;
grant execute on function public.scraped_leads_mark_remap() to service_role;

-- ליד אמיתי, סיור, ותזכורת/אבטחה/תקציב/ops. בקשת תמונות אינה מוגנת:
-- new_lead עם source = photo_request נשאר בתקרה הכללית.
create or replace function public.notification_push_burst_exempt(p_type text, p_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.notification_push_less_kept(p_type)
     and not (p_type = 'new_lead' and p_source is not distinct from 'photo_request');
$$;

comment on function public.notification_push_burst_exempt(text, text) is
  'יוצא בפרטים מלאים גם במפסק וגם מעל התקרה הכללית. לא נבלע בתקציר "יש לך N". בקשת תמונות לא כלולה.';

revoke all on function public.notification_push_burst_exempt(text, text) from public, anon, authenticated;
grant execute on function public.notification_push_burst_exempt(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- הכנה לפני claim: ישן, מילוי, בקשת תמונות, ומפסק.
-- skipped רק לישן, למילוי, ולבקשת תמונות כפולה. מפסק דוחה, לא מוחק.
-- לא מסמנת read. skipped נכתב 25 שעות אחורה.
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_burst_prepare()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale     int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_stale_hours'), 12));
  v_urgent    int := greatest(v_stale, coalesce((select value::int from public.pricing_config where key = 'notif_burst_urgent_hours'), 72));
  v_created_min int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_created_minutes'), 15));
  v_created_max int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_created_max'), 300));
  v_global_max  int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_global_hour'), 130));
  v_digest_on int := coalesce((select value::int from public.pricing_config where key = 'notif_digest_enabled'), 0);
  v_manual    int := coalesce((select value::int from public.pricing_config where key = 'notif_burst_manual_pause'), 0);
  v_guard     int := coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 1);
  v_prio      text[] := public.notification_push_priority_types();
  v_created   int;
  v_sends     int;
  v_global    boolean;
  v_reason    text;
begin
  perform pg_advisory_xact_lock(hashtext('notification_push_claim'));
  perform public.notification_push_reconcile();

  -- מילוי: לא יוצא, ולא קם אחר כך.
  insert into public.notification_push_log
    (agent_id, notification_ids, types, channel_mode, whatsapp_status, last_error, created_at)
  select n.agent_id, array_agg(n.id), array_agg(distinct n.type), 'text', 'skipped',
         'suppress_push; site only', now() - interval '25 hours'
    from public.notifications n
   where not n.read
     and n.suppress_push
     and not exists (
       select 1 from public.notification_push_log l
        where l.agent_id = n.agent_id
          and n.id = any(l.notification_ids)
          and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
   group by n.agent_id;

  -- ישן מחוץ לחלון. דגל כבוי: quiet_hold לא נסגר. דחוף נשאר עד urgent.
  insert into public.notification_push_log
    (agent_id, notification_ids, types, channel_mode, whatsapp_status, last_error, created_at)
  select n.agent_id, array_agg(n.id), array_agg(distinct n.type), 'text', 'skipped',
         'stale; site only', now() - interval '25 hours'
    from public.notifications n
   where not n.read
     and not n.suppress_push
     and n.created_at <= now() - make_interval(hours => v_stale)
     and not (n.type = any(v_prio) and n.created_at > now() - make_interval(hours => v_urgent))
     and not (v_digest_on = 1 and public.notification_push_less_kept(n.type)
              and n.created_at > now() - make_interval(hours => v_urgent))
     and not (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
     and not exists (
       select 1 from public.notification_push_log l
        where l.agent_id = n.agent_id
          and n.id = any(l.notification_ids)
          and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
   group by n.agent_id;

  -- בקשת תמונות: אחת לנכס ביממה. החדשה נשארת. לא נוגעים ב-notify_agent_on_new_lead.
  insert into public.notification_push_log
    (agent_id, notification_ids, types, channel_mode, whatsapp_status, last_error, created_at)
  select n.agent_id, array_agg(n.id), array_agg(distinct n.type), 'text', 'skipped',
         'photo_request extra; one whatsapp per property per day', now() - interval '25 hours'
    from public.notifications n
    join public.leads l on l.id = n.related_lead_id
   where not n.read
     and not n.suppress_push
     and n.type = 'new_lead'
     and l.source = 'photo_request'
     and l.property_id is not null
     and not exists (
       select 1 from public.notification_push_log lg
        where lg.agent_id = n.agent_id
          and n.id = any(lg.notification_ids)
          and public.notification_push_log_holds(lg.whatsapp_status, lg.created_at))
     and (
       exists (
         select 1
           from public.notification_push_log lg
           join public.notifications n2 on n2.id = any(lg.notification_ids)
           join public.leads l2 on l2.id = n2.related_lead_id
          where lg.agent_id = n.agent_id
            and lg.created_at > now() - interval '24 hours'
            and public.notification_push_log_holds(lg.whatsapp_status, lg.created_at)
            and l2.source = 'photo_request'
            and l2.property_id = l.property_id
            and n2.id <> n.id)
       or exists (
         select 1
           from public.notifications n3
           join public.leads l3 on l3.id = n3.related_lead_id
          where n3.agent_id = n.agent_id
            and not n3.read
            and not n3.suppress_push
            and n3.type = 'new_lead'
            and l3.source = 'photo_request'
            and l3.property_id = l.property_id
            and (n3.created_at, n3.id) > (n.created_at, n.id)
            and not exists (
              select 1 from public.notification_push_log lg
               where lg.agent_id = n3.agent_id
                 and n3.id = any(lg.notification_ids)
                 and public.notification_push_log_holds(lg.whatsapp_status, lg.created_at)))
     )
   group by n.agent_id;

  -- המתג מכבה רק את המפסק. ישן, מילוי ובקשת תמונות כבר נרשמו למעלה.
  if v_guard = 0 then
    update public.pricing_config set value = 0
     where key = 'notif_burst_breaker' and value is distinct from 0;
    return;
  end if;

  -- רק מה שעדיין ממתין לדחיפה. נקרא, מילוי, שורה שכבר נרשמה, ומוגן
  -- (ליד אמיתי, סיור, תזכורת, אבטחה) לא נספרים. שיטפון system שכבר
  -- סומן לא ממשיך להחזיק את המפסק.
  select count(*) into v_created
    from public.notifications n
    left join public.leads ld on ld.id = n.related_lead_id
   where n.created_at > now() - make_interval(mins => v_created_min)
     and not n.read
     and not n.suppress_push
     and not public.notification_push_burst_exempt(n.type, ld.source)
     and not exists (
       select 1 from public.notification_push_log l
        where l.agent_id = n.agent_id
          and n.id = any(l.notification_ids)
          and public.notification_push_log_holds(l.whatsapp_status, l.created_at));

  select count(*) into v_sends
    from public.notification_push_log l
   where l.whatsapp_status = 'sent'
     and l.created_at > now() - interval '1 hour';

  v_global := v_manual = 1 or v_created > v_created_max or v_sends > v_global_max;

  -- אין כאן skipped. claim דוחה את הלא-מוגן כל עוד המפסק דלוק,
  -- ומשחרר אותו לתקציר כשהחלון יורד. מוגן יוצא גם באמצע.
  if v_global then
    update public.pricing_config set value = 1 where key = 'notif_burst_breaker' and value is distinct from 1;
    v_reason := case
      when v_manual = 1 then 'השהיה ידנית'
      when v_created > v_created_max then 'נוצרו ' || v_created || ' התראות ב-' || v_created_min || ' הדקות האחרונות'
      else 'נשלחו ' || v_sends || ' הודעות בשעה האחרונה'
    end;
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select m.id,
           'ops_alert',
           'וואטסאפ לסוכנים הושהה',
           left(coalesce(v_reason, 'עומס חריג') || '. לידים, סיורים והתראות דחופות עדיין יוצאים. השאר נשאר באתר עד שהתור יורד, ואז יוצא תקציר. השהיה ידנית: notif_burst_manual_pause.', 400),
           false
      from public.agency_members m
     where m.is_platform_admin = true
       and m.active = true
       and not exists (
         select 1 from public.notifications n
          where n.type = 'ops_alert'
            and n.title = 'וואטסאפ לסוכנים הושהה'
            and not n.read
            and n.created_at > now() - interval '6 hours');
  elsif v_manual = 0 then
    update public.pricing_config set value = 0 where key = 'notif_burst_breaker' and value is distinct from 0;
  end if;
end;
$$;

comment on function public.notification_push_burst_prepare() is
  'לפני שליחה: ישן ומילוי ובקשת תמונות כפולה נרשמים skipped. מפסק גלובלי לא רושם skipped: הלא-מוגן נדחה, ומוגן יוצא. ops_alert יוצא למנהלים בוואטסאפ. לא מסמן read.';

revoke all on function public.notification_push_burst_prepare() from public, anon, authenticated;
grant execute on function public.notification_push_burst_prepare() to service_role;

-- אותו claim כמו 20271028120000, עם ההכנה, בלי חלון של 7 ימים לוואטסאפ,
-- ותקרת התפרצות מעל תקרת 12 של due_agents.
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
  v_digest_on int := coalesce((select value::int from public.pricing_config
                                where key = 'notif_digest_enabled'), 0);
  v_digest  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_ambient_digest_minutes'), 180);
  v_wake    boolean;
  v_stale   int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_stale_hours'), 12));
  v_urgent  int := greatest(v_stale, coalesce((select value::int from public.pricing_config where key = 'notif_burst_urgent_hours'), 72));
  v_max_items int := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_max_items'), 24));
  v_hour_cap int;
  v_day_cap int;
  v_sent_hour int;
  v_sent_day int;
  v_all_lead boolean;
  v_all_showing boolean;
  v_over boolean;
  v_digest_sent boolean;
  v_guard int;
  v_manual int;
  v_breaker int;
  v_pending_max int;
  v_pause boolean;
  v_ex_items jsonb;
  v_ex_ids uuid[];
  v_ex_types text[];
  v_gen_ids uuid[];
  v_gen_types text[];
  v_gen_n int;
  v_agent_hot boolean;
  v_too_many boolean;
  v_hold_general boolean;
  v_lane_over boolean;
begin
  perform public.notification_push_burst_prepare();

  select coalesce((select value::int from public.pricing_config where key = 'notification_burst_guard_enabled'), 1),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_manual_pause'), 0),
         coalesce((select value::int from public.pricing_config where key = 'notif_burst_breaker'), 0),
         greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_agent_pending'), 30))
    into v_guard, v_manual, v_breaker, v_pending_max;
  v_pause := v_guard = 1 and (v_manual = 1 or v_breaker = 1);

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(s.item order by s.created_at desc),
           array_agg(s.id order by s.created_at desc),
           array_agg(distinct s.type),
           bool_or(s.wake_part),
           jsonb_agg(s.item order by s.created_at desc) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where s.exempt),
           array_agg(distinct s.type) filter (where s.exempt),
           array_agg(s.id order by s.created_at desc) filter (where not s.exempt),
           array_agg(distinct s.type) filter (where not s.exempt),
           (count(*) filter (where not s.exempt))::int
      into v_items, v_ids, v_types, v_wake,
           v_ex_items, v_ex_ids, v_ex_types,
           v_gen_ids, v_gen_types, v_gen_n
      from (
        select n.id, n.type, n.created_at,
               public.notification_push_burst_exempt(n.type, ld.source) as exempt,
               (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                 or n.created_at <= now() - make_interval(mins => v_digest)) as wake_part,
               jsonb_build_object(
                 'type',        n.type,
                 'title',       n.title,
                 'body',        n.body,
                 'source',      ld.source,
                 'property_id', n.related_property_id,
                 'client_id',   coalesce(n.related_client_id,
                                         (select sc.client_id from public.client_showcases sc
                                           where sc.id = n.related_showcase_id)),
                 'lead_id',     n.related_lead_id,
                 'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                     from public.properties p where p.id = n.related_property_id),
                 'agenda_item_id', n.related_agenda_item_id,
                 'agreement_id',  n.related_agreement_id,
                 'meeting_id',    n.related_meeting_id,
                 'review_id', (select rv.id from public.reviews rv
                                where rv.id = n.related_review_id and rv.status = 'pending'
                                  and rv.agent_id is distinct from n.agent_id),
                 'review_agent_slug', (select m.slug from public.reviews rv
                                         join public.agency_members m on m.id = rv.agent_id
                                        where rv.id = n.related_review_id and rv.status = 'published')
               ) as item
          from public.notifications n
          left join public.leads ld on ld.id = n.related_lead_id
         where n.agent_id = a.agent_id
           and not n.read
           and not n.suppress_push
           and n.type = any(a.whatsapp_types)
           and (n.created_at > now() - make_interval(hours =>
                  case
                    when n.type = any(v_prio) then least(v_look_p, v_urgent)
                    when v_digest_on = 1 and public.notification_push_less_kept(n.type) then least(v_look_p, v_urgent)
                    else least(v_look, v_stale)
                  end)
                or (v_digest_on = 0 and public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at)))
           and not exists (
             select 1 from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any(l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
           and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
      ) s;

    continue when v_items is null or not v_wake;

    -- מתג כבוי: אותה הודעה כמו בלי תקרת ההתפרצות. ישן ומילוי כבר סוננו בהכנה.
    if v_guard = 1 then
      v_hour_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_hour_cap'), 12));
      v_day_cap := greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_day_cap'), 30));

      select count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*) filter (where l.created_at > now() - interval '1 day')
        into v_sent_hour, v_sent_day
        from public.notification_push_log l
       where l.agent_id = a.agent_id
         and l.whatsapp_status = 'sent';

      v_over := v_sent_hour >= v_hour_cap or v_sent_day >= v_day_cap;
      v_digest_sent := exists (
        select 1 from public.notification_push_log l
         where l.agent_id = a.agent_id
           and l.created_at > now() - interval '1 hour'
           and l.whatsapp_status in ('sent', 'pending')
           and 'burst_digest' = any(l.types));
      v_agent_hot := coalesce(v_gen_n, 0) > v_pending_max;
      v_too_many := coalesce(v_gen_n, 0) > v_max_items;
      v_hold_general := v_agent_hot or v_over or v_too_many;

      v_all_lead := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'new_lead');
      v_all_showing := coalesce(array_length(v_ex_ids, 1), 0) > 0
        and coalesce(v_gen_n, 0) = 0
        and not exists (select 1 from unnest(v_ex_types) t where t is distinct from 'showcase_meeting');
      v_lane_over := false;
      if v_all_lead then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_lead_day_cap'), 40));
      elsif v_all_showing then
        v_lane_over := v_sent_hour >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_hour_cap'), 20))
          or v_sent_day >= greatest(1, coalesce((select value::int from public.pricing_config where key = 'notif_burst_showing_day_cap'), 40));
      end if;

      -- מפסק: ליד אמיתי ומוגן יוצאים בפרטים. בלי מוגן אין שליחה, ואין skipped.
      if v_pause then
        if coalesce(array_length(v_ex_ids, 1), 0) = 0 then
          continue;
        end if;
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_lane_over then
        -- תקרת המסלול של ליד או סיור: נדחה, לא תקציר ולא skipped.
        continue;
      elsif v_hold_general and coalesce(array_length(v_ex_ids, 1), 0) > 0 then
        -- ערבוב: המוגן יוצא עכשיו בפרטים. השאר מחכה לתקציר, בלי להירשם.
        v_items := v_ex_items;
        v_ids := v_ex_ids;
        v_types := v_ex_types;
      elsif v_hold_general and v_digest_sent then
        -- overflow_defer: מחכה לתקציר הבא. לא skipped.
        continue;
      elsif v_hold_general then
        v_items := jsonb_build_array(jsonb_build_object(
          'type', 'burst_digest',
          'title', 'יש לך ' || coalesce(v_gen_n, 0) || ' התראות חדשות באתר',
          'body', null,
          'count', coalesce(v_gen_n, 0)));
        v_ids := v_gen_ids;
        v_types := coalesce(v_gen_types, '{}') || array['burst_digest'];
      end if;
    end if;

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
  'אחרי notification_push_burst_prepare. מתג כבוי: בלי מפסק ובלי תקרת התפרצות. מתג דלוק: מוגן יוצא בפרטים גם במפסק. גלישה של לא-מוגן נדחית לתקציר הבא, בלי skipped. skipped נשאר לישן.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

-- תמונת מצב לקריאה. שורת _breaker תמיד שם, גם כשאין תור.
create or replace view public.notification_push_burst_status
  with (security_invoker = true) as
select n.agent_id,
       case
         when n.created_at > now() - interval '1 hour' then '0-1h'
         when n.created_at > now() - interval '12 hours' then '1-12h'
         when n.created_at > now() - interval '72 hours' then '12-72h'
         else 'older'
       end as age_bucket,
       count(*)::int as pending_pushable,
       coalesce((select c.value::int from public.pricing_config c where c.key = 'notif_burst_breaker'), 0) as breaker,
       coalesce((select c.value::int from public.pricing_config c where c.key = 'notif_burst_manual_pause'), 0) as manual_pause
  from public.notifications n
 where not n.read
   and not n.suppress_push
   and not exists (
     select 1 from public.notification_push_log l
      where l.agent_id = n.agent_id
        and n.id = any(l.notification_ids)
        and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
 group by n.agent_id, 2
union all
select null::uuid,
       '_breaker',
       0,
       coalesce((select c.value::int from public.pricing_config c where c.key = 'notif_burst_breaker'), 0),
       coalesce((select c.value::int from public.pricing_config c where c.key = 'notif_burst_manual_pause'), 0);

comment on view public.notification_push_burst_status is
  'תור שנשאר לדחיפה, לפי סוכן/ת וגיל, ומצב המפסק. קריאה בלבד ל-service_role.';

revoke all on table public.notification_push_burst_status from public, anon, authenticated;
grant select on table public.notification_push_burst_status to service_role;

-- מלאי המחוללים (התיעוד המלא ב-docs/notifications-center.md):
-- scraped_lead_notify_demand / scraped_leads_lifecycle: push_site_only וגיל posted_at.
-- share_property_for_agent: הטריגר על notifications, אחרי notification_push_suppress.
-- generate_client_match_alerts + client_match_digest_run: push_site_only על ההתאמה.
-- notify_agent_on_new_lead: לא הוחלפה. photo_request מטופל ב-prepare.
-- property_offers_claim: תקרה קיימת (4 ביממה), לא עובר ב-notifications.
-- רילס יומי: עד 3 ביום ושעות שקט, בלי שינוי כאן.
-- security_alert / budget_alert / ops_alert: מוגנים. יוצאים בפרטים, לא נבלעים בתקציר ולא נספרים במפסק.
