-- =============================================================================
-- מאפייני חובה של לקוח/ה = סינון קשיח, וויתור רק באישור הסוכן/ת
--
-- עד היום ‏required_features ("מאפייני חובה" בטופס הלקוח/ה) היו ניקוד בלבד:
-- 8 נקודות לכל מאפיין חסר, עד 24. נכס בלי ממ״ד ובלי מעלית ללקוח/ה שדרש/ה את
-- שניהם קיבל 84 - מעל רף 50 של הבוט ומעל רף 70 של ההתראות - וגבריאלה הציגה
-- אותו כהתאמה טובה. סוכנים התלוננו (‏11.10.2026): "אם הלקוח דרש ממ״ד, התוצאות
-- חייבות לכלול ממ״ד".
--
-- ההחלטה: מה שהטופס קורא לו "חובה" הוא חובה. נכס שחסר בו מאפיין חובה לא
-- עובר את ה-gate של client_property_match - בפאנל, בספירות, בהתראות ובבוט
-- גם יחד (הסקיל client-matching, סעיף 2: כלל התאמה נוסף רק כאן).
--
-- ויתור: כשאין התאמות מלאות, גבריאלה **שואלת** את הסוכן/ת אם להציג גם נכסים
-- בלי המאפיין, ורק אחרי "כן" קוראת שוב עם p_waive_features. הוויתור הוא
-- פרמטר של הקריאה ולא שינוי בכרטיס הלקוח/ה, ולכן הוא אינו דולף להתראות.
-- נכס שעבר בוויתור עדיין מאבד 8 נקודות לכל מאפיין חסר ומחזיר אותו ב-
-- missing_features - כך הבוט אומר "בלי מעלית" ליד כל נכס כזה.
--
-- ממ״ד בנכס מסחרי נרשם ב-mamad_location = 'unit' ולא במערך features (כמו
-- ב-mamadText של ההסכמים), ולכן הוא נחשב כאן "יש ממ״ד".
--
-- מה שנוגעים בו:
--   1. client_property_match(client, property, waive) - העתק מלא של
--      20270316090000 עם שורת המאפיינים ב-gate. הגרסה בשני ארגומנטים נשארת
--      כעטיפה (waive ריק), ולכן כל הצרכנים הקיימים נעשים קשיחים בלי שינוי.
--   2. agent_client_matches / agent_client_market_matches - פרמטר
--      p_waive_features (ברירת מחדל ריק), ו-missing_features גם ב-market.
--      חתימה חדשה = drop + create; ‏agent_client_match_counts קוראת בשלושה
--      ארגומנטים ומגיעה לחדשה דרך ברירת המחדל.
--   3. התראות פתוחות (new/seen) על נכס שחסר בו מאפיין חובה - נמחקות, אחרת
--      הן נשארות בפאנל "התאמות חכמות" ובתגית "N לקוחות מתאימים" אחרי התיקון.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. הניקוד - זהה ל-20270316090000 פרט למאפייני החובה ב-gate ולממ״ד המסחרי
-- ---------------------------------------------------------------------------
create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
immutable
set search_path = ''
as $$
  with feats as (
    -- מה שיש בנכס. ממ״ד מסחרי יושב ב-mamad_location ולא במערך
    select coalesce(p_property.features, '{}'::text[])
           || case when p_property.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end
           as have
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(feats.have)) as feats
      from feats
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0         or p_property.city          = any(p_client.cities))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or p_property.price <= p_client.max_price * 1.10)
        and (p_client.min_price is null or p_property.price >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
           ) as passes
      from miss
  )
  select
    greatest(0, 100
      - case when p_client.max_price is not null and p_property.price > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and p_property.price < p_client.min_price then 5  else 0 end
      - case when p_client.min_size_sqm is not null
              and (p_property.size_sqm is null or p_property.size_sqm < p_client.min_size_sqm) then 10 else 0 end
      - case when p_client.max_size_sqm is not null and p_client.min_size_sqm is null
              and p_property.size_sqm is null then 10 else 0 end
      - case when p_client.max_floor is not null
              and p_property.floor is not null and p_property.floor > p_client.max_floor then 10 else 0 end
      - case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
             then 5 else 0 end
      - least(24, 8 * cardinality(miss.feats))
    )::int,
    array_remove(array[
      case when p_client.max_price is not null and p_property.price > p_client.max_price
           then 'מעל התקציב ב-' || round((p_property.price / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and p_property.price < p_client.min_price
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
           then 'מספר החדרים לא מולא במודעה' end
    ], null),
    miss.feats
  from gate, miss
  where gate.passes;
$$;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח (כולל מאפיין חובה חסר שאינו ב-p_waive_features). p_waive_features רק לקריאה שהסוכן/ת אישר/ה בה ויתור.';

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[]) from public, anon, authenticated;

-- הגרסה בשני ארגומנטים - מה שכל הצרכנים קוראים. בלי ויתור, כלומר קשיחה.
create or replace function public.client_property_match(
  p_client   public.agent_clients,
  p_property public.properties
)
returns table (score int, reasons text[], missing_features text[])
language sql
immutable
set search_path = ''
as $$
  select m.score, m.reasons, m.missing_features
    from public.client_property_match(p_client, p_property, '{}'::text[]) m;
$$;

comment on function public.client_property_match(public.agent_clients, public.properties) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד - עטיפה של הגרסה עם p_waive_features, בלי ויתור. אפס שורות = נפילה בסינון קשיח (כולל מאפיין חובה חסר, תקרת שטח, ובעל/ת נכס שאינו/ה מחפש/ת). מקור האמת של פאנל ההתאמות, ההתראות והבוט.';

revoke all on function public.client_property_match(public.agent_clients, public.properties) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2א. agent_client_matches - זהה ל-20261029090000, עם p_waive_features
-- ---------------------------------------------------------------------------
drop function if exists public.agent_client_matches(uuid, uuid, int);

create or replace function public.agent_client_matches(
  p_agent_id       uuid,
  p_client_id      uuid,
  p_limit          int    default 10,
  p_waive_features text[] default '{}'
)
returns table (
  property_id        uuid,
  source             text,
  score              int,
  reasons            text[],
  missing_features   text[],
  title              text,
  price              numeric,
  deal_type          text,
  property_type      text,
  rooms              numeric,
  floor              int,
  size_sqm           numeric,
  city               text,
  street             text,
  house_number       text,
  listing_agent_name text,
  listing_agent_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  public.agency_members%rowtype;
  v_client public.agent_clients%rowtype;
  v_cap    int := least(greatest(coalesce(p_limit, 10), 1), 30);
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return;
  end if;

  -- הלקוח/ה חייב/ת להיות של הסוכן/ת. זה השער שמחליף כאן את ה-RLS.
  select * into v_client from public.agent_clients
   where id = p_client_id and agent_id = v_agent.id;
  if not found then
    return;
  end if;

  return query
  with pool as (
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as src
      from public.properties p
     where p.agency_id = v_agent.agency_id
    union all
    select ps.property_id, 'shared'
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  )
  select
    p.id, pool.src, m.score, m.reasons, m.missing_features,
    p.title, p.price, p.deal_type, p.property_type,
    p.rooms::numeric, p.floor::int, p.size_sqm::numeric,
    p.city, p.street, p.house_number,
    case when p.agent_id = v_agent.id then null else mem.display_name end,
    case when p.agent_id = v_agent.id then null else mem.phone end
    from pool
    join public.properties p on p.id = pool.pid
    cross join lateral public.client_property_match(v_client, p, coalesce(p_waive_features, '{}')) m
    left join public.agency_members mem on mem.id = p.agent_id
   where m.score >= 50
   order by m.score desc, p.is_promoted desc, p.created_at desc
   limit v_cap;
end;
$$;

comment on function public.agent_client_matches(uuid, uuid, int, text[]) is
  'התאמות נכס ללקוח/ה לפי מזהה סוכן/ת מפורש - הגרסה של match_properties_for_client לשרת (הבוט בוואטסאפ), שאין לו JWT. ניקוד מ-client_property_match. p_waive_features = מאפייני חובה שהסוכן/ת הסכים/ה לוותר עליהם בקריאה הזו.';

revoke all on function public.agent_client_matches(uuid, uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.agent_client_matches(uuid, uuid, int, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2ב. agent_client_market_matches - זהה ל-20270320092000, עם p_waive_features
--     ועם missing_features בתוצאה (שינוי טיפוס החזרה = drop)
-- ---------------------------------------------------------------------------
drop function if exists public.agent_client_market_matches(uuid, uuid, int);

create or replace function public.agent_client_market_matches(
  p_agent_id       uuid,
  p_client_id      uuid,
  p_limit          int    default 5,
  p_waive_features text[] default '{}'
)
returns table (
  property_id         uuid,
  score               int,
  reasons             text[],
  title               text,
  price               numeric,
  deal_type           text,
  property_type       text,
  rooms               numeric,
  floor               int,
  size_sqm            numeric,
  city                text,
  street              text,
  listing_agent_name  text,
  listing_agent_phone text,
  listing_office      text,
  missing_features    text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  public.agency_members%rowtype;
  v_client public.agent_clients%rowtype;
  v_cap    int := least(greatest(coalesce(p_limit, 5), 1), 15);
  v_market text;
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return;
  end if;

  -- אותו שער כמו ב-agent_client_matches: הלקוח/ה חייב/ת להיות של הסוכן/ת.
  select * into v_client from public.agent_clients
   where id = p_client_id and agent_id = v_agent.id;
  if not found then
    return;
  end if;

  select c.market_slug into v_market
    from public.agencies a
    join public.cities c on c.id = a.city_id
   where a.id = v_agent.agency_id;
  if v_market is null then
    return;
  end if;

  return query
  select
    p.id, m.score, m.reasons,
    p.title, p.price, p.deal_type, p.property_type,
    p.rooms::numeric, p.floor::int, p.size_sqm::numeric,
    p.city, p.street,
    mem.display_name, mem.phone, ag.name,
    m.missing_features
    from public.properties p
    join public.cities c on c.id = p.city_id and c.market_slug = v_market
    cross join lateral public.client_property_match(v_client, p, coalesce(p_waive_features, '{}')) m
    left join public.agency_members mem on mem.id = p.agent_id
    left join public.agencies ag on ag.id = p.agency_id
   where p.status = 'active'
     and p.agency_id is distinct from v_agent.agency_id
     and not exists (
       select 1 from public.property_shares ps
        where ps.property_id = p.id
          and ps.shared_with_agency_id = v_agent.agency_id)
     and m.score >= 50
   order by m.score desc, p.is_promoted desc, p.created_at desc
   limit v_cap;
end;
$$;

comment on function public.agent_client_market_matches(uuid, uuid, int, text[]) is
  'התאמות ללקוח/ה מנכסים פעילים של משרדים אחרים בשוק המקומי שלא שותפו עם המשרד. ציון מ-client_property_match, כמו agent_client_matches, ואותו p_waive_features. לבוט בוואטסאפ (service_role).';

revoke all on function public.agent_client_market_matches(uuid, uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.agent_client_market_matches(uuid, uuid, int, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. התראות פתוחות על נכס שחסר בו מאפיין חובה
--
-- רק new ו-seen, כמו ב-agent_clients_owner_clear_alerts: dismissed היא החלטה
-- של הסוכן/ת ונשמרת. ההגדרה של "חסר" זהה ל-gate (כולל ממ״ד מסחרי).
-- ---------------------------------------------------------------------------
delete from public.client_match_alerts a
 using public.agent_clients c, public.properties p
 where a.client_id = c.id
   and a.property_id = p.id
   and a.status in ('new', 'seen')
   and cardinality(c.required_features) > 0
   and not (c.required_features <@ (
         coalesce(p.features, '{}'::text[])
         || case when p.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end));
