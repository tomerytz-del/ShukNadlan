-- ============================================================================
-- תיאורי שכונות עם AI - שלב 8 בשדרוג אזור הניהול, חלק ב
-- (docs/admin-redesign/HANDOFF.md, סעיף 8; docs/neighborhood-pages.md)
--
-- פעם בשבוע `neighborhood-describe` כותבת טיוטה ל-10 שכונות שיש להן דף
-- (‏neighborhood_page_index): פסקת פתיחה, "למי זה מתאים", ו-3 שאלות ותשובות.
-- **שום טיוטה אינה מתפרסמת לבד:** היא נכנסת לתיבת המשימות (‏hood_draft, 72
-- שעות), מנהל/ת הפלטפורמה עורך/ת ומאשר/ת או דוחה ב"SEO ושכונות", ורק תיאור
-- שאושר נכנס לדף (‏neighborhood_page().about).
--
-- הקלט למודל הוא הנתונים של הדף עצמו - ציבוריים ומצטברים בלבד: שם, עיר,
-- מספר נכסים, טווחי מחיר, חציון עסקאות לפי חדרים ושכונות סמוכות. בלי שמות
-- סוכנים, משרדים, לקוחות או כתובות.
-- ============================================================================

create table if not exists public.neighborhood_descriptions (
  id              uuid primary key default gen_random_uuid(),
  neighborhood_id uuid not null references public.neighborhoods(id) on delete cascade,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'replaced')),
  intro           text not null,
  fits            text,
  faq             jsonb not null default '[]'::jsonb,
  model           text,
  input_tokens    int,
  output_tokens   int,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.agency_members(id) on delete set null,
  decision_note   text
);

-- תיאור מאושר אחד לשכונה, וטיוטה ממתינה אחת לשכונה
create unique index if not exists neighborhood_descriptions_one_approved
  on public.neighborhood_descriptions (neighborhood_id) where status = 'approved';
create unique index if not exists neighborhood_descriptions_one_draft
  on public.neighborhood_descriptions (neighborhood_id) where status = 'draft';

comment on table public.neighborhood_descriptions is
  'טיוטות AI ותיאורים מאושרים לדפי השכונות. טיוטה אינה מתפרסמת; רק approved נכנס לדף. docs/neighborhood-pages.md';

alter table public.neighborhood_descriptions enable row level security;
-- נכתבת מ-neighborhood-describe (service_role) ונקראת ומאושרת דרך admin_hood_*
revoke all on table public.neighborhood_descriptions from anon, authenticated, service_role;
grant select, insert on table public.neighborhood_descriptions to service_role;

insert into public.admin_sla (kind, minutes) values ('hood_draft', 4320)
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- 1. מי מקבל טיוטה השבוע
--
-- שכונות עם דף, בלי תיאור מאושר ובלי טיוטה שממתינה, ושלא נדחו ב-30 הימים
-- האחרונים. הסדר מההעברה: קודם שכונות עם נכסים פעילים, ואז לפי העסקאות
-- (אין לנו מדד תנועה לדף, ולכן העסקאות במקומו).
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_describe_candidates(p_limit int default 10)
returns table (neighborhood_id uuid, city_slug text, slug text, name text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, i.city_slug, i.slug, i.name, i.city
    from public.neighborhood_page_index i
    join public.cities c on c.slug = i.city_slug
    join public.neighborhoods n on n.city_id = c.id and n.slug = i.slug
   where not exists (select 1 from public.neighborhood_descriptions d
                      where d.neighborhood_id = n.id
                        and (d.status in ('approved', 'draft')
                             or (d.status = 'rejected' and d.decided_at > now() - interval '30 days')))
   order by (i.props > 0) desc, i.props desc, i.deals desc, i.name
   limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke all on function public.neighborhood_describe_candidates(int) from public, anon, authenticated;
grant execute on function public.neighborhood_describe_candidates(int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. תיבת המשימות: התור החמישי
--
-- ‏_admin_inbox_rows נכתבת כאן מחדש, מהגרסה האחרונה שלה (20270719090000),
-- עם שורה לכל טיוטה. ‏"פתיחה" עוברת ל-accNeighborhoods (ADMIN_INBOX_KINDS).
-- ---------------------------------------------------------------------------

create or replace function public._admin_inbox_rows()
returns table (kind text, ref_id text, created_at timestamptz, meta jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'unrouted_lead', r.id::text, r.created_at,
         jsonb_build_object('lead_kind', r.lead_kind, 'reason', r.reason, 'city', r.city,
                            'deal_type', r.deal_type, 'source', r.source)
    from public.lead_routing_open r
  union all
  select 'refund', w.id::text, w.requested_at,
         jsonb_build_object('amount', coalesce(w.money_amount, w.amount),
                            'agent', (select m.display_name from public.agency_members m where m.id = w.agent_id))
    from public.wallet_refunds w
   where w.status = 'requested'
  union all
  select 'license_appeal', a.id::text, a.created_at,
         jsonb_build_object('name', a.applicant_name, 'license', a.license_number, 'source', a.source)
    from public.broker_license_appeals a
   where a.status = 'pending'
  union all
  select 'coach_gap', lower(btrim(q.gap_topic)), min(q.created_at),
         jsonb_build_object('topic', min(btrim(q.gap_topic)), 'asked', count(*))
    from public.coach_questions q
   where q.gap_topic is not null and q.gap_resolved_at is null
   group by lower(btrim(q.gap_topic))
  union all
  select 'hood_draft', d.id::text, d.created_at,
         jsonb_build_object('name', n.name, 'city', c.name)
    from public.neighborhood_descriptions d
    join public.neighborhoods n on n.id = d.neighborhood_id
    left join public.cities c on c.id = n.city_id
   where d.status = 'draft'
$$;

comment on function public._admin_inbox_rows() is
  'חמשת התורים של מנהל/ת הפלטפורמה כשורות אחידות, בלי טלפון, מייל או תוכן פנייה. נקרא רק מ-admin_inbox, admin_inbox_counts ו-admin_inbox_notify_overdue.';

revoke all on function public._admin_inbox_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. האישור (מנהל/ת פלטפורמה)
-- ---------------------------------------------------------------------------

create or replace function public.admin_hood_drafts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', n.name, 'city', c.name, 'city_slug', c.slug, 'slug', n.slug,
      'intro', d.intro, 'fits', d.fits, 'faq', d.faq, 'created_at', d.created_at,
      'replaces', exists (select 1 from public.neighborhood_descriptions x
                           where x.neighborhood_id = d.neighborhood_id and x.status = 'approved'))
      order by d.created_at)
    from public.neighborhood_descriptions d
    join public.neighborhoods n on n.id = d.neighborhood_id
    left join public.cities c on c.id = n.city_id
   where d.status = 'draft'), '[]'::jsonb);
