-- =============================================================================
-- תקרת שטח בכרטיס הלקוח/ה — max_size_sqm
--
-- עד היום היה בכרטיס רק "מ״ר מינימלי". לקוח/ה שביקש/ה 120-170 מ״ר נרשם/ה
-- כ-120 בלבד, וההתאמות המשיכו להציע גם נכסים של 250 מ״ר — את הסינון
-- לתקרה היה צריך לעשות בעין.
--
-- ההחלטה: התקרה היא **סינון קשיח** ב-client_property_match, בשונה מהמינימום
-- שהוא קנס ניקוד. מי שכותב/ת מקסימום מתכוון/ת לגבול, וזה מה שהסוכן/ת ביקש/ה.
-- נכס שהשטח שלו לא מולא עובר (כמו בחדרים) — אי אפשר לפסול על מה שלא ידוע.
--
-- מה שנוגעים בו:
--   1. העמודה, עם בדיקת טווח מול המינימום.
--   2. client_property_match — שורה אחת ב-gate. שאר הפונקציה כלשונה
--      מ-20260829210000.
--   3. הטריגר שמריץ מחדש התראות כשהדרישות משתנות — העמודה נוספת לרשימה.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודה
-- ---------------------------------------------------------------------------
alter table public.agent_clients
  add column if not exists max_size_sqm numeric(8,1)
    check (max_size_sqm is null or max_size_sqm > 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_clients_size_range'
      and conrelid = 'public.agent_clients'::regclass
  ) then
    alter table public.agent_clients
      add constraint agent_clients_size_range
      check (min_size_sqm is null or max_size_sqm is null or min_size_sqm <= max_size_sqm);
  end if;
end $$;

comment on column public.agent_clients.max_size_sqm is
  'תקרת שטח במ״ר. סינון קשיח בהתאמות: נכס גדול ממנה לא מוצע. נכס בלי שטח עובר.';

-- ---------------------------------------------------------------------------
-- 2. הניקוד — זהה ל-20260829210000 פרט לשורת max_size_sqm ב-gate
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
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח (כולל תקרת שטח). מקור האמת של פאנל ההתאמות ושל התראות ההתאמה גם יחד.';

revoke all on function public.client_property_match(public.agent_clients, public.properties) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. הטריגר — שינוי בתקרה מריץ מחדש את ההתאמות, כמו כל דרישה אחרת
-- ---------------------------------------------------------------------------
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
     or old.max_size_sqm      is distinct from new.max_size_sqm
     or old.max_floor         is distinct from new.max_floor
     or old.required_features is distinct from new.required_features))
  execute function public.agent_clients_match_alerts();
