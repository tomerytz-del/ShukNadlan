-- הצעה (swipe-all §3.1, 1.11.2026) - לא רצה. מיגרציה אמיתית רק אחרי אישור של תומר, כקובץ ב-supabase/migrations.
--
-- למה: בהחלקה, סרטון לרוחב מוצג כחלון באמצע הכרטיס, וסרטון לאורך על כל הכרטיס. היחס ידוע לדפדפן רק
-- אחרי loadedmetadata, ובכניסה מקישור (?pid=) זה יכול לקחת שניות. עד אז swipe.js מנחש מהפוסטר
-- (reelGuess), והפוסטר הוא לרוב תמונה של הנכס ולא פריים מהסרטון (9 מתוך 63 פוסטרים אמיתיים).
-- היחס המדויק כבר שמור במסד, אבל רק ב-property_video_jobs.aspect_ratio, שהדף הציבורי אינו קורא:
-- SELECT 1.11.2026 - 50 מתוך 63 הסרטונים הפעילים: 32 ב-16:9 ו-18 ב-9:16.
--
-- מה זה עולה: כלום. אין קריאה לשירות חיצוני, רק העתקה בתוך המסד. אבל זו כתיבה לנתוני ייצור, ולכן
-- רק באישור. 13 הסרטונים שלא הופקו אצלנו (הועלו ידנית) נשארים null והדפדפן ממשיך לנחש.
--
-- אחרי ההרצה: להוסיף video_aspect ל-SELECT ב-assets/swipe.js (שורה 22) ולהעדיף אותו ב-reelGuess.
-- הסדר חשוב (deploy-path): המיגרציה קודם, והקוד שקורא את העמודה רק אחריה - אחרת השאילתה נכשלת.

alter table public.properties add column if not exists video_aspect numeric;
comment on column public.properties.video_aspect is
  'רוחב/גובה של הסרטון ב-video_url (16:9 = 1.7778). נכתב בהפקה (property-video-callback); null = לא ידוע';

update public.properties p
   set video_aspect = case j.aspect_ratio when '16:9' then 16.0/9 when '9:16' then 9.0/16 when '1:1' then 1 end
  from public.property_video_jobs j
 where j.result_url = p.video_url
   and j.aspect_ratio in ('16:9', '9:16', '1:1')
   and p.video_aspect is null;

-- ובהמשך, ב-property-video-callback: באותו update שכותב את video_url לנכס, גם video_aspect מתוך job.aspect_ratio.
