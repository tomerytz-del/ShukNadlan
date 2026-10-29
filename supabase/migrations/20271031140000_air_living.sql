-- כיווני אוויר ושטח סלון. עמודות ריקות. בלי ניחוש לאחור.
-- כיוון: צפון/דרום/מזרח/מערב. צירוף הוא כמה ערכים. הספירה נגזרת.
-- סלון: מספר בלבד. "סלון גדול" אצל קונה הוא 30 מ"ר, בלי דגל.
-- מילוי השדות בנכס קיים אינו נכנס לטריגר ההתראות (ראו הסוף).

alter table public.properties add column if not exists air_directions text[];
alter table public.properties add column if not exists living_room_sqm numeric;

alter table public.agent_clients add column if not exists required_directions text[];
alter table public.agent_clients add column if not exists min_air_directions smallint;
alter table public.agent_clients add column if not exists min_living_room_sqm numeric;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'properties_air_directions_chk') then
    alter table public.properties add constraint properties_air_directions_chk
      check (
        air_directions is null
        or (
          cardinality(air_directions) between 1 and 4
          and air_directions <@ array['צפון','דרום','מזרח','מערב']::text[]
        )
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_living_room_sqm_chk') then
    alter table public.properties add constraint properties_living_room_sqm_chk
      check (living_room_sqm is null or (living_room_sqm >= 4 and living_room_sqm <= 150));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_clients_required_directions_chk') then
    alter table public.agent_clients add constraint agent_clients_required_directions_chk
      check (
        required_directions is null
        or (
          cardinality(required_directions) between 1 and 4
          and required_directions <@ array['צפון','דרום','מזרח','מערב']::text[]
        )
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_clients_min_air_directions_chk') then
    alter table public.agent_clients add constraint agent_clients_min_air_directions_chk
      check (min_air_directions is null or min_air_directions in (2, 3, 4));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_clients_min_living_room_sqm_chk') then
    alter table public.agent_clients add constraint agent_clients_min_living_room_sqm_chk
      check (min_living_room_sqm is null or (min_living_room_sqm >= 4 and min_living_room_sqm <= 150));
  end if;
end $$;

comment on column public.properties.air_directions is
  'כיווני אוויר: צפון, דרום, מזרח, מערב. צירוף הוא כמה ערכים. ריק = לא ידוע.';
comment on column public.properties.living_room_sqm is
  'שטח הסלון במ"ר, 4 עד 150. ריק = לא נאמר.';
comment on column public.agent_clients.required_directions is
  'כיוונים שהנכס צריך לכלול (וגם). ריק = לא משנה. ניקוד רך, לא שער.';
comment on column public.agent_clients.min_air_directions is
  'מינימום מספר כיוונים: null, 2, 3 או 4. ריק = לא משנה.';
comment on column public.agent_clients.min_living_room_sqm is
  'שטח סלון מינימלי. ריק = לא משנה. 30 הוא הקיצור "סלון גדול".';

create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
stable
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
  -- city_id_for_name פעם אחת לנכס ופעם אחת לכל עיר של הלקוח/ה, לא בכל תנאי.
  prop_city as materialized (
    select public.city_id_for_name(p_property.city) as id
  ),
  client_cities as materialized (
    select c.name, public.city_id_for_name(c.name) as id
      from unnest(coalesce(p_client.cities, '{}'::text[])) c(name)
  ),
  hood as materialized (
    select hn.city, hn.city_id, public.city_id_for_name(hn.city) as city_name_id
      from public.neighborhoods hn
     where hn.id = p_client.neighborhood_id
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        -- נכס פרטי: רק הלקוחות של מי שמחזיק/ה בו
        and (p_property.share_level is distinct from 'private'
             or p_property.agent_id = p_client.agent_id)
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0
             or exists (
               select 1 from client_cities c
                where c.name = p_property.city
                   or (p_property.city_id is not null and p_property.city_id = c.id)
                   or (c.id is not null and (select id from prop_city) is not null
                       and c.id = (select id from prop_city))
             ))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        -- שכונה: ריקה, חסרה, או שלא שייכת לאף עיר - לא מסתירה. שייכת - רק בעיר שלה.
        -- שכונה ריקה במודעה היא "לא ידוע" ועוברת, עם הורדת ציון למטה.
        and (
          p_client.neighborhood_id is null
          or not exists (select 1 from hood)
          or (
            cardinality(p_client.cities) > 0
            and not exists (
              select 1 from hood hn, client_cities c
               where c.name = hn.city
                  or (hn.city_id is not null and hn.city_id = c.id)
                  or (c.id is not null and hn.city_name_id is not null and c.id = hn.city_name_id)
            )
          )
          or exists (
            select 1 from hood hn
             where not (
               (p_property.city_id is not null and hn.city_id is not null
                and p_property.city_id = hn.city_id)
               or p_property.city = hn.city
               or ((select id from prop_city) is not null
                   and hn.city_name_id is not null
                   and (select id from prop_city) = hn.city_name_id)
             )
          )
          or p_property.neighborhood_id = p_client.neighborhood_id
          or p_property.neighborhood_id is null
        )
        and (p_client.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_client.max_price * 1.10)
        and (p_client.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
        -- כיוון אוויר וסלון הם ניקוד רך, לא שער. נתון חסר אינו מסתיר נכס.
           ) as passes
      from miss
  )
  select
    least(100, greatest(0, 100
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
      - case when cardinality(coalesce(p_client.required_directions, '{}'::text[])) > 0
              and (p_property.air_directions is null or cardinality(p_property.air_directions) = 0)
             then 5 else 0 end
      - least(16, 8 * coalesce((
          select count(*)::int
            from unnest(coalesce(p_client.required_directions, '{}'::text[])) as missing(dir)
           where p_property.air_directions is not null
             and cardinality(p_property.air_directions) > 0
             and not (missing.dir = any(p_property.air_directions))
        ), 0))
      - case when p_client.min_air_directions is not null
              and p_property.air_directions is not null
              and cardinality(p_property.air_directions) > 0
              and cardinality(p_property.air_directions) < p_client.min_air_directions
             then 10 else 0 end
      - case when p_client.min_air_directions is not null
              and (p_property.air_directions is null or cardinality(p_property.air_directions) = 0)
              and cardinality(coalesce(p_client.required_directions, '{}'::text[])) = 0
             then 5 else 0 end
      - case when p_client.min_living_room_sqm is not null and p_property.living_room_sqm is null
             then 5 else 0 end
      - case when p_client.min_living_room_sqm is not null
              and p_property.living_room_sqm is not null
              and p_property.living_room_sqm < p_client.min_living_room_sqm
             then 10 else 0 end
      - case when p_client.neighborhood_id is not null
              and p_property.neighborhood_id is null
              and exists (
                select 1 from hood hn
                 where (p_property.city_id is not null and hn.city_id is not null
                        and p_property.city_id = hn.city_id)
                    or p_property.city = hn.city
                    or ((select id from prop_city) is not null
                        and hn.city_name_id is not null
                        and (select id from prop_city) = hn.city_name_id)
              )
             then 8 else 0 end
      - least(24, 8 * cardinality(miss.feats))
      + least(12, 4 * (
          select count(*)::int
            from unnest(coalesce(p_client.preferred_features, '{}'::text[])) pf
           where pf = any(feats.have)
        ))
    ))::int,
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
           then 'מספר החדרים לא מולא במודעה' end,
      case when (cardinality(coalesce(p_client.required_directions, '{}'::text[])) > 0
                  or p_client.min_air_directions is not null)
            and (p_property.air_directions is null or cardinality(p_property.air_directions) = 0)
           then 'כיווני אוויר לא צוינו' end,
      case when cardinality(coalesce(p_client.required_directions, '{}'::text[])) > 0
            and p_property.air_directions is not null
            and cardinality(p_property.air_directions) > 0
            and exists (
              select 1 from unnest(p_client.required_directions) as missing(dir)
               where not (missing.dir = any(p_property.air_directions))
            )
           then 'בלי כיוון ' || (
             select string_agg(missing.dir, ', ' order by array_position(array['צפון','דרום','מזרח','מערב']::text[], missing.dir))
               from unnest(p_client.required_directions) as missing(dir)
              where not (missing.dir = any(p_property.air_directions))
           ) end,
      case when p_client.min_air_directions is not null
            and p_property.air_directions is not null
            and cardinality(p_property.air_directions) > 0
            and cardinality(p_property.air_directions) < p_client.min_air_directions
           then cardinality(p_property.air_directions)::text || ' כיווני אוויר מתוך ' || p_client.min_air_directions::text || ' שביקשו' end,
      case when p_client.min_living_room_sqm is not null and p_property.living_room_sqm is null
           then 'גודל הסלון לא צוין' end,
      case when p_client.min_living_room_sqm is not null and p_property.living_room_sqm is not null
            and p_property.living_room_sqm < p_client.min_living_room_sqm
           then 'הסלון קטן מהמבוקש ב-' || trim(to_char(p_client.min_living_room_sqm - p_property.living_room_sqm, 'FM999.9')) || ' מ״ר' end,
      case when p_client.neighborhood_id is not null
            and p_property.neighborhood_id is null
            and exists (
              select 1 from hood hn
               where (p_property.city_id is not null and hn.city_id is not null
                      and p_property.city_id = hn.city_id)
                  or p_property.city = hn.city
                  or ((select id from prop_city) is not null
                      and hn.city_name_id is not null
                      and (select id from prop_city) = hn.city_name_id)
            )
           then 'שכונה לא מולאה במודעה' end
    ], null),
    miss.feats
  from gate, miss, feats
  where gate.passes;
