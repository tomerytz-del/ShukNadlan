-- ============================================================================
-- ‏WebP בהעלאות התמונות
--
-- ה-CRM מקודד מעכשיו תמונות ל-WebP (ראו fileToResizedBlob ב-crm.html) ונופל
-- חזרה ל-JPEG רק בדפדפן שלא יודע לקודד. אותה איכות נראית, כ-30% פחות בייטים,
-- על כל תמונה שתעלה מכאן והלאה — בלי לגעת באף תמונה קיימת.
--
-- אם ‎allowed_mime_types‎ של הדלי מוגדר (לא null), ‏WebP חייב להופיע בו — אחרת
-- ההעלאה נדחית ב-400. כשהוא null הדלי מקבל כל סוג ממילא, ואז דווקא *כתיבת*
-- רשימה הייתה מצמצמת הרשאות קיימות — ולכן העדכון מותנה.
-- ============================================================================

update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct m)
           from unnest(allowed_mime_types || array['image/webp']) as m
       )
 where id = 'property-images'
   and allowed_mime_types is not null
   and not ('image/webp' = any(allowed_mime_types));
