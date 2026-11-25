-- ============================================================================
-- תקרת דחיפה נפרדת למדלן וליד2
--
-- ## הבעיה
-- scraped_lead_add ספרה מודעות מדלן ויד2 יחד מול app_config.madlan_notify_daily_cap
-- (ברירת מחדל 5). הספירה היא שורות scraped_leads עם source in ('madlan','yad2'),
-- push_site_only = false, ו-created_at מאז חצות Asia/Jerusalem. כשהתקרה מלאה
-- השורה נשמרת עם push_site_only = true, אין שיוך לסוכן/ת, ו-
-- scraped_lead_notify_demand מחזירה 0.
-- ב-22.11.2026 חמש מודעות יד2 בעפולה מילאו את התקרה ב-08:08 (צילום יד2
-- מגיע פעמיים ביום מסוכן Base44). ארבע מודעות מדלן שנקלטו ב-12:39 קיבלו
-- push_site_only = true, ואף סוכן/ת לא קיבל/ה התראה.
--
-- ## ההחלטה
-- לכל מקור תקרה משלו. madlan_notify_daily_cap סופר רק source = 'madlan'.
-- מפתח חדש yad2_notify_daily_cap, ברירת מחדל 5, סופר רק source = 'yad2'.
-- נספרות רק שורות עם push_site_only = false מאז חצות בישראל. מעל התקרה
-- של המקור, השורה נשארת באתר כמו קודם. שאר ההתנהגות זהה: date_known,
-- חלון הטריות, שיוך כשההתאמה דלוקה, scraped_lead_notify_demand, זריעה
-- שקטה בסנכרון הראשון, ותקציר הוואטסאפ (notif_digest_enabled).
-- הנעילה נפרדת: מדלן נשאר על 881151301, יד2 על 881151302, כדי שקליטות
-- מקבילות של אותו מקור לא יעברו יחד את התקרה שלו.
-- listing_inventory_sync ו-listing-inventory-intake לא סופרים בעצמם.
-- הם קוראים ל-scraped_lead_add, ולכן התקרה החדשה חלה גם עליהם.
-- הערך הקיים של madlan_notify_daily_cap לא נדרס. מתעדכן רק התיאור.
--
-- ## הבסיס
-- scraped_lead_add מהגרסה של 20271121160000. md5(prosrc) בפרודקשן:
-- c2cdecae5a38cb6feeff96e51fd6c788 (אורך 19257). הגוף זהה מלבד התקרה.
-- אידמפוטנטית. service_role בלבד, כמו הגרסה הקודמת.
-- docs/scraped-leads.md , docs/listing-inventory.md
-- ============================================================================

insert into public.app_config (key, value, description) values
  ('madlan_notify_daily_cap', '5',
   'כמה מודעות מדלן ביום מותר לדחוף לסוכנים. נספרות רק שורות מדלן ש-push_site_only שלהן false, מאז חצות לפי Asia/Jerusalem. יד2 נספר בנפרד ב-yad2_notify_daily_cap. מעבר לתקרה, וכל מלאי בלי date_known, נשארים באתר.')
on conflict (key) do update
  set description = excluded.description
  where public.app_config.description is distinct from excluded.description;

insert into public.app_config (key, value, description) values
  ('yad2_notify_daily_cap', '5',
   'כמה מודעות יד2 ביום מותר לדחוף לסוכנים. נספרות רק שורות יד2 ש-push_site_only שלהן false, מאז חצות לפי Asia/Jerusalem. מדלן נספר בנפרד ב-madlan_notify_daily_cap. מעבר לתקרה, וכל מלאי בלי date_known, נשארים באתר.')
