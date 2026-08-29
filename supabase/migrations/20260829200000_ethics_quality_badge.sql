-- ============================================================================
-- הקוד האתי ותו האיכות
--
-- תו האיכות ("עומד בתקן האתי") אינו קישוט: הוא מוצג בדף הסוכן/ת, בדף המשרד
-- ולצד תמונת הסוכן/ת המטפל/ת בכל מודעת נכס, ולכן הוא חייב להיות מגובה ברשומה
-- שאומרת מי אישר את הקוד, מתי, ולאיזו גרסה שלו.
--
-- שלוש עמודות בכל אחת משתי הטבלאות (סוכנים ומשרדים):
--
--   ethics_code_accepted_at  — מתי אושר הקוד. ‏null = לא אושר, אין תו.
--   ethics_code_version      — לאיזו גרסה של הקוד ניתן האישור. כשהקוד ישתנה
--                              מהותית נעלה את הגרסה, וכל מי שאישר גרסה קודמת
--                              יידרש לאשר מחדש בלי לאבד את התיעוד הקודם.
--   ethics_badge_revoked_at  — הסרת התו בעקבות הפרת התקנון. נעולה לחלוטין
--                              להנהלת הפלטפורמה (service_role): מתווך/ת שהתו
--                              שלו/ה הוסר לא יכול/ה לנקות את ההסרה בעצמו/ה,
--                              וגם לא לעקוף אותה באישור חוזר של הקוד.
--
-- התו מוצג אך ורק כאשר ‎accepted_at is not null and revoked_at is null‎.
-- ה-view הציבורי לא חושף את התאריכים עצמם אלא בוליאני מחושב אחד, כדי
-- שלוגיקת התצוגה תישב במקום אחד ולא תשוכפל בכל דף.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists ethics_code_accepted_at timestamptz,
  add column if not exists ethics_code_version     text,
  add column if not exists ethics_badge_revoked_at timestamptz;

comment on column public.agency_members.ethics_code_accepted_at is
  'מתי הסוכן/ת אישר/ה את הקוד האתי. null = טרם אושר, ולכן אין תו איכות.';
comment on column public.agency_members.ethics_code_version is
  'גרסת הקוד האתי שאושרה (למשל 2026-08). מאפשרת לדרוש אישור מחדש כשהקוד משתנה.';
comment on column public.agency_members.ethics_badge_revoked_at is
  'הסרת תו האיכות בעקבות הפרת התקנון. נכתב על ידי הנהלת הפלטפורמה בלבד.';

alter table public.agencies
  add column if not exists ethics_code_accepted_at timestamptz,
  add column if not exists ethics_code_version     text,
  add column if not exists ethics_badge_revoked_at timestamptz;

comment on column public.agencies.ethics_code_accepted_at is
  'מתי מנהל/ת המשרד אישר/ה את הקוד האתי בשם המשרד. null = אין תו למשרד.';
comment on column public.agencies.ethics_code_version is
  'גרסת הקוד האתי שאושרה בשם המשרד.';
comment on column public.agencies.ethics_badge_revoked_at is
  'הסרת תו האיכות מהמשרד. הנהלת הפלטפורמה בלבד.';

create index if not exists agency_members_ethics_badge_idx
  on public.agency_members (ethics_code_accepted_at)
  where ethics_code_accepted_at is not null and ethics_badge_revoked_at is null;