end $$;

comment on function public.admin_hood_drafts() is
  'הטיוטות שממתינות לאישור, עם השכונה והעיר. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_hood_drafts() from public, anon, authenticated;
grant execute on function public.admin_hood_drafts() to authenticated;

-- ‏approve: הטקסט שנשלח (אחרי עריכה) הוא מה שמתפרסם - אחרי ניקוי מקף ארוך
-- ורווחים, ובתקרות אורך. תיאור מאושר קודם עובר ל-replaced.
create or replace function public.admin_hood_draft_decide(
  p_id uuid, p_decision text, p_intro text default null, p_fits text default null,
  p_faq jsonb default null, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_d public.neighborhood_descriptions;
  v_intro text := btrim(translate(coalesce(p_intro, ''), '—–', '--'));
  v_fits text := nullif(btrim(translate(coalesce(p_fits, ''), '—–', '--')), '');
  v_faq jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  select * into v_d from public.neighborhood_descriptions where id = p_id for update;
  if not found or v_d.status <> 'draft' then
    raise exception 'draft_not_pending' using errcode = '22023';
  end if;

  if p_decision = 'reject' then
    update public.neighborhood_descriptions
       set status = 'rejected', decided_at = now(), decided_by = public.current_agent_id(),
           decision_note = left(p_note, 300)
     where id = p_id;
    return;
  end if;
  if p_decision <> 'approve' then
    raise exception 'bad_decision' using errcode = '22023';
  end if;

  if v_intro = '' then v_intro := v_d.intro; end if;
  if v_fits is null and p_fits is null then v_fits := v_d.fits; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'q', left(btrim(translate(e->>'q', '—–', '--')), 200),
           'a', left(btrim(translate(e->>'a', '—–', '--')), 800))), '[]'::jsonb)
    into v_faq
    from jsonb_array_elements(coalesce(p_faq, v_d.faq)) e
   where btrim(coalesce(e->>'q', '')) <> '' and btrim(coalesce(e->>'a', '')) <> '';
  if char_length(v_intro) < 40 or char_length(v_intro) > 2000 or char_length(coalesce(v_fits, '')) > 1200 then
    raise exception 'text_length' using errcode = '22023';
  end if;

  update public.neighborhood_descriptions
     set status = 'replaced'
   where neighborhood_id = v_d.neighborhood_id and status = 'approved';
  update public.neighborhood_descriptions
     set status = 'approved', intro = v_intro, fits = v_fits, faq = v_faq,
         decided_at = now(), decided_by = public.current_agent_id(), decision_note = left(p_note, 300)
   where id = p_id;
end $$;

comment on function public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text) is
  'אישור (עם העריכה) או דחייה של טיוטת תיאור שכונה. רק מאושר מתפרסם. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_hood_draft_decide(uuid, text, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. הדף: התיאור המאושר (neighborhood_page מ-20270728090000, עם about)
