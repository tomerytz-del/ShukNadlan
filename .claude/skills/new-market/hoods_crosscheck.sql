-- ===========================================================================
-- הצלבת שכונות מול רשות המיסים - קריאה בלבד. להריץ ב-execute_sql (select).
-- ‏docs/market-opening-runbook.md, שלב 5; הסקיל new-market.
--
-- אחרי שייבוא השכונות מ-GovMap נשמר: אילו שמות שכונה ברשות המיסים אין להם
-- שכונה אצלנו, ומה הפינים שלהם. השאילתות 1 ו-2 מזינות את
-- scripts/hood_polygons.py; מחליפים 'hadera' ב-slug של השוק, בשלושתן.
--
--   python3 scripts/hood_polygons.py --pins pins.json --polygons polygons.json \
--       [--migration supabase/migrations/<גרסה>_<שם>.sql --include-aliases]
--
-- התשובה הגדולה נשמרת לקובץ על ידי הכלי; מעבירים את הנתיב שלו. הסקריפט מקבל גם
-- את העטיפה של execute_sql.
-- ===========================================================================

-- 0. מה חסר, בקצרה: שמות בלי שכונה ובלי כינוי, ועם כמה פינים. להחליט לפי זה אם
--    יש מה להריץ. שם עם 8 פינים ומעלה נכנס לשאילתה 1.
with c as (select id, name from public.cities where market_slug = 'hadera' and active)
select c.name as עיר, o.neighborhood as שם_ברשות_המיסים,
       count(*) as עסקאות, count(*) filter (where o.lat is not null) as עם_פין
  from c
  join public.market_deals_official o on public.property_text_key(o.city) = public.property_text_key(c.name)
 where coalesce(o.neighborhood, '') <> ''
   and not exists (select 1 from public.neighborhoods n
                    where n.city_id = c.id
                      and public.neighborhood_name_key(n.name) = public.neighborhood_name_key(o.neighborhood))
   and not exists (select 1 from public.neighborhood_aliases a
                     join public.neighborhoods n on n.id = a.neighborhood_id
                    where n.city_id = c.id
                      and a.alias_key = public.neighborhood_name_key(o.neighborhood))
 group by 1, 2
 order by 3 desc;

-- 1. הפינים: --pins. כל הפינים של השמות שבשאילתה 0 עם 8 פינים ומעלה, כולל אלה
--    שבתוך מצולע קיים (הסקריפט מזהה מהם כינויים).
with c as (select id, name from public.cities where market_slug = 'hadera' and active),
unm as (
  select c.id as city_id, c.name as city, o.neighborhood as hood
    from c
    join public.market_deals_official o on public.property_text_key(o.city) = public.property_text_key(c.name)
   where coalesce(o.neighborhood, '') <> ''
     and not exists (select 1 from public.neighborhoods n
                      where n.city_id = c.id
                        and public.neighborhood_name_key(n.name) = public.neighborhood_name_key(o.neighborhood))
     and not exists (select 1 from public.neighborhood_aliases a
                       join public.neighborhoods n on n.id = a.neighborhood_id
                      where n.city_id = c.id
                        and a.alias_key = public.neighborhood_name_key(o.neighborhood))
   group by 1, 2, 3
  having count(*) filter (where o.lat is not null) >= 8
)
select unm.city, unm.hood, round(o.lat::numeric, 5) as lat, round(o.lng::numeric, 5) as lng
  from unm
  join public.market_deals_official o
    on public.property_text_key(o.city) = public.property_text_key(unm.city) and o.neighborhood = unm.hood
 where o.lat is not null
 order by unm.city, unm.hood;

-- 2. המצולעים הקיימים של השוק: --polygons. אי אפשר להחזיר מצולע חופף למצולע
--    מדויק, ולכן הסקריפט צריך את כולם.
select c.name as city, n.name, n.boundary
  from public.neighborhoods n
  join public.cities c on c.id = n.city_id
 where c.market_slug = 'hadera' and c.active and n.boundary is not null
 order by c.name, n.name;
