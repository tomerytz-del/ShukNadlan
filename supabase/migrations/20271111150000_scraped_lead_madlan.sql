-- ============================================================================
-- scraped_lead_add מקבל גם מודעות של בעלים פרטיים ממדלן
--
-- ## הבעיה
-- scraped_lead_add מקבל רק facebook_group ו-facebook_marketplace. כל מקור
-- אחר חוזר invalid_source. posted_at חובה, ופוסט מלפני יותר מ-72 שעות
-- נדחה (post_too_old). במודעה ב-madlan.co.il אין תאריך פרסום גלוי.
-- המספר במודעה הוא לעתים קרובות מספר וירטואלי של מדלן (073-...), ואותו
-- מספר מופיע בכמה מודעות של אנשים שונים. כפילות לפי טלפון הייתה מאחדת
-- אותן לליד אחד.
--
-- ## ההחלטה
-- 1. source = madlan מתקבל. אילוץ העמודה כבר source ~ '^[a-z_]{3,40}$',
--    ואין enum. אין שינוי אילוץ.
-- 2. במדלן posted_at הוא רגע הקליטה (now()), גם אם נשלח תאריך. מחיקה
--    אחרי 30 יום והשעון של הביקוש הפתוח יושבים על posted_at, ותאריך
--    ישן היה מוחק את השורה בסבב הבא. פייסבוק נשאר עם חלון 72 השעות.
-- 3. external_ref הוא כתובת המודעה. scraped_lead_ref כבר מנקה www./m.
--    ופרמטרי מעקב, והייחוד הוא (source, external_ref). כתובת
--    https://www.madlan.co.il/listings/<id> נשמרת
--    madlan.co.il/listings/<id>.
-- 4. מספר 073 של מדלן (עשר ספרות, גם עם 972) לא נכתב ל-phone_hash ולא
--    משתתף בכפילות הטלפון. מספר אמיתי במדלן ממשיך לאחד אדם ב-30 יום.
--    פוסט בפייסבוק לא נחסם בגלל מודעת מדלן עם אותו 073.
--
-- ## מה לא משתנה
-- ההרשאות ו-search_path כמו בפרודקשן (md5 של scraped_lead_add
-- c3cc4ade1698a09e1301bf07c57cf535, של scraped_lead_set_consent
-- ec1bb6189c1b9bee98a161312e64489a, של scraped_lead_notify_demand
-- e4695bdff978b479e2e41ef0d399a8a3, של lead_source_channel
-- 43ec866b747357c74837589d596434eb). service_role בלבד לכתיבה.
-- scraped_lead_matching_enabled נשאר 0. אין דגל חדש.
--
-- אידמפוטנטית: create or replace.
-- docs/scraped-leads.md
-- ============================================================================

create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source is null                       then 'other'
    when p_source like 'whatsapp\_bot%'         then 'whatsapp_bot'
    when p_source = 'rss_engine'                then 'rss_engine'
    when p_source like 'homepage%'              then 'homepage'
    when p_source = 'footer_buyer_wizard'       then 'footer'
    -- לפני property_page: ההדמיה יושבת בדף הנכס, אבל היא כלי אחר עם קהל אחר
    when p_source = 'property_page_visualization' then 'visualization'
    when p_source like 'property\_page%'        then 'property_page'
    when p_source like 'agency\_page%'
      or p_source = 'agency'                    then 'agency_page'
    when p_source like 'agent\_page%'           then 'agent_page'
    when p_source like 'project%'               then 'project_page'
    when p_source = 'open_house_page'           then 'open_house'
    when p_source like 'meta\_ads%'             then 'meta_ads'
    -- 20270806090000: גבריאלה בפייסבוק ובאינסטגרם (social-lead-intake)
    -- 20271111150000: מודעת בעלים פרטיים ממדלן נספרת באותו ערוץ, לא other
    when p_source like 'facebook\_%'
      or p_source like 'instagram\_%'
      or p_source = 'madlan'                    then 'social'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$$;
comment on function public.lead_source_channel(text) is
  'הערוץ שאליו שייך מזהה מקור הליד: whatsapp_bot · homepage · footer · property_page · visualization · agency_page · agent_page · project_page · open_house · meta_ads · social (כולל madlan) · rss_engine · unattributed · other. המיפוי בקידומת, כדי שמקור חדש ייכנס לערוץ הנכון בלי מיגרציה.';
revoke all on function public.lead_source_channel(text) from public;
revoke all on function public.lead_source_channel(text) from anon;
grant execute on function public.lead_source_channel(text) to authenticated;


