-- תיקוני סקירה אחרי שכיווני האוויר והעברת התמונות כבר באוויר.
-- מיגרציה חדשה: את הקבצים שכבר הורצו לא משנים.

alter table public.property_image_relocations
  add column if not exists cleanup_attempts smallint not null default 0;

-- אסימון שלא ניתן לניחוש. חוזר רק ביצירה, לא בכפילות, ונדרש להדלקת הסכמה.
alter table public.saved_searches
  add column if not exists consent_token text;

create unique index if not exists saved_searches_consent_token_key
  on public.saved_searches (consent_token)
  where consent_token is not null;

alter table public.whatsapp_public_conversations
  add column if not exists last_saved_consent_token text;

-- גלריית המשרד היא jsonb של {url, caption}, כמו agency_members.gallery.
-- בעננים שבהם העמודה כבר קיימת השורה לא משנה כלום.
alter table public.agencies
  add column if not exists gallery jsonb not null default '[]'::jsonb;

comment on column public.property_image_relocations.cleanup_attempts is
  'כמה פעמים מחיקת קובץ המקור נכשלה. אחרי 5 לא מנסים שוב. cleaned_at נכתב רק כשהמחיקה הצליחה.';

-- החתימה הישנה (כתובת אחת) לא נשארת: אחרת PostgREST לא יודע לאיזו לקרוא.
drop function if exists public.property_image_still_used(text, uuid);

create or replace function public.property_image_still_used(p_urls text[], p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_urls is null or cardinality(p_urls) = 0 then true
    else (
    exists (
      select 1 from public.properties p
       where (
           (p_except is null or p.id is distinct from p_except)
           and p.images && p_urls
         )
          or p.marketing_image = any(p_urls)
          or p.video_url = any(p_urls)
          or p.video_poster_url = any(p_urls)
    )
    or exists (
      select 1 from public.whatsapp_conversations c
       where c.pending_images && p_urls
    )
    or exists (
      select 1 from public.property_visualizations v
       where v.source_image_url = any(p_urls) or v.result_url = any(p_urls)
    )
    or exists (
      select 1 from public.property_image_tags t
       where t.image_url = any(p_urls)
    )
    or exists (
      select 1 from public.property_video_clips c
       where c.source_image_url = any(p_urls)
    )
    or exists (
      select 1 from public.property_video_jobs j
       where j.cover_url = any(p_urls) or j.result_url = any(p_urls) or j.previous_video_url = any(p_urls)
    )
    or exists (
      select 1 from public.ad_placements a
       where a.creative_url = any(p_urls)
          or a.cover_url = any(p_urls)
          or a.gallery_urls && p_urls
    )
    or exists (
      select 1 from public.agency_members m
       where m.photo_url = any(p_urls)
          or m.cover_url = any(p_urls)
          or exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(m.gallery) = 'array' then m.gallery else '[]'::jsonb end
              ) e
             where e->>'url' = any(p_urls)
          )
    )
    or exists (
      select 1 from public.agencies a
       where a.logo_url = any(p_urls)
          or a.cover_url = any(p_urls)
          or exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(a.gallery) = 'array' then a.gallery else '[]'::jsonb end
              ) e
             where e->>'url' = any(p_urls)
          )
    )
    or exists (
      select 1 from public.articles a
       where a.cover_url = any(p_urls)
    )
    )
  end;
$$;

revoke all on function public.property_image_still_used(text[], uuid) from public, anon, authenticated;
grant execute on function public.property_image_still_used(text[], uuid) to service_role;


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
    select c.name, public.city_id_for_name(c.name) as id
      from unnest(coalesce(p_client.cities, '{}'::text[])) c(name)
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
              and round(p_client.min_living_room_sqm - p_property.living_room_sqm, 1) > 0
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
  'ציון ההתאמה בין לקוח/ה לנכס יחיד. פער סלון שמתעגל ל-0 לא מוריד נקודות.';


