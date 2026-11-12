-- supabase/migrations/20271112150000_city_price_table_refresh_on_change.sql
--
-- רענון תמונת מחירי הדירות (/prices) רק כשהמקור השתנה, ולא כל שעה.
--
-- מה שבור היום: ‏`city-price-table-refresh` מריץ `refresh materialized view
-- concurrently private.city_price_table_mv` בדקה 44 של כל שעה, ‏24 פעמים
-- ביום, כ-3.5-4 שניות כל פעם (הצבירה סורקת את כל 82 אלף העסקאות). אבל
-- ‏`market_deals_official` משתנה רק כשסוכן הדפדפן או מנוע העסקאות כותבים:
-- ב-30 הימים עד 12.11.2026 היו שינויים ב-37 שעות מתוך 720. ‏23 מתוך 24
-- הרענונים ביום בונים מחדש תמונה זהה, והסוכן התפעולי פתח על זה ממצא
-- ‏`heavy_query` (‏86 שניות מסד ליום, השלישית בגודלה במסד).
--
-- מה נכנס:
--   1. אינדקס על `market_deals_official.updated_at`, כדי ש-`max(updated_at)`
--      יהיה קריאה אחת מהאינדקס ולא סריקה של הטבלה (‏1.8 שניות בפרודקשן).
--   2. ‏`private.city_price_table_state` - שורה אחת: חותמת המקור שהתמונה
--      נבנתה ממנה.
--   3. ‏`private.city_price_table_refresh()` - משווה את החותמת (העדכון
--      האחרון בעסקאות ובערים) לזו של הרענון הקודם, ומרעננת רק כשהיא זזה.
--   4. אותו job, אותה דקה, קורא לפונקציה במקום ל-`refresh` ישיר.
--
-- החותמת כוללת גם את `cities.updated_at` כי הצבירה מצטרפת ל-`cities` לפי
-- שם ולוקחת ממנה את `market_slug`; עיר שעברה שוק משנה את התמונה בלי שאף
-- עסקה השתנתה. ערים משתנות לעתים נדירות (שעה אחת ב-14 יום).
--
-- מה לא משתנה: הפונקציה הציבורית `city_price_table()`, התמונה עצמה, ומה
-- שהדף מציג. אחרי ייבוא עסקאות התמונה עדיין יכולה לפגר עד שעה.
-- ‏docs/city-prices.md

create index if not exists market_deals_official_updated_at_idx
  on public.market_deals_official (updated_at desc);

create table if not exists private.city_price_table_state (
  id            boolean primary key default true check (id),
  source_max    timestamptz,
  refreshed_at  timestamptz not null default now()
);

comment on table private.city_price_table_state is
  'שורה אחת: החותמת (max(updated_at) של העסקאות והערים) שממנה נבנתה private.city_price_table_mv בפעם האחרונה. city_price_table_refresh() מרעננת רק כשהחותמת זזה. docs/city-prices.md';

revoke all on table private.city_price_table_state from public, anon, authenticated, service_role;

create or replace function private.city_price_table_refresh()
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_max        timestamptz;
  v_prev       timestamptz;
  v_has_state  boolean;
  v_populated  boolean;
begin
  select greatest(
           (select max(o.updated_at) from public.market_deals_official o),
           (select max(c.updated_at) from public.cities c))
    into v_max;

  select s.source_max, true into v_prev, v_has_state
    from private.city_price_table_state s
   where s.id;

  select c.relispopulated into v_populated
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname = 'city_price_table_mv';

  -- אותה חותמת ותמונה מלאה: אין מה לבנות מחדש.
  if coalesce(v_has_state, false) and v_prev is not distinct from v_max
     and coalesce(v_populated, false) then
    return false;
  end if;

  -- ‏concurrently דורש תמונה שכבר מולאה (מסד חדש, או סכימה בלי נתונים ב-CI).
  if coalesce(v_populated, false) then
    refresh materialized view concurrently private.city_price_table_mv;
  else
    refresh materialized view private.city_price_table_mv;
  end if;

  insert into private.city_price_table_state (id, source_max, refreshed_at)
  values (true, v_max, now())
  on conflict (id) do update
    set source_max = excluded.source_max, refreshed_at = now();
  return true;
end $$;

comment on function private.city_price_table_refresh() is
  'מרעננת את private.city_price_table_mv רק כשהעסקאות או הערים השתנו מאז הרענון הקודם (לפי max(updated_at)). רצה מ-pg_cron (city-price-table-refresh, דקה 44). מחזירה true כשרוענן. docs/city-prices.md';

-- רק ה-cron (בתור הבעלים) קורא לה. אין לה מה לעשות מהדפדפן או מפונקציית Edge.
revoke all on function private.city_price_table_refresh() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron missing - city_price_table_mv will not refresh';
    return;
  end if;
  perform cron.unschedule('city-price-table-refresh')
    where exists (select 1 from cron.job where jobname = 'city-price-table-refresh');
  perform cron.schedule('city-price-table-refresh', '44 * * * *',
    'select private.city_price_table_refresh()');
end $$;
