-- ‏5.11.2026: בפרודקשן נמצאה גרסה של deal_sync_plan שאין לה קובץ - הסוכן
-- שסורק עסקאות הוסיף לה כלל ליישובים בלי אף עסקה במאגר (פעם ב-120 יום).
-- זה אותו מקרה כמו fail_streak ב-20271102120000: מיגרציה עתידית שמחליפה את
-- deal_sync_plan מהגרסה שבריפו הייתה מוחקת את הכלל בשקט. הקובץ הזה הוא
-- העתק מדויק של מה שרץ בפרודקשן, ולכן הרצה שלו שם אינה משנה כלום.
--
--   יישוב עם עסקאות  - כמו קודם: sync_every_days מ-last_synced_at.
--   יישוב בלי עסקאות - פעם ב-120 יום, מ-coalesce(last_synced_at, last_attempt_at)
--                      (רוב ~580 היישובים האלה נכשלים, ולכן נמדד גם מהניסיון).
--                      עסקה ראשונה מחזירה אותו אוטומטית ל-sync_every_days.
--   הסדר             - יישובים עם עסקאות לפני הזנב (has_deals desc).
--   ההשהיה של fail_streak נשמרת כמו שהיא.

create or replace function public.deal_sync_plan(p_limit integer default 25, p_markets text[] default null::text[])
 returns table(name text, sync_from date, last_synced_at timestamp with time zone, due_total integer)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if not public.deal_sync_caller_ok() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  -- 5.11.2026: יישובים בלי אף עסקה במאגר - פעם ב-120 יום (נמדד מהניסיון האחרון),
  -- כי כמעט תמיד אין להם נתונים ב-Govmap. יישוב שקיבל עסקה חוזר אוטומטית ל-sync_every_days.
  return query
  with base as (
    select s.*, c.population, c.market_slug,
           exists (select 1 from public.market_deals_official o where o.city = s.name) as has_deals
      from public.deal_settlements s
      left join public.cities c on c.id = s.city_id
     where s.active
  ), due as (
    select b.* from base b
     where (case when b.has_deals then
              (b.last_synced_at is null
               or b.last_synced_at < now() - make_interval(days => b.sync_every_days))
            else
              (coalesce(b.last_synced_at, b.last_attempt_at) is null
               or coalesce(b.last_synced_at, b.last_attempt_at) < now() - make_interval(days => 120))
            end)
       and (b.fail_streak < 2 or b.last_attempt_at is null
            or b.last_attempt_at < now() - make_interval(days =>
                 least(90, 14 * power(2, b.fail_streak - 2)::int)))
       and (coalesce(cardinality(p_markets), 0) = 0 or b.market_slug = any(p_markets))
  )
  select d.name,
         coalesce(
           (select max(o.sold_at) from public.market_deals_official o where o.city = d.name) - 90,
           (current_date - make_interval(months => d.months_back))::date),
         d.last_synced_at,
         (select count(*) from due)::int
    from due d
   order by (d.sync_every_days < 30) desc,
            d.has_deals desc,
            d.fail_streak asc,
            d.last_attempt_at asc nulls first,
            d.population desc nulls last, d.name
   limit greatest(1, least(coalesce(p_limit, 25), 500));
end $function$;

comment on function public.deal_sync_plan(integer, text[]) is
  'היישובים שהגיע תורם לעדכון (פעילים; עם עסקאות - לא עודכנו sync_every_days ימים, בלי עסקאות - לא נוסו 120 יום), עד p_limit, ואם p_markets לא ריק - רק בשווקים האלה (cities.market_slug). מנהל/ת, service_role או חיבור ישיר. docs/settlement-deals.md';

revoke all on function public.deal_sync_plan(integer, text[]) from public, anon, authenticated;
grant execute on function public.deal_sync_plan(integer, text[]) to authenticated, service_role;
