-- =============================================================================
-- בעל/ת נכס בקובץ הלקוחות - בלי התאמות
--
-- עד היום כל כרטיס ב-agent_clients היה "מחפש/ת": ‏deal_type מקבל רק sale/rent
-- והוצג כ"קנייה"/"שכירות", וברירת המחדל שלו sale. בעל/ת נכס שמוכר/ת את
-- הדירה (נכנס/ה מסיכום שיחה, מאיש קשר ששותף לגבריאלה או מהטופס) נשמר/ה לכן
-- כקונה בלי שום דרישה - ו"שדה ריק = לא משנה" הפך אותו/ה למתאים/ה לכל נכס
-- במאגר. כך קיבל מוכר דירת 3 חדרים בעפולה 27 התאמות, ובראשן בית פרטי באומן.
--
-- ההחלטה: עמודה נפרדת ולא ערך שלישי ב-deal_type. ‏deal_type ממשיך לומר
-- מכירה או השכרה, ו-client_kind אומר באיזה צד של העסקה הלקוח/ה:
--   seeker + sale = קונה          owner + sale = מוכר/ת
--   seeker + rent = שוכר/ת        owner + rent = משכיר/ה
-- ככה ההסכם (sell/landlord מול buy/tenant) נגזר משני השדות בלי טבלת המרה.
--
-- מה שנוגעים בו:
--   1. העמודה.
--   2. client_property_match - שורה אחת ב-gate. היא מקור האמת של כל
--      ההתאמות (הפאנל, הספירות, ההתראות, הבוט), ולכן שורה אחת מכסה את כולן.
--      שאר הפונקציה כלשונה מ-20270212090000.
--   3. הטריגר שמריץ מחדש התראות - client_kind נוסף לרשימה, כדי שבעל/ת נכס
--      שהפך/ה למחפש/ת יקבל/תקבל התאמות מיד.
--   4. כרטיס שהפך לבעל/ת נכס - ההתראות שעוד לא נסגרו שלו/ה נמחקות. אחרת
--      ה-27 היו נשארים בפאנל "התאמות חכמות" אחרי התיקון.
--
-- אין כאן סיווג למפרע של כרטיסים קיימים: ההבחנה יושבת היום רק בהערה
-- החופשית, וניחוש לפי "מוכר" בהערה יטעה ב"מוכר את הדירה הנוכחית וקונה".
-- הסוכן/ת מסמנ/ת בטופס.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודה
-- ---------------------------------------------------------------------------
alter table public.agent_clients
  add column if not exists client_kind text not null default 'seeker';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_clients_client_kind_check'
      and conrelid = 'public.agent_clients'::regclass
  ) then
    alter table public.agent_clients
      add constraint agent_clients_client_kind_check
      check (client_kind in ('seeker','owner'));
  end if;
end $$;

comment on column public.agent_clients.client_kind is
  'seeker = מחפש/ת נכס (קונה או שוכר/ת) · owner = בעל/ת נכס (מוכר/ת או משכיר/ה). רק seeker נכנס/ת להתאמות; deal_type אומר מכירה או השכרה בשני המקרים.';

-- ---------------------------------------------------------------------------
-- 2. הניקוד - זהה ל-20270212090000 פרט לשורת client_kind ב-gate
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
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0         or p_property.city          = any(p_client.cities))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or p_property.price <= p_client.max_price * 1.10)
        and (p_client.min_price is null or p_property.price >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
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
      - case when p_client.max_size_sqm is not null and p_client.min_size_sqm is null
              and p_property.size_sqm is null then 10 else 0 end
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
      case when (p_client.min_size_sqm is not null or p_client.max_size_sqm is not null)
            and p_property.size_sqm is null
           then 'גודל הנכס לא מולא במודעה' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is not null
            and p_property.size_sqm < p_client.min_size_sqm
           then 'קטן מהמבוקש ב-' || round(p_client.min_size_sqm - p_property.size_sqm) || ' מ״ר' end,
      case when p_client.max_floor is not null and p_property.floor is not null
            and p_property.floor > p_client.max_floor
           then 'קומה ' || p_property.floor || ' - גבוה מהמבוקש' end,
      case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
           then 'מספר החדרים לא מולא במודעה' end
    ], null),
    miss.feats
  from gate, miss
  where gate.passes;
$$;

comment on function public.client_property_match(public.agent_clients, public.properties) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח (כולל תקרת שטח, ובעל/ת נכס שאינו/ה מחפש/ת). מקור האמת של פאנל ההתאמות ושל התראות ההתאמה גם יחד.';

revoke all on function public.client_property_match(public.agent_clients, public.properties) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. הטריגר - מעבר בין בעל/ת נכס למחפש/ת מריץ מחדש את ההתאמות
-- ---------------------------------------------------------------------------
drop trigger if exists agent_clients_match_alerts_upd on public.agent_clients;
create trigger agent_clients_match_alerts_upd
  after update on public.agent_clients
  for each row
  when (new.status = 'active' and (
        old.status            is distinct from new.status
     or old.client_kind       is distinct from new.client_kind
     or old.deal_type         is distinct from new.deal_type
     or old.category          is distinct from new.category
     or old.cities            is distinct from new.cities
     or old.property_types    is distinct from new.property_types
     or old.min_price         is distinct from new.min_price
     or old.max_price         is distinct from new.max_price
     or old.min_rooms         is distinct from new.min_rooms
     or old.max_rooms         is distinct from new.max_rooms
     or old.min_size_sqm      is distinct from new.min_size_sqm
     or old.max_size_sqm      is distinct from new.max_size_sqm
     or old.max_floor         is distinct from new.max_floor
     or old.required_features is distinct from new.required_features))
  execute function public.agent_clients_match_alerts();

-- ---------------------------------------------------------------------------
-- 4. כרטיס שהפך לבעל/ת נכס - ההתראות הפתוחות שלו יורדות
--
-- רק new ו-seen: dismissed היא החלטה של הסוכן/ת ("לא להציע שוב"), והיא
-- נשמרת למקרה שהכרטיס יחזור להיות מחפש/ת. ‏security definer כדי שהמחיקה
-- לא תיפול על RLS של client_match_alerts כשהעדכון מגיע מהבוט או מהטופס.
-- ---------------------------------------------------------------------------
create or replace function public.agent_clients_owner_clear_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.client_match_alerts
   where client_id = new.id
     and status in ('new','seen');
  return null;
end;
$$;

revoke all on function public.agent_clients_owner_clear_alerts() from public, anon, authenticated;

drop trigger if exists agent_clients_owner_clear_alerts on public.agent_clients;
create trigger agent_clients_owner_clear_alerts
  after update on public.agent_clients
  for each row
  when (new.client_kind = 'owner' and old.client_kind is distinct from new.client_kind)
  execute function public.agent_clients_owner_clear_alerts();
