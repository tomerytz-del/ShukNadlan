-- ============================================================================
-- התראות התאמה לשני הצדדים - ובשני הכיוונים
--
-- ## מה היה (מיגרציה 20260829210000)
--
-- נכס שהתאים ללקוח/ה צלצל **רק** אצל הסוכן/ת של הלקוח/ה. מי שמפרסם/ת את
-- הנכס לא ידע/ה שיש לו קונה אצל סוכן/ת אחר/ת - כלומר שיתוף הפעולה היה
-- תלוי בכך שהצד השני יזכור להרים טלפון. בפרודקשן נפתחו עד היום 10 התראות,
-- 5 מהן על נכס משותף, ובאף אחת מהן המפרסם/ת לא שמע/ה עליה.
--
-- ובנוסף, ההתראה נולדה רק מ**נכס** (חדש, שחזר, שהמחיר שלו זז, או ששותף).
-- לקוח/ה חדש/ה - או לקוח/ה שהדרישות שלו/ה השתנו - לא פתח/ה אף התראה, גם
-- כשבמאגר חיכו לו/ה חמישה נכסים מתאימים.
--
-- ## מה כאן
--
--   1. סוג התראה חדש, `listing_match`: "הנכס שלך מתאים ללקוח/ה של X".
--      שם, משרד וטלפון של **הסוכן/ת** - לא של הלקוח/ה. הלקוח/ה שייך/ת לקובץ
--      של הצד השני, וזה מה ששומר את שיתוף הפעולה הוגן: הפרטים עוברים ביניכם.
--   2. ‏`generate_client_match_alerts` (נכס → לקוחות) מצלצלת עכשיו גם אצל
--      המפרסם/ת, מתוך אותן שורות שנוספו - ‏`on conflict do nothing` על
--      ‏`unique(client_id, property_id)` מבטיח צלצול אחד לכל צמד, לכל החיים,
--      לשני הצדדים.
--   3. ‏`generate_client_match_alerts_for_client` (לקוח/ה → נכסים) - הכיוון
--      שחסר. טריגר על `agent_clients` בהוספה, ובעדכון של שדה שמשפיע על
--      התאמה בלבד (עדכון הערה אינו מתריע).
--
-- המאגר לא השתנה: הנכסים של המשרד ומה ששותף עם המשרד, בדיוק כמו פאנל
-- ההתאמות (`match_properties_for_client`). התראה ופאנל לא יראו אותו נכס
-- אחרת.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הסוג החדש. הרשימה המלאה מ-20270110090000 ועוד אחד בסוף.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match',
                  'review_new','deal_closed','lead_unrouted','marketing_copy',
                  'agreement_signed','platform_signup','platform_upgrade',
                  'onboarding_property','onboarding_client','onboarding_agreement',
                  'onboarding_lead','exclusivity_taken','deal_data_gap',
                  'listing_match'));

