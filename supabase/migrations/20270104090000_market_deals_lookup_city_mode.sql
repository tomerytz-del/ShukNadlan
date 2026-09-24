-- ============================================================================
-- חיפוש עסקאות: מצב עיר, התאמה חלקית של שם רחוב, ומה יש במאגר כשאין תוצאה
--
-- ## מה קרה (24.9.2026, העוזר בוואטסאפ)
--
-- הסוכן/ת הזין/ה ידנית עסקאות בכמה ערים, ושאל/ה את העוזר על נוף הגליל.
-- העוזר ענה "המאגר שלי לא מכסה את נוף הגליל" - **והמאגר מחזיק שם 1,512
-- עסקאות.** שלוש סיבות, וכל אחת שקטה:
--
-- | # | מה | מה עשה העוזר |
-- | --- | --- | --- |
-- | 1 | ‏"איזה עסקאות היו בנוף הגליל" - בלי רחוב. הפונקציה דרשה רחוב או נקודה | ניחש שני רחובות "מרכזיים" |
-- | 2 | ‏"דרך הציונות", "מעלה יצחק", "בן גוריון" - אינם במאגר בשם הזה. GovMap רושם שם "יצחק" (35 עסקאות) | התאמה מדויקת החזירה אפס |
-- | 3 | אפס תוצאות לא אמר **מה כן יש**: כמה עסקאות בעיר, באיזה טווח תאריכים, ובאילו רחובות | הסיק שהעיר אינה במאגר |
--
-- ואין רדיוס מחוץ לעפולה: לעסקאות שם אין קואורדינטות (הגאוקוד הוא של
-- עפולה בלבד), ולכן כל שאלה נופלת למצב רחוב.
--
-- ## מה משתנה
--
-- ‏`mode` מקבל שני ערכים חדשים, וסדר הניסיונות קבוע:
--
-- | מצב | מתי |
-- | --- | --- |
-- | `radius` | יש נקודה (כמו קודם) |
-- | `street` | יש רחוב. מספר בית **מסנן רק אם יש התאמה עם המספר**; אחרת - כל הרחוב |
-- | `street_partial` | ההתאמה המדויקת החזירה אפס: שם שמוכל בשם אחר, בכל כיוון ("מעלה יצחק" ↔ "יצחק"). מסומן, כדי שהעוזר יאמר זאת |
-- | `city` | אין רחוב ואין נקודה: העסקאות האחרונות בעיר |
--
-- וכשהתוצאה ריקה - `coverage`: כמה עסקאות יש בעיר, מאיזה תאריך ועד איזה,
-- ו-15 הרחובות עם הכי הרבה עסקאות. העוזר יכול להציע רחוב אמיתי ולא לנחש.
--
-- ## למה ההתאמה החלקית אינה ברירת המחדל
--
-- "הרצל" מוכל ב"הרצליה". מדויק קודם, וחלקי רק כשהמדויק ריק ובסימון מפורש.
-- מינימום 3 תווים במפתח, אחרת "גן" מתאים לחצי העיר.
--
-- החתימה, ההרשאות והעטיפה `market_deals_lookup` לא משתנות.
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
  p_property_type text            default null
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
  v_radius   integer := least(greatest(coalesce(p_radius_m, 300), 50), 5000);
  v_months   integer := least(greatest(coalesce(p_months, 24), 1), 120);
  v_limit    integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_cutoff   date;
  v_mode     text;
  v_city_key text;
  v_st_key   text;
  v_use_house boolean := false;
  v_deals    jsonb;
  v_total    integer;
  v_coverage jsonb;
begin
  if p_agent_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  -- הגייט. ‏`billing_status` ו-`active` נבדקים כאן ולא רק `tier`, בדיוק
  -- כמו ב-`property_video_tier`: מסלול שפג אינו מסלול.
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

  -- מצב הרדיוס דורש **שתי** קואורדינטות. אחת בלבד אינה נקודה.
  if p_lat is not null and p_lng is not null then
    v_mode := 'radius';
  elsif v_street is not null then
    v_mode := 'street';
    -- מספר בית מסנן רק כשיש לו התאמה. אחרת "הרצל 20" בלי עסקה בבניין
    -- הזה היה מחזיר אפס, כשברחוב יש עשרים.
    if v_house is not null then
      select exists (
        select 1 from public.market_deals_official o
         where public.property_text_key(o.city) = v_city_key
           and o.sold_at >= v_cutoff
           and public.property_text_key(o.street) = v_st_key
           and public.property_text_key(o.house_number) = public.property_text_key(v_house))
        into v_use_house;
    end if;
    -- מדויק ריק -> חלקי, בסימון מפורש
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
           end as distance_meters
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
  select coalesce(jsonb_agg((to_jsonb(d) - 'rn' - 'total') order by d.rn), '[]'::jsonb),
         max(d.total)
    into v_deals, v_total
    from (
      select p.*,
             row_number() over (order by p.sold_at desc,
                                         p.distance_meters asc nulls last) as rn,
             count(*) over () as total
        from pool p
    ) d
   where d.rn <= v_limit;

  -- מה יש במאגר לעיר הזו - רק כשאין תוצאה, כי אז זו התשובה שחסרה.
  -- בלי חלון הזמן: "יש 1,512 עסקאות, מאוגוסט 2025" הוא בדיוק מה שמסביר
  -- למה חיפוש של 36 חודשים לא מצא יותר.
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
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text) is
  'עסקאות רשות המיסים: ברדיוס, ברחוב (מדויק ואז חלקי), או בעיר כולה. כשאין תוצאה - coverage. Elite בלבד. מיגרציה 20270104090000.';

-- ההרשאות נשמרות כמו ב-20261220090000, ונכתבות שוב כי create or replace
-- אינו נוגע בהן - וכדי שהבדיקה של check_function_grants תראה אותן כאן.
revoke all on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text)
  to service_role;
