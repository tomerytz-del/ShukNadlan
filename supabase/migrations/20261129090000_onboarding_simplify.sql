-- ============================================================================
-- פישוט הקליטה — מה שהמסד צריך לתת כדי שהטופס יתקצר
--
-- שלושה שינויים, ושלושתם נובעים מאותה החלטה אחת: **מי שמקליד/ה פרט אישי
-- צריך/ה להיות הבעלים שלו.**
--
--   1. ‏agency_members.license_number הופך לאופציונלי. עד היום מנהל/ת המשרד
--      הקליד/ה את מספר רישיון התיווך של הסוכן/ת — מספר של מישהו אחר, שנבדק
--      מול רשם המתווכים *לפני* שההזמנה בכלל נשלחה. ספרה שגויה שם חסמה את
--      ההזמנה, והערעור (שדורש צילום תעודה) נפתח בידי מי שהתעודה אינה בידיו.
--      עכשיו הכרטיס נולד בלי מספר, והסוכן/ת ממלא/ת אותו במסך הפתיחה של
--      עצמו/ה. **השער החוקי לא זז**: ‏join-agency אינו מקשר חשבון לכרטיס עד
--      שהמספר נמסר ונבדק (ראו `docs/broker-registry.md`).
--
--   2. שתי עמודות ל-`agency_invitations` — ההזמנה יוצאת מעכשיו גם בוואטסאפ,
--      ושליחה שלא נרשמת היא שליחה שאיש אינו יודע שנכשלה.
--
--   3. ‏`agent_billing_profiles` — פרטי החשבונית, פעם אחת. עד היום כל טעינת
--      ארנק ביקשה מחדש שם, טלפון, שם עסק ו-ח.פ, והמספרים האלה הוקלדו שוב
--      בכל רכישה. ‏ח.פ שגוי בהקלדה חוזרת הוא חשבונית שצריך לבטל ולהפיק מחדש.
--
-- אידמפוטנטית במלואה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מספר הרישיון — אופציונלי בכרטיס שטרם חובר
--
-- ה-CHECK הישן (`length(btrim(license_number)) > 0`) נשאר במלוא תוקפו על כל
-- ערך שאינו NULL: מחרוזת ריקה או רווחים עדיין נדחים. מה שמשתנה הוא ש-NULL
-- מותר, וזו ההבחנה כולה — **"עוד לא נמסר" אינו "נמסר ריק"**. בלי ההבחנה הזו
-- הכרטיס היה נושא `''`, ו-licenseGate לא היה יכול להבדיל בינו לבין כרטיס
-- שנבדק ונמצא.
-- ---------------------------------------------------------------------------
alter table public.agency_members
  alter column license_number drop not null;

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.agency_members'::regclass
                and conname  = 'license_number_not_blank') then
    alter table public.agency_members drop constraint license_number_not_blank;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agency_members'::regclass
                    and conname  = 'license_number_not_blank') then
    alter table public.agency_members
      add constraint license_number_not_blank
      check (license_number is null or length(btrim(license_number)) > 0);
  end if;
end $$;

comment on column public.agency_members.license_number is
  'מספר רישיון התיווך. NULL בכרטיס שנוצר בהזמנה וטרם חובר לחשבון — הסוכן/ת מוסר/ת אותו בכניסה הראשונה, ושם הוא נבדק מול רשם המתווכים.';

-- ‏אינדקס חלקי על הכרטיסים שממתינים למספר. הוא קטן (רק הזמנות פתוחות),
-- והוא מה שמאפשר להנהלה ולמנהל/ת המשרד לראות במבט אחד מי עוד לא נכנס/ה.
create index if not exists agency_members_awaiting_license_idx
  on public.agency_members (agency_id, created_at)
  where license_number is null and user_id is null;

