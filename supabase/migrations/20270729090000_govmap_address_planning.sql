-- ============================================================================
-- מטמון מידע תכנוני לכתובות בשווקים, כדי שגבריאלה תענה בוואטסאפ בלי קישור
--
-- ## למה
--
-- גבריאלה רצה בשרת, ומפ"י מתירים לשאול את GovMap מצד הלקוח בלבד
-- (12.10.2026, docs/govmap.md). לכן על כתובת מחוץ לעפולה היא שלחה קישור
-- לכלי ב-CRM. כאן התשובה נשמרת **מראש**: מנהל/ת הפלטפורמה ממלא/ת בדפדפן
-- את המטמון לכל כתובת שבה נרשמה עסקה בערי השווקים (‏market_deals_official -
-- כמעט כל בניין מגורים קיים), והבוט קורא ממנו. כתובת שאינה במטמון נשארת עם
-- הקישור.
--
-- ## המפתח
--
-- ‏(city_id, street_key, house_number): ‏city_id_for_name מגשר על "קרית"/"קריית",
-- ‏street_name_key על כתיב הרחוב - אותן שתי פונקציות שכל השאר במסד נשען
-- עליהן, ולכן שאלה של סוכן/ת והכתובת שבעסקה נפגשות גם בכתיב שונה.
--
-- ## "לא נמצא" נשמר
--
-- ‏status = 'not_found' בלי record: כתובת שאינה בשכבה לא תופיע בה מחר, ובלי
-- הרישום כל לחיצה הייתה שואלת עליה שוב. נבדקת שוב אחרי 90 יום, כמו כל
-- השורות - שכבת הכתובות מתעדכנת פעם ברבעון (מפ"י).
-- ============================================================================

create table if not exists public.govmap_address_planning (
  city_id      uuid not null,
  street_key   text not null,
  house_number text not null,
  city         text not null,
  street       text not null,
  status       text not null,
  gush         text,
  helka        text,
  record       jsonb,
  fetched_at   timestamptz not null default now(),
  primary key (city_id, street_key, house_number)
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.govmap_address_planning'::regclass
                    and conname  = 'govmap_address_planning_status_chk') then
    alter table public.govmap_address_planning
      add constraint govmap_address_planning_status_chk
      check (status in ('found', 'not_found'));
  end if;
end $$;

create index if not exists govmap_address_planning_parcel_idx
  on public.govmap_address_planning (gush, helka) where status = 'found';

comment on table public.govmap_address_planning is
  'מטמון מידע תכנוני מ-GovMap לכתובות בשווקים, שנשלף בדפדפן של מנהל/ת הפלטפורמה. הבוט קורא ממנו. מיגרציה 20270729090000, docs/govmap.md.';

alter table public.govmap_address_planning enable row level security;
revoke all on table public.govmap_address_planning from public, anon, authenticated;
grant select on table public.govmap_address_planning to service_role;

-- ---------------------------------------------------------------------------
-- התור: כתובות מהעסקאות בערי השווקים (בלי עפולה - שם השכבה העירונית),
-- שאינן במטמון או שנבדקו לפני יותר מ-90 יום - **עיר אחת בכל פעם**, העיר עם
-- הכי הרבה עסקאות קודם.
--
-- ‏**למה עיר אחת:** על כל 77 אלף העסקאות יחד השאילתה לקחה 4.3 שניות
-- (‏street_name_key לכל שורה ומיון לדיסק), קרוב לתקרת 8 השניות של
-- ‏authenticated; לעיר אחת - 25ms. עיר שאין בה מה לעשות נרשמת
-- ב-govmap_address_cities ולא נסרקת שוב 90 יום, וכך גם שם יישוב שאינו
-- בשוק. ‏city_id_for_name (security definer) נקראת לשם עיר, לא לעסקה.
-- ---------------------------------------------------------------------------
create table if not exists public.govmap_address_cities (
  city      text primary key,
  in_market boolean not null,
  done_at   timestamptz not null default now()
);

comment on table public.govmap_address_cities is
  'ערים שהתור של govmap_address_candidates סיים (או שאינן בשוק), כדי שלא ייסרקו שוב 90 יום.';

alter table public.govmap_address_cities enable row level security;
revoke all on table public.govmap_address_cities from public, anon, authenticated;
grant select on table public.govmap_address_cities to service_role;

-- כתובות שסוכנים שאלו עליהן את גבריאלה והן לא היו במטמון. התור מטפל בהן
-- קודם, כך שהשאלה הבאה על אותה כתובת נענית בוואטסאפ.
create table if not exists public.govmap_address_requests (
  city_id      uuid not null,
  street_key   text not null,
  house_number text not null,
  city         text not null,
  street       text not null,
  requested_at timestamptz not null default now(),
  primary key (city_id, street_key, house_number)
);

comment on table public.govmap_address_requests is
  'כתובות שגבריאלה נשאלה עליהן ולא היו במטמון הכתובות. govmap_address_candidates מטפלת בהן קודם.';

alter table public.govmap_address_requests enable row level security;
revoke all on table public.govmap_address_requests from public, anon, authenticated;
grant select on table public.govmap_address_requests to service_role;

create or replace function public.govmap_address_request(p_city text, p_street text, p_house_number text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cid uuid := public.city_id_for_name(btrim(coalesce(p_city, '')));
  v_sk  text := public.street_name_key(p_street);
  v_num text := btrim(coalesce(p_house_number, ''));
begin
  if v_cid is null or coalesce(v_sk, '') = '' or v_num !~ '^\d{1,4}[א-ת]?$' then return false; end if;
  insert into public.govmap_address_requests as r (city_id, street_key, house_number, city, street, requested_at)
  values (v_cid, v_sk, v_num, left(btrim(p_city), 100), left(btrim(p_street), 100), now())
  on conflict (city_id, street_key, house_number) do update set requested_at = now();
  return true;
end;
$$;

comment on function public.govmap_address_request(text, text, text) is
  'רישום כתובת שגבריאלה לא מצאה במטמון, לטיפול בהשלמה הבאה. service_role בלבד.';

revoke all on function public.govmap_address_request(text, text, text) from public, anon, authenticated;
grant execute on function public.govmap_address_request(text, text, text) to service_role;

create or replace function public.govmap_address_candidates(p_limit integer default 50)
returns table (
  city            text,
  street          text,
  house_number    text,
  gush            text,
  helka           text,
  city_remaining  bigint,
  cities_left     bigint
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_name  text;
  v_cid   uuid;
  v_left  bigint;
  v_tries integer := 0;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;

  -- קודם מה שסוכנים כבר שאלו עליו
  return query
  with todo as (
    select r.* from public.govmap_address_requests r
     where not exists (select 1 from public.govmap_address_planning g
                        where g.city_id = r.city_id and g.street_key = r.street_key
                          and g.house_number = r.house_number and g.fetched_at >= r.requested_at)
  )
  select t.city, t.street, t.house_number, null::text, null::text, count(*) over (), null::bigint
    from todo t
   order by t.requested_at
   limit greatest(1, least(coalesce(p_limit, 50), 200));
  if found then return; end if;

  for v_name in
    select m.city
      from public.market_deals_official m
     where m.city is not null and btrim(m.city) <> 'עפולה'
       and not exists (select 1 from public.govmap_address_cities d
                        where d.city = m.city and d.done_at > now() - interval '90 days')
     group by m.city
     order by count(*) desc, m.city
  loop
    v_tries := v_tries + 1;
    exit when v_tries > 40;

    v_cid := public.city_id_for_name(v_name);
    if v_cid is null or not exists (select 1 from public.cities c where c.id = v_cid and c.market_slug is not null) then
      insert into public.govmap_address_cities as d (city, in_market, done_at) values (v_name, false, now())
      on conflict (city) do update set in_market = false, done_at = now();
      continue;
    end if;

    -- ערים שעוד לא סומנו כגמורות (כולל זו, ואולי כמה שאינן בשוק)
    v_left := (select count(distinct m.city) from public.market_deals_official m
                where m.city is not null and btrim(m.city) <> 'עפולה'
                  and not exists (select 1 from public.govmap_address_cities d
                                   where d.city = m.city and d.done_at > now() - interval '90 days'));

    return query
    with addr as (
      select distinct on (public.street_name_key(m.street), btrim(m.house_number))
             m.city, btrim(m.street) as street, btrim(m.house_number) as house_number,
             nullif(btrim(m.gush), '') as gush, nullif(btrim(m.helka), '') as helka,
             public.street_name_key(m.street) as sk
        from public.market_deals_official m
       where m.city = v_name
         and nullif(btrim(coalesce(m.street, '')), '') is not null
         and btrim(coalesce(m.house_number, '')) ~ '^\d{1,4}[א-ת]?$'
       order by public.street_name_key(m.street), btrim(m.house_number), m.sold_at desc nulls last
    ), todo as (
      select a.* from addr a
       where not exists (select 1 from public.govmap_address_planning g
                          where g.city_id = v_cid and g.street_key = a.sk and g.house_number = a.house_number
                            and g.fetched_at > now() - interval '90 days')
    )
    select t.city, t.street, t.house_number, t.gush, t.helka, count(*) over (), v_left
      from todo t
     order by t.sk, t.house_number
     limit greatest(1, least(coalesce(p_limit, 50), 200));
    if found then return; end if;

    -- אין בעיר הזו מה לעשות: לא לסרוק אותה שוב 90 יום
    insert into public.govmap_address_cities as d (city, in_market, done_at) values (v_name, true, now())
    on conflict (city) do update set in_market = true, done_at = now();
  end loop;
end;
$$;

comment on function public.govmap_address_candidates(integer) is
  'קודם כתובות שגבריאלה נשאלה עליהן, ואחר כך עד p_limit כתובות מעסקאות בעיר אחת בשוק (בלי עפולה) שאין להן מידע תכנוני במטמון. city_remaining = כמה נשארו, cities_left = כמה ערים נשארו (null בשלב הבקשות). מנהל/ת פלטפורמה בלבד.';

revoke all on function public.govmap_address_candidates(integer) from public, anon, authenticated;
grant execute on function public.govmap_address_candidates(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- השמירה. הדפדפן אינו מקור אמין: כל שדה נבנה מחדש משדות מותרים בלבד.
-- ‏p_record = null -> 'not_found'.
-- ---------------------------------------------------------------------------
create or replace function public.govmap_address_save(
  p_city text, p_street text, p_house_number text, p_record jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cid    uuid;
  v_sk     text := public.street_name_key(p_street);
  v_num    text := btrim(coalesce(p_house_number, ''));
  v_gush   text;
  v_helka  text;
  v_clean  jsonb;
  v_plans  jsonb;
  v_gplans jsonb;
  v_lat    numeric;
  v_lng    numeric;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  v_cid := public.city_id_for_name(btrim(coalesce(p_city, '')));
  if v_cid is null then raise exception 'unknown_city'; end if;
  if coalesce(v_sk, '') = '' or v_num !~ '^\d{1,4}[א-ת]?$' then raise exception 'bad_address'; end if;

  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    insert into public.govmap_address_planning as g
      (city_id, street_key, house_number, city, street, status, gush, helka, record, fetched_at)
    values (v_cid, v_sk, v_num, btrim(p_city), btrim(p_street), 'not_found', null, null, null, now())
    on conflict (city_id, street_key, house_number) do update set
      status = 'not_found', gush = null, helka = null, record = null, fetched_at = now();
    return 'not_found';
  end if;

  v_gush  := nullif(btrim(coalesce(p_record->>'gush', '')), '');
  v_helka := nullif(btrim(coalesce(p_record->>'helka', '')), '');
  if v_gush is not null and v_gush !~ '^\d{1,7}$' then raise exception 'bad_gush'; end if;
  if v_helka is not null and v_helka !~ '^\d{1,5}$' then raise exception 'bad_helka'; end if;

  if jsonb_typeof(p_record->'lat') = 'number' and jsonb_typeof(p_record->'lng') = 'number' then
    v_lat := (p_record->>'lat')::numeric;
    v_lng := (p_record->>'lng')::numeric;
    if v_lat not between 29.3 and 33.5 or v_lng not between 34.2 and 35.95 then
      raise exception 'bad_coordinates';
    end if;
  end if;

  -- התוכנית המפורטת (retzefMigrashim): מספר ותאריך בלבד
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'number', left(btrim(pl->>'number'), 100),
           'date',   case when coalesce(pl->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then pl->>'date' end))), '[]'::jsonb)
    into v_plans
    from jsonb_array_elements(case when jsonb_typeof(p_record->'applicable_plans') = 'array'
                                   then p_record->'applicable_plans' else '[]'::jsonb end) pl
   where jsonb_typeof(pl) = 'object' and nullif(btrim(coalesce(pl->>'number', '')), '') is not null;

  -- שכבות 203/14: אותם שדות מותרים כמו govmap_plans_write (20270724090000)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'number',      left(btrim(pl->>'number'), 100),
           'name',        left(nullif(btrim(coalesce(pl->>'name', '')), ''), 200),
           'kind',        left(nullif(btrim(coalesce(pl->>'kind', '')), ''), 100),
           'stage',       case when pl->>'stage' in ('approved', 'deposited', 'notice') then pl->>'stage' end,
           'date',        case when coalesce(pl->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then pl->>'date' end,
           'permits',     case when jsonb_typeof(pl->'permits') = 'boolean' then pl->'permits' end,
           'notice',      case when jsonb_typeof(pl->'notice') = 'boolean' then pl->'notice' end,
           'url',         case when coalesce(pl->>'url', '') ~ '^https://mavat\.iplan\.gov\.il/[A-Za-z0-9/]{1,200}$' then pl->>'url' end,
           'designation', left(nullif(btrim(coalesce(pl->>'designation', '')), ''), 100)))
           order by ord), '[]'::jsonb)
    into v_gplans
    from jsonb_array_elements(case when jsonb_typeof(p_record->'govmap_plans') = 'array'
                                   then p_record->'govmap_plans' else '[]'::jsonb end) with ordinality t(pl, ord)
   where jsonb_typeof(pl) = 'object' and nullif(btrim(coalesce(pl->>'number', '')), '') is not null;

  if jsonb_array_length(v_plans) > 30 or jsonb_array_length(v_gplans) > 40 then
    raise exception 'bad_plans';
  end if;

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'parcel_area_sqm',      case when jsonb_typeof(p_record->'parcel_area_sqm') = 'number'
                                  and (p_record->>'parcel_area_sqm')::numeric between 0 and 100000000
                                 then (p_record->>'parcel_area_sqm')::numeric end,
    'parcel_status',        left(nullif(btrim(coalesce(p_record->>'parcel_status', '')), ''), 100),
    'land_use_designation', left(nullif(btrim(coalesce(p_record->>'land_use_designation', '')), ''), 200),
    'neighborhood',         left(nullif(btrim(coalesce(p_record->>'neighborhood', '')), ''), 200),
    'pin_source',           case when p_record->>'pin_source' in ('address', 'parcel') then p_record->>'pin_source' end,
    'lat', v_lat, 'lng', v_lng,
    'applicable_plans', v_plans,
    'govmap_plans', case when jsonb_typeof(p_record->'govmap_plans') = 'array' then v_gplans end));

  insert into public.govmap_address_planning as g
    (city_id, street_key, house_number, city, street, status, gush, helka, record, fetched_at)
  values (v_cid, v_sk, v_num, btrim(p_city), btrim(p_street), 'found', v_gush, v_helka, v_clean, now())
  on conflict (city_id, street_key, house_number) do update set
    status = 'found', gush = excluded.gush, helka = excluded.helka,
    record = excluded.record, fetched_at = excluded.fetched_at,
    city = excluded.city, street = excluded.street;
  return 'found';
