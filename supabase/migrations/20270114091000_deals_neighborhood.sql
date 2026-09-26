-- ===========================================================================
-- שכונה לעסקה רשמית, והשוואה לפי שכונה בדוח ה-CMA
--
-- ## הבעיה
--
-- דוח ה-CMA משווה לפי **מרחק** (`cma_deal_pool`), ועסקה בלי פין אינה
-- נכנסת לשום רדיוס - היא יורדת לרשימת "עסקאות נוספות בעיר", בלי ממוצע.
-- בנשר זה 195 עסקאות, בקריית ים 50, בעפולה 123. לחלק מהן **יש** שם שכונה
-- מהמאגר של רשות המיסים, ומאז 26.9.2026 יש לכל 144 השכונות בחיפה והקריות
-- גבול (docs/regional-pages.md). כלומר המידע שם, והדוח פשוט לא השתמש בו.
--
-- ## מה כאן
--
-- 1. ‏`neighborhood_name_key` - צורת השוואה לשם שכונה.
-- 2. ‏`neighborhood_aliases` - כינויים מפורשים, בהכרעה של מנהל/ת.
-- 3. ‏`neighborhood_ids_for` - השכונות של (עיר, שם).
-- 4. ‏`market_deals_official.neighborhood_ids` - נקבע בטריגר ומושלם למפרע.
-- 5. ‏`agent_cma_report` - שכבה חדשה, `neighborhood_comparables`, **נפרדת**
--    מהסטטיסטיקה של הרדיוס. אותו עיקרון כמו שכבת השוק: מה שמגיע ממקור
--    אחר מוצג לצד, ולא נבלע בממוצע.
--
-- ## מערך ולא מזהה אחד: "הדר"
--
-- במאגר של רשות המיסים "הדר" בחיפה הוא שם אחד (138 עסקאות), ואצלנו הוא שלוש
-- שכונות: הדר מרכז, הדר עליון ורמת הדר. ההכרעה (26.9.2026): העסקאות נספרות
-- **בכל אחת משלוש**. לכן כינוי יכול להיות `shared`, והעסקה נושאת את כל
-- השכונות שהוא מצביע עליהן. בדוח השורה מסומנת כמשותפת - הקורא/ת רואה
-- שהיא לא ממוקמת בשכונה הזו דווקא.
--
-- ## ומה שאסור כאן, בכוונה
--
-- **לא ממציאים לעסקה מיקום.** מרכז השכונה אינו הפין של העסקה, ועסקה
-- שהוצבה בו הייתה נכנסת לרדיוס של כל נכס בסביבה במרחק שאינו אמיתי. לכן
-- השכבה החדשה אינה נוגעת ב-`cma_deal_pool` ואינה מחשבת מרחק.
--
-- **לא מנחשים שכונה.** התאמה אוטומטית (שם, או שם עם שם העיר) מתקבלת רק
-- כשהיא מצביעה על שכונה אחת. ריבוי שכונות נכנס **רק** דרך כינוי משותף
-- שמנהל/ת הכריע/ה עליו. שם שאינו מופיע אצלנו ("אזור תעשיה" בנשר) נשאר בלי
-- שיוך, והסוכן התפעולי מדווח עליו (`market_deal_hoods_unmatched`).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. מפתח השוואה
--
-- ‏city_name_key ועוד שני צעדים: גרשיים **נמחקים** (ברשות המסים "קריית ים
-- ב", אצלנו "קריית ים ב'"), ולוכסן, סוגריים, פסיק ונקודה הופכים לרווח
-- ("רמת הנשיא/רמת חביב" מול "רמת הנשיא (רמת חביב)"). בשונה מ-city_name_key,
-- כאן מחיקת גרש בטוחה: אין שתי שכונות באותה עיר שנבדלות רק בגרש.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_name_key(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(public.city_name_key(p_name), '[''"`׳״]', '', 'g'),
           '[\s/(),.]+', ' ', 'g')), '');
$$;

comment on function public.neighborhood_name_key(text) is
  'צורת ההשוואה לשם שכונה: city_name_key, בלי גרשיים, ולוכסן/סוגריים/פסיק/נקודה כרווח. "קריית ים ב" = "קריית ים ב''".';

