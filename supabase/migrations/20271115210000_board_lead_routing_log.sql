-- ============================================================================
-- ליד יד2/מדלן שנולד ב-scraped_lead_add נרשם ביומן הניתוב
--
-- ## הבעיה
-- ענף הלוח (madlan/yad2, לא push_site_only, כשההתאמה דלוקה) מכניס ל-leads
-- עם quota_source yad2_free או madlan_free ומסמן את scraped_leads כ-consented,
-- ולא קורא ל-log_lead_routing. docs/lead-routing.md: לכל ליד שורה ב-
-- lead_routing_log. ב-15.11.2026 חמש שורות yad2_free שנמסרו ב-16:07
-- (שעון ישראל) בלי שורה ביומן.
--
-- ## הבסיס
-- scraped_lead_add הועתקה מהגרסה שרצה אחרי 20271115120000 ו-20271115130000.
-- md5(prosrc) בפרודקשן ב-15.11.2026: 6d35c4cd6a99b780afa9a4ca24286155
-- (אורך 11553). שני השינויים בגוף, וכל השאר זהה, כולל push_site_only
-- ותקרת app_config.madlan_notify_daily_cap:
--   1. pg_advisory_xact_lock במפתח קבוע 881151301, מיד לפני ספירת התקרה.
--   2. אחרי insert ל-leads וה-update של scraped_leads: log_lead_routing
--      בהשמה (לא perform), routing=assigned, lead_kind=agent_owner.
--      לא unrouted: הערך הזה מעיר את כל מנהלי הפלטפורמה.
--      בלי טלפון.
--
-- ## מילוי
-- שורות קיימות עם quota_source yad2_free או madlan_free בלי שורת יומן
-- נכנסות כ-assigned, עם created_at של הליד. on conflict do nothing.
-- אין insert ל-notifications ואין קריאה למחולל התראות.
--
-- ## הרשאות (ללא שינוי)
-- revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
-- grant execute on function public.scraped_lead_add(jsonb) to service_role;
--
-- אידמפוטנטית. docs/scraped-leads.md, docs/lead-routing.md
-- ============================================================================

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
  v_routed  jsonb;
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
  -- 073, 083, 093, 033, also +972. Madlan shows these on many listings.
  v_virtual := public.madlan_switchboard_phone(v_phone);

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
    -- date_known בלי חותמת: המודעה נקלטה עכשיו. היעדר first_seen_at
    -- לבדו אינו מלאי ישן, ולכן לא משאיר אותה רק באתר. תאריך שנשלח
    -- ולא נקרא, או date_known false, נשארים בלי דחיפה.
    if v_known and v_seen is null and v_raw is null then
      v_seen := now();
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
      -- תקרה משותפת למדלן וליד2. מפתח קבוע, לפני הספירה, כדי ששתי
      -- קליטות במקביל לא יעברו יחד את madlan_notify_daily_cap.
      perform pg_catalog.pg_advisory_xact_lock(881151301);
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
  -- Yad2 and Madlan listings arrive without a phone on purpose. Every
  -- other source still needs one. The date_known window above is unchanged.
  if v_tail is null and v_source not in ('madlan', 'yad2') then
    return jsonb_build_object('error', 'missing_phone');
  end if;
  -- A Madlan switchboard number is not a person. phone_hash stays null so
  -- day-8 dedupe cannot merge two listings, and a Facebook post is not
  -- blocked by it. No phone at all: nothing to hash.
  if v_tail is null or (v_source = 'madlan' and v_virtual) then
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
  -- מספר מרכזיה של מדלן (073, 083, 093, 033) אינו אדם: לא מאחדים
  -- מודעות, ולא חוסמים פוסט בפייסבוק בגלל מודעה עם אותו מספר.
  -- No phone: nothing to merge. A Madlan switchboard number is not a person.
  if v_tail is not null and not (v_source = 'madlan' and v_virtual) then
    select id into v_id from public.scraped_leads
     where created_at > now() - interval '30 days'
       and (
         (v_hash is not null and phone_hash = v_hash)
         or (
           public.phone_tail9(raw_phone) = v_tail
           and not (source = 'madlan' and public.madlan_switchboard_phone(raw_phone))
         )
       )
     limit 1;
    if v_id is not null then
      return jsonb_build_object('duplicate', 'phone', 'id', v_id);
    end if;
    if exists (select 1 from public.leads
                where public.phone_tail9(raw_phone) = v_tail
                  and created_at > now() - interval '30 days'
                  and not (source = 'madlan' and public.madlan_switchboard_phone(raw_phone))) then
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
      -- יומן הניתוב. השמה ולא perform: check_notification_backfill
      -- תופס perform/select של מחולל התראות. הרישום הוא שיוך לסוכן/ת,
      -- בלי טלפון ובלי שם, ולא מעיר את מנהלי הפלטפורמה.
      v_routed := public.log_lead_routing(jsonb_build_object(
        'source', v_source,
        'lead_kind', 'agent_owner',
        'lead_table', 'leads',
        'lead_id', v_lead,
        'routing', 'assigned',
        'recipients', 1,
        'assigned_agent_id', v_agent,
        'city', v_city,
        'deal_type', v_deal,
        'property_type', nullif(btrim(p ->> 'property_type'), ''),
        'summary', left(concat_ws(' · ',
          case when v_source = 'yad2' then 'יד2' else 'מדלן' end,
          case v_deal when 'rent' then 'השכרה' when 'sale' then 'מכירה' end,
          nullif(btrim(p ->> 'property_type'), ''),
          v_city,
          nullif(btrim(p ->> 'summary'), '')
        ), 300)
      ));
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
  'קליטת פוסט מפייסבוק או מודעה ממדלן/יד2. בלוח, date_known בלי first_seen_at נחשב רגע הקליטה ולא מלאי ישן. date_known false נשאר באתר. בלי טלפון רק למדלן וליד2. מספר מרכזיה של מדלן (073, 083, 093, 033) לא משתתף בכפילות. ליד שנולד לסוכן/ת נרשם assigned ב-lead_routing_log, בלי טלפון. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;

-- מילוי חד-פעמי. routing הוא assigned, ולכן הטריגר על היומן חוזר
-- לפני insert ל-notifications. אין כאן טלפון, שם או טקסט גולמי.
insert into public.lead_routing_log (
  source, lead_kind, lead_table, lead_id, routing, recipients,
  summary, city, deal_type, property_type, assigned_agent_id, created_at
)
select
  left(coalesce(nullif(btrim(l.source), ''),
           case l.quota_source when 'yad2_free' then 'yad2' else 'madlan' end), 60),
  'agent_owner',
  'leads',
  l.id,
  'assigned',
  1,
  left(concat_ws(' · ',
    case l.quota_source when 'yad2_free' then 'יד2' else 'מדלן' end,
    case l.deal_type when 'rent' then 'השכרה' when 'sale' then 'מכירה' end,
    nullif(btrim(l.property_type), ''),
    nullif(btrim(l.city), '')
  ), 300),
  nullif(btrim(l.city), ''),
  nullif(btrim(l.deal_type), ''),
  nullif(btrim(l.property_type), ''),
  (select m.id from public.agency_members m where m.id = l.agent_id),
  l.created_at
from public.leads l
where l.quota_source in ('yad2_free', 'madlan_free')
  and not exists (
    select 1
      from public.lead_routing_log r
     where r.lead_table = 'leads'
       and r.lead_id = l.id
  )
on conflict (lead_table, lead_id) do nothing;
