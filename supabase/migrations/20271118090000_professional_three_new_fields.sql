-- ---------------------------------------------------------------------------
-- שלושה תחומים חדשים לבעלי מקצוע (18.11.2026):
--   contractor           קבלני בנייה ושיפוצים
--   planning_consultant  יועצי תכנון ובנייה
--   surveyor             מודדים מוסמכים
--
-- דף ההרשמה (professional-signup.html) עוצב מחדש ומציע אותם בבחירת התחום.
-- הרשימה הסגורה של התחומים יושבת בשני checks במסד, וכולם חייבים להסכים עם
-- VALID_TYPES ב-professional-signup וב-professional-manage ועם התוויות בדפים
-- (docs/professional-cards.md, הסקיל professionals-pages):
--   1. ad_placements_advertiser_type_check - הכרטיסייה.
--   2. professional_accounts_kind_check - חשבון הכניסה, שנוצר עם kind של
--      הכרטיסייה (professional-account). בלי העדכון כאן, בעל/ת מקצוע בתחום
--      חדש היה/הייתה נרשם/ת בהצלחה ונכשל/ת בפתיחת החשבון.
--
-- אידמפוטנטית: כל check נמחק ונוצר מחדש (drop if exists). אין update של
-- שורות: התחומים חדשים, ואף כרטיסייה קיימת אינה עוברת אליהם מעצמה.
-- ---------------------------------------------------------------------------
alter table public.ad_placements
  drop constraint if exists ad_placements_advertiser_type_check;

alter table public.ad_placements
  add constraint ad_placements_advertiser_type_check
  check (advertiser_type = any (array[
    'mortgage_advisor', 'appraiser', 'architect', 'interior_designer',
    'real_estate_lawyer', 'cleaning', 'contractor', 'planning_consultant',
    'surveyor', 'general'
  ]::text[]));

alter table public.professional_accounts
  drop constraint if exists professional_accounts_kind_check;

alter table public.professional_accounts
  add constraint professional_accounts_kind_check
  check (kind = any (array[
    'mortgage_advisor', 'appraiser', 'architect', 'interior_designer',
    'real_estate_lawyer', 'cleaning', 'contractor', 'planning_consultant',
    'surveyor', 'general'
  ]::text[]));
