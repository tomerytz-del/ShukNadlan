-- ============================================================================
-- מחפש/ת מהרשתות נכנס/ת לביקוש הפתוח, לא לסוכן/ת אחד/ת
-- ----------------------------------------------------------------------------
-- version 20271029240000. 20271028240000 תפוס ב-main (#1021,
-- leads_phone_e164_dedupe). האחרון ב-main הוא 20271029110000.
--
-- social-lead-intake לא משתנה. אחרי ש-saved-search-intake כותב את
-- saved_searches, הטריגר (רק כש-social_buyer_open_demand_enabled = 1,
-- וגם תקרת #1037 ותקרת התבניות דלוקות) מזהה שורת social_leads
-- עם kind=buyer שעדיין ב-routing, מוריד את החיפוש מהמדף
-- (lead_status=archived) וכותב scraped_leads ב-open_demand בלי שם
-- ובלי טלפון. אין קריאה ל-scraped_lead_notify_demand מהמיגרציה ואין
-- עדכון של חיפושים ישנים: ההתראה יוצאת אחר כך מ-scraped_leads_lifecycle,
-- ורק לשורות שכבר נכתבו.
--
-- lead_status=archived מוריד מהמדף (המדף מסנן new/sold). מנוי ההתראות
-- הוא saved_searches.status, ו-generate_saved_search_alerts /
-- saved_search_pending_alerts מסננים status='active'. הארכיון לא נוגע
-- ב-status, ולכן subscribe_alerts ממשיך לקבל התראות על נכסים.
--
-- בלי עיר, או בלי עיר ש-city_id_for_name מכיר, החיפוש נשאר במדף.
-- פניית נכס (kind=property) אינה נתפסת. הדגל נולד 0, וגם 1 לא מעביר
-- כל עוד open_demand_notify_cap_enabled אינו 1, טבלת היומן של התקרה
-- חסרה, או whatsapp_template_cap_on() חסר או כבוי.
-- ============================================================================

insert into public.pricing_config (key, value, description)
values ('social_buyer_open_demand_enabled', 0,
        '1: מחפש/ת מפייסבוק או מאינסטגרם יורד/ת מהמדף ונכנס/ת לביקוש הפתוח, ורק אם תקרת הביקוש ותקרת התבניות דלוקות. 0: נשאר/ת במדף כמו היום.')
on conflict (key) do nothing;

insert into public.pricing_config (key, value, description)
values ('social_buyer_handoff_enabled', 0,
        '1: אחרי "אני פונה" על מחפש/ת מהודעה פרטית נרשמת שורת מסירה לגבריאלה של מטא, בלי טלפון. 0: הליד נפתח, ואין שורה בתור.')
on conflict (key) do nothing;

-- מספר מה-payload בלי להפיל את ה-insert כשהטקסט אינו מספר.
create or replace function public.social_buyer_num(p text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
           when btrim(coalesce(p, '')) ~ '^[0-9]+(\.[0-9]+)?$'
           then btrim(p)::numeric
         end;
$$;

comment on function public.social_buyer_num(text) is
  'מספר מטקסט של payload. טקסט שאינו מספר מחזיר null ולא זורק.';

revoke all on function public.social_buyer_num(text) from public, anon, authenticated;
grant execute on function public.social_buyer_num(text) to service_role;

-- מחפש/ת משיחת גבריאלה, לא פוסט בקבוצה או במרקטפלייס.
create or replace function public.social_buyer_is_dm(p_source text, p_lead_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lead_type = 'seeker_inbound'
     and coalesce(p_source, '') ~ '^(facebook|instagram)_(dm|comment)$';
$$;

comment on function public.social_buyer_is_dm(text, text) is
  'true למחפש/ת שנכנס/ה משיחת גבריאלה (facebook_dm/comment, instagram_dm/comment), לא מפוסט סרוק.';

revoke all on function public.social_buyer_is_dm(text, text) from public, anon, authenticated;
grant execute on function public.social_buyer_is_dm(text, text) to service_role;

-- קישור לפוסט המקורי. https בלבד, ורק מארחים של פייסבוק ואינסטגרם.
create or replace function public.social_post_host_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 600
     and p_url ~ '^https://'
     and p_url !~ '^https://[^/?#]*@'
     and lower(substring(p_url from '^https://([^/:?#]+)')) in (
           'facebook.com', 'www.facebook.com', 'm.facebook.com',
           'fb.com', 'www.fb.com',
           'instagram.com', 'www.instagram.com'
         );
$$;

comment on function public.social_post_host_ok(text) is
  'true רק ל-https בלי שם משתמש בכתובת, על facebook.com, fb.com, instagram.com או m.facebook.com.';

revoke all on function public.social_post_host_ok(text) from public, anon, authenticated;
grant execute on function public.social_post_host_ok(text) to service_role;

create or replace function public.social_buyer_source_post_url(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select s.u
    from unnest(array[
           'source_post_url', 'permalink', 'post_permalink', 'comment_url', 'post_url'
         ]) with ordinality as k(key, n)
    cross join lateral (
      select nullif(btrim(p_payload->>k.key), '') as u
    ) s
   where public.social_post_host_ok(s.u)
   order by k.n
   limit 1;
$$;

comment on function public.social_buyer_source_post_url(jsonb) is
  'קישור הפוסט מ-payload, אם הוא ב-allowlist. כתובת ה-CRM אינה עוברת.';

revoke all on function public.social_buyer_source_post_url(jsonb) from public, anon, authenticated;
grant execute on function public.social_buyer_source_post_url(jsonb) to service_role;

alter table public.scraped_leads
  add column if not exists source_post_url text;

comment on column public.scraped_leads.source_post_url is
  'קישור הפוסט המקורי. לא חוזר מ-open_demand_list, מסטטיסטיקה, מהתראה או מכלי, לפני תפיסה מוצלחת. post_url של מחפש/ת מהרשתות נשאר קישור ה-CRM.';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'scraped_leads_source_post_url_chk'
  ) then
    alter table public.scraped_leads
      add constraint scraped_leads_source_post_url_chk
      check (source_post_url is null or public.social_post_host_ok(source_post_url));
  end if;
end $$;

-- תור לגבריאלה של מטא. אין בו טלפון, שם של הפונה, או קישור.
create table if not exists public.social_buyer_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  agent_first_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint social_buyer_handoffs_status_chk check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint social_buyer_handoffs_name_chk check (
    char_length(agent_first_name) between 1 and 40
    and agent_first_name !~ '[0-9]'
  )
);

comment on table public.social_buyer_handoffs is
  'תור מסירה לגבריאלה של מטא: ליד, סוכן/ת, ושם פרטי בלבד. אין טלפון. לא נשלח מכאן כלום לפונה.';

alter table public.social_buyer_handoffs enable row level security;
revoke all on table public.social_buyer_handoffs from public, anon, authenticated;
grant select, insert, update, delete on table public.social_buyer_handoffs to service_role;

-- מזהה שיחה ב-payload, אם גבריאלה שלחה אחד. אין עמודה כזו היום.
create or replace function public.social_buyer_conversation_id(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(
           p_payload->>'conversation_id',
           p_payload->>'thread_id',
           p_payload->>'meta_conversation_id',
           p_payload->>'gabriela_conversation_id',
           ''
         )), '');
$$;

comment on function public.social_buyer_conversation_id(jsonb) is
  'מזהה שיחת מטא מתוך payload של social_leads, אם נשלח. null כשאין. לא שם ולא טלפון.';

revoke all on function public.social_buyer_conversation_id(jsonb) from public, anon, authenticated;
grant execute on function public.social_buyer_conversation_id(jsonb) to service_role;

-- הצד של החיפוש. מחזיר null עד שיהיה איפה לשמור את מזהה השיחה.
-- כשתומר מחליט איפה הוא נשמר, רק הפונקציה הזו משתנה.
create or replace function public.social_buyer_search_conversation_id(p_search_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select null::text;
$$;

comment on function public.social_buyer_search_conversation_id(uuid) is
  'מזהה שיחת מטא של חיפוש שמור. null: העמודה עדיין לא קיימת. ההתאמה נופלת לקריטריונים.';

revoke all on function public.social_buyer_search_conversation_id(uuid) from public, anon, authenticated;
grant execute on function public.social_buyer_search_conversation_id(uuid) to service_role;

-- הדגל של המחפש/ת לא פועל לפני ששתי התקרות קיימות ודלוקות.
create or replace function public.social_buyer_caps_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cap int;
  v_tpl boolean := false;
begin
  v_cap := coalesce((select value::int from public.pricing_config
                      where key = 'open_demand_notify_cap_enabled'), 0);
  if v_cap <> 1 then
    return false;
  end if;
  if pg_catalog.to_regclass('public.open_demand_notify_log') is null then
    return false;
  end if;
  if pg_catalog.to_regprocedure('public.whatsapp_template_cap_on()') is null then
    return false;
  end if;
  execute 'select public.whatsapp_template_cap_on()' into v_tpl;
  return coalesce(v_tpl, false);
end;
$$;

comment on function public.social_buyer_caps_ready() is
  'true רק כשתקרת הביקוש (#1037) דלוקה, יומן הבחירה קיים, ותקרת התבניות דלוקה. אחרת מחפש/ת מהרשתות נשאר/ת במדף.';

revoke all on function public.social_buyer_caps_ready() from public, anon, authenticated;
grant execute on function public.social_buyer_caps_ready() to service_role;

-- הודעה פרטית בלי פוסט: ליד רגיל, תפיסה ותשלום כמו claim_lead, ותור בלי טלפון.
-- פוסט (source_post_url) לא עובר כאן. אין שליחה לפונה מהריפו.
create or replace function public.social_buyer_handover(p_id uuid, p_agent uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s            public.scraped_leads%rowtype;
  v_agent      uuid := coalesce(p_agent, public.current_agent_id());
  v_agency     uuid;
  v_first      text;
  v_seeker     text;
  v_phone      text;
  v_email      text;
  v_lead       uuid;
  v_claim      jsonb;
  v_queue      int;
begin
  select * into s from public.scraped_leads where id = p_id;
  if not found or not public.social_buyer_is_dm(s.source, s.lead_type) then
    return jsonb_build_object('error', 'not_social_buyer');
  end if;
  if public.social_post_host_ok(s.source_post_url) then
    return jsonb_build_object('error', 'has_post');
  end if;
  if v_agent is null then
    return jsonb_build_object('error', 'not_agent');
  end if;
  if coalesce((select value::int from public.pricing_config
                where key = 'social_buyer_open_demand_enabled'), 0) <> 1 then
    return jsonb_build_object('error', 'flag_off');
  end if;

  select m.agency_id,
         nullif(split_part(btrim(coalesce(m.display_name, '')), ' ', 1), '')
    into v_agency, v_first
    from public.agency_members m
   where m.id = v_agent
     and m.active;
  if not found then
    return jsonb_build_object('error', 'not_agent');
  end if;
  if v_first is null or v_first ~ '[0-9]' or char_length(v_first) > 40 then
    v_first := 'מתווך';
  end if;

  select ss.full_name, ss.phone, ss.email
    into v_seeker, v_phone, v_email
    from public.saved_searches ss
    join public.social_leads sl on sl.zernio_id = s.external_ref
   where ss.source = s.source
     and ss.agency_id is null
     and ss.lead_status = 'archived'
     and (
       (public.phone_tail9(ss.phone) is not null
        and public.phone_tail9(ss.phone) = public.phone_tail9(sl.payload->>'phone'))
       or (nullif(lower(btrim(coalesce(ss.email, ''))), '') is not null
           and lower(btrim(ss.email)) = lower(btrim(coalesce(sl.payload->>'email', ''))))
     )
   order by ss.id
   limit 1;
  if v_phone is null and v_email is null then
    return jsonb_build_object('error', 'no_contact');
  end if;

  begin
    select l.id into v_lead
      from public.leads l
     where l.source = s.source
       and l.external_ref = s.external_ref;
    if v_lead is null then
      insert into public.leads (
        lead_type, agent_id, agency_id, status,
        raw_name, raw_phone, raw_message,
        city, deal_type, property_type,
        source, source_detail, external_ref
      ) values (
        'seeker_inbound', v_agent, v_agency, 'masked',
        coalesce(nullif(btrim(v_seeker), ''), 'פונה מפייסבוק'),
        v_phone, null,
        s.city, s.deal_type, s.property_type,
        s.source, left(coalesce(s.source_detail, s.source), 120), s.external_ref
      )
      returning id into v_lead;
    end if;
    v_claim := public.claim_lead(v_lead, v_agent);
    if coalesce(v_claim->>'success', '') is distinct from 'true' then
      raise exception 'claim_failed';
    end if;
    v_queue := coalesce((select value::int from public.pricing_config
                          where key = 'social_buyer_handoff_enabled'), 0);
    if v_queue = 1 and not exists (
      select 1 from public.social_buyer_handoffs h where h.lead_id = v_lead
    ) then
      insert into public.social_buyer_handoffs (lead_id, agent_id, agent_first_name, status)
      values (v_lead, v_agent, v_first, 'pending');
    end if;
  exception when others then
    return jsonb_build_object(
      'error', coalesce(nullif(v_claim->>'error', ''), 'handoff_failed')
    );
  end;

  return jsonb_build_object(
    'success', true,
    'lead_id', v_lead,
    'price_charged', v_claim->'price_charged',
    'quota_source', v_claim->>'quota_source',
    'handoff', case when v_queue = 1 then 'queued' else 'off' end
  );
end;
$$;

comment on function public.social_buyer_handover(uuid, uuid) is
  'הודעה פרטית בלי פוסט: ליד masked ואז claim_lead. תור המסירה רק כשהדגל דלוק, ובלי טלפון. ההחלטה מתחלפת כאן.';

revoke all on function public.social_buyer_handover(uuid, uuid) from public, anon, authenticated;
grant execute on function public.social_buyer_handover(uuid, uuid) to service_role;

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
  v_post text;
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
  if v_flag <> 1 or not public.social_buyer_caps_ready() then
    return new;
  end if;

  -- אותו אדם יכול לפתוח שני חיפושים בחלון. מתאימים גם kind (למעלה),
  -- גם את הקריטריונים שב-payload, וגם מזהה שיחה כששני הצדדים נושאים אחד.
  -- בלי מזהה על החיפוש (social_buyer_search_conversation_id מחזיר null)
  -- נשארים הקריטריונים. השורה האחרונה מבין אלה שמתאימות.
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
     and (
       nullif(btrim(coalesce(s.payload->>'city', '')), '') is null
       or btrim(s.payload->>'city') = btrim(coalesce(new.cities[1], ''))
     )
     and (
       nullif(btrim(coalesce(s.payload->>'deal_type', '')), '') is null
       or s.payload->>'deal_type' = new.deal_type
     )
     and (
       nullif(btrim(coalesce(s.payload->>'property_type', '')), '') is null
       or btrim(s.payload->>'property_type') = btrim(coalesce(new.property_types[1], ''))
     )
     and (
       coalesce(public.social_buyer_num(s.payload->>'rooms'),
                public.social_buyer_num(s.payload->>'min_rooms')) is null
       or (
         (new.min_rooms is null
          or coalesce(public.social_buyer_num(s.payload->>'rooms'),
                      public.social_buyer_num(s.payload->>'min_rooms')) >= new.min_rooms)
         and (new.max_rooms is null
          or coalesce(public.social_buyer_num(s.payload->>'rooms'),
                      public.social_buyer_num(s.payload->>'min_rooms')) <= new.max_rooms)
       )
     )
     and (
       public.social_buyer_num(s.payload->>'max_price') is null
       or new.max_price is null
       or public.social_buyer_num(s.payload->>'max_price') = new.max_price
     )
     and (
       public.social_buyer_num(s.payload->>'min_price') is null
       or new.min_price is null
       or public.social_buyer_num(s.payload->>'min_price') = new.min_price
     )
     and (
       public.social_buyer_conversation_id(s.payload) is null
       or public.social_buyer_search_conversation_id(new.id) is null
       or public.social_buyer_conversation_id(s.payload)
          = public.social_buyer_search_conversation_id(new.id)
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

  v_post := public.social_buyer_source_post_url(
    (select sl.payload from public.social_leads sl where sl.zernio_id = v_ref));

  begin
    insert into public.scraped_leads (
      lead_type, status, source, source_detail, post_url, source_post_url, external_ref, posted_at,
      city, city_id, deal_type, property_type, rooms, budget, demand_summary,
      open_demand_at, raw_name, raw_phone, raw_message
    ) values (
      'seeker_inbound', 'open_demand', new.source,
      left(coalesce(public.lead_source_label(new.source), new.source), 120),
      -- האילוץ דורש https. זו כתובת ה-CRM, לא הפוסט. הפוסט ב-source_post_url.
      'https://shuknadlan.co.il/crm?goto=accLeads&tab=demand',
      v_post,
      v_ref, now(),
      v_city, v_city_id,
      case when new.deal_type in ('sale', 'rent') then new.deal_type end,
      nullif(left(btrim(coalesce(new.property_types[1], '')), 80), ''),
      v_rooms, v_budget, nullif(v_summary, ''),
      now(), null, null, null
    )
    on conflict (source, external_ref) do nothing;

    -- רק מצב המכירה. status (מנוי ההתראות) נשאר active כש-subscribe_alerts.
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
  'אחרי insert ל-saved_searches: מחפש/ת מ-social_leads יורד/ת מהמדף ונכנס/ת לביקוש פתוח אנונימי, רק כשהדגל 1 ושתי התקרות דלוקות. לא שולח התראה. לא נוגע ב-status של מנוי ההתראות (20271029240000).';

revoke all on function public.social_buyer_to_open_demand() from public, anon, authenticated;
grant execute on function public.social_buyer_to_open_demand() to service_role;

drop trigger if exists social_buyer_to_open_demand on public.saved_searches;
create trigger social_buyer_to_open_demand
  after insert on public.saved_searches
  for each row execute function public.social_buyer_to_open_demand();

-- הרשימה לא מוסרת את כתובת ה-CRM כאילו היא פוסט.
create or replace function public.open_demand_list()
returns table (id uuid, lead_type text, source text, source_detail text, post_url text, posted_at timestamptz,
               city text, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
               budget numeric, move_in text, summary text, open_demand_at timestamptz,
               no_broker text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.lead_type, s.source, s.source_detail,
         case when public.social_buyer_is_dm(s.source, s.lead_type) then null else s.post_url end,
         s.posted_at, s.city, s.neighborhood_id,
         s.deal_type, s.property_type, s.rooms, s.budget, s.move_in, s.demand_summary,
         coalesce(s.open_demand_at, s.created_at), s.no_broker,
         s.claimed_by is not null
    from public.scraped_leads s
   where public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     and (s.claimed_by is null or s.claimed_by = public.current_agent_id())
     and public.agent_works_city(public.current_agent_id(), s.city_id)
   order by s.claimed_by is not null, s.posted_at desc
   limit 200;
$$;

comment on function public.open_demand_list() is
  'ביקוש פתוח בערים של הסוכן/ת. source_post_url לא נבחר כאן. למחפש/ת מהרשתות post_url יוצא null, כי בעמודה יושב קישור ה-CRM. docs/scraped-leads.md';

revoke all on function public.open_demand_list() from public, anon, authenticated;
grant execute on function public.open_demand_list() to authenticated, service_role;

-- "אני פונה" על מחפש/ת מהרשתות נכנס ל-social_buyer_handover, לא לכתובת.
create or replace function public.open_demand_claim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
  s       public.scraped_leads%rowtype;
  v_cap   int;
  v_used  int;
  v_day0  timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  v_hand  jsonb;
begin
  if v_agent is null then
    return jsonb_build_object('error', 'not_agent');
  end if;
  perform pg_advisory_xact_lock(hashtext('open_demand_claim:' || v_agent::text));

  select * into s from public.scraped_leads where id = p_id for update;
  if not found
     or not public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     or not public.agent_works_city(v_agent, s.city_id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  if s.claimed_by = v_agent then
    if public.social_buyer_is_dm(s.source, s.lead_type) then
      if public.social_post_host_ok(s.source_post_url) then
        return jsonb_build_object('success', true, 'source_post_url', s.source_post_url, 'already_mine', true);
      end if;
      v_hand := public.social_buyer_handover(p_id, v_agent);
      return v_hand || jsonb_build_object('already_mine', true);
    end if;
    return jsonb_build_object('success', true, 'post_url', s.post_url, 'already_mine', true);
  end if;
  if s.claimed_by is not null then
    return jsonb_build_object('error', 'claimed');
  end if;

  v_cap := coalesce((select value from public.pricing_config where key = 'open_demand_claims_daily'), 2)::int;
  select count(*) into v_used from public.scraped_leads where claimed_by = v_agent and claimed_at >= v_day0;
  if v_used >= v_cap then
    return jsonb_build_object('error', 'daily_cap', 'daily_cap', v_cap);
  end if;

  if public.social_buyer_is_dm(s.source, s.lead_type)
     and public.social_post_host_ok(s.source_post_url) then
    update public.scraped_leads set claimed_by = v_agent, claimed_at = now() where id = p_id;
    return jsonb_build_object('success', true, 'source_post_url', s.source_post_url,
                              'my_today', v_used + 1, 'daily_cap', v_cap);
  end if;
  if public.social_buyer_is_dm(s.source, s.lead_type) then
    v_hand := public.social_buyer_handover(p_id, v_agent);
    if coalesce(v_hand->>'success', '') is distinct from 'true' then
      return v_hand;
    end if;
    update public.scraped_leads
       set claimed_by = v_agent, claimed_at = now(), lead_id = nullif(v_hand->>'lead_id', '')::uuid
     where id = p_id;
    return v_hand || jsonb_build_object('my_today', v_used + 1, 'daily_cap', v_cap);
  end if;
  update public.scraped_leads set claimed_by = v_agent, claimed_at = now() where id = p_id;
  return jsonb_build_object('success', true, 'post_url', s.post_url,
                            'my_today', v_used + 1, 'daily_cap', v_cap);
end $$;

comment on function public.open_demand_claim(uuid) is
  '"אני פונה". פוסט סרוק מחזיר post_url. מחפש/ת עם source_post_url מחזיר רק אותו. הודעה פרטית בלי פוסט פותחת ליד דרך claim_lead, בלי טלפון ב-JSON.';

revoke all on function public.open_demand_claim(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_claim(uuid) to authenticated, service_role;

-- התראה. כשהתקרה כבויה נשארת הפצת 20271029140000 (וואטסאפ ל-15).
-- מחפש/ת מהרשתות, וכל ביקוש כשהתקרה דלוקה, יוצאים עד התקרה:
-- קודם מי שלא תפס/ה ליד בחלון. בלי יומן הבחירה מחפש/ת כזה לא מופץ
-- (demand_notified_at נשאר ריק והסבב ינסה שוב). נוסח בלי המילה פוסט.
-- תקרת התבניות כבויה: ההתראה נשארת בפעמון.
create or replace function public.scraped_lead_notify_demand(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.scraped_leads%rowtype;
  v_title  text;
  v_body   text;
  v_n      int;
  v_days   int := greatest(1, coalesce(
             (select value::int from public.pricing_config
               where key = 'notif_burst_scraped_stale_days'), 14));
  v_fanout int := coalesce(
             (select value::int from public.pricing_config
               where key = 'notif_burst_demand_fanout'), 15);
  v_site   boolean;
  v_suppress boolean := false;
  v_social boolean;
  v_tpl    boolean := false;
  v_cap_on boolean;
  v_use_cap boolean;
  v_cap    int;
  v_look   int;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.claimed_by is not null
     or not public.scraped_lead_is_demand(r.status, r.lead_type, r.no_broker, r.posted_at, r.city_id) then
    return 0;
  end if;

  v_social := public.social_buyer_is_dm(r.source, r.lead_type);

  if pg_catalog.to_regprocedure('public.notifications_suppress_on()') is not null then
    execute 'select public.notifications_suppress_on()' into v_suppress;
  end if;
  v_site := coalesce(r.push_site_only, false)
    or (r.posted_at is not null and r.posted_at < now() - make_interval(days => v_days))
    or coalesce(v_suppress, false);

  if v_social and pg_catalog.to_regprocedure('public.whatsapp_template_cap_on()') is not null then
    execute 'select public.whatsapp_template_cap_on()' into v_tpl;
  end if;
  if v_social and not coalesce(v_tpl, false) then
    v_site := true;
  end if;

  v_cap_on := coalesce((select value::int from public.pricing_config
                         where key = 'open_demand_notify_cap_enabled'), 0) = 1;
  v_use_cap := (v_cap_on or v_social)
               and pg_catalog.to_regclass('public.open_demand_notify_log') is not null;
  if v_social and not v_use_cap then
    return 0;
  end if;

  v_cap := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_notify_cap'), 8), 80));
  v_look := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_pull_lookback_days'), 14), 90));

  v_title := 'ביקוש פתוח: '
    || case when r.lead_type = 'owner_inbound'
            then case r.deal_type when 'rent' then 'משכיר/ה' else 'מוכר/ת' end
            else case r.deal_type when 'rent' then 'מחפש/ת לשכור' else 'מחפש/ת לקנות' end end
    || ' ב' || r.city;
  v_body := concat_ws(' · ', r.property_type,
                      case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
                      case when r.budget is not null
                           then case when r.lead_type = 'owner_inbound' then '₪' else 'עד ₪' end
                                || to_char(r.budget, 'FM999,999,999') end,
                      case when r.move_in is not null then 'כניסה: ' || r.move_in end,
                      case when r.no_broker is not null then 'כתבו ללא תיווך' end)
    || case
         when v_social and public.social_post_host_ok(r.source_post_url)
           then '. חינם. הסוכן/ת הראשון/ה שלוחץ/ת "אני פונה" יקבל/תקבל קישור לפוסט.'
         when v_social
           then '. חינם. הסוכן/ת הראשון/ה שלוחץ/ת "אני פונה" יקבל/תקבל את פרטי הקשר.'
         else '. חינם, לסוכן/ת הראשון/ה שלוחץ/ת "אני פונה". אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.'
       end;

  if not v_use_cap then
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select s.id, 'open_demand', v_title, left(v_body, 500),
           v_site or (v_fanout > 0 and s.rn > v_fanout)
      from (
        select m.id,
               row_number() over (
                 order by
                   case
                     when a.city_id = r.city_id then 0
                     when exists (
                       select 1
                         from public.agent_lead_preferences lp
                         join public.neighborhoods n
                           on n.id = any (lp.preferred_neighborhoods)
                        where lp.agent_id = m.id
                          and lp.active
                          and n.city_id = r.city_id
                     ) then 1
                     else 2
                   end,
                   w.last_message_at desc nulls last,
                   m.id
               ) as rn
          from public.agency_members m
          left join public.agencies a on a.id = m.agency_id
          left join public.whatsapp_conversations w on w.agent_id = m.id
         where m.active
           and public.agent_works_city(m.id, r.city_id)
           and public.agent_handles_type(m.id, r.property_type, r.deal_type)
      ) s;
    get diagnostics v_n = row_count;
  else
    with eligible as (
      select m.id as agent_id, pulls.last_pull, noted.last_notified
        from public.agency_members m
        left join lateral (
          select max(x.at) as last_pull
            from (
              select l.unlocked_at as at
                from public.leads l
               where l.unlocked_by = m.id
                 and l.unlocked_at is not null
                 and l.unlocked_at >= now() - make_interval(days => v_look)
                 and l.unlocked_at > l.created_at + interval '1 second'
              union all
              select c.claimed_at
                from public.scraped_leads c
               where c.claimed_by = m.id
                 and c.claimed_at is not null
                 and c.claimed_at >= now() - make_interval(days => v_look)
            ) x
        ) pulls on true
        left join lateral (
          select max(n.created_at) as last_notified
            from public.notifications n
           where n.agent_id = m.id
             and n.type = 'open_demand'
        ) noted on true
       where m.active
         and m.released_at is null
         and coalesce(m.license_status, '') not in ('not_found', 'inactive')
         and public.notification_type_enabled(m.id, 'open_demand')
         and public.agent_works_city(m.id, r.city_id)
         and public.agent_handles_type(m.id, r.property_type, r.deal_type)
    ),
    ranked as (
      select e.agent_id, e.last_pull, e.last_notified,
             row_number() over (
               order by e.last_pull asc nulls first,
                        e.last_notified asc nulls first,
                        random()
             ) as rk
        from eligible e
    ),
    picked as (
      select * from ranked where rk <= v_cap
    ),
    ins as (
      insert into public.notifications (agent_id, type, title, body, suppress_push)
      select p.agent_id, 'open_demand', v_title, left(v_body, 500), v_site
        from picked p
      returning agent_id
    ),
    logged as (
      insert into public.open_demand_notify_log
        (scraped_lead_id, agent_id, rank, reason, last_pull_at, last_notified_at, cap, lookback_days)
      select p_id, p.agent_id, p.rk,
             case when p.last_pull is null then 'no_pull' else 'recent_pull' end,
             p.last_pull, p.last_notified, v_cap, v_look
        from picked p
        join ins i on i.agent_id = p.agent_id
      returning agent_id
    )
    select count(*)::int into v_n from ins;
  end if;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;

comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand פעם אחת. דגל כבוי: לכל סוכן/ת בעיר ובסוג, וואטסאפ ל-15. דלוק, או מחפש/ת משיחת גבריאלה: עד התקרה, קודם מי שלא תפס/ה. נוסח השיחה בלי המילה פוסט. docs/scraped-leads.md';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;
