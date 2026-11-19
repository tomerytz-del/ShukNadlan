-- ============================================================================
-- התאמות ללקוח/ה מפוסטים בפייסבוק (ביקוש פתוח), וקישור שמסמן "אני פונה"
--
-- מה חסר היום:
--   ההתאמה שרצה כשסוכן/ת מוסיף/ה לקוח/ה בודקת רק נכסים במערכת. פוסט של בעל
--   נכס בפייסבוק (ביקוש פתוח) מגיע לסוכן/ת רק בכיוון ההפוך: כשהפוסט נקלט,
--   המערכת מחפשת סוכנים עם לקוח מתאים. לקוח/ה שנוסף/ה אחרי הקליטה לא נבדק/ת
--   מול 46 הפוסטים הפתוחים שכבר שם. ובהתראות הביקוש הפתוח אין זכר ללקוח/ה:
--   אף אחת מ-522 ההתראות בשבוע שנבדק לא נושאת related_client_id.
--
-- מה נכנס:
--   1. client_demand_matches(client, agent, limit, waive): פוסטים פתוחים של
--      בעלי נכס (owner_inbound, פייסבוק) שמתאימים ללקוח/ה, **מדורגים ב-
--      client_property_match**, כמו מודעות הלוחות (20271120130000): כל פוסט
--      הופך לשורת properties בזיכרון. אין כאן כלל התאמה משלו. רק פוסט שהסוכן/ת
--      רשאי/ת לתפוס (agent_works_city, כמו open_demand_claim_core), שלא נתפס
--      בידי אחר/ת, ושאינו "ללא תיווך": שם הכלל הוא "לא להציע קונים", וזה בדיוק
--      מה שהתאמה ללקוח/ה היא, ולכן הפוסטים האלה נשארים בלשונית הביקוש הפתוח.
--      מה שחוזר אנונימי: עיר, סוג, חדרים, מחיר מבוקש, ציון, גיל הפוסט, וה-
--      demand_summary. **אין קישור, אין טלפון ואין property_details.**
--   2. demand_claim_links: קישור קצר לכל זוג (סוכן/ת, פוסט). הקישור הוא
--      ההרשאה (32 תווים, 7 ימים), בדיוק כמו planning_links.
--   3. demand_claim_open(token): **הלחיצה על הקישור היא "אני פונה"**. היא
--      קוראת ל-open_demand_claim_core (אותה תקרה יומית, אותה בלעדיות, אותו
--      "לא משתחרר") ומחזירה את הקישור לפוסט. הקישור לפוסט נבדק (פייסבוק,
--      https) **לפני** התפיסה: פוסט בלי קישור תקין לא נתפס.
--   4. agent_client_demand_matches (CRM) ו-agent_client_demand_matches_for_agent
--      (גבריאלה). הראשונה בלי טוקנים: ה-CRM קורא ל-open_demand_claim הקיימת.
--      השנייה יוצרת טוקן לכל פוסט שחוזר.
--
-- מה לא משתנה: open_demand_claim_core, התראות הביקוש הפתוח, התקרה היומית
-- (open_demand_claims_daily) והחשיפה. פוסט עדיין נחשף רק למי שתפס/ה אותו.
--
-- **למה הלחיצה היא התפיסה, ולמה זה בטוח:** הדף שהקישור פותח (/demand?k=) מבצע
-- את התפיסה ב-POST מ-JavaScript, לא ב-GET. תצוגה מקדימה של קישור בוואטסאפ
-- (שמבצעת GET בלי להריץ JS) לא תופסת כלום. מי שלוחץ/ת בפועל תופס/ת, והתקרה
-- היומית ממשיכה להגן.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הקישורים
-- ---------------------------------------------------------------------------
create table if not exists public.demand_claim_links (
  id              text        primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  agent_id        uuid        not null references public.agency_members(id) on delete cascade,
  scraped_lead_id uuid        not null references public.scraped_leads(id) on delete cascade,
  client_id       uuid        references public.agent_clients(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '7 days',
  opened_at       timestamptz,
  claim_status    text,
  unique (agent_id, scraped_lead_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.demand_claim_links'::regclass
                    and conname = 'demand_claim_links_status_chk') then
    alter table public.demand_claim_links add constraint demand_claim_links_status_chk
      check (claim_status is null or claim_status in
             ('claimed', 'already_mine', 'taken', 'daily_cap', 'not_found', 'no_link'));
  end if;
end $$;

create index if not exists demand_claim_links_agent_idx
  on public.demand_claim_links (agent_id, created_at desc);

comment on table public.demand_claim_links is
  'קישורים שמסמנים "אני פונה" בלחיצה ופותחים את הפוסט (/demand?k=). הקישור הוא ההרשאה. בלי פרטים אישיים: רק מזהי סוכן/ת ופוסט. docs/scraped-leads.md';

alter table public.demand_claim_links enable row level security;
revoke all on table public.demand_claim_links from public, anon, authenticated;
grant select, insert, update, delete on table public.demand_claim_links to service_role;

-- ---------------------------------------------------------------------------
-- 2. ההתאמה. stable: לא כותבת כלום.
-- ---------------------------------------------------------------------------
create or replace function public.client_demand_matches(
  p_client         public.agent_clients,
  p_agent          uuid,
  p_limit          int default 5,
  p_waive_features text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit      int := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_min        int := 50;   -- אותו סף של match_properties_for_client
  v_waive      text[] := coalesce(p_waive_features, '{}'::text[]);
  v_wants_land boolean;
  v_city_ids   uuid[];
  v_stock      int;
  v_out        jsonb;
begin
  if p_client.id is null or p_agent is null
     or p_client.client_kind is distinct from 'seeker'
     or p_client.deal_type is null then
    return null;
  end if;
  -- מאפיין חובה שלא ויתרו עליו: בפוסט אין מאפיינים, והמנוע היה פוסל את כולם
  if exists (select 1 from unnest(coalesce(p_client.required_features, '{}'::text[])) f
              where f is not null and f <> '' and not (f = any (v_waive))) then
    return jsonb_build_object('status', 'skipped_feature');
  end if;
  v_wants_land := coalesce(p_client.property_types, '{}'::text[]) && array['מגרש', 'מגרשים'];
  if p_client.category is distinct from 'residential' and not v_wants_land then
    return jsonb_build_object('status', 'unsupported');
  end if;
  if cardinality(coalesce(p_client.cities, '{}'::text[])) = 0 then
    return jsonb_build_object('status', 'no_city');
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_city_ids
    from unnest(p_client.cities) c(name), unnest(public.city_ids_for_name(c.name)) x;

  select count(*)::int into v_stock
    from public.scraped_leads s
   where s.source in ('facebook_group', 'facebook_marketplace')
     and s.lead_type = 'owner_inbound'
     and s.deal_type = p_client.deal_type
     and s.city_id = any (v_city_ids)
     and s.no_broker is null
     and public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     and (s.claimed_by is null or s.claimed_by = p_agent);
  if v_stock = 0 then
    return jsonb_build_object('status', 'unavailable');
  end if;

  with cand as (
    select s.id, s.city, s.city_id, s.neighborhood_id, s.deal_type, s.rooms, s.budget,
           s.posted_at, s.created_at, s.demand_summary, coalesce(s.claimed_by = p_agent, false) as mine,
           public.board_listing_site_type(s.property_type) as site_type,
           public.board_listing_kind(s.property_type) as kind
      from public.scraped_leads s
     where s.source in ('facebook_group', 'facebook_marketplace')
       and s.lead_type = 'owner_inbound'
       and s.deal_type = p_client.deal_type
       and s.city_id = any (v_city_ids)
       -- "ללא תיווך": הכלל בביקוש הפתוח הוא "לא להציע קונים" (OPEN_DEMAND_NO_BROKER
       -- ב-assets/crm-leads.js), וזה בדיוק מה שהתאמה ללקוח/ה היא. הפוסטים האלה
       -- נשארים בלשונית הביקוש הפתוח, עם ההנחיה, ולא נכנסים להתאמות.
       and s.no_broker is null
       and public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
       and (s.claimed_by is null or s.claimed_by = p_agent)
       -- אותו תנאי של open_demand_claim_core: מי שאינו/ה עובד/ת בעיר לא יכול/ה לתפוס
       and public.agent_works_city(p_agent, s.city_id)
       -- בפוסט יש מחיר רק לפעמים. עם תקציב בכרטיס, פוסט בלי מחיר אינו עובר את
       -- השער של המנוע, וזה אותו כלל כמו לנכס באתר שאין לו מחיר.
       and (p_client.max_price is null or s.budget is not null)
  ),
  typed as (
    select c.* from cand c
     where c.kind is not null
       and (c.kind <> 'land' or v_wants_land)
       and (c.kind = 'land' or p_client.category = 'residential')
  ),
  scored as (
    select c.*, m.score
      from typed c
      cross join lateral public.client_property_match(
        p_client,
        jsonb_populate_record(null::public.properties, jsonb_build_object(
          'id', c.id,
          'status', 'active',
          'deal_type', c.deal_type,
          'category', case when c.kind = 'land' then p_client.category else 'residential' end,
          'property_type', case
              when c.kind = 'land' then coalesce(
                (select t from unnest(coalesce(p_client.property_types, '{}'::text[])) t
                  where t in ('מגרש', 'מגרשים') limit 1), c.site_type)
              else c.site_type end,
          'price', c.budget,
          'rooms', c.rooms,
          'city', c.city,
          'city_id', c.city_id,
          'neighborhood_id', c.neighborhood_id,
          'features', '{}'::text[])),
        v_waive
      ) m
     where m.score >= v_min
  ),
  ranked as (
    -- הציון נמדד מול הדרישות, וכרטיס רחב נותן אותו ציון להרבה פוסטים. בתוך אותו
    -- ציון: פוסט שכבר תפסתי (קישור מיד), ואז הטרי ביותר. פוסט ישן אינו "פחות
    -- מתאים", אבל הסיכוי שהנכס עוד פנוי יורד, ולכן הוא אחרון.
    select s.*, count(*) over () as total,
           count(*) over (partition by s.score) as same_score,
           row_number() over (
             order by s.score desc, s.mine desc, s.posted_at desc nulls last, s.created_at desc, s.id) as rn
      from scored s
  )
  select jsonb_build_object(
           'status', 'ok',
           'total', max(r.total),
           'top_score', max(r.score),
           'top_count', max(r.same_score) filter (where r.rn = 1),
           'items', jsonb_agg(jsonb_build_object(
             'id', r.id,
             'city', r.city,
             'deal_type', r.deal_type,
             'property_type', r.site_type,
             'rooms', r.rooms,
             'price', r.budget,
             'score', r.score,
             'days_ago', case when r.posted_at is null then null
                              else greatest(0, floor(extract(epoch from (pg_catalog.now() - r.posted_at)) / 86400))::int end,
             'mine', r.mine,
             'summary', left(r.demand_summary, 140)
           ) order by r.rn))
    into v_out
    from ranked r
   where r.rn <= v_limit;

  if v_out is null or jsonb_typeof(v_out->'items') is distinct from 'array' then
    return jsonb_build_object('status', 'none', 'total', 0);
  end if;
  return v_out;
end $$;

comment on function public.client_demand_matches(public.agent_clients, uuid, int, text[]) is
  'פוסטים פתוחים של בעלי נכס בפייסבוק שמתאימים ללקוח/ה, מדורגים ב-client_property_match על שורת properties שנבנית מהפוסט. אנונימי: בלי קישור, טלפון או property_details. רק פוסט שהסוכן/ת רשאי/ת לתפוס. docs/scraped-leads.md';
revoke all on function public.client_demand_matches(public.agent_clients, uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.client_demand_matches(public.agent_clients, uuid, int, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. הקישור. volatile: כותב.
-- ---------------------------------------------------------------------------
create or replace function public.demand_claim_link_create(p_agent uuid, p_lead uuid, p_client uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       public.scraped_leads%rowtype;
  v_token text;
begin
  if p_agent is null or p_lead is null then
    return null;
  end if;
  select * into s from public.scraped_leads where id = p_lead;
  if not found
     or s.source not in ('facebook_group', 'facebook_marketplace')
     or (s.claimed_by is not null and s.claimed_by <> p_agent)
     or not public.scraped_lead_is_demand(s.status, s.lead_type, s.no_broker, s.posted_at, s.city_id)
     or not public.agent_works_city(p_agent, s.city_id) then
    return null;
  end if;

  insert into public.demand_claim_links (agent_id, scraped_lead_id, client_id)
  values (p_agent, p_lead, p_client)
  on conflict (agent_id, scraped_lead_id) do update
    set expires_at = greatest(public.demand_claim_links.expires_at, now() + interval '7 days'),
        client_id  = coalesce(excluded.client_id, public.demand_claim_links.client_id)
  returning id into v_token;
  return v_token;
end $$;

comment on function public.demand_claim_link_create(uuid, uuid, uuid) is
  'קישור לפוסט בביקוש הפתוח (/demand?k=) לסוכן/ת: זוג אחד, קישור אחד, 7 ימים. null לפוסט שאי אפשר לתפוס. service_role בלבד.';
revoke all on function public.demand_claim_link_create(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.demand_claim_link_create(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. הלחיצה: "אני פונה", ואז הקישור לפוסט
-- ---------------------------------------------------------------------------
create or replace function public.demand_claim_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l       public.demand_claim_links%rowtype;
  s       public.scraped_leads%rowtype;
  v_res   jsonb;
  v_url   text;
  v_state text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into l from public.demand_claim_links where id = p_token and expires_at > now();
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  update public.demand_claim_links set opened_at = coalesce(opened_at, now()) where id = l.id;

  select * into s from public.scraped_leads where id = l.scraped_lead_id;
  v_url := nullif(btrim(s.post_url), '');
  -- הקישור נבדק לפני התפיסה. פוסט בלי קישור תקין לא נתפס: אין מה למסור לסוכן/ת
  if not found or v_url is null or v_url !~ '^https://([a-z0-9-]+\.)?(facebook|fb)\.com/' or length(v_url) > 500 then
    update public.demand_claim_links set claim_status = 'no_link' where id = l.id;
    return jsonb_build_object('error', 'no_link');
  end if;

  v_res := public.open_demand_claim_core(l.agent_id, l.scraped_lead_id);
  if coalesce(v_res->>'success', '') = 'true' then
    v_state := case when coalesce(v_res->>'already_mine', '') = 'true' then 'already_mine' else 'claimed' end;
    update public.demand_claim_links set claim_status = v_state where id = l.id;
    return jsonb_build_object(
      'ok', true,
      'url', v_url,
      'already_mine', v_state = 'already_mine',
      'my_today', v_res->'my_today',
      'daily_cap', v_res->'daily_cap');
  end if;

  v_state := case v_res->>'error'
               when 'claimed' then 'taken'
               when 'daily_cap' then 'daily_cap'
               else 'not_found' end;
  update public.demand_claim_links set claim_status = v_state where id = l.id;
  return jsonb_build_object('error', v_state, 'daily_cap', v_res->'daily_cap');
end $$;

comment on function public.demand_claim_open(text) is
  'הלחיצה על /demand?k=: "אני פונה" דרך open_demand_claim_core (אותה תקרה יומית ואותה בלעדיות), והקישור לפוסט. הקישור נבדק לפני התפיסה. service_role בלבד.';
revoke all on function public.demand_claim_open(text) from public, anon, authenticated;
grant execute on function public.demand_claim_open(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. העטיפות
-- ---------------------------------------------------------------------------
create or replace function public.agent_client_demand_matches(p_client_id uuid, p_limit int default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent  uuid := public.current_agent_id();
  v_client public.agent_clients;
begin
  if v_agent is null or p_client_id is null then
    return null;
  end if;
  -- רק לקוח/ה של הסוכן/ת המחובר/ת
  select * into v_client from public.agent_clients where id = p_client_id and agent_id = v_agent;
  if not found then
    return null;
  end if;
  return public.client_demand_matches(v_client, v_agent, p_limit, '{}'::text[]);
end $$;

comment on function public.agent_client_demand_matches(uuid, int) is
  'התאמות ללקוח/ה מפוסטים פתוחים בפייסבוק, למגירת ההתאמות ב-CRM. בלי קישורים: "אני פונה" הוא open_demand_claim. רק לקוח/ה של הסוכן/ת.';
revoke all on function public.agent_client_demand_matches(uuid, int) from public, anon, authenticated;
grant execute on function public.agent_client_demand_matches(uuid, int) to authenticated, service_role;

create or replace function public.agent_client_demand_matches_for_agent(
  p_agent_id       uuid,
  p_client_id      uuid,
  p_limit          int    default 5,
  p_waive_features text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.agent_clients;
  v_res    jsonb;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_token  text;
begin
  if p_agent_id is null or p_client_id is null then
    return null;
  end if;
  select * into v_client from public.agent_clients where id = p_client_id and agent_id = p_agent_id;
  if not found then
    return null;
  end if;
  v_res := public.client_demand_matches(v_client, p_agent_id, p_limit, p_waive_features);
  if v_res is null or jsonb_typeof(v_res->'items') is distinct from 'array' then
    return v_res;
  end if;
  -- טוקן לכל פוסט שחוזר. פוסט שאי אפשר לתפוס (השתנה בינתיים) נושר.
  for v_item in select value from jsonb_array_elements(v_res->'items') loop
    v_token := public.demand_claim_link_create(p_agent_id, (v_item->>'id')::uuid, p_client_id);
    if v_token is not null then
      v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('link_token', v_token));
    end if;
  end loop;
  return jsonb_set(v_res, '{items}', v_items);
end $$;

comment on function public.agent_client_demand_matches_for_agent(uuid, uuid, int, text[]) is
  'התאמות ללקוח/ה מפוסטים פתוחים בפייסבוק, לגבריאלה: כל פוסט עם link_token ל-/demand?k=. הלחיצה היא "אני פונה". service_role בלבד.';
revoke all on function public.agent_client_demand_matches_for_agent(uuid, uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.agent_client_demand_matches_for_agent(uuid, uuid, int, text[]) to service_role;
