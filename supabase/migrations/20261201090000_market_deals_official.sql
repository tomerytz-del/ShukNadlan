-- ============================================================================
-- עסקאות רשמיות: המאגר של רשות המיסים נכנס לדוח ה-CMA
--
-- ## מה שבור היום
--
-- ‏`agent_cma_report` שואבת ממקור אחד: `market_deals`, שנכתבת רק כשנכס
-- שלנו עובר ל-`sold`. כלומר הדוח שנמכר כ"ניתוח שוק" מתאר את **הפעילות
-- שלנו**, לא את השוק. בעפולה, עם מאגר בן שלוש שורות, זה נכון פעמיים:
-- המיגרציה הקודמת (`20261130090000`) כבר דאגה שהדוח יגיד זאת במפורש
-- במקום להציג ממוצע מומצא — וזה היה התיקון הנכון, אבל הוא תיקון של
-- הכנות ולא של הכיסוי.
--
-- מאגר עסקאות המקרקעין של **רשות המיסים** (‏nadlan.gov.il) הוא המקור
-- היחיד שהוא באמת מחיר עסקה: הוא נבנה מדיווחי מס שבח ומס רכישה, ולא
-- ממחירי פרסום. הוא גם פומבי בחוק. זה מה שנכנס כאן.
--
-- ## למה טבלה נפרדת ולא עוד שורות ב-market_deals
--
-- שלוש סיבות, וכל אחת מספיקה:
--
-- 1. **חשיפה.** ל-`market_deals` יש policy ציבורית (`using true`), והיא
--    נקראת מ-`anon` ברצועת המבזקים בדף הבית ובעמוד המשרד. עסקה רשמית
--    נושאת כתובת, גוש וחלקה וקואורדינטה מדויקת — והריפו הזה מצנזר בדיוק
--    את השדות האלה בדף הנכס (`property_planning_public`,
--    ‏`docs/property-address-privacy.md`). הוספתן לטבלה שקוראים ממנה
--    בלי התחברות הייתה סותרת את זה בשקט.
--
-- 2. **בעלות.** ‏`market_deals` היא רישום של מה שקרה אצלנו — לכל שורה יש
--    ‏`agency_id` ו-`agent_id`, והיא מזינה את "עסקאות אחרונות" ואת דירוג
--    המשרד. לעסקה של מישהו אחר בעיר אין שם מקום, והיא הייתה מזייפת את
--    שני המדדים האלה.
--
-- 3. **מחזור חיים.** המאגר הרשמי נמשך שוב ושוב ומתעדכן; שורות שלנו
--    נכתבות פעם אחת בטריגר. ערבוב היה הופך כל ייבוא לסיכון על נתוני
--    הפלטפורמה.
--
-- ‏`agent_cma_report` היא `security definer` ולכן היא רואה את שתי הטבלאות
-- בלי RLS, ומאחדת אותן. זה המקום היחיד שבו הן נפגשות.
--
-- ## מה עוד נכנס כאן
--
-- ‏`geo_distance_meters()` — הנוסחה ההוורסינית שהייתה משוכפלת שלוש פעמים
-- בגוף הדוח (פעם לבחירה, פעם לחישוב, פעם לסינון). עכשיו פונקציה אחת.
--
-- תור הגיאוקוד מורחב לעסקאות רשמיות. עסקה בלי קואורדינטות נופלת לרשימת
-- העיר ואינה נכנסת לחישוב הרדיוס — כלומר בדיוק למקום שבו הדוח הכי צריך
-- אותה היא לא תהיה. התור הקיים (`geocode_backfill_queue`) כבר יודע
-- לנהל ניסיונות, ויתור אחרי שלוש תשובות "אין כזו כתובת", ואי-ספירה של
-- תקלות תקשורת — אין סיבה לכתוב את זה שוב.
--
-- ## תלויות קיימות
--
-- ‏`market_deals`, ‏`properties`, ‏`pricing_config`, ‏`agency_members`,
-- ‏`agent_cma_report`, ‏`geocode_backfill_queue`, ‏`geocode_record_result`.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מרחק בין שתי נקודות
--
-- ‏immutable ולא stable: הנוסחה תלויה אך ורק בארבעת הארגומנטים, וזה מה
-- שמאפשר ל-planner להשתמש בה בתנאי `where` בלי להעריך אותה מחדש לכל שורה
-- פעמיים (פעם לסינון ופעם לפלט).
-- ---------------------------------------------------------------------------
-- הארגומנטים ב-`double precision` ולא ב-`numeric`, כי `properties.lat/lng`
-- הם כאלה. ‏float8 -> numeric הוא cast ברמת **השמה** ולא משתמע, ולכן גרסה
-- ב-numeric פשוט לא הייתה נמצאת בעת פתרון הקריאה:
--   function geo_distance_meters(double precision, ...) does not exist
create or replace function public.geo_distance_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end;
$$;

