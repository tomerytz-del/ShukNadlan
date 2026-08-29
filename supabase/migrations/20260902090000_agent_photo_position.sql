-- ============================================================================
-- מיקוד תמונת הסוכן/ת (photo_position)
--
-- תמונת הסוכן/ת מוצגת בכל הדפים עם object-fit:cover, כלומר החלון שמציג אותה
-- כמעט אף פעם לא באותן פרופורציות של הקובץ שהועלה. ברירת המחדל של הדפדפן
-- היא לחתוך סביב *מרכז* התמונה, ובפורטרט טיפוסי הפנים יושבות בשליש העליון —
-- ולכן המצח והשיער נחתכו בראש דף הסוכן/ת.
--
-- העמודה שומרת נקודת מיקוד אחת שהסוכן/ת מסמן/ת על התמונה שלו/ה ב-CRM,
-- בפורמט של CSS object-position ("50% 22%"). כל דף שמציג את התמונה מזין את
-- הערך ל-object-position, וכך אותה נקודה נשארת בתוך הפריים בכל יחס גובה-רוחב
-- ובכל גודל — במקום לגזור מחדש את הקובץ עצמו לכל שימוש.
--
-- הערך הוא רשות: שורה בלי מיקוד מקבלת בדפים את ברירת המחדל '50% 25%', שהיא
-- הפריים הנכון לרוב הפורטרטים.
-- ============================================================================

alter table public.agency_members
  add column if not exists photo_position text;

-- הערך נכתב מהדפדפן ונכנס ישירות ל-CSS, ולכן הוא נבדק כאן בצורה הדוקה: שני
-- מספרים שלמים 0–100 באחוזים ורווח אחד ביניהם, ותו לא.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_photo_position_check') then
    alter table public.agency_members
      add constraint agency_members_photo_position_check
      check (
        photo_position is null
        or photo_position ~ '^([0-9]|[1-9][0-9]|100)% ([0-9]|[1-9][0-9]|100)%$'
      );
  end if;
end $$;

comment on column public.agency_members.photo_position is
  'נקודת המיקוד של תמונת הסוכן/ת בפורמט CSS object-position ("50% 22%"). '
  'נקבעת ב-CRM בלחיצה על התמונה, ומונעת חיתוך של הפנים בכל מקום שהתמונה מוצגת בו. '
  'ריק = ברירת המחדל בדפים (50% 25%).';

-- ---------------------------------------------------------------------------
-- ה-view הציבורי
--
-- ‏create or replace מחייב לשמור על סדר העמודות הקיים, ולכן העמודה החדשה
-- נוספת בסוף. זהו נתון תצוגה טהור שנלווה ל-photo_url שכבר נחשף כאן.
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
  photo_position
from public.agency_members
where active = true;

comment on view public.agency_members_public is
  'פרופיל ציבורי של סוכנים פעילים: שם, תיאור, תמונה, מיקוד התמונה, תמונת נושא, '
  'מספר רישיון, phone_e164 לקישורי wa.me, has_ethics_badge (תו האיכות בתוקף) '
  'ותגיות הפרופיל (ותק, התמחויות, הסמכות ואזור פעילות). '
  'אינו חושף אימייל, מצב חיוב, נתוני מנוי או תאריכי אישור/הסרה של הקוד האתי.';

revoke all on public.agency_members_public from anon, authenticated;
grant select on public.agency_members_public to anon, authenticated;