create or replace function public.scraped_lead_add(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type    text := nullif(btrim(p ->> 'lead_type'), '');
  v_source  text := coalesce(nullif(btrim(p ->> 'source'), ''), 'facebook_group');
  v_url     text := nullif(btrim(p ->> 'external_ref'), '');
  v_ref     text;
  v_posted  timestamptz;
  v_phone   text := nullif(btrim(p ->> 'raw_phone'), '');
  v_tail    text;
  v_hash    text;
  v_digits  text;
  v_virtual boolean := false;
  v_city    text := nullif(btrim(p ->> 'city'), '');
  v_city_id uuid;
  v_deal    text := nullif(btrim(p ->> 'deal_type'), '');
  v_nobrk   text;
  v_id      uuid;
  v_notified int;
begin
  if v_type not in ('owner_inbound', 'seeker_inbound') then
    return jsonb_build_object('error', 'invalid_lead_type');
  end if;
  if v_source not in ('facebook_group', 'facebook_marketplace', 'madlan') then
    return jsonb_build_object('error', 'invalid_source');
  end if;
  if v_url is null or v_url !~ '^https://' then
    return jsonb_build_object('error', 'missing_post_url');
  end if;
  if v_city is null then
    return jsonb_build_object('error', 'missing_city');
  end if;
  if v_deal is not null and v_deal not in ('sale', 'rent') then
    return jsonb_build_object('error', 'invalid_deal_type');
  end if;
  v_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
  -- 073-XXXXXXX, also +972-73. Madlan shows this on many different listings.
  v_virtual := v_digits ~ '^(972)?0?73[0-9]{7}$';

  if v_source = 'madlan' then
    -- No posting date on the listing. Deletion (30 days) and the open-demand
    -- clock both use posted_at, so the scrape time is the clock. A supplied
    -- timestamp is ignored: an old guess would expire the row on the next run.
    v_posted := now();
  else
    begin
      v_posted := (p ->> 'posted_at')::timestamptz;
    exception when others then
      v_posted := null;
    end;
    if v_posted is null then
      return jsonb_build_object('error', 'missing_posted_at');
    end if;
    if v_posted < now() - interval '72 hours' or v_posted > now() + interval '1 hour' then
      return jsonb_build_object('error', 'post_too_old');
    end if;
  end if;
  v_tail := public.phone_tail9(v_phone);
  if v_tail is null then
    return jsonb_build_object('error', 'missing_phone');
  end if;
  -- A shared 073 is not a person. phone_hash stays null so day-8 dedupe
  -- cannot merge two listings, and a Facebook post is not blocked by it.
  if v_source = 'madlan' and v_virtual then
    v_hash := null;
  else
    v_hash := encode(extensions.digest(v_tail || '|shuk-scraped-v1', 'sha256'), 'hex');
  end if;

  v_ref := public.scraped_lead_ref(v_url);

  -- אותו פוסט: כבר אצלנו, או שבעליו סירב/ה
  select id into v_id from public.scraped_leads where source = v_source and external_ref = v_ref;
  if v_id is not null then
    return jsonb_build_object('duplicate', 'post', 'id', v_id);
  end if;
  if exists (select 1 from public.scraped_lead_blocks
              where ref_hash = encode(extensions.digest(v_source || '|' || v_ref, 'sha256'), 'hex')) then
    return jsonb_build_object('duplicate', 'declined');
  end if;
  -- אותו אדם ב-30 הימים האחרונים: פוסט אחר שממתין, או ליד מכל ערוץ.
  -- phone_hash נשאר אחרי ש-raw_phone נמחק (7 ימים / הסכמה).
  -- מספר 073 של מדלן הוא מרכזיה, לא אדם: לא מאחדים מודעות, ולא חוסמים
  -- פוסט בפייסבוק בגלל מודעה שכבר נשמרה עם אותו מספר.
  if not (v_source = 'madlan' and v_virtual) then
    select id into v_id from public.scraped_leads
     where created_at > now() - interval '30 days'
       and (
         (v_hash is not null and phone_hash = v_hash)
         or (
           public.phone_tail9(raw_phone) = v_tail
           and not (
             source = 'madlan'
             and regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') ~ '^(972)?0?73[0-9]{7}$'
           )
         )
       )
     limit 1;
    if v_id is not null then
      return jsonb_build_object('duplicate', 'phone', 'id', v_id);
    end if;
    if exists (select 1 from public.leads
                where public.phone_tail9(raw_phone) = v_tail
                  and created_at > now() - interval '30 days'
                  and not (
                    source = 'madlan'
                    and regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g') ~ '^(972)?0?73[0-9]{7}$'
                  )) then
      return jsonb_build_object('duplicate', 'lead');
    end if;
  end if;

  v_city_id := public.city_id_for_name(v_city);
  -- 20270823090000: "ללא תיווך" - שם הקבוצה קודם (כלל של הקבוצה), ואז הסורק / הטקסט / הפרטים
  v_nobrk := case
    when public.scraped_lead_no_broker(p ->> 'source_detail') then 'group'
    when coalesce((p ->> 'no_broker')::boolean, false)
         or public.scraped_lead_no_broker(p ->> 'raw_message')
         or public.scraped_lead_no_broker(p ->> 'property_details') then 'post'
  end;

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary, phone_hash)
  values (v_type, v_source, left(nullif(btrim(p ->> 'source_detail'), ''), 120), v_url, v_ref, v_posted,
          left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone, left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
          v_city, v_city_id,
          (select n.id from public.neighborhoods n
            where n.id::text = nullif(btrim(p ->> 'neighborhood_id'), '')
               or (n.city_id = v_city_id and n.name = nullif(btrim(p ->> 'neighborhood'), ''))
            limit 1),
          v_deal, nullif(btrim(p ->> 'property_type'), ''),
          nullif(p ->> 'rooms', '')::numeric, nullif(p ->> 'budget', '')::numeric,
          left(nullif(btrim(p ->> 'move_in'), ''), 60), left(nullif(btrim(p ->> 'property_details'), ''), 300),
          case when (p ->> 'consent_requested')::boolean then now() end,
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160), v_hash)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', 'post');
  end if;

  -- מחוץ להשקה מחזירה 0: הפוסט עוד אינו ביקוש פתוח.
  -- השמה ולא perform: check_notification_backfill תופס perform/select
  -- של מחולל התראות במיגרציה חדשה. זו קליטה של פוסט אחד, לא מילוי.
  v_notified := public.scraped_lead_notify_demand(v_id);

  return jsonb_build_object('success', true, 'id', v_id, 'status', 'pending_consent',
                            'city_known', v_city_id is not null, 'no_broker', v_nobrk,
                            'open_demand', public.scraped_lead_is_demand('pending_consent', v_type, v_nobrk, v_posted, v_city_id));
