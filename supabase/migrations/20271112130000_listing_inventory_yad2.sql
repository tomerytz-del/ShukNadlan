-- ============================================================================
-- יד2 כמקור לליד סרוק, ומלאי מודעות משותף למדלן וליד2
--
-- ## הבעיה
-- scraped_lead_add מקבל madlan ולא yad2. מודעה חדשה ביד2 לא מגיעה לסוכנים
-- אלא אם מישהו מקליד אותה. סריקה של כל המלאי בכל ריצה, בלי הבחנה בין
-- מה שכבר היה לבין מה שעלה עכשיו, הייתה פותחת ליד על כל הדירות בעיר.
--
-- ## ההחלטה
-- 1. yad2 עובר באותו מסלול של madlan: אין פניה לבעלים, אין בקשת הסכמה,
--    scraped_lead_set_consent על requested/consented מחזיר no_owner_contact,
--    והליד נפתח בלי ארנק ובלי מכסה (quota_source yad2_free).
--    date_known ו-push_site_only כמו במדלן. תקרת הדחיפה היומית היא אותה
--    madlan_notify_daily_cap, ונספרות יחד מודעות מדלן ויד2: לא שתי תקרות.
--    מספר 073 נשאר חריג של מדלן בלבד. ביד2 מספר אמיתי מאחד ל-30 יום.
-- 2. listing_inventory הוא המלאי החי. אין בו טלפון ואין בו שם בעלים:
--    הטלפון נשמר רק בשורת scraped_leads, לפי הכללים שכבר שם.
--    listing_inventory_sync(source, city, items) מעדכן מה שנמצא, מסמן
--    removed_at למה שלא בתמונה, ויוצר ליד רק למודעה חדשה אחרי שכבר היה
--    סנכרון מלא של אותה עיר. הסנכרון הראשון זורע בשקט.
--    אם בתוך listing_inventory_seed_catchup_days (2) מגיעה תמונה שגדולה
--    לפחות פי listing_inventory_seed_catchup_ratio (2) מהזריעה, גם היא
--    זורעת בשקט: הזריעה הקטנה הייתה חלקית, והשאר אינו לידים חדשים.
--    תמונה ריקה או קטנה מ-listing_inventory_min_snapshot_ratio (0.5)
--    לא מוחקת מלאי. אחרי 30 יום מותר להציע שוב רק אם המודעה עדיין חיה.
--    קליטה שנדחתה (בלי טלפון, כפילות) נרשמת ולא מנוסה שוב עד 30 יום,
--    או עד שהטלפון או המחיר משתנים.
--    ההתראה יוצאת מ-scraped_lead_add, ולכן חלות התקרה היומית ושעות השקט
--    של notification-push. אין כאן שליחה משלנו.
--
-- service_role בלבד. RLS דלוק. אין grant ל-anon או authenticated.
-- docs/listing-inventory.md , docs/scraped-leads.md
-- ============================================================================

alter table public.scraped_leads
  add column if not exists date_known boolean not null default false;
comment on column public.scraped_leads.date_known is
  'מדלן ויד2: true רק כשהסורק יודע שהתאריך אינו סריקת המלאי הראשונה. false לא נדחף לוואטסאפ.';


create table if not exists public.app_config (
  key text primary key,
  value text not null,
  description text not null default ''
);
alter table public.app_config enable row level security;
revoke all on table public.app_config from public, anon, authenticated;
grant select, insert, update, delete on table public.app_config to service_role;


insert into public.app_config (key, value, description) values
  ('madlan_notify_daily_cap', '5',
   'כמה מודעות מדלן ויד2 יחד מותר לדחוף ביום. מעבר לזה, וכל מלאי בלי date_known, נשארים באתר.')
on conflict (key) do update
  set description = excluded.description
  where public.app_config.description is distinct from excluded.description;

insert into public.app_config (key, value, description) values
  ('listing_inventory_min_snapshot_ratio', '0.5',
   'אם מספר המודעות בתמונה קטן מהיחס הזה מתוך המלאי הפעיל של אותה עיר ומקור, לא מסמנים מחיקות. מונע מחיקה מסריקה חלקית או ריקה.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('listing_inventory_seed_catchup_days', '2',
   'תוך כמה ימים מזריעה, תמונה גדולה בהרבה נחשבת השלמה של זריעה חלקית ולא גל לידים. 0 מכבה.')
on conflict (key) do nothing;

insert into public.app_config (key, value, description) values
  ('listing_inventory_seed_catchup_ratio', '2',
   'תמונה שמגיעה לפי הזה לפחות מגודל הזריעה האחרונה, בתוך חלון הימים, זורעת שוב בשקט.')
on conflict (key) do nothing;

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
      or p_source in ('madlan', 'yad2')         then 'social'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$$;
