-- ---------------------------------------------------------------------------
-- שני תחומים חדשים לבעלי מקצוע (19.11.2026):
--   electrician  חשמלאים
--   plumber      אינסטלטורים
--
-- אותה צורה של 20271118090000_professional_three_new_fields.sql: הרשימה הסגורה
-- יושבת בשני checks, ושניהם נוצרים מחדש עם כל הערכים הקיימים ועוד השניים.
--   1. ad_placements_advertiser_type_check - הכרטיסייה.
--   2. professional_accounts_kind_check - חשבון הכניסה, שנוצר עם kind של
--      הכרטיסייה. בלי העדכון כאן ההרשמה מצליחה ופתיחת החשבון נכשלת.
-- ולצדם VALID_TYPES ב-professional-signup וב-professional-manage, והתוויות
-- בדפים (docs/professional-cards.md, הסקיל professionals-pages).
--
-- אידמפוטנטית: drop if exists ואז add. אין update של שורות.
-- ---------------------------------------------------------------------------
alter table public.ad_placements
  drop constraint if exists ad_placements_advertiser_type_check;

alter table public.ad_placements
  add constraint ad_placements_advertiser_type_check
  check (advertiser_type = any (array[
    'mortgage_advisor', 'appraiser', 'architect', 'interior_designer',
    'real_estate_lawyer', 'cleaning', 'contractor', 'planning_consultant',
    'surveyor', 'electrician', 'plumber', 'general'
  ]::text[]));

alter table public.professional_accounts
  drop constraint if exists professional_accounts_kind_check;

alter table public.professional_accounts
  add constraint professional_accounts_kind_check
  check (kind = any (array[
    'mortgage_advisor', 'appraiser', 'architect', 'interior_designer',
    'real_estate_lawyer', 'cleaning', 'contractor', 'planning_consultant',
    'surveyor', 'electrician', 'plumber', 'general'
  ]::text[]));
