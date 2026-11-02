-- ===========================================================================
-- client_property_match: תנאי העיר והשכונה עוברים לסוף השער
--
-- מה איטי: client_match_top רצה בכל כניסה ל-CRM, וב-pg_stat_statements
-- (2.11.2026) היא 1,516 קריאות בממוצע 939ms ועד 8 שניות. אצל הסוכן/ת עם 79
-- לקוחות פעילים - 3.3 שניות בכל כניסה. היא מריצה את client_property_match
-- לכל זוג לקוח/ה-נכס במאגר המשרד (14,220 זוגות שם).
--
-- למה: בשער, תנאי העיר בא מיד אחרי סוג העסקה והקטגוריה - לפני המחיר, החדרים,
-- סוג הנכס והמאפיינים. הוא מחשב city_ids_for_name לכל עיר של הלקוח/ה (כ-0.86ms
-- לקריאה בפרודקשן) ולעתים city_id_for_name לנכס (0.34ms), מחדש לכל זוג. 5,580
-- זוגות הגיעו אליו, ו-603 בלבד עוברים את התנאים הזולים שאחריו.
--
-- מה משתנה: רק הסדר. שני הבלוקים (העיר, השכונה) עוברים לסוף ה-AND, מילה
-- במילה. AND חילופי גם בלוגיקה תלת-ערכית, ואין בשער תנאי עם תופעת לוואי או
-- שגיאה אפשרית - ולכן התוצאה זהה לכל זוג, ורק מספר הקריאות לפונקציות העיר יורד.
-- נבדק על עותק מקומי של כל הלקוחות הפעילים מול כל הנכסים: 0 הבדלים
-- (docs/client-matching.md, "ביצועים").
--
-- הגוף הועתק מ-20271101100000 (md5(prosrc) בפרודקשן dec4d79c362bb3405660df78dddea407).
-- העטיפה בשני ארגומנטים לא נכתבת מחדש. ההרשאות נשמרות ב-create or replace,
-- וה-revoke למטה זהה לזה של הגרסה הקודמת.
-- ===========================================================================

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
  -- פעם אחת ללקוח/ה, לא לכל תנאי. city_ids_for_name כוללת גם עיר בודדת.
  prop_city as materialized (
    select public.city_id_for_name(p_property.city) as id
  ),
  client_cities as materialized (
    select c.name, public.city_ids_for_name(c.name) as ids
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
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_client.max_price * 1.10)
        and (p_client.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
        -- העיר והשכונה בסוף השרשרת: הן היקרות (city_ids_for_name לכל עיר של הלקוח/ה,
        -- city_id_for_name לנכס), ו-AND נעצר בתנאי הראשון שנכשל. הסדר אינו משנה תוצאה
        -- (AND חילופי, גם עם NULL), רק כמה זוגות מגיעים לחיפוש העיר (20271102120000).
        and (cardinality(p_client.cities) = 0
             or exists (
               select 1 from client_cities c
                where c.name = p_property.city
                   or (p_property.city_id is not null and p_property.city_id = any(c.ids))
                   or ((select id from prop_city) is not null
                       and (select id from prop_city) = any(c.ids))
             ))
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
                  or (hn.city_id is not null and hn.city_id = any(c.ids))
                  or (hn.city_name_id is not null and hn.city_name_id = any(c.ids))
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
            and round(p_client.min_living_room_sqm - p_property.living_room_sqm, 1) > 0
           then 'הסלון קטן מהמבוקש ב-' || rtrim(trim(to_char(p_client.min_living_room_sqm - p_property.living_room_sqm, 'FM990.9')), '.') || ' מ״ר' end,
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
  'ציון ההתאמה בין לקוח/ה לנכס יחיד. כיוון אוויר וסלון הם ניקוד רך: חסר כיוון נדרש -8 (עד -16), סלון מתחת למינימום -10, נתון חסר בנכס -5. אין שער קשיח. שם עיר שהוא כינוי של קבוצת יישובים מתאים לכל יישוב בקבוצה. העטיפה בשני ארגומנטים קוראת לכאן.';