-- ---------------------------------------------------------------------------
-- 2. הגנה על השדות בשורת הסוכן/ת
--
-- מרחיב את הטריגר הקיים בשתי נקודות:
--
--   א. ‏ethics_badge_revoked_at נעול לחלוטין, בדיוק כמו is_platform_admin —
--      גם מנהל/ת משרד לא יכול/ה להסיר או להחזיר תו.
--   ב. אישור הקוד הוא אישי: רק הסוכן/ת עצמו/ה יכול/ה לאשר או לבטל את האישור
--      שלו/ה. מנהל/ת משרד שעורכ/ת שורה של סוכן/ת אחר/ת לא יכול/ה "לחתום"
--      במקומו/ה — אישור אתי שנחתם בידי מישהו אחר אינו שווה דבר. התאריך עצמו
--      נקבע כאן ב-‎now()‎ ולא מהלקוח, כדי שלא ייכתב תאריך רטרואקטיבי.
--
-- שאר השדות הרגישים — יתרה, מסלול, מכסה, חיוב, הרשאות ומספר רישיון — נשארים
-- בדיוק כפי שהיו.
-- ---------------------------------------------------------------------------
create or replace function public.protect_sensitive_agency_member_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_self boolean := old.user_id is not null and old.user_id = (select auth.uid());
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  new.credit_balance := old.credit_balance;
  new.tier := old.tier;
  new.free_quota_used := old.free_quota_used;
  new.free_quota_cycle_start := old.free_quota_cycle_start;
  new.payment_token_id := old.payment_token_id;
  new.billing_status := old.billing_status;
  new.pending_tier_change := old.pending_tier_change;
  new.pending_tier_change_at := old.pending_tier_change_at;
  new.subscription_id := old.subscription_id;
  new.is_platform_admin := old.is_platform_admin; -- נעול לחלוטין, גם למנהל משרד רגיל
  new.is_mortgage_advisor := old.is_mortgage_advisor; -- נעול לחלוטין — מנהל/ת הפלטפורמה בלבד
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at; -- הסרת תו: הנהלת הפלטפורמה בלבד

  if not is_self or new.license_number is null or btrim(new.license_number) = '' then
    new.license_number := old.license_number;
  end if;

  -- אישור הקוד האתי — אישי בלבד, והחותמת נקבעת בשרת
  if not is_self then
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
    new.ethics_code_version := old.ethics_code_version;
  elsif new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;               -- ביטול אישור מנקה גם את הגרסה
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();          -- אישור חדש (או לגרסה חדשה) — עכשיו
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;

  if is_self then
    new.role := old.role;
    new.active := old.active;
    new.agency_id := old.agency_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. הגנה מקבילה על שורת המשרד
--
-- ‏agencies נערכת מה-CRM על ידי מנהל/ת המשרד (מיתוג, מוטו, גלריה), ולכן שדה
-- ההסרה חייב טריגר משלו — אחרת מנהל/ת שהתו של המשרד הוסר ממנו היה/הייתה
-- מנקה את ההסרה באותה בקשה שבה נשמר הלוגו.
-- ---------------------------------------------------------------------------
create or replace function public.protect_agency_ethics_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  new.ethics_badge_revoked_at := old.ethics_badge_revoked_at;

  if new.ethics_code_accepted_at is null then
    new.ethics_code_version := null;
  elsif old.ethics_code_accepted_at is null
        or new.ethics_code_version is distinct from old.ethics_code_version then
    new.ethics_code_accepted_at := now();
  else
    new.ethics_code_accepted_at := old.ethics_code_accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists agencies_protect_ethics_fields on public.agencies;
create trigger agencies_protect_ethics_fields
  before update on public.agencies
  for each row execute function public.protect_agency_ethics_fields();

-- ---------------------------------------------------------------------------
-- 4. ה-view הציבורי
--
-- ‏create or replace מחייב לשמור על סדר העמודות הקיים, ולכן העמודה החדשה
-- נוספת בסוף. מה שנחשף הוא בוליאני מחושב אחד ולא התאריכים: לגולש/ת מספיק
-- לדעת אם התו בתוקף, ואילו "מתי הוסר התו ולמה" הוא מידע ניהולי.
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
  (ethics_code_accepted_at is not null and ethics_badge_revoked_at is null) as has_ethics_badge
from public.agency_members
where active = true;

comment on view public.agency_members_public is
  'פרופיל ציבורי של סוכנים פעילים: שם, תיאור, תמונה, תמונת נושא, מספר רישיון, '
  'phone_e164 לקישורי wa.me ו-has_ethics_badge (תו האיכות בתוקף). '
  'אינו חושף אימייל, מצב חיוב, נתוני מנוי או תאריכי אישור/הסרה של הקוד האתי.';

revoke all on public.agency_members_public from anon, authenticated;
grant select on public.agency_members_public to anon, authenticated;
