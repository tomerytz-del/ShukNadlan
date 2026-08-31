-- ============================================================================
-- הגלריה של הסוכן/ת
--
-- דף המשרד (agency.html) מציג כבר היום גלריית תמונות משלו — עסקאות שנסגרו,
-- מסירת מפתחות, אירועים — מתוך agencies.gallery. דף הסוכן/ת קיבל עכשיו את
-- אותו מבנה מקטעים בדיוק (רצועות נכסים, גלריה, ביקורות, יצירת קשר), ולכן הוא
-- זקוק לאותו שדה ברמת הסוכן/ת: התמונות של המשרד אינן התמונות של הסוכן/ת, וכל
-- אחד/ת מספר/ת סיפור אחר.
--
-- המבנה זהה ל-agencies.gallery — מערך jsonb של ‎{"url": "...", "caption": "..."}‎
-- לפי הסדר שהסוכן/ת קבע/ה ב-CRM. סוכן/ת שלא העלה/תה תמונות משלו/ה מקבל/ת בדף
-- את גלריית המשרד כנפילה־לאחור, ולכן ריק כאן הוא מצב תקין ולא חוסר.
-- ============================================================================

alter table public.agency_members
  add column if not exists gallery jsonb not null default '[]'::jsonb;

-- הגלריה נקראת בדף הציבורי בלולאה שמצפה למערך. ערך שאינו מערך (אובייקט,
-- מחרוזת) היה מפיל את המקטע כולו, ולכן הצורה נאכפת במסד ולא רק בקוד הדף.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_gallery_is_array') then
    alter table public.agency_members
      add constraint agency_members_gallery_is_array
      check (jsonb_typeof(gallery) = 'array' and jsonb_array_length(gallery) <= 24);
  end if;
end $$;

comment on column public.agency_members.gallery is
  'גלריית הסוכן/ת: מערך של {url, caption} לפי הסדר, עד 24 תמונות. '
  'אותו מבנה בדיוק כמו agencies.gallery. מוצגת במקטע הגלריה בדף הסוכן/ת; '
  'ריק = הדף נופל לגלריית המשרד.';

-- ---------------------------------------------------------------------------
-- ה-view הציבורי
--
-- ‏create or replace מחייב לשמור על סדר העמודות הקיים, ולכן העמודה החדשה
-- נוספת בסוף. זהו תוכן שיווקי שהסוכן/ת מעלה/ה בכוונה לפרסום — באותה רמת
-- רגישות של photo_url ו-cover_url שכבר נחשפים כאן.
-- ---------------------------------------------------------------------------
create or replace view public.agency_members_public as
select
  id,
  agency_id,
  slug,
  display_name,
  bio,
  photo_url,
  role,
  active,
  phone_e164,
  cover_url,
  license_number,
  (ethics_code_accepted_at is not null and ethics_badge_revoked_at is null) as has_ethics_badge,
  years_experience,
  specialties,
  credentials,
  service_area,
  photo_position,
  gallery
from public.agency_members
where active = true;

comment on view public.agency_members_public is
  'פרופיל ציבורי של סוכנים פעילים: שם, תיאור, תמונה, מיקוד התמונה, תמונת נושא, '
  'מספר רישיון, phone_e164 לקישורי wa.me, has_ethics_badge (תו האיכות בתוקף), '
  'תגיות הפרופיל (ותק, התמחויות, הסמכות ואזור פעילות) וגלריית התמונות. '
  'אינו חושף אימייל, מצב חיוב, נתוני מנוי או תאריכי אישור/הסרה של הקוד האתי.';

revoke all on public.agency_members_public from anon, authenticated;
grant select on public.agency_members_public to anon, authenticated;
