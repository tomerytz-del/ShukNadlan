-- ============================================================================
-- מחפש/ת מהרשתות נכנס/ת לביקוש הפתוח, לא לסוכן/ת אחד/ת
-- ----------------------------------------------------------------------------
-- social-lead-intake לא משתנה. אחרי ש-saved-search-intake כותב את
-- saved_searches, הטריגר הזה (רק כש-social_buyer_open_demand_enabled = 1)
-- מזהה שורת social_leads עם kind=buyer שעדיין ב-routing, מוריד את החיפוש
-- מהמדף (lead_status=archived) וכותב scraped_leads ב-open_demand בלי שם
-- ובלי טלפון. אין קריאה ל-scraped_lead_notify_demand: ההתראה יוצאת אחר כך
-- מ-scraped_leads_lifecycle, ורק לשורות שכבר נכתבו.
-- בלי עיר, או בלי עיר ש-city_id_for_name מכיר, החיפוש נשאר במדף.
-- פניית נכס (kind=property) אינה נתפסת. הדגל נולד 0.
-- ============================================================================

insert into public.pricing_config (key, value, description)
values ('social_buyer_open_demand_enabled', 0,
        '1: מחפש/ת מפייסבוק או מאינסטגרם יורד/ת מהמדף ונכנס/ת לביקוש הפתוח. 0: נשאר/ת במדף כמו היום.')
on conflict (key) do nothing;

create or replace function public.social_buyer_to_open_demand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag   int;
  v_ref    text;
  v_city   text;
  v_city_id uuid;
  v_rooms  numeric;
  v_budget numeric;
  v_summary text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if new.agency_id is not null or new.sold_to_agent_id is not null then
    return new;
  end if;
  if new.lead_status is distinct from 'new' then
    return new;
  end if;
  if new.source is null or new.source !~ '^(facebook|instagram)_[a-z]{2,20}$' then
    return new;
  end if;

  v_flag := coalesce((select value::int from public.pricing_config
                       where key = 'social_buyer_open_demand_enabled'), 0);
  if v_flag <> 1 then
    return new;
  end if;

  select s.zernio_id
    into v_ref
    from public.social_leads s
   where s.kind = 'buyer'
     and s.status = 'routing'
     and s.channel = new.source
     and s.received_at > now() - interval '30 minutes'
     and (
       (public.phone_tail9(s.payload->>'phone') is not null
        and public.phone_tail9(s.payload->>'phone')
            = public.phone_tail9(coalesce(new.phone_e164, new.phone)))
       or (nullif(lower(btrim(coalesce(s.payload->>'email', ''))), '') is not null
           and lower(btrim(s.payload->>'email')) = lower(btrim(coalesce(new.email, ''))))
     )
     and not exists (
       select 1 from public.scraped_leads sl
        where sl.source = new.source and sl.external_ref = s.zernio_id
     )
   order by s.received_at desc
   limit 1;
  if v_ref is null then
    return new;
  end if;

  v_city := nullif(btrim(coalesce(new.cities[1], '')), '');
  if v_city is null then
    return new;
  end if;
  v_city_id := public.city_id_for_name(v_city);
  if v_city_id is null then
    return new;
  end if;

  v_rooms := case
               when new.min_rooms is not null and new.min_rooms > 0 then new.min_rooms
               when new.max_rooms is not null and new.max_rooms > 0 then new.max_rooms
             end;
  v_budget := case
                when new.max_price is not null and new.max_price > 0 then new.max_price
                when new.min_price is not null and new.min_price > 0 then new.min_price
              end;
  v_summary := left(concat_ws(' · ',
    case new.deal_type when 'rent' then 'מחפש/ת לשכור' else 'מחפש/ת לקנות' end,
    nullif(btrim(coalesce(new.property_types[1], '')), ''),
    case when v_rooms is not null then trim_scale(v_rooms)::text || ' חדרים' end,
    case when v_budget is not null then 'עד ₪' || to_char(v_budget, 'FM999,999,999') end
  ), 160);

  begin
    insert into public.scraped_leads (
      lead_type, status, source, source_detail, post_url, external_ref, posted_at,
      city, city_id, deal_type, property_type, rooms, budget, demand_summary,
      open_demand_at, raw_name, raw_phone, raw_message
    ) values (
      'seeker_inbound', 'open_demand', new.source,
      left(coalesce(public.lead_source_label(new.source), new.source), 120),
      'https://shuknadlan.co.il/crm?goto=accLeads&tab=demand',
      v_ref, now(),
      v_city, v_city_id,
      case when new.deal_type in ('sale', 'rent') then new.deal_type end,
      nullif(left(btrim(coalesce(new.property_types[1], '')), 80), ''),
      v_rooms, v_budget, nullif(v_summary, ''),
      now(), null, null, null
    )
    on conflict (source, external_ref) do nothing;

    update public.saved_searches
       set lead_status = 'archived'
     where id = new.id
       and lead_status = 'new'
       and agency_id is null
       and sold_to_agent_id is null;
  exception when others then
    -- כשל בפיד לא מוחק את החיפוש. הוא נשאר במדף.
    return new;
  end;

  return new;
end;
$$;

comment on function public.social_buyer_to_open_demand() is
  'אחרי insert ל-saved_searches: מחפש/ת מ-social_leads (kind=buyer) יורד/ת מהמדף ונכנס/ת לביקוש פתוח אנונימי. דגל 0 אינו נוגע. לא שולח התראה (20271029240000).';

revoke all on function public.social_buyer_to_open_demand() from public, anon, authenticated;
grant execute on function public.social_buyer_to_open_demand() to service_role;

drop trigger if exists social_buyer_to_open_demand on public.saved_searches;
create trigger social_buyer_to_open_demand
  after insert on public.saved_searches
  for each row execute function public.social_buyer_to_open_demand();
