-- ============================================================================
-- עסקאות לפי גוש/חלקה - לעוזר בוואטסאפ
--
-- ‏`agent_market_deals_lookup` מקבלת רחוב או נקודה. אבל סוכנים שואלים גם כך
-- ("איזה עסקאות היו באזור גוש 16679 חלקה 58", 26.9.2026), ולקרקע, לבנייה
-- חדשה ולשכונה שנרשמה לפי מגרש - גוש/חלקה הם הכתובת היחידה.
--
-- ## בלי GIS ובלי GovMap
--
-- כל 15,191 העסקאות במאגר נושאות גוש וחלקה, ולחלק גדול מהן יש מיקום. לכן
-- התשובה כולה מהנתונים שלנו, **בכל עיר ולא רק בעפולה**:
--
--   1. ‏`in_parcel` - העסקאות בחלקה עצמה (או בגוש כולו, בלי חלקה).
--   2. ‏`center` - ממוצע המיקום של העסקאות בחלקה (ואם אין - בגוש).
--   3. ‏`nearby` - ‏`agent_market_deals_lookup` ברדיוס סביב המרכז הזה. אותה
--      פונקציה בדיוק, עם אותו גייט ואותה צורת תשובה - לא עותק שלה.
--
-- ## הגייט
--
-- ‏Elite בלבד, בדיוק כמו `agent_market_deals_lookup` (מסלול, `active`,
-- ‏`billing_status`). הבדיקה כאן כי `in_parcel` נקרא ישירות מהמאגר ולא דרכה.
-- ============================================================================

create or replace function public.agent_market_deals_by_parcel(
  p_agent_id uuid,
  p_gush     text,
  p_helka    text    default null,
  p_months   integer default 24,
  p_limit    integer default 5,
  p_radius_m integer default 300
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_tier    text;
  v_gush    integer := public.land_parcel_num(p_gush);
  v_helka   integer := public.land_parcel_num(p_helka);
  v_months  integer := least(greatest(coalesce(p_months, 24), 1), 120);
  v_limit   integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_cutoff  date;
  v_deals   jsonb;
  v_total   integer;
  v_all     integer;
  v_lat     double precision;
  v_lng     double precision;
  v_center  text := null;
  v_city    text;
  v_nearby  jsonb := null;
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

  if v_gush is null then
    return jsonb_build_object('error', 'gush_required', 'detail', 'צריך מספר גוש.');
  end if;

  v_cutoff := (current_date - (v_months || ' months')::interval)::date;

  -- 1. בחלקה עצמה (או בגוש כולו)
  with pool as (
    select o.city, o.street, o.house_number, o.gush, o.helka,
           o.property_type, o.rooms, o.floor, o.size_sqm, o.sale_price, o.sold_at,
           case when o.size_sqm > 0 then round(o.sale_price / o.size_sqm) end as price_per_sqm
      from public.market_deals_official o
     where public.land_parcel_num(o.gush) = v_gush
       and (v_helka is null or public.land_parcel_num(o.helka) = v_helka)
       and o.sold_at >= v_cutoff
  )
  select coalesce(jsonb_agg((to_jsonb(d) - 'rn' - 'total') order by d.rn), '[]'::jsonb),
         max(d.total)
    into v_deals, v_total
    from (select p.*, row_number() over (order by p.sold_at desc) as rn,
                 count(*) over () as total
            from pool p) d
   where d.rn <= v_limit;

  -- כמה יש בכלל, בלי חלון הזמן: "אין עסקאות בשנתיים" ו"אין עסקאות אף פעם"
  -- הם שתי תשובות שונות.
  select count(*) into v_all
    from public.market_deals_official o
   where public.land_parcel_num(o.gush) = v_gush
     and (v_helka is null or public.land_parcel_num(o.helka) = v_helka);

  -- 2. המרכז: מהחלקה, ואם אין בה מיקום - מהגוש. בכל התקופות, כי זה מיקום
  -- ולא מחיר.
  if v_helka is not null then
    select avg(o.lat), avg(o.lng) into v_lat, v_lng
      from public.market_deals_official o
     where public.land_parcel_num(o.gush) = v_gush
       and public.land_parcel_num(o.helka) = v_helka
       and o.lat is not null and o.lng is not null;
    if v_lat is not null then v_center := 'parcel'; end if;
  end if;

  if v_lat is null then
    select avg(o.lat), avg(o.lng) into v_lat, v_lng
      from public.market_deals_official o
     where public.land_parcel_num(o.gush) = v_gush
       and o.lat is not null and o.lng is not null;
    if v_lat is not null then v_center := 'gush'; end if;
  end if;

  -- העיר הנפוצה בגוש - גוש יושב ביישוב אחד, והרדיוס של agent_market_deals_lookup
  -- מסנן לפי עיר.
  select o.city into v_city
    from public.market_deals_official o
   where public.land_parcel_num(o.gush) = v_gush and o.city is not null
   group by o.city order by count(*) desc limit 1;

  -- 3. ברדיוס סביב המרכז - דרך הפונקציה הקיימת, לא עותק שלה.
  if v_lat is not null and v_city is not null then
    v_nearby := public.agent_market_deals_lookup(
      p_agent_id, v_city, v_lat, v_lng, null, null, p_radius_m, v_months, v_limit, null);
  end if;

  return jsonb_build_object(
    'ok',               true,
    'mode',             case when v_helka is null then 'gush' else 'parcel' end,
    'gush',             v_gush,
    'helka',            v_helka,
    'city',             v_city,
    'months',           v_months,
    'oldest_considered', v_cutoff,
    'in_parcel',        coalesce(v_deals, '[]'::jsonb),
    'in_parcel_total',  coalesce(v_total, 0),
    'in_parcel_all_time', v_all,
    'center',           case when v_lat is null then null
                             else jsonb_build_object('lat', v_lat, 'lng', v_lng, 'from', v_center) end,
    'nearby',           v_nearby,
    'source',           'רשות המיסים - מאגר עסקאות מקרקעין');
end $$;

comment on function public.agent_market_deals_by_parcel(uuid, text, text, integer, integer, integer) is
  'עסקאות לפי גוש/חלקה: בחלקה עצמה, ומסביב למרכז שלה (דרך agent_market_deals_lookup). Elite בלבד. מיגרציה 20270115096000.';

revoke all on function public.agent_market_deals_by_parcel(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.agent_market_deals_by_parcel(uuid, text, text, integer, integer, integer)
  to service_role;
