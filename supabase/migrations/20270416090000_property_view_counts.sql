-- ספירת הצפיות לכל נכס, בשורה אחת לנכס.
--
-- ה-CRM ספר את הצפיות בדפדפן: הוא הוריד את *כל* השורות של property_views
-- לנכסים של הסוכן/ת בכל כניסה, רק כדי לספור אותן. שתי בעיות:
--   1. סוכן/ת עם 1,120 צפיות הוריד/ה 1,120 שורות בכל טעינה, והמספר רק גדל.
--   2. ‏PostgREST מחזיר עד 1,000 שורות לבקשה, ולכן מעבר לזה הספירה כבר
--      הייתה שגויה - בשקט, בלי שגיאה.
--
-- ‏security invoker בכוונה: ה-RLS על property_views ("agent read own
-- property views") ממשיך לקבוע מה נספר, בדיוק כמו בשאילתה הישירה שקדמה לה.
-- הפונקציה אינה מרחיבה גישה לשום דבר.

create or replace function public.property_view_counts(p_property_ids uuid[])
returns table (property_id uuid, views bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select v.property_id, count(*)::bigint
  from public.property_views v
  where v.property_id = any(p_property_ids)
  group by v.property_id
$$;

-- רק משתמש/ת מחובר/ת. ‏anon אינו רואה צפיות ממילא (ה-RLS), ואין לו סיבה
-- לקרוא לפונקציה.
revoke all on function public.property_view_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.property_view_counts(uuid[]) to authenticated;