on conflict (key) do update
  set description = excluded.description
  where public.app_config.description is distinct from excluded.description;

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
  v_cap_key text;
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
  v_details jsonb;
  v_area    text;
  v_size    numeric;
  v_floor   int;
  v_floor_n numeric;
  v_budget_fallback numeric;
  v_rooms_fallback numeric;
  v_deal_fallback text;
  v_block   boolean := false;
  v_dup     jsonb;
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

  -- שדות מלאי ומחפש/ת לפייסבוק בלבד. יד2 ומדלן לא נקראים מכאן.
  -- ערך לא סביר נזרק. תקציב או חדרים לא תקינים בשדה העליון עדיין
  -- מפילים את ההכנסה, כמו קודם, ורק אחרי בדיקת הכפילות.
  v_details := null;
  v_area := null;
  v_size := null;
  v_floor := null;
  v_budget_fallback := null;
  v_rooms_fallback := null;
  v_deal_fallback := null;
  if v_source = 'facebook_group' then
    if left(btrim(coalesce(p ->> 'property_details', '')), 1) = '{' then
      begin
        v_details := btrim(p ->> 'property_details')::jsonb;
      exception when others then
        v_details := null;
      end;
    end if;
    v_area := public.listing_area_text(coalesce(
      nullif(btrim(p ->> 'neighborhood'), ''),
      nullif(btrim(v_details ->> 'neighborhood'), '')));
    begin
      v_size := nullif(coalesce(p ->> 'size_sqm', v_details ->> 'size_sqm'), '')::numeric;
    exception when others then
      v_size := null;
    end;
    if v_size is not null and (v_size < 5 or v_size > 100000 or v_size = 'NaN'::numeric) then
      v_size := null;
    end if;
    begin
      v_floor_n := nullif(coalesce(p ->> 'floor', v_details ->> 'floor'), '')::numeric;
    exception when others then
      v_floor_n := null;
    end;
    if v_floor_n is not null and v_floor_n = trunc(v_floor_n)
       and v_floor_n >= -5 and v_floor_n <= 120 then
      v_floor := v_floor_n::int;
    end if;
    begin
      if v_type = 'owner_inbound' then
        v_budget_fallback := nullif(coalesce(
          p ->> 'price', v_details ->> 'price', v_details ->> 'budget'), '')::numeric;
      else
        v_budget_fallback := nullif(v_details ->> 'budget', '')::numeric;
      end if;
    exception when others then
      v_budget_fallback := null;
    end;
    if v_budget_fallback is not null and (
         v_budget_fallback <= 0 or v_budget_fallback = 'NaN'::numeric
         or v_budget_fallback > 100000000000) then
      v_budget_fallback := null;
    end if;
    begin
      v_rooms_fallback := nullif(v_details ->> 'rooms', '')::numeric;
    exception when others then
      v_rooms_fallback := null;
    end;
    if v_rooms_fallback is not null and v_rooms_fallback <= 0 then
      v_rooms_fallback := null;
    end if;
    v_deal_fallback := nullif(btrim(v_details ->> 'deal_type'), '');
    if v_deal_fallback is not null and v_deal_fallback not in ('sale', 'rent') then
      v_deal_fallback := null;
    end if;
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
    -- עם תאריך אמיתי: לכל מקור תקרה משלו. מדלן נספר רק מול
    -- madlan_notify_daily_cap, ויד2 רק מול yad2_notify_daily_cap.
    -- שורה של המקור השני, או שורה עם push_site_only, אינה תופסת מקום.
    v_site_only := true;
    if v_known and v_seen is not null
       and v_seen <= now() + interval '1 hour'
       and v_seen >= now() - make_interval(days => v_stale) then
      v_cap_key := case when v_source = 'yad2' then 'yad2_notify_daily_cap'
                         else 'madlan_notify_daily_cap' end;
      begin
        v_cap := coalesce((select value::int from public.app_config
                            where key = v_cap_key), 5);
      exception when others then
        v_cap := 5;
      end;
      if v_cap < 0 then
        v_cap := 5;
      end if;
      -- מפתח נעילה נפרד לכל מקור, לפני הספירה, כדי ששתי קליטות
      -- במקביל של אותו מקור לא יעברו יחד את התקרה שלו.
      -- מדלן נשאר על 881151301. יד2 על 881151302.
      perform pg_catalog.pg_advisory_xact_lock(
        case when v_source = 'yad2' then 881151302 else 881151301 end);
      select count(*)::int into v_used
        from public.scraped_leads
       where source = v_source and push_site_only = false
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
  -- לפני בדיקת הכפילות: שליחה חוזרת מעדכנת broker_block, והערך חייב
  -- להיות מחושב כבר. "ללא תיווך" לבדו אינו חסימה.
  v_block := public.scraped_lead_broker_block(p ->> 'raw_message')
          or public.scraped_lead_broker_block(p ->> 'property_details')
          or public.scraped_lead_broker_block(p ->> 'summary')
          or public.scraped_lead_broker_block(p ->> 'source_detail');

  -- אותו פוסט: כבר אצלנו, או שבעליו סירב/ה
  select id into v_id from public.scraped_leads where source = v_source and external_ref = v_ref;
  if v_id is not null then
    if v_source = 'facebook_group' then
      begin
        update public.scraped_leads
           set rooms = coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback, rooms),
               budget = coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback, budget),
               deal_type = coalesce(v_deal, v_deal_fallback, deal_type),
               property_type = coalesce(
                 nullif(btrim(p ->> 'property_type'), ''),
                 nullif(btrim(v_details ->> 'property_type'), ''),
                 property_type),
               size_sqm = coalesce(v_size, size_sqm),
               floor = coalesce(v_floor, floor),
               area_text = coalesce(v_area, area_text),
               broker_block = broker_block or v_block,
               neighborhood_id = coalesce(neighborhood_id, (
                 select n.id from public.neighborhoods n
                  where n.city_id = scraped_leads.city_id
                    and n.name = nullif(btrim(coalesce(
                      p ->> 'neighborhood', v_details ->> 'neighborhood')), '')
                  limit 1))
         where id = v_id;
      exception when others then
        null;
      end;
    end if;
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

  if v_deal is null then
    v_deal := v_deal_fallback;
  end if;

  -- אותו נכס בלוח השני: סימון בלבד. הקליטה, התקרה וההתראה לא משתנות.
  v_dup := public.board_cross_source_match(
    v_source, v_city, v_city_id, v_deal,
    case when coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback) > 0
         then coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback) end,
    case when coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback) > 0
         then coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback) end,
    null, null);

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary, phone_hash,
                                    push_site_only, date_known, size_sqm, floor, area_text, broker_block,
                                    is_duplicate, duplicate_of, duplicate_match)
  values (v_type, v_source, left(nullif(btrim(p ->> 'source_detail'), ''), 120), v_url, v_ref, v_posted,
          left(nullif(btrim(p ->> 'raw_name'), ''), 80), v_phone, left(nullif(btrim(p ->> 'raw_message'), ''), 4000),
          v_city, v_city_id,
          (select n.id from public.neighborhoods n
            where n.id::text = nullif(btrim(p ->> 'neighborhood_id'), '')
               or (n.city_id = v_city_id and n.name = nullif(btrim(coalesce(
                    p ->> 'neighborhood', v_details ->> 'neighborhood')), ''))
            limit 1),
          v_deal,
          coalesce(nullif(btrim(p ->> 'property_type'), ''), nullif(btrim(v_details ->> 'property_type'), '')),
          coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback),
          coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback),
          left(nullif(btrim(p ->> 'move_in'), ''), 60), left(nullif(btrim(p ->> 'property_details'), ''), 300),
          case when v_ask then now() end,
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160), v_hash,
          v_site_only, v_known, v_size, v_floor, v_area, v_block,
          v_dup is not null,
          nullif(v_dup ->> 'lead_id', '')::uuid,
          v_dup)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.scraped_leads
     where source = v_source and external_ref = v_ref;
    if v_source = 'facebook_group' then
      begin
        update public.scraped_leads
           set rooms = coalesce(nullif(p ->> 'rooms', '')::numeric, v_rooms_fallback, rooms),
               budget = coalesce(nullif(p ->> 'budget', '')::numeric, v_budget_fallback, budget),
               deal_type = coalesce(v_deal, v_deal_fallback, deal_type),
               property_type = coalesce(
                 nullif(btrim(p ->> 'property_type'), ''),
                 nullif(btrim(v_details ->> 'property_type'), ''),
                 property_type),
               size_sqm = coalesce(v_size, size_sqm),
               floor = coalesce(v_floor, floor),
               area_text = coalesce(v_area, area_text),
               broker_block = broker_block or v_block,
               neighborhood_id = coalesce(neighborhood_id, (
                 select n.id from public.neighborhoods n
                  where n.city_id = scraped_leads.city_id
                    and n.name = nullif(btrim(coalesce(
                      p ->> 'neighborhood', v_details ->> 'neighborhood')), '')
                  limit 1))
         where id = v_id;
      exception when others then
        null;
      end;
    end if;
    return jsonb_build_object('duplicate', 'post', 'id', v_id);
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
  'קליטת פוסט מפייסבוק או מודעה ממדלן/יד2. בלוח, date_known בלי first_seen_at נחשב רגע הקליטה ולא מלאי ישן. date_known false נשאר באתר. בלי טלפון רק למדלן וליד2. מספר מרכזיה של מדלן (073, 083, 093, 033) לא משתתף בכפילות. ליד שנולד לסוכן/ת נרשם assigned ב-lead_routing_log, בלי טלפון. מודעת יד2 או מדלן שמזהה את אותו נכס בלוח השני מסומנת is_duplicate, בלי לדלג על הקליטה או על ההתראה. תקרת הדחיפה היומית נפרדת לכל מקור: madlan_notify_daily_cap סופר רק מדלן, ו-yad2_notify_daily_cap סופר רק יד2. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;
