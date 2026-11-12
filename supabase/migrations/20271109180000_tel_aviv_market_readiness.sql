-- ===========================================================================
-- הכנה לשווקים תל אביב-יפו ורמת גן וגבעתיים - מה שנמצא חסר בבדיקה של 9.11.2026
-- לפני ההדגמה לשני משרדים (docs/regional-pages.md, "תל אביב וגבעתיים").
--
-- 1. כינויי עיר. "תל אביב" לא נפתר לשום עיר (city_id_for_name החזירה null),
--    כי השם ברישום הוא "תל אביב - יפו" ואף כינוי לא נוסף ב-20270515090000.
--    בלי זה: נכס שנוצר בוואטסאפ עם "תל אביב" נשאר בלי city_id (לא בשוק ולא
--    בסף הפתיחה), cma_locate_address מחזירה null, והבוט אומר "אין עסקאות".
--    אותו דבר ל"יהוד" מול "יהוד-מונוסון".
-- 2. כינוי שכונה בגבעתיים: רשות המיסים כותבת "ארלוזרוב" (85 עסקאות בלי
--    שיוך), ברישום "ארלוזורוב".
-- 3. מחזור "עדכן עסקאות" של 7 ימים לתל אביב-יפו: GovMap מחזיר 1,500 עסקאות
--    אחרונות ליישוב, ובעיר הזו זה פחות מחצי שנה. מחזור קצר יותר מאבד פחות.
-- 4. agent_market_deals_lookup - עיר בכינוי נפתרת לשם שבמאגר. הפונקציה
--    השוותה property_text_key(city) כמו שהוקלד, ו"תל אביב" (מפתח "תל אביב")
--    לא פגש "תל אביב - יפו" (מפתח "תל אביב יפו"). הגוף מהגרסה בפרודקשן
--    (20270211092000 + 20271104170000), עם בלוק אחד נוסף אחרי חישוב המפתח.
-- 5. cma_locate_address - "מספר הבית הקרוב" חיפש עד 30 מספרים, ו"דיזנגוף 100"
--    חזר null כשיש עסקאות ב-132 וב-140. ברחובות ארוכים של עיר גדולה זה
--    המצב הרגיל. עכשיו: עד 80 מספרים, ואם אין - מרכז העסקאות ברחוב, עם
--    precision = 'street' (הדוח כבר אומר את הדיוק).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. כינויי עיר
-- ---------------------------------------------------------------------------
insert into public.city_aliases (city_id, alias)
select c.id, v.alias
  from (values ('תל אביב',  'תל אביב - יפו'),
               ('ת"א',      'תל אביב - יפו'),
               ('יפו',      'תל אביב - יפו'),   -- יפו היא חלק מהעיר, לא יישוב
               ('יהוד',     'יהוד-מונוסון'),
               ('מונוסון',  'יהוד-מונוסון')
       ) as v(alias, city_name)
  join public.cities c on c.name_key = public.city_name_key(v.city_name) and c.active
 where not exists (select 1 from public.cities x where x.name_key = public.city_name_key(v.alias))
