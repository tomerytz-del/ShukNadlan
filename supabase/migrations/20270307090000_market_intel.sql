-- ===========================================================================
-- קונסולת השיווק — מודיעין שווקים ומילות מפתח
-- ===========================================================================
--
-- תומר ביקש (7.10.2026) לאתר משרדי תיווך ומתווכים לפי אזור, לצורך מיקוד
-- הקמפיין למתווכים, ועזרה במילות מפתח. שלושה מקורות:
--
--   | מקור                     | מה נשמר כאן                     | למה רק זה |
--   |--------------------------|----------------------------------|-----------|
--   | רשם המתווכים (data.gov.il)| ספירה לכל עיר - בלי שם ובלי מספר | מתווך/ת הוא אדם פרטי; ספירה עונה על השאלה ואינה מאגר מידע |
--   | Google Places            | place_id בלבד, וספירה לכל עיר    | תנאי השימוש של גוגל: place_id מותר לשמירה, שם/טלפון/דירוג לא |
--   | חיפושי האתר (search_events)| כלום חדש - דוח מעל מה שכבר נאסף | |
--
-- ‏**העיר ברשם היא עיר המגורים**, לא מקום העבודה. כמספר לאזור (שוק של כמה
-- ערים) זה קירוב סביר; כרשימה של "מי עובד איפה" זה לא נכון, ולכן אין רשימה.
--
-- ‏**הספירה מגוגל נקטעת ב-60**: Text Search מחזיר עד שלושה עמודים של 20.
-- עיר גדולה תסומן capped, והמספר הוא "60 ומעלה" ולא 60.
--
-- הרשאות: הטבלאות למנהל/ת פלטפורמה בלבד (קריאה), כתיבה רק מ-ads-admin.
-- שני הדוחות security definer עם בדיקת current_is_platform_admin() בשורה
-- הראשונה, כמו platform_market_report — הם סופרים agencies ו-agency_members,
-- שה-RLS שלהן אינו פתוח למנהל/ת. docs/marketing-console.md
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. רשם המתווכים - ספירה לכל עיר
-- ---------------------------------------------------------------------------
create table if not exists public.market_intel_registry (
  city_name     text primary key,
  city_key      text generated always as (public.city_name_key(city_name)) stored,
  brokers       integer not null,
  refreshed_at  timestamptz not null default now()
);
create index if not exists market_intel_registry_key_idx on public.market_intel_registry (city_key);

comment on table public.market_intel_registry is
  'כמה מתווכים מורשים רשומים בכל עיר מגורים ברשם המתווכים (data.gov.il). ספירה בלבד - בלי שמות ובלי מספרי רישיון. מתרענן מ-ads-admin (intel_registry_refresh)';

