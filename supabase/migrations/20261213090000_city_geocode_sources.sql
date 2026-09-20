-- ============================================================================
-- ספק הגאוקוד לכל עיר
--
-- ## מה זה פותר
--
-- ‏`geocode_backfill_queue` מחזיקה היום `p.city = 'עפולה'` קשיח בשני
-- הענפים, ו-`_shared/afula-geocode.ts` מחזיק כתובת WFS, referer ושם שכבה
-- כקבועים. כל עיר חדשה הייתה דורשת עריכת קוד בשני מקומות.
--
-- ## ולמה הטבלה מפתוחה על שם העיר ולא על `cities.id`
--
-- **זו ההחלטה המרכזית כאן, והיא מונעת תקלת פרודקשן שקטה.**
--
-- ‏`cities` נולדה ריקה (ראו 20261210090000), ומיגרציית ההזנה עדיין לא רצה.
-- תור שנשען על `properties.city_id` היה מחזיר **אפס שורות** ביום שהוא
-- נכנס: לכל הנכסים `city_id is null`. כלומר הגאוקוד של עפולה — העיר
-- היחידה שיש בה מלאי — היה נפסק, בלי שגיאה ובלי שאיש ישים לב, עד שמישהו
-- יבחין שנכסים חדשים חסרי פין.
--
-- לכן המפתח הוא `city_key` = `city_name_key(שם העיר)`: אותה נרמול בדיוק
-- שהרישום משתמש בו, אבל **בלי תלות בכך שהרישום מולא**. ‏`city_id` קיים
-- כאן כעמודה nullable שתתמלא כשהרישום יהיה שם, והיא נוחות ולא תלות.
--
-- ## ‏`active` הוא שער, ולא דגל תצוגה
--
-- `docs/geocoding.md` מתעד את המחיר: נכס מקבל שלושה ניסיונות, ואחריהם הוא
-- יוצא מהתור. תור שנפתח מול ספק שעדיין לא עובד שורף את שלושת הניסיונות של
-- **כל** הנכסים בעיר ומוציא אותם **לתמיד** —
-- ‏`20261107090000_geocode_requeue_not_found.sql` קיימת כי כבר שילמנו על זה.
--
-- לכן עיר נכנסת לטבלה עם `active = false`, ונדלקת **רק אחרי** שהספק נבדק
-- ונמדד מול כתובות אמיתיות.
--
-- ## כרמיאל אינה כאן, ובכוונה
--
-- לעיריית כרמיאל מערכת GIS משלה (`karmiel.gis-net.co.il`), והיא נראית
-- מבטיחה: שכבת קדסטר, שכבת מידע הנדסי, ומחוון קואורדינטות ב-ITM שאומת
-- מול שני מקורות. אבל השירות יושב מאחורי `proxy/proxy.ashx` שמוביל
-- לכתובת פנימית (`10.237.72.70`), כלומר **כל קריאה עוברת בשרת של
-- העירייה** — וזה דורש רשות, לא רק כתובת.
--
-- שורה חלקית גרועה משורה חסרה: `base_url` שאיננו יודעים אינו `null`
-- שמותר, הוא ניחוש. כרמיאל תיכנס כשיהיו גם הכתובת וגם האישור.
--
-- תיעוד: docs/geocoding.md · docs/cities-and-regions.md
-- ============================================================================

create table if not exists public.city_geocode_sources (
  city_key      text primary key,
  city_name     text not null,
  city_id       uuid references public.cities(id) on delete set null,
  kind          text not null,
  base_url      text not null,
  referer       text,
  address_layer text,
  parcel_layer  text,
  active        boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.city_geocode_sources'::regclass
                    and conname  = 'city_geocode_sources_kind_chk') then
    alter table public.city_geocode_sources add constraint city_geocode_sources_kind_chk
      check (kind in ('municipal_wfs','govmap'));
  end if;

  -- ספק פעיל חייב שכבת כתובות. בלעדיה אין מה לשאול, והעיר הייתה נכנסת
  -- לתור ושורפת ניסיונות על כל נכס.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.city_geocode_sources'::regclass
                    and conname  = 'city_geocode_sources_active_needs_layer_chk') then
    alter table public.city_geocode_sources
      add constraint city_geocode_sources_active_needs_layer_chk
      check (not active or nullif(btrim(coalesce(address_layer, '')), '') is not null);
  end if;
