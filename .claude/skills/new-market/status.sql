-- ===========================================================================
-- מצב השווקים - קריאה בלבד. להריץ ב-execute_sql (select) או בדשבורד.
-- ‏docs/regional-pages.md, הסקילים new-market ו-market-go-live.
--
-- אותן שאלות שהפאנל "שווקים מקומיים" ב-CRM עונה עליהן, בלי להתחבר כמנהל/ת.
-- ===========================================================================

-- 1. כל שוק: ערים, נכסים פעילים, משרדים - ומה חסר עד הסף (משרד ו-10 נכסים)
--    משרד נספר לפי עירו **או** לפי אזור פעילות שחבר/ה בו בחר/ה
--    (‏agency_members.service_markets) - אותו כלל של platform_market_report.
with mk as (
  select c.market_slug as slug,
         count(distinct c.id) as cities,
         count(distinct p.id) filter (where p.status = 'active') as props
    from public.cities c
    left join public.properties p on p.city_id = c.id
   where c.market_slug is not null
   group by c.market_slug
), ag as (
  select c.market_slug as slug, a.id
    from public.agencies a join public.cities c on c.id = a.city_id
   where c.market_slug is not null
  union
  select s.slug, m.agency_id
    from public.agency_members m, unnest(m.service_markets) as s(slug)
   where m.active and m.released_at is null
)
select mk.slug                                              as שוק,
       mk.cities                                            as ערים,
       mk.props                                             as נכסים_פעילים,
       count(ag.id)                                         as משרדים,
       greatest(0, 10 - mk.props)                           as חסרים_נכסים,
       greatest(0, 1 - count(ag.id))                        as חסרים_משרדים
  from mk left join ag on ag.slug = mk.slug
 group by mk.slug, mk.cities, mk.props
 order by 1;

-- 2. נכסים פעילים שאינם שייכים לאף שוק - עיר שלא הוכרה, או עיר בלי שוק.
--    עיר שחוזרת כאן היא מועמדת לשורה במיגרציה או לכינוי ב-city_aliases.
select coalesce(nullif(btrim(p.city), ''), '(ללא עיר)') as עיר,
       count(*)                                         as נכסים
  from public.properties p
  left join public.cities c on c.id = p.city_id
 where p.status = 'active' and c.market_slug is null
 group by 1
 order by 2 desc;

-- 3. משרדים בלי עיר - לא יופיעו באף שוק עד שתהיה להם כתובת
select a.name as משרד, a.address as כתובת, a.created_at::date as נוצר
  from public.agencies a
 where a.city_id is null
 order by a.created_at desc;
