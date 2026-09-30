-- ---------------------------------------------------------------------------
-- תחום חדש לבעלי מקצוע: חברת ניקיון (‏advertiser_type = 'cleaning')
--
-- הרשימה הסגורה של התחומים יושבת בשלושה מקומות, וכולם חייבים להסכים:
--   1. ‏ad_placements_advertiser_type_check במסד (כאן).
--   2. ‏VALID_TYPES ב-professional-signup וב-professional-manage.
--   3. התוויות בכל דף שמציג תחום (‏docs/professional-cards.md).
--
-- ‏**ה-check הזה לא הופיע באף מיגרציה בריפו** — הוא נוצר לפני שהסכימה
-- נוהלה כאן, ולכן חיפוש בריפו אחרי רשימת התחומים לא מצא אותו. הגרסה
-- הראשונה של הקובץ הזה עשתה update בלבד ונפלה עליו ב-db push (‏23514, בלי
-- שום רשומה בהיסטוריה). עכשיו הוא נכתב כאן במלואו, ותחום עתידי מוסיף את
-- עצמו לרשימה בקובץ חדש.
--
-- אידמפוטנטית: ה-check נמחק ונוצר מחדש (‏drop if exists), וה-update נוגע
-- רק בשורה שעדיין 'general' — הוא אינו דורס תחום שהמפרסם/ת בחר/ה מאז.
-- ---------------------------------------------------------------------------
alter table public.ad_placements
  drop constraint if exists ad_placements_advertiser_type_check;

alter table public.ad_placements
  add constraint ad_placements_advertiser_type_check
  check (advertiser_type = any (array[
    'mortgage_advisor', 'appraiser', 'architect', 'interior_designer',
    'real_estate_lawyer', 'cleaning', 'general'
  ]::text[]));

-- הפרופיל הראשון בתחום: אייקוניקלין, שנרשמה כ"בעל/ת מקצוע" כללי כי התחום
-- עוד לא היה קיים.
update public.ad_placements
   set advertiser_type = 'cleaning'
 where id = '4a6283f1-6a71-4d3b-a82d-5afff14c132c'
   and placement_type = 'professional_card'
   and advertiser_type = 'general';