comment on function public.geo_distance_meters(double precision, double precision, double precision, double precision) is
  'מרחק אווירי במטרים בין שתי נקודות WGS84 (הוורסין). הייתה משוכפלת שלוש פעמים בגוף agent_cma_report.';

-- ---------------------------------------------------------------------------
-- 2. הטבלה
--
-- ‏`external_key` הוא הזהות של העסקה במקור, והוא ייחודי — הייבוא רץ שוב
-- ושוב על אותם חודשים, ובלי מפתח כזה כל הרצה הייתה מכפילה את המאגר.
-- הרכבתו היא באחריות ה-scraper ומתועדת ב-`docs/market-deals-official.md`.
--
-- ‏`raw` נשמר: כשיתברר שמיפוי שדה כלשהו היה שגוי, אפשר יהיה לתקן מהנתון
-- המקורי במקום למשוך הכול מחדש. הטבלה אינה נגישה ל-`anon` ול-
-- ‏`authenticated`, ולכן אין כאן חשיפה.
-- ---------------------------------------------------------------------------
create table if not exists public.market_deals_official (
  id            uuid primary key default gen_random_uuid(),
  external_key  text not null,
  source        text not null default 'tax_authority',

  city          text not null,
  neighborhood  text,
  address       text,
  street        text,
  house_number  text,
  gush          text,
  helka         text,

  property_type text,
  rooms         numeric,
  size_sqm      numeric,
  floor         text,
  year_built    integer,

  sale_price    numeric not null,
  sold_at       date    not null,

  -- ‏double precision ולא numeric: אלה הטיפוסים של properties.lat/lng,
  -- והעמודות האלה מתאחדות איתם ב-union של agent_cma_report.
  lat           double precision,
  lng           double precision,

  geocode_attempted_at timestamptz,
  geocode_attempts     smallint not null default 0,
  geocode_error        text,

  raw           jsonb,
  imported_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'market_deals_official_external_key_uniq') then
    alter table public.market_deals_official
      add constraint market_deals_official_external_key_uniq unique (external_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_deals_official_sale_price_check') then
    alter table public.market_deals_official
      add constraint market_deals_official_sale_price_check check (sale_price > 0);
  end if;
end $$;

create index if not exists market_deals_official_city_sold_at_idx
  on public.market_deals_official (city, sold_at desc);
create index if not exists market_deals_official_geo_idx
  on public.market_deals_official (lat, lng) where lat is not null and lng is not null;

comment on table public.market_deals_official is
  'מראה מקומית של מאגר עסקאות המקרקעין של רשות המיסים. נכתבת אך ורק על ידי deals_scraper.py ב-service_role, ונקראת רק דרך agent_cma_report. אינה מעורבת ב-market_deals, שהיא רישום העסקאות של הפלטפורמה עצמה.';
comment on column public.market_deals_official.external_key is
  'הזהות של העסקה במקור. ייחודי — הייבוא רץ שוב על אותם חודשים, ובלעדיו היה מכפיל את המאגר.';
comment on column public.market_deals_official.raw is
  'הרשומה כפי שהתקבלה מהמקור, לתיקון מיפוי שדות בדיעבד בלי משיכה חוזרת.';

-- **אין policy, וזו ההחלטה.** ‏RLS דלוק בלי אף כלל פירושו ש-`anon` ו-
-- ‏`authenticated` אינם רואים דבר, ו-`service_role` עוקף ממילא. הקריאה
-- היחידה היא מ-`agent_cma_report` שהיא `security definer`.
alter table public.market_deals_official enable row level security;

revoke all on table public.market_deals_official from public, anon, authenticated;
grant select, insert, update, delete on table public.market_deals_official to service_role;

drop trigger if exists market_deals_official_set_updated_at on public.market_deals_official;
create trigger market_deals_official_set_updated_at
  before update on public.market_deals_official
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. יומן הייבוא
--
-- בלי זה "הדוח ריק" ו"הייבוא לא רץ שבועיים" נראים אותו דבר בדיוק. הרצה
-- נרשמת גם כשהיא נכשלת — דווקא אז.
-- ---------------------------------------------------------------------------
create table if not exists public.market_deal_import_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'tax_authority',
  city          text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running',
  pages_fetched integer not null default 0,
  rows_seen     integer not null default 0,
  rows_written  integer not null default 0,
  rows_skipped  integer not null default 0,
  error         text
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'market_deal_import_runs_status_check') then
    alter table public.market_deal_import_runs
      add constraint market_deal_import_runs_status_check
      check (status in ('running', 'ok', 'failed'));
  end if;
