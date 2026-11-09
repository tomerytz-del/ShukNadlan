-- supabase/migrations/20271031180000_city_price_table_snapshot.sql
-- /prices: the aggregate takes ~2.5s on 79k deals (anon timeout 3s, edge 2.5s) -> 503 on cold load.
-- Snapshot it in a materialized view refreshed hourly; the RPC reads the snapshot.

create materialized view if not exists private.city_price_table_mv as
  with bounds as (
    select max(sold_at) as period_end from public.market_deals_official
  ),
  d as (
    select c.market_slug,
           o.city,
           case when o.rooms < 2.5 then 2
                when o.rooms < 3.5 then 3
                when o.rooms < 4.5 then 4
                when o.rooms < 5.5 then 5
                else 6 end as rooms,
           o.sale_price,
           o.sale_price / o.size_sqm as ppsqm
      from public.market_deals_official o
      join public.cities c on c.name = o.city
      cross join bounds b
     where c.market_slug is not null
       and o.sold_at > b.period_end - interval '12 months'
       and coalesce(o.property_type, 'דירה') = 'דירה'
       and o.rooms between 1.5 and 8
       and o.size_sqm between 25 and 400
       and o.sale_price between 200000 and 15000000
  )
  select d.market_slug,
         d.city,
         d.rooms,
         count(*)::int                                                              as deals,
         round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) as median_price,
         round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -2)      as median_ppsqm,
         ((select period_end from bounds) - interval '12 months')::date + 1         as period_start,
         (select period_end from bounds)                                            as period_end
    from d
   group by d.market_slug, d.city, d.rooms
  having count(*) >= 5;

create unique index if not exists city_price_table_mv_uidx
  on private.city_price_table_mv (market_slug, city, rooms);

revoke all on table private.city_price_table_mv from public, anon, authenticated, service_role;
comment on materialized view private.city_price_table_mv is
  'Snapshot of the /prices aggregate (city x rooms medians, last 12 months). Refreshed hourly (city-price-table-refresh). No anon/authenticated access; read only via public.city_price_table().';

refresh materialized view private.city_price_table_mv;

create or replace function public.city_price_table()
returns table(market_slug text, city text, rooms integer, deals integer, median_price numeric,
              median_ppsqm numeric, period_start date, period_end date)
language sql
stable
security definer
set search_path = ''
as $$
  select m.market_slug, m.city, m.rooms, m.deals, m.median_price, m.median_ppsqm, m.period_start, m.period_end
    from private.city_price_table_mv m
   order by m.market_slug, m.city, m.rooms;
$$;

revoke all on function public.city_price_table() from public;
grant execute on function public.city_price_table() to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron missing - city_price_table_mv will not refresh';
    return;
  end if;
  perform cron.unschedule('city-price-table-refresh')
    where exists (select 1 from cron.job where jobname = 'city-price-table-refresh');
  perform cron.schedule('city-price-table-refresh', '44 * * * *',
    'refresh materialized view concurrently private.city_price_table_mv');
end $$;