-- ---------------------------------------------------------------------------

create or replace function public.neighborhood_page(p_city text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select n.id, n.name, n.slug, c.id as city_id, c.name as city, c.slug as city_slug, c.market_slug
      from public.neighborhoods n
      join public.cities c on c.id = n.city_id
     where c.slug = lower(btrim(coalesce(p_city, '')))
       and n.slug = public.neighborhood_slug(p_slug)
     order by n.created_at
     limit 1
  ), p as (
    select pr.id, pr.title, pr.property_type, pr.deal_type, pr.price, pr.rooms, pr.size_sqm,
           pr.images[1] as image, pr.updated_at
      from public.properties pr, h
     where pr.neighborhood_id = h.id and pr.status = 'active'
  ), d as (
    -- אותם גבולות של /deals ו-/prices: מגורים, מחיר ושטח שפויים, 24 חודשים
    select o.sale_price, o.rooms, round(o.sale_price / o.size_sqm) as ppsqm,
           case when o.rooms < 3.5 then 3 when o.rooms < 4.5 then 4
                when o.rooms < 5.5 then 5 else 6 end as bucket,
           o.sold_at
      from public.market_deals_official o, h
     where o.neighborhood_ids @> array[h.id]
       and o.sold_at > (select max(x.sold_at) from public.market_deals_official x
                         where x.neighborhood_ids @> array[h.id]) - interval '24 months'
       and coalesce(o.property_type, 'דירה') not in ('בנין', 'קרקע', 'משק חקלאי')
       and o.size_sqm between 25 and 400
       and o.sale_price between 200000 and 15000000
  ), rooms as (
    select d.bucket, count(*)::int as n,
           round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) as mp,
           round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) as mq
      from d where d.rooms is not null and d.rooms >= 1
     group by d.bucket
  )
  select case when not exists (select 1 from h) then null else jsonb_build_object(
    'name', (select name from h),
    'slug', (select slug from h),
    'city', (select city from h),
    'city_slug', (select city_slug from h),
    'market_slug', (select market_slug from h),
    'props_active', (select count(*) from p),
    'props_sale', (select count(*) from p where p.deal_type = 'sale'),
    'props_rent', (select count(*) from p where p.deal_type = 'rent'),
    'sale_min', (select min(p.price) from p where p.deal_type = 'sale' and p.price > 0),
    'sale_max', (select max(p.price) from p where p.deal_type = 'sale' and p.price > 0),
    'rent_min', (select min(p.price) from p where p.deal_type = 'rent' and p.price > 0),
    'rent_max', (select max(p.price) from p where p.deal_type = 'rent' and p.price > 0),
    'props', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
               select p.id, p.title, p.property_type, p.deal_type, p.price, p.rooms, p.size_sqm, p.image, p.updated_at
                 from p order by p.updated_at desc limit 12) x), '[]'::jsonb),
    'deals', (select count(*) from d),
    'period_start', (select min(d.sold_at) from d),
    'period_end', (select max(d.sold_at) from d),
    'median_price', case when (select count(*) from d) >= 5 then
                      (select round(percentile_cont(0.5) within group (order by d.sale_price)::numeric, -3) from d) end,
    'median_ppsqm', case when (select count(*) from d) >= 5 then
                      (select round(percentile_cont(0.5) within group (order by d.ppsqm)::numeric, -1) from d) end,
    'by_rooms', coalesce((select jsonb_agg(jsonb_build_object(
                  'rooms', r.bucket, 'deals', r.n,
                  'median_price', case when r.n >= 5 then r.mp end,
                  'median_ppsqm', case when r.n >= 5 then r.mq end) order by r.bucket) from rooms r), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug) order by s.name)
                  from public.neighborhood_pages_public() s, h
                 where s.city_slug = h.city_slug and s.slug <> h.slug), '[]'::jsonb),
    -- התיאור שאושר בתיבת המשימות (20270729090000). ‏null - עוד אין
    'about', (select jsonb_build_object('intro', d.intro, 'fits', d.fits, 'faq', d.faq, 'approved_at', d.decided_at)
                from public.neighborhood_descriptions d, h
               where d.neighborhood_id = h.id and d.status = 'approved'
               limit 1)
  ) end
$$;


-- ---------------------------------------------------------------------------
-- 5. פעם בשבוע, שני 06:17 UTC
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/neighborhood-describe';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - יש לתזמן את neighborhood-describe בדרך אחרת';
    return;
  end if;
  perform cron.unschedule('neighborhood-describe')
    where exists (select 1 from cron.job where jobname = 'neighborhood-describe');
  perform cron.schedule('neighborhood-describe', '17 6 * * 1', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 150000
    );
  $cron$, v_url));
end;
$$;
