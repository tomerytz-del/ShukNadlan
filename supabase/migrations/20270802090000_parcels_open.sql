-- ============================================================================
-- שכבת החלקות הפתוחה של המרכז למיפוי ישראל - עותק משלנו, בלי GovMap
--
-- ## למה
--
-- תנאי השימוש של GovMap אוסרים איסוף בהיקף בלי אישור בכתב, ומפ"י מתירים
-- את ה-API מצד הלקוח בלבד (docs/govmap.md). אותה שכבה בדיוק (‏PARCEL_ALL)
-- מתפרסמת ב-data.gov.il כמאגר פתוח ("חלקות shape", רישיון פתוח שמתיר
-- שימוש מסחרי): ‏1,097,775 חלקות, גוש, חלקה, שטח רשום, סטטוס ויישוב, ב-ITM.
-- נבדק מ-GitHub Actions ב-22.10.2026 (‏scripts/parcels_probe.py) - הקובץ יורד.
--
-- עם העותק הזה הבוט עונה בעצמו, מהשרת ובלי GovMap, על **גוש, חלקה, שטח,
-- סטטוס ויישוב** בכל הארץ. **ייעוד ותוכניות אינם בשכבה** - הם נשארים
-- ב-GovMap, לנכס בודד, בדפדפן.
--
-- ## מה נשמר
--
-- שורה לחלקה, ונקודה אחת (מרכז הטבעת החיצונית, ב-WGS84) במקום הצורה: כ-1.1
-- מיליון מצולעים היו מאות MB במסד, והשימוש היום הוא "איפה החלקה" ולא "איזו
-- חלקה מכילה נקודה". ‏gush_suffix נשמר: 0 ברוב המוחלט, וגוש עם סיומת הוא
-- גוש אחר.
--
-- ## הטעינה
--
-- ‏parcels_open_loader.py (‏parcels_open.yml), חודשי, אותו דפוס של land_ownership:
-- כתיבה במנות עם batch, והמחיקה של הישן רק ב-parcels_open_finish אחרי שנכתבו
-- לפחות מיליון חלקות. הורדה שנקטעה לא מוחקת חצי מדינה.
-- ============================================================================

create table if not exists public.parcels_open (
  gush          integer     not null,
  gush_suffix   integer     not null default 0,
  helka         integer     not null,
  legal_area    numeric,
  status_text   text,
  locality_code integer,
  locality_name text,
  municipality  text,
  lat           numeric,
  lng           numeric,
  batch         text        not null,
  primary key (gush, helka, gush_suffix)
);

comment on table public.parcels_open is
  'שכבת החלקות הפתוחה של המרכז למיפוי ישראל (data.gov.il, "חלקות shape"). שורה לחלקה, נקודה במקום צורה. נטענת ב-parcels_open_loader.py. docs/govmap.md.';

create table if not exists public.parcels_open_loads (
  id              bigserial    primary key,
  batch           text         not null unique,
  source_url      text,
  source_modified timestamptz,
  status          text         not null default 'running',
  rows_read       integer,
  rows_rejected   integer,
  parcels         integer,
  error           text,
  started_at      timestamptz  not null default now(),
  finished_at     timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.parcels_open_loads'::regclass
                    and conname  = 'parcels_open_loads_status_chk') then
    alter table public.parcels_open_loads
      add constraint parcels_open_loads_status_chk check (status in ('running', 'done', 'failed'));
  end if;
end $$;

comment on table public.parcels_open_loads is 'יומן הטעינות של parcels_open.';

alter table public.parcels_open       enable row level security;
alter table public.parcels_open_loads enable row level security;
revoke all on table public.parcels_open       from public, anon, authenticated;
revoke all on table public.parcels_open_loads from public, anon, authenticated;
grant select, insert, update, delete on table public.parcels_open       to service_role;
grant select, insert, update, delete on table public.parcels_open_loads to service_role;
grant usage, select on sequence public.parcels_open_loads_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- סיום טעינה: מוחק את הישן רק אם נכתב מספיק
-- ---------------------------------------------------------------------------
create or replace function public.parcels_open_finish(
  p_batch       text,
  p_min_parcels integer default 1000000
)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '300s'
as $$
declare
  v_count   integer;
  v_deleted integer;
begin
  select count(*) into v_count from public.parcels_open where batch = p_batch;

  if v_count < p_min_parcels then
    update public.parcels_open_loads
       set status = 'failed', finished_at = now(),
           error = format('רק %s חלקות נכתבו, הסף %s. הנתונים הקודמים נשארו.', v_count, p_min_parcels)
     where batch = p_batch;
    return jsonb_build_object('ok', false, 'parcels', v_count, 'min', p_min_parcels);
  end if;

  delete from public.parcels_open where batch <> p_batch;
  get diagnostics v_deleted = row_count;

  update public.parcels_open_loads
     set status = 'done', finished_at = now(), parcels = v_count
   where batch = p_batch;

  return jsonb_build_object('ok', true, 'parcels', v_count, 'deleted', v_deleted);
