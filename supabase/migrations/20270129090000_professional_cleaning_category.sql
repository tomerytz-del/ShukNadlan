-- ---------------------------------------------------------------------------
-- תחום חדש לבעלי מקצוע: חברת ניקיון (‏advertiser_type = 'cleaning')
--
-- ‏advertiser_type הוא text בלי check במסד — הרשימה הסגורה יושבת ב-
-- ‏VALID_TYPES של professional-signup ו-professional-manage, והתוויות בכל
-- דף שמציג אותן (‏docs/professional-cards.md). לכן אין כאן DDL, רק העברת
-- הפרופיל הראשון בתחום, אייקוניקלין, שנרשם כ"בעל/ת מקצוע" כללי כי התחום
-- עוד לא היה קיים.
--
-- אידמפוטנטית: התנאי על 'general' משאיר את השורה כמו שהיא בהרצה חוזרת,
-- ואינו דורס תחום שהמפרסם/ת בחר/ה בעצמו/ה מאז.
-- ---------------------------------------------------------------------------
update public.ad_placements
   set advertiser_type = 'cleaning'
 where id = '4a6283f1-6a71-4d3b-a82d-5afff14c132c'
   and placement_type = 'professional_card'
   and advertiser_type = 'general';
