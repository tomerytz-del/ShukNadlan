-- ===========================================================================
-- ‏property-visualizations: הדלי היחיד בלי הגבלת סוג קובץ וגודל
--
-- ‏כל שאר הדליים מגבילים סוג וגודל (‏docs/isms/statement-of-applicability.md,
-- ‏8.7). הדלי הזה ציבורי, ובלי
-- הגבלה אפשר היה להעלות אליו HTML או SVG עם סקריפט ולהגיש אותו מהדומיין
-- של Supabase. בפועל יש בו רק image/jpeg (468 קבצים, הגדול 1MB, ‏13.10.2026),
-- ולכן ההגבלה אינה שוברת דבר. ‏webp ו-png נוספים כמו בדלי property-images.
-- ===========================================================================

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 10485760
 where id = 'property-visualizations'
   and (allowed_mime_types is null or file_size_limit is null);
