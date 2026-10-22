-- ============================================================================
-- דף לכל שכונה - /n/{עיר}/{שכונה}
--
-- שלב 8 בשדרוג אזור הניהול (docs/admin-redesign/HANDOFF.md, סעיף 8), חלק א.
-- ההעברה הניחה "דף שכונה בלי טקסט כמעט לא מדורג" - אבל דף לשכונה לא היה
-- קיים בכלל. תומר, 22.10.2026: "דף שכונה חדש". החלק הזה בונה את הדף מהנתונים
-- שכבר יש; התיאור שנכתב ב-AI ועובר אישור בתיבת המשימות הוא חלק ב.
--
-- מה בדף, וכולו ציבורי:
--   ‏· הנכסים הפעילים בשכונה (‏status = 'active', כמו בכל האתר), ומחירים.
--   ‏· עסקאות רשות המסים בשכונה (‏market_deals_official.neighborhood_ids),
--     **צבירה בלבד**: מספר, חציון ולפי חדרים. בלי רחוב, מספר בית, גוש וחלקה
--     (docs/property-address-privacy.md) - דף העסקאות של היישוב כבר מציג
--     עסקאות בודדות, וכאן אין צורך בהן.
--   ‏· שכונות אחרות בעיר שיש להן דף.
--
-- **דף דל אינו נכנס לאינדקס:** בלי נכס פעיל ועם פחות מ-5 עסקאות - noindex
-- (‏neighborhood-page.ts), ואינו ב-sitemap. רוב 1,389 השכונות הן כאלה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הכתובת: שם השכונה בעברית, בלי סימנים
--
-- "מערב העיר (שיכון גאולים)" → "מערב-העיר-שיכון-גאולים". עברית בכתובת היא
-- תקינה לגוגל ונקראת לגולש/ת. ייחודיות - בתוך העיר; כפילות (נדיר) נפתרת לפי
-- השכונה הוותיקה, ושתיהן מופיעות ברשימת השכונות.
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_slug(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^0-9a-z֐-׿]+', '-', 'g'),
           '-+', '-', 'g'), '-'), '');
$$;

revoke all on function public.neighborhood_slug(text) from public, anon, authenticated;
grant execute on function public.neighborhood_slug(text) to anon, authenticated, service_role;

alter table public.neighborhoods
  add column if not exists slug text generated always as (public.neighborhood_slug(name)) stored;

create index if not exists neighborhoods_city_slug_idx on public.neighborhoods (city_id, slug);

-- העסקאות של שכונה אחת: ‏`@>` על מערך משתמש ב-GIN, ‏`= any(...)` סורק את כל
-- כ-67 אלף העסקאות (‏1.3 שניות בכל טעינת דף)
create index if not exists market_deals_official_neighborhood_ids_gin
  on public.market_deals_official using gin (neighborhood_ids);

-- ---------------------------------------------------------------------------
-- 2. מי מקבל דף שנכנס לאינדקס - ל-sitemap, לרשימת השכונות בעיר ולקישורים
-- ---------------------------------------------------------------------------

-- ‏הספירה עוברת על כל העסקאות (‏unnest של neighborhood_ids, כ-1.6 שניות),
-- ולכן היא נשמרת בטבלה ומתרעננת כל שעה - כמו market_snapshots. הקריאה
-- מדף הנכס, מדף השכונה ומ-sitemap היא שליפה מהטבלה.
create table if not exists public.neighborhood_page_index (
  city_slug  text not null,
  slug       text not null,
  name       text not null,
  city       text not null,
  props      int  not null default 0,
  deals      int  not null default 0,
  path_key   text not null,
  updated_at timestamptz not null default now(),
  primary key (city_slug, slug)
);

comment on table public.neighborhood_page_index is
  'השכונות שיש להן דף שנכנס לאינדקס (נכס פעיל, או 5 עסקאות ב-24 חודשים). מתרעננת כל שעה (neighborhood-pages-refresh). docs/neighborhood-pages.md';

alter table public.neighborhood_page_index enable row level security;
-- נקראת דרך neighborhood_pages_public (security definer)
revoke all on table public.neighborhood_page_index from anon, authenticated, service_role;
grant select on table public.neighborhood_page_index to service_role;

create or replace function public.neighborhood_pages_refresh()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.neighborhood_page_index;
  with pr as (
    select p.neighborhood_id, count(*)::int n
      from public.properties p
     where p.status = 'active' and p.neighborhood_id is not null
     group by 1
  ), dl as (
    select u.id, count(*)::int n
      from public.market_deals_official o, unnest(o.neighborhood_ids) u(id)
     where o.sold_at > now() - interval '24 months'
     group by 1
  )
  insert into public.neighborhood_page_index (city_slug, slug, name, city, props, deals, path_key)
  select distinct on (c.slug, n.slug)
         c.slug, n.slug, n.name, c.name, coalesce(pr.n, 0), coalesce(dl.n, 0), c.slug || '/' || n.slug
    from public.neighborhoods n
    join public.cities c on c.id = n.city_id
    left join pr on pr.neighborhood_id = n.id
    left join dl on dl.id = n.id
   where c.slug is not null and n.slug is not null
     and (coalesce(pr.n, 0) > 0 or coalesce(dl.n, 0) >= 5)
   order by c.slug, n.slug, n.created_at;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.neighborhood_pages_refresh() from public, anon, authenticated;
