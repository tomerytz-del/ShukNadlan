-- ===========================================================================
-- אזורי הפעילות של סוכן/ת - מהרשימה הסגורה של השווקים, ולא טקסט חופשי
--
-- עד היום "אזור התמחות" בפרופיל היה שדה טקסט (‏service_area, עד 60 תווים),
-- ובהרשמה ביקשנו "עיר" עם הנחיה "איפה המשרד פעיל בעיקר?" - כלומר אותה שאלה
-- פעמיים, בשתי צורות, ואף אחת מהן לא קבעה איפה הסוכן/ת מופיע/ה באתר. השוק
-- נגזר רק מעיר המשרד (‏agencies.city_id), ולכן משרד בעפולה שעובד גם בחיפה
-- לא הופיע בדף של חיפה בכלל.
--
-- עכשיו שתי שאלות נפרדות:
--   - **כתובת המשרד** (‏agencies.address + ‏agencies.city_id) - נשאלת פעם אחת
--     בפתיחת המשרד, וקובעת את שוק הבית שלו כמו קודם.
--   - **אזורי הפעילות** (‏agency_members.service_markets) - slug-ים מ-
--     assets/markets.js, פעילים ושאינם פעילים. כל סוכן/ת בוחר/ת כמה שרוצה.
--     סוכן/ת מופיע/ה בכל שוק שבחר/ה, והמשרד מופיע בכל שוק שאחד/ת מחבריו
--     בחר/ה - בנוסף לשוק של עיר המשרד (assets/market-scope.js).
--
-- ‏service_area נשאר: הבוט, agents.html והגרסאות שבמטמון קוראים אותו, וה-CRM
-- כותב אליו את שמות האזורים שנבחרו כדי שכולם ימשיכו להציג דבר נכון.
--
-- הבדיקה כאן היא צורה בלבד (slug תקין, עד 12). הרשימה עצמה חיה ב-markets.js
-- ולא במסד, ו-check constraint אינו יכול לקרוא טבלה.
-- docs/regional-pages.md, "אזורי הפעילות".
-- ===========================================================================

alter table public.agency_members
  add column if not exists service_markets text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_members_service_markets_check') then
    alter table public.agency_members
      add constraint agency_members_service_markets_check
      check (
        cardinality(service_markets) <= 12
        and array_to_string(service_markets, ',') ~ '^([a-z0-9-]{2,40}(,[a-z0-9-]{2,40})*)?$'
      );
  end if;
end $$;

comment on column public.agency_members.service_markets is
  'אזורי הפעילות - slug-ים של שווקים מ-assets/markets.js (פעילים ושאינם). הסוכן/ת והמשרד מופיעים בכל שוק כזה בנוסף לשוק של עיר המשרד. docs/regional-pages.md.';

-- ---------------------------------------------------------------------------
-- ה-view הציבורי - אותה הגדרה של 20270216090000, והעמודה החדשה בסוף
-- ---------------------------------------------------------------------------
create or replace view public.agency_members_public as
 select id,
    agency_id,
    slug,
    display_name,
    bio,
    photo_url,
    role,
    active,
    phone_e164,
    cover_url,
    license_number,
    ((ethics_code_accepted_at is not null) and (ethics_badge_revoked_at is null)) as has_ethics_badge,
    years_experience,
    specialties,
    credentials,
    service_area,
    photo_position,
    gallery,
    page_bg,
    service_markets
   from public.agency_members
  where active = true
    and license_number is not null
    and coalesce(license_status, '') not in ('not_found', 'inactive');

grant select on public.agency_members_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- תצוגת השוק של מנהל/ת הפלטפורמה - משרד נספר גם בשוק שחבר/ה בו בחר/ה
--
-- זהה ל-20270112090000 חוץ מ-`ags`: מעבר למשרדים שעירם בשוק, גם משרד שיש בו
-- סוכן/ת פעיל/ה שבחר/ה את השוק הזה כאזור פעילות. כך הסף להדלקה (משרד אחד)
-- והאתר סופרים את אותם משרדים.
-- ---------------------------------------------------------------------------
create or replace function public.platform_market_report(p_market text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_city_ids uuid[];
  v_result   jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

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
  market_leads as (
    select l.id, l.created_at, l.unlocked_at
      from public.leads l
      left join public.properties p on p.id = l.property_id
     where coalesce(p.city_id, public.city_id_for_name(l.city)) = any (v_city_ids)
  ),
  hoods as (
    select n.id, n.city_id,
           (jsonb_typeof(to_jsonb(n.boundary)) = 'array'
            and jsonb_array_length(to_jsonb(n.boundary)) >= 3) as marked
      from public.neighborhoods n
     where n.city_id = any (v_city_ids)
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
      'deals_official', (select count(*) from public.market_deals_official o
                          where public.city_id_for_name(o.city) = any (v_city_ids))
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

comment on function public.platform_market_report(text) is
  'תצוגת שוק מקומי למנהל/ת הפלטפורמה: מספרים, ערים, משרדים ונכסים אחרונים. משרד נספר בשוק לפי עירו או לפי אזור פעילות של חבר/ה בו. security definer שמחזיר מספרים ושמות פומביים בלבד; מסרב ב-42501 למי שאינו/ה מנהל/ת.';

revoke all on function public.platform_market_report(text) from public, anon, authenticated;
grant execute on function public.platform_market_report(text) to authenticated;
