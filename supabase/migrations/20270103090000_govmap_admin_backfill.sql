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
