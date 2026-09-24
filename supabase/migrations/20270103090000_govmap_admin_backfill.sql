-- ============================================================================
-- השלמת נתוני GovMap לנכסים קיימים - כפתור אצל מנהל/ת הפלטפורמה
--
-- ## למה כפתור ולא סורק
--
-- ‏geocode-backfill ו-planning-backfill רצים מ-cron בשרת. הטוקן של GovMap
-- נעול לדומיין ועונה לדפדפן בלבד (עד תשובת מפ"י על קריאות שרת), ולכן
-- ההשלמה לנכסים שכבר במערכת רצה בדפדפן של מנהל/ת הפלטפורמה, בלחיצה.
-- כשתהיה גישת שרת - אותה לוגיקה עוברת לסורק, והכפתור יורד. docs/govmap.md.
--
-- ## התור
--
-- ‏`govmap_backfill_candidates` - נכס פעיל, מחוץ לעפולה (שנשארת על שכבת
-- העירייה), עם רחוב ומספר, שחסר לו פין **או** מידע תכנוני. "חסר מידע
-- תכנוני" נספר רק כשלבעלי/ות הנכס מסלול mid/premium פעיל: ההשלמה אינה דרך
-- עקיפה לתת את היכולת בחינם.
--
-- ## למה טבלת ניסיונות נפרדת ולא עמודה על properties
--
-- על properties יושבים 21 טריגרים, ו-11 מהם יורים על **כל** עדכון
-- (docs/cities-and-regions.md) - כולל התראות חיפוש שמור והתאמת לקוחות.
-- עמודת "ניסיתי" הייתה מדליקה את כולם על כל נכס שלא נמצא, בכל לחיצה.
-- טבלה קטנה משלה אינה נוגעת בהם.
--
-- נכס שנוסה ולא נמצא אינו חוזר לתור 7 ימים. כתובת שאינה בשכבה לא תופיע
-- בה מחר, ובלי זה כל לחיצה הייתה מבזבזת את המכסה על אותם נכסים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- פיצול govmap_save_planning: האימות והכתיבה לפונקציה פנימית אחת
--
-- ‏20270101090000 כבר רצה בפרודקשן עם האימות בתוך govmap_save_planning.
-- ‏govmap_admin_save למטה צריכה בדיוק אותו אימות, ושני עותקים שלו היו
-- נפרדים ביום הראשון שמישהו מתקן אחד מהם. לכן כאן - ולא בעריכת 20270101,
-- שכבר הוחלה ועריכה שלה לא הייתה רצה שוב - האימות עובר ל-
-- govmap_planning_write, ו-govmap_save_planning נכתבת מחדש מעליה. ההתנהגות
-- שלה לא משתנה. ל-govmap_planning_write **אין הרשאת הרצה לאף תפקיד חיצוני.**
-- ---------------------------------------------------------------------------
create or replace function public.govmap_planning_write(p_property_id uuid, p_record jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_gush     text := nullif(btrim(coalesce(p_record->>'gush', '')), '');
  v_helka    text := nullif(btrim(coalesce(p_record->>'helka', '')), '');
  v_area     numeric;
  v_lat      numeric;
  v_lng      numeric;
  v_plans    jsonb := coalesce(p_record->'applicable_plans', '[]'::jsonb);
  v_geom     jsonb := p_record->'geometry_wgs84';
begin
  -- אימות: הדפדפן אינו מקור אמין. ערך שאינו עובר - נזרק ולא "מתוקן".
  if v_gush is not null and v_gush !~ '^\d{1,7}$' then raise exception 'bad_gush'; end if;
  if v_helka is not null and v_helka !~ '^\d{1,5}$' then raise exception 'bad_helka'; end if;

  if p_record ? 'parcel_area_sqm' and jsonb_typeof(p_record->'parcel_area_sqm') = 'number' then
    v_area := (p_record->>'parcel_area_sqm')::numeric;
    if v_area < 0 or v_area > 100000000 then raise exception 'bad_area'; end if;
  end if;

  if jsonb_typeof(p_record->'lat') = 'number' and jsonb_typeof(p_record->'lng') = 'number' then
    v_lat := (p_record->>'lat')::numeric;
    v_lng := (p_record->>'lng')::numeric;
    -- תיבת ישראל גסה. פין מחוץ לה הוא תרגום שקרס (docs/property-map.md)
    if v_lat not between 29.3 and 33.5 or v_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
  end if;

  if jsonb_typeof(v_plans) <> 'array' or jsonb_array_length(v_plans) > 30 then
    raise exception 'bad_plans';
  end if;

  if v_geom is not null and jsonb_typeof(v_geom) <> 'null' then
    if jsonb_typeof(v_geom) <> 'object'
       or coalesce(v_geom->>'type', '') not in ('Polygon', 'MultiPolygon')
       or length(v_geom::text) > 200000 then
      raise exception 'bad_geometry';
    end if;
  else
    v_geom := null;
  end if;

  insert into public.property_planning_info as t (
    property_id, gush, helka, parcel_area_sqm, parcel_status,
    land_use_designation, applicable_plans, geometry_wgs84, lat, lng,
    looked_up_at, source, neighborhood_name)
  values (
    p_property_id, v_gush, v_helka, v_area,
    left(nullif(btrim(coalesce(p_record->>'parcel_status', '')), ''), 100),
    left(nullif(btrim(coalesce(p_record->>'land_use_designation', '')), ''), 200),
    v_plans, v_geom, v_lat, v_lng,
    now(), 'govmap',
    left(nullif(btrim(coalesce(p_record->>'neighborhood', '')), ''), 200))
  on conflict (property_id) do update set
    gush                 = excluded.gush,
    helka                = excluded.helka,
    parcel_area_sqm      = excluded.parcel_area_sqm,
    parcel_status        = excluded.parcel_status,
    land_use_designation = excluded.land_use_designation,
    applicable_plans     = excluded.applicable_plans,
    geometry_wgs84       = excluded.geometry_wgs84,
    lat                  = excluded.lat,
    lng                  = excluded.lng,
    looked_up_at         = excluded.looked_up_at,
    source               = excluded.source,
    neighborhood_name    = excluded.neighborhood_name;

  return true;
end;
$$;

comment on function public.govmap_planning_write(uuid, jsonb) is
  'פנימית: אימות ו-upsert של שורת תכנון מ-GovMap. בלי בדיקת הרשאה - נקראת רק מ-govmap_save_planning ומ-govmap_admin_save.';

revoke all on function public.govmap_planning_write(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- הדלת של הסוכן/ת: בעלות + מסלול, ואז הכתיבה
-- ---------------------------------------------------------------------------
create or replace function public.govmap_save_planning(p_property_id uuid, p_record jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_agent_id uuid := public.current_agent_id();
begin
  if v_agent_id is null then
    raise exception 'not_authenticated';
  end if;

  -- הנכס של הסוכן/ת, ולא נכס של מישהו אחר במשרד
  if not exists (select 1 from public.properties p
                  where p.id = p_property_id and p.agent_id = v_agent_id) then
    raise exception 'not_your_property';
  end if;

  -- הגייט: אותו מסלול כמו afula-planning-lookup, ומסלול שפג אינו מסלול
  if not exists (select 1 from public.agency_members m
                  where m.id = v_agent_id
                    and m.active = true
                    and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium')) then
    raise exception 'upgrade_required';
  end if;

  return public.govmap_planning_write(p_property_id, p_record);
end;
$$;

comment on function public.govmap_save_planning(uuid, jsonb) is
  'שמירת מידע תכנוני שנשלף מ-GovMap בדפדפן. אוכפת בעלות על הנכס ומסלול mid/premium פעיל, ומאמתת כל שדה. docs/govmap.md.';

revoke all on function public.govmap_save_planning(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_save_planning(uuid, jsonb) to authenticated;

create table if not exists public.govmap_backfill_attempts (
  property_id  uuid primary key references public.properties(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  result       text not null
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.govmap_backfill_attempts'::regclass
                    and conname  = 'govmap_backfill_attempts_result_chk') then
    alter table public.govmap_backfill_attempts
      add constraint govmap_backfill_attempts_result_chk
      check (result in ('saved', 'pin_only', 'not_found', 'error'));
  end if;
end $$;

comment on table public.govmap_backfill_attempts is
  'ניסיון ההשלמה האחרון מ-GovMap לכל נכס. טבלה נפרדת כדי לא להדליק את טריגרי העדכון של properties. מיגרציה 20270103090000.';

alter table public.govmap_backfill_attempts enable row level security;
revoke all on table public.govmap_backfill_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- התור
-- ---------------------------------------------------------------------------
create or replace function public.govmap_backfill_candidates(p_limit integer default 40)
returns table (
  id            uuid,
  city          text,
  street        text,
  house_number  text,
  need_pin      boolean,
  need_planning boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  return query
  with base as (
    select p.id, btrim(p.city) as city, btrim(p.street) as street, btrim(p.house_number) as house_number,
           (p.lat is null or p.lng is null) as need_pin,
           (not exists (select 1 from public.property_planning_info i
                         where i.property_id = p.id and i.gush is not null)
            and exists (select 1 from public.agency_members m
                         where m.id = p.agent_id and m.active = true
                           and m.billing_status = 'active'
                           and m.tier in ('mid', 'premium'))) as need_planning
      from public.properties p
     where p.status = 'active'
       and nullif(btrim(coalesce(p.city, '')), '') is not null
       and btrim(p.city) <> 'עפולה'
       and nullif(btrim(coalesce(p.street, '')), '') is not null
       and nullif(btrim(coalesce(p.house_number, '')), '') is not null
       and not exists (select 1 from public.govmap_backfill_attempts a
                        where a.property_id = p.id
                          and a.attempted_at > now() - interval '7 days')
  )
  select b.id, b.city, b.street, b.house_number, b.need_pin, b.need_planning
    from base b
   where b.need_pin or b.need_planning
   order by b.need_pin desc, b.id
   limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

comment on function public.govmap_backfill_candidates(integer) is
  'נכסים פעילים מחוץ לעפולה שחסר להם פין או מידע תכנוני (האחרון רק למסלול בתשלום פעיל). מנהל/ת פלטפורמה בלבד. docs/govmap.md.';

revoke all on function public.govmap_backfill_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_backfill_candidates(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- השמירה: פין (רק אם חסר) + מידע תכנוני (רק למסלול בתשלום), ורישום הניסיון
-- ---------------------------------------------------------------------------
create or replace function public.govmap_admin_save(p_property_id uuid, p_record jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_lat     numeric;
  v_lng     numeric;
  v_paid    boolean;
  v_result  text;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  if not exists (select 1 from public.properties p where p.id = p_property_id) then
    raise exception 'no_such_property';
  end if;

  -- ‏null או {} = GovMap ענה ואין שם כלום. נרשם, כדי שהנכס לא יחזור מחר.
  if p_record is null or p_record = '{}'::jsonb then
    insert into public.govmap_backfill_attempts (property_id, attempted_at, result)
    values (p_property_id, now(), 'not_found')
    on conflict (property_id) do update set attempted_at = now(), result = 'not_found';
    return 'not_found';
  end if;

  -- הפין: **רק כשחסר.** פין קיים אולי הוזז ידנית, וזו החלטה של הסוכן/ת
  -- (אותו כלל כמו geocode-backfill, docs/geocoding.md).
  if jsonb_typeof(p_record->'pin_lat') = 'number' and jsonb_typeof(p_record->'pin_lng') = 'number' then
    v_lat := (p_record->>'pin_lat')::numeric;
    v_lng := (p_record->>'pin_lng')::numeric;
    if v_lat not between 29.3 and 33.5 or v_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
    update public.properties
       set lat = v_lat, lng = v_lng
     where id = p_property_id and (lat is null or lng is null);
  end if;

  select exists (select 1 from public.properties p
                   join public.agency_members m on m.id = p.agent_id
                  where p.id = p_property_id and m.active = true
                    and m.billing_status = 'active'
                    and m.tier in ('mid', 'premium'))
    into v_paid;

  if v_paid and p_record ? 'planning' and jsonb_typeof(p_record->'planning') = 'object' then
    perform public.govmap_planning_write(p_property_id, p_record->'planning');
    v_result := 'saved';
  else
    v_result := 'pin_only';
  end if;

  insert into public.govmap_backfill_attempts (property_id, attempted_at, result)
  values (p_property_id, now(), v_result)
  on conflict (property_id) do update set attempted_at = now(), result = excluded.result;

  return v_result;
end;
$$;

comment on function public.govmap_admin_save(uuid, jsonb) is
  'השלמת GovMap לנכס קיים: פין רק אם חסר, מידע תכנוני רק למסלול בתשלום פעיל, ורישום הניסיון. מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_admin_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_admin_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- השוואה מול עפולה: קריאה בלבד
--
-- "התנאי לניתוק עפולה" (docs/govmap.md) הוא גוש/חלקה זהים ב-100% ופינים
-- במרחק של עד 15 מ'. זה מה שמחזיר את נקודת ההשוואה: הנכסים הפעילים בעפולה
-- עם פין, והגוש/חלקה שהשכבה העירונית נתנה להם. ההשוואה עצמה רצה בדפדפן
-- ואינה כותבת דבר - שום שורה אינה משתנה עד שמחליטים להעביר את עפולה.
-- ---------------------------------------------------------------------------
create or replace function public.govmap_parity_candidates(p_limit integer default 100)
returns table (
  id           uuid,
  street       text,
  house_number text,
  lat          double precision,
  lng          double precision,
  gush         text,
  helka        text
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  return query
  select p.id, btrim(p.street), btrim(p.house_number), p.lat, p.lng, i.gush, i.helka
    from public.properties p
    left join public.property_planning_info i on i.property_id = p.id
   where p.status = 'active'
     and btrim(p.city) = 'עפולה'
     and p.lat is not null and p.lng is not null
     and nullif(btrim(coalesce(p.street, '')), '') is not null
     and nullif(btrim(coalesce(p.house_number, '')), '') is not null
   order by p.id
   limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$$;

comment on function public.govmap_parity_candidates(integer) is
  'נכסי עפולה עם פין וגוש/חלקה מהשכבה העירונית, להשוואה מול GovMap בדפדפן. קריאה בלבד, מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_parity_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_parity_candidates(integer) to authenticated;
