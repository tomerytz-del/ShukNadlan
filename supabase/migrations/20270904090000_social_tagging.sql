-- ============================================================================
-- תיוג סוכנים ומשרדים בפרסומי הנכסים ברשתות
-- ============================================================================
--
-- מערכת הפרסום מעלה רילס, סטוריז ופוסטים לנכסים, ורוצה לתייג בתגובה את
-- הסוכן/ת ואת המשרד: באינסטגרם ב-@שם_משתמש, ובפייסבוק את הדף העסקי של
-- המשרד (דף אינו יכול לתייג פרופיל אישי, ולכן לסוכן/ת - שם וקישור לדף שלו/ה
-- באתר). עד עכשיו לא היה במערכת שום שדה כזה.
--
-- מה נכנס:
--
-- 1. ‏agency_members - ‏instagram_handle, ‏facebook_url, ‏social_tag_consent
--    ו-social_tag_consent_at. הטבלה הזו כבר פרטית (‏select לשורה עצמה ולמנהל/ת
--    המשרד בלבד), ודפי הסוכנים קוראים מ-views עם רשימת עמודות סגורה - ולכן
--    העמודות לא נחשפות באתר.
--
-- 2. ‏agency_social - טבלה נפרדת למשרד, ולא עמודות ב-agencies. ‏agencies
--    **ציבורית** (‏"public read agencies" ו-select לטבלה כולה ל-anon), ועמודה
--    חדשה בה הייתה נקראת מיד בידי כל גולש/ת. ההנחיה הייתה שהשדות לא יוצגו
--    בציבור, וטבלה נפרדת עם RLS למנהל/ת היא הדרך שאינה תלויה בכך שאף אחד
--    לא יבחר אותה ב-select.
--
-- 3. ‏social_tag_targets - view פנימי (‏service_role בלבד) שמערכת הפרסום קוראת:
--    לכל נכס פעיל, הסוכן/ת והמשרד, ושמות המשתמש **רק כשיש אישור**. בלי אישור
--    השדה יוצא null, כדי שהקורא לא יוכל לתייג בטעות. קריאה בלבד.
--
-- ‏הנרמול נעשה במסד ולא רק בדפדפן: ‏"@name", ‏"instagram.com/name/" ו-"name"
-- נשמרים כולם כ-"name", ומה שאינו עובר את התבנית נדחה באילוץ. האישור
-- והחותמת שלו נקבעים בטריגר - הדפדפן אינו כותב תאריך משלו, ומנהל/ת המשרד,
-- שה-policy מתיר לו/ה לעדכן שורות של סוכנים, אינו/ה יכול/ה לאשר תיוג בשם
-- סוכן/ת אחר/ת או לשנות את הפרופילים שלו/ה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- נרמול משותף
-- ---------------------------------------------------------------------------
create or replace function public.social_instagram_norm(v text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(v, ''))),
          '^(https?://)?(www\.)?(instagram\.com|instagr\.am)/', ''),
        '[/?#].*$', ''),
      '^@+', ''),
    '')
$$;

