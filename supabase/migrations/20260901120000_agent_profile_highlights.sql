-- ============================================================================
-- תגיות הכישורים בראש דף הסוכן/ת
--
-- הראש של agent.html הציג עד היום פסקת ביוגרפיה חופשית אחת. כל מה שהעין
-- באמת מחפשת בשנייה הראשונה — ותק, תחומי התמחות, הסמכות ואזור פעילות —
-- היה קבור בתוכה כטקסט. ארבעת השדות כאן מוציאים את אותם נתונים מהפסקה אל
-- שדות מובנים, כדי שהדף יוכל להציג אותם כתגיות ושורת מדדים ולא כמשפט.
--
-- הביוגרפיה נשארת בדיוק כפי שהיא: התגיות מוסיפות לה ולא מחליפות אותה, וכל
-- שדה כאן הוא רשות — סוכן/ת שלא מילא/ה אותו פשוט לא מקבל/ת את התגית.
-- ============================================================================

alter table public.agency_members
  add column if not exists years_experience smallint,
  add column if not exists specialties      text[],
  add column if not exists credentials      text,
  add column if not exists service_area     text;

-- ותק שלילי או בן 90 שנה הוא תקלת הקלדה, לא נתון. הגבול העליון נדיב בכוונה.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_years_experience_check') then
    alter table public.agency_members
      add constraint agency_members_years_experience_check
      check (years_experience is null or (years_experience >= 0 and years_experience <= 70));
  end if;
  -- ‏specialties הוא רשימת תגיות קצרה לתצוגה, לא מאגר. שמונה תגיות הן כבר
  -- יותר ממה שנכנס לשורה אחת בראש הדף.
  if not exists (select 1 from pg_constraint where conname = 'agency_members_specialties_check') then
    alter table public.agency_members
      add constraint agency_members_specialties_check
      check (specialties is null or array_length(specialties, 1) <= 8);
  end if;
end $$;

comment on column public.agency_members.years_experience is
  'שנות ותק בנדל״ן. מוצג כתגית "N+ שנות ניסיון" בראש דף הסוכן/ת. רשות.';
comment on column public.agency_members.specialties is
  'תחומי התמחות לתצוגה כתגיות (מגורים, מסחרי, מגרשים וכו׳). רשות, עד 8.';
comment on column public.agency_members.credentials is
  'הסמכות ותארים בשורה אחת — למשל "B.A ומגשר מוסמך". טקסט חופשי קצר, רשות.';
comment on column public.agency_members.service_area is
  'אזור ההתמחות כפי שהסוכן/ת מנסח/ת אותו ("עפולה והעמקים"). מוצג בשורת המדדים. רשות.';

-- ---------------------------------------------------------------------------
-- ה-view הציבורי
--
-- ‏create or replace מחייב לשמור על סדר העמודות הקיים, ולכן הארבע החדשות
-- נוספות בסוף. כולן פרטי פרופיל שיווקיים שהסוכן/ת בוחר/ת לפרסם — באותה רמת
-- רגישות של bio ושל license_number שכבר נחשפים כאן. אימייל, יתרה ונתוני
-- מנוי ממשיכים שלא להיחשף.
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
  service_area
from public.agency_members
where active = true;

comment on view public.agency_members_public is
  'פרופיל ציבורי של סוכנים פעילים: שם, תיאור, תמונה, תמונת נושא, מספר רישיון, '
  'phone_e164 לקישורי wa.me, has_ethics_badge (תו האיכות בתוקף) ותגיות הפרופיל '
  '(ותק, התמחויות, הסמכות ואזור פעילות). '
  'אינו חושף אימייל, מצב חיוב, נתוני מנוי או תאריכי אישור/הסרה של הקוד האתי.';

revoke all on public.agency_members_public from anon, authenticated;
grant select on public.agency_members_public to anon, authenticated;
