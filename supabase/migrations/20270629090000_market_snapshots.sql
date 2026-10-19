-- ---------------------------------------------------------------------------
-- שווקים מקומיים: תמונה שמורה לכל שוק, וסוף ל"השרת לא ענה בזמן"
--
-- ‏**מה שבור:** פאנל "שווקים מקומיים" בתצוגת מנהל/ת הפלטפורמה מציג "שגיאה
-- בטעינת השוק: השרת לא ענה בזמן", והמסך ריק (18.10.2026). ‏platform_market_report
-- רצה 14,776ms על afula-emek (explain analyze כמנהל/ת), ו-authenticated מוגבל
-- ל-statement_timeout=8s. ב-pg_stat_statements: ממוצע 5,564ms ושיא 7,930ms על
-- 83 קריאות - כלומר היא ישבה על הקצה עוד קודם.
--
-- ‏**למה, אף ש-20270416091000 כבר תיקן את זה:** התיקון שם קיבץ את
-- market_deals_official לפי שם העיר ורק אז קרא ל-city_id_for_name. אבל התנאי
-- `where city_id_for_name(g.city) = any(...)` הוא על מפתח הקיבוץ, ולכן המתכנן
-- רשאי לדחוף אותו אל מתחת ל-GroupAggregate - וזה מה שהוא עושה: ה-Filter יושב על
-- ה-Index Only Scan, והפונקציה נקראת שוב לכל שורה. מאז המאגר גדל מ-31,847 ל-
-- 67,633 עסקאות, ו-13.9 מתוך 14.8 השניות הן הספירה הזו לבדה.
--
-- ‏**מה נכנס:**
--   1. ‏`materialized` על הקיבוץ - גדר שהמתכנן אינו דוחף תנאי דרכה. 590ms
--      במקום 13.9 שניות, אותו מספר בדיוק. ואותו דפוס לערים של הלידים, שבנוי
--      באותה צורה ועוד לא כואב (73 לידים).
--   2. ‏_platform_market_report_core - גוף הדוח בלי בדיקת המנהל/ת, כדי שהחישוב
--      המתוזמן והחישוב החי יהיו אותה פונקציה ולא שני עותקים.
--   3. ‏market_snapshots - התוצאה האחרונה לכל שוק, והשגיאה האחרונה אם הייתה.
--      הפאנל קורא ממנה ומציג מיד; כפתור הרענון מחשב חי ושומר. כשהחישוב החי
--      נכשל, נשארים הנתונים השמורים עם השעה שלהם ולא מסך ריק.
--   4. ‏market_snapshots_refresh() ב-pg_cron פעם בשעה, לכל 37 השווקים.
--
-- כלל הפתיחה (משרד אחד ו-10 נכסים פעילים) אינו משתנה כאן ואינו משוכפל: הוא
-- נשאר ב-MARKET_GATE ב-assets/crm.js וב-ops_agent/probes/behavior.py, והתמונה
-- נושאת את אותם מספרים שהם בודקים. docs/regional-pages.md, docs/admin-redesign.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. גוף הדוח
-- ---------------------------------------------------------------------------
create or replace function public._platform_market_report_core(p_market text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_city_ids uuid[];
  v_result   jsonb;
begin
  select coalesce(array_agg(c.id), '{}')
    into v_city_ids
    from public.cities c
   where c.market_slug = p_market;

  with
  props as (
    select p.id, p.title, p.city, p.city_id, p.price, p.deal_type, p.status,
           p.created_at, p.agency_id, (p.lat is not null and p.lng is not null) as has_pin
      from public.properties p
     where p.city_id = any (v_city_ids)
  ),
  ags as (
    select a.id, a.name, a.slug, a.created_at, a.city_id
      from public.agencies a
     where a.city_id = any (v_city_ids)
        or exists (select 1 from public.agency_members sm
                    where sm.agency_id = a.id
                      and sm.active and sm.released_at is null
                      and p_market = any (sm.service_markets))
  ),
  members as (
    select m.agency_id, count(*) as n
      from public.agency_members m
     where m.active and m.released_at is null
       and m.agency_id in (select id from ags)
     group by m.agency_id
  ),
  -- ‏materialized: city_id_for_name פעם לכל שם עיר, ולא לכל ליד. בלי הגדר
  -- המתכנן רשאי לפתוח את ה-CTE ולחזור לקריאה לכל שורה (ראו deal_cities).
  lead_cities as materialized (
    select d.city, public.city_id_for_name(d.city) as city_id
      from (select distinct l.city from public.leads l where l.city is not null) d
  ),
  market_leads as (
    select l.id, l.created_at, l.unlocked_at
      from public.leads l
      left join public.properties p on p.id = l.property_id
      left join lead_cities lc on lc.city = l.city
     where coalesce(p.city_id, lc.city_id) = any (v_city_ids)
  ),
  hoods as (
    select n.id, n.city_id,
           (jsonb_typeof(to_jsonb(n.boundary)) = 'array'
            and jsonb_array_length(to_jsonb(n.boundary)) >= 3) as marked
      from public.neighborhoods n
     where n.city_id = any (v_city_ids)
  ),
  -- ‏materialized הוא כל התיקון: התנאי על city_id_for_name הוא על מפתח הקיבוץ,
  -- ובלי הגדר המתכנן דחף אותו אל מתחת לקיבוץ - קריאה לכל אחת מ-67,633
  -- העסקאות, 13.9 שניות. עם הגדר: פעם לכל אחד מ-150 שמות הערים.
  deal_cities as materialized (
    select o.city, count(*) as n
      from public.market_deals_official o
     group by o.city
  )
  select jsonb_build_object(
    'market', p_market,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'props_active',   (select count(*) from props where status = 'active'),
      'props_new_30d',  (select count(*) from props where created_at > now() - interval '30 days'),
      'props_no_pin',   (select count(*) from props where status = 'active' and not has_pin),
      'agencies',       (select count(*) from ags),
      'agents',         (select coalesce(sum(n), 0) from members),
      'leads_30d',      (select count(*) from market_leads where created_at > now() - interval '30 days'),
      'leads_open',     (select count(*) from market_leads where unlocked_at is null),
      'neighborhoods',  (select count(*) from hoods),
      'hoods_marked',   (select count(*) from hoods where marked),
      'deals_official', (select coalesce(sum(g.n), 0)
                           from deal_cities g
                          where public.city_id_for_name(g.city) = any (v_city_ids))
    ),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name,
               'is_live', c.is_live,
               'props_active', (select count(*) from props p where p.city_id = c.id and p.status = 'active'),
               'agencies', (select count(*) from ags a where a.city_id = c.id),
               'neighborhoods', (select count(*) from hoods h where h.city_id = c.id)
             ) order by c.name)
        from public.cities c
       where c.id = any (v_city_ids)
    ), '[]'::jsonb),
    'agencies', coalesce((
      select jsonb_agg(x order by (x->>'props_active')::int desc, x->>'name')
        from (
          select jsonb_build_object(
                   'id', a.id, 'name', a.name, 'slug', a.slug, 'created_at', a.created_at,
                   'city', (select c.name from public.cities c where c.id = a.city_id),
                   'agents', coalesce((select n from members m where m.agency_id = a.id), 0),
                   'props_active', (select count(*) from props p where p.agency_id = a.id and p.status = 'active')
                 ) as x
            from ags a
        ) s
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'city', r.city, 'price', r.price,
               'deal_type', r.deal_type, 'status', r.status,
               'created_at', r.created_at, 'has_pin', r.has_pin
             ) order by r.created_at desc)
        from (select * from props order by created_at desc limit 8) r
    ), '[]'::jsonb),
    -- ‏נכסים פעילים שאינם שייכים לאף שוק - עיר שלא הוכרה, או עיר בלי שוק.
    -- לא של השוק הזה, אבל זה המקום שבו מנהל/ת מגלה אותם.
    'unassigned', coalesce((
      select jsonb_agg(jsonb_build_object('city', u.city, 'n', u.n) order by u.n desc)
        from (
          select coalesce(nullif(btrim(p.city), ''), '(ללא עיר)') as city, count(*) as n
            from public.properties p
            left join public.cities c on c.id = p.city_id
           where p.status = 'active' and c.market_slug is null
           group by 1
        ) u
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

comment on function public._platform_market_report_core(text) is
  'גוף דוח השוק המקומי, בלי בדיקת הרשאה. נקרא רק מ-platform_market_report (אחרי בדיקת מנהל/ת) ומ-market_snapshots_refresh (pg_cron). סגור לכל תפקיד של הדפדפן.';

-- ‏security invoker וסגורה לדפדפן: שני הקוראים הם security definer שבבעלות
-- postgres ו-cron שרץ כ-postgres, ולכן ה-execute שלהם הוא של הבעלים.
revoke all on function public._platform_market_report_core(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. התמונה השמורה
-- ---------------------------------------------------------------------------
create table if not exists public.market_snapshots (
  market_slug   text primary key,
  data          jsonb,
  computed_at   timestamptz,
  duration_ms   integer,
  source        text,
  last_error    text,
  last_error_at timestamptz
);

comment on table public.market_snapshots is
  'התוצאה האחרונה של דוח השוק המקומי לכל שוק (data, computed_at), והשגיאה האחרונה בחישוב (last_error). נכתבת מ-market_snapshots_refresh (שעתי) ומרענון חי ב-platform_market_report. קריאה למנהל/ת פלטפורמה בלבד.';

alter table public.market_snapshots enable row level security;

drop policy if exists market_snapshots_admin_read on public.market_snapshots;
create policy market_snapshots_admin_read on public.market_snapshots
  for select to authenticated
  using (public.current_is_platform_admin());

revoke all on table public.market_snapshots from anon, authenticated;
grant select on table public.market_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- 3. החישוב החי - אותה חתימה, ועכשיו גם שומר
-- ---------------------------------------------------------------------------
-- ‏volatile ולא stable: היא כותבת ל-market_snapshots, כך שכל רענון מהפאנל
-- מעדכן גם את התמונה שהטעינה הבאה תציג.
create or replace function public.platform_market_report(p_market text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_t0     timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  v_result := public._platform_market_report_core(p_market);

  if exists (select 1 from public.cities c where c.market_slug = p_market) then
    insert into public.market_snapshots as s (market_slug, data, computed_at, duration_ms, source)
    values (p_market, v_result, now(),
            (extract(epoch from clock_timestamp() - v_t0) * 1000)::int, 'live')
    on conflict (market_slug) do update
      set data = excluded.data, computed_at = excluded.computed_at,
          duration_ms = excluded.duration_ms, source = excluded.source;
  end if;

  return v_result;
end $$;

comment on function public.platform_market_report(text) is
  'תצוגת שוק מקומי למנהל/ת הפלטפורמה, מחושבת עכשיו ונשמרת ב-market_snapshots. משרד נספר בשוק לפי עירו או לפי אזור פעילות של חבר/ה בו. security definer שמחזיר מספרים ושמות פומביים בלבד; מסרב ב-42501 למי שאינו/ה מנהל/ת.';

revoke all on function public.platform_market_report(text) from public, anon, authenticated;
grant execute on function public.platform_market_report(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. הרענון המתוזמן
-- ---------------------------------------------------------------------------
-- שוק שנכשל אינו עוצר את השאר: החריגה נתפסת לכל שוק בנפרד, ונרשמת ב-
-- last_error בלי לגעת ב-data - הנתונים הטובים האחרונים נשארים מוצגים.
create or replace function public.market_snapshots_refresh()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_t0   timestamptz;
  v_data jsonb;
  v_done integer := 0;
begin
  for v_slug in
    select distinct c.market_slug from public.cities c
     where c.market_slug is not null
     order by 1
  loop
    v_t0 := clock_timestamp();
    begin
      v_data := public._platform_market_report_core(v_slug);
      insert into public.market_snapshots as s (market_slug, data, computed_at, duration_ms, source)
      values (v_slug, v_data, now(),
              (extract(epoch from clock_timestamp() - v_t0) * 1000)::int, 'cron')
      on conflict (market_slug) do update
        set data = excluded.data, computed_at = excluded.computed_at,
            duration_ms = excluded.duration_ms, source = excluded.source;
      v_done := v_done + 1;
    exception when others then
      insert into public.market_snapshots as s (market_slug, last_error, last_error_at)
      values (v_slug, left(sqlerrm, 500), now())
      on conflict (market_slug) do update
        set last_error = excluded.last_error, last_error_at = excluded.last_error_at;
    end;
  end loop;

  -- שוק שהוצא מהרשימה (אין לו עוד ערים) אינו נשאר עם תמונה ישנה.
  delete from public.market_snapshots s
   where not exists (select 1 from public.cities c where c.market_slug = s.market_slug);

  return v_done;
end $$;

comment on function public.market_snapshots_refresh() is
  'מחשב מחדש את market_snapshots לכל השווקים (pg_cron, פעם בשעה). שוק שנכשל נרשם ב-last_error ושומר את הנתונים האחרונים. מחזיר כמה שווקים חושבו.';

revoke all on function public.market_snapshots_refresh() from public, anon, authenticated;
grant execute on function public.market_snapshots_refresh() to service_role;

-- ---------------------------------------------------------------------------
-- 5. התזמון - פעם בשעה, בדקה 17 (לא בראש השעה, שבה רצים רוב התזמונים)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - רענון תמונות השווקים לא תוזמן';
    return;
  end if;

  perform cron.unschedule('market-snapshots-refresh')
    where exists (select 1 from cron.job where jobname = 'market-snapshots-refresh');

  perform cron.schedule('market-snapshots-refresh', '17 * * * *',
    'select public.market_snapshots_refresh();');
end;
$$;

-- ‏הרצה ראשונה עכשיו, כדי שהפאנל לא יחכה שעה לתמונה הראשונה. כשל בשוק אחד
-- נתפס בתוך הפונקציה, ולכן השורה הזו אינה יכולה להפיל את המיגרציה.
select public.market_snapshots_refresh();