create or replace function public.saved_search_payload_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  with c as (
    select coalesce(array_agg(distinct v order by v), '{}'::text[]) as cities
      from jsonb_array_elements_text(coalesce(p_payload->'cities', '[]'::jsonb)) v
  ), n as (
    select coalesce(array_agg(distinct v order by v), '{}'::uuid[]) as neighborhood_ids
      from (
        select jsonb_array_elements_text(coalesce(p_payload->'neighborhood_ids', '[]'::jsonb))::uuid as v
      ) q
  ), t as (
    select coalesce(array_agg(distinct v order by v), '{}'::text[]) as property_types
      from jsonb_array_elements_text(coalesce(p_payload->'property_types', '[]'::jsonb)) v
  ), f as (
    select coalesce(array_agg(distinct v order by v), '{}'::text[]) as required_features
      from jsonb_array_elements_text(coalesce(p_payload->'required_features', '[]'::jsonb)) v
  )
  select md5(
    coalesce(nullif(p_payload->>'deal_type', ''), 'sale') || '|' ||
    coalesce(nullif(p_payload->>'category', ''), 'residential') || '|' ||
    array_to_string((select cities from c), ',') || '|' ||
    array_to_string((select neighborhood_ids from n), ',') || '|' ||
    array_to_string((select property_types from t), ',') || '|' ||
    coalesce(nullif(p_payload->>'min_price', '')::numeric::text, '') || '|' ||
    coalesce(nullif(p_payload->>'max_price', '')::numeric::text, '') || '|' ||
    coalesce(nullif(p_payload->>'min_rooms', '')::numeric::text, '') || '|' ||
    coalesce(nullif(p_payload->>'max_rooms', '')::numeric::text, '') || '|' ||
    coalesce(nullif(p_payload->>'min_size_sqm', '')::numeric::text, '') || '|' ||
    coalesce(nullif(p_payload->>'max_size_sqm', '')::numeric::text, '') || '|' ||
    coalesce(nullif(p_payload->>'min_floor', '')::smallint::text, '') || '|' ||
    coalesce(nullif(p_payload->>'max_floor', '')::smallint::text, '') || '|' ||
    array_to_string((select required_features from f), ',') || '|' ||
    coalesce(p_payload->>'condition', '')
  );
$$;

revoke all on function public.saved_search_payload_hash(jsonb) from public, anon, authenticated;
grant execute on function public.saved_search_payload_hash(jsonb) to service_role;