$$;



alter function public.client_property_match(public.agent_clients, public.properties, text[])
  reset search_path;

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[])
  from public, anon, authenticated;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד. כיוון אוויר וסלון הם ניקוד רך: חסר כיוון נדרש -8 (עד -16), סלון מתחת למינימום -10, נתון חסר בנכס -5. אין שער קשיח.';

-- עריכת דרישת קונה מצליבה מחדש. מילוי כיוון או סלון בנכס קיים לא נכנס
-- לרשימה של properties_client_match_alerts_upd ולא ל-saved_search:
-- אחרת השלמת נתון הייתה שולחת התראות כאילו הנכס חדש.
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
     or old.required_features is distinct from new.required_features
     or old.neighborhood_id   is distinct from new.neighborhood_id
     or old.preferred_features is distinct from new.preferred_features
     or old.required_directions is distinct from new.required_directions
     or old.min_air_directions is distinct from new.min_air_directions
     or old.min_living_room_sqm is distinct from new.min_living_room_sqm))
  execute function public.agent_clients_match_alerts();

drop trigger if exists agent_clients_prune_stale_alerts on public.agent_clients;
create trigger agent_clients_prune_stale_alerts
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
     or old.required_features is distinct from new.required_features
     or old.neighborhood_id   is distinct from new.neighborhood_id
     or old.preferred_features is distinct from new.preferred_features
     or old.required_directions is distinct from new.required_directions
     or old.min_air_directions is distinct from new.min_air_directions
     or old.min_living_room_sqm is distinct from new.min_living_room_sqm))
  execute function public.agent_clients_prune_stale_alerts();