-- ---------------------------------------------------------------------------
-- 2. Google Places - מזהים בלבד
-- ---------------------------------------------------------------------------
create table if not exists public.market_intel_places (
  place_id    text primary key,
  city_id     uuid not null references public.cities(id) on delete cascade,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists market_intel_places_city_idx on public.market_intel_places (city_id, last_seen desc);

comment on table public.market_intel_places is
  'משרדי תיווך שנמצאו ב-Google Places לכל עיר - place_id בלבד, כי זה מה שתנאי השימוש של גוגל מתירים לשמור. שם, טלפון ודירוג נמשכים חי בכל צפייה';

create table if not exists public.market_intel_scans (
  city_id     uuid primary key references public.cities(id) on delete cascade,
  offices     integer not null,
  capped      boolean not null default false,
  scanned_at  timestamptz not null default now()
);

comment on table public.market_intel_scans is
  'הסריקה האחרונה של Google Places לכל עיר: כמה משרדים, והאם נקטע ב-60 (capped)';

alter table public.market_intel_registry enable row level security;
alter table public.market_intel_places   enable row level security;
alter table public.market_intel_scans    enable row level security;

drop policy if exists "platform admin reads intel registry" on public.market_intel_registry;
create policy "platform admin reads intel registry" on public.market_intel_registry
  for select to authenticated using (public.current_is_platform_admin());
drop policy if exists "platform admin reads intel places" on public.market_intel_places;
create policy "platform admin reads intel places" on public.market_intel_places
  for select to authenticated using (public.current_is_platform_admin());
drop policy if exists "platform admin reads intel scans" on public.market_intel_scans;
create policy "platform admin reads intel scans" on public.market_intel_scans
  for select to authenticated using (public.current_is_platform_admin());

revoke all on public.market_intel_registry, public.market_intel_places, public.market_intel_scans from anon;

-- ---------------------------------------------------------------------------
-- 3. הדוח לשוק: לכל עיר בשוק - רשם, גוגל, ומה כבר בפלטפורמה
--
-- ‏p_market null = כל הערים שיש להן שוק. "בפלטפורמה" = משרדים שהעיר שלהם
-- היא העיר הזו, ומתווכים פעילים במשרדים האלה. החדירה מחושבת בדפדפן, כי
-- המכנה (רשם או גוגל) הוא בחירה של מי שקורא/ת.
-- ---------------------------------------------------------------------------
create or replace function public.platform_market_intel(p_market text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.market_slug, x.registry_brokers desc nulls last, x.name), '[]'::jsonb)
    into v_out
    from (
      select c.id as city_id,
             c.name,
             c.market_slug,
             (select sum(r.brokers) from public.market_intel_registry r
               where r.city_key = public.city_name_key(c.name))::int as registry_brokers,
             s.offices as google_offices,
             s.capped  as google_capped,
             s.scanned_at,
             (select count(*) from public.agencies a where a.city_id = c.id)::int as platform_agencies,
             (select count(*) from public.agency_members m
                join public.agencies a on a.id = m.agency_id
               where a.city_id = c.id and m.active and m.released_at is null)::int as platform_agents
        from public.cities c
        left join public.market_intel_scans s on s.city_id = c.id
       where c.market_slug is not null
         and (p_market is null or c.market_slug = p_market)
    ) x;

  return jsonb_build_object(
    'cities', v_out,
    'registry_refreshed_at', (select max(refreshed_at) from public.market_intel_registry)
  );
end;
$$;

comment on function public.platform_market_intel(text) is
  'מודיעין שווקים למנהל/ת פלטפורמה: לכל עיר בשוק - מתווכים ברשם (ספירה), משרדים בגוגל (ספירה), ומשרדים ומתווכים בפלטפורמה. מספרים בלבד. docs/marketing-console.md';

revoke all on function public.platform_market_intel(text) from public, anon, authenticated;
grant execute on function public.platform_market_intel(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. מילות מפתח מחיפושי האתר
--
-- ‏platform_search_report מחזיר 15 מונחים לתצוגה בדשבורד. כאן עד 200, עם
-- סוג העסקה והקטגוריה השכיחים לכל מונח - כדי לפצל לקמפיינים (מכירה מול
-- השכרה) ולגזור מילות שלילה. נספר במבקרים (session) ולא בשורות, מאותה
-- סיבה כמו zero_terms: אדם אחד שמקליד אותו מונח שלוש פעמים אינו שלושה.
-- ---------------------------------------------------------------------------
create or replace function public.platform_keyword_report(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 1), 365);
  v_out  jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  with win as (
    select term, deal_type, category, result_count,
           coalesce(session_id, 'row:' || id::text) as who
      from public.search_events
     where occurred_at >= now() - make_interval(days => v_days)
       and term is not null and btrim(term) <> ''
  ), agg as (
    select term,
           count(distinct who)::int as people,
           count(*)::int as searches,
           count(distinct who) filter (where result_count = 0)::int as zero_people,
           mode() within group (order by coalesce(deal_type, 'all')) as deal_type,
           mode() within group (order by coalesce(category, 'all'))  as category
      from win
     group by term
  )
  select coalesce(jsonb_agg(a order by a.people desc, a.term), '[]'::jsonb)
    into v_out
    from (select * from agg order by people desc, term limit 200) a;

  return jsonb_build_object('days', v_days, 'terms', v_out);
end;
$$;

comment on function public.platform_keyword_report(integer) is
  'מונחי החיפוש באתר ב-N הימים האחרונים (עד 200), במבקרים, עם סוג העסקה והקטגוריה השכיחים - בסיס למילות מפתח ולמילות שלילה. מנהל/ת פלטפורמה בלבד';

revoke all on function public.platform_keyword_report(integer) from public, anon, authenticated;
grant execute on function public.platform_keyword_report(integer) to authenticated;
