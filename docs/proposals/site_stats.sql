-- =====================================================================
-- הצעה בלבד - לא מיגרציה, ולא לרוץ בלי אישור של תומר (TODO-ASK 11).
-- =====================================================================
-- המונים של "האנשים מאחורי העסקאות" (‏#dmStats, ‏docs/home-page-sections.md).
-- הקובץ יושב ב-docs/proposals ולא ב-supabase/migrations בכוונה: כל קובץ שם
-- רץ אוטומטית במיזוג ל-main, כלומר "קובץ שלא רץ" לא יכול לשבת שם.
--
-- אחרי אישור: להעתיק ל-supabase/migrations/<YYYYMMDDHHMMSS>_site_stats.sql
-- (version גדול מהאחרון), ולהדליק SITE_STATS_READY ב-assets/home.js באותו PR
-- או אחריו (האתר עולה לפני המיגרציה - הסקיל deploy-path).
--
-- הגדרות (נבדקו בקריאה בלבד ב-27.10.2026, שוק afula-emek: 1,388 / 33 / 58 / 223):
--   deals_12m       - עסקאות רשות המיסים ביישובי השוק, 12 חודשים מלאים עד
--                     החודש האחרון שיש בו נתונים (TODO-ASK 13)
--   agencies_active - משרדים שהעיר שלהם בשוק, עם חבר/ה פעיל/ה אחד/ת לפחות
--                     שאינו/ה מנהל/ת פלטפורמה
--   agents_active   - חברי משרדים פעילים בכל האתר (אותו מספר בכל שוק)
--   props_active    - נכסים פעילים ביישובי השוק
-- =====================================================================

create table if not exists public.site_stats (
  market_slug     text primary key,
  props_active    int  not null default 0,
  agencies_active int  not null default 0,
  deals_12m       int  not null default 0,
  deals_from      date,
  deals_to        date,
  computed_at     timestamptz not null default now()
);

create table if not exists public.site_stats_platform (
  id            boolean primary key default true check (id),
  agents_active int not null,
  computed_at   timestamptz not null default now()
);

alter table public.site_stats enable row level security;
alter table public.site_stats_platform enable row level security;

drop policy if exists site_stats_read on public.site_stats;
create policy site_stats_read on public.site_stats for select to anon, authenticated using (true);
drop policy if exists site_stats_platform_read on public.site_stats_platform;
create policy site_stats_platform_read on public.site_stats_platform for select to anon, authenticated using (true);

-- טבלה חדשה: החלטה מפורשת לשלושת התפקידים (CLAUDE.md, מיגרציות כלל 6)
revoke all on public.site_stats, public.site_stats_platform from anon, authenticated;
grant select on public.site_stats, public.site_stats_platform to anon, authenticated;
grant all on public.site_stats, public.site_stats_platform to service_role;

create or replace function public.refresh_site_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.site_stats as s (market_slug, props_active, agencies_active, deals_12m, deals_from, deals_to, computed_at)
  select m.market_slug,
    (select count(*) from properties p join cities c on c.id = p.city_id
      where p.status = 'active' and c.market_slug = m.market_slug),
    (select count(distinct a.id) from agencies a join cities c on c.id = a.city_id
      join agency_members am on am.agency_id = a.id
      where c.market_slug = m.market_slug and am.active and not coalesce(am.is_platform_admin, false)),
    coalesce(d.n, 0), d.lo, d.hi,
    now()
  from (select distinct market_slug from cities where market_slug is not null) m
  left join lateral (
    with lim as (
      select date_trunc('month', max(x.sold_at))::date + interval '1 month' as hi
      from market_deals_official x
      where x.city in (select name from cities where market_slug = m.market_slug)
    )
    select count(*)::int as n,
           (lim.hi - interval '12 months')::date as lo,
           (lim.hi - interval '1 day')::date as hi
    from market_deals_official x, lim
    where x.city in (select name from cities where market_slug = m.market_slug)
      and x.sold_at >= lim.hi - interval '12 months' and x.sold_at < lim.hi
    group by lim.hi
  ) d on true
  on conflict (market_slug) do update set
    props_active = excluded.props_active, agencies_active = excluded.agencies_active,
    deals_12m = excluded.deals_12m, deals_from = excluded.deals_from, deals_to = excluded.deals_to,
    computed_at = excluded.computed_at;

  insert into public.site_stats_platform (id, agents_active, computed_at)
  select true, count(*), now() from agency_members
  where active and not coalesce(is_platform_admin, false)
  on conflict (id) do update set agents_active = excluded.agents_active, computed_at = excluded.computed_at;
end;
$$;

revoke all on function public.refresh_site_stats() from public, anon, authenticated;
grant execute on function public.refresh_site_stats() to service_role;

select public.refresh_site_stats();

-- 04:00 ו-16:00 UTC (06:00 ו-18:00 בחורף בישראל). pg_cron 1.6.4 מותקן.
select cron.unschedule('site-stats-refresh')
where exists (select 1 from cron.job where jobname = 'site-stats-refresh');
select cron.schedule('site-stats-refresh', '0 4,16 * * *', 'select public.refresh_site_stats()');
