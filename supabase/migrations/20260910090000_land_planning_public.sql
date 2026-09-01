-- ============================================================================
-- מידע תכנוני לנכסי קרקע — מה שמחליף את ההדמיות במגרשים
--
-- למה: מגרש הוא שטח ריק. הדמיית AI עליו אינה "עריכה שמרנית של תמונה קיימת"
-- אלא ציור של מבנה שלא תוכנן ולא אושר — כלומר הבטחה חזותית לזכויות בנייה
-- שאיש לא התחייב אליהן. במקום זה דף הנכס מציג לקרקע את מה שקונה קרקע באמת
-- שואל: מה מותר לבנות כאן.
--
-- מה נוסף כאן:
--   1. שדות תכנון שהסוכן/ת מזין/ה ידנית על properties (אחוזי בנייה, יח״ד,
--      קומות, ייעוד, הערות). אלה השדות שאין להם מקור אוטומטי.
--   2. ‏property_planning_info — הטבלה שאליה crm.html כותב את תוצאת
--      ‏afula-planning-lookup. היא כבר קיימת בפרודקשן אך מעולם לא נכנסה לריפו,
--      ולכן היא נוצרת כאן ‎if not exists‎ כדי שהריפו יעמוד בפני עצמו.
--   3. ‏property_planning_public — ‏RPC ציבורי *מצונזר*: מחזיר ייעוד, זכויות
--      ומספרי תוכניות, ולעולם לא גוש, חלקה, שטח חלקה, קואורדינטות או גאומטריה.
--      הצנזור יושב בפונקציה ולא בצד הלקוח, כדי שלא תהיה דרך לבקש את השדות
--      החסויים גם מי שיודע/ת לפתוח קונסולה.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. שדות התכנון של הסוכן/ת
--
-- אחוזי בנייה בישראל עוברים 100% בקלות (400% באזור עירוני הוא שגרה), ולכן
-- התקרה היא 1000 ולא 100.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists land_zoning              text,
  add column if not exists land_building_rights_pct numeric,
  add column if not exists land_max_units           smallint,
  add column if not exists land_max_floors          smallint,
  add column if not exists land_planning_notes      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_land_building_rights_check') then
    alter table public.properties
      add constraint properties_land_building_rights_check
      check (land_building_rights_pct is null
             or (land_building_rights_pct >= 0 and land_building_rights_pct <= 1000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_land_max_units_check') then
    alter table public.properties
      add constraint properties_land_max_units_check
      check (land_max_units is null or (land_max_units >= 0 and land_max_units <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_land_max_floors_check') then
    alter table public.properties
      add constraint properties_land_max_floors_check
      check (land_max_floors is null or (land_max_floors >= 0 and land_max_floors <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'properties_land_planning_notes_check') then
    alter table public.properties
      add constraint properties_land_planning_notes_check
      check (land_planning_notes is null or length(land_planning_notes) <= 400);
  end if;
end $$;

comment on column public.properties.land_zoning is
  'ייעוד הקרקע כפי שהסוכן/ת מצהיר/ה עליו (מגורים א׳, מסחרי, תעשייה). גובר על הייעוד מה-GIS.';
comment on column public.properties.land_building_rights_pct is
  'אחוזי בנייה מותרים. עד 1000 — אחוזי בנייה עירוניים עוברים 100% כדבר שבשגרה.';
comment on column public.properties.land_max_units is
  'מספר יחידות הדיור שמותר לבנות על המגרש, אם ידוע.';
comment on column public.properties.land_max_floors is
  'מספר הקומות המותר על המגרש, אם ידוע.';
comment on column public.properties.land_planning_notes is
  'הערה תכנונית קצרה לתצוגה בדף הנכס (״מאושר לדו-משפחתי, טאבו״). ללא גוש/חלקה.';

-- ---------------------------------------------------------------------------
-- 2. ‏property_planning_info — התוצאה של afula-planning-lookup
--
-- הטבלה כבר קיימת בפרודקשן (נוצרה ידנית לפני שה-workflow של המיגרציות היה
-- קיים). ‏if not exists הופך את הריפו לעצמאי בלי לגעת במה שכבר עומד.
--
-- ‏anon לא נוגע בטבלה הזו בשום מצב: היא מחזיקה גוש, חלקה, קואורדינטות
-- וגאומטריית חלקה. מה שהאתר הפומבי מציג עובר דרך ה-RPC המצונזר שבסעיף 3.
-- ---------------------------------------------------------------------------
create table if not exists public.property_planning_info (
  property_id          uuid primary key references public.properties(id) on delete cascade,
  gush                 text,
  helka                text,
  parcel_area_sqm      numeric,
  parcel_status        text,
  land_use_designation text,
  applicable_plans     jsonb,
  geometry_wgs84       jsonb,
  lat                  numeric,
  lng                  numeric,
  looked_up_at         timestamptz
);

comment on table public.property_planning_info is
  'מידע תכנוני גולמי מה-GIS העירוני (גוש/חלקה/ייעוד/תוכניות). פנימי — לא נחשף לגולשים.';

alter table public.property_planning_info enable row level security;

revoke all on public.property_planning_info from anon;
grant select, insert, update, delete on public.property_planning_info to authenticated;

drop policy if exists "agent full access own property planning info" on public.property_planning_info;
create policy "agent full access own property planning info"
  on public.property_planning_info for all
  using (exists (
    select 1 from public.properties p
    where p.id = property_planning_info.property_id
      and p.agent_id = public.current_agent_id()));

drop policy if exists "manager read agency property planning info" on public.property_planning_info;
create policy "manager read agency property planning info"
  on public.property_planning_info for select
  using (exists (
    select 1 from public.properties p
    where p.id = property_planning_info.property_id
      and p.agency_id = public.current_agency_id()
      and public.current_member_role() = 'manager'));

-- ---------------------------------------------------------------------------
-- 3. ה-RPC הציבורי — מצונזר במקור
--
-- מה שיוצא: ייעוד, זכויות בנייה, יח״ד, קומות, הערה, סטטוס רישום החלקה
-- ומספרי התוכניות החלות (מספר, תיאור ושנה בלבד).
--
-- מה שלא יוצא, גם לא בטעות: ‏gush, ‏helka, ‏lat, ‏lng, ‏geometry_wgs84
-- ו-‏parcel_area_sqm. שלושת האחרונים הם מפתח הצטרפות ישיר ל-GIS הפומבי —
-- מי שמחזיק/ה אותם מגיע/ה לחלקה המדויקת גם בלי הכתובת, וזה בדיוק מה
-- שהסקציה הזו אמורה לא לעשות. ‏area_sqm של כל תוכנית מושמט מאותה סיבה.
--
-- ‏security definer כי anon לא קורא/ת את הטבלה עצמה, ו-stable כי אין כתיבה.
-- ---------------------------------------------------------------------------
create or replace function public.property_planning_public(p_property_id uuid)
returns table (
  land_zoning         text,
  building_rights_pct numeric,
  max_units           smallint,
  max_floors          smallint,
  planning_notes      text,
  parcel_status       text,
  plans               jsonb,
  updated_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(btrim(p.land_zoning), ''), nullif(btrim(i.land_use_designation), '')),
    p.land_building_rights_pct,
    p.land_max_units,
    p.land_max_floors,
    nullif(btrim(p.land_planning_notes), ''),
    nullif(btrim(i.parcel_status), ''),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'number',      pl->>'number',
               'description', nullif(btrim(coalesce(pl->>'description', '')), ''),
               -- שנה בלבד: תאריך מלא הוא עוד שדה להצליב מולו, והתצוגה
               -- ממילא מראה רק שנה
               'year',        nullif(left(coalesce(pl->>'date', ''), 4), '')))
      from jsonb_array_elements(i.applicable_plans) pl
      where nullif(btrim(coalesce(pl->>'number', '')), '') is not null
    ), '[]'::jsonb),
    i.looked_up_at
  from public.properties p
  left join public.property_planning_info i on i.property_id = p.id
  where p.id = p_property_id
    and p.status = 'active';
$$;

comment on function public.property_planning_public(uuid) is
  'מידע תכנוני כללי לדף הנכס הפומבי. ללא גוש, חלקה, שטח חלקה, קואורדינטות וגאומטריה.';

grant execute on function public.property_planning_public(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. הטריגר של סט ההדמיות לא ירוץ על קרקע
--
-- ‏"מגרש" יושב ברשימת סוגי הנכס של המגורים, ולכן תנאי ה-category בטריגר
-- מ-20260827190000 לא עוצר אותו: נכס קרקע של סוכן/ת Premium היה שולח בקשת
-- הדמיה ומקבל דחייה מהפונקציה. הבדיקה מוקדמת לכאן כדי לחסוך את הקריאה.
--
-- הגוף זהה למקור פרט לתנאי הקרקע. הביטוי הוא אותו ביטוי שב-property.html,
-- ב-crm.html וב-supabase/functions/_shared/visualization.ts.
-- ---------------------------------------------------------------------------
create or replace function public.is_land_property_type(p_property_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_property_type, '') ~ 'מגרש|קרקע|נחל|משק|חקלא';
$$;

comment on function public.is_land_property_type(text) is
  'האם סוג הנכס הוא קרקע (מגרש, נחלה, משק, שטח חקלאי). סוג הנכס גובר על ה-category.';

create or replace function public.enqueue_base_visualization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_url text;
begin
  -- נכס לא מפורסם או בלי תמונות — אין ממה לייצר
  if new.status is distinct from 'active' then
    return null;
  end if;
  if coalesce(array_length(new.images, 1), 0) = 0 then
    return null;
  end if;

  -- "אירוע פרסום" הוא אחד משניים: הנכס נעשה active, או שנכס פעיל קיבל
  -- תמונות בפעם הראשונה. עדכון מחיר או תיאור בנכס פעיל עם תמונות לא מפעיל כלום.
  if tg_op = 'UPDATE'
     and old.status is not distinct from 'active'
     and coalesce(array_length(old.images, 1), 0) > 0 then
    return null;
  end if;

  -- קרקע אינה ניתנת להדמיה: אין "מצב קיים" לערוך, ומבנה שהמודל היה מצייר
  -- על מגרש ריק הוא הבטחה לזכויות בנייה שאיש לא התחייב אליהן. דף הנכס מציג
  -- לקרקע מידע תכנוני במקום.
  if public.is_land_property_type(new.property_type) then
    return null;
  end if;

  -- נכס פרטי בלבד. במסחרי ההדמיה תלויה בסוג העסק שהגולש/ת בוחר/ת, ולכן
  -- אין לה סט בסיס — התיעוד המלא ב-docs/property-visualizations.md
  if new.category is distinct from 'residential' then
    return null;
  end if;
  if not public.property_visualizations_enabled(new.id) then
    return null;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'visualization_service_key' limit 1;
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'edge_functions_base_url' limit 1;

  if v_key is null or v_url is null then
    return null;   -- המנגנון עוד לא הופעל
  end if;

  perform net.http_post(
    url     := v_url || '/property-visualize-base',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('property_id', new.id),
    timeout_milliseconds := 5000
  );

  return null;
exception when others then
  -- הדמיות הן פיצ'ר שיווקי. כישלון כאן לא ימנע מסוכן/ת לפרסם נכס.
  raise warning 'enqueue_base_visualization נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke execute on function public.enqueue_base_visualization() from anon, authenticated;
