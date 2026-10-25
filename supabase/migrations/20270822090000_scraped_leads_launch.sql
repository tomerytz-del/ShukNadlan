-- ---------------------------------------------------------------------------
-- לידים מפוסטים בפייסבוק: תקופת ההשקה (docs/scraped-leads.md, "תקופת ההשקה")
--
-- עד התאריך שב-pricing_config ('scraped_leads_launch_until', ברירת מחדל
-- 25.1.2027 כולל, שעון ישראל):
--
--   1. ביקוש פתוח מיידי - פוסט ב-pending_consent מוצג מיד ב-open_demand_list()
--      לסוכנים בעיר ובשוק שלו, במקביל לבקשת ההסכמה, ולא רק אחרי 7 ימים. רק
--      עמודות אנונימיות: הסיכום הוא demand_summary החדש, ולא property_details
--      (שבפועל מגיע עם כתובת, למשל "מאיר שפירא 7").
--   2. ההסכמה - הליד נולד פתוח (status = 'unlocked') לסוכן/ת ששויך/ה, עם
--      quota_source = 'launch_free': בלי חיוב, בלי מכסה ובלי claim_lead.
--
-- ובכל תקופה:
--   * "ללא תיווך" (no_broker) - פוסט, או קבוצה, שכתוב בהם שלא רוצים מתווכים
--     אינו מוצג כביקוש פתוח ואינו מופץ. מסלול ההסכמה לא משתנה.
--   * ההתראה open_demand יוצאת פעם אחת לפוסט (demand_notified_at): בהשקה מיד
--     בקליטה, ואחריה - כמו קודם - כשהוא הופך לביקוש פתוח אחרי 7 ימים.
--
-- הערך 0 (או כל תאריך שעבר) מחזיר את המודל הקודם בלי מיגרציה.
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- 1. ההגדרה: yyyymmdd כמספר, כי pricing_config.value הוא numeric. היום עצמו כלול.
insert into public.pricing_config (key, value, description)
values ('scraped_leads_launch_until', 20270125,
        'סיום תקופת ההשקה של לידים מפייסבוק (yyyymmdd, כולל, שעון ישראל): ביקוש פתוח מיידי וליד בחינם אחרי הסכמה. 0 מחזיר את המודל הרגיל. docs/scraped-leads.md')
on conflict (key) do nothing;

create or replace function public.scraped_leads_launch_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select now() < ((to_date(trunc(value)::bigint::text, 'YYYYMMDD') + 1)::timestamp at time zone 'Asia/Jerusalem')
      from public.pricing_config
     where key = 'scraped_leads_launch_until' and value between 20000101 and 29991231
  ), false);
$$;
comment on function public.scraped_leads_launch_active() is
  'תקופת ההשקה של לידים מפייסבוק פעילה (pricing_config.scraped_leads_launch_until). docs/scraped-leads.md';
revoke all on function public.scraped_leads_launch_active() from public, anon, authenticated;
grant execute on function public.scraped_leads_launch_active() to service_role;

-- 2. "ללא תיווך": בטקסט הפוסט, בשם הקבוצה או בפרטים
create or replace function public.scraped_lead_no_broker(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~ ('(ללא|בלי|לא|אין)\s*(דמי\s*)?ל?(תיווך|מתווכ)'
                                 || '|מתווכ\S*\s*[-:,]?\s*(נא\s*)?(לא|אל\s*תפנו|תחסכו)'
                                 || '|תיווך\s*[-:]\s*לא'
                                 || '|מפרטי\s*לפרטי');
$$;
comment on function public.scraped_lead_no_broker(text) is
  'הטקסט אומר שלא רוצים מתווכים ("ללא תיווך", "בלי מתווכים", "מפרטי לפרטי"). docs/scraped-leads.md';
revoke all on function public.scraped_lead_no_broker(text) from public, anon, authenticated;
grant execute on function public.scraped_lead_no_broker(text) to service_role;

-- 3. העמודות
alter table public.scraped_leads add column if not exists no_broker boolean not null default false;
alter table public.scraped_leads add column if not exists demand_summary text;
alter table public.scraped_leads add column if not exists demand_notified_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scraped_leads_demand_summary_len'
                   and conrelid = 'public.scraped_leads'::regclass) then
    alter table public.scraped_leads add constraint scraped_leads_demand_summary_len
      check (demand_summary is null or char_length(demand_summary) <= 160);
  end if;
end $$;
comment on column public.scraped_leads.demand_summary is
  'סיכום קצר לביקוש הפתוח, גלוי לכל הסוכנים בעיר: בלי שם, טלפון, כתובת או מספר בית. מגיע מהסורק (summary).';
