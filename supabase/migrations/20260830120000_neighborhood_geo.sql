-- ============================================================================
-- מיקום ורדיוס לשכונה
--
-- בעפולה ובאזור העמקים המיקום שקובע נקרא ברמת השכונה — "רובע יזרעאל",
-- "גבעת המורה", "לב העמק C1", "מרכז העיר" — ולא ברמת העיר; מי שמחפש כאן כבר
-- יודע באיזו עיר. גלולות הסינון המהיר בראש דף הבית עובדות לפי
-- ‏properties.neighborhood_id‎, ולזה לא נדרש שום שינוי סכימה.
--
-- מה שכן נדרש הוא *איפה השכונה יושבת על המפה*. עד היום ל-neighborhoods היו
-- שם ועיר בלבד, ולכן דף הבית נאלץ להסיק את מרכז השכונה מממוצע הקואורדינטות
-- של הנכסים שבה. ההיסק הזה טוב, אבל הוא מתאר את מיקום *המודעות* ולא את
-- גבולות השכונה: שלוש מודעות באותו רחוב יגררו עיגול קטן בפינה של שכונה
-- גדולה, ושכונה בלי מודעות פעילות לא תקבל מיקום כלל.
--
-- שלוש העמודות כאן הן המקום שבו אפשר לסמן את הגבול האמיתי ידנית. הן nullable
-- בכוונה: כל עוד הן ריקות, דף הבית ממשיך להסיק מהנכסים כרגיל (ראו
-- ‏computeHoodGeometry‎ ב-index.html), וסימון ידני פשוט גובר עליו. אפשר למלא
-- שכונה אחת בכל פעם, בלי "יום מעבר".
--
-- הרשאות: הטבלה כבר ניתנת לקריאה ציבורית ("public read neighborhoods") וניתנת
-- לעריכה למנהל/ת הפלטפורמה בלבד. עמודות חדשות יורשות את אותן מדיניות, ואין
-- כאן מידע רגיש — מרכז שכונה הוא מידע ציבורי ממילא.
-- ============================================================================

alter table public.neighborhoods
  add column if not exists lat      double precision,
  add column if not exists lng      double precision,
  add column if not exists radius_m integer;

comment on column public.neighborhoods.lat is
  'קו רוחב של מרכז השכונה. ריק = דף הבית מחשב את המרכז מממוצע הנכסים שבשכונה.';
comment on column public.neighborhoods.lng is
  'קו אורך של מרכז השכונה. ריק = כמו lat, מחושב מהנכסים.';
comment on column public.neighborhoods.radius_m is
  'רדיוס השכונה במטרים, לעיגול שמצויר על מפת החיפוש. ריק = מחושב מהמרחק לנכס הרחוק ביותר.';

-- שמירה על ערכים שפויים: קואורדינטות בתחום החוקי, ורדיוס חיובי שאינו בולע
-- את כל העמק. מוסיפים רק אם עוד לא קיימת, כדי שהמיגרציה תהיה idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.neighborhoods'::regclass
      and conname = 'neighborhoods_geo_range'
  ) then
    alter table public.neighborhoods
      add constraint neighborhoods_geo_range check (
        (lat is null or (lat between -90 and 90)) and
        (lng is null or (lng between -180 and 180)) and
        (radius_m is null or (radius_m between 50 and 20000))
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- לסימון ידני של שכונה (מנהל/ת הפלטפורמה), למשל:
--
--   update public.neighborhoods
--      set lat = 32.6104, lng = 35.2872, radius_m = 900
--    where city = 'עפולה' and name = 'מרכז העיר';
--
-- ולבדיקה מה כבר מסומן ומה עדיין מחושב אוטומטית:
--
--   select city, name, lat, lng, radius_m
--     from public.neighborhoods
--    order by city, (lat is null), name;
-- ----------------------------------------------------------------------------