end $$;

comment on table public.city_geocode_sources is
  'ספק הגאוקוד לכל עיר. ממופתח על city_name_key ולא על cities.id, כדי שהצינור לא ייפול כשהרישום עדיין ריק. active הוא שער: עיר נדלקת רק אחרי שהספק נמדד.';
comment on column public.city_geocode_sources.city_key is
  'city_name_key(שם העיר). המפתח אינו cities.id בכוונה - ראו ההסבר במיגרציה 20261213090000.';
comment on column public.city_geocode_sources.active is
  'האם העיר נכנסת לתור הגאוקוד. נדלק ידנית ורק אחרי מדידה: תור מול ספק שאינו עובד שורף שלושה ניסיונות לכל נכס ומוציא אותו מהתור לתמיד.';
comment on column public.city_geocode_sources.kind is
  'municipal_wfs = שכבת GIS עירונית · govmap = הספק הארצי. תואם את cities.geocode_provider.';

alter table public.city_geocode_sources enable row level security;
revoke all on table public.city_geocode_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.city_geocode_sources to service_role;

create index if not exists city_geocode_sources_active_idx
  on public.city_geocode_sources (city_key) where active;

-- ---------------------------------------------------------------------------
-- עפולה: הקבועים שיושבים היום בקוד, מילה במילה
--
-- ‏`do nothing` ולא `do update`: אלה ערכי פתיחה, ועריכה ידנית של מנהל/ת
-- אינה רעש שהרצה חוזרת מוחקת. אותו כלל של `street_registry_absorb`.
-- ---------------------------------------------------------------------------
insert into public.city_geocode_sources
  (city_key, city_name, kind, base_url, referer, address_layer, parcel_layer, active, notes)
values (
  public.city_name_key('עפולה'), 'עפולה', 'municipal_wfs',
  'https://layers.intertown.co.il/opengis/wfs',
  'https://up.intertown.co.il/afl/public',
  'afl_bld:afl_bld-Address_Points_1',
  'afl_cadaster:afl_cadaster-parcel',
  true,
  'שכבת עיריית עפולה. הקבועים זהים ל-_shared/afula-geocode.ts ול-_shared/afula-planning.ts.')
on conflict (city_key) do nothing;

