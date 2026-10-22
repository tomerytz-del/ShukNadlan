-- ============================================================================
-- "כתובות לגבריאלה": רק כתובות שסוכנים שאלו עליהן, לא כל כתובות העסקאות
--
-- ## למה
--
-- תנאי השימוש של GovMap (כפי שנמצאו ב-22.10.2026, docs/govmap.md) אוסרים
-- איסוף אוטומטי מהשכבות והורדה בכמויות גדולות בלי אישור בכתב של המרכז
-- למיפוי ישראל. מילוי של 25,502 כתובות העסקאות הוא בדיוק זה. עד שיגיע
-- אישור (נשאל במייל), התור מחזיר **רק** את govmap_address_requests -
-- כתובות שסוכן/ת שאל/ה עליהן את גבריאלה. זה שימוש לפי דרישה, קרוב לשימוש
-- שאושר לנו: שאילתה אחת לכתובת שמישהו ביקש.
--
-- החתימה לא משתנה (city_remaining, cities_left), כדי שה-CRM לא יישבר
-- בין עליית האתר למיגרציה. ‏cities_left תמיד null. ‏govmap_address_cities
-- נשארת ריקה עד שיהיה אישור.
-- ============================================================================

create or replace function public.govmap_address_candidates(p_limit integer default 50)
returns table (
  city            text,
  street          text,
  house_number    text,
  gush            text,
  helka           text,
  city_remaining  bigint,
  cities_left     bigint
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  return query
  with todo as (
    select r.* from public.govmap_address_requests r
     where not exists (select 1 from public.govmap_address_planning g
                        where g.city_id = r.city_id and g.street_key = r.street_key
                          and g.house_number = r.house_number and g.fetched_at >= r.requested_at)
  )
  select t.city, t.street, t.house_number, null::text, null::text, count(*) over (), null::bigint
    from todo t
   order by t.requested_at
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function public.govmap_address_candidates(integer) is
  'כתובות שגבריאלה נשאלה עליהן ואינן במטמון. רק לפי דרישה - כל כתובות העסקאות ממתינות לאישור בכתב של מפ"י (docs/govmap.md). מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_address_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_address_candidates(integer) to authenticated;