comment on column public.scraped_leads.no_broker is
  'בפוסט או בקבוצה כתוב שלא רוצים מתווכים: לא מוצג ולא מופץ כביקוש פתוח.';

-- הרשומות הקיימות: הטקסט עוד שמור רק ב-pending_consent
update public.scraped_leads
   set no_broker = true
 where not no_broker
   and (public.scraped_lead_no_broker(raw_message) or public.scraped_lead_no_broker(source_detail)
        or public.scraped_lead_no_broker(property_details));

-- 4. מקור מכסה חדש ללידים: בחינם בהשקה (נבנה ממה שקיים, כמו leads_lead_type_check)
do $$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'leads_quota_source_check' and conrelid = 'public.leads'::regclass;
  select coalesce(array_agg(m[1]), '{}') into v_vals
    from regexp_matches(coalesce(v_def, ''), '''([a-z_0-9]+)''', 'g') as m;
  v_vals := array(select distinct unnest(v_vals || array['free_quota', 'paid_10', 'paid_50', 'premium_free',
                                                         'subscription_unlimited', 'launch_free']) order by 1);
  alter table public.leads drop constraint if exists leads_quota_source_check;
  execute format('alter table public.leads add constraint leads_quota_source_check check (quota_source = any (%L::text[]))', v_vals);
end $$;

-- ---------------------------------------------------------------------------
-- 5. ההתראה על ביקוש פתוח - פעם אחת לפוסט, אנונימית
-- ---------------------------------------------------------------------------
create or replace function public.scraped_lead_notify_demand(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.scraped_leads%rowtype;
  v_title text;
  v_body  text;
  v_n     int;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.no_broker or r.city_id is null
     or r.status not in ('pending_consent', 'open_demand') then
    return 0;
  end if;

  v_title := 'ביקוש פתוח: '
    || case when r.lead_type = 'owner_inbound'
            then case r.deal_type when 'rent' then 'משכיר/ה' else 'מוכר/ת' end
            else case r.deal_type when 'rent' then 'מחפש/ת לשכור' else 'מחפש/ת לקנות' end end
    || ' ב' || r.city;
  -- רק עמודות אנונימיות: בלי property_details, שמגיע לפעמים עם כתובת
  v_body := concat_ws(' · ', r.property_type,
                      case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
                      case when r.budget is not null
                           then case when r.lead_type = 'owner_inbound' then '₪' else 'עד ₪' end
                                || to_char(r.budget, 'FM999,999,999') end,
                      case when r.move_in is not null then 'כניסה: ' || r.move_in end)
    || '. חינם, לכל הסוכנים באזור. אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.';

  insert into public.notifications (agent_id, type, title, body)
  select m.id, 'open_demand', v_title, left(v_body, 500)
    from public.agency_members m
   where m.active and public.agent_works_city(m.id, r.city_id)
     and public.agent_handles_type(m.id, r.property_type, r.deal_type);
  get diagnostics v_n = row_count;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;
comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand לכל סוכן/ת בעיר ובסוג, פעם אחת לפוסט (demand_notified_at), ולא ל"ללא תיווך". docs/scraped-leads.md';
revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. הקליטה: no_broker ו-summary, וההתראה המיידית בהשקה
-- ---------------------------------------------------------------------------
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
  v_city    text := nullif(btrim(p ->> 'city'), '');
  v_city_id uuid;
  v_deal    text := nullif(btrim(p ->> 'deal_type'), '');
  v_nobrk   boolean;
  v_launch  boolean;
  v_id      uuid;
begin
  if v_type not in ('owner_inbound', 'seeker_inbound') then
    return jsonb_build_object('error', 'invalid_lead_type');
  end if;
  if v_source not in ('facebook_group', 'facebook_marketplace') then
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
  v_tail := public.phone_tail9(v_phone);
  if v_tail is null then
    return jsonb_build_object('error', 'missing_phone');
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
  -- אותו אדם ב-30 הימים האחרונים: פוסט אחר שממתין, או ליד מכל ערוץ
  select id into v_id from public.scraped_leads
   where public.phone_tail9(raw_phone) = v_tail and created_at > now() - interval '30 days' limit 1;
  if v_id is not null then
    return jsonb_build_object('duplicate', 'phone', 'id', v_id);
  end if;
  if exists (select 1 from public.leads
              where public.phone_tail9(raw_phone) = v_tail and created_at > now() - interval '30 days') then
    return jsonb_build_object('duplicate', 'lead');
  end if;

  v_city_id := public.city_id_for_name(v_city);
  -- 20270822090000: "ללא תיווך" - מהסורק, או מהטקסט / שם הקבוצה / הפרטים
  v_nobrk := coalesce((p ->> 'no_broker')::boolean, false)
             or public.scraped_lead_no_broker(p ->> 'raw_message')
             or public.scraped_lead_no_broker(p ->> 'source_detail')
             or public.scraped_lead_no_broker(p ->> 'property_details');

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at, no_broker, demand_summary)
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
          v_nobrk, left(nullif(btrim(p ->> 'summary'), ''), 160))
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', 'post');
  end if;

  v_launch := public.scraped_leads_launch_active();
  if v_launch then
    perform public.scraped_lead_notify_demand(v_id);
  end if;

  return jsonb_build_object('success', true, 'id', v_id, 'status', 'pending_consent',
                            'city_known', v_city_id is not null, 'no_broker', v_nobrk,
                            'open_demand', v_launch and not v_nobrk and v_city_id is not null);
