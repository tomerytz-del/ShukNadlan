-- ===========================================================================
-- מצב השווקים - קריאה בלבד. להריץ ב-execute_sql (select) או בדשבורד.
-- ‏docs/regional-pages.md, הסקילים new-market ו-market-go-live.
--
-- אותן שאלות שהפאנל "שווקים מקומיים" ב-CRM עונה עליהן, בלי להתחבר כמנהל/ת.
-- ===========================================================================

-- 1. כל שוק: ערים, נכסים פעילים, משרדים - ומה חסר עד הסף (משרד ו-10 נכסים)
select c.market_slug                                        as שוק,
       count(distinct c.id)                                 as ערים,
       count(distinct p.id) filter (where p.status = 'active') as נכסים_פעילים,
       count(distinct a.id)                                 as משרדים,
       greatest(0, 10 - count(distinct p.id) filter (where p.status = 'active')) as חסרים_נכסים,
       greatest(0, 1 - count(distinct a.id))                as חסרים_משרדים
  from public.cities c
  left join public.properties p on p.city_id = c.id
  left join public.agencies   a on a.city_id = c.id
 where c.market_slug is not null
 group by c.market_slug
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
