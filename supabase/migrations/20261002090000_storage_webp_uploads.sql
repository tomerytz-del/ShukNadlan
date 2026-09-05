-- ============================================================================
-- ‏WebP בהעלאות התמונות
--
-- ה-CRM מקודד מעכשיו ל-WebP את התמונות שהצרכן היחיד שלהן הוא הדפדפן —
-- פרופיל הסוכן/ת, מיתוג המשרד וכתבות (ראו fileToResizedBlob ב-crm.html),
-- ונופל חזרה ל-JPEG בדפדפן שלא יודע לקודד. תמונות הנכס נשארות JPEG בכוונה:
-- הן יוצאות לפייסבוק ולמיילי ההתראות, ושם WebP אינו מובטח.
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
