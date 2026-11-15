-- ============================================================================
-- התראת מודעת מדלן/יד2: בלי טלפון, עם כפתור למודעה
--
-- ## הבעיה
-- scraped_lead_notify_demand כתבה לגוף ההתראה "אפשר להתקשר ל-" ואת
-- הטלפון של המודעה, בלי כפתור. שתי החלטות מוצר נשברות בשקט: אין לחשוף
-- מספר טלפון בהתראה, וסוכן/ת מקבל/ת כפתור ולא כתובת גולמית.
-- ובנוסף, מודעה עם date_known = true ובלי first_seen_at (וגם בלי
-- updated_at ו-posted_at) נשארה push_site_only, כי v_seen נשאר null
-- והחלון של הטריות לא נפתח. posted_at נפל ל-now(), שנראה כמו created_at.
-- היעדר החותמת לבדו אינו אומר שהמודעה ישנה: הסורק סימן שהתאריך ידוע
-- והשורה נולדת עכשיו. date_known false נשאר רק באתר, כמו קודם.
--
-- ## מה נכנס
-- 1. במדלן וביד2 הגוף הוא מיקום, חדרים, שטח, קומה ומחיר. בלי טלפון,
--    בלי "בלי עלות" ובלי "המערכת לא פונה לבעלים". הקישור הציבורי נשמר
--    ב-notifications.action_url, לא בטקסט. פייסבוק לא משתנה.
-- 2. date_known בלי שום חותמת נחשב now() לענין הטריות, ואז חלה אותה
--    תקרת madlan_notify_daily_cap. אין כאן מילוי לאחור ואין הפיכת
--    שורות קיימות.
--
-- שעות שקט, שמירת ההתפרצות, תקרת התבניות, מסלול חינם (מייל ולא וואטסאפ)
-- ו-demand_notified_at נשארים איפה שהיו. docs/scraped-leads.md
-- ============================================================================

alter table public.notifications
  add column if not exists action_url text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_action_url_chk'
  ) then
    alter table public.notifications
      add constraint notifications_action_url_chk
      check (
        action_url is null
        or (
          char_length(action_url) between 18 and 500
          and action_url ~* '^https://([a-z0-9-]+\.)*(madlan\.co\.il|yad2\.co\.il)/'
          and action_url !~ '[[:space:]@]'
        )
      );
  end if;
end $$;

comment on column public.notifications.action_url is
  'קישור ציבורי למודעת מדלן או יד2. כפתור בפעמון ובוואטסאפ, לא שורה בגוף ההתראה.';

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
  'קליטת פוסט מפייסבוק או מודעה ממדלן/יד2. בלוח, date_known בלי first_seen_at נחשב רגע הקליטה ולא מלאי ישן. date_known false נשאר באתר. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;


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
  v_link   text := null;
  v_hood   text;
  v_place  text;
  v_size   text;
  v_floor  text;
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

  if r.source in ('madlan', 'yad2') then
    -- מודעת לוח: בלי טלפון, בלי חיוב ובלי פניה לבעלים.
    -- מיקום, חדרים, שטח, קומה ומחיר. הקישור ב-action_url, לא בטקסט.
    v_title := 'מודעה חדשה ב' || r.city;
    v_hood := null;
    if r.neighborhood_id is not null then
      select n.name into v_hood from public.neighborhoods n where n.id = r.neighborhood_id;
    end if;
    v_place := case
      when nullif(btrim(v_hood), '') is not null then btrim(v_hood) || ', ' || r.city
      else r.city
    end;
    v_size := substring(coalesce(r.demand_summary, '') from '([0-9]{1,4})[[:space:]]*מ.{0,2}ר');
    v_floor := substring(coalesce(r.demand_summary, '') from '(קומה[[:space:]]*[0-9]{1,2}|קרקע)');
    v_body := concat_ws(' · ',
      v_place,
      case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
      case when v_size is not null then v_size || ' מ״ר' end,
      v_floor,
      case when r.budget is not null then '₪' || to_char(r.budget, 'FM999,999,999') end);
    v_link := null;
    if r.post_url ~* '^https://([a-z0-9-]+\.)*(madlan\.co\.il|yad2\.co\.il)/'
       and char_length(r.post_url) between 18 and 500
       and r.post_url !~ '[[:space:]@]' then
      v_link := r.post_url;
    end if;
  else
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
                || 'אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.'
         end;
    v_link := null;
  end if;

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
        insert into public.notifications (agent_id, type, title, body, suppress_push, action_url)
        values (
          rec.agent_id, 'open_demand', v_title, left(v_body, 500),
          v_site or (v_fanout > 0 and v_rn > v_fanout),
          v_link
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
            agent_id, type, title, body, suppress_push, action_url,
            match_score, match_kind, matched_client_ids, matched_property_ids
          )
          values (
            rec.agent_id, 'open_demand', v_title,
            left(v_body || coalesce(E'\n' || v_line, ''), 500),
            v_site or (v_fanout > 0 and v_rn > v_fanout),
            v_link,
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
    insert into public.notifications (agent_id, type, title, body, suppress_push, action_url)
    select s.id, 'open_demand', v_title, left(v_body, 500),
           v_site or (v_fanout > 0 and (s.rn + v_prior) > v_fanout),
           v_link
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
      insert into public.notifications (agent_id, type, title, body, suppress_push, action_url)
      select p.agent_id, 'open_demand', v_title, left(v_body, 500), v_site, v_link
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
  'התראת open_demand. במדלן וביד2 הגוף בלי טלפון ובלי כתובת, והקישור ב-action_url. פייסבוק נשאר כמו שהיה. מחפש/ת מהרשתות: עד התקרה, גם כשהדגל הגלובלי כבוי, ובלי וואטסאפ כשתקרת התבניות כבויה.';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