-- ---------------------------------------------------------------------------
-- 2. נכס → לקוחות. זהה ל-20260829210000, ועוד ה-CTE ‏`listing` בסוף.
-- ---------------------------------------------------------------------------
create or replace function public.generate_client_match_alerts(p_property_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop      public.properties%rowtype;
  v_min_score int;
  v_created   int := 0;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found or v_prop.status <> 'active' then
    return 0;
  end if;

  v_min_score := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);

  with reach as (
    select m.id as agent_id,
           case when v_prop.agent_id = m.id then 'own' else 'agency' end as source,
           0 as proximity
      from public.agency_members m
     where m.active = true
       and v_prop.agency_id is not null
       and m.agency_id = v_prop.agency_id
    union all
    select m.id, 'shared', 1
      from public.property_shares ps
      join public.agency_members m
        on m.agency_id = ps.shared_with_agency_id
       and m.active = true
     where ps.property_id = v_prop.id
  ),
  audience as (
    select distinct on (agent_id) agent_id, source
      from reach
     order by agent_id, proximity
  ),
  hits as (
    select a.agent_id, c.id as client_id, a.source,
           mt.score, mt.reasons, mt.missing_features
      from audience a
      join public.agent_clients c
        on c.agent_id = a.agent_id
       and c.status = 'active'
      cross join lateral public.client_property_match(c, v_prop) mt
     where mt.score >= v_min_score
  ),
  ins as (
    insert into public.client_match_alerts
      (agent_id, client_id, property_id, source, score, reasons, missing_features)
    select h.agent_id, h.client_id, v_prop.id, h.source, h.score, h.reasons, h.missing_features
      from hits h
    on conflict (client_id, property_id) do nothing
    returning agent_id, client_id
  ),
  named as (
    select i.agent_id, c.full_name
      from ins i
      join public.agent_clients c on c.id = i.client_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body)
    select n.agent_id,
           'client_match',
           'נכס חדש מתאים ללקוח/ה שלך',
           '"' || v_prop.title || '" מתאים ' ||
           case when count(*) = 1
                then 'ל' || min(n.full_name)
                else 'ל-' || count(*) || ' לקוחות מקובץ הלקוחות שלך' end
      from named n
     group by n.agent_id
    returning 1
  ),
  -- הצד השני: המפרסם/ת. רק התאמות אצל סוכן/ת **אחר/ת** - לקוח/ה שלך על
  -- נכס שלך כבר צלצל/ה אצלך למעלה.
  others as (
    select i.agent_id, count(*) as clients
      from ins i
     where i.agent_id is distinct from v_prop.agent_id
     group by i.agent_id
  ),
  listing as (
    insert into public.notifications (agent_id, type, title, body)
    select v_prop.agent_id,
           'listing_match',
           'הנכס שלך מתאים ללקוח/ה של סוכן/ת אחר/ת',
           '"' || v_prop.title || '" מתאים ל' ||
           case when sum(o.clients) = 1 then 'לקוח/ה' else '-' || sum(o.clients) || ' לקוחות' end ||
           ' של ' ||
           string_agg(coalesce(m.display_name, 'סוכן/ת') ||
                      coalesce(' (' || a.name || ')', '') ||
                      coalesce(', ' || m.phone, ''),
                      ' · ' order by o.clients desc) ||
           '. שווה ליצור קשר לשיתוף פעולה.'
      from others o
      join public.agency_members m on m.id = o.agent_id
      left join public.agencies a on a.id = m.agency_id
     where v_prop.agent_id is not null
       and exists (select 1 from public.agency_members lm
                    where lm.id = v_prop.agent_id and lm.active = true)
    having count(*) > 0
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

comment on function public.generate_client_match_alerts(uuid) is
  'פותחת התראות התאמה לנכס אחד מול קובצי הלקוחות של כל מי שרואה אותו, ומצלצלת פעם אחת לכל סוכן/ת של לקוח/ה - ופעם אחת אצל המפרסם/ת כשהלקוחות אצל סוכנים אחרים. אידמפוטנטית.';

revoke all on function public.generate_client_match_alerts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. לקוח/ה → נכסים. המאגר זהה לפאנל: נכסי המשרד, ומה ששותף עם המשרד.
-- ---------------------------------------------------------------------------
create or replace function public.generate_client_match_alerts_for_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client    public.agent_clients%rowtype;
  v_agent     public.agency_members%rowtype;
  v_min_score int;
  v_created   int := 0;
begin
  select * into v_client from public.agent_clients where id = p_client_id;
  if not found or v_client.status <> 'active' then
    return 0;
  end if;

  select * into v_agent from public.agency_members
   where id = v_client.agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return 0;
  end if;

  v_min_score := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);

  with reach as (
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as source,
           0 as proximity
      from public.properties p
     where p.agency_id = v_agent.agency_id
       and p.status = 'active'
    union all
    select ps.property_id, 'shared', 1
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  ),
  pool as (
    select distinct on (pid) pid, source
      from reach
     order by pid, proximity
  ),
  hits as (
    select p.id as property_id, p.agent_id as listing_agent_id, p.title,
           pool.source, mt.score, mt.reasons, mt.missing_features
      from pool
      join public.properties p on p.id = pool.pid
      cross join lateral public.client_property_match(v_client, p) mt
     where mt.score >= v_min_score
  ),
  ins as (
    insert into public.client_match_alerts
      (agent_id, client_id, property_id, source, score, reasons, missing_features)
    select v_agent.id, v_client.id, h.property_id, h.source, h.score, h.reasons, h.missing_features
      from hits h
    on conflict (client_id, property_id) do nothing
    returning property_id
  ),
  landed as (
    select h.property_id, h.listing_agent_id, h.title, h.score
      from ins i
      join hits h on h.property_id = i.property_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body)
    select v_agent.id,
           'client_match',
           'נכסים קיימים מתאימים ללקוח/ה שלך',
           case when count(*) = 1
                then '"' || min(l.title) || '" מתאים ל' || v_client.full_name
                else count(*) || ' נכסים מתאימים ל' || v_client.full_name ||
                     ', הבולט: "' || (array_agg(l.title order by l.score desc))[1] || '"' end
      from landed l
    having count(*) > 0
    returning 1
  ),
  -- הצד השני: כל מפרסם/ת אחר/ת, צלצול אחד עם כל הנכסים שלו/ה שהתאימו.
  listing as (
    insert into public.notifications (agent_id, type, title, body)
    select l.listing_agent_id,
           'listing_match',
           'הנכס שלך מתאים ללקוח/ה של סוכן/ת אחר/ת',
           case when count(*) = 1 then '"' || min(l.title) || '" מתאים'
                else count(*) || ' מהנכסים שלך מתאימים' end ||
           ' ללקוח/ה של ' || coalesce(v_agent.display_name, 'סוכן/ת') ||
           coalesce(' (' || (select a.name from public.agencies a where a.id = v_agent.agency_id) || ')', '') ||
           coalesce(', ' || v_agent.phone, '') ||
           '. שווה ליצור קשר לשיתוף פעולה.'
      from landed l
      join public.agency_members lm on lm.id = l.listing_agent_id and lm.active = true
     where l.listing_agent_id is distinct from v_agent.id
     group by l.listing_agent_id
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

comment on function public.generate_client_match_alerts_for_client(uuid) is
  'הכיוון ההפוך של generate_client_match_alerts: לקוח/ה חדש/ה או שהדרישות שלו/ה השתנו, מול נכסי המשרד ומה ששותף איתו. מצלצלת אצל הסוכן/ת ואצל כל מפרסם/ת אחר/ת. אידמפוטנטית.';

revoke all on function public.generate_client_match_alerts_for_client(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. הטריגר על agent_clients. כמו בנכסים: כישלון בהתראה לא מפיל את השמירה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_clients_match_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.generate_client_match_alerts_for_client(new.id);
  exception when others then
    raise warning 'client match alerts failed for client %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.agent_clients_match_alerts() from public, anon, authenticated;

drop trigger if exists agent_clients_match_alerts_ins on public.agent_clients;
create trigger agent_clients_match_alerts_ins
  after insert on public.agent_clients
  for each row
  when (new.status = 'active')
  execute function public.agent_clients_match_alerts();

drop trigger if exists agent_clients_match_alerts_upd on public.agent_clients;
create trigger agent_clients_match_alerts_upd
  after update on public.agent_clients
  for each row
  when (new.status = 'active' and (
        old.status            is distinct from new.status
     or old.deal_type         is distinct from new.deal_type
     or old.category          is distinct from new.category
     or old.cities            is distinct from new.cities
     or old.property_types    is distinct from new.property_types
     or old.min_price         is distinct from new.min_price
     or old.max_price         is distinct from new.max_price
     or old.min_rooms         is distinct from new.min_rooms
     or old.max_rooms         is distinct from new.max_rooms
     or old.min_size_sqm      is distinct from new.min_size_sqm
     or old.max_floor         is distinct from new.max_floor
     or old.required_features is distinct from new.required_features))
  execute function public.agent_clients_match_alerts();
