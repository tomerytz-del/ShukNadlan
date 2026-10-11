-- ---------------------------------------------------------------------------
-- תצוגת השוק של מנהל/ת הפלטפורמה - מ-5.3 שניות לפחות משנייה
--
-- זהה ל-20270321090000 חוץ מ-`deals_official`. הספירה הפעילה את
-- city_id_for_name על כל שורה ב-market_deals_official - 31,847 קריאות לפונקציה
-- security definer שאינה נפתחת בתוך השאילתה - ולכן כל פתיחה של פאנל השווקים
-- המתינה כ-5 שניות (pg_stat_statements: ממוצע 5,302ms על 73 קריאות). עכשיו
-- הקיבוץ לפי שם העיר קודם, והפונקציה נקראת פעם לכל שם.
--
-- נבדק מול המסד לפני הכתיבה, ב-explain analyze על שוק עפולה והעמק: 2,502
-- עסקאות בשתי הדרכים, 7,163ms מול 63ms.
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
      -- ספירה לפי שם עיר ולא לפי שורה: city_id_for_name נקראה כאן פעם לכל
      -- אחת מ-31,847 העסקאות (7.2 שניות), ועכשיו פעם לכל אחד מ-49 שמות
      -- הערים (0.06 שניות). אותו מספר בדיוק.
      'deals_official', (select coalesce(sum(g.n), 0)
                           from (select o.city, count(*) as n
                                   from public.market_deals_official o
                                  group by o.city) g
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

comment on function public.platform_market_report(text) is
  'תצוגת שוק מקומי למנהל/ת הפלטפורמה: מספרים, ערים, משרדים ונכסים אחרונים. משרד נספר בשוק לפי עירו או לפי אזור פעילות של חבר/ה בו. security definer שמחזיר מספרים ושמות פומביים בלבד; מסרב ב-42501 למי שאינו/ה מנהל/ת.';

revoke all on function public.platform_market_report(text) from public, anon, authenticated;
grant execute on function public.platform_market_report(text) to authenticated;