end $$;

comment on function public.scraped_lead_add(jsonb) is
  'קליטת פוסט מקבוצת פייסבוק / מרקטפלייס כ-pending_consent, עם בדיקת כפילות לפי פוסט ולפי טלפון; בהשקה - גם ביקוש פתוח מיידי. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7. ההסכמה: בהשקה הליד נולד פתוח ובחינם
-- ---------------------------------------------------------------------------
create or replace function public.scraped_lead_set_consent(p_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.scraped_leads%rowtype;
  v_agent  uuid;
  v_agency uuid;
  v_lead   uuid;
  v_msg    text;
  v_label  text;
  v_cands  int;
  v_free   boolean;
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

  -- סוכן/ת אחד/ת: עובד/ת בעיר, מתעסק/ת בסוג, ולליד בעלים - מסלול שרשאי
  -- לפתוח אותו (claim_lead: free אינו). מי שקיבל/ה ליד כזה הכי מזמן קודם.
  select count(*) into v_cands
    from public.agency_members m
   where m.active and public.agent_works_city(m.id, s.city_id)
     and public.agent_handles_type(m.id, s.property_type, s.deal_type)
     and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium'));

  select m.id, m.agency_id into v_agent, v_agency
    from public.agency_members m
   where m.active and public.agent_works_city(m.id, s.city_id)
     and public.agent_handles_type(m.id, s.property_type, s.deal_type)
     and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium'))
   order by (select max(l.created_at) from public.leads l
              where l.agent_id = m.id and l.source in ('facebook_group', 'facebook_marketplace')) asc nulls first,
            m.id
   limit 1;

  -- 20270822090000: בהשקה הליד נפתח מיד לסוכן/ת ששויך/ה - בלי claim_lead,
  -- בלי חיוב ובלי מכסה. בלי סוכן/ת הוא נשאר masked כמו קודם.
  v_free := v_agent is not null and public.scraped_leads_launch_active();

  v_label := case s.source when 'facebook_marketplace' then 'מרקטפלייס' else 'קבוצת פייסבוק' end
             || coalesce(' · ' || s.source_detail, '');
  -- הקישור לפוסט מזהה את האדם, ולכן הוא בהודעה (נחשפת בפתיחה) ולא בפרטים
  v_msg := left(concat_ws(E'\n', s.raw_message,
                          'פורסם: ' || to_char(s.posted_at at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI'),
                          'הפוסט: ' || s.post_url), 4000);

  insert into public.leads (lead_type, agent_id, agency_id, status, quota_source, unlocked_at, unlocked_by,
                            raw_name, raw_phone, raw_message,
                            city, neighborhood_id, deal_type, property_type, property_details,
                            source, source_detail, external_ref)
  values (s.lead_type, v_agent, v_agency,
          case when v_free then 'unlocked' else 'masked' end,
          case when v_free then 'launch_free' end,
          case when v_free then now() end,
          case when v_free then v_agent end,
          coalesce(s.raw_name, 'פונה מפייסבוק'), s.raw_phone, v_msg,
          s.city, s.neighborhood_id, s.deal_type, s.property_type,
          nullif(concat_ws(' · ', s.property_details,
                           case when s.rooms is not null then trim_scale(s.rooms)::text || ' חדרים' end,
                           case when s.budget is not null then 'עד ₪' || to_char(s.budget, 'FM999,999,999') end,
                           case when s.move_in is not null then 'כניסה: ' || s.move_in end), ''),
          s.source, left(v_label, 120), s.external_ref)
  on conflict (source, external_ref) where external_ref is not null do nothing
  returning id into v_lead;

  if v_lead is null then
    select id into v_lead from public.leads where source = s.source and external_ref = s.external_ref;
  end if;

  -- status <> pending_consent / open_demand מוריד אותו מהביקוש הפתוח
  update public.scraped_leads
     set status = 'consented', consent_answered_at = now(), lead_id = v_lead,
         raw_name = null, raw_phone = null, raw_message = null
   where id = p_id;

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
                         case when v_free then 'השקה: בחינם' end),
    'city', s.city,
    'neighborhood_id', s.neighborhood_id,
    'deal_type', s.deal_type,
    'property_type', s.property_type,
    'assigned_agent_id', v_agent));

  return jsonb_build_object('success', true, 'status', 'consented', 'lead_id', v_lead,
                            'agent_id', v_agent, 'candidates', v_cands, 'launch_free', v_free);
