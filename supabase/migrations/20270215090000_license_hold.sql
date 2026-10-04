-- ============================================================================
-- רישיון תיווך: קודם חשבון, אחר כך אוויר
--
-- עד היום השער של רשם המתווכים עמד **לפני** החשבון: רישיון שלא נמצא חסם את
-- פתיחת המשרד או את החיבור לכרטיס, ולא נוצר כלום. התוצאה בפועל: מי שנחסם/ה
-- ושלח/ה צילום לא היה/ה יכול/ה להיכנס לבדוק מה קורה, וכל ניסיון חוזר התחיל
-- מהתחלה - שוב מספר רישיון, ולפעמים שוב "אני פותח/ת משרד חדש".
--
-- מעכשיו החשבון נפתח תמיד, והשער זז למקום שבו הוא באמת שומר: **מה שמוצג
-- לגולשים**. כל עוד הרישיון לא אושר:
--
--   1. דף הסוכן/ת אינו מוצג - ‏agency_members_public מסנן אותו.
--   2. מודעה אינה עולה לאוויר - טריגר מחזיר `active` ל-`unpublished` ומסמן
--      `license_hold_at`. זה **לא** חוסם את השמירה: הסוכן/ת עובד/ת כרגיל,
--      המודעה פשוט מחכה.
--   3. דף המשרד אינו מוצג - משרד מוצג רק כשיש בו לפחות כרטיס פעיל אחד
--      שהרישיון שלו תקין.
--
-- וכשהרישיון מאושר (רשם המתווכים, תיקון מספר, או ערעור שאושר), טריגר על
-- agency_members מעלה לאוויר את כל המודעות שחיכו. אין צעד ידני.
--
-- "תקין" = יש מספר, והסטטוס אינו not_found / inactive. ‏unverified (לא הצלחנו
-- לשאול את המאגר) נחשב תקין - בדיוק כמו בשער עד היום: אתר ממשלתי שנפל אינו
-- סיבה להוריד מישהו מהאוויר.
--
-- נבדק לפני הכתיבה: אף כרטיס אינו חסום היום, ואף משרד אינו נשאר בלי כרטיס
-- תקין - כלומר המיגרציה אינה מורידה דבר מהאוויר ברגע ההרצה.
--
-- אידמפוטנטית.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודה על הנכס
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists license_hold_at timestamptz;

comment on column public.properties.license_hold_at is
  'המודעה נשמרה כפעילה בזמן שרישיון התיווך של הסוכן/ת עוד לא אושר, ולכן נשארה unpublished. עולה לאוויר אוטומטית ברגע האישור.';

-- ---------------------------------------------------------------------------
-- 2. המודעה מחכה לרישיון
--
-- ‏SECURITY DEFINER כי הטריגר קורא את סטטוס הרישיון של הכרטיס, ושדות
-- ה-license_* אינם עניינו של מי שמבצע/ת את העדכון. השם מתחיל ב-"properties_a"
-- כדי שירוץ ראשון מבין טריגרי ה-BEFORE (הם רצים לפי סדר אלפביתי) - לפני
-- properties_guard_duplicate, שאין טעם שיבדוק מודעה שלא עולה.
-- ---------------------------------------------------------------------------
create or replace function public.properties_license_hold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'active'
     and new.agent_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and exists (
       select 1 from public.agency_members m
        where m.id = new.agent_id
          and (m.license_number is null
               or coalesce(m.license_status, '') in ('not_found', 'inactive'))
     ) then
    new.status := 'unpublished';
    new.license_hold_at := coalesce(new.license_hold_at, now());
  elsif tg_op = 'UPDATE'
        and old.license_hold_at is not null
        and new.status is distinct from 'unpublished' then
    -- המודעה עברה למצב אחר (נמכרה, אורכבה, או עלתה אחרי האישור) - היא כבר
    -- לא מחכה, ואסור שתעלה מעצמה מאוחר יותר.
    new.license_hold_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.properties_license_hold() from public, anon, authenticated;

drop trigger if exists properties_a_license_hold on public.properties;
create trigger properties_a_license_hold
  before insert or update of status on public.properties
  for each row execute function public.properties_license_hold();

-- ---------------------------------------------------------------------------
-- 3. האישור מעלה את מה שחיכה
--
-- נכס אחד שנופל (למשל על כלל הכפילות) אינו מפיל את האחרים ואינו מפיל את
-- עדכון הרישיון: הוא נשאר unpublished בלי סימון, והסוכן/ת יראה/תראה את הסיבה
-- כשינסה/תנסה לפרסם אותו בעצמו/ה.
-- ---------------------------------------------------------------------------
create or replace function public.agency_members_release_license_hold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  if new.license_number is null
     or coalesce(new.license_status, '') in ('not_found', 'inactive') then
    return null;
  end if;

  for r in
    select id from public.properties
     where agent_id = new.id and license_hold_at is not null and status = 'unpublished'
  loop
    begin
      update public.properties set status = 'active', license_hold_at = null where id = r.id;
    exception when others then
      update public.properties set license_hold_at = null where id = r.id;
      raise warning 'license hold release skipped property %: %', r.id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.agency_members_release_license_hold() from public, anon, authenticated;

drop trigger if exists agency_members_release_license_hold on public.agency_members;
create trigger agency_members_release_license_hold
  after update of license_status, license_number on public.agency_members
  for each row
  when (new.license_status is distinct from old.license_status
        or new.license_number is distinct from old.license_number)
  execute function public.agency_members_release_license_hold();

-- ---------------------------------------------------------------------------
-- 4. דף הסוכן/ת - אותה הגדרה, ועוד תנאי ב-WHERE
--
-- העמודות זהות לגמרי ובאותו סדר, ולכן create or replace עובר.
-- ---------------------------------------------------------------------------
create or replace view public.agency_members_public as
 select id,
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
    ((ethics_code_accepted_at is not null) and (ethics_badge_revoked_at is null)) as has_ethics_badge,
    years_experience,
    specialties,
    credentials,
    service_area,
    photo_position,
    gallery,
    page_bg
   from public.agency_members
  where active = true
    and license_number is not null
    and coalesce(license_status, '') not in ('not_found', 'inactive');

-- ---------------------------------------------------------------------------
-- 5. דף המשרד
--
-- הפונקציה נקראת מתוך מדיניות RLS שחלה גם על גולשים אנונימיים, ולכן היא
-- פתוחה ל-anon. היא מחזירה true/false בלבד ואינה חושפת דבר מהכרטיסים.
-- ---------------------------------------------------------------------------
create or replace function public.agency_is_live(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.agency_members m
     where m.agency_id = p_agency
       and m.active
       and m.license_number is not null
       and coalesce(m.license_status, '') not in ('not_found', 'inactive')
  );
$$;

revoke all on function public.agency_is_live(uuid) from public, anon, authenticated;
grant execute on function public.agency_is_live(uuid) to anon, authenticated, service_role;

-- המשרד של עצמי ומנהל/ת הפלטפורמה רואים תמיד - אחרת מנהל/ת שממתין/ה
-- לאישור לא היה/הייתה רואה את המשרד שלו/ה ב-CRM.
drop policy if exists "public read agencies" on public.agencies;
create policy "public read agencies" on public.agencies
  for select
  using (
    public.agency_is_live(id)
    or id = public.current_agency_id()
    or public.current_is_platform_admin()
  );
