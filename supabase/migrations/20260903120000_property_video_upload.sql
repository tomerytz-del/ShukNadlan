-- ============================================================================
-- העלאת סרטון נכס מהמכשיר
--
-- עד היום ‎properties.video_url‎ יכלה להחזיק רק כתובת חיצונית שהסוכן/ת הדביק/ה
-- (יוטיוב, וימאו). זה עובד למי שכבר העלה/תה את הסרטון ליוטיוב, אבל רוב
-- הסרטונים נולדים כקובץ בטלפון — וסוכן/ת שצילם/ה סיור בדירה נאלץ/ה לפתוח
-- חשבון יוטיוב רק כדי להצמיד אותו למודעה.
--
-- כאן נוסף המסלול השני: דלי ‎property-videos‎ שאליו ה-CRM מעלה את הקובץ
-- ישירות, בדיוק כמו ‎property-images‎. אין עמודה חדשה — ‎video_url‎ מקבלת את
-- הכתובת הציבורית של הקובץ, שהיא ‎https‎ ולכן עוברת את ה-‎check‎ הקיים. דף
-- הנכס לא צריך לדעת מאיפה הגיעה הכתובת: הוא מזהה קובץ מדיה לפי הסיומת
-- ומנגן אותו, ומטמיע יוטיוב/וימאו כ-iframe.
--
-- למה דלי נפרד ולא ‎property-images‎: לדלי התמונות יש ‎file_size_limit‎ של 3MB
-- ורשימת mime של תמונות בלבד. סרטון לא נכנס בשני התנאים, והרחבת המגבלות של
-- דלי התמונות הייתה מאפשרת להעלות סרטון 50MB לכל מקום שמעלה תמונה היום
-- (פרופיל, מיתוג, כתבות).
--
-- מגבלת הגודל: 50MB. זו גם תקרת ברירת המחדל הגלובלית של Storage בפרויקט,
-- ומגבלת דלי גבוהה ממנה לא הייתה מועילה — ההעלאה הייתה נחסמת ב-413 אחרי
-- שהקובץ כבר נשלח. כדי להעלות את התקרה צריך גם להעלות את הגלובלית
-- (Dashboard → Storage → Settings) וגם את ה-‎file_size_limit‎ כאן.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הדלי
--
-- ציבורי כמו ‎property-images‎: הסרטון מוצג בדף נכס פומבי, ואין בו מידע רגיש.
-- ‎allowed_mime_types‎ סוגר את הדלת בפני קבצים שאינם וידאו — בלעדיו הדלי היה
-- אחסון קבצים כללי לכל סוכן/ת מחובר/ת. ‎video/quicktime‎ נכלל כי זה מה שאייפון
-- מוסר מגלריית התמונות; ברוב המקרים זה H.264 שכל דפדפן מנגן.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-videos', 'property-videos', true, 52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
  set public            = true,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. הרשאות
--
-- אותה חלוקה בדיוק כמו ‎property-images‎: קריאה לכולם, וכתיבה רק לתיקייה
-- ‎<agent_id>/‎ של הסוכן/ת המחובר/ת דרך ‎current_agent_id()‎. כך סוכן/ת לא
-- יכול/ה למחוק או לדרוס את הסרטון של סוכן/ת אחר/ת גם אם ניחש/ה את הנתיב.
-- ---------------------------------------------------------------------------
drop policy if exists "property videos are publicly readable" on storage.objects;
create policy "property videos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'property-videos');

drop policy if exists "agent uploads own property videos" on storage.objects;
create policy "agent uploads own property videos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'property-videos'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  );

drop policy if exists "agent updates own property videos" on storage.objects;
create policy "agent updates own property videos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'property-videos'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  )
  with check (
    bucket_id = 'property-videos'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  );

drop policy if exists "agent deletes own property videos" on storage.objects;
create policy "agent deletes own property videos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'property-videos'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
  );

-- ---------------------------------------------------------------------------
-- 3. תיעוד העמודה
-- ---------------------------------------------------------------------------
comment on column public.properties.video_url is
  'כתובת סרטון הנכס. שני מקורות: קובץ שהועלה מה-CRM לדלי property-videos תחת '
  '<agent_id>/<property_id>/, או כתובת חיצונית שהודבקה (יוטיוב, וימאו, רחפן). '
  'דף הנכס מזהה לבד מה מהם ומנגן בהתאם.';
