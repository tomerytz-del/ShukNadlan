-- ============================================================================
-- שאילתת עסקאות היסטוריות: "מה נמכר ליד הכתובת הזו"
--
-- דוח ה-CMA עונה על שאלה אחת - "כמה שווה **הנכס הזה**" - והוא מקבל מזהה
-- נכס. השאלה שמתווך/ת שואל/ת בפועל רחבה יותר: "מה נמכר בהרצל 20 בחצי
-- השנה האחרונה", עוד לפני שיש נכס במערכת, ולפעמים כדי להחליט אם בכלל
-- לקחת אותו.
--
-- ‏`market_deals_official` כבר מחזיקה את התשובה (‏`(city, sold_at desc)`
-- באינדקס), ומה שחסר הוא הדלת. הטבלה היא **ללא הרשאות** ל-`anon` ול-
-- `authenticated`, ו-`agent_cma_report` הייתה עד כה הדלת היחידה.
--
-- ## למה רדיוס ולא התאמת רחוב
--
-- התאמה על שם רחוב היא התאמה מדויקת על טקסט, והיא שבירה בדיוק במקום
-- שבו הריפו כבר שילם: ‏`יהושע` מול `יהושוע`, ‏`אוסישקין` מול `אושיסקין`
-- (‏docs/street-registry.md). רדיוס סביב נקודה חסין לכתיב, והוא גם עונה
-- על השאלה הנכונה - מי שמתעניין/ת בהרצל 20 מתעניין/ת גם בהרצל 22.
--
-- הגאוקוד עצמו **אינו כאן**: הוא שכבת WFS עירונית, כלומר Edge Function.
-- הקורא מגאוקד ומעביר `lat`/`lng`. מי שאין לו נקודה נופל למצב `street`,
-- שהוא **נחות ומסומן ככזה** בערך המוחזר, כדי שהעוזר יוכל לומר את זה.
--
-- ## מה חוזר, ולמה הכול
--
-- **הכול.** רחוב, מספר בית, שכונה, גוש, חלקה, תת-חלקה, סוג, חדרים, קומה,
-- מ"ר, מחיר, מחיר למ"ר, תאריך ומרחק.
--
-- זה אינו סותר את מדיניות הצנזור בדף הנכס, וההבחנה חשובה: מה שמוסתר שם
-- הוא **פרטים מזהים של נכס שמתווך/ת מפרסם/ת אצלנו** - הכתובת המדויקת
-- שגולש/ת יכול/ה לעקוף בה את המתווך/ת. כאן מדובר במאגר עסקאות שהושלמו
-- של **רשות המיסים**, נתון ציבורי מדווח, ובעל/ת הנכס כבר מכר/ה.
--
-- ‏**`market_deals` אינה נכללת כאן בכוונה.** היא מחזיקה `agency_id` ו-
-- `agent_id`, ושורה שם היא עסקה שמשרד אחר סגר. הדוח מצרף אותה לאגרגט
-- (שם היא מספר בתוך ממוצע), אבל רשימה מפורטת הייתה חושפת את ביצועי
-- המתחרים שורה-שורה. זו הרחבה שלא התבקשה, ולכן אינה נעשית.
--
-- ## המסלול: Elite בלבד
--
-- הגייט במסד ולא ב-UI, כמו `property_map_view`, `property_video_tier`,
-- `property_description_tier_ok` ו-`notification_push_due_agents`.
-- ‏`premium` הוא המזהה; ‏Elite הוא התצוגה (‏assets/tiers.js).
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
  v_tier    text;
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_radius  integer := least(greatest(coalesce(p_radius_m, 300), 50), 5000);
  v_months  integer := least(greatest(coalesce(p_months, 24), 1), 120);
  v_limit   integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_cutoff  date;
  v_mode    text;
  v_deals   jsonb;
  v_total   integer;
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

  v_cutoff := (current_date - (v_months || ' months')::interval)::date;

  -- מצב הרדיוס דורש **שתי** קואורדינטות. אחת בלבד אינה נקודה, והיא
  -- הייתה מייצרת מרחק מ-null שמתנהג כמו "הכול בטווח".
  v_mode := case when p_lat is not null and p_lng is not null
                 then 'radius' else 'street' end;

  if v_mode = 'street'
     and nullif(btrim(coalesce(p_street, '')), '') is null then
    return jsonb_build_object('error', 'location_required',
      'detail', 'צריך קואורדינטה או שם רחוב.');
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
     where public.property_text_key(o.city) = public.property_text_key(v_city)
       and o.sold_at >= v_cutoff
       and (p_property_type is null
            or o.property_type is not distinct from p_property_type)
       and (
         case when v_mode = 'radius'
              then o.lat is not null and o.lng is not null
                   and public.geo_distance_meters(p_lat, p_lng, o.lat, o.lng) <= v_radius
              else public.property_text_key(o.street)
                     = public.property_text_key(p_street)
                   and (nullif(btrim(coalesce(p_house_number, '')), '') is null
                        or public.property_text_key(o.house_number)
                           = public.property_text_key(p_house_number))
         end
       )
  )
  -- ‏`- 'rn' - 'total'`: שתי העמודות הן פיגום של החלונות ולא נתון של
  -- העסקה. בלעדיהן כל אובייקט היה נושא מספר שורה ומונה כולל, והעוזר
  -- היה מצטט אותם כאילו הם חלק מהעסקה.
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

  return jsonb_build_object(
    'ok',            true,
    'mode',          v_mode,
    'city',          v_city,
    'radius_meters', case when v_mode = 'radius' then v_radius end,
    'months',        v_months,
    'oldest_considered', v_cutoff,
    'returned',      jsonb_array_length(coalesce(v_deals, '[]'::jsonb)),
    'total_found',   coalesce(v_total, 0),
    'source',        'רשות המיסים - מאגר עסקאות מקרקעין',
    'deals',         coalesce(v_deals, '[]'::jsonb));
end $$;

comment on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text) is
  'עסקאות רשות המיסים סביב נקודה או ברחוב. Elite בלבד. p_agent_id מפורש כי ל-Edge Function אין JWT.';

-- העטיפה לדפדפן, באותה תבנית של cma_report מעל agent_cma_report: מזהה
-- הסוכן/ת נגזר מה-JWT ואינו פרמטר. פונקציה שמקבלת p_agent_id ופתוחה ל-
-- authenticated הייתה מאפשרת לכל סוכן/ת לשאול בשם אחר/ת.
create or replace function public.market_deals_lookup(
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
language sql
stable
security definer
set search_path to ''
as $$
  select public.agent_market_deals_lookup(
    public.current_agent_id(), p_city, p_lat, p_lng,
    p_street, p_house_number, p_radius_m, p_months, p_limit, p_property_type);
$$;

-- ההרשאות, במפורש. ברירת המחדל של Postgres היא EXECUTE ל-PUBLIC,
-- ו-PostgREST חושף כל פונקציה ב-/rest/v1/rpc/<שם>.
revoke all on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.agent_market_deals_lookup(
  uuid, text, double precision, double precision, text, text, integer, integer, integer, text)
  to service_role;

revoke all on function public.market_deals_lookup(
  text, double precision, double precision, text, text, integer, integer, integer, text)
  from public, anon;
grant execute on function public.market_deals_lookup(
  text, double precision, double precision, text, text, integer, integer, integer, text)
  to authenticated, service_role;
