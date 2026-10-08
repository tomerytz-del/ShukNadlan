-- ============================================================================
-- התאמות ללקוח/ה מכל האזור - מה שמתווכים אחרים מפרסמים ולא שיתפו
--
-- ‏`agent_client_matches` מצליב לקוח/ה מול נכסי המשרד ומה ששותף איתו - כמו
-- בדשבורד. סוכן/ת ששאל/ה את גבריאלה "מה יש ל<שם>" לא שמע/ה על דירה מתאימה
-- של משרד אחר באותה עיר, כי היא לא שותפה (‏5.10.2026: מתוך ארבע דירות
-- מתאימות בעפולה, שלוש היו כאלה).
--
-- הפונקציה הזו מחזירה את המאגר הרביעי - `market`: כל הנכסים **הפעילים** בערים
-- של השוק המקומי של המשרד (‏`cities.market_slug` של עיר המשרד), פחות מה
-- שכבר במאגר של agent_client_matches. **הציון מ-`client_property_match`** -
-- המקום היחיד לכלל התאמה (הסקיל client-matching, סעיף 2), ולכן אותו נכס
-- מקבל אותו ציון בבוט ובדשבורד.
--
-- מספר הבית אינו חוזר: אלה נכסים של משרד שלא שיתף, ומוצגים כמו באתר הציבורי.
-- המתווך/ת המפרסם/ת, המשרד והטלפון חוזרים - הם הדרך לתאם שת"פ.
-- ============================================================================

create or replace function public.agent_client_market_matches(
  p_agent_id  uuid,
  p_client_id uuid,
  p_limit     int default 5
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
  listing_office      text
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
    mem.display_name, mem.phone, ag.name
    from public.properties p
    join public.cities c on c.id = p.city_id and c.market_slug = v_market
    cross join lateral public.client_property_match(v_client, p) m
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

comment on function public.agent_client_market_matches(uuid, uuid, int) is
  'התאמות ללקוח/ה מנכסים פעילים של משרדים אחרים בשוק המקומי שלא שותפו עם המשרד. ציון מ-client_property_match, כמו agent_client_matches. לבוט בוואטסאפ (service_role).';

revoke all on function public.agent_client_market_matches(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.agent_client_market_matches(uuid, uuid, int) to service_role;