-- ---------------------------------------------------------------------------
-- 2. כינויים
--
-- שורה כאן אומרת "השם הזה, בעיר הזו, הוא השכונה הזו". ‏`shared` אומר "השם
-- הזה מכסה כמה משכונותינו, והעסקה נספרת בכל אחת" - ואז יש שורה לכל שכונה,
-- כולן עם `shared`. גישה: service_role ופונקציות security definer בלבד (אין
-- מדיניות), כמו שאר טבלאות העזר של העסקאות.
-- ---------------------------------------------------------------------------
create table if not exists public.neighborhood_aliases (
  id              uuid primary key default gen_random_uuid(),
  neighborhood_id uuid not null references public.neighborhoods(id) on delete cascade,
  alias           text not null,
  alias_key       text generated always as (public.neighborhood_name_key(alias)) stored,
  shared          boolean not null default false,
  note            text,
  created_at      timestamptz not null default now()
);

create unique index if not exists neighborhood_aliases_hood_alias_uniq
  on public.neighborhood_aliases (neighborhood_id, alias_key);

alter table public.neighborhood_aliases enable row level security;

comment on table public.neighborhood_aliases is
  'שם חלופי לשכונה, כפי שהוא מופיע במקור חיצוני (מאגר רשות המיסים), בהכרעה של מנהל/ת. shared = השם מכסה כמה שכונות, והעסקה נספרת בכל אחת.';

-- ---------------------------------------------------------------------------
-- 3. השכונות של (עיר, שם)
--
-- שלוש דרכים להתאים: השם עצמו, השם עם שם העיר לפניו (בקריית ים המאגר
-- כותב "א" ואצלנו "קריית ים א'"), וכינוי. התשובה:
--
--   - כינויים משותפים בלבד (ושום התאמה אחרת) - כל השכונות שלהם.
--   - אחרת, רק אם כל הדרכים הצביעו על שכונה **אחת** - מערך של אחת.
--   - אחרת null: "לא ידוע", לא "אין שכונה" - כמו ב-neighborhood_for_point.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_ids_for(p_city text, p_name text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select id, name from public.cities
     where name_key = public.city_name_key(p_city)
     limit 1
  ), k as (
    select public.neighborhood_name_key(p_name) as k1,
           public.neighborhood_name_key(c.name || ' ' || p_name) as k2,
           c.id as city_id
      from c
  ), direct as (
    select n.id
      from public.neighborhoods n, k
     where n.city_id = k.city_id
       and public.neighborhood_name_key(n.name) in (k.k1, k.k2)
  ), al as (
    select a.neighborhood_id as id, a.shared
      from public.neighborhood_aliases a
      join public.neighborhoods n on n.id = a.neighborhood_id
      join k on n.city_id = k.city_id
     where a.alias_key = k.k1
  ), all_hits as (
    select id from direct union select id from al
  )
  select case
    when exists (select 1 from al where shared)
     and not exists (select 1 from al where not shared)
     and not exists (select 1 from direct)
      then (select array_agg(distinct id) from al)
    when (select count(*) from all_hits) = 1
      then (select array_agg(id) from all_hits)
  end;
$$;

comment on function public.neighborhood_ids_for(text, text) is
  'השכונות ששם (בעיר נתונה) מצביע עליהן: כל השכונות של כינוי משותף, או שכונה אחת כשכל ההתאמות מסכימות. אחרת null.';

