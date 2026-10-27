-- ============================================================================
-- supabase/migrations/20271028090000_city_aliases_settlements_coverage.sql
--
-- Settlement names, agent coverage by member markets, and the Jordan Valley
-- (עמק הירדן) localities moved from market 'tiberias' to 'beit-shean'.
--
-- Version: above main (20271027150000) and the open PRs
-- (20271027150050, 20271027150100, 20271027160000).
--
-- Why: scraped_lead_add -> city_id_for_name('אשדות יעקב') = null. CBS names
-- carry a qualifier ('אשדות יעקב (איחוד)'), the scraper sends the bare or
-- prefixed spoken form ('אשדות יעקב', 'קיבוץ גבת'), city_aliases was empty,
-- so city_id stayed null -> the lead was never routed or shown.
-- Separately, agent_works_city() ignored agency_members.service_markets
-- (agencies.service_markets is empty everywhere), so almost no agent
-- "worked" any locality outside its office's own city.
--
-- Idempotent: every statement can run twice with the same end state.
--   A. grants on city_aliases (revoke = no-op the second time)
--   B. aliases: insert ... on conflict (alias_key) do nothing
--   C/D. create or replace function + explicit grants
--   E. update ... where market_slug = 'tiberias' (0 rows the second time) + assert.
--      Empty cities, or none of the 17 muni_codes loaded: move and assert skipped.
--   F. scraped_leads backfill: only rows with city_id is null
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. city_aliases: no anon access, no writes for authenticated.
--    Writes = migrations only (no app code writes this table). RLS stays on;
--    the only policy is "platform admin manage city_aliases". The public read
--    path is city_id_for_name() (SECURITY DEFINER).
-- ---------------------------------------------------------------------------
revoke all on table public.city_aliases from anon;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.city_aliases from authenticated;   -- maintain: PG17 privilege, also held today
alter table public.city_aliases enable row level security;

