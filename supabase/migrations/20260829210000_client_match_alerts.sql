-- ============================================================================
-- התראות התאמה — נכס חדש שעונה על הדרישות של לקוח/ה בקובץ
--
-- עד היום מנוע ההתאמות (מיגרציה 20260825140000) עבד רק במשיכה: הסוכן/ת נכנס/ת
-- לכרטיס הלקוח/ה ולוחץ/ת "הצגת התאמות". נכס שנכנס למערכת בשתיים בלילה ומתאים
-- בדיוק למה שלקוח/ה מחפש/ת חיכה שמישהו יפתח את הכרטיס הנכון ביום הנכון.
--
-- כאן נוסף הכיוון השני — דחיפה:
--
--   1. ‏client_property_match() — הניקוד עבר לפונקציה אחת שמקבלת לקוח/ה ונכס.
--      זה מקור האמת היחיד לציון ולסיבות, ושתי הזרימות (הפאנל וההתראות)
--      קוראות לו. בלי זה היו כאן שתי נוסחאות ניקוד שנפרדות בשקט.
--   2. ‏client_match_alerts — ההתראה עצמה. unique(client_id, property_id) הוא
--      מה שמבטיח שאותו נכס לא יתריע פעמיים על אותו/ה לקוח/ה — גם אם הנכס
--      עודכן עשר פעמים, וגם אם המשרד שיתף אותו מחדש.
--   3. טריגרים על properties ועל property_shares — נכס חדש, נכס שחזר להיות
--      פעיל, שינוי בשדה שמשפיע על התאמה (מחיר, חדרים, עיר…), או שיתוף שפתח
--      את הנכס למשרד נוסף.
--   4. ‏client_match_alerts_feed() — הקריאה לכרטיסי ההתראה ב-CRM.
--
-- ‏רף ההתראה גבוה מרף הפאנל (70 מול 50) בכוונה: פאנל ההתאמות הוא משיכה —
-- הסוכן/ת ביקש/ה לראות, ולכן שווה להראות גם התאמה חלקית. התראה היא דחיפה,
-- ומי שמקבל/ת עשר התראות רועשות מפסיק/ה לקרוא את כולן.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוג התראה חדש בפעמון
--
-- אותה תבנית כמו review_request/review_alert במיגרציית הביקורות: הסוג נפרד
-- כדי שהפעמון ידע לאן להוביל בלחיצה.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match'));

