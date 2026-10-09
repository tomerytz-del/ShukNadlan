-- ===========================================================================
-- עדכון עסקאות: שורות מופרדות בקווים, וסינון התור לפי שוק
-- ===========================================================================
--
-- שתי בקשות של מנהל/ת הפלטפורמה אחרי ההרצה הראשונה (9.10.2026: ‏11 יישובים,
-- ‏392 עסקאות, 232 ממתינים):
--
--   ‏1. **יותר עסקאות בכל העברה.** פלט הכלי של הסוכן נחתך בכ-1,100 תווים,
--      ובמערך JSON כל שדה עטוף בגרשיים ומופרד בפסיק, וכל ריק הוא `null`.
--      ‏upsert_deals_text(p_settlement, p_lines) מקבלת שורה לעסקה, שדות
--      מופרדים ב-`|` ושדה ריק הוא ריק - בערך פי שניים עסקאות למנה.
--
--      **פונקציה בשם אחר, ולא עוד גרסה של upsert_deals:** ‏upsert_deals(text,
--      text) לצד upsert_deals(text, jsonb) הייתה הופכת כל קריאה עם מחרוזת
--      ליטרלית - ‏`upsert_deals('חדרה', '[]')`, כמו בהוראות - לדו-משמעית, ו-
--      Postgres היה בוחר את גרסת ה-text (‏text הוא הטיפוס המועדף בקטגוריה).
--      הפונקציה החדשה רק מפרקת את השורות ומעבירה ל-upsert_deals, כך שההתאמה
--      לפי ספירה, הסיכום והמחזור הם אותו קוד בדיוק.
--
--   ‏2. **לעדכן רק את מה שרלוונטי.** ‏deal_sync_plan(p_limit, p_markets) -
--      ‏p_markets הוא רשימת slug-ים של שווקים (‏cities.market_slug), למשל
--      ‏{afula-emek,nof-hagalil-migdal,krayot} לעמק יזרעאל והקריות. ריק -
--      הכול, כמו קודם. ‏due_total סופר רק בתוך הסינון.
--
-- ‏docs/settlement-deals.md. אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. upsert_deals_text
--
-- הסדר זהה לפורמט המערך של upsert_deals:
--   gush|helka|tat|date|price|sqm|street|house|neighborhood|type|rooms|floor
-- שדות בסוף השורה שאינם קיימים נחשבים ריקים, ושורה ריקה מדולגת. ‏`|` אינו
-- מופיע בטבלה של GovMap, ולכן אין צורך בבריחה.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_deals_text(p_settlement text, p_lines text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.deal_sync_caller_ok() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(
           (select jsonb_agg(nullif(btrim(f), '') order by n)
              from unnest(string_to_array(l, '|')) with ordinality as t(f, n))
           order by ln), '[]'::jsonb)
    into v_rows
    from unnest(string_to_array(replace(coalesce(p_lines, ''), E'\r', ''), E'\n'))
         with ordinality as x(l, ln)
   where btrim(l) <> '';

  return public.upsert_deals(p_settlement, v_rows);
end $$;

comment on function public.upsert_deals_text(text, text) is
  'כמו upsert_deals, אבל שורה לעסקה ושדות מופרדים ב-| (gush|helka|tat|date|price|sqm|street|house|neighborhood|type|rooms|floor) - בערך פי שניים עסקאות בכל העברה של הסוכן. מפרקת ומעבירה ל-upsert_deals. docs/settlement-deals.md';

revoke all on function public.upsert_deals_text(text, text) from public, anon, authenticated;
grant execute on function public.upsert_deals_text(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. deal_sync_plan עם סינון לפי שוק
--
-- ‏drop לגרסה עם פרמטר אחד: גרסה עם (int) לצד (int, text[] default null)
-- הייתה הופכת את deal_sync_plan(25) לדו-משמעית.
-- ---------------------------------------------------------------------------
drop function if exists public.deal_sync_plan(int);

create or replace function public.deal_sync_plan(p_limit int default 25, p_markets text[] default null)
returns table (name text, sync_from date, last_synced_at timestamptz, due_total int)
language plpgsql
stable
security definer
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
       and (coalesce(cardinality(p_markets), 0) = 0 or c.market_slug = any(p_markets))
  )
  select d.name,
         coalesce(
           (select max(o.sold_at) from public.market_deals_official o where o.city = d.name) - 90,
           (current_date - make_interval(months => d.months_back))::date),
         d.last_synced_at,
         (select count(*) from due)::int
    from due d
   order by d.last_attempt_at asc nulls first, d.population desc nulls last, d.name
   limit greatest(1, least(coalesce(p_limit, 25), 500));
end $$;

comment on function public.deal_sync_plan(int, text[]) is
  'היישובים שהגיע תורם לעדכון (פעילים, ולא עודכנו sync_every_days ימים), עד p_limit, ואם p_markets לא ריק - רק בשווקים האלה (cities.market_slug). מנהל/ת, service_role או חיבור ישיר. docs/settlement-deals.md';

revoke all on function public.deal_sync_plan(int, text[]) from public, anon, authenticated;
grant execute on function public.deal_sync_plan(int, text[]) to authenticated, service_role;