grant execute on function public.neighborhood_pages_refresh() to service_role;

select public.neighborhood_pages_refresh();

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - רשימת השכונות לא תתרענן';
    return;
  end if;
  perform cron.unschedule('neighborhood-pages-refresh')
    where exists (select 1 from cron.job where jobname = 'neighborhood-pages-refresh');
  perform cron.schedule('neighborhood-pages-refresh', '23 * * * *',
    'select public.neighborhood_pages_refresh();');
end;
$$;

create or replace function public.neighborhood_pages_public()
returns table (city_slug text, slug text, name text, city text, props int, deals int, path_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.city_slug, i.slug, i.name, i.city, i.props, i.deals, i.path_key
    from public.neighborhood_page_index i
   order by i.city_slug, i.props desc, i.name;
$$;

comment on function public.neighborhood_pages_public() is
  'השכונות שיש להן דף שנכנס לאינדקס: נכס פעיל אחד לפחות, או 5 עסקאות ב-24 חודשים. ל-sitemap ולקישורים בין שכונות. צבירה בלבד. docs/neighborhood-pages.md';

revoke all on function public.neighborhood_pages_public() from public, anon, authenticated;
grant execute on function public.neighborhood_pages_public() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. הנתונים של דף אחד (אחרי 2, כי הוא קורא לה)
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_page(p_city text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select n.id, n.name, n.slug, c.id as city_id, c.name as city, c.slug as city_slug, c.market_slug
      from public.neighborhoods n
      join public.cities c on c.id = n.city_id
     where c.slug = lower(btrim(coalesce(p_city, '')))
       and n.slug = public.neighborhood_slug(p_slug)
     order by n.created_at
     limit 1
  ), p as (
    select pr.id, pr.title, pr.property_type, pr.deal_type, pr.price, pr.rooms, pr.size_sqm,
           pr.images[1] as image, pr.updated_at
      from public.properties pr, h
     where pr.neighborhood_id = h.id and pr.status = 'active'
  ), d as (
    -- אותם גבולות של /deals ו-/prices: מגורים, מחיר ושטח שפויים, 24 חודשים
    select o.sale_price, o.rooms, round(o.sale_price / o.size_sqm) as ppsqm,
           case when o.rooms < 3.5 then 3 when o.rooms < 4.5 then 4
                when o.rooms < 5.5 then 5 else 6 end as bucket,
           o.sold_at
      from public.market_deals_official o, h
     where o.neighborhood_ids @> array[h.id]
       and o.sold_at > (select max(x.sold_at) from public.market_deals_official x
                         where x.neighborhood_ids @> array[h.id]) - interval '24 months'
       and coalesce(o.property_type, 'דירה') not in ('בנין', 'קרקע', 'משק חקלאי')
       and o.size_sqm between 25 and 400
       and o.sale_price between 200000 and 15000000
  ), rooms as (
    select d.bucket, count(*)::int as n,
           round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) as mp,
           round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) as mq
      from d where d.rooms is not null and d.rooms >= 1
     group by d.bucket
  )
  select case when not exists (select 1 from h) then null else jsonb_build_object(
    'name', (select name from h),
    'slug', (select slug from h),
    'city', (select city from h),
    'city_slug', (select city_slug from h),
    'market_slug', (select market_slug from h),
    'props_active', (select count(*) from p),
    'props_sale', (select count(*) from p where p.deal_type = 'sale'),
    'props_rent', (select count(*) from p where p.deal_type = 'rent'),
    'sale_min', (select min(p.price) from p where p.deal_type = 'sale' and p.price > 0),
    'sale_max', (select max(p.price) from p where p.deal_type = 'sale' and p.price > 0),
    'rent_min', (select min(p.price) from p where p.deal_type = 'rent' and p.price > 0),
    'rent_max', (select max(p.price) from p where p.deal_type = 'rent' and p.price > 0),
    'props', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
               select p.id, p.title, p.property_type, p.deal_type, p.price, p.rooms, p.size_sqm, p.image, p.updated_at
                 from p order by p.updated_at desc limit 12) x), '[]'::jsonb),
    'deals', (select count(*) from d),
    'period_start', (select min(d.sold_at) from d),
    'period_end', (select max(d.sold_at) from d),
    'median_price', case when (select count(*) from d) >= 5 then
                      (select round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) from d) end,
    'median_ppsqm', case when (select count(*) from d) >= 5 then
                      (select round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) from d) end,
    'by_rooms', coalesce((select jsonb_agg(jsonb_build_object(
                  'rooms', r.bucket, 'deals', r.n,
                  'median_price', case when r.n >= 5 then r.mp end,
                  'median_ppsqm', case when r.n >= 5 then r.mq end) order by r.bucket) from rooms r), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug) order by s.name)
                  from public.neighborhood_pages_public() s, h
                 where s.city_slug = h.city_slug and s.slug <> h.slug), '[]'::jsonb)
  ) end
$$;

comment on function public.neighborhood_page(text, text) is
  'הנתונים של /n/{עיר}/{שכונה}: הנכסים הפעילים, עסקאות 24 חודשים בצבירה בלבד (תא מתחת ל-5 מושתק), ושכונות אחרות בעיר. null לשכונה לא קיימת. docs/neighborhood-pages.md';

revoke all on function public.neighborhood_page(text, text) from public, anon, authenticated;
grant execute on function public.neighborhood_page(text, text) to anon, authenticated, service_role;
