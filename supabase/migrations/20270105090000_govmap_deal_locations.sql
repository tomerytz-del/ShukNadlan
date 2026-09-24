-- ============================================================================
-- מיקום לעסקאות הרשמיות מחוץ לעפולה, דרך GovMap
--
-- ## למה
--
-- לאף עסקה מחוץ לעפולה אין קואורדינטות (24.9.2026: נוף הגליל 1,512,
-- כרמיאל 1,512, מגדל העמק 1,130 ועוד - 0 עם מיקום). הגאוקוד של
-- geocode_backfill_queue רץ רק בערים עם ספק ב-city_geocode_sources, כלומר
-- עפולה. בלי מיקום אין חיפוש ברדיוס ואין CMA לפי מרחק - רק התאמת שם
-- רחוב, שהיא שבירה (מיגרציה 20270104090000).
--
-- ## מיקום ולא עסקה
--
-- ‏~4,600 עסקאות יושבות על ~1,500 מיקומים בלבד: אותו בניין נמכר שוב
-- ושוב, ועסקאות בלי רחוב חולקות גוש/חלקה. התור מחזיר **מיקום** (עיר +
-- רחוב/מספר + גוש/חלקה), והשמירה מעדכנת את כל העסקאות שבו. פי שלושה
-- פחות קריאות ל-GovMap.
--
-- ## שני מקורות, בסדר הזה
--
-- 1. כתובת - נקודת הבית, אחרי אימות רחוב/מספר/יישוב (assets/govmap.js).
-- 2. גוש/חלקה - מרכז החלקה, **רק אם הצלע הארוכה של החלקה עד 250 מ'.**
--    חלקת משק במושב היא מאות מטרים, ומרכז שלה הוא פין שנראה מדויק ואינו.
--
-- ## ניסיון שנכשל
--
-- נרשם ב-`geocode_attempted_at` + `geocode_error = 'govmap:<סיבה>'`, ומיקום
-- כזה אינו חוזר לתור 7 ימים. ‏`geocode_attempts` **אינו** נוגע: הוא המונה
-- של הצינור העירוני, ושלושה ניסיונות שם מוציאים את העסקה ממנו לתמיד.
-- על market_deals_official יש טריגר אחד בלבד (updated_at), ולכן העדכון זול.
--
-- ## הרשאות
--
-- מנהל/ת פלטפורמה בלבד, כמו govmap_admin_save. הקואורדינטות מגיעות
-- מהדפדפן - לכן תיבת ישראל, ועדכון **רק** לשורות בלי מיקום.
-- ============================================================================

create or replace function public.govmap_deal_locations(p_limit integer default 150)
returns table (
  city         text,
  street       text,
  house_number text,
  gush         text,
  helka        text,
  deals        integer
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  return query
  select o.city, o.street, o.house_number, o.gush, o.helka, count(*)::integer
    from public.market_deals_official o
   where (o.lat is null or o.lng is null)
     and nullif(btrim(coalesce(o.city, '')), '') is not null
     and btrim(o.city) <> 'עפולה'
     and (
       (nullif(btrim(coalesce(o.street, '')), '') is not null
        and nullif(btrim(coalesce(o.house_number, '')), '') is not null)
       or (o.gush ~ '^\d+$' and o.helka ~ '^\d+$')
     )
     and (o.geocode_attempted_at is null
          or o.geocode_attempted_at < now() - interval '7 days')
   group by o.city, o.street, o.house_number, o.gush, o.helka
   -- הכי הרבה עסקאות קודם: מיקום אחד שפותר 30 עסקאות שווה יותר משלושים
   -- מיקומים של עסקה אחת כל אחד
   order by count(*) desc, o.city, o.street, o.house_number
   limit greatest(1, least(coalesce(p_limit, 150), 500));
end;
$$;

comment on function public.govmap_deal_locations(integer) is
  'מיקומים (עיר + כתובת/גוש-חלקה) של עסקאות רשמיות מחוץ לעפולה שאין להן קואורדינטות. מנהל/ת פלטפורמה בלבד. docs/govmap.md.';

revoke all on function public.govmap_deal_locations(integer) from public, anon, authenticated;
grant execute on function public.govmap_deal_locations(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- ‏p_lat/p_lng = null -> רישום כישלון עם p_reason ('not_found' / 'parcel_too_large')
-- ---------------------------------------------------------------------------
create or replace function public.govmap_deal_save(
  p_city         text,
  p_street       text,
  p_house_number text,
  p_gush         text,
  p_helka        text,
  p_lat          double precision,
  p_lng          double precision,
  p_reason       text default null
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n integer;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  if p_lat is not null or p_lng is not null then
    if p_lat is null or p_lng is null
       or p_lat not between 29.3 and 33.5 or p_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
  elsif coalesce(p_reason, '') not in ('not_found', 'parcel_too_large') then
    raise exception 'bad_reason';
  end if;

  update public.market_deals_official o
     set lat = case when p_lat is not null then p_lat else o.lat end,
         lng = case when p_lat is not null then p_lng else o.lng end,
         geocode_attempted_at = now(),
         geocode_error = case when p_lat is not null then null else 'govmap:' || p_reason end
   where (o.lat is null or o.lng is null)
     and o.city = p_city
     and o.street is not distinct from p_street
     and o.house_number is not distinct from p_house_number
     and o.gush is not distinct from p_gush
     and o.helka is not distinct from p_helka;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.govmap_deal_save(text, text, text, text, text, double precision, double precision, text) is
  'מיקום מ-GovMap לכל העסקאות הרשמיות במיקום אחד, רק לשורות בלי קואורדינטות. בלי מיקום - רישום הכישלון. מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_deal_save(text, text, text, text, text, double precision, double precision, text)
  from public, anon, authenticated;
grant execute on function public.govmap_deal_save(text, text, text, text, text, double precision, double precision, text)
  to authenticated;
