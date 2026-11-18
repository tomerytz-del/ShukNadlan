-- ===========================================================================
-- deals_import_priorities: מפתח העיר מחושב לכל עיר, לא לכל עסקה
--
-- ## מה היה איטי
-- ה-CTE הראשון קיבץ לפי city_name_key(o.city) - שש החלפות regex - על כל
-- אחת מ-84 אלף העסקאות ב-market_deals_official. במסד פנוי זה 1.5 שניות
-- של CPU (נמדד ב-18.11.2026), בכל פתיחה של "ייבוא עסקאות" ב-CRM של
-- מנהל/ת הפלטפורמה, ובדקות עמוסות הקריאה נפלה ב-statement timeout.
--
-- ## מה נכנס
-- קיבוץ לפי שם העיר הגולמי קודם (כ-600 קבוצות, index only scan), ורק אז
-- city_name_key על כל קבוצה וקיבוץ שני. sum של count ו-max של max נותנים
-- בדיוק אותה תוצאה: נבדק בפרודקשן ב-except לשני הכיוונים, 591 שורות,
-- אפס הבדלים. 1,489ms -> 254ms.
--
-- שאר הגוף הוא העתק מ-20270327090000 (md5(prosrc) בפרודקשן אומת מול הקובץ).
-- ההרשאות נכתבות מחדש עם שלושת התפקידים בשם; authenticated מקבל grant
-- כי הפאנל קורא מהדפדפן, והבדיקה current_is_platform_admin() בגוף.
-- ===========================================================================

create or replace function public.deals_import_priorities()
returns table (
  city_id         uuid,
  city            text,
  market_slug     text,
  population      integer,
  deals           integer,
  newest          date,
  active_props    integer,
  registry        integer,
  agencies        integer,
  gap_hits        integer,
  score           integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return query
  with d as (
    -- קודם לפי השם הגולמי (כמה מאות קבוצות, מהאינדקס), ורק אז המפתח
    select public.city_name_key(x.city) as k, sum(x.n)::int as n, max(x.newest) as newest
      from (select o.city, count(*) as n, max(o.sold_at) as newest
              from public.market_deals_official o
             group by o.city) x
     group by 1
  ), g as (
    select x.city_key as k, sum(x.hits)::int as hits
      from public.market_deal_gaps x
     where x.resolved_at is null
     group by 1
  ), r as (
    select x.city_key as k, sum(x.brokers)::int as brokers
      from public.market_intel_registry x
     group by 1
  ), base as (
    select c.id, c.name, c.market_slug, c.population,
           coalesce(d.n, 0) as n, d.newest,
           (select count(*) from public.properties p
             where p.city_id = c.id and p.status = 'active')::int as props,
           r.brokers,
           (select count(*) from public.agencies a where a.city_id = c.id)::int as ags,
           coalesce(g.hits, 0) as hits
      from public.cities c
      left join d on d.k = public.city_name_key(c.name)
      left join g on g.k = public.city_name_key(c.name)
      left join r on r.k = public.city_name_key(c.name)
     where c.market_slug is not null
  )
  select b.id, b.name, b.market_slug, b.population, b.n, b.newest, b.props,
         b.brokers, b.ags, b.hits,
         round(
           (case when b.n = 0 then 1.0
                 when b.newest < current_date - interval '6 months' then 0.6
                 when b.newest < current_date - interval '3 months' then 0.3
                 else 0 end)
           * (coalesce(b.population, 0) / 1000.0 + coalesce(b.brokers, 0) / 5.0
              + b.props * 2 + b.hits * 3)
         )::int
    from base b;
end;
$$;

comment on function public.deals_import_priorities() is
  'שורה לכל עיר בשוק: עסקאות במאגר, טריות, אוכלוסייה, רשם, נכסים, חיפושים ריקים וציון עדיפות לייבוא. מנהל/ת פלטפורמה בלבד. docs/market-deals-official.md';

revoke all on function public.deals_import_priorities() from public, anon, authenticated;
grant execute on function public.deals_import_priorities() to authenticated, service_role;
