-- ============================================================================
-- ‏fail_streak והשהיית יישובים שנכשלים - בקובץ, כמו שהם כבר בפרודקשן
--
-- ‏2.11.2026: בפרודקשן נמצאו עמודה, טריגר וגרסה של deal_sync_plan שאין
-- להם קובץ באף מיגרציה בריפו - הוחלו מחוץ לצינור. אין להם רשומה ב-
-- schema_migrations, ולכן db push לא נשבר; אבל המיגרציה הבאה שהייתה
-- מחליפה את deal_sync_plan מהגרסה שבריפו (‏20270403090000) הייתה מוחקת
-- את ההשהיה בשקט, ו-249 היישובים שאין להם נתונים ב-GovMap היו חוזרים
-- לראש כל מנה.
--
-- ‏הקובץ הזה הוא **העתק מדויק** של מה שרץ, ולא שינוי: הוא נכתב מ-
-- pg_get_functiondef ו-pg_get_triggerdef של הפרודקשן, ולכן ההרצה שלו שם
-- אינה משנה דבר. הוא אידמפוטנטי.
--
-- ‏ההתנהגות:
--   fail_streak  מתאפס כשהיישוב עודכן בהצלחה (last_synced_at), ועולה ב-1
--                בכל ניסיון שנגמר בשגיאה (last_attempt_at עם 'שגיאה:').
--   deal_sync_plan  יישוב שנכשל פעמיים ומעלה חוזר לתור רק אחרי
--                14 ימים, ואז 28, 56, ועד 90. ובתור - קודם מי שנכשל פחות.
--
-- ‏הסוכן התפעולי (‏_deal_sync_cycle) נשען על העמודה: יישוב שלא נמשך מעולם
-- ונכשל מדווח ב-deal_sync_no_data ולא כפיגור. docs/settlement-deals.md.
-- ============================================================================

alter table public.deal_settlements
  add column if not exists fail_streak integer not null default 0;

comment on column public.deal_settlements.fail_streak is
  'כישלונות רצופים. מתאפס בעדכון מוצלח (טריגר trg_deal_settlements_fail_streak). מ-2 ומעלה deal_sync_plan משהה את היישוב 14 ימים ואז כפול עד 90.';

create or replace function public.deal_settlements_fail_streak()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_synced_at is distinct from old.last_synced_at and new.last_synced_at is not null then
    new.fail_streak := 0;
  elsif new.last_attempt_at is distinct from old.last_attempt_at
        and coalesce(new.last_status, '') like 'שגיאה:%' then
    new.fail_streak := coalesce(old.fail_streak, 0) + 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_deal_settlements_fail_streak on public.deal_settlements;
create trigger trg_deal_settlements_fail_streak
  before update on public.deal_settlements
  for each row execute function public.deal_settlements_fail_streak();

create or replace function public.deal_sync_plan(p_limit integer default 25, p_markets text[] default null::text[])
returns table(name text, sync_from date, last_synced_at timestamp with time zone, due_total integer)
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  if not public.deal_sync_caller_ok() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return query
  with due as (
    select s.*, c.population
      from public.deal_settlements s
      left join public.cities c on c.id = s.city_id
     where s.active
       and (s.last_synced_at is null
            or s.last_synced_at < now() - make_interval(days => s.sync_every_days))
       and (s.fail_streak < 2 or s.last_attempt_at is null
            or s.last_attempt_at < now() - make_interval(days =>
                 least(90, 14 * power(2, s.fail_streak - 2)::int)))
       and (coalesce(cardinality(p_markets), 0) = 0 or c.market_slug = any(p_markets))
  )
  select d.name,
         coalesce(
           (select max(o.sold_at) from public.market_deals_official o where o.city = d.name) - 90,
           (current_date - make_interval(months => d.months_back))::date),
         d.last_synced_at,
         (select count(*) from due)::int
    from due d
   order by (d.sync_every_days < 30) desc,
            d.fail_streak asc,
            d.last_attempt_at asc nulls first,
            d.population desc nulls last, d.name
   limit greatest(1, least(coalesce(p_limit, 25), 500));
end $$;

comment on function public.deal_sync_plan(integer, text[]) is
  'היישובים שהגיע תורם לעדכון (פעילים, ולא עודכנו sync_every_days ימים), עד p_limit, ואם p_markets לא ריק - רק בשווקים האלה (cities.market_slug). מנהל/ת, service_role או חיבור ישיר. docs/settlement-deals.md';

revoke all on function public.deal_sync_plan(integer, text[]) from public, anon, authenticated;
grant execute on function public.deal_sync_plan(integer, text[]) to authenticated, service_role;
