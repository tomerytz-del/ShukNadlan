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

-- 4. יישובים בלי שוק, לפי נפה - בדיקת הפערים לפני ואחרי כל גל של שווקים.
--    יישובים ערביים, בדואיים ודרוזיים נשארים מחוץ לשווקים בהחלטה (18.10.2026),
--    וכך גם מחנות צבא ומוסדות. כל יישוב יהודי אחר שחוזר כאן הוא פער: שורה
--    במיגרציה (docs/regional-pages.md, "מה נשאר בלי שוק").
--    אין עמודת מגזר ב-cities, ולכן ההכרעה ביד - לפי השם.
select cbs_nafa                                   as נפה,
       count(*)                                   as יישובים,
       sum(coalesce(population, 0))               as תושבים,
       string_agg(name || ' (' || muni_code || ', ' || coalesce(population, 0) || ')', ', '
                  order by population desc nulls last) as היישובים
  from public.cities
 where market_slug is null and active is not false
 group by 1
 order by 3 desc;

-- 5. מוכנות נתונים של שוק - שורה לכל עיר. החליפו את 'hadera' ב-slug של השוק.
--    הספים והסדר: docs/market-opening-runbook.md. קריאה בלבד, ובכוונה בלי
--    neighborhood_for_city_point על כל העסקאות (חורג מ-60 שניות ב-execute_sql);
--    השיוך נמדד לפי neighborhood_ids שהטריגר כבר כתב.
--    pct_hood_linked: מתוך העסקאות שיש להן שם שכונה. yad2/madlan: מודעות חיות.
with c as (
  select id, name, muni_code from public.cities where market_slug = 'hadera' and active
), st as (
  select c.id, count(*) as n from c
    join public.street_registry s on public.property_text_key(s.city) = public.property_text_key(c.name) and s.active
   group by c.id
), dl as (
  select c.id, count(*) as n, max(o.sold_at)::date as last_deal,
         round(100.0 * count(*) filter (where o.street is not null and o.street <> '') / count(*)) as pct_street,
         round(100.0 * count(*) filter (where o.lat is not null) / count(*)) as pct_pin,
         round(100.0 * count(*) filter (where o.neighborhood_ids is not null)
               / nullif(count(*) filter (where coalesce(o.neighborhood, '') <> ''), 0)) as pct_hood_linked
    from c join public.market_deals_official o
      on public.property_text_key(o.city) = public.property_text_key(c.name)
   group by c.id
), pc as (
  select c.id, count(*) as n from c
    join public.parcels_open p on p.locality_code = c.muni_code::integer group by c.id
), nb as (
  select c.id, count(*) as n, count(n.boundary) as bounded from c
    join public.neighborhoods n on n.city_id = c.id group by c.id
), sy as (
  select c.id, max(s.last_synced_at)::date as last_sync, max(s.sync_every_days) as every_days,
         max(s.last_status) as status
    from c join public.deal_settlements s on s.city_id = c.id group by c.id
), li as (
  select c.id,
         count(*) filter (where l.source = 'yad2'   and l.removed_at is null) as yad2_live,
         count(*) filter (where l.source = 'madlan' and l.removed_at is null) as madlan_live,
         max(l.last_seen_at) filter (where l.removed_at is null)::date as last_seen
    from c join public.listing_inventory l on l.city_id = c.id group by c.id
), al as (
  select c.id, count(*) as n from c join public.city_aliases a on a.city_id = c.id group by c.id
)
select c.name as עיר,
       coalesce(st.n, 0) as רחובות,
       coalesce(dl.n, 0) as עסקאות, dl.last_deal as עסקה_אחרונה,
       dl.pct_street as אחוז_רחוב, dl.pct_pin as אחוז_פין, dl.pct_hood_linked as אחוז_שכונה,
       coalesce(pc.n, 0) as חלקות,
       coalesce(nb.n, 0) as שכונות, coalesce(nb.bounded, 0) as עם_גבול,
       sy.last_sync as סנכרון_אחרון, sy.every_days as מחזור_ימים, left(coalesce(sy.status, ''), 18) as סטטוס,
       coalesce(li.yad2_live, 0) as יד2, coalesce(li.madlan_live, 0) as מדלן, li.last_seen as מודעה_אחרונה,
       coalesce(al.n, 0) as כינויי_עיר
  from c
  left join st on st.id = c.id left join dl on dl.id = c.id left join pc on pc.id = c.id
  left join nb on nb.id = c.id left join sy on sy.id = c.id left join li on li.id = c.id
  left join al on al.id = c.id
 order by עסקאות desc nulls last;
