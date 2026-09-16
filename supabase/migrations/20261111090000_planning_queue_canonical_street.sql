-- ============================================================================
-- התור של המידע התכנוני עובר דרך רשימת הרחובות
--
-- הסבב הראשון של planning-backfill פתר 8 מתוך 20, ו-12 חזרו
-- ‏address_not_found. שלושה מהם לא היו באמת חסרים:
--
--   נרשם "יצחק רבין 1"  →  ברשימה: "שדרות יצחק רבין"
--
-- הרשימה יודעת לתרגם, אבל הסורק שלח את השם **כפי שהוא רשום בנכס**. טופס
-- הנכס ב-CRM כן מקנוניזציה (‏canonicalStreet), והנכסים הישנים נשמרו לפני
-- שהרשימה נולדה — וכך גם ייכנסו נכסים מאשף הייבוא ומהעוזר בוואטסאפ, ששניהם
-- אינם עוברים בטופס.
--
-- ‏streetVariants מכסה שלושה צירי כתיב, ו-"שדרות" אינו אחד מהם — הוא תחילית
-- שלמה. זה בדיוק מה שהרשימה נועדה לפתור, ולכן התור שואל אותה.
-- ============================================================================

create or replace function public.planning_backfill_queue(
  p_limit        integer  default 25,
  p_max_attempts smallint default 3,
  p_retry_after  interval default '20 hours'
)
returns table (id uuid, street text, house_number text)
language sql
security definer
set search_path = public
as $$
  -- ‏coalesce ולא join פנימי: רחוב שאינו ברשימה עדיין נבדק כפי שנרשם.
  -- הרשימה מתקנת כשהיא יודעת, ולא חוסמת כשאינה יודעת.
  select p.id, coalesce(r.name, p.street) as street, p.house_number
  from public.properties p
  left join public.street_registry r
    on r.city = p.city
   and r.active
   and r.name_key = public.street_name_key(p.street)
  where p.city = 'עפולה'
    and p.status = 'active'
    and coalesce(btrim(p.street), '') <> ''
    and coalesce(btrim(p.house_number), '') <> ''
    and p.planning_attempts < p_max_attempts
    and (p.planning_attempted_at is null or p.planning_attempted_at < now() - p_retry_after)
    and not exists (
      select 1 from public.property_planning_info ppi
      where ppi.property_id = p.id and ppi.gush is not null
    )
  order by p.planning_attempted_at nulls first, p.created_at
  limit greatest(p_limit, 1);
$$;

comment on function public.planning_backfill_queue(integer, smallint, interval) is
  'נכסים שממתינים להשלמת מידע תכנוני, עם שם הרחוב הקנוני מ-street_registry.';

revoke all on function public.planning_backfill_queue(integer, smallint, interval) from public, anon, authenticated;
grant execute on function public.planning_backfill_queue(integer, smallint, interval) to service_role;

-- ---------------------------------------------------------------------------
-- החזרה לתור
--
-- בלי זה התיקון היה יושב ללא שימוש עד שיפוג חלון ההמתנה של 20 שעות, ומי
-- שמיצה 3 ניסיונות לא היה חוזר לעולם. מוחזרים רק מי שנכשל ב-address_not_found
-- ושהרשימה מתרגמת לשם **אחר** ממה שנשלח — כלומר מי שהניסיון הבא שלו באמת
-- יהיה שונה. אותה תבנית כמו 20261107090000_geocode_requeue_not_found.sql.
-- ---------------------------------------------------------------------------
update public.properties p
   set planning_attempts = 0,
       planning_error = null,
       planning_attempted_at = null
  from public.street_registry r
 where r.city = p.city
   and r.active
   and r.name_key = public.street_name_key(p.street)
   and r.name is distinct from p.street
   and p.planning_error = 'address_not_found'
   and p.planning_attempts > 0;
