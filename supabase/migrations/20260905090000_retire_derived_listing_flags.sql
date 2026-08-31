-- ============================================================================
-- ניקוי שני דגלים שהמערכת כבר יודעת בעצמה: has_photo ו-tour_3d
--
-- שניהם היו צ׳קבוקסים ב"מאפייני מודעה" בטופס הנכס, כלומר הצהרה ידנית על
-- עובדה שכבר קיימת בנתונים:
--
--   has_photo — ‎images‎ מחזיק את התמונות עצמן
--   tour_3d   — ‎tour_3d_url‎ מחזיק את הקישור לסיור
--
-- כשהאמת יושבת בשני מקומות היא מתחילה לסתור את עצמה, וכך היה: ל-48 נכסים
-- היו תמונות ורק אחד סומן ‎has_photo‎, ולכן הסינון "עם תמונה" בדף הבית —
-- שרץ על מערך ‎features‎ — החזיר נכס אחד במקום 48. ‎tour_3d‎ לא סומן מעולם,
-- וגם לא הייתה אף כתובת סיור, כך שהתגית "סיור 3D" בדף הנכס (שהופיעה דווקא
-- כשאין קישור) הבטיחה סיור שאי אפשר לפתוח.
--
-- הצ׳קבוקסים הוסרו מטופס הנכס, סינוני דף הבית "עם תמונה" / "עם מחיר" /
-- "סיור 3D" עברו לרוץ על העמודות עצמן, ודף הנכס כבר לא מציג אותם. נשאר
-- לנקות את הערכים ההיסטוריים כדי שלא יישבו במערך בלי שאיש קורא אותם.
--
-- ‎moshav_kibbutz_only‎ ו-‎price_dropped‎ נשארים: אין להם מקור אחר בנתונים,
-- והם עדיין משמשים כסינון בדף הבית וכיתרון/תגית בדף הנכס.
--
-- הקובץ אידמפוטנטי — הרצה חוזרת לא תשנה דבר.
-- ============================================================================

update public.properties
   set features = array_remove(array_remove(features, 'has_photo'), 'tour_3d')
 where features && array['has_photo', 'tour_3d']::text[];

update public.saved_searches
   set required_features = array_remove(array_remove(required_features, 'has_photo'), 'tour_3d')
 where required_features && array['has_photo', 'tour_3d']::text[];

update public.agent_clients
   set required_features = array_remove(array_remove(required_features, 'has_photo'), 'tour_3d')
 where required_features && array['has_photo', 'tour_3d']::text[];