revoke all on function public.neighborhood_ids_for(text, text) from public, anon, authenticated;
grant execute on function public.neighborhood_ids_for(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. הכינויים (נבדקו מול רשימת השכונות, 26.9.2026)
--
-- ארבעה כתיבים של אותו שם, שלושה בהכרעה של מנהל הפלטפורמה, ו"הדר" המשותף.
-- מה **שלא** נכנס כאן ולמה: docs/market-deals-official.md, "שכונה לעסקה".
-- ---------------------------------------------------------------------------
insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
select n.id, v.alias, v.shared, v.note
  from (values
    ('קריית מוצקין', 'משכנות אומנים',            'משכנות אמנים',            false, 'כתיב חסר/מלא'),
    ('קריית מוצקין', 'מוצקין הצעירה ונווה גנים', 'נווה גנים',               false, 'השכונה אצלנו נושאת את שני השמות'),
    ('חיפה',         'כבאביר',                    'כבביר',                   false, 'כתיב'),
    ('חיפה',         'מושבה גרמנית',              'המושבה הגרמנית',          false, 'ה"א הידיעה'),
    ('עפולה',        'דרום העיר',                 'עפולה דרום',              false, 'הכרעת מנהל הפלטפורמה, 26.9.2026'),
    ('עפולה',        'רובע יזרעאל',               'רובע יזרעאל סביוני העמק', false, 'הכרעת מנהל הפלטפורמה, 26.9.2026'),
    ('טירת כרמל',    'הפרחים',                    'כלניות',                  false, 'הכרעת מנהל הפלטפורמה: כלניות היא בשכונת הפרחים'),
    ('חיפה',         'הדר מרכז',                  'הדר',                     true,  'משותף: "הדר" במאגר נספר בשלוש שכונות הדר (הכרעת מנהל הפלטפורמה)'),
    ('חיפה',         'הדר עליון',                 'הדר',                     true,  'משותף: "הדר" במאגר נספר בשלוש שכונות הדר (הכרעת מנהל הפלטפורמה)'),
    ('חיפה',         'רמת הדר',                   'הדר',                     true,  'משותף: "הדר" במאגר נספר בשלוש שכונות הדר (הכרעת מנהל הפלטפורמה)')
  ) as v(city, hood, alias, shared, note)
  join public.cities c on c.name = v.city
  join public.neighborhoods n on n.city_id = c.id and n.name = v.hood
on conflict (neighborhood_id, alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. העמודה, הטריגר וההשלמה
-- ---------------------------------------------------------------------------
alter table public.market_deals_official
  add column if not exists neighborhood_ids uuid[];

comment on column public.market_deals_official.neighborhood_ids is
  'השכונות של העסקה לפי שם השכונה במאגר (neighborhood_ids_for). בדרך כלל אחת; כמה רק דרך כינוי משותף. null = לא הותאם.';

-- השכבה החדשה שואלת "עסקאות בלי פין בשכונה X" (‏`X = any(...)`), ולכן GIN
-- חלקי בדיוק על זה - לא על כל 15 אלף השורות.
create index if not exists market_deals_official_hoods_unpinned_idx
  on public.market_deals_official using gin (neighborhood_ids)
  where lat is null;

create or replace function public.market_deals_official_set_neighborhood()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.neighborhood_ids := case
    when coalesce(new.neighborhood, '') = '' then null
    else public.neighborhood_ids_for(new.city, new.neighborhood)
  end;
  return new;
end;
$$;

drop trigger if exists market_deals_official_set_neighborhood on public.market_deals_official;
create trigger market_deals_official_set_neighborhood
  before insert or update of city, neighborhood on public.market_deals_official
  for each row execute function public.market_deals_official_set_neighborhood();

-- שכונה או כינוי שנוספו או השתנו **אחרי** העסקה: כל העסקאות של העיר עם שם
-- שכונה מחושבות מחדש, ורק מה שהשתנה נכתב. גם שיוך קיים - כינוי משותף שנוסף
-- לשכונה שלישית חייב להגיע גם לעסקאות שכבר נשאו שתיים.
create or replace function public.market_deals_official_relink_city(p_city_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_done integer;
begin
  update public.market_deals_official o
     set neighborhood_ids = x.ids
    from (
      select o2.id, public.neighborhood_ids_for(o2.city, o2.neighborhood) as ids
        from public.market_deals_official o2
        join public.cities c on c.id = p_city_id and public.city_name_key(o2.city) = c.name_key
       where coalesce(o2.neighborhood, '') <> ''
    ) x
   where o.id = x.id
     and o.neighborhood_ids is distinct from x.ids;
  get diagnostics v_done = row_count;
  return v_done;
end;
$$;

revoke all on function public.market_deals_official_relink_city(uuid) from public, anon, authenticated;
grant execute on function public.market_deals_official_relink_city(uuid) to service_role;

create or replace function public.neighborhood_relink_deals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_city uuid;
begin
  if tg_table_name = 'neighborhood_aliases' then
    select n.city_id into v_city from public.neighborhoods n where n.id = new.neighborhood_id;
  else
    v_city := new.city_id;
  end if;
  if v_city is not null then
    perform public.market_deals_official_relink_city(v_city);
  end if;
  return null;
end;
$$;

drop trigger if exists neighborhood_aliases_relink_deals on public.neighborhood_aliases;
create trigger neighborhood_aliases_relink_deals
  after insert or update of alias, neighborhood_id, shared on public.neighborhood_aliases
  for each row execute function public.neighborhood_relink_deals();

drop trigger if exists neighborhoods_relink_deals on public.neighborhoods;
create trigger neighborhoods_relink_deals
  after insert or update of name, city_id on public.neighborhoods
  for each row execute function public.neighborhood_relink_deals();

-- ההשלמה למפרע: עיר-עיר דרך אותה פונקציה שהטריגרים קוראים, כדי שיהיה
-- מסלול אחד ולא שניים.
do $$
declare v_done integer := 0; r record;
begin
  for r in select id from public.cities loop
    v_done := v_done + public.market_deals_official_relink_city(r.id);
  end loop;
  raise notice 'market_deals_official.neighborhood_ids: % עסקאות שויכו לשכונה', v_done;
end $$;

-- ===========================================================================
-- 6. ‏agent_cma_report - שכבת השכונה
--
-- הגרסה המלאה מ-20261229090000_cma_market_features.sql, ועליה שלושה שינויים
-- בלבד (מסומנים בהערות): הבלוק "שכבת השכונה", הסינון שמונע מאותה עסקה
-- להופיע גם ברשימת העיר, והשדות החדשים בתשובה. ‏stats, הרדיוס ושכבת השוק
-- לא השתנו בתו.
-- ===========================================================================
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
  v_agent         record;
  v_prop          record;
  v_subject_size  numeric;
  v_subject_rooms numeric;
  v_base_radius   numeric;
  v_min_comps     integer;
  v_max_age       integer;
  v_similar_max   numeric;   -- עד לאן מרחיבים כדי לשמור על התאמת חדרים
  v_cutoff        date;
  v_pool_radius   numeric;
  v_counts        integer[];
  v_bands         numeric[];
  v_radii         numeric[];
  v_i             integer;
  v_used_radius   numeric := null;
  v_used_band     numeric := null;
  v_band_reason   text    := null;
  v_comps         jsonb   := '[]'::jsonb;
  v_city_comps    jsonb   := '[]'::jsonb;
  v_n             integer := 0;   -- מה שנכנס לסטטיסטיקה: מחלקה **וגם** חדרים
  v_n_class       integer := 0;   -- מחלקה תואמת ברדיוס, בלי סינון חדרים
  v_n_all         integer := 0;   -- כל מה שנפל ברדיוס, לתצוגה בלבד
  v_city_n        integer := 0;
  v_city_limit    integer;
  v_stats         jsonb;
  v_planning      jsonb;
  v_coverage      text;
  v_sources       jsonb;
  v_asking_n      integer := 0;
  -- שכבת השוק: נכסים פעילים למכירה, כלומר מחירים **מבוקשים**
  v_market_radius numeric := null;
  v_market_pool   jsonb   := '[]'::jsonb;
  v_market_comps  jsonb   := '[]'::jsonb;
  v_market_stats  jsonb   := null;
  v_market_n      integer := 0;
  v_market_feat_n integer := 0;
  v_subject_feat_n integer := 0;
  v_market_reason text    := null;
  v_min_market    integer;
  v_feat_min      numeric;
  v_market_limit  integer;
  -- שכבת השכונה: עסקאות רשמיות **בלי פין** באותה שכונה (20270114091000)
  v_hood_id       uuid    := null;
  v_hood_name     text    := null;
  v_hood_band     numeric := null;
  v_hood_comps    jsonb   := '[]'::jsonb;
  v_hood_stats    jsonb   := null;
  v_hood_total    integer := 0;
  v_hood_in       integer := 0;
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

  v_subject_size  := coalesce(v_prop.built_size_sqm, v_prop.size_sqm, v_prop.area_sqm);
  v_subject_rooms := nullif(v_prop.rooms, 0);

  select coalesce(max(value) filter (where key = 'cma_default_radius_meters'), 500),
         coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_max_deal_age_months'), 24),
         coalesce(max(value) filter (where key = 'cma_city_comparables_limit'), 12),
         coalesce(max(value) filter (where key = 'cma_similar_radius_meters'), 1000),
         coalesce(max(value) filter (where key = 'cma_min_market_comparables'), 3),
         coalesce(max(value) filter (where key = 'cma_feature_match_min'), 0.6),
         coalesce(max(value) filter (where key = 'cma_market_comparables_limit'), 12)
    into v_base_radius, v_min_comps, v_max_age, v_city_limit, v_similar_max,
         v_min_market, v_feat_min, v_market_limit
    from public.pricing_config;

  v_cutoff := (current_date - (v_max_age || ' months')::interval)::date;

  -- כמה מאפיינים **נספרים** יש לנכס עצמו. אפס פירושו שאי אפשר למדוד
  -- דמיון בכלל, וזו אמירה אחרת לגמרי מ"לא נמצאו נכסים דומים".
  select count(distinct x) into v_subject_feat_n
    from unnest(coalesce(v_prop.features, '{}'::text[])) x
   where x = any (public.cma_price_features());

  -- הסולם, מפורש. שני ממדים: התאמת חדרים (הדוק לרופף) ורדיוס (קרוב
  -- לרחוק), וכל קבוצת חדרים ממצה את הרדיוס המורחב **לפני** שמרפים ממנה.
  -- ‏null בעמודת הבנד = בלי סינון חדרים, כלומר התנהגות הדוח עד כאן.
  v_bands := array[0,             0,             0.5,           0.5,
                   1,             1,             null,          null,
                   null,          null,          null]::numeric[];
  v_radii := array[v_base_radius, v_similar_max, v_base_radius, v_similar_max,
                   v_base_radius, v_similar_max, v_base_radius, v_base_radius*2,
                   v_base_radius*3, v_base_radius*4, v_base_radius*6]::numeric[];
  v_pool_radius := greatest(v_base_radius * 6, v_similar_max);

  if v_prop.lat is not null and v_prop.lng is not null then
    -- מעבר **אחד** על הבריכה, ובו כל 11 הספירות. הגרסה הקודמת הריצה
    -- שאילתה לכל שלב בלולאה; 11 שאילתות היו הופכות את זה למחיר אמיתי.
    select array[
      count(*) filter (where c.same_type and c.rooms_diff <= 0   and c.distance_meters <= v_radii[1]),
      count(*) filter (where c.same_type and c.rooms_diff <= 0   and c.distance_meters <= v_radii[2]),
      count(*) filter (where c.same_type and c.rooms_diff <= 0.5 and c.distance_meters <= v_radii[3]),
      count(*) filter (where c.same_type and c.rooms_diff <= 0.5 and c.distance_meters <= v_radii[4]),
      count(*) filter (where c.same_type and c.rooms_diff <= 1   and c.distance_meters <= v_radii[5]),
      count(*) filter (where c.same_type and c.rooms_diff <= 1   and c.distance_meters <= v_radii[6]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[7]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[8]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[9]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[10]),
      count(*) filter (where c.same_type and c.distance_meters <= v_radii[11])
    ]::integer[]
      into v_counts
      from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_pool_radius,
                                p_property_id, v_prop.property_type, v_subject_rooms) c;

    for v_i in 1 .. array_length(v_radii, 1) loop
      -- נכס בלי מספר חדרים מדלג על השלבים המסוננים במקום לצבור בהם אפסים
      continue when v_bands[v_i] is not null and v_subject_rooms is null;
      v_used_band   := v_bands[v_i];
      v_used_radius := v_radii[v_i];
      v_n           := v_counts[v_i];
      exit when v_n >= v_min_comps;
    end loop;

    v_band_reason := case
      when v_used_band = 0           then 'exact'
      when v_used_band is not null   then 'relaxed'
      when v_subject_rooms is null   then 'subject_rooms_missing'
      else                                'no_similar_rooms'
    end;

    -- והרדיוס שנבחר, הפעם עם השורות עצמן. ‏`in_stats` נושא לכל עסקה אם
    -- היא זו שהמספרים נשענים עליה - התצוגה מסמנת לפיו, ואין בה לוגיקה
    -- משלה שתוכל להיפרד מהחישוב.
    select coalesce(jsonb_agg(c order by c.distance_meters), '[]'::jsonb),
           count(*),
           count(*) filter (where c.same_type),
           count(*) filter (where c.in_stats)
      into v_comps, v_n_all, v_n_class, v_n
      from (
        -- ‏coalesce ולא רק ה-and: עסקה בלי מספר חדרים נותנת
        -- ‏`true and null` = null, ותצוגה שבודקת `=== false` לא הייתה
        -- מסמנת אותה. שלושה ערכים לדגל בוליאני הם באג שממתין.
        select p.*,
               coalesce(p.same_type
                        and (v_used_band is null or p.rooms_diff <= v_used_band), false) as in_stats
          from public.cma_deal_pool(v_prop.lat, v_prop.lng, v_cutoff, v_used_radius,
                                    p_property_id, v_prop.property_type, v_subject_rooms) p
      ) c;

    -- ---- שכבת השוק: מול מי הנכס הזה מתחרה עכשיו ----
    --
    -- הרדיוס הוא לפחות `cma_similar_radius_meters`, כי מלאי פעיל דליל
    -- בסדר גודל מעסקאות: 1,512 עסקאות מול 31 מודעות באותה עיר.
    v_market_radius := greatest(coalesce(v_used_radius, v_base_radius), v_similar_max);

    select coalesce(jsonb_agg(c order by c.feature_match desc nulls last, c.distance_meters), '[]'::jsonb)
      into v_market_pool
      from (
        select m.id,
               m.title,
               m.rooms,
               m.price,
               m.size_sqm,
               case when m.size_sqm > 0 then round(m.price / m.size_sqm) end as price_per_sqm,
               m.features,
               m.is_own,
               public.cma_feature_similarity(v_prop.features, m.features) as feature_match,
               round(public.geo_distance_meters(v_prop.lat, v_prop.lng, m.lat, m.lng))::numeric
                 as distance_meters
          from (
            select p.id, p.title, nullif(p.rooms, 0) as rooms, p.price, p.features,
                   p.lat, p.lng, (p.agent_id = v_agent.id) as is_own,
                   coalesce(p.built_size_sqm, p.size_sqm, p.area_sqm) as size_sqm
              from public.properties p
             where p.status = 'active'
               and p.deal_type = 'sale'
               and p.id <> p_property_id
               and p.price > 0
               and p.lat is not null and p.lng is not null
               and public.property_type_class(p.property_type)
                   = public.property_type_class(v_prop.property_type)
          ) m
         where public.geo_distance_meters(v_prop.lat, v_prop.lng, m.lat, m.lng) <= v_market_radius
           and (v_used_band is null
                or (m.rooms is not null and v_subject_rooms is not null
                    and abs(m.rooms - v_subject_rooms) <= v_used_band))
      ) c;

    select count(*), count(*) filter (where (x->>'feature_match')::numeric >= v_feat_min)
      into v_market_n, v_market_feat_n
      from jsonb_array_elements(v_market_pool) x;

    v_market_reason := case
      when v_market_n < v_min_market       then 'too_few'
      when v_market_feat_n >= v_min_market then 'features'
      when v_subject_feat_n = 0            then 'subject_features_missing'
      else                                      'rooms_only'
    end;

    -- החציון מושתק מתחת לסף, והרשימה לא: כל שורה בה היא נכס אחד עם
    -- מחיר אחד - עובדה - וחציון משתי מודעות הוא סטטיסטיקה שאין עליה
    -- על מה להישען. אותה הבחנה בדיוק שבין `comparables` ל-`stats`.
    if v_market_reason <> 'too_few' then
      select jsonb_build_object(
               'count',                count(*),
               'median_price',         round(percentile_cont(0.5) within group (order by (x->>'price')::numeric)::numeric),
               'min_price',            min((x->>'price')::numeric),
               'max_price',            max((x->>'price')::numeric),
               'median_price_per_sqm', round(percentile_cont(0.5) within group (
                                          order by (x->>'price_per_sqm')::numeric)
                                          filter (where x->>'price_per_sqm' is not null)::numeric),
               'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
               'own_count',            count(*) filter (where (x->>'is_own')::boolean),
               'feature_matched',      (v_market_reason = 'features')
             )
        into v_market_stats
        from jsonb_array_elements(v_market_pool) x
       where v_market_reason <> 'features'
          or (x->>'feature_match')::numeric >= v_feat_min;
    end if;

    select coalesce(jsonb_agg(s.x || jsonb_build_object('in_market_stats',
             v_market_reason <> 'too_few'
             and (v_market_reason <> 'features'
                  or coalesce((s.x->>'feature_match')::numeric, -1) >= v_feat_min))
             order by s.ord), '[]'::jsonb)
      into v_market_comps
      from (select x, ord
              from jsonb_array_elements(v_market_pool) with ordinality t(x, ord)
             order by ord
             limit v_market_limit) s;
  end if;

  -- ---- שכבת השכונה: עסקאות בלי פין, באותה שכונה ----
  --
  -- עסקה רשמית בלי פין אינה יכולה להיכנס לרדיוס, אבל לרובן יש שם שכונה
  -- מהמאגר (market_deals_official.neighborhood_ids). כאן הן נאספות לפי
  -- השכונה של הנכס - **בלי מרחק ובלי מיקום מומצא**, ובנפרד מ-stats: זו
  -- השוואה מסוג אחר ("באותה שכונה") ולא עוד שורות ברדיוס.
  --
  -- השכונה של הנכס: השיוך שלו, ואם אין - המצולע שהפין שלו נופל בו (אחד
  -- בלבד, כמו תמיד ב-neighborhood_for_point). כך השכבה עובדת גם לנכס בלי
  -- פין שיש לו שכונה, שבו כל הדוח שמעליו ריק.
  v_hood_id := coalesce(
    v_prop.neighborhood_id,
    case when v_prop.lat is not null and v_prop.lng is not null
         then public.neighborhood_for_point(v_prop.city, v_prop.lat, v_prop.lng) end);

  if v_hood_id is not null then
    select n.name into v_hood_name from public.neighborhoods n where n.id = v_hood_id;

    -- החדרים: אותו בנד שהרדיוס בחר, ואם הרדיוס לא הגביל (או לא רץ -
    -- נכס בלי פין) אז ±1, השלב הרופף ביותר שעדיין מסנן. נכס בלי מספר
    -- חדרים - בלי סינון, ואז גם אין מה לומר על חדרים.
    v_hood_band := case when v_subject_rooms is null then null
                        else coalesce(v_used_band, 1) end;

    select coalesce(jsonb_agg((to_jsonb(c) - 'rn' - 'total') order by c.sold_at desc), '[]'::jsonb),
           coalesce(max(c.total), 0)
      into v_hood_comps, v_hood_total
      from (
        select h.*, row_number() over (order by h.sold_at desc) as rn,
               count(*) over () as total
          from (
            select o.id, o.property_type, nullif(o.rooms, 0) as rooms, o.sale_price, o.sold_at,
                   o.size_sqm, o.source, 'official'::text as price_basis,
                   case when o.size_sqm > 0 then round(o.sale_price / o.size_sqm) end as price_per_sqm,
                   -- שם שמכסה כמה שכונות (כינוי משותף, "הדר"): העסקה אינה
                   -- ממוקמת בשכונה הזו דווקא, והתצוגה אומרת זאת.
                   (cardinality(o.neighborhood_ids) > 1) as shared_neighborhood,
                   coalesce(public.property_type_class(o.property_type)
                            = public.property_type_class(v_prop.property_type), false) as same_type,
                   coalesce(public.property_type_class(o.property_type)
                              = public.property_type_class(v_prop.property_type)
                            and (v_hood_band is null
                                 or abs(nullif(o.rooms, 0) - v_subject_rooms) <= v_hood_band), false) as in_stats
              from public.market_deals_official o
             where v_hood_id = any(o.neighborhood_ids)
               and o.lat is null
               and o.sold_at >= v_cutoff
          ) h
      ) c
     where c.rn <= v_city_limit;

    select count(*) into v_hood_in
      from public.market_deals_official o
     where v_hood_id = any(o.neighborhood_ids)
       and o.lat is null
       and o.sold_at >= v_cutoff
       and coalesce(public.property_type_class(o.property_type)
                      = public.property_type_class(v_prop.property_type)
                    and (v_hood_band is null
                         or abs(nullif(o.rooms, 0) - v_subject_rooms) <= v_hood_band), false);

    -- אותה השתקה בדיוק כמו ב-stats: מתחת ל-cma_min_comparables אין חציון,
    -- רק השורות. החציון על **כל** השורות שנספרות, לא רק על המוצגות.
    if v_hood_in >= v_min_comps then
      select jsonb_build_object(
               'count',                count(*),
               'median_price',         round(percentile_cont(0.5) within group (order by o.sale_price)::numeric),
               'min_price',            min(o.sale_price),
               'max_price',            max(o.sale_price),
               'median_price_per_sqm', round(percentile_cont(0.5) within group (
                                          order by o.sale_price / o.size_sqm)
                                          filter (where o.size_sqm > 0)::numeric),
               'sqm_sample_size',      count(*) filter (where o.size_sqm > 0),
               'rooms_band',           v_hood_band
             )
        into v_hood_stats
        from public.market_deals_official o
       where v_hood_id = any(o.neighborhood_ids)
         and o.lat is null
         and o.sold_at >= v_cutoff
         and coalesce(public.property_type_class(o.property_type)
                        = public.property_type_class(v_prop.property_type)
                      and (v_hood_band is null
                           or abs(nullif(o.rooms, 0) - v_subject_rooms) <= v_hood_band), false);
    end if;
  end if;

  -- עסקאות באותה עיר שאי אפשר למקם — מוחזרות בנפרד, לא מעורבבות ברדיוס
  -- ולא נכנסות לסטטיסטיקה. מה שכבר מוצג בשכבת השכונה אינו חוזר כאן.
  select coalesce(jsonb_agg((to_jsonb(c) - 'rn') order by c.sold_at desc), '[]'::jsonb),
         max(c.total)
    into v_city_comps, v_city_n
    from (
      select w.*, row_number() over (order by w.sold_at desc) as rn,
             count(*) over () as total
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
         and (v_hood_id is null or not (v_hood_id = any(coalesce(o.neighborhood_ids, '{}'::uuid[]))))
        ) w
    ) c
   where c.rn <= v_city_limit;

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
             -- השטח הממוצע של ההשוואות: זה מה שמסביר פער כולל שרחוק
             -- מהפער למ"ר, ובלעדיו שורת ההסבר טוענת בלי להראות.
             'avg_size_sqm',         round(avg((x->>'size_sqm')::numeric) filter (where x->>'size_sqm' is not null)),
             'sqm_sample_size',      count(*) filter (where x->>'price_per_sqm' is not null),
             'same_type_count',      count(*) filter (where (x->>'same_type')::boolean),
             'rooms_band',           v_used_band,
             'asking_basis_count',   count(*) filter (where x->>'price_basis' = 'asking'),
             'official_basis_count', count(*) filter (where x->>'price_basis' = 'official')
           )
      into v_stats
      from jsonb_array_elements(v_comps) x
     where (x->>'in_stats')::boolean;
  else
    v_stats := jsonb_build_object('comparables_count', v_n, 'sample_too_small', true);
  end if;

  select count(*) into v_asking_n
    from jsonb_array_elements(v_comps || v_city_comps || v_hood_comps) x
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
        from jsonb_array_elements(v_comps || v_city_comps || v_hood_comps) x
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
      'features', to_jsonb(coalesce(v_prop.features, '{}'::text[])),
      'lat', v_prop.lat, 'lng', v_prop.lng
    ),
    'planning', v_planning,
    'radius_meters_used', v_used_radius,
    'radius_exhausted', (v_used_radius is not null and v_n < v_min_comps),
    'comparables', v_comps,
    'city_comparables', v_city_comps,
    -- שכבת השוק. **מחירים מבוקשים**, ולכן היא לעולם אינה נוגעת ב-stats.
    'market_comparables', v_market_comps,
    'market_stats', v_market_stats,
    -- שכבת השכונה. עסקאות רשמיות בלי פין; **לעולם אינה נוגעת ב-stats**.
    'neighborhood_comparables', v_hood_comps,
    'neighborhood_stats', v_hood_stats,
    'stats', v_stats,
    'data_coverage', jsonb_build_object(
      'status',             v_coverage,
      'comparables_found',  v_n,
      'comparables_in_radius', v_n_all,
      'comparables_same_type', v_n_class,
      'excluded_other_type', greatest(v_n_all - v_n_class, 0),
      -- מה שנשאר בחוץ בגלל מספר החדרים. דוח שמשתיק נתונים חייב לומר
      -- שהשתיק, בדיוק כמו excluded_other_type שלידו.
      'excluded_other_rooms', case when v_used_band is null then 0
                                   else greatest(v_n_class - v_n, 0) end,
      'subject_rooms',      v_subject_rooms,
      'rooms_band',         v_used_band,
      'rooms_band_reason',  v_band_reason,
      'similar_radius_meters', v_similar_max,
      'min_required',       v_min_comps,
      'max_deal_age_months',v_max_age,
      'oldest_considered',  v_cutoff,
      'asking_basis_count', v_asking_n,
      'city_comparables_total', coalesce(v_city_n, 0),
      'city_comparables_shown', jsonb_array_length(v_city_comps),
      'has_statistics',     (v_coverage = 'ok'),
      -- שכבת השוק מדווחת את עצמה באותה מידה: כמה יש, כמה תואמים
      -- במאפיינים, על מה החציון נשען, וכמה מאפיינים בכלל רשומים לנכס.
      'market_comparables_total', v_market_n,
      'market_comparables_shown', jsonb_array_length(v_market_comps),
      'market_feature_matched',   v_market_feat_n,
      'market_band_reason',       v_market_reason,
      'market_radius_meters',     v_market_radius,
      'min_market_required',      v_min_market,
      'feature_match_min',        v_feat_min,
      'subject_features_counted', v_subject_feat_n,
      'has_market_statistics',    (v_market_stats is not null),
      'neighborhood_id',                 v_hood_id,
      'neighborhood_name',               v_hood_name,
      'neighborhood_comparables_total',  v_hood_total,
      'neighborhood_comparables_shown',  jsonb_array_length(v_hood_comps),
      'neighborhood_comparables_counted', v_hood_in,
      'neighborhood_rooms_band',         v_hood_band,
      'neighborhood_shared_count',       (select count(*) from jsonb_array_elements(v_hood_comps) x
                                           where (x->>'shared_neighborhood')::boolean),
      'has_neighborhood_statistics',     (v_hood_stats is not null)
    ),
    'sources', v_sources
  );
end;
$$;

