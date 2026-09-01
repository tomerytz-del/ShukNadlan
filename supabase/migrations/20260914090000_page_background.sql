-- ============================================================================
-- רקע הדף של המשרד ושל הסוכן/ת
--
-- דפי המשרד, הסוכן/ת והנכס קיבלו את הרקע הזורם של האתר (שמש, קו רקיע וגלים —
-- ‏assets/page-bg.js), אותו רקע שכבר יש בדף הבית וב-CRM. זו ברירת המחדל: מעבר
-- מדף הבית לדף משרד לא אמור להרגיש כמו מעבר לאתר אחר.
--
-- משרד שמעדיף רקע חלק — למשל כי ערכת הצבעים שלו כהה, או כי הוא רוצה שהתמונות
-- שלו יעמדו לבד — יכול לכבות אותו ב-CRM ולהחזיר את ברירת המחדל באותו מקום.
-- הערכים: 'plain' מכבה, NULL (וכל ערך אחר) הוא ברירת המחדל, כלומר מוצג. מכאן
-- שכל השורות הקיימות מקבלות את ההתנהגות החדשה בלי backfill.
--
-- שתי רמות, ולכן שני מקומות אחסון:
--
--   • המשרד — ‏agencies.colors->>'page_bg'. ‏colors היא כבר היום ה-blob של
--     "איך דף המשרד נראה" (ערכת הצבעים ושם הערכה), נטענת ונשמרת ביחידה אחת
--     ב-CRM, ו-agency.html שולף אותה ב-select('*'). עמודה נפרדת הייתה מוסיפה
--     כאן רק מקום שני לשכוח בו, ולכן אין כאן שינוי סכמה — רק מפתח חדש ב-jsonb
--     שמתועד בהערת העמודה למטה.
--
--   • הסוכן/ת — ‏agency_members.page_bg, העמודה שנוספת כאן. ל-agency_members
--     אין blob מקביל, וגלריה או תגיות הן לא המקום להעדפת תצוגה.
--
-- דף הסוכן/ת מעדיף את הבחירה האישית, ובהיעדרה נופל לבחירת המשרד.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ההעדפה של הסוכן/ת
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists page_bg text;

-- הערך נקרא בדף הציבורי כדי להחליט אם להרכיב את שכבת הרקע. ערך חופשי היה
-- מתנהג כמו ברירת מחדל בשקט, ולכן הצורה נאכפת במסד ולא רק בטופס.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_page_bg_valid') then
    alter table public.agency_members
      add constraint agency_members_page_bg_valid
      check (page_bg is null or page_bg in ('flow', 'plain'));
  end if;
end $$;

comment on column public.agency_members.page_bg is
  'רקע דף הסוכן/ת: ''plain'' = רקע חלק, ''flow'' = הרקע הזורם של האתר, '
  'NULL = ירושה מבחירת המשרד (agencies.colors->>''page_bg'') ובהיעדרה ברירת המחדל, כלומר הרקע הזורם.';

comment on column public.agencies.colors is
  'המיתוג של דף המשרד כ-jsonb: palette ושבעת גווני הערכה (primary, primary_dark, '
  'accent, accent_dark, paper, paper_raised, line), ובנוסף page_bg — '
  '''plain'' לרקע חלק, כל ערך אחר או היעדרו = הרקע הזורם של האתר (ברירת המחדל).';

-- ---------------------------------------------------------------------------
-- 2. ה-view הציבורי
--
-- ‏create or replace מחייב לשמור על סדר העמודות הקיים, ולכן העמודה החדשה
-- נוספת בסוף. זו העדפת תצוגה שהסוכן/ת קובע/ת בכוונה לדף הציבורי שלו/ה —
-- באותה רמת רגישות בדיוק של cover_url ושל photo_position שכבר נחשפים כאן.
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
  gallery,
  page_bg
from public.agency_members
where active = true;

comment on view public.agency_members_public is
  'פרופיל ציבורי של סוכנים פעילים: שם, תיאור, תמונה, מיקוד התמונה, תמונת נושא, '
  'מספר רישיון, phone_e164 לקישורי wa.me, has_ethics_badge (תו האיכות בתוקף), '
  'תגיות הפרופיל (ותק, התמחויות, הסמכות ואזור פעילות), גלריית התמונות ובחירת רקע הדף. '
  'אינו חושף אימייל, מצב חיוב, נתוני מנוי או תאריכי אישור/הסרה של הקוד האתי.';

revoke all on public.agency_members_public from anon, authenticated;
grant select on public.agency_members_public to anon, authenticated;
