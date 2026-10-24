-- ---------------------------------------------------------------------------
-- לידים מפוסטים בקבוצות פייסבוק ובמרקטפלייס (docs/scraped-leads.md)
--
-- סוכן AI חיצוני סורק קבוצות פייסבוק ומרקטפלייס ומוצא אנשים פרטיים שמחפשים
-- לקנות/לשכור, או שרוצים למכור/להשכיר. האנשים האלה **לא השאירו פרטים אצלנו**,
-- ולכן הם לא נכנסים ל-leads ישירות:
--
--   1. scraped_lead_add() - הפוסט נשמר ב-scraped_leads במצב pending_consent.
--      לא ליד, לא מכסה, לא התראה. אף סוכן/ת לא רואה אותו.
--   2. scraped_lead_set_consent() - התשובה לבקשת ההסכמה:
--      * consented - נולד ליד רגיל ב-leads (owner_inbound / seeker_inbound,
--        status = 'masked', quota_source ריק עד claim_lead), משויך לסוכן/ת
--        אחד/ת שעובד/ת בעיר ובסוג הנכס, ונרשם ב-lead_routing_log. ההתראה
--        יוצאת מ-trg_notify_agent_on_new_lead הקיים.
--      * declined - השורה נמחקת לגמרי. נשאר רק hash של הפוסט
--        (scraped_lead_blocks) כדי שהסורק לא יכניס את אותו פוסט שוב וישאל
--        שוב מי שכבר סירב/ה. ה-hash נמחק 30 יום אחרי הפוסט.
--   3. scraped_leads_lifecycle() (cron, כל שעה):
--      * pending_consent שלא נענה 7 ימים -> open_demand: השם, הטלפון והטקסט
--        נמחקים, נשאר סיכום אנונימי וקישור לפוסט. **לא ליד ולא בתשלום**, ולכן
--        מופץ לכל סוכן/ת שעובד/ת בעיר ובסוג הנכס - התראה אישית (open_demand)
--        לכל אחד/ת, שבוואטסאפ יוצאת עם כפתור (notification-push).
--      * כל שורה נמחקת 30 יום אחרי תאריך הפוסט.
--   4. open_demand_list() - "ביקוש פתוח" ב-CRM, רק בעיר שהסוכן/ת עובד/ת בה.
--
-- ועוד:
--   * leads_lead_type_check += 'seeker_inbound' (נבנה ממה שקיים).
--   * notify_agent_on_new_lead: כותרת ל-seeker_inbound. העתק מלא של הפרודקשן
--     (md5 11a5034c41516b12099d6d141a25b863, זהה ל-20270712090000) ועוד ענף.
--   * אינדקס לפי phone_tail9(raw_phone) - בדיקת "אותו אדם" ב-30 יום.
--
-- למה טבלה נפרדת ולא status חדש ב-leads: כל הדוחות, המכסות, הספירות
-- וה-RLS של leads מניחים שליד הוא פנייה שאפשר לחזור אליה. שורה בלי הסכמה
-- או בלי טלפון הייתה נספרת בדאשבורד המשרד, בדוח החודשי ובבקרת הלידים.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- 1. סוג הליד: מה שקיים ועוד 'seeker_inbound'
do $$
declare
  v_def   text;
  v_types text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'leads_lead_type_check' and conrelid = 'public.leads'::regclass;
  select coalesce(array_agg(m[1]), '{}') into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
  v_types := array(select distinct unnest(v_types || array['property_inquiry', 'owner_inbound', 'agent_direct_inquiry',
                                                           'visualization', 'call', 'store', 'seeker_inbound']) order by 1);
  alter table public.leads drop constraint if exists leads_lead_type_check;
  execute format('alter table public.leads add constraint leads_lead_type_check check (lead_type = any (%L::text[]))', v_types);
end $$;

create index if not exists leads_phone_tail_idx
  on public.leads (public.phone_tail9(raw_phone), created_at desc) where raw_phone is not null;