end $$;

create index if not exists market_deal_import_runs_started_at_idx
  on public.market_deal_import_runs (started_at desc);

comment on table public.market_deal_import_runs is
  'יומן הרצות של deals_scraper.py. בלעדיו "אין עסקאות באזור" ו"הייבוא נפל לפני שבועיים" נראים זהים.';

alter table public.market_deal_import_runs enable row level security;
revoke all on table public.market_deal_import_runs from public, anon, authenticated;
grant select, insert, update on table public.market_deal_import_runs to service_role;

-- ---------------------------------------------------------------------------
-- 4. תור הגיאוקוד מקבל סוג שני
--
-- ‏`drop` ולא `create or replace`: טיפוס ההחזרה משתנה (נוספה `kind`),
-- ו-`replace` אינו יכול לשנות אותו. ‏`geocode_backfill_pending` נבנית
-- מחדש אחריה כי היא קוראת לה.
--
-- ‏`kind` ראשון לפי סדר ההמתנה ולא לפי סוג: עסקה רשמית שממתינה שבוע אינה
-- פחות דחופה מנכס שנשמר היום, ומיון לפי סוג היה יוצר תור שבו סוג אחד
-- מרעיב את השני כשיש בו יותר שורות.
-- ---------------------------------------------------------------------------
drop function if exists public.geocode_backfill_queue(integer, smallint, interval);

create function public.geocode_backfill_queue(
  p_limit         integer  default 25,
  p_max_attempts  smallint default 3,
  p_retry_after   interval default interval '20 hours'
)
returns table (id uuid, street text, house_number text, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.street, q.house_number, q.kind
    from (
      select p.id, p.street, p.house_number, 'property'::text as kind,
             p.geocode_attempted_at, p.created_at as ordered_at
        from public.properties p
       where p.status = 'active'
         and p.city = 'עפולה'
         and (p.lat is null or p.lng is null)
         and nullif(btrim(coalesce(p.street, '')), '')       is not null
         and nullif(btrim(coalesce(p.house_number, '')), '') is not null
         and p.geocode_attempts < p_max_attempts
         and (p.geocode_attempted_at is null
              or p.geocode_attempted_at < now() - p_retry_after)

      union all

      select o.id, o.street, o.house_number, 'official_deal'::text as kind,
             o.geocode_attempted_at, o.imported_at as ordered_at
        from public.market_deals_official o
       where o.city = 'עפולה'
         and (o.lat is null or o.lng is null)
         and nullif(btrim(coalesce(o.street, '')), '')       is not null
         and nullif(btrim(coalesce(o.house_number, '')), '') is not null
         and o.geocode_attempts < p_max_attempts
         and (o.geocode_attempted_at is null
              or o.geocode_attempted_at < now() - p_retry_after)
    ) q
   order by q.geocode_attempted_at asc nulls first, q.ordered_at desc
   limit greatest(p_limit, 0);
$$;

comment on function public.geocode_backfill_queue(integer, smallint, interval) is
  'שורות בעפולה עם כתובת מלאה ובלי קואורדינטות שעוד לא מיצו ניסיונות — נכסים פעילים ועסקאות רשמיות. ‏kind אומר למי לרשום את התוצאה.';

revoke all on function public.geocode_backfill_queue(integer, smallint, interval) from public, anon, authenticated;
grant execute on function public.geocode_backfill_queue(integer, smallint, interval) to service_role;

create or replace function public.geocode_backfill_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.geocode_backfill_queue(1));
$$;

