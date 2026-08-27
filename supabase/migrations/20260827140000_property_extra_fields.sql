-- ============================================================================
-- שדות נכס חסרים — השלמה מול טבלת השדות של מערכות הנכסים המקובלות בשוק
--
-- מה נוסף כאן:
--   1. מספר מודעה קצר וקריא (listing_number) — עד היום היה רק UUID.
--   2. שדות תיאור/שיווק: תיאור שיווקי, טקסט פוסט, תמונה שיווקית.
--   3. שדות נכס: איזור מכירה, מספר קומות, מ״ר גינה, פירוט ריהוט, תוקף מודעה.
--   4. סוכן שני (שם + טלפון) — נכס בשיתוף שני סוכנים.
--   5. מחיר למ״ר — עמודה מחושבת, לא נשמרת ידנית.
--   6. פרטי הבעלים — בטבלה נפרדת (property_owners), כי properties נקראת
--      על ידי anon (‏policy "read active or own or agency properties"), ושם
--      וטלפון של בעל/ת הנכס אסור שייחשפו לגולשים או למשרדים מתחרים.
--   7. ‏updated_at על properties באמת מתעדכן — עד היום היה טריגר רק ל-sold,
--      ולכן "עדכון אחרון" הראה את מועד היצירה.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. ‏updated_at גנרי (לא היה בפרויקט — rss_set_updated_at שייכת למנוע ה-RSS)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from anon, authenticated;

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1. מספר מודעה
--
-- מתחיל מ-1000 כדי שהמספר ייראה כמו מספר מודעה ולא כמו מונה שורות. ה-default
-- הוא volatile ולכן ההוספה מריצה rewrite ומחלקת מספר ייחודי גם לנכסים קיימים.
-- ---------------------------------------------------------------------------
create sequence if not exists public.properties_listing_number_seq as bigint start with 1000;

alter table public.properties
  add column if not exists listing_number bigint not null
    default nextval('public.properties_listing_number_seq');

alter sequence public.properties_listing_number_seq
  owned by public.properties.listing_number;

create unique index if not exists properties_listing_number_key
  on public.properties (listing_number);

-- ---------------------------------------------------------------------------
-- 2. שדות נכס ושיווק
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists sales_area           text,
  add column if not exists total_floors         smallint,
  add column if not exists garden_sqm           numeric,
  add column if not exists furniture_details    text,
  add column if not exists listing_expires_at   date,
  add column if not exists agent2_name          text,
  add column if not exists agent2_phone         text,
  add column if not exists marketing_image      text,
  add column if not exists marketing_description text,
  add column if not exists post_text            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_total_floors_check') then
    alter table public.properties
      add constraint properties_total_floors_check
      check (total_floors is null or (total_floors > 0 and total_floors <= 200));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_garden_sqm_check') then
    alter table public.properties
      add constraint properties_garden_sqm_check
      check (garden_sqm is null or garden_sqm >= 0);
  end if;
end $$;

comment on column public.properties.listing_number is
  'מספר מודעה קצר לתצוגה ולתקשורת מול לקוחות. נוצר אוטומטית, לא נערך בטופס.';
comment on column public.properties.sales_area is
  'איזור מכירה — חלוקה פנימית של המשרד (צפון העיר, מרכז וכו׳), חופשי.';
comment on column public.properties.marketing_image is
  'תמונה שיווקית מעוצבת (עם לוגו/טקסט) — נפרדת מגלריית התמונות של הנכס.';
comment on column public.properties.marketing_description is
  'נוסח שיווקי ארוך לשימוש בפרסום. ‏description הוא תיאור המודעה עצמה.';
comment on column public.properties.post_text is
  'טקסט מוכן להעתקה לפוסט ברשתות/וואטסאפ.';
comment on column public.properties.listing_expires_at is
  'תוקף המודעה — היום האחרון שבו היא רלוונטית (למשל תום הבלעדיות).';

-- ---------------------------------------------------------------------------
-- 3. מחיר למ״ר — נגזר, לא מוזן
--
-- מחושב מול size_sqm (שטח הנכס) ולא מול built_size_sqm, כי זה השדה שבו
-- הטופס והייבוא משתמשים כשטח הראשי.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists price_per_sqm numeric
    generated always as (
      case when size_sqm is not null and size_sqm > 0
           then round(price / size_sqm)
           else null end
    ) stored;

comment on column public.properties.price_per_sqm is
  'מחיר למ״ר — עמודה מחושבת (price / size_sqm), מתעדכנת לבד.';

-- ---------------------------------------------------------------------------
-- 4. פרטי בעל/ת הנכס — טבלה נפרדת
--
-- ‏properties גלויה ל-anon לכל נכס פעיל, ולכן שם וטלפון של המוכר/ת לא יכולים
-- לשבת שם. כאן יש RLS שמצמצמת את הגישה לסוכן/ת שהנכס שלו/ה ולמנהל/ת המשרד,
-- ול-anon אין הרשאה בכלל.
-- ---------------------------------------------------------------------------
create table if not exists public.property_owners (
  property_id uuid primary key references public.properties(id) on delete cascade,
  owner_name  text,
  owner_phone text,
  owner_email text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.property_owners is
  'פרטי בעל/ת הנכס — מידע פנימי של המשרד. לא נחשף באתר ולא למשרדים אחרים.';

drop trigger if exists property_owners_set_updated_at on public.property_owners;
create trigger property_owners_set_updated_at
  before update on public.property_owners
  for each row execute function public.set_updated_at();

alter table public.property_owners enable row level security;

revoke all on public.property_owners from anon;
grant select, insert, update, delete on public.property_owners to authenticated;

drop policy if exists "listing agent manages property owner" on public.property_owners;
create policy "listing agent manages property owner"
  on public.property_owners for all
  using (exists (
    select 1 from public.properties p
    where p.id = public.property_owners.property_id
      and (p.agent_id = public.current_agent_id()
        or (p.agency_id = public.current_agency_id()
            and public.current_member_role() = 'manager'))))
  with check (exists (
    select 1 from public.properties p
    where p.id = public.property_owners.property_id
      and (p.agent_id = public.current_agent_id()
        or (p.agency_id = public.current_agency_id()
            and public.current_member_role() = 'manager'))));