-- ---------------------------------------------------------------------------
-- 2. ההזמנה בוואטסאפ — רישום נפרד מזה של המייל
--
-- שני ערוצים, שני רישומים. הזמנה שיצאה במייל ונכשלה בוואטסאפ אינה "נשלחה"
-- ואינה "נכשלה" — היא חצי, ובלי שתי העמודות האלה הממשק היה צריך לנחש איזה
-- חצי. ‏`wa_error` נשמר כטקסט ולא כדגל: השגיאה של Meta (תבנית שאינה מאושרת,
-- מספר שאינו בוואטסאפ, חריגה מקצב) היא מה שאומר מה לעשות הלאה.
-- ---------------------------------------------------------------------------
alter table public.agency_invitations
  add column if not exists wa_sent_at timestamptz,
  add column if not exists wa_error   text;

comment on column public.agency_invitations.wa_sent_at is
  'מתי ההזמנה יצאה בוואטסאפ. NULL = לא יצאה — ראו wa_error.';
comment on column public.agency_invitations.wa_error is
  'שגיאת השליחה בוואטסאפ כלשונה מ-Meta. לתחקור; הקישור מוצג למנהל/ת בכל מקרה.';

-- ---------------------------------------------------------------------------
-- 3. פרטי החשבונית — נשמרים פעם אחת
--
-- **למה טבלה נפרדת ולא עמודות על `agency_members`:** מדיניות ה-SELECT שם
-- פותחת את השורה גם למנהל/ת המשרד (`current_member_role() = 'manager'`).
-- זה נכון לשם, לטלפון ולמסלול — וזה לא נכון ל-ח.פ של העסק הפרטי של
-- הסוכן/ת. ‏RLS הוא ברמת השורה ולא ברמת העמודה, ולכן ההפרדה היחידה
-- שאפשרית היא טבלה משלה.
--
-- **הכתיבה היא service role בלבד.** אין כאן מדיניות insert/update/delete
-- בכוונה: את הפרטים כותבת `wallet-topup` מתוך אותה בקשה ששלחה אותם לספק
-- הסליקה — כלומר נשמר בדיוק מה שהודפס על החשבונית, ולא מה שהוקלד בטופס
-- אחר. שתי דרכי כתיבה היו יכולות להיפרד, וחשבונית שנושאת שם אחד בזמן
-- שהפרופיל נושא אחר היא בדיוק הבלבול שהמנגנון הזה נועד למנוע.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_billing_profiles (
  agent_id    uuid primary key references public.agency_members(id) on delete cascade,
  client_name text not null,
  business    text,
  tax_id      text,
  phone       text,
  country     text,
  updated_at  timestamptz not null default now()
);

comment on table public.agent_billing_profiles is
  'פרטי הלקוח/ה לחשבונית, כפי שנשלחו לספק הסליקה ברכישה האחרונה. נשמרים כדי שלא יוקלדו שוב.';
comment on column public.agent_billing_profiles.business is
  'שם העסק. כשהוא מלא הוא שם הלקוח/ה על החשבונית, וה-ח.פ הוא שלו.';
comment on column public.agent_billing_profiles.tax_id is
  'ח.פ / ע.מ, ספרות בלבד. בלעדיו המסמך אינו חשבונית לעסק.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agent_billing_profiles'::regclass
                    and conname  = 'agent_billing_tax_id_digits') then
    alter table public.agent_billing_profiles
      add constraint agent_billing_tax_id_digits
      check (tax_id is null or tax_id ~ '^[0-9]{8,9}$');
  end if;
end $$;

alter table public.agent_billing_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public'
                    and tablename  = 'agent_billing_profiles'
                    and policyname = 'agent read own billing profile') then
    create policy "agent read own billing profile"
      on public.agent_billing_profiles for select
      using (agent_id = public.current_agent_id());
  end if;
end $$;

-- ‏revoke לפני grant, ולא רק אחריו: ‏Supabase מעניקה כברירת מחדל הרשאות מלאות
-- על טבלה חדשה ב-public לשני התפקידים. בלי השורה הראשונה, "אין מדיניות
-- כתיבה" היה נשען על RLS בלבד — נכון, אבל שכבה אחת פחות ממה שמגיע ל-ח.פ.
-- ‏anon אינו מקבל דבר: לגולש/ת אנונימי/ת אין מה לחפש בפרטי חשבונית.
revoke all on public.agent_billing_profiles from anon, authenticated;
grant select on public.agent_billing_profiles to authenticated;
