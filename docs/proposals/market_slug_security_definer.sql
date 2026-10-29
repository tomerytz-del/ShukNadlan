-- =====================================================================
-- Approved by the site owner 27.10.2026 (round 5 §1). Written in PR 1010,
-- applied by the owner after merge - do not apply from CI or by hand.
-- Expected effect: default-market listing count 252 -> ~240 (238 on 27.10).
-- =====================================================================
-- הקובץ יושב ב-docs/proposals ולא ב-supabase/migrations בכוונה: כל קובץ שם רץ
-- אוטומטית במיזוג ל-main, ותומר מחיל אותו בעצמו.
--
-- למה: ‏market_slug(properties) היא sql stable רגילה שקוראת את public.cities, ול-cities
-- יש RLS רק לחברי משרדים ולמנהלי הפלטפורמה. לגולש/ת אנונימי/ת היא מחזירה NULL לכל
-- שורה, וה-or של MarketScope.apply() (‏market_slug.is.null) מעביר את כל הנכסים באתר
-- תחת "עפולה והעמק". security definer חושפת רק את market_slug, שכבר ציבורי ב-
-- market_cities_public.
--
-- אחרי ההחלה: ‏MarketScope.keepRows בצד הלקוח נשאר כרשת ביטחון (לא עושה כלום).
--
-- אחרי אישור: להעתיק ל-supabase/migrations/<YYYYMMDDHHMMSS>_market_slug_security_definer.sql
-- (version גדול מהאחרון).
-- =====================================================================

create or replace function public.market_slug(p public.properties)
returns text language sql stable security definer set search_path = public as $$
  select c.market_slug from public.cities c
   where c.id = p.city_id and c.active and c.market_slug is not null
$$;
revoke all on function public.market_slug(public.properties) from public, anon, authenticated;
grant execute on function public.market_slug(public.properties) to anon, authenticated;
