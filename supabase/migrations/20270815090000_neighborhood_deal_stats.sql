-- ---------------------------------------------------------------------------
-- version 20270815090000: אחרי 20270814090000_search_learning שכבר ב-main.
-- version מוקדם יותר היה נדחה בצינור (אינו גדול מהאחרון).
-- עסקאות הדף של השכונה, מחושבות מראש (docs/neighborhood-pages.md)
--
-- neighborhood_page סרקה את market_deals_official בכל בקשה: GIN על
-- neighborhood_ids, ואז max(sold_at) על כל העסקאות של אותה שכונה (בלי
-- סינון מגורים), ורק אחר כך החלון של 24 חודשים והסינון. ב-24.10.2026,
-- מטמון חם:
--   neighborhood_page('afula','אזור-התעשייה')  189 ms
--   neighborhood_page('afula','דרום-העיר')    1795 ms  (סף ה-edge הוא 2500)
-- אותה צבירה, מעבר אחד על כל השכונות (unnest, לא @> לכל שכונה), כולל
-- חציון ו-by_rooms: 340 ms, 617 שכונות. לכן היא רצה כל שעה (:22, דקה
-- לפני neighborhood-pages-refresh ב-:23) ולא בכל בקשת דף.
--
-- המקסימום הוא על כל העסקאות, והסינון חל רק על החלון. שכונה בלי שורה
-- בטבלה (עוד לא רענון, או אין עסקאות בחלון) נקראת כ-0 עסקאות ו-by_rooms
-- ריק. הנכסים, התיאור והשכונות הסמוכות נשארים חיים ב-neighborhood_page.
-- ---------------------------------------------------------------------------

create table if not exists public.neighborhood_deal_stats (
  neighborhood_id uuid primary key references public.neighborhoods(id) on delete cascade,
  deals int not null,
  period_start date,
  period_end date,
  median_price numeric,
  median_ppsqm numeric,
  by_rooms jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);

comment on table public.neighborhood_deal_stats is
  'צבירת עסקאות לדף השכונה: 24 חודשים מהעסקה האחרונה, מגורים בלבד. מתרעננת כל שעה. docs/neighborhood-pages.md';

alter table public.neighborhood_deal_stats enable row level security;

revoke all on table public.neighborhood_deal_stats from public, anon, authenticated;
grant select on table public.neighborhood_deal_stats to service_role;

-- ---------------------------------------------------------------------------
-- רענון. נקראת מ-cron ומסוף המיגרציה הזו, לא מהדפדפן.
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_deal_stats_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  with exploded as (
    select u.n_id, o.sold_at, o.sale_price, o.rooms, o.size_sqm, o.property_type
      from public.market_deals_official o
      cross join lateral unnest(o.neighborhood_ids) as u(n_id)
  ), bounds as (
    -- המקסימום על כל העסקאות, לפני סינון המגורים. כמו תת-השאילתה הישנה.
    select n_id, max(sold_at) as newest
      from exploded
     group by n_id
  ), d as (
    select e.n_id, e.sale_price, e.rooms,
           round(e.sale_price / e.size_sqm) as ppsqm,
           case when e.rooms < 3.5 then 3 when e.rooms < 4.5 then 4
                when e.rooms < 5.5 then 5 else 6 end as bucket,
           e.sold_at
      from exploded e
      join bounds b on b.n_id = e.n_id
     where e.sold_at > b.newest - interval '24 months'
       and coalesce(e.property_type, 'דירה') not in ('בנין', 'קרקע', 'משק חקלאי')
       and e.size_sqm between 25 and 400
       and e.sale_price between 200000 and 15000000
  ), rooms as (
    select d.n_id, d.bucket, count(*)::int as n,
           round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) as mp,
           round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) as mq
      from d
     where d.rooms is not null and d.rooms >= 1
     group by d.n_id, d.bucket
  ), room_json as (
    select r.n_id,
           jsonb_agg(jsonb_build_object(
             'rooms', r.bucket,
             'deals', r.n,
             'median_price', case when r.n >= 5 then r.mp end,
             'median_ppsqm', case when r.n >= 5 then r.mq end
           ) order by r.bucket) as by_rooms
      from rooms r
     group by r.n_id
  ), agg as (
    select d.n_id as neighborhood_id,
           count(*)::int as deals,
           min(d.sold_at) as period_start,
           max(d.sold_at) as period_end,
           case when count(*) >= 5 then
             round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) end as median_price,
           case when count(*) >= 5 then
             round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) end as median_ppsqm
      from d
     group by d.n_id
  ), upserted as (
    insert into public.neighborhood_deal_stats as s
      (neighborhood_id, deals, period_start, period_end, median_price, median_ppsqm, by_rooms, refreshed_at)
    select a.neighborhood_id, a.deals, a.period_start, a.period_end,
           a.median_price, a.median_ppsqm, coalesce(rj.by_rooms, '[]'::jsonb), now()
      from agg a
      join public.neighborhoods n on n.id = a.neighborhood_id
      left join room_json rj on rj.n_id = a.neighborhood_id
    on conflict (neighborhood_id) do update
      set deals = excluded.deals,
          period_start = excluded.period_start,
          period_end = excluded.period_end,
          median_price = excluded.median_price,
          median_ppsqm = excluded.median_ppsqm,
          by_rooms = excluded.by_rooms,
          refreshed_at = excluded.refreshed_at
    returning neighborhood_id
  )
  delete from public.neighborhood_deal_stats s
   where not exists (select 1 from upserted u where u.neighborhood_id = s.neighborhood_id);
