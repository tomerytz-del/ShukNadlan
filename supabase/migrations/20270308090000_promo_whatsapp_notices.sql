-- ---------------------------------------------------------------------------
-- תזכורות וואטסאפ לפני סוף הטבת ההשקה: שבוע לפני, ויום לפני
--
-- עד היום שתי התראות - 30 ו-14 יום לפני (‏promo_notice_1_at/2_at על
-- agency_members). ‏promo-lifecycle מוסיפה עכשיו עוד שתיים, 7 ויום אחד,
-- שיוצאות בפעמון ומשם בוואטסאפ (‏notification-push), בלי מייל.
--
-- **למה טבלה ולא עוד שתי עמודות.** כל עמודה על agency_members שהדפדפן
-- אסור לו לכתוב נכנסת ל-protect_sensitive_agency_member_fields, והפונקציה
-- הזו נכתבת מחדש במלואה בכל שינוי (‏20261031090000) - שמונים שורות של
-- שדות כסף ורישיון, שהעתקה לא מדויקת שלהן פותחת פרצה. שורה כאן נכתבת רק
-- ב-service_role (‏RLS בלי policy), ולכן אין מה להגן עליו.
--
-- **הסימון הוא ה-insert.** ‏(member_id, days_before) ייחודי, ו-promo-lifecycle
-- שולחת רק אחרי insert ... on conflict do nothing שהחזיר שורה: אותו "סימון
-- לפני שליחה" של העמודות, ואטומי גם בשתי הרצות במקביל.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

create table if not exists public.promo_notices (
  member_id   uuid        not null references public.agency_members(id) on delete cascade,
  days_before int         not null check (days_before > 0),
  promo_ends_at timestamptz not null,
  sent_at     timestamptz not null default now(),
  primary key (member_id, days_before)
);

comment on table public.promo_notices is
  'תזכורות לפני סוף הטבת ההשקה שאינן עמודה על agency_members (7 ויום אחד). שורה = נשלחה. promo-lifecycle בלבד.';

alter table public.promo_notices enable row level security;

revoke all on public.promo_notices from anon, authenticated;
grant all on public.promo_notices to service_role;
