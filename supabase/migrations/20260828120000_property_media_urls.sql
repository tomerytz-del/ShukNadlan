-- ============================================================================
-- מדיה עשירה על הנכס: סיור וירטואלי וסרטון
--
-- עד היום היה רק דגל ‎tour_3d‎ במערך ‎features‎ — כלומר "יש סיור", בלי דרך
-- להגיע אליו. הדגל הזה נשאר (הוא משמש כפילטר בדף הבית וכתגית בדף הנכס),
-- ולצידו שתי עמודות כתובת:
--
--   tour_3d_url — סיור וירטואלי (Matterport, Kuula, סיור 360 וכו׳)
--   video_url   — סרטון נכס או צילומי רחפן (יוטיוב, וימאו, קישור ישיר)
--
-- שתיהן כתובות חיצוניות ולא קבצים ב-storage: סיורים וסרטונים מתארחים אצל
-- הספק שיצר אותם, ואין טעם לשכפל אותם אלינו. ה-‎check‎ דורש ‎http(s)‎ כדי
-- שלא ייכנס לשם טקסט חופשי שייפול כקישור שבור בדף הנכס.
--
-- אין כאן טריגר שמסנכרן את ‎tour_3d‎ במערך ‎features‎ מול ‎tour_3d_url‎:
-- הדגל הוא הצהרה של הסוכן/ת ("יש סיור") והכתובת היא הקישור אליו, והם לא
-- תמיד מגיעים יחד. דף הנכס מציג את התגית אם קיים אחד מהשניים, ואת הכפתור
-- רק כשיש כתובת.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.properties
  add column if not exists tour_3d_url text,
  add column if not exists video_url   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_tour_3d_url_check') then
    alter table public.properties
      add constraint properties_tour_3d_url_check
      check (tour_3d_url is null or (tour_3d_url ~* '^https?://\S' and length(tour_3d_url) <= 1000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_video_url_check') then
    alter table public.properties
      add constraint properties_video_url_check
      check (video_url is null or (video_url ~* '^https?://\S' and length(video_url) <= 1000));
  end if;
end $$;

comment on column public.properties.tour_3d_url is
  'כתובת סיור וירטואלי / 360 (Matterport, Kuula וכו׳). כתובת חיצונית, לא קובץ ב-storage.';
comment on column public.properties.video_url is
  'כתובת סרטון הנכס או צילומי רחפן (יוטיוב, וימאו, קישור ישיר). כתובת חיצונית.';