-- ---------------------------------------------------------------------------
-- מה שהצינור קורא
--
-- מחזירה גם את תיבת העיר מהרישום, כשהיא שם. זה מה שמחליף את `AFULA_BOX`
-- הקשיח: קריאה אחת נותנת גם את נקודת הקצה וגם את הגבול לפסילת תוצאה.
--
-- תיבה `null` אינה שגיאה — היא אומרת "הרישום עדיין לא מכיר את העיר",
-- והצד הקורא נופל לתיבת ברירת המחדל של הספק. ‏`insideCityBox` נשען על
-- ההבחנה הזו.
-- ---------------------------------------------------------------------------
create or replace function public.city_geocode_source(p_city text)
returns table (
  city_key      text,
  city_name     text,
  kind          text,
  base_url      text,
  referer       text,
  address_layer text,
  parcel_layer  text,
  bbox_lat_min  double precision,
  bbox_lat_max  double precision,
  bbox_lng_min  double precision,
  bbox_lng_max  double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select s.city_key, s.city_name, s.kind, s.base_url, s.referer,
         s.address_layer, s.parcel_layer,
         c.bbox_lat_min, c.bbox_lat_max, c.bbox_lng_min, c.bbox_lng_max
    from public.city_geocode_sources s
    left join public.cities c on c.id = public.city_id_for_name(s.city_name)
   where s.city_key = public.city_name_key(p_city)
     and s.active;
$$;

comment on function public.city_geocode_source(text) is
  'נקודת הקצה והתיבה לעיר, או אפס שורות כשאין ספק פעיל. תיבה null = הרישום טרם מכיר את העיר, והקורא נופל לתיבת ברירת המחדל של הספק.';

revoke all on function public.city_geocode_source(text) from public, anon, authenticated;
grant execute on function public.city_geocode_source(text) to service_role;

-- ---------------------------------------------------------------------------
-- התור מפסיק להכיר את עפולה בשמה
--
-- ‏`drop` ולא `create or replace`: נוספה עמודת `city` לטיפוס ההחזרה, ו-
-- `replace` אינו יכול לשנות אותו. ‏`geocode_backfill_pending` נבנית מחדש
-- אחריה כי היא קוראת לה — אותה תבנית בדיוק של 20261201090000.
--
-- **‏`city` חוזרת כי בלעדיה אי אפשר לבחור ספק.** היא תוספת בלבד, ולכן
-- ‏`geocode-backfill/index.ts` הקיים (שקורא `street`, `house_number`,
-- `kind` בשם) ממשיך לעבוד בלי שינוי.
--
-- ‏`market_deals_official` אינה נושאת `city_id`, ולכן שני הענפים מצטרפים
-- על שם העיר דרך `city_name_key` — אותו מפתח, אותה התנהגות.
-- ---------------------------------------------------------------------------
drop function if exists public.geocode_backfill_queue(integer, smallint, interval);

create function public.geocode_backfill_queue(
  p_limit         integer  default 25,
  p_max_attempts  smallint default 3,
  p_retry_after   interval default interval '20 hours'
)
returns table (id uuid, street text, house_number text, kind text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.street, q.house_number, q.kind, q.city
    from (
      select p.id, p.street, p.house_number, 'property'::text as kind, p.city,
             p.geocode_attempted_at, p.created_at as ordered_at
        from public.properties p
        join public.city_geocode_sources s
          on s.city_key = public.city_name_key(p.city) and s.active
       where p.status = 'active'
         and (p.lat is null or p.lng is null)
         and nullif(btrim(coalesce(p.street, '')), '')       is not null
         and nullif(btrim(coalesce(p.house_number, '')), '') is not null
         and p.geocode_attempts < p_max_attempts
         and (p.geocode_attempted_at is null
              or p.geocode_attempted_at < now() - p_retry_after)

      union all

      select o.id, o.street, o.house_number, 'official_deal'::text as kind, o.city,
             o.geocode_attempted_at, o.imported_at as ordered_at
        from public.market_deals_official o
        join public.city_geocode_sources s
          on s.city_key = public.city_name_key(o.city) and s.active
       where (o.lat is null or o.lng is null)
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
  'שורות עם כתובת מלאה ובלי קואורדינטות, בערים שיש להן ספק גאוקוד פעיל - נכסים פעילים ועסקאות רשמיות. kind אומר למי לרשום את התוצאה, city אומר איזה ספק לשאול.';

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
grant execute on function public.geocode_backfill_pending() to service_role;

-- ---------------------------------------------------------------------------
-- ההשלמה של city_id, כשהרישום יהיה שם
--
-- no-op היום כי `cities` ריקה. אידמפוטנטי, ואפשר להריץ שוב אחרי ההזנה.
-- ---------------------------------------------------------------------------
do $$
declare
  v_done integer;
begin
  update public.city_geocode_sources s
     set city_id = public.city_id_for_name(s.city_name), updated_at = now()
   where s.city_id is null
     and public.city_id_for_name(s.city_name) is not null;
  get diagnostics v_done = row_count;
  raise notice 'city_geocode_sources.city_id: הושלמו % שורות', v_done;
end $$;
