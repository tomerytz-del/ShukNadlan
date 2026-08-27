-- ============================================================================
-- עדכון פרטי סוכן/ת מתוך ה-CRM
--
-- עד היום הפרופיל הציבורי של הסוכן/ת (שם, תיאור, תמונה) נקבע פעם אחת בהרשמה
-- ולא היה מסך לעדכן אותו. הקטגוריה החדשה "פרטי הסוכן/ת שלי" בדשבורד כותבת
-- ישירות ל-agency_members, ולכן צריך כאן שלושה דברים:
--
--   1. עמודת cover_url — תמונת הנושא של דף הסוכן (agent.html), במקביל ל
--      agencies.cover_url של דף המשרד.
--   2. שחרור license_number מהנעילה, אך ורק לעדכון עצמי.
--   3. חשיפת cover_url ו-license_number ב-view הציבורי, כדי שדף הסוכן
--      האנונימי יוכל להציג אותם.
-- ============================================================================

alter table public.agency_members add column if not exists cover_url text;

comment on column public.agency_members.cover_url is
  'תמונת הנושא (באנר) של דף הסוכן הציבורי. נשמרת ב-bucket property-images תחת <agent_id>/profile/.';

-- ---------------------------------------------------------------------------
-- מספר הרישיון — עדכון עצמי בלבד
--
-- הטריגר הקיים החזיר את license_number לערכו הישן בכל עדכון שאינו service_role,
-- ולכן מספר שהוקלד בטעות בהרשמה נשאר תקוע לנצח. עכשיו סוכן/ת יכול/ה לתקן את
-- המספר של עצמו/ה בלבד: כשמנהל/ת משרד עורכ/ת שורה של סוכן/ת אחר/ת המספר עדיין
-- נעול, וכך גם ערך ריק (העמודה NOT NULL, ומחיקה בטעות לא אמורה להפיל עדכון שם).
-- שאר השדות הרגישים — יתרה, מסלול, מכסה, חיוב והרשאות — נשארים נעולים בדיוק
-- כפי שהיו.
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

  if not is_self or new.license_number is null or btrim(new.license_number) = '' then
    new.license_number := old.license_number;
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
-- ה-view הציבורי
--
-- create or replace מחייב לשמור על סדר העמודות הקיים, ולכן השתיים החדשות
-- נוספות בסוף. מספר רישיון תיווך הוא פרט שמפורסם ממילא על כל מודעה, ותמונת
-- הנושא היא חלק מהפרופיל הציבורי — שניהם נחשפים רק לסוכנים פעילים, כמו שאר
-- העמודות ב-view. אימייל, יתרה ונתוני מנוי ממשיכים שלא להיחשף.
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
  license_number
from public.agency_members
where active = true;

comment on view public.agency_members_public is
  'פרופיל ציבורי של סוכנים פעילים: שם, תיאור, תמונה, תמונת נושא, מספר רישיון ו-phone_e164 לקישורי wa.me. אינו חושף אימייל, מצב חיוב או נתוני מנוי.';

revoke all on public.agency_members_public from anon, authenticated;
grant select on public.agency_members_public to anon, authenticated;
