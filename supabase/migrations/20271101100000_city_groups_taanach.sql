-- ============================================================================
-- קבוצות יישובים בחיפוש. חבל תענך הוא הראשונה: 12 יישובים, שם אחד.
--
-- החיפוש פתר שם אחד לעיר אחת (city_id_for_name, city_aliases). "תענכים"
-- אינו שם של עיר, ולכן דירה באומן לא עלתה בחיפוש "חבל תענך" - לא באתר,
-- לא ב-CRM, לא אצל גבריאלה ולא בהתאמה ללקוח/ה.
--
-- כאן הקבוצה נשמרת כשם אחד (כדי לא לפרוץ את תקרת 8 הערים), וההרחבה
-- ליישובים נעשית בזמן ההתאמה. חברים לפי muni_code או לפי שם, לא לפי id
-- קשיח. כינויי עיר שכבר בפרודקשן (מרכז אומן, מרכז חבר, מרכז יעל, גדש,
-- מלא'ה) נכנסים כאן גם כן, on conflict do nothing.
--
-- העטיפה client_property_match בשני ארגומנטים קוראת לגרסה של שלושה,
-- ולכן ההרחבה חלה על שתיהן בלי לכתוב את הגוף פעמיים.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- טבלאות. קריאה פומבית, כתיבה רק ממיגרציה (כמו city_aliases): אין grant
-- לכתיבה ואין policy של כתיבה. RLS דלוק.
-- ---------------------------------------------------------------------------
create table if not exists public.city_groups (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.city_group_members (
  group_id uuid not null references public.city_groups(id) on delete cascade,
  city_id  uuid not null references public.cities(id) on delete cascade,
  primary key (group_id, city_id)
);

create table if not exists public.city_group_aliases (
  group_id  uuid not null references public.city_groups(id) on delete cascade,
  alias     text not null,
  alias_key text generated always as (public.city_name_key(alias)) stored unique
);

comment on table public.city_groups is
  'קבוצת יישובים שנחיפשת כשם אחד (חבל תענך). החברים ב-city_group_members.';
comment on table public.city_group_members is
  'יישוב בקבוצה. מפתח (group_id, city_id). נפתר לפי muni_code או שם, לא לפי id קשיח.';
comment on table public.city_group_aliases is
  'שם שגולש/ת כותב/ת לקבוצה. alias_key ייחודי, ולא מתנגש עם שם עיר או עם city_aliases.';

alter table public.city_groups enable row level security;
alter table public.city_group_members enable row level security;
alter table public.city_group_aliases enable row level security;

revoke all on table public.city_groups, public.city_group_members, public.city_group_aliases
  from public, anon, authenticated;
grant select on table public.city_groups, public.city_group_members, public.city_group_aliases
  to anon, authenticated, service_role;

drop policy if exists city_groups_select on public.city_groups;
create policy city_groups_select on public.city_groups
  for select to anon, authenticated
  using (active);

drop policy if exists city_group_members_select on public.city_group_members;
create policy city_group_members_select on public.city_group_members
  for select to anon, authenticated
  using (exists (
    select 1 from public.city_groups g
     where g.id = group_id and g.active
  ));

drop policy if exists city_group_aliases_select on public.city_group_aliases;
create policy city_group_aliases_select on public.city_group_aliases
  for select to anon, authenticated
  using (exists (
    select 1 from public.city_groups g
     where g.id = group_id and g.active
  ));

-- ---------------------------------------------------------------------------
-- כינויי עיר שכבר הוכנסו לפרודקשן ב-2026-11-01. אותו מפתח, בלי לדרוס.
-- ---------------------------------------------------------------------------
insert into public.city_aliases (city_id, alias)
select c.id, v.alias
  from (values
    ('מרכז אומן', 'אומן'),
    ('מרכז חבר', 'חבר'),
    ('מרכז יעל', 'יעל'),
    ('גדש', 'גדיש'),
    ('מלא''ה', 'מלאה')
  ) as v(alias, city_name)
  join public.cities c
    on c.name_key = public.city_name_key(v.city_name) and c.active
 where not exists (
   select 1 from public.cities x
    where x.name_key = public.city_name_key(v.alias)
 )
on conflict (alias_key) do nothing;

insert into public.city_groups (slug, name)
values ('taanach', 'חבל תענך')
on conflict (slug) do update
  set name = excluded.name,
      active = true;

-- כינוי קבוצה לא דורס שם של עיר ולא כינוי עיר קיים.
do $$
declare
  bad text;
begin
  select string_agg(v.alias, ', ' order by v.alias) into bad
    from (values
      ('תענכים'),
      ('התענכים'),
      ('חבל תענך'),
      ('תענך'),
      ('יישובי תענך'),
      ('ישובי תענך'),
      ('גוש תענך'),
      ('אזור תענך')
    ) as v(alias)
   where exists (
           select 1 from public.cities c
            where c.name_key = public.city_name_key(v.alias)
         )
      or exists (
           select 1 from public.city_aliases a
            where a.alias_key = public.city_name_key(v.alias)
         );
  if bad is not null then
    raise exception 'city group alias collides with a city or city alias: %', bad;
  end if;
end $$;

insert into public.city_group_aliases (group_id, alias)
select g.id, v.alias
  from public.city_groups g
  cross join (values
    ('תענכים'),
    ('התענכים'),
    ('חבל תענך'),
    ('תענך'),
    ('יישובי תענך'),
    ('ישובי תענך'),
    ('גוש תענך'),
    ('אזור תענך')
  ) as v(alias)
 where g.slug = 'taanach'
on conflict (alias_key) do nothing;

insert into public.city_group_members (group_id, city_id)
select distinct g.id, c.id
  from public.city_groups g
  join public.cities c
    on c.active
   and (
     c.muni_code in (
       '2052', '113', '141', '145', '146', '164',
       '2054', '1108', '1110', '1117', '165', '2053'
     )
     or c.name in (
       'אביטל', 'אדירים', 'ברק', 'גדיש', 'דבורה', 'מלאה',
       'מיטב', 'אומן', 'חבר', 'יעל', 'ניר יפה', 'פרזון'
     )
   )
 where g.slug = 'taanach'
on conflict (group_id, city_id) do nothing;

do $$
declare
  n int;
begin
  select count(*) into n
    from public.city_group_members m
    join public.city_groups g on g.id = m.group_id
   where g.slug = 'taanach';
  if n <> 12 then
    raise exception 'taanach group has % members, expected 12', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- שם -> מזהי ערים. קבוצה קודמת לעיר אחת. בלי התאמה: מערך ריק.
-- ---------------------------------------------------------------------------
create or replace function public.city_ids_for_name(p_name text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with hit as (
    select m.city_id
      from public.city_group_aliases a
      join public.city_groups g on g.id = a.group_id and g.active
      join public.city_group_members m on m.group_id = g.id
      join public.cities c on c.id = m.city_id and c.active
     where a.alias_key = public.city_name_key(p_name)
  )
  select ids
    from (
      select array_agg(h.city_id order by h.city_id) as ids, 1 as pri
        from hit h
      union all
      select case
               when public.city_id_for_name(p_name) is null then '{}'::uuid[]
               else array[public.city_id_for_name(p_name)]
             end,
             2
    ) m
   where ids is not null
   order by pri
   limit 1;
$$;

comment on function public.city_ids_for_name(text) is
  'שם -> מזהי ערים. כינוי של קבוצה פעילה מחזיר את חבריה (יציב לפי id). אחרת מערך של city_id_for_name, או מערך ריק.';

revoke all on function public.city_ids_for_name(text) from public, anon, authenticated;
grant execute on function public.city_ids_for_name(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- מה האתר טוען יחד עם כינויי השכונות: שם הקבוצה, הכינויים, ושמות החברים.
-- ---------------------------------------------------------------------------
create or replace function public.city_groups_public()
returns table (name text, aliases text[], member_names text[])
language sql
stable
security definer
set search_path = ''
as $$
  select g.name,
         coalesce((
           select array_agg(a.alias order by a.alias)
             from public.city_group_aliases a
            where a.group_id = g.id
         ), '{}'::text[]),
         coalesce((
           select array_agg(c.name order by c.name)
             from public.city_group_members m
             join public.cities c on c.id = m.city_id and c.active
            where m.group_id = g.id
         ), '{}'::text[])
    from public.city_groups g
   where g.active
   order by g.name;
$$;

comment on function public.city_groups_public() is
  'קבוצות יישובים פעילות: שם, כינויים, ושמות היישובים. לקריאה מהאתר ומה-CRM.';

revoke all on function public.city_groups_public() from public, anon, authenticated;
grant execute on function public.city_groups_public() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- client_property_match: הגוף מ-20271031140000, והרחבת ערי הלקוח/ה.
-- הגרסה בשני ארגומנטים היא עטיפה ולא נכתבת מחדש.
-- ---------------------------------------------------------------------------
create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
stable
as $$
  with feats as (
    -- מה שיש בנכס. ממ״ד מסחרי יושב ב-mamad_location ולא במערך
    select coalesce(p_property.features, '{}'::text[])
           || case when p_property.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end
           -- מרפסת שמש היא מרפסת: 13 מודעות פעילות מסמנות רק sun_balcony (14.10.2026)
           || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                   then array['balcony'] else '{}'::text[] end
           as have
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(feats.have)) as feats
      from feats
  ),
  -- city_id_for_name פעם אחת לנכס ופעם אחת לכל עיר של הלקוח/ה, לא בכל תנאי.
  prop_city as materialized (
    select public.city_id_for_name(p_property.city) as id
  ),
  client_cities as materialized (
    -- כינוי של קבוצה (תענכים) מתרחב ליישובים. שם בלי התאמה נשאר שורה עם id ריק,
    -- כדי שהשוואת הטקסט הישנה לא תיעלם.
    select c.name, u.id
      from unnest(coalesce(p_client.cities, '{}'::text[])) c(name)
      left join lateral unnest(public.city_ids_for_name(c.name)) as u(id) on true
  ),
  hood as materialized (
    select hn.city, hn.city_id, public.city_id_for_name(hn.city) as city_name_id
      from public.neighborhoods hn
     where hn.id = p_client.neighborhood_id
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        -- נכס פרטי: רק הלקוחות של מי שמחזיק/ה בו
        and (p_property.share_level is distinct from 'private'
             or p_property.agent_id = p_client.agent_id)
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0
             or exists (
               select 1 from client_cities c
                where c.name = p_property.city
                   or (p_property.city_id is not null and p_property.city_id = c.id)
                   or (c.id is not null and (select id from prop_city) is not null
                       and c.id = (select id from prop_city))
             ))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        -- שכונה: ריקה, חסרה, או שלא שייכת לאף עיר - לא מסתירה. שייכת - רק בעיר שלה.
        -- שכונה ריקה במודעה היא "לא ידוע" ועוברת, עם הורדת ציון למטה.
        and (
          p_client.neighborhood_id is null
          or not exists (select 1 from hood)
          or (
            cardinality(p_client.cities) > 0
            and not exists (
              select 1 from hood hn, client_cities c
               where c.name = hn.city
                  or (hn.city_id is not null and hn.city_id = c.id)
                  or (c.id is not null and hn.city_name_id is not null and c.id = hn.city_name_id)
            )
          )
          or exists (
            select 1 from hood hn
             where not (
               (p_property.city_id is not null and hn.city_id is not null
                and p_property.city_id = hn.city_id)
               or p_property.city = hn.city
               or ((select id from prop_city) is not null
                   and hn.city_name_id is not null
                   and (select id from prop_city) = hn.city_name_id)
             )
          )
          or p_property.neighborhood_id = p_client.neighborhood_id
          or p_property.neighborhood_id is null
        )
        and (p_client.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_client.max_price * 1.10)
        and (p_client.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
        -- כיוון אוויר וסלון הם ניקוד רך, לא שער. נתון חסר אינו מסתיר נכס.
           ) as passes
      from miss
  )
  select
    least(100, greatest(0, 100
      - case when p_client.max_price is not null and coalesce(p_property.price_total, p_property.price) > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and coalesce(p_property.price_total, p_property.price) < p_client.min_price then 5  else 0 end
      - case when p_client.min_size_sqm is not null
              and (p_property.size_sqm is null or p_property.size_sqm < p_client.min_size_sqm) then 10 else 0 end
      - case when p_client.max_size_sqm is not null and p_client.min_size_sqm is null
              and p_property.size_sqm is null then 10 else 0 end
      - case when p_client.max_floor is not null
              and p_property.floor is not null and p_property.floor > p_client.max_floor then 10 else 0 end
      - case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
             then 5 else 0 end
      - case when cardinality(coalesce(p_client.required_directions, '{}'::text[])) > 0
              and (p_property.air_directions is null or cardinality(p_property.air_directions) = 0)
             then 5 else 0 end
      - least(16, 8 * coalesce((
          select count(*)::int
            from unnest(coalesce(p_client.required_directions, '{}'::text[])) as missing(dir)
           where p_property.air_directions is not null
             and cardinality(p_property.air_directions) > 0
             and not (missing.dir = any(p_property.air_directions))
        ), 0))
      - case when p_client.min_air_directions is not null
              and p_property.air_directions is not null
              and cardinality(p_property.air_directions) > 0
              and cardinality(p_property.air_directions) < p_client.min_air_directions
             then 10 else 0 end
      - case when p_client.min_air_directions is not null
              and (p_property.air_directions is null or cardinality(p_property.air_directions) = 0)
              and cardinality(coalesce(p_client.required_directions, '{}'::text[])) = 0
             then 5 else 0 end
      - case when p_client.min_living_room_sqm is not null and p_property.living_room_sqm is null
             then 5 else 0 end
      - case when p_client.min_living_room_sqm is not null
              and p_property.living_room_sqm is not null
              and p_property.living_room_sqm < p_client.min_living_room_sqm
             then 10 else 0 end
      - case when p_client.neighborhood_id is not null
              and p_property.neighborhood_id is null
              and exists (
                select 1 from hood hn
                 where (p_property.city_id is not null and hn.city_id is not null
                        and p_property.city_id = hn.city_id)
                    or p_property.city = hn.city
                    or ((select id from prop_city) is not null
                        and hn.city_name_id is not null
                        and (select id from prop_city) = hn.city_name_id)
              )
             then 8 else 0 end
      - least(24, 8 * cardinality(miss.feats))
      + least(12, 4 * (
          select count(*)::int
            from unnest(coalesce(p_client.preferred_features, '{}'::text[])) pf
           where pf = any(feats.have)
        ))
    ))::int,
    array_remove(array[
      case when p_client.max_price is not null and coalesce(p_property.price_total, p_property.price) > p_client.max_price
           then 'מעל התקציב ב-' || round((coalesce(p_property.price_total, p_property.price) / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and coalesce(p_property.price_total, p_property.price) < p_client.min_price
           then 'מתחת לטווח המחירים שהוגדר' end,
      case when (p_client.min_size_sqm is not null or p_client.max_size_sqm is not null)
            and p_property.size_sqm is null
           then 'גודל הנכס לא מולא במודעה' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is not null
            and p_property.size_sqm < p_client.min_size_sqm
           then 'קטן מהמבוקש ב-' || round(p_client.min_size_sqm - p_property.size_sqm) || ' מ״ר' end,
      case when p_client.max_floor is not null and p_property.floor is not null
            and p_property.floor > p_client.max_floor
           then 'קומה ' || p_property.floor || ' - גבוה מהמבוקש' end,
      case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
           then 'מספר החדרים לא מולא במודעה' end,
      case when (cardinality(coalesce(p_client.required_directions, '{}'::text[])) > 0
                  or p_client.min_air_directions is not null)
            and (p_property.air_directions is null or cardinality(p_property.air_directions) = 0)
           then 'כיווני אוויר לא צוינו' end,
      case when cardinality(coalesce(p_client.required_directions, '{}'::text[])) > 0
            and p_property.air_directions is not null
            and cardinality(p_property.air_directions) > 0
            and exists (
              select 1 from unnest(p_client.required_directions) as missing(dir)
               where not (missing.dir = any(p_property.air_directions))
            )
           then 'בלי כיוון ' || (
             select string_agg(missing.dir, ', ' order by array_position(array['צפון','דרום','מזרח','מערב']::text[], missing.dir))
               from unnest(p_client.required_directions) as missing(dir)
              where not (missing.dir = any(p_property.air_directions))
           ) end,
      case when p_client.min_air_directions is not null
            and p_property.air_directions is not null
            and cardinality(p_property.air_directions) > 0
            and cardinality(p_property.air_directions) < p_client.min_air_directions
           then cardinality(p_property.air_directions)::text || ' כיווני אוויר מתוך ' || p_client.min_air_directions::text || ' שביקשו' end,
      case when p_client.min_living_room_sqm is not null and p_property.living_room_sqm is null
           then 'גודל הסלון לא צוין' end,
      case when p_client.min_living_room_sqm is not null and p_property.living_room_sqm is not null
            and p_property.living_room_sqm < p_client.min_living_room_sqm
            and round(p_client.min_living_room_sqm - p_property.living_room_sqm, 1) > 0
           then 'הסלון קטן מהמבוקש ב-' || rtrim(trim(to_char(p_client.min_living_room_sqm - p_property.living_room_sqm, 'FM990.9')), '.') || ' מ״ר' end,
      case when p_client.neighborhood_id is not null
            and p_property.neighborhood_id is null
            and exists (
              select 1 from hood hn
               where (p_property.city_id is not null and hn.city_id is not null
                      and p_property.city_id = hn.city_id)
                  or p_property.city = hn.city
                  or ((select id from prop_city) is not null
                      and hn.city_name_id is not null
                      and (select id from prop_city) = hn.city_name_id)
            )
           then 'שכונה לא מולאה במודעה' end
    ], null),
    miss.feats
  from gate, miss, feats
  where gate.passes;
$$;


alter function public.client_property_match(public.agent_clients, public.properties, text[])
  reset search_path;

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[])
  from public, anon, authenticated;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד. כיוון אוויר וסלון הם ניקוד רך: חסר כיוון נדרש -8 (עד -16), סלון מתחת למינימום -10, נתון חסר בנכס -5. אין שער קשיח. שם עיר שהוא כינוי של קבוצת יישובים מתאים לכל יישוב בקבוצה. העטיפה בשני ארגומנטים קוראת לכאן.';

-- ---------------------------------------------------------------------------
-- saved_search_matches: הגוף מ-20270827090000, ועוד התאמת city_id דרך הקבוצה.
-- stable, כי city_ids_for_name קוראת לטבלאות.
-- ---------------------------------------------------------------------------
create or replace function public.saved_search_matches(p_search public.saved_searches, p_property public.properties)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select
        p_property.status    = 'active'
    and p_property.deal_type = p_search.deal_type
    and p_property.category  = p_search.category
    and (
      (cardinality(p_search.cities) = 0 and cardinality(p_search.neighborhood_ids) = 0)
      or p_property.city = any(p_search.cities)
      or exists (
        select 1
          from unnest(coalesce(p_search.cities, '{}'::text[])) cn(name)
          cross join lateral (
            select public.city_ids_for_name(cn.name) as ids,
                   public.city_id_for_name(p_property.city) as prop_id
          ) g
         where (p_property.city_id is not null and p_property.city_id = any(g.ids))
            or (g.prop_id is not null and g.prop_id = any(g.ids))
      )
      or (p_property.neighborhood_id is not null
          and p_property.neighborhood_id = any(p_search.neighborhood_ids))
    )
    and (cardinality(p_search.property_types) = 0
         or p_property.property_type = any(p_search.property_types))
    and (p_search.max_price is null or coalesce(p_property.price_total, p_property.price) <= p_search.max_price)
    and (p_search.min_price is null or coalesce(p_property.price_total, p_property.price) >= p_search.min_price)
    and (p_search.min_rooms is null
         or (p_property.rooms is not null and p_property.rooms >= p_search.min_rooms))
    and (p_search.max_rooms is null
         or (p_property.rooms is not null and p_property.rooms <= p_search.max_rooms))
    and (p_search.min_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) >= p_search.min_size_sqm))
    and (p_search.max_size_sqm is null
         or (coalesce(p_property.size_sqm, p_property.area_sqm) is not null
             and coalesce(p_property.size_sqm, p_property.area_sqm) <= p_search.max_size_sqm))
    and (p_search.min_floor is null
         or (p_property.floor is not null and p_property.floor >= p_search.min_floor))
    and (p_search.max_floor is null
         or (p_property.floor is not null and p_property.floor <= p_search.max_floor))
    -- מה שיש בנכס: המערך, מרפסת שמש כמרפסת, וממ״ד מסחרי מעמודת המיקום
    -- (‏FEATURES ב-assets/search-core.js; אותו ביטוי ב-client_property_match)
    and (cardinality(p_search.required_features) = 0
         or p_search.required_features <@ (
              coalesce(p_property.features, '{}'::text[])
              || case when 'sun_balcony' = any(coalesce(p_property.features, '{}'::text[]))
                      then array['balcony'] else '{}'::text[] end
              || case when p_property.mamad_location = 'unit'
                      then array['mamad'] else '{}'::text[] end))
    and (p_search.condition is null or p_property.condition = p_search.condition);
$function$;


revoke all on function public.saved_search_matches(public.saved_searches, public.properties)
  from public, anon, authenticated;

comment on function public.saved_search_matches(public.saved_searches, public.properties) is
  'האם נכס עונה על חיפוש שמור. עיר שהיא כינוי של קבוצה מתאימה גם לפי city_id של כל יישוב בקבוצה.';

-- ---------------------------------------------------------------------------
-- scraped_lead_matches: הגוף מ-20271030210000. ערים נפתרות כמו בהתאמת הלקוח/ה.
-- ---------------------------------------------------------------------------
create or replace function public.scraped_lead_matches(p_id uuid)
returns table (
  agent_id uuid,
  score int,
  match_kind text,
  matched_client_ids uuid[],
  matched_property_ids uuid[],
  exact boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with lead as (
    select s.*
      from public.scraped_leads s
     where s.id = p_id
  ),
  seeker_rows as (
    select c.agent_id,
           c.id as client_id,
           null::uuid as property_id,
           (
             10
             + case when l.deal_type is not null and c.deal_type = l.deal_type then 10 else 0 end
             + case
                 when l.rooms is not null and (c.min_rooms is not null or c.max_rooms is not null)
                 then 25 else 0
               end
             + case
                 when l.budget is not null and c.max_price is not null
                  and l.budget <= c.max_price * 1.10
                 then 25 else 0
               end
           )::int as score,
           (
             l.deal_type is not null and c.deal_type = l.deal_type
             and l.rooms is not null and (c.min_rooms is not null or c.max_rooms is not null)
             and l.budget is not null and c.max_price is not null
             and l.budget <= c.max_price * 1.10
             and (c.min_price is null or l.budget >= c.min_price)
           ) as exact
      from lead l
      join public.agent_clients c
        on c.client_kind = 'seeker'
       and c.status = 'active'
     where l.lead_type = 'owner_inbound'
       and exists (
         select 1
           from unnest(c.cities) cn(name)
           cross join lateral (
             select public.city_ids_for_name(cn.name) as ids,
                    public.city_id_for_name(l.city) as lead_id
           ) g
          where btrim(cn.name) = btrim(l.city)
             or (l.city_id is not null and l.city_id = any(g.ids))
             or (g.lead_id is not null and g.lead_id = any(g.ids))
       )
       and (l.deal_type is null or c.deal_type = l.deal_type)
       and (
         l.rooms is null
         or (
           (c.min_rooms is null or l.rooms >= c.min_rooms - case when c.max_rooms is null then 1 else 0 end)
           and (c.max_rooms is null or l.rooms <= c.max_rooms + case when c.min_rooms is null then 1 else 0 end)
         )
       )
       and (
         l.budget is null or c.max_price is null or l.budget <= c.max_price * 1.10
       )
       and (
         l.budget is null or c.min_price is null or l.budget >= c.min_price
       )
    union all
    select ss.sold_to_agent_id,
           ss.id,
           null::uuid,
           (
             10
             + case when l.deal_type is not null and ss.deal_type = l.deal_type then 10 else 0 end
             + case
                 when l.rooms is not null and (ss.min_rooms is not null or ss.max_rooms is not null)
                 then 25 else 0
               end
             + case
                 when l.budget is not null and ss.max_price is not null
                  and l.budget <= ss.max_price * 1.10
                 then 25 else 0
               end
             + case
                 when l.neighborhood_id is not null
                  and l.neighborhood_id = any (ss.neighborhood_ids)
                 then 20 else 0
               end
           )::int,
           (
             l.deal_type is not null and ss.deal_type = l.deal_type
             and l.rooms is not null and (ss.min_rooms is not null or ss.max_rooms is not null)
             and l.budget is not null and ss.max_price is not null
             and l.budget <= ss.max_price * 1.10
             and (ss.min_price is null or l.budget >= ss.min_price)
           )
      from lead l
      join public.saved_searches ss
        on ss.sold_to_agent_id is not null
       and ss.status = 'active'
       and ss.lead_status = 'sold'
     where l.lead_type = 'owner_inbound'
       and (
         exists (
           select 1
             from unnest(ss.cities) cn(name)
             cross join lateral (
               select public.city_ids_for_name(cn.name) as ids,
                      public.city_id_for_name(l.city) as lead_id
             ) g
            where btrim(cn.name) = btrim(l.city)
               or (l.city_id is not null and l.city_id = any(g.ids))
               or (g.lead_id is not null and g.lead_id = any(g.ids))
         )
         or (l.neighborhood_id is not null and l.neighborhood_id = any (ss.neighborhood_ids))
       )
       and (l.deal_type is null or ss.deal_type = l.deal_type)
       and (
         l.rooms is null
         or (
           (ss.min_rooms is null or l.rooms >= ss.min_rooms - case when ss.max_rooms is null then 1 else 0 end)
           and (ss.max_rooms is null or l.rooms <= ss.max_rooms + case when ss.min_rooms is null then 1 else 0 end)
         )
       )
       and (
         l.budget is null or ss.max_price is null or l.budget <= ss.max_price * 1.10
       )
       and (
         l.budget is null or ss.min_price is null or l.budget >= ss.min_price
       )
  ),
  property_rows as (
    select p.agent_id,
           null::uuid as client_id,
           p.id as property_id,
           (
             10
             + case when l.deal_type is not null and p.deal_type = l.deal_type then 10 else 0 end
             + case
                 when l.rooms is not null and p.rooms is not null and abs(p.rooms - l.rooms) <= 1
                 then 25 else 0
               end
             + case
                 when l.budget is not null and p.price is not null and p.price <= l.budget * 1.15
                 then 25 else 0
               end
             + case
                 when l.neighborhood_id is not null and p.neighborhood_id = l.neighborhood_id
                 then 20 else 0
               end
           )::int as score,
           (
             l.deal_type is not null and p.deal_type = l.deal_type
             and l.rooms is not null and p.rooms is not null and abs(p.rooms - l.rooms) <= 1
             and l.budget is not null and p.price is not null and p.price <= l.budget * 1.15
           ) as exact
      from lead l
      join public.properties p on p.agent_id is not null
     where l.lead_type = 'seeker_inbound'
       and p.status = 'active'
       and (p.listing_expires_at is null or p.listing_expires_at >= current_date)
       and (
         (l.city_id is not null and p.city_id = l.city_id)
         or btrim(coalesce(p.city, '')) = btrim(l.city)
         or p.city_id = any(public.city_ids_for_name(l.city))
         or (
           public.city_id_for_name(p.city) is not null
           and public.city_id_for_name(p.city) = any(public.city_ids_for_name(l.city))
         )
       )
       and (l.deal_type is null or p.deal_type = l.deal_type)
       and (
         l.rooms is null or p.rooms is null or abs(p.rooms - l.rooms) <= 1
       )
       and (
         l.budget is null or p.price is null or p.price <= l.budget * 1.15
       )
  ),
  rows as (
    select * from seeker_rows
    union all
    select * from property_rows
  )
  select r.agent_id,
         max(r.score)::int,
         case
           when (select lead_type from lead) = 'owner_inbound' then 'has_seeker'
           else 'has_property'
         end,
         coalesce(
           (array_agg(r.client_id order by r.score desc, r.client_id)
              filter (where r.client_id is not null))[1:12],
           '{}'::uuid[]
         ),
         coalesce(
           (array_agg(r.property_id order by r.score desc, r.property_id)
              filter (where r.property_id is not null))[1:12],
           '{}'::uuid[]
         ),
         coalesce((array_agg(r.exact order by r.score desc))[1], false)
    from rows r
   where r.agent_id is not null
   group by r.agent_id;
$$;


comment on function public.scraped_lead_matches(uuid) is
  'התאמות של פוסט לסוכנים. בעלים: לקוח או חיפוש שמור של אותו/ה סוכן/ת. מחפש/ת: נכס פעיל שלא פג. שדה חסר בפוסט לא פוסל. עיר שהיא קבוצת יישובים מתאימה לכל חבר. docs/scraped-leads.md';

revoke all on function public.scraped_lead_matches(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_matches(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- crm_search: הגוף מ-20271031230000. נכסים ולידים גם לפי קבוצת יישובים.
-- ---------------------------------------------------------------------------
create or replace function public.crm_search(p_q text, p_limit int default 6)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_me     uuid := current_agent_id();
  v_q      text := btrim(coalesce(p_q, ''));
  v_lim    int  := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_like   text;
  v_key    text;
  v_digits text;
  v_phone  boolean;
  v_city_ids uuid[];
  v_out    jsonb;
begin
  if v_me is null or char_length(v_q) < 2 then
    return jsonb_build_object('q', v_q, 'counts',
      jsonb_build_object('clients', 0, 'props', 0, 'leads', 0, 'deals', 0),
      'clients', '[]'::jsonb, 'props', '[]'::jsonb, 'leads', '[]'::jsonb, 'deals', '[]'::jsonb);
  end if;

  v_q := left(v_q, 80);
  -- תווי LIKE מהקלט הם טקסט ולא תבנית
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_key := public.street_name_key(v_q);
  v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');
  if v_digits like '972%' then v_digits := '0' || substr(v_digits, 4); end if;
  v_phone := char_length(v_digits) >= 4;
  v_city_ids := public.city_ids_for_name(v_q);

  with
  c as (
    select ac.id, ac.full_name, ac.client_kind, ac.deal_type, ac.cities, ac.max_price, ac.status,
           coalesce(ac.updated_at, ac.created_at) as ts
    from agent_clients ac
    where ac.full_name ilike v_like
       or ac.email ilike v_like
       or (v_phone and public._crm_search_phone_match(ac.phone, v_digits))
  ),
  p as (
    select pr.id, pr.title, pr.city, pr.address, pr.price, pr.status, pr.deal_type,
           coalesce(pr.updated_at, pr.created_at) as ts,
           coalesce(pr.title ilike v_like or pr.street ilike v_like or pr.address ilike v_like,
                    false) as x_exact
    from properties pr
    where pr.agent_id = v_me
      and (pr.title ilike v_like or pr.address ilike v_like or pr.street ilike v_like
           or pr.street_key = v_key
           or pr.city ilike v_like
           or pr.city_id = any(v_city_ids)
           or exists (
             select 1 from cities gc
              where gc.id = any(v_city_ids) and gc.name = pr.city
           )
           or (v_digits <> '' and pr.listing_number::text = v_digits))
  ),
  l as (
    select lm.id, lm.display_name, lm.lead_type, lm.deal_type, lm.city, lm.status, lm.created_at,
           lm.created_at as ts
    from leads_masked lm
    where lm.agent_id = v_me
      and (lm.display_name ilike v_like or lm.city ilike v_like or lm.property_details ilike v_like
           or exists (
             select 1 from cities gc
              where gc.id = any(v_city_ids) and gc.name = lm.city
           )
           or (v_phone and lm.status = 'unlocked'
               and public._crm_search_phone_match(lm.display_phone, v_digits)))
  ),
  d as (
    select ag.id, ag.title, ag.kind, ag.status, ag.exclusive_until,
           coalesce(ag.updated_at, ag.created_at) as ts
    from agreements ag
    where ag.agent_id = v_me
      and (ag.title ilike v_like
           or exists (select 1 from agent_clients ac
                      where ac.id = any(ag.client_ids) and ac.full_name ilike v_like))
  )
  select jsonb_build_object(
    'q', v_q,
    'counts', jsonb_build_object(
      'clients', (select count(*) from c), 'props', (select count(*) from p),
      'leads', (select count(*) from l), 'deals', (select count(*) from d)),
    'clients', coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from c order by ts desc limit v_lim) x), '[]'::jsonb),
    'props',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' - 'x_exact' order by x.x_exact desc, x.ts desc)
                         from (select * from p order by x_exact desc, ts desc limit v_lim) x), '[]'::jsonb),
    'leads',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from l order by ts desc limit v_lim) x), '[]'::jsonb),
    'deals',   coalesce((select jsonb_agg(to_jsonb(x) - 'ts' order by x.ts desc)
                         from (select * from d order by ts desc limit v_lim) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;


revoke all on function public.crm_search(text, int) from public, anon, authenticated;
grant execute on function public.crm_search(text, int) to authenticated;