end;
$$;

revoke all on function public.parcels_open_finish(text, integer) from public, anon, authenticated;
grant execute on function public.parcels_open_finish(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- חלקה אחת - לעוזר בוואטסאפ. ‏text כמו land_ownership_of: ספרות בלבד, בלי
-- אפסים מובילים. גוש בלי סיומת קודם. ‏null = אין בשכבה.
-- ---------------------------------------------------------------------------
create or replace function public.parcel_open_of(p_gush text, p_helka text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'gush', p.gush, 'helka', p.helka,
           'gush_suffix', nullif(p.gush_suffix, 0),
           'legal_area', p.legal_area,
           'status_text', p.status_text,
           'locality_name', p.locality_name,
           'municipality', p.municipality,
           'lat', p.lat, 'lng', p.lng,
           'as_of', (select l.source_modified from public.parcels_open_loads l
                      where l.status = 'done' order by l.finished_at desc limit 1)))
    from public.parcels_open p
   where regexp_replace(coalesce(p_gush, ''), '\D', '', 'g') ~ '^\d{1,7}$'
     and regexp_replace(coalesce(p_helka, ''), '\D', '', 'g') ~ '^\d{1,5}$'
     and p.gush  = regexp_replace(p_gush,  '\D', '', 'g')::integer
     and p.helka = regexp_replace(p_helka, '\D', '', 'g')::integer
   order by p.gush_suffix
   limit 1;
$$;

comment on function public.parcel_open_of(text, text) is
  'חלקה מהשכבה הפתוחה: שטח רשום, סטטוס, יישוב ונקודה. service_role בלבד. null = אין בשכבה.';

revoke all on function public.parcel_open_of(text, text) from public, anon, authenticated;
grant execute on function public.parcel_open_of(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- כתובת -> גוש/חלקה, מהעסקאות של רשות המיסים (שלנו, בלי GovMap). הגוש
-- והחלקה הנפוצים ביותר בעסקאות בכתובת. ‏null = לא נרשמה עסקה בכתובת.
-- ‏city_id_for_name נקראת פעם אחת (ולא לכל שורה), ‏street_name_key על הרחוב.
-- ---------------------------------------------------------------------------
create or replace function public.address_parcel_from_deals(p_city text, p_street text, p_house_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_city  text := btrim(coalesce(p_city, ''));
  v_sk    text := public.street_name_key(p_street);
  v_num   text := btrim(coalesce(p_house_number, ''));
  v_cid   uuid;
  v_names text[];
  v_out   jsonb;
begin
  if v_city = '' or coalesce(v_sk, '') = '' or v_num = '' then return null; end if;

  -- השם כפי שהוא רשום בעסקאות - חיפוש באינדקס. רק אם אין, כתיב אחר של אותה
  -- עיר ("קרית"/"קריית"): מפתחות השם של העיר ושל הכינויים שלה, מול ~500 שמות
  -- העיר בעסקאות (‏city_name_key זולה). לא city_id_for_name לכל שם - 5ms
  -- לקריאה, 2.5 שניות - ולא בתוך ה-where על העסקאות, שם המתכנן הריץ אותה
  -- לכל עסקה (37 שניות). נמדד ב-22.10.2026: 62ms.
  if exists (select 1 from public.market_deals_official m where m.city = v_city limit 1) then
    v_names := array[v_city];
  else
    v_cid := public.city_id_for_name(v_city);
    if v_cid is null then return null; end if;
    with k as (
      select public.city_name_key(c.name) as key from public.cities c where c.id = v_cid
      union
      select a.alias_key from public.city_aliases a where a.city_id = v_cid
    ), names as materialized (
      select distinct m.city as name from public.market_deals_official m where m.city is not null
    )
    select array_agg(n.name) into v_names from names n where public.city_name_key(n.name) in (select key from k);
    if v_names is null then return null; end if;
  end if;

  select jsonb_build_object('gush', d.gush, 'helka', d.helka, 'deals', d.n)
    into v_out
    from (
      select btrim(m.gush) as gush, btrim(m.helka) as helka, count(*) as n
        from public.market_deals_official m
       where m.city = any (v_names)
         and btrim(m.house_number) = v_num
         and public.street_name_key(m.street) = v_sk
         and btrim(coalesce(m.gush, '')) ~ '^\d+$' and btrim(coalesce(m.helka, '')) ~ '^\d+$'
       group by 1, 2
       order by n desc
       limit 1
    ) d;
  return v_out;
end;
$$;

comment on function public.address_parcel_from_deals(text, text, text) is
  'גוש/חלקה לכתובת לפי עסקאות רשות המיסים שנרשמו בה. service_role בלבד. null = אין עסקה בכתובת.';

revoke all on function public.address_parcel_from_deals(text, text, text) from public, anon, authenticated;
grant execute on function public.address_parcel_from_deals(text, text, text) to service_role;