end
$fn$;

comment on function public.neighborhood_deal_stats_refresh() is
  'מחשבת מחדש את neighborhood_deal_stats לכל השכונות. cron כל שעה. לא לדפדפן.';

revoke all on function public.neighborhood_deal_stats_refresh() from public, anon, authenticated;
grant execute on function public.neighborhood_deal_stats_refresh() to service_role;

select public.neighborhood_deal_stats_refresh();

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - צבירת עסקאות השכונות לא תתרענן';
    return;
  end if;
  perform cron.unschedule('neighborhood-deal-stats')
    where exists (select 1 from cron.job where jobname = 'neighborhood-deal-stats');
  perform cron.schedule('neighborhood-deal-stats', '22 * * * *',
    'select public.neighborhood_deal_stats_refresh();');
end;
$$;

-- ---------------------------------------------------------------------------
-- הדף קורא את הטבלה. הנכסים, התיאור והשכנות נשארים בשאילתה (מ-20270729090000).
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_page(p_city text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $page$
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
    'deals', coalesce((select st.deals from public.neighborhood_deal_stats st, h
                        where st.neighborhood_id = h.id), 0),
    'period_start', (select st.period_start from public.neighborhood_deal_stats st, h
                      where st.neighborhood_id = h.id),
    'period_end', (select st.period_end from public.neighborhood_deal_stats st, h
                    where st.neighborhood_id = h.id),
    'median_price', (select st.median_price from public.neighborhood_deal_stats st, h
                      where st.neighborhood_id = h.id),
    'median_ppsqm', (select st.median_ppsqm from public.neighborhood_deal_stats st, h
                      where st.neighborhood_id = h.id),
    'by_rooms', coalesce((select st.by_rooms from public.neighborhood_deal_stats st, h
                           where st.neighborhood_id = h.id), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug) order by s.name)
                  from public.neighborhood_pages_public() s, h
                 where s.city_slug = h.city_slug and s.slug <> h.slug), '[]'::jsonb),
    'about', (select jsonb_build_object('intro', d.intro, 'fits', d.fits, 'faq', d.faq, 'approved_at', d.decided_at)
                from public.neighborhood_descriptions d, h
               where d.neighborhood_id = h.id and d.status = 'approved'
               limit 1)
  ) end
$page$;

comment on function public.neighborhood_page(text, text) is
  'הנתונים של /n/{עיר}/{שכונה}. עסקאות מ-neighborhood_deal_stats (0 אם אין שורה). null לשכונה לא קיימת. docs/neighborhood-pages.md';

revoke all on function public.neighborhood_page(text, text) from public, anon, authenticated;
grant execute on function public.neighborhood_page(text, text) to anon, authenticated, service_role;