comment on function public.lead_source_channel(text) is
  'הערוץ שאליו שייך מזהה מקור הליד: whatsapp_bot · homepage · footer · property_page · visualization · agency_page · agent_page · project_page · open_house · meta_ads · social (כולל madlan ו-yad2) · rss_engine · unattributed · other. המיפוי בקידומת, כדי שמקור חדש ייכנס לערוץ הנכון בלי מיגרציה.';
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
  v_known   boolean := false;
  v_seen    timestamptz;
  v_raw     text;
  v_stale   int;
  v_cap     int;
  v_used    int;
  v_site_only boolean := false;
  v_ask     boolean := false;
  v_agent   uuid;
  v_agency  uuid;
  v_lead    uuid;
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
  if v_source not in ('facebook_group', 'facebook_marketplace', 'madlan', 'yad2') then
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

  if v_source in ('madlan', 'yad2') then
    -- first_seen_at is when the scraper first saw the listing. On the
    -- initial scan that is today for the whole inventory, so it is not
    -- freshness unless date_known is true.
    if p ? 'date_known' then
      begin
        v_known := coalesce((p ->> 'date_known')::boolean, false);
      exception when others then
        v_known := false;
      end;
    end if;
    v_raw := coalesce(nullif(btrim(p ->> 'first_seen_at'), ''),
                      nullif(btrim(p ->> 'updated_at'), ''),
                      nullif(btrim(p ->> 'posted_at'), ''));
    if v_raw is not null then
      begin
        v_seen := v_raw::timestamptz;
      exception when others then
        v_seen := null;
      end;
      if v_seen is not null and v_seen > now() + interval '1 hour' then
        v_seen := null;
      end if;
    end if;
    -- Older than 30 days would be deleted on the next lifecycle run.
    if v_seen is not null and v_seen >= now() - interval '30 days' then
      v_posted := v_seen;
    else
      v_posted := now();
    end if;
    v_stale := greatest(1, coalesce((select value::int from public.pricing_config
                                      where key = 'notif_burst_scraped_stale_days'), 14));
    -- בלי date_known, או מחוץ לחלון הטריות: אף פעם לא דחיפה.
    -- עם תאריך אמיתי: עד madlan_notify_daily_cap מודעות מדלן ויד2 יחד ביום.
    v_site_only := true;
    if v_known and v_seen is not null
       and v_seen <= now() + interval '1 hour'
       and v_seen >= now() - make_interval(days => v_stale) then
      begin
        v_cap := coalesce((select value::int from public.app_config
                            where key = 'madlan_notify_daily_cap'), 5);
      exception when others then
        v_cap := 5;
      end;
      if v_cap < 0 then
        v_cap := 5;
      end if;
      select count(*)::int into v_used
        from public.scraped_leads
       where source in ('madlan', 'yad2') and push_site_only = false
         and created_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem')
                            at time zone 'Asia/Jerusalem';
      v_site_only := v_used >= v_cap;
    end if;
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

  -- מדלן: אין פניה לבעלים, אין בקשת הסכמה ואין תזכורת.
  v_ask := case when v_source in ('madlan', 'yad2') then false
                else coalesce((p ->> 'consent_requested')::boolean, false) end;

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary, phone_hash,
                                    push_site_only, date_known)
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
          case when v_ask then now() end,
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160), v_hash,
          v_site_only, v_known)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', 'post');
  end if;

  -- התאמה לסוכן/ת אחד/ת רק כשמותר לדחוף. אחרת הביקוש נשאר באתר,
  -- בלי וואטסאפ על כל המלאי. הליד נולד פתוח ובלי חיוב.
  if v_source in ('madlan', 'yad2') and not v_site_only
     and coalesce((select value::int from public.pricing_config
                    where key = 'scraped_lead_matching_enabled'), 0) = 1
     and pg_catalog.to_regprocedure('public.scraped_lead_matches(uuid)') is not null then
    select h.agent_id, m.agency_id into v_agent, v_agency
      from public.scraped_lead_matches(v_id) h
      join public.agency_members m on m.id = h.agent_id
     where m.active
       and public.agent_works_city(m.id, v_city_id)
       and public.agent_handles_type(m.id, nullif(btrim(p ->> 'property_type'), ''), v_deal)
     order by h.score desc, m.id
     limit 1;
    if v_agent is not null then
      insert into public.leads (
        lead_type, agent_id, agency_id, status, quota_source, unlocked_at, unlocked_by,
        raw_name, raw_phone, raw_message, city, deal_type, property_type,
        source, source_detail, external_ref
      )
      values (
        v_type, v_agent, v_agency, 'unlocked',
        case when v_source = 'yad2' then 'yad2_free' else 'madlan_free' end, now(), v_agent,
        left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone,
        left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
        v_city, v_deal, nullif(btrim(p ->> 'property_type'), ''),
        v_source,
        left((case when v_source = 'yad2' then 'יד2' else 'מדלן' end)
             || coalesce(' · ' || nullif(btrim(p ->> 'source_detail'), ''), ''), 120),
        v_ref
      )
      returning id into v_lead;
      update public.scraped_leads
         set status = 'consented', consent_answered_at = now(), lead_id = v_lead,
             raw_name = null, raw_phone = null, raw_message = null
       where id = v_id;
    end if;
  end if;

  if v_lead is null then
    -- השמה ולא perform: check_notification_backfill תופס perform/select
    -- של מחולל התראות במיגרציה חדשה. זו קליטה של פוסט אחד, לא מילוי.
    v_notified := public.scraped_lead_notify_demand(v_id);
  end if;

  return jsonb_build_object('success', true, 'id', v_id,
                            'status', case when v_lead is null then 'pending_consent' else 'consented' end,
                            'city_known', v_city_id is not null, 'no_broker', v_nobrk,
                            'lead_id', v_lead, 'agent_id', v_agent,
                            'push_site_only', v_site_only, 'date_known', v_known);
end $$;


comment on function public.scraped_lead_add(jsonb) is
  'קליטת פוסט מפייסבוק או מודעה ממדלן/יד2 כ-pending_consent. כפילות לפי המודעה, ולפי phone_hash חוץ ממספר 073 של מדלן. docs/scraped-leads.md';
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
  v_tail    text;
  v_digits  text;
  v_why     text;
