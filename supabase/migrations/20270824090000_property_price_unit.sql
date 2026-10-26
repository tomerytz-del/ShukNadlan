-- ---------------------------------------------------------------------------
-- יחידת המחיר של נכס: סה״כ / למ״ר / לחודש (docs/price-unit.md)
--
-- נכס מסחרי מושכר נמסר הרבה פעמים במחיר למ״ר לחודש, והאתר הציג אותו
-- כשכירות חודשית: "₪140/חוד׳" על חנות של 170 מ״ר, ו-"₪20/חוד׳" על מגרש של
-- 2.25 דונם. זה נראה כמו טעות ופוגע באמון.
--
-- price_unit:
--   'total' - המחיר הוא סך הכול (מכירה)
--   'month' - שכירות חודשית לכל הנכס
--   'sqm'   - מחיר למ״ר (בהשכרה - למ״ר לחודש)
--   null    - לא צוין: השכרה מוצגת כ-'month' ומכירה כ-'total', כמו עד היום.
--
-- המילוי למפרע: נכס מסחרי מושכר במחיר מתחת ל-200 ₪ - אותו סף שבו הייבוא
-- מזהה מחיר למ"ר בקובץ של יד2 (YAD2_PRICE_PER_SQM_BELOW). בספירה של
-- 25.10.2026 - 13 נכסים, הגבוה שבהם 140 ₪, והבא אחריו 1,800 ₪.
--
-- העמודה אינה בטביעת האצבע של התיאור השיווקי, ולכן המילוי אינו מסמן אף
-- נכס כ"כדאי לרענן".
--
-- price_total - המחיר שאפשר להשוות לתקציב: במחיר למ״ר הוא המחיר כפול השטח
-- (הבנוי, ובמגרש - שטח המגרש), ובכל השאר הוא price. בלעדיו חנות ב-140 ₪ למ״ר
-- עברה כל סינון של "עד 5,000 ₪", והתאימה לכל לקוח/ה ולכל חיפוש שמור.
-- החיפוש באתר, בבוטים, ב-CRM, client_property_match ו-saved_search_matches
-- משווים מולו. נכס למ״ר בלי שטח - price_total הוא null, וההתאמות נופלות ל-price.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists price_unit text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_price_unit_check') then
    alter table public.properties
      add constraint properties_price_unit_check
      check (price_unit is null or price_unit in ('total', 'month', 'sqm'));
  end if;
end;
$$;

comment on column public.properties.price_unit is
  'יחידת המחיר: total (סה״כ), month (לחודש), sqm (למ״ר; בהשכרה למ״ר לחודש). null = לפי סוג העסקה.';

update public.properties
   set price_unit = 'sqm'
 where price_unit is null
   and category = 'commercial'
   and deal_type = 'rent'
   and price > 0
   and price < 200;

-- ---------------------------------------------------------------------------
-- price_total: המחיר להשוואה מול תקציב
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists price_total numeric
    generated always as (
      case
        when price_unit = 'sqm' then
          round(price * coalesce(nullif(built_size_sqm, 0), nullif(size_sqm, 0)))
        else price
      end
    ) stored;

comment on column public.properties.price_total is
  'המחיר להשוואה מול תקציב (מחושב): במחיר למ״ר - כפול השטח, אחרת price. docs/price-unit.md';

-- ---------------------------------------------------------------------------
-- ההתאמות מול לקוחות וחיפושים שמורים - מול price_total ולא price.
-- הגוף זהה לגרסה האחרונה (20270510090000, 20270716090000) חוץ מהמחיר.
-- ---------------------------------------------------------------------------
create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
immutable
set search_path = ''
as $$
  with feats as (
    -- מה שיש בנכס. ממ״ד מסחרי יושב ב-mamad_location ולא במערך
    select coalesce(p_property.features, '{}'::text[])
           || case when p_property.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end
           -- מרפסת שמש היא מרפסת: 13 מודעות פעילות מסמנות רק sun_balcony (14.10.2026)
           || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                   then array['balcony'] else '{}'::text[] end
           as have
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(feats.have)) as feats
      from feats
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        -- נכס פרטי: רק הלקוחות של מי שמחזיק/ה בו
        and (p_property.share_level is distinct from 'private'
             or p_property.agent_id = p_client.agent_id)
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0         or p_property.city          = any(p_client.cities))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_client.max_price * 1.10)
        and (p_client.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
           ) as passes
      from miss
  )
  select
    greatest(0, 100
      - case when p_client.max_price is not null and coalesce(p_property.price_total, p_property.price) > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and coalesce(p_property.price_total, p_property.price) < p_client.min_price then 5  else 0 end
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
      case when p_client.max_price is not null and coalesce(p_property.price_total, p_property.price) > p_client.max_price
           then 'מעל התקציב ב-' || round((coalesce(p_property.price_total, p_property.price) / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and coalesce(p_property.price_total, p_property.price) < p_client.min_price
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

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[]) from public, anon, authenticated;

create or replace function public.saved_search_matches(p_search public.saved_searches, p_property public.properties)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select
        p_property.status    = 'active'
    and p_property.deal_type = p_search.deal_type
    and p_property.category  = p_search.category
    and (
      (cardinality(p_search.cities) = 0 and cardinality(p_search.neighborhood_ids) = 0)
      or p_property.city = any(p_search.cities)
      or (p_property.neighborhood_id is not null
          and p_property.neighborhood_id = any(p_search.neighborhood_ids))
    )
    and (cardinality(p_search.property_types) = 0
         or p_property.property_type = any(p_search.property_types))
    and (p_search.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_search.max_price)
    and (p_search.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_search.min_price)
    and (p_search.min_rooms is null
         or (p_property.rooms is not null and p_property.rooms >= p_search.min_rooms))
    and (p_search.max_rooms is null
         or (p_property.rooms is not null and p_property.rooms <= p_search.max_rooms))
    and (p_search.min_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) >= p_search.min_size_sqm))
    and (p_search.max_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) <= p_search.max_size_sqm))
    and (p_search.min_floor is null
         or (p_property.floor is not null and p_property.floor >= p_search.min_floor))
    and (p_search.max_floor is null
         or (p_property.floor is not null and p_property.floor <= p_search.max_floor))
    -- מה שיש בנכס: המערך, מרפסת שמש כמרפסת, וממ״ד מסחרי מעמודת המיקום
    -- (‏FEATURES ב-assets/search-core.js; אותו ביטוי ב-client_property_match)
    and (cardinality(p_search.required_features) = 0
         or p_search.required_features <@ (
              coalesce(p_property.features, '{}'::text[])
              || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                      then array['balcony'] else '{}'::text[] end
              || case when p_property.mamad_location = 'unit'
                      then array['mamad'] else '{}'::text[] end))
    and (p_search.condition is null or p_property.condition = p_search.condition);
$function$;

revoke all on function public.saved_search_matches(public.saved_searches, public.properties) from public, anon, authenticated;