create or replace function public.create_saved_search(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_label   text;
  v_cap     int;
  v_count   int;
  v_phone   text;
  v_consent boolean := coalesce((p_payload->>'consent_agent_contact')::boolean, false);
  v_agency  uuid    := nullif(p_payload->>'agency_id', '')::uuid;
  v_agent   uuid    := nullif(p_payload->>'assigned_agent_id', '')::uuid;
  -- 20270806090000: ליד בלי התראות (lead_only) נשמר 'paused' - המדף מסנן רק
  -- 'unsubscribed', ומנוע ההתראות רק 'active'. כל ערך אחר - 'active' כמו תמיד.
  v_status  text    := case when p_payload->>'status' = 'paused' then 'paused' else 'active' end;
  v_source  text    := nullif(left(btrim(coalesce(p_payload->>'source', '')), 60), '');
  v_token   text    := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  -- בלי הסכמה מפורשת אין ליד — יש חיפוש עם התראות. השיוך נמחק כאן ולא
  -- נבדק אצל הקורא בלבד: זו השורה שמפרידה בין השתיים.
  if not v_consent then
    v_agency := null;
    v_agent  := null;
  end if;
  -- סוכן/ת בלי משרד אינו שיוך אלא תקלה: השיוך כולו הוא "הליד של המשרד הזה"
  if v_agency is null then
    v_agent := null;
  end if;

  begin
    insert into public.saved_searches (
      full_name, phone, email, contact_channel, label,
      deal_type, category, cities, neighborhood_ids, property_types,
      min_price, max_price, min_rooms, max_rooms,
      min_size_sqm, max_size_sqm, min_floor, max_floor,
      required_features, condition, free_text, consent_agent_contact,
      agency_id, sold_to_agent_id, lead_status, sold_at, status, source, consent_token
    ) values (
      p_payload->>'full_name',
      p_payload->>'phone',
      p_payload->>'email',
      coalesce(p_payload->>'contact_channel', 'whatsapp'),
      p_payload->>'label',
      coalesce(p_payload->>'deal_type', 'sale'),
      coalesce(p_payload->>'category', 'residential'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'cities')), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'neighborhood_ids')::uuid), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_payload->'property_types')), '{}'),
      (p_payload->>'min_price')::numeric,
      (p_payload->>'max_price')::numeric,
      (p_payload->>'min_rooms')::numeric,
      (p_payload->>'max_rooms')::numeric,
      (p_payload->>'min_size_sqm')::numeric,
      (p_payload->>'max_size_sqm')::numeric,
      (p_payload->>'min_floor')::smallint,
      (p_payload->>'max_floor')::smallint,
      coalesce(array(select jsonb_array_elements_text(p_payload->'required_features')), '{}'),
      p_payload->>'condition',
      p_payload->>'free_text',
      v_consent,
      v_agency,
      v_agent,
      -- ‏'sold' ולא סטטוס חדש: זה בדיוק המצב "יש לו בעלים ואינו במדף",
      -- וכל מה שקורא את הטבלה כבר יודע לקרוא אותו נכון.
      case when v_agency is not null then 'sold' else 'new' end,
      case when v_agency is not null then now() else null end,
      v_status,
      v_source,
      v_token
    )
    returning id, label, phone_e164 into v_id, v_label, v_phone;
  exception
    when unique_violation then
      -- אין מזהה ואין קריטריונים. רק שמות השדות שנשמרו.
      return coalesce((
        select jsonb_build_object(
            'success', true,
            'duplicate', true,
            'saved_labels', array_remove(array[
              case when cardinality(s.cities) > 0 or cardinality(s.neighborhood_ids) > 0 then 'האזור' end,
              case when s.min_rooms is not null or s.max_rooms is not null then 'החדרים' end,
              case when s.min_price is not null or s.max_price is not null then 'התקציב' end,
              case when cardinality(s.property_types) > 0 then 'סוג הנכס' end,
              case when s.min_size_sqm is not null then 'השטח' end,
              case when cardinality(s.required_features) > 0 then 'המאפיינים' end
            ]::text[], null)
          )
          from public.saved_searches s
         where s.phone_e164 = public.normalize_msisdn(nullif(btrim(coalesce(p_payload->>'phone', '')), ''))
           and s.status <> 'unsubscribed'
           and s.criteria_hash = public.saved_search_payload_hash(p_payload)
         limit 1
      ), jsonb_build_object('success', true, 'duplicate', true, 'saved_labels', '{}'::text[]));
    when check_violation then
      return jsonb_build_object('error', 'invalid_criteria');
  end;

  -- התקרה נבדקת רק על מי שמסר/ה טלפון: זהו המזהה היחיד שיש לנו לאדם
  -- שאינו רשום לאתר.
  if v_phone is not null then
    v_cap := coalesce((select value::int from public.pricing_config
                        where key = 'saved_search_max_per_phone'), 5);
    select count(*) into v_count
      from public.saved_searches
     where phone_e164 = v_phone and status <> 'unsubscribed';

    if v_count > v_cap then
      delete from public.saved_searches where id = v_id;
      return jsonb_build_object('error', 'too_many_searches', 'limit', v_cap);
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'search_id', v_id,
    'label', v_label,
    -- הקורא צריך לדעת אם השיוך אכן נעשה, כדי לרשום ניתוב נכון ביומן
    -- ולומר לגולש/ת למי הפרטים הגיעו
    'agency_id', v_agency,
    'assigned_agent_id', v_agent,
    'consent_token', v_token
  );
end;
$$;


revoke all on function public.create_saved_search(jsonb) from public, anon, authenticated;
grant execute on function public.create_saved_search(jsonb) to service_role;