on conflict (alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. כינוי שכונה - גבעתיים
-- ---------------------------------------------------------------------------
insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
select n.id, 'ארלוזרוב', false,
       'השם במאגר רשות המיסים לשכונת ארלוזורוב (85 עסקאות ללא שיוך, 9.11.2026)'
  from public.cities c
  join public.neighborhoods n on n.city_id = c.id and n.name = 'ארלוזורוב'
 where c.name_key = public.city_name_key('גבעתיים')
on conflict (neighborhood_id, alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. מחזור קצר לתל אביב-יפו
-- ---------------------------------------------------------------------------
update public.deal_settlements
   set sync_every_days = 7
 where public.property_text_key(name) = public.property_text_key('תל אביב - יפו')
   and sync_every_days > 7;

-- ---------------------------------------------------------------------------
-- 4. agent_market_deals_lookup - עיר בכינוי
-- ---------------------------------------------------------------------------
create or replace function public.agent_market_deals_lookup(
  p_agent_id      uuid,
  p_city          text,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_street        text default null,
  p_house_number  text default null,
  p_radius_m      integer default 300,
  p_months        integer default 24,
  p_limit         integer default 5,
  p_property_type text default null,
  p_neighborhood  text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier     text;
  v_city     text := nullif(btrim(coalesce(p_city, '')), '');
  v_street   text := nullif(btrim(coalesce(p_street, '')), '');
  v_house    text := nullif(btrim(coalesce(p_house_number, '')), '');
  v_hood     text := nullif(btrim(coalesce(p_neighborhood, '')), '');
  v_radius   integer := least(greatest(coalesce(p_radius_m, 300), 50), 5000);
  v_months   integer := least(greatest(coalesce(p_months, 24), 1), 120);
  v_limit    integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_cutoff   date;
  v_mode     text;
  v_city_key text;
  v_canon    text;
  v_st_key   text;
  v_use_house boolean := false;
  v_hood_ids  uuid[];
  v_hood_names text[];
  v_from_street boolean := false;
  v_city_id   uuid;
  v_by_name   integer;
  v_by_pin    integer;
  v_deals    jsonb;
  v_total    integer;
  v_coverage jsonb;
begin
  if p_agent_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select m.tier into v_tier
    from public.agency_members m
   where m.id = p_agent_id and m.active = true and m.billing_status = 'active';

  if v_tier is distinct from 'premium' then
    return jsonb_build_object(
      'error',         'tier_required',
      'required_tier', 'premium',
      'detail',        'שאילתת עסקאות היסטוריות זמינה במסלול Elite.');
  end if;

  if v_city is null then
    return jsonb_build_object('error', 'city_required',
      'detail', 'צריך לציין עיר.');
  end if;

  v_cutoff   := (current_date - (v_months || ' months')::interval)::date;
  v_city_key := public.property_text_key(v_city);
  v_st_key   := public.property_text_key(v_street);

  -- עיר בכינוי ("תל אביב", "ת"א", "יהוד") - המאגר נושא את השם ברישום
  -- ("תל אביב - יפו"). city_id_for_name מכירה את city_aliases; שם העיר
  -- ברישום הוא מה שהסוכן הדפדפן כותב ל-market_deals_official.city.
  -- רק כשהמפתח שהוקלד אינו פוגש אף עסקה - כתיב שכבר במאגר נשאר כמו שהוא.
  if not exists (select 1 from public.market_deals_official o
                  where public.property_text_key(o.city) = v_city_key) then
    select c.name into v_canon
      from public.cities c
     where c.id = public.city_id_for_name(v_city);
    if v_canon is not null and public.property_text_key(v_canon) is distinct from v_city_key then
      v_city     := v_canon;
      v_city_key := public.property_text_key(v_canon);
    end if;
  end if;

  -- רחוב שאינו במאגר אבל הוא שם של שכונה בעיר ("גבעת המורה") - שכונה.
  -- רק בלי נקודה: נקודה היא כתובת שגאוקדה, כלומר רחוב אמיתי.
  if v_hood is null and v_street is not null
     and (p_lat is null or p_lng is null)
     and not exists (
       select 1 from public.market_deals_official o
        where public.property_text_key(o.city) = v_city_key
          and public.property_text_key(o.street) = v_st_key)
     and public.neighborhood_ids_for(v_city, v_street) is not null then
    v_hood        := v_street;
    v_street      := null;
    v_from_street := true;
  end if;

  if v_hood is not null then
    v_hood_ids := public.neighborhood_ids_for(v_city, v_hood);
    if v_hood_ids is null then
      return jsonb_build_object(
        'error',  'neighborhood_not_found',
        'detail', 'לא נמצאה שכונה בשם הזה בעיר.',
        'city',   v_city,
        'known_neighborhoods', coalesce((
          select jsonb_agg(n.name order by n.name)
            from public.neighborhoods n
            join public.cities c on c.id = n.city_id
           where c.name_key = public.city_name_key(v_city)
             and not coalesce(n.is_planned, false)), '[]'::jsonb));
    end if;
    select array_agg(n.name order by n.name) into v_hood_names
      from public.neighborhoods n where n.id = any(v_hood_ids);
    select c.id into v_city_id from public.cities c
     where c.name_key = public.city_name_key(v_city) limit 1;
  end if;

  -- מצב הרדיוס דורש **שתי** קואורדינטות. אחת בלבד אינה נקודה.
  if p_lat is not null and p_lng is not null then
    v_mode := 'radius';
  elsif v_hood_ids is not null then
    v_mode := 'neighborhood';
  elsif v_street is not null then
    v_mode := 'street';
    if v_house is not null then
      select exists (
        select 1 from public.market_deals_official o
         where public.property_text_key(o.city) = v_city_key
           and o.sold_at >= v_cutoff
           and public.property_text_key(o.street) = v_st_key
           and public.property_text_key(o.house_number) = public.property_text_key(v_house))
        into v_use_house;
    end if;
    if not exists (
        select 1 from public.market_deals_official o
         where public.property_text_key(o.city) = v_city_key
           and o.sold_at >= v_cutoff
           and public.property_text_key(o.street) = v_st_key)
       and length(coalesce(v_st_key, '')) >= 3 then
      v_mode := 'street_partial';
    end if;
  else
    v_mode := 'city';
  end if;

  with pool as (
    select o.street, o.house_number, o.neighborhood,
           o.gush, o.helka, o.property_type, o.rooms, o.floor,
           o.size_sqm, o.sale_price, o.sold_at,
           case when o.size_sqm > 0
                then round(o.sale_price / o.size_sqm) end as price_per_sqm,
           case when v_mode = 'radius'
                then round(public.geo_distance_meters(p_lat, p_lng, o.lat, o.lng))
           end as distance_meters,
           -- ‏name: לפי שם השכונה במאגר; location: בלי שם מותאם, והפין נופל
           -- במצולע אחד ויחיד (20270211092000)
           case when v_mode = 'neighborhood' then
             case when o.neighborhood_ids && v_hood_ids then 'name' else 'location' end
           end as matched_by
      from public.market_deals_official o
     where public.property_text_key(o.city) = v_city_key
       and o.sold_at >= v_cutoff
       and (p_property_type is null
            or o.property_type is not distinct from p_property_type)
       and (
         case v_mode
           when 'radius' then
             o.lat is not null and o.lng is not null
             and public.geo_distance_meters(p_lat, p_lng, o.lat, o.lng) <= v_radius
           when 'neighborhood' then
             o.neighborhood_ids && v_hood_ids
             or (o.neighborhood_ids is null
                 and o.lat is not null and o.lng is not null
                 and public.neighborhood_for_city_point(v_city_id, v_city, o.lat, o.lng) = any(v_hood_ids))
           when 'street' then
             public.property_text_key(o.street) = v_st_key
             and (not v_use_house
                  or public.property_text_key(o.house_number) = public.property_text_key(v_house))
           when 'street_partial' then
             length(coalesce(public.property_text_key(o.street), '')) >= 3
             and (public.property_text_key(o.street) like '%' || v_st_key || '%'
                  or v_st_key like '%' || public.property_text_key(o.street) || '%')
           else true   -- city
         end
       )
  )
  select coalesce(jsonb_agg((to_jsonb(d) - 'rn' - 'total' - 'n_name' - 'n_pin') order by d.rn), '[]'::jsonb),
         max(d.total), max(d.n_name), max(d.n_pin)
    into v_deals, v_total, v_by_name, v_by_pin
    from (
      select p.*,
             row_number() over (order by p.sold_at desc,
                                         p.distance_meters asc nulls last) as rn,
             count(*) over () as total,
             count(*) filter (where p.matched_by = 'name') over () as n_name,
             count(*) filter (where p.matched_by = 'location') over () as n_pin
        from pool p
    ) d
   where d.rn <= v_limit;

  if coalesce(v_total, 0) = 0 then
    select jsonb_build_object(
             'deals_in_city', count(*),
             'with_street',   count(*) filter (where o.street is not null),
             'with_location', count(*) filter (where o.lat is not null),
             'first_sold_at', min(o.sold_at),
             'last_sold_at',  max(o.sold_at),
             'top_streets',   coalesce((
               select jsonb_agg(jsonb_build_object('street', s.street, 'deals', s.n) order by s.n desc)
                 from (select o2.street, count(*) as n
                         from public.market_deals_official o2
                        where public.property_text_key(o2.city) = v_city_key
                          and o2.street is not null
                        group by o2.street
                        order by count(*) desc
                        limit 15) s), '[]'::jsonb),
             -- השכונות עם הכי הרבה עסקאות, כמו top_streets
             'top_neighborhoods', coalesce((
               select jsonb_agg(jsonb_build_object('neighborhood', s.name, 'deals', s.n) order by s.n desc)
                 from (select n.name, count(*) as n
                         from public.market_deals_official o2
                         cross join lateral unnest(o2.neighborhood_ids) h(id)
                         join public.neighborhoods n on n.id = h.id
                        where public.property_text_key(o2.city) = v_city_key
                        group by n.name
                        order by count(*) desc
                        limit 15) s), '[]'::jsonb))
      into v_coverage
      from public.market_deals_official o
     where public.property_text_key(o.city) = v_city_key;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'mode',          v_mode,
    'city',          v_city,
    'radius_meters', case when v_mode = 'radius' then v_radius end,
    'neighborhood',  case when v_mode = 'neighborhood' then array_to_string(v_hood_names, ', ') end,
    'neighborhood_from_street', case when v_mode = 'neighborhood' then v_from_street end,
    'matched_by_name',     case when v_mode = 'neighborhood' then coalesce(v_by_name, 0) end,
    'matched_by_location', case when v_mode = 'neighborhood' then coalesce(v_by_pin, 0) end,
    'months',        v_months,
    'oldest_considered', v_cutoff,
    'house_number_applied', v_use_house,
    'returned',      jsonb_array_length(coalesce(v_deals, '[]'::jsonb)),
    'total_found',   coalesce(v_total, 0),
    'source',        'רשות המיסים - מאגר עסקאות מקרקעין',
    'deals',         coalesce(v_deals, '[]'::jsonb),
    'coverage',      v_coverage);
end $$;

comment on function public.agent_market_deals_lookup(uuid, text, double precision, double precision, text, text, integer, integer, integer, text, text) is
  'עסקאות רשמיות לסוכן/ת (Elite): רדיוס, שכונה, רחוב, רחוב דומה או עיר. עיר בכינוי ("תל אביב") נפתרת לשם שבמאגר דרך city_id_for_name (20271109180000).';

revoke all on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. cma_locate_address - רחוב ארוך
-- ---------------------------------------------------------------------------
create or replace function public.cma_locate_address(p_city text, p_street text, p_house_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city  text := btrim(coalesce(p_city, ''));
  v_sk    text := public.street_name_key(p_street);
  v_num   text := btrim(coalesce(p_house_number, ''));
  v_n     integer := nullif(substring(btrim(coalesce(p_house_number, '')) from '^\d+'), '')::integer;
  v_cid   uuid;
  v_names text[];
  v_out   jsonb;
  v_parcel jsonb;
begin
  if v_city = '' or coalesce(v_sk, '') = '' then return null; end if;

  -- שמות העיר כפי שהם רשומים בעסקאות - אותו היגיון של address_parcel_from_deals
  if exists (select 1 from public.market_deals_official m where m.city = v_city limit 1) then
    v_names := array[v_city];
  else
    v_cid := public.city_id_for_name(v_city);
    if v_cid is null then return null; end if;
    with k as (
      select public.city_name_key(c.name) as key from public.cities c where c.id = v_cid
      union
      select a.alias_key from public.city_aliases a where a.city_id = v_cid
    ), names as materialized (
      select distinct m.city as name from public.market_deals_official m where m.city is not null
    )
    select array_agg(n.name) into v_names from names n where public.city_name_key(n.name) in (select key from k);
    if v_names is null then return null; end if;
  end if;

  -- 1. עסקה בכתובת עצמה
  if v_num <> '' then
    select jsonb_build_object('lat', avg(m.lat), 'lng', avg(m.lng), 'precision', 'address_deal')
      into v_out
      from public.market_deals_official m
     where m.city = any (v_names)
       and btrim(m.house_number) = v_num
       and public.street_name_key(m.street) = v_sk
       and m.lat is not null and m.lng is not null
    having count(*) > 0;
    if v_out is not null then return v_out; end if;

    -- 2. מרכז החלקה
    v_parcel := public.address_parcel_from_deals(v_city, p_street, v_num);
    if v_parcel is not null then
      select jsonb_build_object('lat', avg(po.lat)::double precision, 'lng', avg(po.lng)::double precision,
                                'precision', 'parcel')
        into v_out
        from public.parcels_open po
       where po.gush  = (v_parcel->>'gush')::integer
         and po.helka = (v_parcel->>'helka')::integer
         and po.lat is not null and po.lng is not null
      having count(*) > 0;
      if v_out is not null then return v_out; end if;
    end if;
  end if;

  -- 3. מספר הבית הקרוב באותו רחוב. עד 80 מספרים (היה 30): ברחוב ארוך של
  --    עיר גדולה - דיזנגוף, אבן גבירול - 30 מספרים הם כמה מאות מטרים בלבד,
  --    ו"דיזנגוף 100" חזר null כשיש עסקאות ב-132 וב-140. 80 מספרים הם עדיין
  --    אותו קטע רחוב, והדיוק ('street_nearest' עם המספר) נאמר בדוח.
  if v_n is not null then
    select jsonb_build_object('lat', s.lat, 'lng', s.lng, 'precision', 'street_nearest',
                              'nearest_house_number', s.house_number)
      into v_out
      from (
        select m.lat, m.lng, btrim(m.house_number) as house_number,
               abs(nullif(substring(btrim(m.house_number) from '^\d+'), '')::integer - v_n) as diff
          from public.market_deals_official m
         where m.city = any (v_names)
           and public.street_name_key(m.street) = v_sk
           and m.lat is not null and m.lng is not null
           and btrim(coalesce(m.house_number, '')) ~ '^\d+'
      ) s
     where s.diff <= 80
     order by s.diff,
              -- אותו צד של הרחוב (זוגי/אי-זוגי) קודם
              case when (s.diff % 2) = 0 then 0 else 1 end
     limit 1;
    if v_out is not null then return v_out; end if;
  end if;

  -- 4. בלי מספר בית, או בלי מספר קרוב - מרכז העסקאות ברחוב. ‏precision =
  --    'street' אומר לדוח ולבוט שהמיקום הוא הרחוב ולא הבניין.
  select jsonb_build_object('lat', avg(m.lat), 'lng', avg(m.lng), 'precision', 'street')
    into v_out
    from public.market_deals_official m
   where m.city = any (v_names)
     and public.street_name_key(m.street) = v_sk
     and m.lat is not null and m.lng is not null
  having count(*) > 0;
  return v_out;
end;
$$;

comment on function public.cma_locate_address(text, text, text) is
  'מיקום לכתובת מהמסד בלבד (בשרת אסור GovMap): עסקה בכתובת, מרכז החלקה, מספר הבית הקרוב (עד 80), ואז מרכז הרחוב. precision אומר מה נמצא. 20270819090000, 20271109180000.';

revoke all on function public.cma_locate_address(text, text, text) from public, anon, authenticated;
grant execute on function public.cma_locate_address(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- אימות
-- ---------------------------------------------------------------------------
do $$
declare
  v_ta uuid := public.city_id_for_name('תל אביב');
  v_loc jsonb;
begin
  if v_ta is null then
    raise warning '"תל אביב" עדיין אינה נפתרת לעיר - לבדוק את city_aliases';
  else
    raise notice '"תל אביב" -> %', (select name from public.cities where id = v_ta);
  end if;
  v_loc := public.cma_locate_address('תל אביב', 'דיזנגוף', '100');
  raise notice 'דיזנגוף 100 תל אביב -> %', coalesce(v_loc::text, 'null');
end $$;