-- ---------------------------------------------------------------------------
-- 2. הרף — כמו כל מספר עסקי בפרויקט, ב-pricing_config ולא בקוד
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('client_alert_min_score', 70,
        'הציון המינימלי שממנו נכס חדש פותח התראת התאמה ללקוח/ה (פאנל ההתאמות מציג מ-50)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. הניקוד — מקור אמת אחד ללקוח/ה ולנכס
--
-- מחזירה אפס שורות כשהנכס נופל באחד מהסינונים הקשיחים (סטטוס, סוג עסקה,
-- קטגוריה, עיר, סוג נכס, חדרים ותקציב), ושורה אחת עם ציון וסיבות כשהוא עובר.
-- הצורה הזו היא מה שמאפשר לקרוא לה כ-lateral ולקבל את הסינון בחינם.
--
-- ההיגיון עצמו לא השתנה מהמיגרציה המקורית: תקציב עם חריגה מבוקרת (10% מעל
-- המקסימום, 15% מתחת למינימום), ושדה חסר בנכס מוריד ניקוד ולא פוסל.
-- ---------------------------------------------------------------------------
create or replace function public.client_property_match(
  p_client   public.agent_clients,
  p_property public.properties
)
returns table (score int, reasons text[], missing_features text[])
language sql
immutable
set search_path = ''
as $$
  with gate as (
    select (p_property.status    = 'active'
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0         or p_property.city          = any(p_client.cities))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or p_property.price <= p_client.max_price * 1.10)
        and (p_client.min_price is null or p_property.price >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
           ) as passes
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(p_property.features)) as feats
  )
  select
    greatest(0, 100
      - case when p_client.max_price is not null and p_property.price > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and p_property.price < p_client.min_price then 5  else 0 end
      - case when p_client.min_size_sqm is not null
              and (p_property.size_sqm is null or p_property.size_sqm < p_client.min_size_sqm) then 10 else 0 end
      - case when p_client.max_floor is not null
              and p_property.floor is not null and p_property.floor > p_client.max_floor then 10 else 0 end
      - case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
             then 5 else 0 end
      - least(24, 8 * cardinality(miss.feats))
    )::int,
    array_remove(array[
      case when p_client.max_price is not null and p_property.price > p_client.max_price
           then 'מעל התקציב ב-' || round((p_property.price / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and p_property.price < p_client.min_price
           then 'מתחת לטווח המחירים שהוגדר' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is null
           then 'גודל הנכס לא מולא במודעה' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is not null
            and p_property.size_sqm < p_client.min_size_sqm
           then 'קטן מהמבוקש ב-' || round(p_client.min_size_sqm - p_property.size_sqm) || ' מ״ר' end,
      case when p_client.max_floor is not null and p_property.floor is not null
            and p_property.floor > p_client.max_floor
           then 'קומה ' || p_property.floor || ' — גבוה מהמבוקש' end,
      case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
           then 'מספר החדרים לא מולא במודעה' end
    ], null),
    miss.feats
  from gate, miss
  where gate.passes;
$$;

comment on function public.client_property_match(public.agent_clients, public.properties) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח. מקור האמת של פאנל ההתאמות ושל התראות ההתאמה גם יחד.';

revoke all on function public.client_property_match(public.agent_clients, public.properties) from public;
revoke all on function public.client_property_match(public.agent_clients, public.properties) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. פאנל ההתאמות — אותה חתימה, אותה תוצאה, ניקוד מהפונקציה המשותפת
--
-- החתימה והעמודות זהות למיגרציה 20260825140000; מה שהשתנה הוא שהסינון והניקוד
-- כבר לא כתובים כאן אלא ב-client_property_match, כדי שהתראה ופאנל לעולם לא
-- יראו את אותו נכס אחרת.
-- ---------------------------------------------------------------------------
create or replace function public.match_properties_for_client(p_client_id uuid)
returns table (
  property_id       uuid,
  source            text,
  score             int,
  reasons           text[],
  missing_features  text[],
  title             text,
  price             numeric,
  deal_type         text,
  property_type     text,
  rooms             numeric,
  floor             int,
  size_sqm          numeric,
  city              text,
  street            text,
  house_number      text,
  images            text[],
  is_promoted       boolean,
  listing_agency_id   uuid,
  listing_agency_name text,
  listing_agent_name  text,
  listing_agent_phone text,
  created_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  public.agency_members%rowtype;
  v_client public.agent_clients%rowtype;
begin
  select * into v_agent from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found or v_agent.agency_id is null then
    return;  -- אין סוכן/ת מזוהה/ת — מחזירים אפס שורות ולא שגיאה
  end if;

  select * into v_client from public.agent_clients
   where id = p_client_id and agent_id = v_agent.id;
  if not found then
    return;  -- לא הלקוח/ה שלך — אותה תשובה כמו "אין התאמות"
  end if;

  return query
  with pool as (
    -- הנכסים שלי ושל המשרד
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as src
      from public.properties p
     where p.agency_id = v_agent.agency_id
    union all
    -- מה שמשרדים אחרים שיתפו עם המשרד שלי
    select ps.property_id, 'shared'
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  )
  select
    p.id, pool.src, m.score, m.reasons, m.missing_features,
    p.title, p.price, p.deal_type, p.property_type,
    p.rooms::numeric, p.floor::int, p.size_sqm::numeric,
    p.city, p.street, p.house_number, p.images, p.is_promoted,
    p.agency_id, a.name, mem.display_name, mem.phone, p.created_at
    from pool
    join public.properties p on p.id = pool.pid
    cross join lateral public.client_property_match(v_client, p) m
    left join public.agencies a         on a.id = p.agency_id
    left join public.agency_members mem on mem.id = p.agent_id
   where m.score >= 50
   order by m.score desc, p.is_promoted desc, p.created_at desc
   limit 60;
end;
$$;

comment on function public.match_properties_for_client(uuid) is
  'התאמות לנכסים עבור לקוח/ה: הנכסים של הסוכן/ת, של המשרד ומה ששותף עם המשרד. מחזירה ציון וסיבות לכל התאמה חלקית.';

revoke all on function public.match_properties_for_client(uuid) from public;
revoke all on function public.match_properties_for_client(uuid) from anon;
grant execute on function public.match_properties_for_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ההתראות
--
-- ‏unique(client_id, property_id) הוא הלב של הטבלה ולא אילוץ טכני: הוא מה
-- שמבטיח שאותו נכס יתריע פעם אחת בלבד על אותו/ה לקוח/ה. בלי זה כל עדכון מחיר
-- ‏— וכל שיתוף חוזר — היה פותח התראה נוספת על נכס שכבר ראו.
--
-- ‏reasons ו-score נשמרים על השורה ולא מחושבים בקריאה: ההתראה מתעדת את מצב
-- הנכס ברגע שהוא התאים. אם המחיר עלה מאז, הסוכן/ת עדיין צריך/ה להבין למה
-- קיבל/ה את ההתראה.
--
-- ה-RLS צר כמו של agent_clients — רק הסוכן/ת עצמו/ה. הכתיבה נעשית אך ורק
-- מהטריגרים (security definer), ולכן אין policy של insert.
-- ---------------------------------------------------------------------------
create table if not exists public.client_match_alerts (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  client_id   uuid not null references public.agent_clients(id)  on delete cascade,
  property_id uuid not null references public.properties(id)     on delete cascade,

  source      text not null check (source in ('own','agency','shared')),
  score       int  not null,
  reasons          text[] not null default '{}',
  missing_features text[] not null default '{}',

  status      text not null default 'new'
              check (status in ('new','seen','dismissed')),

  created_at  timestamptz not null default now(),
  seen_at     timestamptz,

  constraint client_match_alerts_unique unique (client_id, property_id)
);

comment on table public.client_match_alerts is
  'התראה על נכס שעונה על הדרישות של לקוח/ה בקובץ. שורה אחת לכל צמד לקוח/ה–נכס, לכל החיים.';
comment on column public.client_match_alerts.source is
  'own = נכס שלי · agency = נכס של המשרד · shared = נכס ששותף עם המשרד שלי.';
comment on column public.client_match_alerts.score is
  'הציון ברגע ההתראה — לא מחושב מחדש בקריאה, כדי שההתראה תסביר את עצמה גם אחרי שהנכס השתנה.';
comment on column public.client_match_alerts.status is
  'new = לא נצפתה · seen = נצפתה · dismissed = הוסרה ידנית ולא תוצג שוב.';

create index if not exists client_match_alerts_agent_idx
  on public.client_match_alerts (agent_id, status, created_at desc);
create index if not exists client_match_alerts_client_idx
  on public.client_match_alerts (client_id);

alter table public.client_match_alerts enable row level security;
revoke all on table public.client_match_alerts from anon;

-- קריאה ועדכון סטטוס בלבד. הוספה ומחיקה שמורות לטריגרים.
drop policy if exists "agent reads own match alerts" on public.client_match_alerts;
create policy "agent reads own match alerts"
  on public.client_match_alerts for select
  using (agent_id = public.current_agent_id());

drop policy if exists "agent updates own match alerts" on public.client_match_alerts;
create policy "agent updates own match alerts"
  on public.client_match_alerts for update
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 6. יצירת ההתראות לנכס אחד
--
-- הקהל של הנכס הוא בדיוק המאגר של פאנל ההתאמות, מהכיוון ההפוך: כל סוכן/ת
-- פעיל/ה במשרד שמפרסם, וכל סוכן/ת במשרד שהנכס שותף איתו. סוכן/ת שמגיע/ה
-- משני הכיוונים נספר/ת פעם אחת, עם המקור הקרוב יותר (own לפני agency לפני
-- shared) — ‏distinct on עושה את זה.
--
-- ההוספה וההתראה בפעמון יושבות בהצהרה אחת: ה-CTE של הפעמון נשען על ה-returning
-- של ההוספה, ולכן מי שההתראה שלו כבר קיימת (on conflict do nothing) לא מקבל/ת
-- צלצול שני. אותה תבנית כמו הפצת השת"פ במיגרציה 20260825120000.
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
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

comment on function public.generate_client_match_alerts(uuid) is
  'פותחת התראות התאמה לנכס אחד מול קובצי הלקוחות של כל מי שרואה אותו, ומצלצלת בפעמון פעם אחת לכל סוכן/ת. אידמפוטנטית — צמד לקוח/ה–נכס שכבר התריע לא יתריע שוב.';

revoke all on function public.generate_client_match_alerts(uuid) from public;
revoke all on function public.generate_client_match_alerts(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. הטריגרים
--
-- כישלון ביצירת התראה לא יפיל שמירת נכס: פרסום מודעה הוא הפעולה, וההתראה היא
-- תוצר לוואי שלה. לכן warning ולא exception.
-- ---------------------------------------------------------------------------
create or replace function public.properties_client_match_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.generate_client_match_alerts(new.id);
  exception when others then
    raise warning 'client match alerts failed for property %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists properties_client_match_alerts_ins on public.properties;
create trigger properties_client_match_alerts_ins
  after insert on public.properties
  for each row
  when (new.status = 'active')
  execute function public.properties_client_match_alerts();

-- עדכון מתריע רק כששדה שמשפיע על התאמה זז. ירידת מחיר שמכניסה נכס קיים
-- לתקציב של לקוח/ה היא בדיוק הרגע שבו שווה להתריע, ולא פחות מנכס חדש.
drop trigger if exists properties_client_match_alerts_upd on public.properties;
create trigger properties_client_match_alerts_upd
  after update on public.properties
  for each row
  when (new.status = 'active' and (
        old.status        is distinct from new.status
     or old.price         is distinct from new.price
     or old.rooms         is distinct from new.rooms
     or old.size_sqm      is distinct from new.size_sqm
     or old.floor         is distinct from new.floor
     or old.city          is distinct from new.city
     or old.property_type is distinct from new.property_type
     or old.deal_type     is distinct from new.deal_type
     or old.category      is distinct from new.category
     or old.features      is distinct from new.features))
  execute function public.properties_client_match_alerts();

-- שיתוף פותח את הנכס לקובצי לקוחות שלא ראו אותו קודם. ההפצה מוסיפה עשרות
-- שורות בהצהרה אחת, ולכן טריגר ברמת ההצהרה עם טבלת מעבר — קריאה אחת לנכס
-- במקום אחת לכל משרד שקיבל אותו.
create or replace function public.property_shares_client_match_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select distinct property_id from inserted loop
    begin
      perform public.generate_client_match_alerts(r.property_id);
    exception when others then
      raise warning 'client match alerts failed for shared property %: %', r.property_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

drop trigger if exists property_shares_client_match_alerts on public.property_shares;
create trigger property_shares_client_match_alerts
  after insert on public.property_shares
  referencing new table as inserted
  for each statement
  execute function public.property_shares_client_match_alerts();

-- ---------------------------------------------------------------------------
-- 8. הקריאה ב-CRM
--
-- שורה אחת לכל התראה, עם פרטי הלקוח/ה ופרטי הנכס — כדי שכרטיס ההתראה ייבנה
-- מקריאה אחת. נכס שכבר אינו פעיל (נמכר, הוסר) נושר מהפיד: התראה על נכס שאי
-- אפשר להציע יותר היא רעש.
-- ---------------------------------------------------------------------------
create or replace function public.client_match_alerts_feed(
  p_scope text default 'new',
  p_limit int  default 40
)
returns table (
  id                uuid,
  status            text,
  score             int,
  source            text,
  reasons           text[],
  missing_features  text[],
  created_at        timestamptz,
  seen_at           timestamptz,
  client_id         uuid,
  client_name       text,
  client_phone      text,
  property_id       uuid,
  title             text,
  price             numeric,
  deal_type         text,
  property_type     text,
  rooms             numeric,
  floor             int,
  size_sqm          numeric,
  city              text,
  street            text,
  house_number      text,
  images            text[],
  is_promoted       boolean,
  listing_agency_name text,
  listing_agent_name  text,
  listing_agent_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    al.id, al.status, al.score, al.source, al.reasons, al.missing_features,
    al.created_at, al.seen_at,
    c.id, c.full_name, c.phone,
    p.id, p.title, p.price, p.deal_type, p.property_type,
    p.rooms::numeric, p.floor::int, p.size_sqm::numeric,
    p.city, p.street, p.house_number, p.images, p.is_promoted,
    a.name, m.display_name, m.phone
    from public.client_match_alerts al
    join public.agent_clients c on c.id = al.client_id
    join public.properties p    on p.id = al.property_id
    left join public.agencies a       on a.id = p.agency_id
    left join public.agency_members m on m.id = p.agent_id
   where al.agent_id = public.current_agent_id()
     and al.status <> 'dismissed'
     and p.status = 'active'
     and (p_scope is distinct from 'new' or al.status = 'new')
   order by (al.status = 'new') desc, al.created_at desc, al.score desc
   limit least(greatest(coalesce(p_limit, 40), 1), 200);
$$;

comment on function public.client_match_alerts_feed(text, int) is
  'פיד התראות ההתאמה של הסוכן/ת המחובר/ת. p_scope=''new'' להתראות שטרם נצפו, כל ערך אחר לכולן. התראות שהוסרו ונכסים שאינם פעילים אינם מוחזרים.';

revoke all on function public.client_match_alerts_feed(text, int) from public;
revoke all on function public.client_match_alerts_feed(text, int) from anon;
grant execute on function public.client_match_alerts_feed(text, int) to authenticated;
