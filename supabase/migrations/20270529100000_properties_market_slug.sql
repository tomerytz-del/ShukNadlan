-- ============================================================================
-- ‏market_slug(properties) - השוק של נכס, כשדה מחושב ש-PostgREST מסנן לפיו
--
-- מה נשבר (18.10.2026, 09:35): דף הבית של עפולה והעמק הציג את שלושת נכסי
-- הדמו של FALLBACK_PROPERTIES במקום 200 הנכסים האמיתיים.
--
-- למה: שוק ברירת המחדל מסנן "כל מה שאינו שייך לשוק אחר" (‏MarketScope,
-- ‏exclude), והסינון נבנה בדפדפן כרשימת מזהי הערים של כל השווקים האחרים
-- בתוך הכתובת: ‏or=(city_id.is.null,city_id.not.in.(…)). כל שוק חדש האריך
-- אותה, ואחרי אשקלון, קרית גת, שדרות-נתיבות, באר שבע וירושלים היו בה 617
-- מזהים - כ-23KB של כתובת. השרת ענה 400, ו-loadProperties נפלה לנכסי הדמו.
-- כל שוק נוסף רק היה מחמיר, ולכן התיקון אינו קיצור הרשימה אלא העברתה למסד.
--
-- מה נכנס: פונקציה על שורת properties, ש-PostgREST חושף כעמודה מחושבת.
-- הדפדפן שולח עכשיו or=(market_slug.is.null,market_slug.eq.afula-emek) -
-- אותו אורך לא משנה כמה שווקים יש.
--
-- הכלל זהה ל-market_cities_public (עיר פעילה עם שוק), ולכן גם ל-
-- ‏MarketScope.inMarket: נכס בלי עיר, או בעיר שאין לה שוק או שאינה פעילה,
-- מחזיר null - ונשאר בשוק ברירת המחדל, כמו שהיה.
--
-- ‏SECURITY INVOKER (ברירת המחדל): היא קוראת רק את cities, שגלויה לגולשים.
-- ‏anon ו-authenticated צריכים EXECUTE כדי לסנן בה, ולכן ההענקה מפורשת.
-- ============================================================================

create or replace function public.market_slug(p public.properties)
returns text
language sql
stable
set search_path = public
as $$
  select c.market_slug
    from public.cities c
   where c.id = p.city_id
     and c.active
     and c.market_slug is not null
$$;

comment on function public.market_slug(public.properties) is
  'השוק של הנכס (עיר פעילה עם שוק), או null. עמודה מחושבת ל-PostgREST - הסינון של שוק ברירת המחדל בדף הבית. assets/market-scope.js';

revoke all on function public.market_slug(public.properties) from public, anon, authenticated;
grant execute on function public.market_slug(public.properties) to anon, authenticated, service_role;
