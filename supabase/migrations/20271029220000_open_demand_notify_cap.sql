-- תקרת הפצה לביקוש פתוח. ברירת המחדל כבויה: scraped_lead_notify_demand
-- נשארת כמו 20271029140000 (כל סוכן/ת בעיר ובסוג, פוסט ישן או
-- push_site_only נשאר באתר).
--
-- עומדת לבד. הפרודקשן ב-20271028120000. notifications_suppress_on()
-- ו-scraped_leads.push_site_only נולדים ב-20271029140000 (#1025),
-- שעדיין לא שם. אם הם חסרים, הם נוצרים כאן. פונקציה שכבר קיימת
-- לא מוחלפת: כששני הקבצים בריפו, 20271029140000 רץ קודם והגוף שלו נשמר.
-- הקריאה בודקת to_regprocedure ודולגת על ההשתקה אם הפונקציה חסרה,
-- כדי ש-scraped_leads_lifecycle לא ייפול על פוסט אחד.
--
-- כש-open_demand_notify_cap_enabled = 1, כל פוסט יוצא לעד
-- open_demand_notify_cap סוכנים (ברירת מחדל 8, הטווח שביקשנו 8-10).
-- הרלוונטיות נשארת agent_works_city ו-agent_handles_type.
--
-- מי קודם: מי שלא תפס/ה ליד בחלון (open_demand_pull_lookback_days,
-- ברירת מחדל 14). האות הוא מעשה של הסוכן/ת, לא שיוך שהמערכת עשתה:
--   * leads.unlocked_by + unlocked_at, רק כשהפתיחה מאוחרת ביותר
--     משנייה מ-created_at (claim_lead). ליד שנולד unlocked אינו תפיסה.
--   * scraped_leads.claimed_by + claimed_at ("אני פונה").
-- agent_clients.lead_source ריק כמעט תמיד, ואין בו חותמת תפיסה, ולכן
-- הוא לא האות. leads.agent_id לבד הוא שיוך, לא משיכה.
-- תפיסה ישנה מהחלון נספרת כמו אין תפיסה: מי שלא תפס/ה מעולם ומי
-- שתפס/ה לפני החלון באותה קבוצה, והיא ראשונה.
-- שובר שוויון: התראת open_demand האחרונה, הישנה קודם (null קודם),
-- ואחר כך random() רק כששני אלה שווים.
--
-- נשארים מחוץ לבחירה, כמו היום, וחלים על מי שנבחר:
--   שעות שקט וימי שקט, whatsapp_off, "פחות כאלה", ומסלול/חיוב/מספר
--   ב-notification_push_due_agents. שמירת ההתפרצות (#1025) לא מוחלפת:
--   open_demand אינו מוגן, ו-suppress_push של פוסט ישן נשאר.
-- בבחירה עצמה, רק כשהדגל דלוק, כדי לא לבזבז מקום בתקרה:
--   released_at (נותק/ה מהמשרד), license_status not_found או inactive,
--   והשתקה של הפעמון (notification_type_enabled). כשהדגל כבוי ההשתקה
--   עדיין מורידה שורה בטריגר, בלי שהתקרה תיכנס.
-- הלשונית "ביקוש פתוח" לא משתנה: מי שלא נבחר/ה עדיין רואה את הפוסט.

insert into public.pricing_config (key, value, description) values
  ('open_demand_notify_cap_enabled', 0,
   '1: ביקוש פתוח נשלח לעד open_demand_notify_cap סוכנים. 0: לכל מי שעובד/ת בעיר ובסוג, כמו היום.'),
  ('open_demand_notify_cap', 8,
   'כמה סוכנים מקבלים התראה על פוסט אחד כשהתקרה דלוקה. 8 הוא הקצה הנמוך של 8-10. מעל 80 נחתך ל-80, ו-0 הופך ל-1. הכיבוי הוא הדגל, לא האפס.'),
  ('open_demand_pull_lookback_days', 14,
   'חלון בימים: תפיסת ליד (claim_lead) או "אני פונה" בתוכו מורידה את הסוכן/ת מתחילת הדירוג. 1 עד 90.')
on conflict (key) do nothing;

create table if not exists public.open_demand_notify_log (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  scraped_lead_id   uuid not null,
  agent_id          uuid not null,
  rank              int not null,
  reason            text not null,
  last_pull_at      timestamptz,
  last_notified_at  timestamptz,
  cap               int not null,
  lookback_days     int not null,
  constraint open_demand_notify_log_reason_chk
    check (reason in ('no_pull', 'recent_pull')),
  constraint open_demand_notify_log_rank_chk
    check (rank >= 1)
);

comment on table public.open_demand_notify_log is
  'מי נבחר/ה להתראת ביקוש פתוח כשהתקרה דלוקה, ולמה. בלי שם ובלי טלפון. אין מפתח זר: מחיקת הפוסט לא מוחקת את המדידה.';

comment on column public.open_demand_notify_log.reason is
  'no_pull: אין claim_lead ואין "אני פונה" בחלון. recent_pull: יש, ועדיין נבחר/ה כי הקבוצה בלי תפיסה לא מילאה את התקרה.';

create index if not exists open_demand_notify_log_post_idx
  on public.open_demand_notify_log (scraped_lead_id, rank);
create index if not exists open_demand_notify_log_created_idx
  on public.open_demand_notify_log (created_at desc);

alter table public.open_demand_notify_log enable row level security;
revoke all on table public.open_demand_notify_log from public, anon, authenticated;
grant select, insert, update, delete on table public.open_demand_notify_log to service_role;

-- אותה עמודה כמו ב-20271029140000. בלי זה r.push_site_only מפיל את
-- scraped_lead_notify_demand, ו-scraped_leads_lifecycle נופל על הפוסט.
alter table public.scraped_leads
  add column if not exists push_site_only boolean not null default false;

comment on column public.scraped_leads.push_site_only is
  'true: ההתראה על הביקוש נשארת באתר. מיגרציית מיפוי מחדש קוראת ל-scraped_leads_mark_remap. לא מעדכנים כאן שורות קיימות.';

-- אותו גוף כמו ב-20271029140000, ורק אם הוא עדיין לא קיים.
-- create or replace היה דורס את #1025 כשהקובץ הזה רץ אחריו.
do $$
begin
  if pg_catalog.to_regprocedure('public.notifications_suppress_on()') is null then
    execute $fn$
      create function public.notifications_suppress_on()
      returns boolean
      language sql
      stable
      set search_path = ''
      as $body$
        select coalesce(current_setting('app.suppress_push', true), '') in ('on', 'true', '1');
      $body$
    $fn$;
  end if;
end $$;

comment on function public.notifications_suppress_on() is
  'האם הטרנזקציה הנוכחית ביקשה לא לדחוף לוואטסאפ. current_setting עם missing_ok.';

revoke all on function public.notifications_suppress_on() from public, anon, authenticated;
grant execute on function public.notifications_suppress_on() to service_role;

-- הגוף זהה ל-20271029140000 כשהדגל כבוי. כשהוא דלוק נוספים דירוג, תקרה ויומן.
create or replace function public.scraped_lead_notify_demand(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.scraped_leads%rowtype;
  v_title  text;
  v_body   text;
  v_n      int;
  v_days   int := greatest(1, coalesce(
             (select value::int from public.pricing_config
               where key = 'notif_burst_scraped_stale_days'), 14));
  v_site   boolean;
  v_on     boolean;
  v_cap    int;
  v_fanout int;
  v_look   int;
  v_suppress boolean := false;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.claimed_by is not null
     or not public.scraped_lead_is_demand(r.status, r.lead_type, r.no_broker, r.posted_at, r.city_id) then
    return 0;
  end if;

  -- AND לא מדלג על שם פונקציה שחסרה: היא נפתרת בתכנון המשפט.
  -- execute רץ רק אחרי to_regprocedure, ולכן פוסט לא מפיל את ה-cron.
  if pg_catalog.to_regprocedure('public.notifications_suppress_on()') is not null then
    execute 'select public.notifications_suppress_on()' into v_suppress;
  end if;
  v_site := coalesce(r.push_site_only, false)
    or (r.posted_at is not null and r.posted_at < now() - make_interval(days => v_days))
    or coalesce(v_suppress, false);

  v_on := coalesce((select value::int from public.pricing_config
                     where key = 'open_demand_notify_cap_enabled'), 0) = 1;
  v_cap := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_notify_cap'), 8), 80));
  v_look := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_pull_lookback_days'), 14), 90));

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

  if not v_on then
    -- דגל כבוי: אותה תקרת 15 של 20271029140000. כולם בפעמון, וואטסאפ רק לראשונים.
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select s.id, 'open_demand', v_title, left(v_body, 500),
           v_site or (v_fanout > 0 and s.rn > v_fanout)
      from (
        select m.id,
               row_number() over (
                 order by
                   case
                     when a.city_id = r.city_id then 0
                     when exists (
                       select 1
                         from public.agent_lead_preferences lp
                         join public.neighborhoods n
                           on n.id = any (lp.preferred_neighborhoods)
                        where lp.agent_id = m.id
                          and lp.active
                          and n.city_id = r.city_id
                     ) then 1
                     else 2
                   end,
                   w.last_message_at desc nulls last,
                   m.id
               ) as rn
          from public.agency_members m
          left join public.agencies a on a.id = m.agency_id
          left join public.whatsapp_conversations w on w.agent_id = m.id
         where m.active
           and public.agent_works_city(m.id, r.city_id)
           and public.agent_handles_type(m.id, r.property_type, r.deal_type)
      ) s;
    get diagnostics v_n = row_count;
  else
    with eligible as (
      select m.id as agent_id, pulls.last_pull, noted.last_notified
        from public.agency_members m
        left join lateral (
          select max(x.at) as last_pull
            from (
              select l.unlocked_at as at
                from public.leads l
               where l.unlocked_by = m.id
                 and l.unlocked_at is not null
                 and l.unlocked_at >= now() - make_interval(days => v_look)
                 and l.unlocked_at > l.created_at + interval '1 second'
              union all
              select s.claimed_at
                from public.scraped_leads s
               where s.claimed_by = m.id
                 and s.claimed_at is not null
                 and s.claimed_at >= now() - make_interval(days => v_look)
            ) x
        ) pulls on true
        left join lateral (
          select max(n.created_at) as last_notified
            from public.notifications n
           where n.agent_id = m.id
             and n.type = 'open_demand'
        ) noted on true
       where m.active
         and m.released_at is null
         and coalesce(m.license_status, '') not in ('not_found', 'inactive')
         and public.notification_type_enabled(m.id, 'open_demand')
         and public.agent_works_city(m.id, r.city_id)
         and public.agent_handles_type(m.id, r.property_type, r.deal_type)
    ),
    ranked as (
      select e.agent_id, e.last_pull, e.last_notified,
             row_number() over (
               order by e.last_pull asc nulls first,
                        e.last_notified asc nulls first,
                        random()
             ) as rk
        from eligible e
    ),
    picked as (
      select * from ranked where rk <= v_cap
    ),
    ins as (
      insert into public.notifications (agent_id, type, title, body, suppress_push)
      select p.agent_id, 'open_demand', v_title, left(v_body, 500), v_site
        from picked p
      returning agent_id
    ),
    logged as (
      insert into public.open_demand_notify_log
        (scraped_lead_id, agent_id, rank, reason, last_pull_at, last_notified_at, cap, lookback_days)
      select p_id, p.agent_id, p.rk,
             case when p.last_pull is null then 'no_pull' else 'recent_pull' end,
             p.last_pull, p.last_notified, v_cap, v_look
        from picked p
        join ins i on i.agent_id = p.agent_id
      returning agent_id
    )
    -- ins ו-logged משנות נתונים. CTE כזה רץ עד הסוף גם כשהשאילתה
    -- הראשית לא קוראת את השורות שלו, ולכן היומן נכתב בלי תנאי על logged.
    select count(*)::int into v_n
      from ins;
  end if;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;

comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand פעם אחת לפוסט. דגל כבוי: לכל סוכן/ת בעיר ובסוג. דלוק: עד התקרה, קודם מי שלא תפס/ה בחלון. שקט ושמירת התפרצות נשארים בשליחה. docs/scraped-leads.md';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;