end;
$$;

comment on function public.govmap_address_save(text, text, text, jsonb) is
  'שמירת מידע תכנוני מ-GovMap לכתובת במטמון הכתובות. מנהל/ת פלטפורמה בלבד; כל שדה מאומת. null = לא נמצא.';

revoke all on function public.govmap_address_save(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.govmap_address_save(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- הקריאה של הבוט: לפי כתובת, או לפי גוש/חלקה. התוכניות מאוחדות באותה
-- פונקציה של דף הנכס (planning_plans_merged), כדי שהסדר והכפילויות יהיו זהים.
-- ‏null = אין במטמון (או נבדק ולא נמצא) - הבוט נופל לקישור לכלי ב-CRM.
-- ---------------------------------------------------------------------------
create or replace function public.govmap_address_planning_get(
  p_city text, p_street text, p_house_number text, p_gush text default null, p_helka text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_row public.govmap_address_planning%rowtype;
begin
  if nullif(btrim(coalesce(p_gush, '')), '') is not null and nullif(btrim(coalesce(p_helka, '')), '') is not null then
    select * into v_row from public.govmap_address_planning g
     where g.status = 'found' and g.gush = btrim(p_gush) and g.helka = btrim(p_helka)
       and g.fetched_at > now() - interval '120 days'
     order by g.fetched_at desc limit 1;
  else
    select * into v_row from public.govmap_address_planning g
     where g.city_id = public.city_id_for_name(btrim(coalesce(p_city, '')))
       and g.street_key = public.street_name_key(p_street)
       and g.house_number = btrim(coalesce(p_house_number, ''))
       and g.status = 'found'
       and g.fetched_at > now() - interval '120 days';
  end if;
  if not found then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'city', v_row.city, 'street', v_row.street, 'house_number', v_row.house_number,
    'gush', v_row.gush, 'helka', v_row.helka,
    'parcel_area_sqm', v_row.record->'parcel_area_sqm',
    'parcel_status', v_row.record->>'parcel_status',
    'land_use_designation', v_row.record->>'land_use_designation',
    'neighborhood', v_row.record->>'neighborhood',
    'pin_source', v_row.record->>'pin_source',
    'lat', v_row.record->'lat', 'lng', v_row.record->'lng',
    'plans', public.planning_plans_merged(v_row.record->'applicable_plans', v_row.record->'govmap_plans'),
    'fetched_at', v_row.fetched_at));
end;
$$;

comment on function public.govmap_address_planning_get(text, text, text, text, text) is
  'מידע תכנוני מהמטמון לפי כתובת או גוש/חלקה, לעוזר בוואטסאפ. service_role בלבד. null = אין במטמון.';

revoke all on function public.govmap_address_planning_get(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.govmap_address_planning_get(text, text, text, text, text) to service_role;