end $$;

comment on function public.scraped_lead_set_consent(uuid, text) is
  'requested / consented (ליד ב-leads לסוכן/ת אחד/ת בעיר; בהשקה פתוח ובחינם) / declined (מחיקה מלאה). docs/scraped-leads.md';
revoke all on function public.scraped_lead_set_consent(uuid, text) from public, anon, authenticated;
grant execute on function public.scraped_lead_set_consent(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. מחזור החיים: 7 ימים -> open_demand (אנונימי), התראה פעם אחת, מחיקה ב-30
-- ---------------------------------------------------------------------------
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
  v_launch  boolean := public.scraped_leads_launch_active();
begin
  update public.scraped_leads
     set status = 'open_demand', open_demand_at = now(),
         raw_name = null, raw_phone = null, raw_message = null
   where status = 'pending_consent'
     and coalesce(consent_requested_at, created_at) < now() - interval '7 days'
     and posted_at > now() - interval '30 days';
  get diagnostics v_opened = row_count;

  -- התראה פעם אחת לפוסט: מה שנפתח עכשיו, ובהשקה גם מה שממתין להסכמה ועוד
  -- לא הופץ (הרשומות שנקלטו לפני ההשקה, או קליטה שההתראה בה נכשלה)
  for r in
    select id from public.scraped_leads
     where demand_notified_at is null and not no_broker and city_id is not null
       and posted_at > now() - interval '30 days'
       and (status = 'open_demand' or (v_launch and status = 'pending_consent'))
  loop
    v_sent := v_sent + public.scraped_lead_notify_demand(r.id);
  end loop;

  delete from public.scraped_leads where posted_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  delete from public.scraped_lead_blocks where expires_at < now();

  return jsonb_build_object('opened', v_opened, 'notified', v_sent, 'deleted', v_deleted, 'launch', v_launch);
end $$;

comment on function public.scraped_leads_lifecycle() is
  'כל שעה: pending_consent שלא נענה 7 ימים הופך לביקוש פתוח אנונימי; התראה אחת לפוסט; מחיקה 30 יום אחרי הפוסט. docs/scraped-leads.md';
revoke all on function public.scraped_leads_lifecycle() from public, anon, authenticated;
grant execute on function public.scraped_leads_lifecycle() to service_role;

-- ---------------------------------------------------------------------------
-- 9. "ביקוש פתוח" ב-CRM: בהשקה גם pending_consent; summary במקום property_details
--    (שם עמודה שמשתנה - ולכן drop ולא create or replace)
-- ---------------------------------------------------------------------------
drop function if exists public.open_demand_list();
create function public.open_demand_list()
returns table (id uuid, lead_type text, source text, source_detail text, post_url text, posted_at timestamptz,
               city text, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
               budget numeric, move_in text, summary text, open_demand_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.lead_type, s.source, s.source_detail, s.post_url, s.posted_at, s.city, s.neighborhood_id,
         s.deal_type, s.property_type, s.rooms, s.budget, s.move_in, s.demand_summary,
         coalesce(s.open_demand_at, s.created_at)
    from public.scraped_leads s
   where (s.status = 'open_demand'
          or (s.status = 'pending_consent' and public.scraped_leads_launch_active()))
     and not s.no_broker
     and s.posted_at > now() - interval '30 days'
     and public.agent_works_city(public.current_agent_id(), s.city_id)
   order by s.posted_at desc
   limit 200;
$$;
comment on function public.open_demand_list() is
  'ביקוש פתוח (אנונימי) בערים שהסוכן/ת המחובר/ת עובד/ת בהן; בהשקה גם פוסטים שממתינים להסכמה, בלי "ללא תיווך". docs/scraped-leads.md';
revoke all on function public.open_demand_list() from public, anon, authenticated;
grant execute on function public.open_demand_list() to authenticated, service_role;