end $$;


comment on function public.scraped_lead_add(jsonb) is
  'קליטת פוסט מפייסבוק או מודעה ממדלן כ-pending_consent. כפילות לפי המודעה, ולפי phone_hash חוץ ממספר 073 של מדלן. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;

create or replace function public.scraped_lead_set_consent(p_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s         public.scraped_leads%rowtype;
  v_agent   uuid;
  v_agency  uuid;
  v_lead    uuid;
  v_msg     text;
  v_label   text;
  v_cands   int;
  v_free    boolean;
  v_by      text := 'rotation';
  v_launch  boolean := public.scraped_leads_launch_active();
  v_match   boolean;
  v_hit     record;
  v_line    text;
  v_street  text;
  v_prooms  numeric;
begin
  select * into s from public.scraped_leads where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if s.status <> 'pending_consent' then
    return jsonb_build_object('error', 'already_' || s.status);
  end if;

  if p_state = 'requested' then
    update public.scraped_leads set consent_requested_at = coalesce(consent_requested_at, now()) where id = p_id;
    return jsonb_build_object('success', true, 'status', 'pending_consent');
  end if;

  if p_state = 'declined' then
    insert into public.scraped_lead_blocks (ref_hash, expires_at)
    values (encode(extensions.digest(s.source || '|' || s.external_ref, 'sha256'), 'hex'), s.posted_at + interval '30 days')
    on conflict (ref_hash) do nothing;
    delete from public.scraped_leads where id = p_id;
    return jsonb_build_object('success', true, 'status', 'deleted');
  end if;

  if p_state <> 'consented' then
    return jsonb_build_object('error', 'invalid_state');
  end if;

  v_match := coalesce((select value::int from public.pricing_config
                        where key = 'scraped_lead_matching_enabled'), 0) = 1;

  select count(*) into v_cands
    from public.agency_members m
   where m.active and public.agent_works_city(m.id, s.city_id)
     and public.agent_handles_type(m.id, s.property_type, s.deal_type)
     and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch);

  if s.claimed_by is not null then
    select m.id, m.agency_id into v_agent, v_agency
      from public.agency_members m
     where m.id = s.claimed_by and m.active
       and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch);
    if v_agent is not null then
      v_by := 'claim';
    end if;
  end if;

  if v_agent is null and v_match then
    select m.id, m.agency_id into v_agent, v_agency
      from public.scraped_lead_matches(p_id) h
      join public.agency_members m on m.id = h.agent_id
     where m.active
       and public.agent_works_city(m.id, s.city_id)
       and public.agent_handles_type(m.id, s.property_type, s.deal_type)
       and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch)
     order by h.score desc, m.id
     limit 1;
    if v_agent is not null then
      v_by := 'match';
    end if;
  end if;

  if v_agent is null then
    select m.id, m.agency_id into v_agent, v_agency
      from public.agency_members m
     where m.active and public.agent_works_city(m.id, s.city_id)
       and public.agent_handles_type(m.id, s.property_type, s.deal_type)
       and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch)
     order by (select max(l.created_at) from public.leads l
                where l.agent_id = m.id and l.source in ('facebook_group', 'facebook_marketplace', 'madlan')) asc nulls first,
              m.id
     limit 1;
  end if;

  v_free := v_agent is not null and v_launch;

  v_label := case s.source
               when 'facebook_marketplace' then 'מרקטפלייס'
               when 'madlan' then 'מדלן'
               else 'קבוצת פייסבוק'
             end
             || coalesce(' · ' || s.source_detail, '');
  v_msg := left(concat_ws(E'\n', s.raw_message,
                          case when s.source = 'madlan'
                               then 'נקלט: '
                               else 'פורסם: ' end
                          || to_char(s.posted_at at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI'),
                          case when s.source = 'madlan' then 'המודעה: ' else 'הפוסט: ' end
                          || s.post_url), 4000);

  insert into public.leads (
    lead_type, agent_id, agency_id, status, quota_source, unlocked_at, unlocked_by,
    raw_name, raw_phone, raw_message,
    city, neighborhood_id, deal_type, property_type, property_details,
    source, source_detail, external_ref,
    budget, rooms, move_in, budget_source, rooms_source, move_in_source
  )
  values (
    s.lead_type, v_agent, v_agency,
    case when v_free then 'unlocked' else 'masked' end,
    case when v_free then 'launch_free' end,
    case when v_free then now() end,
    case when v_free then v_agent end,
    coalesce(s.raw_name, case when s.source = 'madlan' then 'פונה ממדלן' else 'פונה מפייסבוק' end), s.raw_phone, v_msg,
    s.city, s.neighborhood_id, s.deal_type, s.property_type,
    nullif(concat_ws(' · ', s.property_details,
                     case when s.rooms is not null then trim_scale(s.rooms)::text || ' חדרים' end,
                     case when s.budget is not null then 'עד ₪' || to_char(s.budget, 'FM999,999,999') end,
                     case when s.move_in is not null then 'כניסה: ' || s.move_in end), ''),
    s.source, left(v_label, 120), s.external_ref,
    s.budget, s.rooms, s.move_in,
    case when s.budget is not null then 'scraped_lead' end,
    case when s.rooms is not null then 'scraped_lead' end,
    case when s.move_in is not null then 'scraped_lead' end
  )
  on conflict (source, external_ref) where external_ref is not null do nothing
  returning id into v_lead;

  if v_lead is null then
    select id into v_lead from public.leads where source = s.source and external_ref = s.external_ref;
  end if;

  update public.scraped_leads
     set status = 'consented', consent_answered_at = now(), lead_id = v_lead,
         raw_name = null, raw_phone = null, raw_message = null
   where id = p_id;

  if v_match and v_by = 'match' and v_agent is not null and v_lead is not null then
    select h.score, h.match_kind, h.matched_client_ids, h.matched_property_ids, h.exact
      into v_hit
      from public.scraped_lead_matches(p_id) h
     where h.agent_id = v_agent;
    if found then
      v_street := null;
      v_prooms := null;
      if v_hit.match_kind = 'has_property' and v_hit.matched_property_ids[1] is not null then
        select p.street, p.rooms into v_street, v_prooms
          from public.properties p
         where p.id = v_hit.matched_property_ids[1];
      end if;
      v_line := public.scraped_lead_match_line(v_hit.match_kind, v_hit.exact, v_prooms, v_street);
      update public.notifications n
         set match_score = v_hit.score,
             match_kind = v_hit.match_kind,
             matched_client_ids = v_hit.matched_client_ids,
             matched_property_ids = v_hit.matched_property_ids,
             body = left(n.body || coalesce(E'\n' || v_line, ''), 500)
       where n.related_lead_id = v_lead
         and n.agent_id = v_agent
         and n.type = 'new_lead';
      insert into public.scraped_lead_match_dispatch (
        scraped_lead_id, agent_id, lead_id, wave, score, match_kind,
        matched_client_ids, matched_property_ids
      )
      values (
        p_id, v_agent, v_lead, 1, v_hit.score, v_hit.match_kind,
        v_hit.matched_client_ids, v_hit.matched_property_ids
      )
      on conflict (scraped_lead_id, agent_id) do nothing;
    end if;
  end if;

  perform public.log_lead_routing(jsonb_build_object(
    'source', s.source,
    'lead_kind', case when s.lead_type = 'owner_inbound' then 'agent_owner' else 'agent_buyer' end,
    'lead_table', 'leads',
    'lead_id', v_lead,
    'routing', case when v_agent is not null then 'assigned' else 'unrouted' end,
    'recipients', case when v_agent is not null then 1 else 0 end,
    'reason', case when v_agent is null then 'no_agent_in_city' end,
    'summary', concat_ws(' · ', case s.lead_type when 'owner_inbound' then 'בעלים' else 'מחפש/ת' end,
                         case s.deal_type when 'rent' then 'השכרה' when 'sale' then 'מכירה' end,
                         s.property_type, s.city, v_label,
                         case when v_by = 'claim' then 'למי שפנה/תה מהביקוש הפתוח' end,
                         case when v_by = 'match' then 'התאמה' end,
                         case when v_free then 'השקה: בחינם' end),
    'city', s.city,
    'neighborhood_id', s.neighborhood_id,
    'deal_type', s.deal_type,
    'property_type', s.property_type,
    'assigned_agent_id', v_agent));

  return jsonb_build_object('success', true, 'status', 'consented', 'lead_id', v_lead,
                            'agent_id', v_agent, 'candidates', v_cands, 'launch_free', v_free,
                            'assigned_by', v_by);
end $$;


comment on function public.scraped_lead_set_consent(uuid, text) is
  'requested / consented / declined. דגל התאמה דלוק: הליד לציון הגבוה, אחרי מי שתפס/ה. כבוי: הסבב הישן. docs/scraped-leads.md';

revoke all on function public.scraped_lead_set_consent(uuid, text) from public, anon, authenticated;
grant execute on function public.scraped_lead_set_consent(uuid, text) to service_role;

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
  v_n      int := 0;
  v_days   int := greatest(1, coalesce(
             (select value::int from public.pricing_config
               where key = 'notif_burst_scraped_stale_days'), 14));
  v_site   boolean;
  v_on     boolean;
  v_cap    int;
  v_fanout int;
  v_look   int;
  v_suppress boolean := false;
  v_match  boolean;
  v_done   boolean := false;
  v_hits   int := 0;
  v_all    int := 0;
  v_prior  int := 0;
  v_rn     int := 0;
  v_nid    uuid;
  v_line   text;
  v_street text;
  v_prooms numeric;
  rec      record;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.claimed_by is not null
     or not public.scraped_lead_is_demand(r.status, r.lead_type, r.no_broker, r.posted_at, r.city_id) then
    return 0;
  end if;

  if pg_catalog.to_regprocedure('public.notifications_suppress_on()') is not null then
    execute 'select public.notifications_suppress_on()' into v_suppress;
  end if;
  v_site := coalesce(r.push_site_only, false)
    or (r.posted_at is not null and r.posted_at < now() - make_interval(days => v_days))
    or coalesce(v_suppress, false);

  v_on := coalesce((select value::int from public.pricing_config
                     where key = 'open_demand_notify_cap_enabled'), 0) = 1;
  v_match := coalesce((select value::int from public.pricing_config
                        where key = 'scraped_lead_matching_enabled'), 0) = 1;
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
    || '. חינם, לסוכן/ת הראשון/ה שלוחץ/ת "אני פונה". '
    || case when r.source = 'madlan'
            then 'אפשר להגיב רק במודעה במדלן, לא ב-SMS ולא בוואטסאפ.'
            else 'אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.' end;

  -- התאמה רק כשהתקרה כבויה. תקרה דלוקה נשארת המסלול של 20271029220000.
  if v_match and not v_on then
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);

    if r.match_first_at is not null
       and r.match_first_at > now() - interval '30 minutes' then
      return 0;
    elsif r.match_first_at is not null then
      select count(*)::int into v_rn
        from public.scraped_lead_match_dispatch d
       where d.scraped_lead_id = p_id;
      for rec in
        select a.agent_id
          from public.scraped_lead_demand_audience(p_id) a
         where not exists (
           select 1 from public.scraped_lead_match_dispatch d
            where d.scraped_lead_id = p_id and d.agent_id = a.agent_id
         )
         order by a.base_rn
      loop
        v_rn := v_rn + 1;
        insert into public.notifications (agent_id, type, title, body, suppress_push)
        values (
          rec.agent_id, 'open_demand', v_title, left(v_body, 500),
          v_site or (v_fanout > 0 and v_rn > v_fanout)
        )
        returning id into v_nid;
        insert into public.scraped_lead_match_dispatch
          (scraped_lead_id, agent_id, notification_id, wave, score)
        values (p_id, rec.agent_id, v_nid, 2, 0);
        v_n := v_n + 1;
      end loop;
      update public.scraped_leads set demand_notified_at = now() where id = p_id;
      return v_n;
    else
      select count(*)::int into v_all from public.scraped_lead_demand_audience(p_id);
      select count(*)::int into v_hits
        from public.scraped_lead_matches(p_id) h
        join public.scraped_lead_demand_audience(p_id) a on a.agent_id = h.agent_id;
      if v_hits > 0 then
        for rec in
          select h.agent_id, h.score, h.match_kind, h.matched_client_ids, h.matched_property_ids, h.exact
            from public.scraped_lead_matches(p_id) h
            join public.scraped_lead_demand_audience(p_id) a on a.agent_id = h.agent_id
           order by h.score desc, a.base_rn
        loop
          v_rn := v_rn + 1;
          v_street := null;
          v_prooms := null;
          if rec.match_kind = 'has_property' and rec.matched_property_ids[1] is not null then
            select p.street, p.rooms into v_street, v_prooms
              from public.properties p
             where p.id = rec.matched_property_ids[1];
          end if;
          v_line := public.scraped_lead_match_line(rec.match_kind, rec.exact, v_prooms, v_street);
          insert into public.notifications (
            agent_id, type, title, body, suppress_push,
            match_score, match_kind, matched_client_ids, matched_property_ids
          )
          values (
            rec.agent_id, 'open_demand', v_title,
            left(v_body || coalesce(E'\n' || v_line, ''), 500),
            v_site or (v_fanout > 0 and v_rn > v_fanout),
            rec.score, rec.match_kind, rec.matched_client_ids, rec.matched_property_ids
          )
          returning id into v_nid;
          insert into public.scraped_lead_match_dispatch (
            scraped_lead_id, agent_id, notification_id, wave, score, match_kind,
            matched_client_ids, matched_property_ids
          )
          values (
            p_id, rec.agent_id, v_nid, 1, rec.score, rec.match_kind,
            rec.matched_client_ids, rec.matched_property_ids
          );
          v_n := v_n + 1;
        end loop;
        if v_hits >= v_all then
          update public.scraped_leads
             set demand_notified_at = now(), match_first_at = now()
           where id = p_id;
        else
          update public.scraped_leads set match_first_at = now() where id = p_id;
        end if;
        return v_n;
      end if;
    end if;
  end if;

  -- מי שכבר קיבל בגל הראשון לא מקבל שוב, ונספר בתקרת 15.
  v_prior := coalesce((
    select count(*)::int from public.scraped_lead_match_dispatch d
     where d.scraped_lead_id = p_id
  ), 0);

  if not v_on then
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select s.id, 'open_demand', v_title, left(v_body, 500),
           v_site or (v_fanout > 0 and (s.rn + v_prior) > v_fanout)
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
           and not exists (
             select 1 from public.scraped_lead_match_dispatch d
              where d.scraped_lead_id = p_id and d.agent_id = m.id
           )
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
              select s.claimed_at
                from public.scraped_leads s
               where s.claimed_by = m.id
                 and s.claimed_at is not null
                 and s.claimed_at >= now() - make_interval(days => v_look)
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
         and not exists (
           select 1 from public.scraped_lead_match_dispatch d
            where d.scraped_lead_id = p_id and d.agent_id = m.id
         )
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
      select * from ranked where rk <= greatest(0, v_cap - v_prior)
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
    select count(*)::int into v_n
      from ins;
  end if;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;



comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand. תקרה שנדלקת אחרי גל התאמה סופרת את מי שכבר קיבל. מדלן: להגיב במודעה, לא בפייסבוק. docs/scraped-leads.md';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;
