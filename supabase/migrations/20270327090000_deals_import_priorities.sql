-- ===========================================================================
-- ייבוא עסקאות: אילו ערים בשווקים שלנו חסרות עסקאות, ובאיזה סדר לייבא
-- ===========================================================================
--
-- ‏market_deals_coverage() מראה רק ערים **שכבר יש בהן** עסקאות. עיר בלי אף
-- עסקה פשוט לא מופיעה בה, ולכן מסך ההדבקה לא אמר מה חסר. ב-9.10.2026 היו
-- 243 ערים משויכות לשווקים, ורק 29 מהן עם עסקאות - כל שוק חדרה (43 ערים,
-- כ-325 אלף תושבים) ריק לגמרי.
--
-- הפונקציה מחזירה שורה לכל עיר בשוק, עם המדדים שלפיהם מחליטים מה לייבא קודם.
-- המיון והסינון בדפדפן; הציון כאן כדי שיהיה אחד.
--
--   need   1 אם אין עסקאות, 0.6 אם האחרונה בת חצי שנה ויותר,
--          0.3 אם בת שלושה חודשים ויותר, אחרת 0
--   weight אוכלוסייה/1000 + מתווכים ברשם/5 + נכסים פעילים × 2
--          + חיפושי עסקאות שחזרו ריקים × 3
--   score  need × weight, מעוגל. עיר מעודכנת מקבלת 0.
--
-- הערים מזוהות לפי city_name_key, כמו בשאר המודיעין: market_deals_official
-- שומרת שם עיר ולא מזהה.
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
    select public.city_name_key(o.city) as k, count(*)::int as n, max(o.sold_at) as newest
      from public.market_deals_official o
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

revoke all on function public.deals_import_priorities() from public, anon;
grant execute on function public.deals_import_priorities() to authenticated, service_role;