begin
  select * into s from public.scraped_leads where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if s.status <> 'pending_consent' then
    return jsonb_build_object('error', 'already_' || s.status);
  end if;

  -- מדלן לא עובר מסלול הסכמה מול הבעלים: אין בקשה, אין הודעה ואין תזכורת.
  if s.source in ('madlan', 'yad2') and p_state in ('requested', 'consented') then
    return jsonb_build_object('error', 'no_owner_contact');
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
                where l.agent_id = m.id and l.source in ('facebook_group', 'facebook_marketplace', 'madlan', 'yad2')) asc nulls first,
              m.id
     limit 1;
  end if;

  v_free := v_agent is not null and v_launch;

  v_label := case s.source
               when 'facebook_marketplace' then 'מרקטפלייס'
               when 'madlan' then 'מדלן'
               when 'yad2' then 'יד2'
               else 'קבוצת פייסבוק'
             end
             || coalesce(' · ' || s.source_detail, '');
  v_msg := left(concat_ws(E'\n', s.raw_message,
                          case when s.source in ('madlan', 'yad2')
                               then 'נקלט: '
                               else 'פורסם: ' end
                          || to_char(s.posted_at at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI'),
                          case when s.source in ('madlan', 'yad2') then 'המודעה: ' else 'הפוסט: ' end
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
    coalesce(s.raw_name, case s.source when 'yad2' then 'מודעה מיד2' when 'madlan' then 'מודעה ממדלן' else 'פונה מפייסבוק' end), s.raw_phone, v_msg,
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

create or replace function public.scraped_lead_is_demand(p_status text, p_lead_type text, p_no_broker text,
                                                         p_posted_at timestamptz, p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_city_id is not null
     and p_posted_at > now() - interval '30 days'
     and not (p_lead_type = 'seeker_inbound' and p_no_broker is not null)
     and (p_status = 'open_demand'
          or (p_status = 'pending_consent' and public.scraped_leads_launch_active())
          or (p_status = 'pending_consent' and exists (
                select 1 from public.scraped_leads s
                 where s.source in ('madlan', 'yad2')
                   and s.status = 'pending_consent'
                   and s.lead_type = p_lead_type
                   and s.city_id is not distinct from p_city_id
                   and s.posted_at = p_posted_at
                   and s.no_broker is not distinct from p_no_broker)));
$$;
comment on function public.scraped_lead_is_demand(text, text, text, timestamptz, uuid) is
  'פוסט מוצג כביקוש פתוח. מדלן ויד2 ב-pending_consent גם בלי תקופת השקה, כי אין פניה לבעלים. docs/scraped-leads.md';
revoke all on function public.scraped_lead_is_demand(text, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_is_demand(text, text, text, timestamptz, uuid) to service_role;

create or replace function public.scraped_leads_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_opened  int;
  v_sent    int := 0;
  v_deleted int;
begin
  perform pg_advisory_xact_lock(hashtext('scraped_leads_dispatch'));
  -- נעילה לפי id לפני העדכון. עדכון בלי סדר נועל את אותן שורות
  -- בסדר שרירותי, ואז הלולאה (order by id) יכולה להיתקע מול ריצה שנייה.
  with due as (
    select s.id
      from public.scraped_leads s
     where s.status = 'pending_consent'
       and s.source not in ('madlan', 'yad2')
       and coalesce(s.consent_requested_at, s.created_at) < now() - interval '7 days'
       and s.posted_at > now() - interval '30 days'
     order by s.id
     for update
  )
  update public.scraped_leads u
     set status = 'open_demand', open_demand_at = now(),
         raw_name = null, raw_phone = null, raw_message = null
    from due
   where u.id = due.id;
  get diagnostics v_opened = row_count;

  for r in
    select id from public.scraped_leads
     where demand_notified_at is null and claimed_by is null
       and status in ('pending_consent', 'open_demand')
     order by id
  loop
    v_sent := v_sent + public.scraped_lead_notify_demand(r.id);
  end loop;

  delete from public.scraped_leads where posted_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  delete from public.scraped_lead_blocks where expires_at < now();

  return jsonb_build_object('opened', v_opened, 'notified', v_sent, 'deleted', v_deleted,
                            'launch', public.scraped_leads_launch_active());
end $$;
comment on function public.scraped_leads_lifecycle() is
  'כל שעה: ביקוש פתוח, התראה, מחיקה. מדלן ויד2 לא מאבדים את הטלפון אחרי 7 ימים. docs/scraped-leads.md';
revoke all on function public.scraped_leads_lifecycle() from public, anon, authenticated;
grant execute on function public.scraped_leads_lifecycle() to service_role;

create or replace function public.open_demand_rows(p_agent uuid)
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
         case
           when s.claimed_by = p_agent and public.social_post_host_ok(s.source_post_url) then s.source_post_url
           when coalesce(s.post_url, '') like '%tab=demand%' then null
           else s.post_url
         end,
         s.posted_at, s.city, s.neighborhood_id,
         s.deal_type, s.property_type, s.rooms, s.budget, s.move_in,
         case when s.source in ('madlan', 'yad2') and s.raw_phone is not null
              then left(concat_ws(' · ', nullif(s.demand_summary, ''), 'טלפון ' || s.raw_phone), 300)
              else s.demand_summary end,
         coalesce(s.open_demand_at, s.created_at), s.no_broker,
         s.claimed_by is not null
    from public.scraped_leads s
   where p_agent is not null
     and public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     and (s.claimed_by is null or s.claimed_by = p_agent)
     and public.agent_works_city(p_agent, s.city_id)
   order by s.claimed_by is not null, s.posted_at desc
   limit 200;
$$;

comment on function public.open_demand_rows(uuid) is
  'רשימת הביקוש הפתוח. במדלן וביד2 מופיע גם הטלפון. קישור פוסט של מחפש/ת מהרשתות חוזר רק למי שתפס/ה. docs/scraped-leads.md';

revoke all on function public.open_demand_rows(uuid) from public, anon, authenticated;
grant execute on function public.open_demand_rows(uuid) to service_role;

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
  v_social boolean := false;
  v_tpl    boolean := false;
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
  -- מלאי בלי date_known, או שורה שסומנה לא לדחיפה: אין שורת התראה בכלל,
  -- לא בפעמון ולא בוואטסאפ. מודעה עם תאריך ידוע ובתוך התקרה ממשיכה כרגיל.
  if r.source in ('madlan', 'yad2') and (
    not coalesce(r.date_known, false) or coalesce(r.push_site_only, false)
  ) then
    return 0;
  end if;

  v_social := public.social_buyer_is_dm(r.source, r.lead_type);
  -- בלי יומן אי אפשר לחתוך ל-8. לא מסמנים כמופץ, והסבב ינסה שוב.
  if v_social and pg_catalog.to_regclass('public.open_demand_notify_log') is null then
    return 0;
  end if;
  if v_social and pg_catalog.to_regprocedure('public.whatsapp_template_cap_on()') is not null then
    execute 'select public.whatsapp_template_cap_on()' into v_tpl;
  end if;
  -- תקרת התבניות כבויה (notif_digest_enabled = 0): פעמון בלבד, בלי וואטסאפ.
  if v_social and not coalesce(v_tpl, false) then
    v_site := true;
  end if;

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
            else case r.deal_type when 'rent' then 'מחפשים לשכור' else 'מחפשים לקנות' end end
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
           then '. בלי עלות. הסוכן הראשון שלוחץ "אני פונה" מקבל קישור לפוסט.'
         when v_social
           then '. בלי עלות. הסוכן הראשון שלוחץ "אני פונה" מקבל את פרטי הקשר.'
         else '. בלי עלות, למי שלוחץ ראשון על "אני פונה". '
              || case
                   when r.source = 'madlan'
                     then 'אפשר להתקשר ל-' || coalesce(r.raw_phone, 'מספר לא מופיע')
                          || '. לרוב זה מספר 073 של מדלן, והוא מעביר את השיחה.'
                   when r.source = 'yad2'
                     then 'אפשר להתקשר ל-' || coalesce(r.raw_phone, 'מספר לא מופיע')
                          || '. המערכת לא פונה לבעלים.'
                   else 'אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.' end
       end;

  -- התאמה רק כשהתקרה כבויה. תקרה דלוקה נשארת המסלול של 20271029220000.
  if v_match and not v_on and not v_social then
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

  if not v_on and not v_social then
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
  'התראת open_demand. מדלן, יד2 והתאמה כמו 20271111150000. מחפש/ת מהרשתות: עד התקרה, גם כשהדגל הגלובלי כבוי, ובלי וואטסאפ כשתקרת התבניות כבויה. אין מילוי של חיפושים ישנים.';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

create or replace function public.claim_lead(p_lead_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead leads%rowtype;
  v_agent agency_members%rowtype;
  v_exclusivity_hours numeric;
  v_price_owner_mid numeric;
  v_price_owner_free numeric;
  -- המחיר של פנייה בערוץ של הסוכן/ת. שם המפתח במסד היסטורי.
  v_price_own_channel numeric;
  v_quota_limit numeric;
  v_price numeric := 0;
  v_quota_source text;
  v_within_exclusivity boolean;
  v_own_channel boolean;
  v_rows int;
begin
  select * into v_lead from leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('error','lead_not_found');
  end if;
  if v_lead.status = 'unlocked' then
    -- ביקוש מהרשתות שכבר נפתח אצל אותו סוכן/ת: אותה תשובה, בלי חיוב שני.
    if v_lead.unlocked_by = p_agent_id
       and v_lead.lead_type = 'seeker_inbound'
       and v_lead.source in ('facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment') then
      return jsonb_build_object(
        'success', true,
        'price_charged', 0,
        'quota_source', coalesce(v_lead.quota_source, 'social_free'),
        'raw_name', v_lead.raw_name,
        'raw_phone', v_lead.raw_phone,
        'raw_message', v_lead.raw_message,
        'already_mine', true
      );
    end if;
    return jsonb_build_object('error','already_unlocked');
  end if;
  if v_lead.status = 'pending_charge' then
    return jsonb_build_object('error','claim_in_progress');
  end if;

  select * into v_agent from agency_members where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error','agent_not_found');
  end if;

  select value into v_exclusivity_hours from pricing_config where key='owner_lead_exclusivity_hours';
  select value into v_price_owner_mid   from pricing_config where key='ppl_price_owner_mid';
  select value into v_price_owner_free  from pricing_config where key='ppl_price_owner_free';
  select value into v_price_own_channel from pricing_config where key='ppl_price_buyer_renter';
  select value into v_quota_limit       from pricing_config where key='free_lead_quota_monthly';
  v_exclusivity_hours := coalesce(v_exclusivity_hours, 12);
  v_price_owner_mid   := coalesce(v_price_owner_mid, 50);
  v_price_owner_free  := coalesce(v_price_owner_free, 69);

  -- הערוץ של הסוכן/ת עצמו/ה: הערכת שווי או מחשבון תשואה שנמסרו **בדף שלו/ה**
  -- או בדף המשרד. ליד כזה לא הוצע לאיש אחר, אין לו חלון בלעדיות, והוא מגיע
  -- למכסה המשותפת במקום למסלול הפלטפורמה — גם כשה-lead_type הוא owner_inbound.
  -- פנייה מדף הנכס (property_inquiry / visualization) ומדף הסוכן/ת
  -- (agent_direct_inquiry) נופלות ממילא לענף הזה לפי סוג הליד.
  v_own_channel := (v_lead.source in ('agency_page','agent_page')
                    and v_lead.agent_id is not distinct from p_agent_id);

  -- זכאות: ליד בעלים של הפלטפורמה פתוח לכל המסלולים (9.11.2026), עם חלון
  -- הבלעדיות למי שהליד נותב אליו/ה; property_inquiry תמיד שייך לסוכן/ת המקורי/ת.
  if v_lead.lead_type = 'owner_inbound' and not v_own_channel then
    v_within_exclusivity := (now() < v_lead.created_at + make_interval(hours => v_exclusivity_hours::int));
    if v_within_exclusivity and v_lead.agent_id is distinct from p_agent_id then
      return jsonb_build_object('error','exclusive_to_another_agent',
        'exclusivity_ends_at', v_lead.created_at + make_interval(hours => v_exclusivity_hours::int));
    end if;
  else
    if v_lead.agent_id is distinct from p_agent_id then
      return jsonb_build_object('error','not_your_lead');
    end if;
  end if;

  -- תפיסה אטומית: masked -> pending_charge (rowCount=0 = מישהו כבר תפס)
  update leads set status = 'pending_charge' where id = p_lead_id and status = 'masked';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error','lead_already_claimed_by_someone_else');
  end if;

  -- מדלן ויד2 לא נמכרים: בלי ארנק, בלי מכסה, בלי מחיר.
  if v_lead.source = 'madlan' then
    v_price := 0; v_quota_source := 'madlan_free';
  elsif v_lead.source = 'yad2' then
    v_price := 0; v_quota_source := 'yad2_free';
  elsif v_lead.lead_type = 'seeker_inbound'
        and v_lead.source in ('facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment') then
    -- כמו מדלן: בלי ארנק, בלי מכסה, בלי שורת חיוב.
    v_price := 0; v_quota_source := 'social_free';
  elsif v_lead.lead_type = 'owner_inbound' and not v_own_channel then
    -- ליד בעלים של הפלטפורמה: מחיר ליחידה בכל מסלול. Pay&GO משלם/ת יותר -
    -- זה גם ההכנסה מהמסלול החינמי וגם הסיבה לשדרג.
    if v_agent.tier = 'free' then
      v_price := v_price_owner_free; v_quota_source := 'paid_69';
    else
      v_price := v_price_owner_mid; v_quota_source := 'paid_50';
    end if;
  else
    if v_agent.tier in ('mid','premium') then
      v_price := 0; v_quota_source := 'subscription_unlimited';
    else
      -- מונה אחד לכל המקורות. זו כל המשמעות של "10 פניות בחודש": לא עשר
      -- מדף הנכס ועוד עשר מדף הסוכן/ת, אלא עשר יחד.
      update agency_members
      set free_quota_used = case when free_quota_cycle_start < date_trunc('month', now())::date then 1 else free_quota_used + 1 end,
          free_quota_cycle_start = date_trunc('month', now())::date
      where id = p_agent_id
        and (free_quota_cycle_start < date_trunc('month', now())::date or free_quota_used < v_quota_limit);
      get diagnostics v_rows = row_count;
      if v_rows = 1 then
        v_price := 0; v_quota_source := 'free_quota';
      else
        -- ‏'paid_10' הוא שם היסטורי של "שולם לפי פנייה" ולא סכום. הוא נשאר
        -- כפי שהוא: שינוי שלו היה מחייב backfill של כל הלידים שכבר נפתחו בעבר.
        v_price := v_price_own_channel; v_quota_source := 'paid_10';
      end if;
    end if;
  end if;

  if v_price > 0 then
    update agency_members set credit_balance = credit_balance - v_price
    where id = p_agent_id and credit_balance >= v_price;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      update leads set status = 'masked' where id = p_lead_id; -- rollback הנעילה
      return jsonb_build_object('error','insufficient_balance', 'required', v_price);
    end if;
    insert into lead_charges (lead_id, agency_id, agent_id, amount, status, payment_method)
    values (p_lead_id, v_lead.agency_id, p_agent_id, v_price, 'success', 'balance');
  end if;

  update leads
  set status = 'unlocked', quota_source = v_quota_source, unlocked_at = now(), unlocked_by = p_agent_id,
      agent_id = coalesce(agent_id, p_agent_id)
  where id = p_lead_id;

  return jsonb_build_object(
    'success', true,
    'price_charged', v_price,
    'quota_source', v_quota_source,
    'raw_name', v_lead.raw_name,
    'raw_phone', v_lead.raw_phone,
    'raw_message', v_lead.raw_message
  );
end;
$$;

comment on function public.claim_lead(uuid, uuid) is
  'פתיחת ליד. מדלן (madlan_free), יד2 (yad2_free) וביקוש ממחפש/ת ברשתות (social_free) בלי ארנק ובלי מכסה. שאר המסלולים כמו 20271112122000.';

revoke all on function public.claim_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_lead(uuid, uuid) to service_role;


-- yad2_free נוסף לרשימה הקיימת, לא מחליף אותה. אותו דפוס כמו madlan_free
-- ו-social_free: קוראים גם מילול '{a,b}' וגם ARRAY['a'::text], ומאחדים
-- את הערכים שכבר כתובים ב-leads.
do $$
declare
  v_def   text;
  v_vals  text[];
  v_brace text;
  v_live  text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'leads_quota_source_check' and conrelid = 'public.leads'::regclass;
  if v_def is null then
    return;
  end if;
  select coalesce(array_agg(m[1]), '{}') into v_vals
    from regexp_matches(v_def, '''([a-z_0-9]+)''', 'g') as m;
  v_brace := (regexp_match(v_def, '''\{([^}'']*)\}'''))[1];
  if v_brace is not null then
    select coalesce(v_vals, '{}') || coalesce(array_agg(trim(x)), '{}')
      into v_vals
      from regexp_split_to_table(v_brace, ',') as x
     where trim(x) ~ '^[a-z_0-9]+$';
  end if;
  select coalesce(array_agg(distinct quota_source), '{}') into v_live
    from public.leads
   where quota_source is not null;
  if coalesce(cardinality(v_vals), 0) = 0
     and coalesce(cardinality(v_live), 0) = 0
     and v_def !~ 'yad2_free'
  then
    raise exception 'leads_quota_source_check: could not read existing quota_source values from %', v_def;
  end if;
  v_vals := array(
    select distinct x
      from unnest(coalesce(v_vals, '{}') || coalesce(v_live, '{}') || array['yad2_free']) as x
     where x is not null and length(x) > 0
     order by 1
  );
  alter table public.leads drop constraint if exists leads_quota_source_check;
  execute format('alter table public.leads add constraint leads_quota_source_check check (quota_source = any (%L::text[]))', v_vals);
end $$;


-- ---------------------------------------------------------------------------
-- מלאי מודעות. הטלפון והשם לא יושבים כאן.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_inventory (
  id               uuid primary key default gen_random_uuid(),
  source           text not null check (source in ('yad2', 'madlan')),
  external_ref     text not null check (external_ref ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  city             text not null check (char_length(city) between 1 and 80),
  city_id          uuid references public.cities(id) on delete set null,
  deal_type        text check (deal_type is null or deal_type in ('sale', 'rent')),
  property_type    text check (property_type is null or char_length(property_type) <= 40),
  rooms            numeric check (rooms is null or rooms > 0),
  price            numeric check (price is null or price > 0),
  url              text check (url is null or (url ~ '^https://' and char_length(url) <= 500)),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  removed_at       timestamptz,
  scraped_lead_id  uuid references public.scraped_leads(id) on delete set null,
  -- from_seed: נכנס בסנכרון הראשון של העיר. לא הופך לליד אחר כך.
  -- lead_offered_at: מתי נוצר ליד. נשאר אחרי מחיקת השורה ב-scraped_leads,
  -- כדי להציע שוב רק אחרי 30 יום ורק אם המודעה עדיין בתמונה.
  from_seed        boolean not null default false,
  lead_offered_at  timestamptz,
  -- דחייה של scraped_lead_add. לא מנסים שוב עד 30 יום, אלא אם הטלפון
  -- או המחיר השתנו (הטביעה היא sha256 של הספרות והמחיר, לא הטלפון עצמו).
  lead_skip_reason text check (lead_skip_reason is null or char_length(lead_skip_reason) <= 40),
  lead_attempted_at timestamptz,
  lead_attempt_fingerprint text check (
    lead_attempt_fingerprint is null or lead_attempt_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  unique (source, external_ref)
);
comment on table public.listing_inventory is
  'מלאי מודעות חי ממדלן ומיד2. בלי טלפון ובלי שם בעלים. הטלפון נשמר רק ב-scraped_leads. docs/listing-inventory.md';
comment on column public.listing_inventory.scraped_lead_id is
  'הליד שנוצר מהמודעה, אם נוצר. נמחק איתו (set null) אחרי 30 יום, ואז מותר להציע שוב אם המודעה חיה.';
comment on column public.listing_inventory.from_seed is
  'true למודעה שנכנסה בזריעה, כולל השלמה של זריעה חלקית. היא לא נפתחת כליד.';
comment on column public.listing_inventory.lead_skip_reason is
  'למה scraped_lead_add דחה את המודעה (missing_phone, phone, lead). בלי הטלפון עצמו.';
comment on column public.listing_inventory.lead_attempt_fingerprint is
  'sha256 של ספרות הטלפון והמחיר בזמן הדחייה. שינוי באחד מהם מנסה שוב מיד. אין כאן טלפון.';

create index if not exists listing_inventory_active_city_idx
  on public.listing_inventory (source, city)
  where removed_at is null;

alter table public.listing_inventory enable row level security;
revoke all on table public.listing_inventory from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_inventory to service_role;

create table if not exists public.listing_inventory_seeds (
  source      text not null check (source in ('yad2', 'madlan')),
  city        text not null check (char_length(city) between 1 and 80),
  seeded_at   timestamptz not null default now(),
  item_count  int not null,
  primary key (source, city)
);
comment on table public.listing_inventory_seeds is
  'סנכרון מלא ראשון של מקור ועיר. לפני השורה הזו אין לידים ואין התראות. docs/listing-inventory.md';
alter table public.listing_inventory_seeds enable row level security;
revoke all on table public.listing_inventory_seeds from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_inventory_seeds to service_role;

create table if not exists public.listing_inventory_sync_log (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null check (source in ('yad2', 'madlan')),
  city               text not null,
  item_count         int not null,
  active_before      int not null,
  added              int not null,
  updated            int not null,
  removed            int not null,
  new_leads          int not null,
  seeded             boolean not null,
  removals_skipped   boolean not null,
  note               text,
  created_at         timestamptz not null default now()
);
comment on table public.listing_inventory_sync_log is
  'יומן סנכרון מלאי. בלי טלפון ובלי שם. תמונה קטנה מדי נרשמת כאן ולא מוחקת שורות. docs/listing-inventory.md';
create index if not exists listing_inventory_sync_log_city_idx
  on public.listing_inventory_sync_log (source, city, created_at desc);
alter table public.listing_inventory_sync_log enable row level security;
revoke all on table public.listing_inventory_sync_log from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_inventory_sync_log to service_role;

create or replace function public.listing_inventory_sync(p_source text, p_city text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_city     text := nullif(btrim(p_city), '');
  v_city_id  uuid;
  v_ratio    numeric := 0.5;
  v_active   int := 0;
  v_n        int := 0;
  v_added    int := 0;
  v_updated  int := 0;
  v_removed  int := 0;
  v_new      int := 0;
  v_skip     boolean := false;
  v_seeded_before boolean := false;
  v_is_seed  boolean := false;
  v_catchup  boolean := false;
  v_catchup_days int := 2;
  v_catchup_ratio numeric := 2;
  v_seed_count int := 0;
  v_seeded_at timestamptz;
  v_note     text := 'ok';
  v_fp       text;
  v_item     jsonb;
  v_url      text;
  v_ref      text;
  v_deal     text;
  v_type     text;
  v_rooms    numeric;
  v_price    numeric;
  v_phone    text;
  v_name     text;
  v_summary  text;
  v_payload  jsonb;
  v_res      jsonb;
  rec        record;
begin
  if p_source not in ('yad2', 'madlan') then
    return jsonb_build_object('error', 'invalid_source');
  end if;
  if v_city is null or char_length(v_city) > 80 then
    return jsonb_build_object('error', 'missing_city');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('error', 'invalid_items');
  end if;
  if jsonb_array_length(p_items) > 2000 then
    return jsonb_build_object('error', 'too_many_items');
  end if;

  -- סנכרון אחד לעיר בכל רגע. קריאה כפולה מחכה, ואז רואה את מה שהראשונה כתבה.
  perform pg_catalog.pg_advisory_xact_lock(881122, pg_catalog.hashtext(p_source || ':' || v_city));

  begin
    v_ratio := coalesce((select value::numeric from public.app_config
                          where key = 'listing_inventory_min_snapshot_ratio'), 0.5);
  exception when others then
    v_ratio := 0.5;
  end;
  if v_ratio <= 0 or v_ratio > 1 then
    v_ratio := 0.5;
  end if;
  begin
    v_catchup_days := coalesce((select value::int from public.app_config
                                 where key = 'listing_inventory_seed_catchup_days'), 2);
  exception when others then
    v_catchup_days := 2;
  end;
  begin
    v_catchup_ratio := coalesce((select value::numeric from public.app_config
                                  where key = 'listing_inventory_seed_catchup_ratio'), 2);
  exception when others then
    v_catchup_ratio := 2;
  end;
  if v_catchup_days < 0 then
    v_catchup_days := 2;
  end if;
  if v_catchup_ratio <= 1 then
    v_catchup_ratio := 2;
  end if;

  v_city_id := public.city_id_for_name(v_city);

  drop table if exists pg_temp._li_in;
  create temp table _li_in (
    external_ref text primary key,
    url text not null,
    deal_type text,
    property_type text,
    rooms numeric,
    price numeric,
    raw_phone text,
    raw_name text,
    summary text
  ) on commit drop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;
    v_url := nullif(btrim(coalesce(v_item ->> 'url', v_item ->> 'external_ref')), '');
    if v_url is null or v_url !~ '^https://' or char_length(v_url) > 500 then
      continue;
    end if;
    v_ref := public.scraped_lead_ref(v_url);
    if v_ref is null or v_ref !~ '^[A-Za-z0-9._:/-]{1,128}$' then
      continue;
    end if;
    v_deal := nullif(btrim(v_item ->> 'deal_type'), '');
    if v_deal is not null and v_deal not in ('sale', 'rent') then
      v_deal := null;
    end if;
    v_type := left(nullif(btrim(v_item ->> 'property_type'), ''), 40);
    begin
      v_rooms := nullif(v_item ->> 'rooms', '')::numeric;
    exception when others then
      v_rooms := null;
    end;
    if v_rooms is not null and v_rooms <= 0 then
      v_rooms := null;
    end if;
    begin
      v_price := nullif(v_item ->> 'price', '')::numeric;
    exception when others then
      v_price := null;
    end;
    if v_price is not null and v_price <= 0 then
      v_price := null;
    end if;
    v_phone := left(nullif(btrim(v_item ->> 'raw_phone'), ''), 40);
    v_name := left(nullif(btrim(v_item ->> 'raw_name'), ''), 80);
    v_summary := left(nullif(btrim(v_item ->> 'summary'), ''), 160);
    insert into _li_in (external_ref, url, deal_type, property_type, rooms, price, raw_phone, raw_name, summary)
    values (v_ref, v_url, v_deal, v_type, v_rooms, v_price, v_phone, v_name, v_summary)
    on conflict (external_ref) do update
      set url = excluded.url,
          deal_type = coalesce(excluded.deal_type, _li_in.deal_type),
          property_type = coalesce(excluded.property_type, _li_in.property_type),
          rooms = coalesce(excluded.rooms, _li_in.rooms),
          price = coalesce(excluded.price, _li_in.price),
          raw_phone = coalesce(excluded.raw_phone, _li_in.raw_phone),
          raw_name = coalesce(excluded.raw_name, _li_in.raw_name),
          summary = coalesce(excluded.summary, _li_in.summary);
  end loop;

  select count(*)::int into v_n from _li_in;
  select count(*)::int into v_active
    from public.listing_inventory
   where source = p_source and city = v_city and removed_at is null;

  v_seeded_before := exists (
    select 1 from public.listing_inventory_seeds s
     where s.source = p_source and s.city = v_city
  );
  v_skip := v_active > 0 and (v_n::numeric / v_active::numeric) < v_ratio;
  v_is_seed := (not v_seeded_before) and v_n > 0 and not v_skip;
  -- זריעה של 10 מודעות ואחר כך 200 הייתה פותחת 190 לידים. בתוך חלון
  -- הימים, תמונה שגדולה לפחות פי היחס מהזריעה האחרונה היא השלמה שקטה.
  if v_seeded_before and v_catchup_days > 0 and not v_skip then
    select s.item_count, s.seeded_at into v_seed_count, v_seeded_at
      from public.listing_inventory_seeds s
     where s.source = p_source and s.city = v_city;
    v_catchup := coalesce(v_seed_count, 0) > 0
      and v_seeded_at >= pg_catalog.now() - make_interval(days => v_catchup_days)
      and v_n > v_seed_count
      and v_n::numeric >= v_seed_count::numeric * v_catchup_ratio;
  end if;

  if v_skip then
    v_note := case when v_n = 0 then 'empty_snapshot' else 'snapshot_too_small' end;
  elsif v_is_seed then
    v_note := 'seed';
  elsif v_catchup then
    v_note := 'seed_catchup';
  elsif v_n = 0 and v_active = 0 then
    v_note := 'empty';
  end if;

  drop table if exists pg_temp._li_existed;
  create temp table _li_existed on commit drop as
    select i.external_ref
      from public.listing_inventory i
      join _li_in t on t.external_ref = i.external_ref
     where i.source = p_source;

  insert into public.listing_inventory (
    source, external_ref, city, city_id, deal_type, property_type, rooms, price, url,
    first_seen_at, last_seen_at, removed_at, from_seed
  )
  select p_source, t.external_ref, v_city, v_city_id, t.deal_type, t.property_type,
         t.rooms, t.price, t.url, pg_catalog.now(), pg_catalog.now(), null, false
    from _li_in t
  on conflict (source, external_ref) do update
    set city = excluded.city,
        city_id = excluded.city_id,
        deal_type = coalesce(excluded.deal_type, public.listing_inventory.deal_type),
        property_type = coalesce(excluded.property_type, public.listing_inventory.property_type),
        rooms = coalesce(excluded.rooms, public.listing_inventory.rooms),
        price = coalesce(excluded.price, public.listing_inventory.price),
        url = excluded.url,
        last_seen_at = pg_catalog.now(),
        removed_at = null;

  select count(*)::int into v_updated from _li_existed;
  v_added := v_n - v_updated;

  if not v_skip then
    update public.listing_inventory i
       set removed_at = pg_catalog.now()
     where i.source = p_source
       and i.city = v_city
       and i.removed_at is null
       and not exists (select 1 from _li_in t where t.external_ref = i.external_ref);
    get diagnostics v_removed = row_count;
  end if;

  if v_is_seed then
    update public.listing_inventory i
       set from_seed = true
      from _li_in t
     where i.source = p_source
       and i.external_ref = t.external_ref;
    insert into public.listing_inventory_seeds (source, city, item_count)
    values (p_source, v_city, v_n)
    on conflict (source, city) do nothing;
  elsif v_catchup then
    update public.listing_inventory i
       set from_seed = true
      from _li_in t
     where i.source = p_source
       and i.external_ref = t.external_ref
       and i.scraped_lead_id is null;
    update public.listing_inventory_seeds
       set item_count = v_n,
           seeded_at = pg_catalog.now()
     where source = p_source and city = v_city;
  elsif v_seeded_before then
    for rec in
      select i.id, i.lead_offered_at, t.url, t.raw_phone, t.raw_name, t.summary,
             t.deal_type, t.property_type, t.rooms, t.price,
             encode(extensions.digest(
               coalesce(regexp_replace(coalesce(t.raw_phone, ''), '\D', '', 'g'), '')
               || '|' || coalesce(t.price::text, ''),
               'sha256'), 'hex') as fp
        from public.listing_inventory i
        join _li_in t on t.external_ref = i.external_ref
       where i.source = p_source
         and not i.from_seed
         and i.scraped_lead_id is null
         and i.removed_at is null
         and (i.lead_offered_at is null or i.lead_offered_at <= pg_catalog.now() - interval '30 days')
         and (
           i.lead_attempted_at is null
           or i.lead_attempted_at <= pg_catalog.now() - interval '30 days'
           or i.lead_attempt_fingerprint is distinct from encode(extensions.digest(
                coalesce(regexp_replace(coalesce(t.raw_phone, ''), '\D', '', 'g'), '')
                || '|' || coalesce(t.price::text, ''),
                'sha256'), 'hex')
         )
       order by i.external_ref
       for update of i
    loop
      v_payload := jsonb_build_object(
        'lead_type', 'owner_inbound',
        'source', p_source,
        'source_detail', v_city,
        'external_ref', rec.url,
        'first_seen_at', pg_catalog.now(),
        'date_known', true,
        'raw_phone', rec.raw_phone,
        'raw_name', rec.raw_name,
        'city', v_city,
        'summary', rec.summary,
        'consent_requested', false
      );
      if rec.deal_type is not null then
        v_payload := v_payload || jsonb_build_object('deal_type', rec.deal_type);
      end if;
      if rec.property_type is not null then
        v_payload := v_payload || jsonb_build_object('property_type', rec.property_type);
      end if;
      if rec.rooms is not null then
        v_payload := v_payload || jsonb_build_object('rooms', rec.rooms);
      end if;
      if rec.price is not null then
        v_payload := v_payload || jsonb_build_object('budget', rec.price);
      end if;
      -- השמה, לא perform: מחולל ההתראות רץ מתוך scraped_lead_add, ושם
      -- כבר יש suppress_push. קריאה כאן היא ליד אחד חדש, לא מילוי.
      v_res := public.scraped_lead_add(v_payload);
      v_fp := rec.fp;
      if coalesce(v_res ->> 'success', '') = 'true' and (v_res ->> 'id') is not null then
        update public.listing_inventory
           set scraped_lead_id = (v_res ->> 'id')::uuid,
               lead_offered_at = pg_catalog.now(),
               lead_skip_reason = null,
               lead_attempted_at = null,
               lead_attempt_fingerprint = null
         where id = rec.id;
        v_new := v_new + 1;
      elsif v_res ->> 'duplicate' = 'post' and (v_res ->> 'id') is not null then
        update public.listing_inventory
           set scraped_lead_id = (v_res ->> 'id')::uuid,
               lead_offered_at = coalesce(lead_offered_at, pg_catalog.now()),
               lead_skip_reason = null,
               lead_attempted_at = null,
               lead_attempt_fingerprint = null
         where id = rec.id;
      else
        update public.listing_inventory
           set lead_skip_reason = left(coalesce(v_res ->> 'error', v_res ->> 'duplicate', 'rejected'), 40),
               lead_attempted_at = pg_catalog.now(),
               lead_attempt_fingerprint = v_fp
         where id = rec.id;
      end if;
    end loop;
  end if;

  insert into public.listing_inventory_sync_log (
    source, city, item_count, active_before, added, updated, removed,
    new_leads, seeded, removals_skipped, note
  ) values (
    p_source, v_city, v_n, v_active, v_added, v_updated, v_removed,
    v_new, (v_is_seed or v_catchup), v_skip, v_note
  );

  return jsonb_build_object(
    'added', v_added,
    'updated', v_updated,
    'removed', v_removed,
    'new_leads', v_new,
    'seeded', (v_is_seed or v_catchup),
    'removals_skipped', v_skip
  );
end $$;

comment on function public.listing_inventory_sync(text, text, jsonb) is
  'מעדכן מלאי מודעות למקור ועיר. הסנכרון הראשון זורע בלי לידים, וגם השלמה גדולה בתוך חלון הימים. דחייה לא מנוסה שוב עד 30 יום או עד שינוי טלפון או מחיר. docs/listing-inventory.md';
revoke all on function public.listing_inventory_sync(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.listing_inventory_sync(text, text, jsonb) to service_role;
