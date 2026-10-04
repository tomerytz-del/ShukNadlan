-- ============================================================================
-- חיפוש עסקאות לפי שכונה: גם לפי מיקום, כשרשות המיסים לא רשמה שם
--
-- ## מה קרה (4.10.2026, בדיקה בוואטסאפ אחרי 20270211090000)
--
-- "עסקאות בגבעת המורה" עבד (147). "עסקאות בעפולה עילית" ו"בשכונת לב העמק"
-- החזירו אפס. הסיבה בנתונים: ברשות המיסים רשומים בעפולה רק ארבעה שמות
-- שכונה שמותאמים אצלנו - דרום העיר, מרכז העיר, רובע יזרעאל וגבעת המורה.
-- לכל השאר אין שם, או שם שאין לנו ("עפולה הצעירה"). אבל לרובן **יש פין**:
--
-- | שכונה | לפי שם | פין במצולע אחד, בלי שם מותאם |
-- | --- | --- | --- |
-- | עפולה הירוקה | 0 | 293 |
-- | לב העמק C1 | 0 | 138 |
-- | עפולה עלית | 0 | 109 |
-- | אזור התעשייה | 0 | 32 |
-- | מזרח העיר | 0 | 13 |
-- | מערב העיר (שיכון גאולים) | 0 | 12 |
--
-- ## מה משתנה
--
-- במצב `neighborhood` עסקה נכללת אם:
--
--   1. שם השכונה שלה במאגר מצביע על השכונה (כמו קודם), **או**
--   2. אין לה שם מותאם (`neighborhood_ids` null) והפין שלה נופל במצולע של
--      השכונה - ורק אם הוא נופל במצולע **אחד ויחיד**
--      (`neighborhood_for_city_point`, אותו חוזה של שיוך נכסים).
--
-- **השם גובר על המיקום, ולא מצטרפים זה לזה.** עסקה שרשות המיסים שייכה
-- לשכונה נשארת שם גם כשהפין שלה נופל במצולע אחר, כי גבולות השמות שלה
-- אינם הגבולות שלנו ("מרכז העיר" שלה רחב משלנו). כך אף עסקה אינה נספרת
-- בשתי שכונות שונות בשתי שאלות שונות.
--
-- בתשובה: `matched_by` לכל עסקה, ו-`matched_by_name` / `matched_by_location`,
-- כדי שהעוזר יאמר מה מקור השיוך. ‏`neighborhood_ids` עצמה **לא** משתנה -
-- שכבת השכונה בדוח ה-CMA (עסקאות בלי פין) אינה מושפעת.
-- ============================================================================

create or replace function public.agent_market_deals_lookup(
  p_agent_id      uuid,
  p_city          text,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_street        text            default null,
  p_house_number  text            default null,
  p_radius_m      integer         default 300,
  p_months        integer         default 24,
  p_limit         integer         default 5,
  p_property_type text            default null,
  p_neighborhood  text            default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
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
             -- חדש: השכונות עם הכי הרבה עסקאות, כמו top_streets
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

comment on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text, text) is
  'עסקאות רשות המיסים: ברדיוס, בשכונה, ברחוב (מדויק ואז חלקי), או בעיר כולה. כשאין תוצאה - coverage. Elite בלבד. מיגרציה 20270211092000.';

revoke all on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text, text)
  to service_role;