-- 2. סוג ההתראה
select public.notification_types_add(array['open_demand']);

-- ---------------------------------------------------------------------------
-- 3. הטבלאות
-- ---------------------------------------------------------------------------
create table if not exists public.scraped_leads (
  id                   uuid primary key default gen_random_uuid(),
  lead_type            text not null check (lead_type in ('owner_inbound', 'seeker_inbound')),
  status               text not null default 'pending_consent'
                         check (status in ('pending_consent', 'consented', 'open_demand')),
  source               text not null check (source ~ '^[a-z_]{3,40}$'),
  source_detail        text check (source_detail is null or char_length(source_detail) <= 120),
  post_url             text not null check (post_url ~ '^https://' and char_length(post_url) <= 600),
  external_ref         text not null check (external_ref ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  posted_at            timestamptz not null,
  raw_name             text,
  raw_phone            text,
  raw_message          text check (raw_message is null or char_length(raw_message) <= 4000),
  city                 text not null,
  city_id              uuid references public.cities(id) on delete set null,
  neighborhood_id      uuid references public.neighborhoods(id) on delete set null,
  deal_type            text check (deal_type in ('sale', 'rent')),
  property_type        text,
  rooms                numeric check (rooms is null or rooms > 0),
  budget               numeric check (budget is null or budget > 0),
  move_in              text check (move_in is null or char_length(move_in) <= 60),
  property_details     text check (property_details is null or char_length(property_details) <= 300),
  consent_requested_at timestamptz,
  consent_answered_at  timestamptz,
  open_demand_at       timestamptz,
  lead_id              uuid references public.leads(id) on delete set null,
  created_at           timestamptz not null default now(),
  -- ביקוש פתוח וליד שכבר הועבר ל-leads לא מחזיקים פרטים מזהים
  constraint scraped_leads_anon check (
    status = 'pending_consent' or (raw_name is null and raw_phone is null and raw_message is null)
  )
);

create unique index if not exists scraped_leads_ref_uniq on public.scraped_leads (source, external_ref);
create index if not exists scraped_leads_phone_idx
  on public.scraped_leads (public.phone_tail9(raw_phone)) where raw_phone is not null;
create index if not exists scraped_leads_status_idx on public.scraped_leads (status, created_at);
create index if not exists scraped_leads_open_city_idx on public.scraped_leads (city_id, posted_at desc)
  where status = 'open_demand';

comment on table public.scraped_leads is
  'פוסט של אדם פרטי מקבוצת פייסבוק / מרקטפלייס: ממתין להסכמה, הועבר ל-leads, או ביקוש פתוח אנונימי. נמחק 30 יום אחרי הפוסט. docs/scraped-leads.md';

-- מי שסירב/ה: רק hash של הפוסט, כדי שהסורק לא יכניס אותו שוב
create table if not exists public.scraped_lead_blocks (
  ref_hash   text primary key,
  expires_at timestamptz not null
);
comment on table public.scraped_lead_blocks is
  'sha256 של (source, external_ref) לפוסט שבעליו סירב/ה. בלי פרטים מזהים; נמחק 30 יום אחרי הפוסט. docs/scraped-leads.md';

alter table public.scraped_leads enable row level security;
alter table public.scraped_lead_blocks enable row level security;
-- אין גישה מהדפדפן: הקריאה היחידה היא open_demand_list(), שמחזירה עמודות אנונימיות
revoke all on table public.scraped_leads from anon, authenticated;
revoke all on table public.scraped_lead_blocks from anon, authenticated;
grant select, insert, update, delete on table public.scraped_leads to service_role;
grant select, insert, update, delete on table public.scraped_lead_blocks to service_role;

-- ---------------------------------------------------------------------------
-- 4. מי "עובד/ת בעיר" ומי "מתעסק/ת בסוג הנכס" - הגדרה אחת לניתוב, להפצה ולתצוגה
-- ---------------------------------------------------------------------------
create or replace function public.agent_works_city(p_agent uuid, p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_city_id is not null and exists (
    select 1
      from public.agency_members m
      join public.agencies a on a.id = m.agency_id
      left join public.cities c on c.id = p_city_id
     where m.id = p_agent and m.active
       and (a.city_id = p_city_id
            or (c.market_slug is not null and c.market_slug = any (coalesce(a.service_markets, '{}')))
            or exists (select 1
                         from public.agent_lead_preferences lp
                         join public.neighborhoods n on n.id = any (lp.preferred_neighborhoods)
                        where lp.agent_id = m.id and lp.active and n.city_id = p_city_id))
  );
$$;
comment on function public.agent_works_city(uuid, uuid) is
  'הסוכן/ת עובד/ת בעיר: המשרד בעיר, העיר בשווקים של המשרד, או שכונה בעיר בהעדפות הלידים. docs/scraped-leads.md';
revoke all on function public.agent_works_city(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_works_city(uuid, uuid) to service_role;

-- סוכן/ת בלי העדפות לידים פעילות לא צמצם/ה דבר, ולכן מתעסק/ת בכל סוג
create or replace function public.agent_handles_type(p_agent uuid, p_property_type text, p_deal_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.agent_lead_preferences lp where lp.agent_id = p_agent and lp.active)
      or exists (select 1 from public.agent_lead_preferences lp
                  where lp.agent_id = p_agent and lp.active
                    and (p_property_type is null or p_property_type = any (coalesce(lp.preferred_property_types, '{}')))
                    and (p_deal_type is null or p_deal_type = any (coalesce(lp.preferred_deal_types, '{}'))));
$$;
comment on function public.agent_handles_type(uuid, text, text) is
  'הסוכן/ת מתעסק/ת בסוג הנכס והעסקה לפי agent_lead_preferences; בלי העדפות פעילות - בכל סוג. docs/scraped-leads.md';
revoke all on function public.agent_handles_type(uuid, text, text) from public, anon, authenticated;
grant execute on function public.agent_handles_type(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. קליטה (הסוכן הסורק, דרך MCP או service_role)
-- ---------------------------------------------------------------------------
create or replace function public.scraped_lead_ref(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- מזהה קנוני לפוסט: הכתובת בלי פרמטרי מעקב, ואם היא ארוכה או עם תווים
  -- שאינם ב-leads_external_ref_format - hash שלה
  with u as (
    select lower(regexp_replace(regexp_replace(btrim(p_url), '^https?://(www\.|m\.|web\.)?', ''), '[?#].*$', '')) as base,
           (select string_agg(m[1] || '-' || m[2], '.')
              from regexp_matches(p_url, '[?&](story_fbid|multi_permalinks|id)=([0-9]+)', 'g') as m) as q
  ), r as (
    select rtrim(base, '/') || coalesce(':' || q, '') as ref from u
  )
  select case when ref ~ '^[A-Za-z0-9._:/-]{1,128}$' then ref
              else 'h:' || left(encode(extensions.digest(ref, 'sha256'), 'hex'), 48) end
    from r;
$$;
revoke all on function public.scraped_lead_ref(text) from public, anon, authenticated;
grant execute on function public.scraped_lead_ref(text) to service_role;

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

  insert into public.scraped_leads (lead_type, source, source_detail, post_url, external_ref, posted_at,
                                    raw_name, raw_phone, raw_message, city, city_id, neighborhood_id,
                                    deal_type, property_type, rooms, budget, move_in, property_details,
                                    consent_requested_at)
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
          case when (p ->> 'consent_requested')::boolean then now() end)
  on conflict (source, external_ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', 'post');
  end if;
  return jsonb_build_object('success', true, 'id', v_id, 'status', 'pending_consent',
                            'city_known', v_city_id is not null);
end $$;

comment on function public.scraped_lead_add(jsonb) is
  'קליטת פוסט מקבוצת פייסבוק / מרקטפלייס כ-pending_consent, עם בדיקת כפילות לפי פוסט ולפי טלפון. docs/scraped-leads.md';
revoke all on function public.scraped_lead_add(jsonb) from public, anon, authenticated;
grant execute on function public.scraped_lead_add(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. ההסכמה
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

  v_label := case s.source when 'facebook_marketplace' then 'מרקטפלייס' else 'קבוצת פייסבוק' end
             || coalesce(' · ' || s.source_detail, '');
  -- הקישור לפוסט מזהה את האדם, ולכן הוא בהודעה (נחשפת בפתיחה) ולא בפרטים
  v_msg := left(concat_ws(E'\n', s.raw_message,
                          'פורסם: ' || to_char(s.posted_at at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI'),
                          'הפוסט: ' || s.post_url), 4000);

  insert into public.leads (lead_type, agent_id, agency_id, status, raw_name, raw_phone, raw_message,
                            city, neighborhood_id, deal_type, property_type, property_details,
                            source, source_detail, external_ref)
  values (s.lead_type, v_agent, v_agency, 'masked', coalesce(s.raw_name, 'פונה מפייסבוק'), s.raw_phone, v_msg,
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
                         s.property_type, s.city, v_label),
    'city', s.city,
    'neighborhood_id', s.neighborhood_id,
    'deal_type', s.deal_type,
    'property_type', s.property_type,
    'assigned_agent_id', v_agent));

  return jsonb_build_object('success', true, 'status', 'consented', 'lead_id', v_lead,
                            'agent_id', v_agent, 'candidates', v_cands);
end $$;

comment on function public.scraped_lead_set_consent(uuid, text) is
  'requested / consented (ליד ב-leads לסוכן/ת אחד/ת בעיר) / declined (מחיקה מלאה). docs/scraped-leads.md';
revoke all on function public.scraped_lead_set_consent(uuid, text) from public, anon, authenticated;
grant execute on function public.scraped_lead_set_consent(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. מחזור החיים (cron): 7 ימים בלי תשובה -> ביקוש פתוח; 30 יום מהפוסט -> מחיקה
-- ---------------------------------------------------------------------------
create or replace function public.scraped_leads_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_opened  int := 0;
  v_sent    int := 0;
  v_n       int;
  v_deleted int;
  v_title   text;
  v_body    text;
begin
  for r in
    update public.scraped_leads
       set status = 'open_demand', open_demand_at = now(),
           raw_name = null, raw_phone = null, raw_message = null
     where status = 'pending_consent'
       and coalesce(consent_requested_at, created_at) < now() - interval '7 days'
       and posted_at > now() - interval '30 days'
    returning *
  loop
    v_opened := v_opened + 1;
    v_title := 'ביקוש פתוח: '
      || case when r.lead_type = 'owner_inbound'
              then case r.deal_type when 'rent' then 'משכיר/ה' else 'מוכר/ת' end
              else case r.deal_type when 'rent' then 'מחפש/ת לשכור' else 'מחפש/ת לקנות' end end
      || ' ב' || r.city;
    v_body := concat_ws(' · ', r.property_type,
                        case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
                        case when r.budget is not null then 'עד ₪' || to_char(r.budget, 'FM999,999,999') end,
                        case when r.move_in is not null then 'כניסה: ' || r.move_in end)
      || '. חינם, לכל הסוכנים באזור. להגיב רק בפוסט או בהודעה בפייסבוק, לא ב-SMS ולא בוואטסאפ.';

    -- לא ליד ולא בתשלום: לכל סוכן/ת שעובד/ת בעיר ומתעסק/ת בסוג הנכס
    insert into public.notifications (agent_id, type, title, body)
    select m.id, 'open_demand', v_title, left(v_body, 500)
      from public.agency_members m
     where m.active and public.agent_works_city(m.id, r.city_id)
       and public.agent_handles_type(m.id, r.property_type, r.deal_type);
    get diagnostics v_n = row_count;
    v_sent := v_sent + v_n;
  end loop;

  delete from public.scraped_leads where posted_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  delete from public.scraped_lead_blocks where expires_at < now();

  return jsonb_build_object('opened', v_opened, 'notified', v_sent, 'deleted', v_deleted);
end $$;

comment on function public.scraped_leads_lifecycle() is
  'כל שעה: pending_consent שלא נענה 7 ימים הופך לביקוש פתוח אנונימי ומופץ לסוכנים בעיר ובסוג; מחיקה 30 יום אחרי הפוסט. docs/scraped-leads.md';
revoke all on function public.scraped_leads_lifecycle() from public, anon, authenticated;
grant execute on function public.scraped_leads_lifecycle() to service_role;

-- ---------------------------------------------------------------------------
-- 8. "ביקוש פתוח" ב-CRM
-- ---------------------------------------------------------------------------
create or replace function public.open_demand_list()
returns table (id uuid, lead_type text, source text, source_detail text, post_url text, posted_at timestamptz,
               city text, neighborhood_id uuid, deal_type text, property_type text, rooms numeric,
               budget numeric, move_in text, property_details text, open_demand_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.lead_type, s.source, s.source_detail, s.post_url, s.posted_at, s.city, s.neighborhood_id,
         s.deal_type, s.property_type, s.rooms, s.budget, s.move_in, s.property_details, s.open_demand_at
    from public.scraped_leads s
   where s.status = 'open_demand'
     and public.agent_works_city(public.current_agent_id(), s.city_id)
   order by s.posted_at desc
   limit 200;
$$;
comment on function public.open_demand_list() is
  'ביקוש פתוח (אנונימי) בערים שהסוכן/ת המחובר/ת עובד/ת בהן. docs/scraped-leads.md';
revoke all on function public.open_demand_list() from public, anon, authenticated;
grant execute on function public.open_demand_list() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. notify_agent_on_new_lead - העתק מלא מהפרודקשן ועוד ענף ל-seeker_inbound
-- ---------------------------------------------------------------------------
create or replace function public.notify_agent_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body  text;
  v_where text;
begin
  if new.agent_id is null then
    return new;
  end if;
  -- 20270712090000: על שיחה כבר יוצא סיכום בוואטסאפ, ורכישה נעשתה הרגע בלחיצה
  if new.lead_type in ('call', 'store') then
    return new;
  end if;

  v_title := case new.lead_type
    when 'owner_inbound'         then 'ליד חדש: בעל נכס'
    when 'property_inquiry'      then 'ליד חדש: התעניינות בנכס'
    when 'agent_direct_inquiry'  then 'ליד חדש: פנייה ישירה אליך'
    -- 20270812090000: פוסט בפייסבוק של מי שמחפש/ת, אחרי שהסכים/ה שנחזור
    when 'seeker_inbound'        then 'ליד חדש: מחפש/ת נכס'
    else 'ליד חדש'
  end;

  v_where := coalesce(nullif(new.city, ''), 'עפולה');
  v_body := v_where
    || coalesce(' · ' || nullif(new.property_type, ''), '')
    || case new.deal_type when 'sale' then ' · מכירה' when 'rent' then ' · השכרה' else '' end
    || case when new.status = 'unlocked' then ' · פתוח' else ' · ממתין לפתיחה' end;

  insert into public.notifications (agent_id, type, title, body, related_lead_id)
  values (new.agent_id, 'new_lead', v_title, v_body, new.id);

  return new;
end;
$$;

revoke all on function public.notify_agent_on_new_lead() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. התזמון
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - יש לתזמן את scraped_leads_lifecycle בדרך אחרת';
    return;
  end if;
  perform cron.unschedule('scraped-leads-lifecycle')
    where exists (select 1 from cron.job where jobname = 'scraped-leads-lifecycle');
  perform cron.schedule('scraped-leads-lifecycle', '29 * * * *', 'select public.scraped_leads_lifecycle()');
end $$;