create or replace function public.social_facebook_norm(v text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(
    regexp_replace(
      regexp_replace(btrim(coalesce(v, '')), '^(https?://)?(www\.|m\.)?facebook\.com/', 'https://www.facebook.com/', 'i'),
      '/+$', ''),
    '')
$$;

comment on function public.social_instagram_norm(text) is
  'שם משתמש באינסטגרם בלי @, בלי קישור ובאותיות קטנות. ריק = null.';
comment on function public.social_facebook_norm(text) is
  'קישור לפייסבוק בצורה אחת (https://www.facebook.com/...). ריק = null.';

-- נקראות מתוך הטריגרים, שרצים בתפקיד של מי שכותב/ת (‏authenticated)
revoke all on function public.social_instagram_norm(text) from public, anon, authenticated;
revoke all on function public.social_facebook_norm(text) from public, anon, authenticated;
grant execute on function public.social_instagram_norm(text) to authenticated, service_role;
grant execute on function public.social_facebook_norm(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. הסוכן/ת
-- ---------------------------------------------------------------------------
alter table public.agency_members add column if not exists instagram_handle text;
alter table public.agency_members add column if not exists facebook_url text;
alter table public.agency_members add column if not exists social_tag_consent boolean not null default false;
alter table public.agency_members add column if not exists social_tag_consent_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_instagram_handle_check') then
    alter table public.agency_members add constraint agency_members_instagram_handle_check
      check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agency_members_facebook_url_check') then
    alter table public.agency_members add constraint agency_members_facebook_url_check
      check (facebook_url is null or (facebook_url ~ '^https://(www\.)?facebook\.com/[^\s]+$' and length(facebook_url) <= 300));
  end if;
end $$;

create or replace function public.agency_members_social_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  is_privileged boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
                           or auth.role() = 'service_role';
  is_self boolean := coalesce(new.user_id is not null and new.user_id = (select auth.uid()), false);
begin
  -- מנהל/ת המשרד רשאי/ת לעדכן את השורה (ה-policy), אבל הפרופילים והאישור
  -- שייכים לסוכן/ת עצמו/ה
  if tg_op = 'UPDATE' and not is_privileged and not is_self then
    new.instagram_handle := old.instagram_handle;
    new.facebook_url := old.facebook_url;
    new.social_tag_consent := old.social_tag_consent;
    new.social_tag_consent_at := old.social_tag_consent_at;
    return new;
  end if;

  new.instagram_handle := public.social_instagram_norm(new.instagram_handle);
  new.facebook_url := public.social_facebook_norm(new.facebook_url);

  -- החותמת נקבעת כאן, לא בדפדפן: נדלקת ברגע האישור ונמחקת בביטול
  if new.social_tag_consent then
    if tg_op = 'INSERT' or not old.social_tag_consent then
      new.social_tag_consent_at := now();
    else
      new.social_tag_consent_at := old.social_tag_consent_at;
    end if;
  else
    new.social_tag_consent_at := null;
  end if;
  return new;
end $$;

revoke all on function public.agency_members_social_fields() from public, anon, authenticated;

drop trigger if exists agency_members_social_fields on public.agency_members;
create trigger agency_members_social_fields
  before insert or update of instagram_handle, facebook_url, social_tag_consent, social_tag_consent_at
  on public.agency_members
  for each row execute function public.agency_members_social_fields();

comment on column public.agency_members.instagram_handle is
  'שם המשתמש באינסטגרם, בלי @. לתיוג בפרסומים, רק כש-social_tag_consent. אינו מוצג באתר.';
comment on column public.agency_members.facebook_url is
  'קישור לפרופיל או לדף בפייסבוק. אינו מוצג באתר.';
comment on column public.agency_members.social_tag_consent is
  'הסוכן/ת אישר/ה לתייג אותו/ה בפרסומי הנכסים שלו/ה. רק הסוכן/ת עצמו/ה משנה.';

-- ---------------------------------------------------------------------------
-- 2. המשרד - טבלה נפרדת, כי agencies ציבורית
-- ---------------------------------------------------------------------------
create table if not exists public.agency_social (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  instagram_handle text,
  facebook_page_url text,
  social_tag_consent boolean not null default false,
  social_tag_consent_at timestamptz,
  social_tag_consent_by uuid references public.agency_members(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agency_social_instagram_handle_check
    check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  constraint agency_social_facebook_page_url_check
    check (facebook_page_url is null or (facebook_page_url ~ '^https://(www\.)?facebook\.com/[^\s]+$' and length(facebook_page_url) <= 300))
);

alter table public.agency_social enable row level security;

grant select, insert, update on table public.agency_social to authenticated;
grant select, insert, update, delete on table public.agency_social to service_role;
revoke all on table public.agency_social from anon;

drop policy if exists "manager reads agency_social" on public.agency_social;
create policy "manager reads agency_social" on public.agency_social
  for select to authenticated
  using ((agency_id = current_agency_id() and current_member_role() = 'manager') or current_is_platform_admin());

drop policy if exists "manager inserts agency_social" on public.agency_social;
create policy "manager inserts agency_social" on public.agency_social
  for insert to authenticated
  with check (agency_id = current_agency_id() and current_member_role() = 'manager');

drop policy if exists "manager updates agency_social" on public.agency_social;
create policy "manager updates agency_social" on public.agency_social
  for update to authenticated
  using (agency_id = current_agency_id() and current_member_role() = 'manager')
  with check (agency_id = current_agency_id() and current_member_role() = 'manager');

create or replace function public.agency_social_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.instagram_handle := public.social_instagram_norm(new.instagram_handle);
  new.facebook_page_url := public.social_facebook_norm(new.facebook_page_url);
  new.updated_at := now();
  if new.social_tag_consent then
    if tg_op = 'INSERT' or not old.social_tag_consent then
      new.social_tag_consent_at := now();
      new.social_tag_consent_by := current_agent_id();
    else
      new.social_tag_consent_at := old.social_tag_consent_at;
      new.social_tag_consent_by := old.social_tag_consent_by;
    end if;
  else
    new.social_tag_consent_at := null;
    new.social_tag_consent_by := null;
  end if;
  return new;
end $$;

revoke all on function public.agency_social_fields() from public, anon, authenticated;

drop trigger if exists agency_social_fields on public.agency_social;
create trigger agency_social_fields
  before insert or update on public.agency_social
  for each row execute function public.agency_social_fields();

comment on table public.agency_social is
  'פרופילי הרשתות של המשרד לתיוג בפרסומים, ואישור המנהל/ת. נפרדת מ-agencies כי זו ציבורית.';

-- ---------------------------------------------------------------------------
-- 3. מה שמערכת הפרסום קוראת
-- ---------------------------------------------------------------------------
create or replace view public.social_tag_targets
  with (security_invoker = true) as
select
  p.id                                   as property_id,
  m.id                                   as agent_id,
  m.display_name                         as agent_name,
  'https://shuknadlan.co.il/agent?slug=' || coalesce(m.slug, m.id::text) as agent_page_url,
  case when m.social_tag_consent then m.instagram_handle end as agent_instagram,
  case when m.social_tag_consent then m.facebook_url end     as agent_facebook_url,
  a.id                                   as agency_id,
  a.name                                 as agency_name,
  'https://shuknadlan.co.il/agency?slug=' || a.slug         as agency_page_url,
  case when s.social_tag_consent then s.instagram_handle end  as agency_instagram,
  case when s.social_tag_consent then s.facebook_page_url end as agency_facebook_page_url
from public.properties p
join public.agency_members m on m.id = p.agent_id
left join public.agencies a on a.id = coalesce(p.agency_id, m.agency_id)
left join public.agency_social s on s.agency_id = a.id
where p.status = 'active';

revoke all on table public.social_tag_targets from anon, authenticated;
grant select on table public.social_tag_targets to service_role;

comment on view public.social_tag_targets is
  'לתיוג בפרסומים: לכל נכס פעיל, הסוכן/ת והמשרד. שמות המשתמש מופיעים רק כשיש אישור (אחרת null). service_role בלבד.';
