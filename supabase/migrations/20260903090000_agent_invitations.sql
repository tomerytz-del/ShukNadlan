-- ============================================================================
-- הזמנת סוכן/ת למשרד, וזיהוי אוטומטי בכניסה הראשונה
--
-- הבעיה שזה פותר, כפי שקרתה בפועל:
-- מנהל/ת המשרד הוסיף/ה סוכנת דרך "צוות המשרד". הטופס ביקש אימייל וסיסמה
-- זמנית, add-team-member יצר חשבון auth על האימייל שהוקלד וקשר אליו מיד את
-- שורת ה-agency_members. האימייל הוקלד עם אות אחת עודפת. התוצאה: השורה נקשרה
-- לחשבון רפאים שאיש לא ייכנס אליו לעולם, ואילו הסוכנת — שנכנסה עם הכתובת
-- האמיתית שלה — הגיעה כמשתמשת חדשה בלי שורת שיוך, ולכן קיבלה את מסך "עדיין
-- לא פתחת משרד תיווך". שגיאת הקלדה אחת, בלי שום משוב, מוציאה סוכן/ת מהמשרד.
--
-- שלושת התיקונים כאן, בסדר שבו הם פועלים:
--   1. הזמנה במקום סיסמה. השורה נוצרת עם user_id ריק ואסימון הזמנה שנשלח
--      במייל. הקישור הוא ההוכחה, ולכן הוא מחבר גם כשהכתובת שהוקלדה שגויה
--      (המנהל/ת יכול/ה להעתיק אותו ולשלוח בוואטסאפ).
--   2. זיהוי לפי אימייל. מי שנכנס/ת בלי שורה משויכת, וקיימת שורה ממתינה עם
--      אותה כתובת — משויך/ת אוטומטית. אין כאן "משתמש חדש" בכלל.
--   3. בקשת שיוך לפי מספר רישיון. רשת הביטחון לשגיאת ההקלדה עצמה: הסוכן/ת
--      מזדהה במספר הרישיון, והמנהל/ת מאשר/ת בלחיצה. בלי גישה למסד, בלי תמיכה.
--
-- הכתיבה לשתי הטבלאות נעשית אך ורק מ-Edge Functions עם service role; ה-RLS
-- כאן פותח קריאה בלבד, ורק למי שזה נוגע לו.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הזמנות. הטבלה כבר קיימת במסד מגלגול קודם ואף פעם לא הייתה בשימוש
--    (0 שורות), ולכן היא מורחבת ולא נוצרת מחדש — עמודה עמודה, אידמפוטנטית.
-- ---------------------------------------------------------------------------
create table if not exists public.agency_invitations (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null,
  invited_by uuid,
  contact    text not null,
  token      text not null default encode(gen_random_bytes(24), 'hex'),
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.agency_invitations
  add column if not exists member_id   uuid,
  add column if not exists expires_at  timestamptz not null default (now() + interval '30 days'),
  add column if not exists sent_at     timestamptz,
  add column if not exists send_error  text,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_invitations_member_fkey') then
    alter table public.agency_invitations
      add constraint agency_invitations_member_fkey
      foreign key (member_id) references public.agency_members(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agency_invitations_status_check') then
    alter table public.agency_invitations
      add constraint agency_invitations_status_check
      check (status in ('pending','accepted','revoked'));
  end if;
end $$;

create unique index if not exists agency_invitations_token_key
  on public.agency_invitations (token);

-- החיפוש בכניסה הוא תמיד "הזמנה ממתינה לכתובת הזו". lower() כי אימייל אינו
-- תלוי-רישיות, ומי שהוקלד/ה כ-Tal@ ייכנס/תיכנס כ-tal@.
create index if not exists agency_invitations_pending_contact_idx
  on public.agency_invitations (lower(contact))
  where status = 'pending';

create index if not exists agency_invitations_member_idx
  on public.agency_invitations (member_id);

-- ---------------------------------------------------------------------------
-- 2. בקשות שיוך. סוכן/ת שכבר יש לו/ה כרטיס במשרד אבל החשבון לא מחובר אליו —
--    בדיוק מקרה שגיאת ההקלדה. הזיהוי הוא מספר הרישיון, שממילא שדה חובה
--    בכרטיס, וההחלטה היא של מנהל/ת המשרד. מספר רישיון הוא מידע ציבורי ולכן
--    לבדו אינו מספיק לשיוך — האישור האנושי הוא מה שסוגר את הפרצה.
-- ---------------------------------------------------------------------------
create table if not exists public.agency_member_claims (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.agency_members(id) on delete cascade,
  agency_id      uuid not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  claim_email    text not null,
  claim_name     text,
  license_number text not null,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid
);

-- בקשה פתוחה אחת לכל חשבון. בלי זה, רענון של הטופס מייצר תור בקשות זהות
-- שהמנהל/ת צריך/ה לעבור עליהן אחת אחת.
create unique index if not exists agency_member_claims_one_open_per_user
  on public.agency_member_claims (user_id)
  where status = 'pending';

create index if not exists agency_member_claims_agency_pending_idx
  on public.agency_member_claims (agency_id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. הכרטיסים הממתינים עצמם. השיוך לפי אימייל בכניסה שולף מכאן.
-- ---------------------------------------------------------------------------
create index if not exists agency_members_pending_email_idx
  on public.agency_members (lower(email))
  where user_id is null;

-- ---------------------------------------------------------------------------
-- 4. הרשאות. כתיבה — service role בלבד (אין מדיניות insert/update/delete,
--    ו-service role עוקף RLS ממילא). קריאה — רק למי שזה נוגע לו.
-- ---------------------------------------------------------------------------
alter table public.agency_invitations    enable row level security;
alter table public.agency_member_claims  enable row level security;

drop policy if exists agency_invitations_manager_read on public.agency_invitations;
create policy agency_invitations_manager_read on public.agency_invitations
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.current_member_role()) = 'manager');

drop policy if exists agency_member_claims_manager_read on public.agency_member_claims;
create policy agency_member_claims_manager_read on public.agency_member_claims
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.current_member_role()) = 'manager');

-- הפונה עצמו/ה רואה את הבקשה שלו/ה — זה מה שמאפשר למסך ההמתנה ("הבקשה
-- נשלחה למנהל/ת") לדעת מתי היא אושרה, בלי לחשוף שום דבר על משרד אחר.
drop policy if exists agency_member_claims_self_read on public.agency_member_claims;
create policy agency_member_claims_self_read on public.agency_member_claims
  for select to authenticated
  using (user_id = (select auth.uid()));

comment on table public.agency_invitations is
  'הזמנות של מנהל/ת משרד לסוכן/ת. השורה ב-agency_members נוצרת מיד עם user_id ריק; האסימון כאן הוא מה שמחבר אליה חשבון בכניסה הראשונה.';
comment on table public.agency_member_claims is
  'בקשת סוכן/ת לחבר את החשבון שלו/ה לכרטיס קיים במשרד, לפי מספר רישיון. טעונה אישור מנהל/ת. רשת הביטחון לכתובת אימייל שהוקלדה שגוי.';