revoke all on function public.geocode_backfill_pending() from public, anon, authenticated;

-- ‏`drop` ואז `create`, ולא הוספת עומס (overload) בן חמישה ארגומנטים:
-- שתי גרסאות של אותו שם הן בדיוק הדבר שאיש לא זוכר חצי שנה אחר כך, ואחת
-- מהן תמשיך לכתוב רק ל-`properties` בלי שאיש ישים לב.
--
-- ‏`p_kind` בסוף ועם ברירת מחדל כדי שהקריאה בת ארבעת הארגומנטים תמשיך
-- לעבוד: ‏`geocode-backfill` כבר פרוס, וה-workflow שמעלה את הגרסה החדשה
-- שלו רץ בנפרד מזה שמריץ את המיגרציה. בחלון שביניהם הוא ימשיך לרשום
-- נכסים כרגיל.
drop function if exists public.geocode_record_result(uuid, double precision, double precision, text);

create or replace function public.geocode_record_result(
  p_id    uuid,
  p_lat   double precision,
  p_lng   double precision,
  p_error text,
  p_kind  text default 'property'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'official_deal' then
    update public.market_deals_official
       set lat                  = coalesce(p_lat, lat),
           lng                  = coalesce(p_lng, lng),
           geocode_attempted_at = now(),
           geocode_attempts     = case when p_error = 'address_not_found'
                                       then geocode_attempts + 1
                                       else geocode_attempts end,
           geocode_error        = p_error
     where id = p_id;
  else
    update public.properties
       set lat                  = coalesce(p_lat, lat),
           lng                  = coalesce(p_lng, lng),
           geocode_attempted_at = now(),
           geocode_attempts     = case when p_error = 'address_not_found'
                                       then geocode_attempts + 1
                                       else geocode_attempts end,
           geocode_error        = p_error
     where id = p_id;
  end if;
end;
$$;

comment on function public.geocode_record_result(uuid, double precision, double precision, text, text) is
  'רושם את תוצאת הניסיון של geocode-backfill לשורה אחת. ‏p_kind בוחר את הטבלה; ברירת המחדל property שומרת על הקריאה הישנה בת ארבעת הארגומנטים.';

revoke all on function public.geocode_record_result(uuid, double precision, double precision, text, text) from public, anon, authenticated;
grant execute on function public.geocode_record_result(uuid, double precision, double precision, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. הדוח מאחד את שני המאגרים
--
-- מה השתנה מ-`20261130090000`:
--
-- ‏**בריכת עסקאות אחת.** ‏`deal_pool` מאחדת את שתי הטבלאות לצורה אחת
-- (‏מיקום, שטח, מחיר, תאריך, בסיס מחיר). עסקה של הפלטפורמה שואבת את
-- המיקום והשטח מהנכס המקושר, כמו עד היום; עסקה רשמית נושאת אותם בעצמה.
-- כל השאר — הרדיוס המתרחב, חלון הזמן, השתקת הסטטיסטיקה, `sources` —
-- ממשיך לעבוד בלי לדעת מאיפה השורה הגיעה. זו הנקודה: מקור שלישי שיתווסף
-- מחר יצטרך שורה אחת ב-`deal_pool` ותו לא.
--
-- ‏**`geo_distance_meters`** במקום שלוש העתקות של הנוסחה.
--
-- ‏**`price_basis`** של עסקה רשמית הוא `official` תמיד — מה שהיא, מעצם
-- היותה דיווח מס ולא מודעה.
--
-- מה **לא** השתנה: החתימה, קודי השגיאה, ומבנה ה-jsonb שחוזר. ‏`crm.html`,
-- ‏`assets/crm.js` ו-`toolCmaReport` אינם משתנים בגלל המיגרציה הזו.
-- ---------------------------------------------------------------------------
create or replace function public.agent_cma_report(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent        record;
  v_prop         record;
  v_subject_size numeric;
  v_base_radius  numeric;
  v_min_comps    integer;
  v_max_age      integer;
  v_cutoff       date;
  v_radius       numeric;
  v_used_radius  numeric := null;
  v_comps        jsonb   := '[]'::jsonb;
  v_city_comps   jsonb   := '[]'::jsonb;
  v_n            integer := 0;
  v_stats        jsonb;
  v_planning     jsonb;
  v_coverage     text;
  v_sources      jsonb;
  v_asking_n     integer := 0;
begin
  select m.id, m.tier, m.active
    into v_agent
    from public.agency_members m
   where m.id = p_agent_id;

  if not found or not v_agent.active then
    return jsonb_build_object('error', 'no_matching_agent_profile');
  end if;

  if v_agent.tier not in ('mid', 'premium') then
    return jsonb_build_object(
      'error',  'upgrade_required',
      'detail', 'דוח CMA זמין רק למנוי Mid/Premium',
      'cta',    'שדרג למנוי Mid או Premium כדי להפיק דוחות CMA'
    );
  end if;

  select p.* into v_prop
    from public.properties p
   where p.id = p_property_id
     and (p.agent_id = v_agent.id or p.status = 'active');

  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  -- שני המאגרים הם מאגרי מכר. השוואת שכ״ד חודשי מולם אינה "דוח עם מדגם
  -- קטן" אלא מספר חסר משמעות.
  if v_prop.deal_type = 'rent' then
    return jsonb_build_object(
      'error',  'rent_not_supported',
      'detail', 'דוח CMA מבוסס על עסקאות מכר בלבד. במאגר אין עסקאות שכירות להשוואה, ולכן לא ניתן להפיק דוח לנכס להשכרה.'
    );
  end if;

  v_subject_size := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24)
    into v_base_radius, v_min_comps, v_max_age
    from public.pricing_config;

  v_cutoff := (current_date - (v_max_age || ' months')::interval)::date;

  if v_prop.lat is not null and v_prop.lng is not null then
    foreach v_radius in array array[v_base_radius, v_base_radius*2, v_base_radius*3, v_base_radius*4, v_base_radius*6]
    loop
      select coalesce(jsonb_agg(c order by c.distance_meters), '[]'::jsonb), count(*)
        into v_comps, v_n
        from (
          select d.id,
                 d.source,
                 d.price_basis,
                 d.property_type,
                 d.rooms,
                 d.sale_price,
                 d.sold_at,
                 d.size_sqm,
                 (d.property_type is not distinct from v_prop.property_type) as same_type,
                 case when d.size_sqm > 0 then round(d.sale_price / d.size_sqm) end as price_per_sqm,
                 round(public.geo_distance_meters(v_prop.lat, v_prop.lng, d.lat, d.lng)) as distance_meters
            from (
              -- עסקאות הפלטפורמה: המיקום והשטח יושבים על הנכס המקושר
              select md.id, md.source, md.price_basis, md.property_type, md.rooms,
                     md.sale_price, md.sold_at,
                     rp.lat, rp.lng,
                     coalesce(rp.built_size_sqm, rp.size_sqm, rp.area_sqm) as size_sqm
                from public.market_deals md
                join public.properties rp on rp.id = md.related_property_id
               where md.related_property_id <> p_property_id

              union all

              -- עסקאות רשמיות: נושאות מיקום ושטח משל עצמן
              select o.id, o.source, 'official'::text, o.property_type, o.rooms,
                     o.sale_price, o.sold_at, o.lat, o.lng, o.size_sqm
                from public.market_deals_official o
            ) d
           where d.lat is not null and d.lng is not null
             and d.sold_at >= v_cutoff
             and public.geo_distance_meters(v_prop.lat, v_prop.lng, d.lat, d.lng) <= v_radius
        ) c;

      v_used_radius := v_radius;
      exit when v_n >= v_min_comps;
    end loop;
  end if;

  -- עסקאות באותה עיר שאי אפשר למקם — מוחזרות בנפרד, לא מעורבבות ברדיוס
  -- ולא נכנסות לסטטיסטיקה.
  select coalesce(jsonb_agg(c order by c.sold_at desc), '[]'::jsonb)
    into v_city_comps
    from (
      select md.id, md.property_type, md.rooms, md.sale_price, md.sold_at,
             md.source, md.price_basis
        from public.market_deals md
        left join public.properties rp on rp.id = md.related_property_id
       where md.city = v_prop.city
         and md.sold_at >= v_cutoff
         and (rp.id is null or rp.lat is null or rp.lng is null)

      union all

      select o.id, o.property_type, o.rooms, o.sale_price, o.sold_at,
             o.source, 'official'::text
        from public.market_deals_official o
       where o.city = v_prop.city
         and o.sold_at >= v_cutoff
         and (o.lat is null or o.lng is null)
    ) c;

  v_coverage := case
    when v_prop.lat is null or v_prop.lng is null then 'no_location'
    when v_n = 0                                  then 'none'
    when v_n < v_min_comps                        then 'insufficient'
    else 'ok'
  end;

  -- ההשתקה. ממוצע מ-2 עסקאות אינו "ממוצע עם אזהרה" — הוא מספר שאסור לו
  -- לצאת מה-RPC, כי כל מי שיקבל אותו יציג אותו.
  if v_coverage = 'ok' then
    select jsonb_build_object(
             'comparables_count',    count(*),
             'avg_price',            round(avg((x->>'sale_price')::numeric)),
             'median_price',         round(percentile_cont(0.5) within group (order by (x->>'sale_price')::numeric)::numeric),
             'min_price',            min((x->>'sale_price')::numeric),
             'max_price',            max((x->>'sale_price')::numeric),
             'avg_price_per_sqm',    round(avg((x->>'price_per_sqm')::numeric) filter (where x->>'price_per_sqm' is not null)),
             'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
             'same_type_count',      count(*) filter (where (x->>'same_type')::boolean),
             'asking_basis_count',   count(*) filter (where x->>'price_basis' = 'asking'),
             'official_basis_count', count(*) filter (where x->>'price_basis' = 'official')
           )
      into v_stats
      from jsonb_array_elements(v_comps) x;
  else
    v_stats := jsonb_build_object('comparables_count', v_n, 'sample_too_small', true);
  end if;

  select count(*) into v_asking_n
    from jsonb_array_elements(v_comps || v_city_comps) x
   where x->>'price_basis' = 'asking';

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', s.source,
           'label',  case s.source
                       when 'platform_derived' then 'עסקאות שנסגרו דרך שוק נדל״ן'
                       when 'tax_authority'    then 'רשות המיסים — מאגר עסקאות מקרקעין'
                       else s.source end,
           'deals',  s.n) order by s.n desc), '[]'::jsonb)
    into v_sources
    from (
      select x->>'source' as source, count(*) as n
        from jsonb_array_elements(v_comps || v_city_comps) x
       group by 1
    ) s;

  select to_jsonb(i) - 'property_id' into v_planning
    from public.property_planning_info i where i.property_id = p_property_id;

  return jsonb_build_object(
    'generated_at', now(),
    'subject', jsonb_build_object(
      'id', v_prop.id, 'title', v_prop.title, 'address', v_prop.address,
      'city', v_prop.city, 'property_type', v_prop.property_type,
      'deal_type', v_prop.deal_type, 'price', v_prop.price, 'rooms', v_prop.rooms,
      'size_sqm', v_subject_size,
      'price_per_sqm', case when v_subject_size > 0 then round(v_prop.price / v_subject_size) end,
      'lat', v_prop.lat, 'lng', v_prop.lng
    ),
    'planning', v_planning,
    'radius_meters_used', v_used_radius,
    'radius_exhausted', (v_used_radius is not null and v_n < v_min_comps),
    'comparables', v_comps,
    'city_comparables', v_city_comps,
    'stats', v_stats,
    'data_coverage', jsonb_build_object(
      'status',             v_coverage,
      'comparables_found',  v_n,
      'min_required',       v_min_comps,
      'max_deal_age_months',v_max_age,
      'oldest_considered',  v_cutoff,
      'asking_basis_count', v_asking_n,
      'has_statistics',     (v_coverage = 'ok')
    ),
    'sources', v_sources
  );
end;
$$;

comment on function public.agent_cma_report(uuid, uuid) is
  'דוח CMA לפי מזהה סוכן/ת מפורש. מאחד את עסקאות הפלטפורמה (market_deals) עם המאגר הרשמי (market_deals_official). סטטיסטיקה חוזרת רק כש-data_coverage.status=ok.';

revoke all on function public.agent_cma_report(uuid, uuid) from public;
revoke all on function public.agent_cma_report(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_cma_report(uuid, uuid) to service_role;
