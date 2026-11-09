-- ============================================================================
-- שער אימות רישיון: באתר מוצגים רק יועצי נדל״ן שהרישיון שלהם אומת
-- (‏license_status in ('verified','manual')). PR 1010, P1-T3, החלטה ד-1.
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
--
-- היום (28.10, קריאה בלבד): ‏unverified עם מספר רישיון **מוצג** - 3 יועצים, 26 נכסים
-- פעילים. מוצגים 51: ‏verified 45, ‏manual 3, ‏unverified 3. לכן הקובייה בדף הבית
-- אינה כותבת "כל יועצי הנדל״ן מורשים" עד שהשער באוויר.
--
-- לפני ההרצה (כתיבה למסד ומייל - רק תומר):
--   1. בדיקה חד-פעמית לשלושת ה-unverified דרך broker-license-lookup בזמן שה-API עונה.
--      מי שנמצא -> verified. מי שלא -> מייל ערעור **לפני** השער, אחרת 26 נכסים יירדו
--      מהאתר בלי הודעה (הטריגר מוריד ל-unpublished רק במעבר ל-active, אבל ה-view
--      וה-agency_is_live מסתירים מיד).
--   2. לוודא שתזכורות הרישיון (‏20270723090000_license_reminder.sql) נדלקות גם על
--      unverified - הן נשענות על agent_license_ok, שמשתנה כאן.
--
-- אותן עמודות ואותו סדר ב-view (‏create or replace view עובר). אידמפוטנטית.
-- אחרי ההרצה: ‏LICENSE_GATE_LIVE = true ב-assets/home.js (קוביית "רישיון תיווך מאומת").
-- ============================================================================

-- 1) הכלל במקום אחד. הטריגרים (‏agency_members_release_license_hold) והתזכורות כבר קוראים לה
create or replace function public.agent_license_ok(p_license_number text, p_license_status text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_license_number is not null
     and coalesce(p_license_status, '') in ('verified', 'manual');
$function$;

-- 2) משרד חי = יש בו חבר/ה פעיל/ה עם רישיון מאומת
create or replace function public.agency_is_live(p_agency uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.agency_members m
     where m.agency_id = p_agency
       and m.active
       and public.agent_license_ok(m.license_number, m.license_status)
  );
$function$;

-- 3) מודעה עולה לאוויר רק של יועץ/ת עם רישיון מאומת
create or replace function public.properties_license_hold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'active'
     and new.agent_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and exists (
       select 1 from public.agency_members m
        where m.id = new.agent_id
          and not public.agent_license_ok(m.license_number, m.license_status)
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
$function$;

-- 4) ה-view הציבורי: אותו גוף, השער במקום "לא not_found/inactive"
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
    ethics_code_accepted_at is not null and ethics_badge_revoked_at is null as has_ethics_badge,
    years_experience,
    specialties,
    credentials,
    service_area,
    photo_position,
    gallery,
    page_bg,
    service_markets,
    is_active_agent
   from public.agency_members
  where active = true
    and public.agent_license_ok(license_number, license_status);

-- 5) בדיקה חוזרת יומית ל-unverified (מטמון not_found נשאר 30 יום).
--    לא פעיל בהצעה: לאשר את שם הפונקציה, הכותרת המאומתת ושעת הריצה לפני שמסירים את ההערה.
-- select cron.schedule('broker-license-recheck', '17 4 * * *', $$
--   select net.http_post(
--     url := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/broker-license-lookup?task=recheck-unverified',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))
--   );
-- $$);
