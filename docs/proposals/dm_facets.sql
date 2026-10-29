-- ============================================================================
-- ‏homepage_dm_facets(): התמחות ואזור לכל משרד ויועץ/ת, מהנכסים הפעילים (PR 1010, P1-U2, ד-5).
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
--
-- היום הדפדפן גוזר את אותו דבר מהנכסים שכבר נטענו בדף הבית (‏initDmFilters /
-- ‏dmPropSpecs ב-assets/home.js). הכלל כאן זהה לשם, כדי שהמעבר ל-RPC לא ישנה תוצאות:
-- מכירה / השכרה לפי deal_type, מסחרי לפי category, פרויקטים לפי project_status,
-- בתים פרטיים לפי property_type, קרקעות לפי מילה בסוג.
-- ‏SECURITY INVOKER: ה-RLS של properties חל, כמו homepage_agency_cards. פחות מ-1,000 שורות.
-- ============================================================================

create or replace function public.homepage_dm_facets()
returns table(owner_kind text, owner_id uuid, spec text, city_id uuid, neighborhood_id uuid, n integer)
language sql
stable
set search_path to 'public'
as $$
  with p as (
    select p.agency_id, p.agent_id, p.city_id, p.neighborhood_id,
           array_remove(array[
             case when p.deal_type = 'sale' then 'sale' end,
             case when p.deal_type = 'rent' then 'rent' end,
             case when p.category = 'commercial' then 'commercial' end,
             case when nullif(btrim(coalesce(p.project_status, '')), '') is not null then 'projects' end,
             case when p.property_type in ('בית פרטי/קוטג''', 'דו משפחתי') then 'houses' end,
             case when coalesce(p.property_type, '') ~ '(מגרש|קרקע|משק|נחלה)' then 'land' end
           ], null) as specs
      from public.properties p
     where p.status = 'active'
  )
  select 'agency', agency_id, s, city_id, neighborhood_id, count(*)::int
    from p, unnest(specs) s where agency_id is not null group by 2, 3, 4, 5
  union all
  select 'agent', agent_id, s, city_id, neighborhood_id, count(*)::int
    from p, unnest(specs) s where agent_id is not null group by 2, 3, 4, 5;
$$;

revoke all on function public.homepage_dm_facets() from public;
grant execute on function public.homepage_dm_facets() to anon, authenticated, service_role;