-- ---------------------------------------------------------------------------
-- B1. Bare-name alias for every CBS "X (qualifier)" locality, derived from
--     public.cities (not hand-typed). Ambiguous pairs -> larger population
--     (same market in every pair that has one). Skipped:
--       * bare names that are already a real city: טמרה, טייבה, ח'ואלד, קרית יערים
--       * 'גת' and 'יקנעם' - their usual meaning is another city (B2).
--     Expected on prod data: 41 rows.
-- ---------------------------------------------------------------------------
with c as (
  select id, population,
         btrim(regexp_replace(name, '\s*\(.*$', '')) as bare
    from public.cities
   where active and name ~ '\('
), pick as (
  select distinct on (public.city_name_key(bare)) id, bare
    from c
   where nullif(bare, '') is not null
     and not exists (select 1 from public.cities x where x.name_key = public.city_name_key(c.bare))
     and public.city_name_key(bare) not in ('גת', 'יקנעם')
   order by public.city_name_key(bare), population desc nulls last, id
)
insert into public.city_aliases (city_id, alias)
select id, bare from pick
on conflict (alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- B2. Explicit spoken forms. Target matched by name_key (so 'קרית'/'קריית'
--     both work). Never shadows a real city name.
-- ---------------------------------------------------------------------------
insert into public.city_aliases (city_id, alias)
select c.id, v.alias
  from (values
          -- qualifier written without parentheses
          ('אשדות יעקב איחוד', 'אשדות יעקב (איחוד)'),
          ('אשדות יעקב מאוחד', 'אשדות יעקב (מאוחד)'),
          ('עין חרוד איחוד',   'עין חרוד (איחוד)'),
          ('עין חרוד מאוחד',   'עין חרוד (מאוחד)'),
          ('גבעת חיים איחוד',  'גבעת חיים (איחוד)'),
          ('גבעת חיים מאוחד',  'גבעת חיים (מאוחד)'),
          ('מרחביה קיבוץ',     'מרחביה (קיבוץ)'),
          ('מרחביה מושב',      'מרחביה (מושב)'),
          ('כנרת קבוצה',       'כנרת (קבוצה)'),
          ('קבוצת כנרת',       'כנרת (קבוצה)'),
          ('כנרת מושבה',       'כנרת (מושבה)'),
          ('מושבת כנרת',       'כנרת (מושבה)'),
          -- the name inside the parentheses is the other official name
          ('תל עמל',           'ניר דוד (תל עמל)'),
          ('אבן יצחק',         'גלעד (אבן יצחק)'),
          ('זרעית',            'כפר רוזנואלד (זרעית)'),
          ('לי און',           'שריגים (לי-און)'),
          ('גוש חלב',          'ג''ש (גוש חלב)'),
          ('בוקייעה',          'פקיעין (בוקייעה)'),
          -- usual meaning ('קיבוץ גת' still reaches גת (קיבוץ) via C;
          -- 'יקנעם מושבה' / 'מושבה יקנעם' reach יקנעם (מושבה))
          ('יקנעם',            'יקנעם עילית'),
          ('גת',               'קרית גת')
       ) as v(alias, city_name)
  join public.cities c on c.name_key = public.city_name_key(v.city_name) and c.active
 where not exists (select 1 from public.cities x where x.name_key = public.city_name_key(v.alias))
on conflict (alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- C. city_id_for_name(): same signature, SECURITY DEFINER, search_path = ''.
--    Priority (explicit, never union order):
--      1 exact name            2 alias
--      3 prefix -> qualifier   'קיבוץ מרחביה' -> 'מרחביה (קיבוץ)',
--                              'מושב בן שמן' -> 'בן שמן (מושב)', 'קיבוץ גת' -> 'גת (קיבוץ)'
--      4 stripped name         'קיבוץ גבת' -> 'גבת', 'דגניה ב'' (קיבוץ)' -> 'דגניה ב'''
--      5 stripped alias        'קיבוץ אשדות יעקב' -> 'אשדות יעקב' -> alias
--    Stripped: a leading הקיבוץ/קיבוץ/מושבה/מושבת/מושב/היישוב/יישוב/ישוב + space,
--    and a trailing "(...)". 'קבוצת' is NOT stripped ('קבוצת יבנה' is a CBS name),
--    nor 'כפר', 'נווה', 'גבעת' etc. A stripped form never overrides an
--    exact or alias match of the full input.
-- ---------------------------------------------------------------------------
create or replace function public.city_id_for_name(p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with i as (
    select btrim(coalesce(p_name, '')) as s
  ), p as (
    select i.s,
           (regexp_match(i.s, '^(הקיבוץ|קיבוץ|מושבה|מושבת|מושב|היישוב|יישוב|ישוב)\s+(.+)$')) as m
      from i
  ), r as (
    select public.city_name_key(p.s) as k1,
           p.m[1] as pfx,
           btrim(regexp_replace(coalesce(p.m[2], p.s), '\s*\([^)]*\)\s*$', '')) as rest
      from p
  ), k as (
    select r.k1,
           public.city_name_key(r.rest) as k2,
           case
             when r.pfx in ('הקיבוץ', 'קיבוץ') then array[r.rest || ' (קיבוץ)', r.rest || ' (קבוצה)']
             when r.pfx = 'מושב'                then array[r.rest || ' (מושב)', r.rest || ' (מושבה)']
             when r.pfx in ('מושבה', 'מושבת')  then array[r.rest || ' (מושבה)', r.rest || ' (מושב)']
             when r.pfx is not null            then array[r.rest || ' (יישוב)']
             else '{}'::text[]
           end as typed
      from r
  )
  select id from (
    select c.id, 1 as pri, 0 as ord
      from k join public.cities c on c.active and c.name_key = k.k1
    union all
    select a.city_id, 2, 0
      from k join public.city_aliases a on a.alias_key = k.k1
             join public.cities c on c.id = a.city_id and c.active
    union all
    select c.id, 3, t.ord::int
      from k cross join lateral unnest(k.typed) with ordinality as t(name, ord)
             join public.cities c on c.active and c.name_key = public.city_name_key(t.name)
    union all
    select c.id, 4, 0
      from k join public.cities c on c.active and c.name_key = k.k2
     where k.k2 <> '' and k.k2 is distinct from k.k1
    union all
    select a.city_id, 5, 0
      from k join public.city_aliases a on a.alias_key = k.k2
             join public.cities c on c.id = a.city_id and c.active
     where k.k2 <> '' and k.k2 is distinct from k.k1
  ) m
  order by pri, ord
  limit 1;
$$;
comment on function public.city_id_for_name(text) is
  'שם -> cities.id. עדיפות: שם קנוני, כינוי (city_aliases), קידומת כסוג היישוב (קיבוץ X -> X (קיבוץ)), ואז השם בלי קידומת (קיבוץ/מושב/מושבה/יישוב) ובלי סוגריים בסוף - שם ואז כינוי. קבוצת אינה מוסרת. 20271028090000';
-- same grants as prod today
revoke all on function public.city_id_for_name(text) from public;
grant execute on function public.city_id_for_name(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. agent_works_city(): also the member's own service_markets, like
--    agent_share_fit() (member || agency markets). Only the agent's OWN row
--    (m.id = p_agent) counts - never a colleague's markets, so office
--    isolation is unchanged; it widens which cities the agent works, and
--    touches no agency-owned data. Callers: open_demand_list/_stats/_claim,
--    scraped_lead_notify_demand, scraped_lead_set_consent - all over the
--    anonymous scraped_leads pool.
-- ---------------------------------------------------------------------------
create or replace function public.agent_works_city(p_agent uuid, p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_city_id is not null and exists (
    select 1
      from public.agency_members m
      join public.agencies a on a.id = m.agency_id
      left join public.cities c on c.id = p_city_id
     where m.id = p_agent and m.active
       and (a.city_id = p_city_id
            or (c.market_slug is not null
                and c.market_slug = any (coalesce(a.service_markets, '{}') || coalesce(m.service_markets, '{}')))
            or exists (select 1
                         from public.agent_lead_preferences lp
                         join public.neighborhoods n on n.id = any (lp.preferred_neighborhoods)
                        where lp.agent_id = m.id and lp.active and n.city_id = p_city_id))
  );
$$;
comment on function public.agent_works_city(uuid, uuid) is
  'הסוכן/ת עובד/ת בעיר: עיר המשרד, השוק של העיר בשווקים של המשרד או של הסוכן/ת עצמו/ה (agency_members.service_markets), או שכונה בהעדפות הלידים. 20271028090000';
revoke all on function public.agent_works_city(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_works_city(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- E. Jordan Valley (עמק הירדן, south of the Kinneret) -> market 'beit-shean'.
--    Anchored on muni_code (CBS locality code) AND name, from 'tiberias' only.
--    15 = Emek HaYarden Regional Council localities south / south-east of the
--    lake; גשר and מנחמיה = Emek HaMa'ayanot RC (the rest of which is already
--    beit-shean). Stay in 'tiberias': טבריה, יבנאל, מגדל, the north/west shore
--    (גינוסר, אלמגור, חוקוק, רביד, ארבל...), the three פוריה, Lower Galilee.
--    No slug, URL, area or neighborhood changes. Both markets are not live.
--    The statement trigger cities_deal_settlements runs
--    deal_settlements_sync_cities() - a no-op (all 17 already have a settlement).
--    A fresh branch or dev database has no city rows (or none of these
--    muni_codes). There the move is a no-op and the count assert is skipped.
--    When any of the 17 codes is loaded, the move runs and the assert stays
--    strict: exactly 17 in beit-shean, and טבריה stays in tiberias.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cities int;
  v_codes int;
  v_n int;
begin
  select count(*) into v_cities from public.cities;
  select count(*) into v_codes
    from public.cities
   where muni_code in ('48','57','62','63','79','143','176','188','199','263','264','273','305','330','678','702','719');

  -- no catalog, or this batch is not in it: nothing to move and nothing to prove
  if v_cities = 0 or v_codes = 0 then
    return;
  end if;

  update public.cities c
     set market_slug = 'beit-shean'
    from (values ('48',  'מנחמיה'),
                 ('57',  'כנרת (קבוצה)'),
                 ('62',  'דגניה א'''),
                 ('63',  'כנרת (מושבה)'),
                 ('79',  'דגניה ב'''),
                 ('143', 'בית זרע'),
                 ('176', 'אפיקים'),
                 ('188', 'אשדות יעקב (מאוחד)'),
                 ('199', 'אשדות יעקב (איחוד)'),
                 ('263', 'מסדה'),
                 ('264', 'שער הגולן'),
                 ('273', 'עין גב'),
                 ('305', 'גשר'),
                 ('330', 'אלומות'),
                 ('678', 'מעגן'),
                 ('702', 'האון'),
                 ('719', 'תל קציר')) as v(muni_code, name)
   where c.muni_code = v.muni_code
     and c.name_key = public.city_name_key(v.name)
     and c.market_slug = 'tiberias';

  select count(*) into v_n
    from public.cities
   where market_slug = 'beit-shean'
     and muni_code in ('48','57','62','63','79','143','176','188','199','263','264','273','305','330','678','702','719');
  if v_n <> 17 then
    raise exception 'jordan valley move: expected 17 localities in beit-shean, found %', v_n;
  end if;
  if exists (select 1 from public.cities where name_key = public.city_name_key('טבריה') and market_slug is distinct from 'tiberias') then
    raise exception 'jordan valley move: טבריה must stay in tiberias';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- F. Backfill scraped_leads.city_id (safe here: one indexed update, no
--    triggers on scraped_leads, only rows still null, re-run = 0 rows).
--    demand_notified_at stays null, so the hourly cron scraped-leads-lifecycle
--    (minute 29) runs scraped_lead_notify_demand for rows still open.
--    properties is NOT backfilled here (21 triggers, batched function):
--    see the service_role script at the end of this file.
-- ---------------------------------------------------------------------------
update public.scraped_leads s
   set city_id = public.city_id_for_name(s.city)
 where s.city_id is null
   and public.city_id_for_name(s.city) is not null;

-- ============================================================================
-- SERVICE_ROLE SCRIPT (separate, not part of the migration; SQL editor):
--   properties.city_id - 21 triggers on properties, so batched via the
--   existing function, repeated until it returns 0. Today: 7 null rows
--   ('אזור השרון' x6, 'צומת כנות' x1) - not localities, expected 0 updates.
--
--   select public.properties_backfill_city_id(500);   -- repeat until 0
--
--   verify:
--   select public.city_id_for_name('אשדות יעקב'), public.city_id_for_name('קיבוץ גבת'),
--          public.city_id_for_name('קבוצת יבנה'), public.city_id_for_name('גת');
--   select id, city, city_id from public.scraped_leads
--    where id = '3b506e78-08e1-47ed-bcc7-67592fe77d57';
--   select count(*) from public.scraped_leads where city_id is null;   -- expect 0
-- ============================================================================
