-- ============================================================================
-- DRAFT - office owner dashboard (דאשבורד בעל משרד)
--
-- NOT ready to run as is. Before turning this into a migration:
--   1. Verify every column against the live database (information_schema.columns).
--      Base tables (leads, properties, agency_members) predate supabase/migrations/.
--      Columns marked VERIFY are guesses based on usage in crm.js.
--   2. Save as supabase/migrations/<next free version>_office_dashboard.sql
--      (latest seen: 20270403090000). Follow .claude/skills/new-migration.
--   3. Never apply through MCP apply_migration - the CI pipeline only.
-- See HANDOFF.md sections 2-3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. properties.closed_at - when a property became sold/rented
-- ---------------------------------------------------------------------------
alter table public.properties add column if not exists closed_at timestamptz;

create or replace function public.properties_set_closed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('sold', 'rented') and (old.status is distinct from new.status) then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.status not in ('sold', 'rented') then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.properties_set_closed_at() from public, anon, authenticated;

drop trigger if exists trg_properties_set_closed_at on public.properties;
create trigger trg_properties_set_closed_at
  before update of status on public.properties
  for each row execute function public.properties_set_closed_at();

-- Backfill: only where we actually know the date. Unknown stays null and is not counted.
update public.properties
   set closed_at = sale_closed_on::timestamptz
 where status in ('sold', 'rented')
   and closed_at is null
   and sale_closed_on is not null;

create index if not exists properties_agency_closed_idx on public.properties (agency_id, closed_at) where closed_at is not null;
create index if not exists properties_agency_created_idx on public.properties (agency_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. agent_targets - quarterly / monthly goals set by the office manager
-- ---------------------------------------------------------------------------
create table if not exists public.agent_targets (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  agent_id          uuid not null references public.agency_members (id) on delete cascade,
  period_kind       text not null check (period_kind in ('month', 'quarter')),
  period_start      date not null,
  commission_target numeric(12, 2),
  deals_target      int,
  recruited_target  int,
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  unique (agent_id, period_kind, period_start)
);
-- NOTE: agent_id is an FK to agency_members. If another FK to agency_members is
-- ever added here, add the table to MULTI_FK_TABLES in scripts/check_agency_embed.py.

alter table public.agent_targets enable row level security;

drop policy if exists "manager manages office targets" on public.agent_targets;
create policy "manager manages office targets" on public.agent_targets
  for all to authenticated
  using (
    (select public.current_member_role()) = 'manager'
    and agency_id = (select public.current_agency_id())
  )
  with check (
    (select public.current_member_role()) = 'manager'
    and agency_id = (select public.current_agency_id())
    and agent_id in (select m.id from public.agency_members m where m.agency_id = (select public.current_agency_id()))
  );

drop policy if exists "agent reads own targets" on public.agent_targets;
create policy "agent reads own targets" on public.agent_targets
  for select to authenticated
  using (agent_id = (select public.current_agent_id()));

revoke all on public.agent_targets from anon;
grant select, insert, update, delete on public.agent_targets to authenticated;

-- ---------------------------------------------------------------------------
-- 3. office_dashboard(p_from, p_to) - aggregates only, managers only
-- ---------------------------------------------------------------------------
create or replace function public.office_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agency  uuid := public.current_agency_id();
  v_len     int;
  v_pfrom   date;
  v_pto     date;
  v_result  jsonb;
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    raise exception 'office_dashboard: managers only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'office_dashboard: bad period' using errcode = '22023';
  end if;

  v_len   := (p_to - p_from) + 1;
  v_pto   := p_from - 1;
  v_pfrom := p_from - v_len;

  with
  members as (
    select m.id, m.display_name, m.role
      from agency_members m
     where m.agency_id = v_agency
       and m.active                                   -- VERIFY column name
  ),
  -- Leads with a response time. Phase 1 = proxy (HANDOFF 3.1). Phase 2: use l.first_response_at.
  lead_rows as (
    select l.id, l.agent_id, l.created_at, l.source,
           least(
             case when l.unlocked_at > l.created_at + interval '1 second' then l.unlocked_at end,
             (select min(a.completed_at)
                from agent_agenda_items a
               where a.lead_id = l.id
                 and a.auto_kind = 'lead_followup'
                 and a.status = 'done')
           ) as responded_at
      from leads l
     where l.agency_id = v_agency
       and l.created_at >= v_pfrom
       and l.created_at <  p_to + 1
  ),
  lead_cur as (
    select lr.*, extract(epoch from (lr.responded_at - lr.created_at)) / 60.0 as resp_min
      from lead_rows lr
     where lr.created_at >= p_from
  ),
  props as (
    select p.id, p.agent_id, p.created_at, p.status, p.deal_type, p.price,
           p.sale_closed_price,
           coalesce(p.closed_at, p.sale_closed_on::timestamptz) as closed_ts
      from properties p
     where p.agency_id = v_agency
  ),
  -- Commission estimate - keep in sync with propertyCommission() in assets/crm.js (COMMISSION_SALE_RATE = 0.02).
  deal_rows as (
    select pr.agent_id, pr.closed_ts,
           coalesce(
             (select max(coalesce(ag.commission_amount,
                                  ag.commission_pct / 100.0 * coalesce(pr.sale_closed_price, pr.price)))
                from agreements ag
               where ag.status = 'signed'
                 and pr.id = any (ag.property_ids)),
             case when pr.deal_type = 'rent'                -- VERIFY value
                  then coalesce(pr.sale_closed_price, pr.price)
                  else coalesce(pr.sale_closed_price, pr.price) * 0.02 end
           ) as commission
      from props pr
     where pr.status in ('sold', 'rented')
       and pr.closed_ts >= v_pfrom
       and pr.closed_ts <  p_to + 1
  ),
  excl as (
    select e.agent_id, e.property_id, e.starts_on
      from property_exclusivities e
     where e.agency_id = v_agency
       and e.starts_on >= v_pfrom
       and e.starts_on <= p_to
  ),
  agr as (
    select a.agent_id, a.kind, a.signed_at
      from agreements a
     where a.agency_id = v_agency
       and a.status = 'signed'
       and a.signed_at >= v_pfrom
       and a.signed_at <  p_to + 1
  ),
  agenda as (
    select a.agent_id, a.kind, a.property_id
      from agent_agenda_items a
     where a.agent_id in (select id from members)
       and a.kind in ('meeting', 'showing')
       and a.status <> 'canceled'
       and a.due_at >= p_from
       and a.due_at <  p_to + 1
  ),
  targets as (
    select t.agent_id, sum(t.commission_target) as commission_target
      from agent_targets t
     where t.agency_id = v_agency
       and t.period_start >= p_from
       and t.period_start <= p_to
     group by t.agent_id
  ),
  agents_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', m.id,
      'agent', m.display_name,
      'role', m.role,
      'leads',        (select count(*) from lead_cur l where l.agent_id = m.id),
      'leads_prev',   (select count(*) from lead_rows l where l.agent_id = m.id and l.created_at < p_from),
      'responded',    (select count(*) from lead_cur l where l.agent_id = m.id and l.responded_at is not null),
      'avg_response_min',    (select round(avg(l.resp_min)) from lead_cur l where l.agent_id = m.id),
      'median_response_min', (select round((percentile_cont(0.5) within group (order by l.resp_min))::numeric) from lead_cur l where l.agent_id = m.id and l.resp_min is not null),
      'avg_response_min_prev', (select round(avg(extract(epoch from (l.responded_at - l.created_at)) / 60.0)) from lead_rows l where l.agent_id = m.id and l.created_at < p_from),
      'open_unanswered', (select count(*) from leads l
                           where l.agency_id = v_agency and l.agent_id = m.id
                             and l.created_at > now() - interval '30 days'
                             and l.created_at < now() - interval '1 hour'
                             and not (l.unlocked_at > l.created_at + interval '1 second')),  -- phase 2: first_response_at is null
      'meetings',   (select count(*) from agenda a where a.agent_id = m.id),
      'showings',   (select count(*) from agenda a where a.agent_id = m.id and a.kind = 'showing'),
      'recruited',      (select count(*) from props p where p.agent_id = m.id and p.created_at >= p_from and p.created_at < p_to + 1),
      'recruited_prev', (select count(*) from props p where p.agent_id = m.id and p.created_at >= v_pfrom and p.created_at < p_from),
      'exclusives',      (select count(distinct e.property_id) from excl e where e.agent_id = m.id and e.starts_on >= p_from),
      'exclusives_prev', (select count(distinct e.property_id) from excl e where e.agent_id = m.id and e.starts_on < p_from),
      'agreements',      (select count(*) from agr a where a.agent_id = m.id and a.signed_at >= p_from),
      'agreements_prev', (select count(*) from agr a where a.agent_id = m.id and a.signed_at < p_from),
      'agreements_sell', (select count(*) from agr a where a.agent_id = m.id and a.signed_at >= p_from and a.kind in ('sell','landlord','exclusive_sell','exclusive_landlord')),
      'agreements_buy',  (select count(*) from agr a where a.agent_id = m.id and a.signed_at >= p_from and a.kind in ('buy','tenant')),
      'deals',           (select count(*) from deal_rows d where d.agent_id = m.id and d.closed_ts >= p_from),
      'deals_prev',      (select count(*) from deal_rows d where d.agent_id = m.id and d.closed_ts < p_from),
      'commission',      (select coalesce(round(sum(d.commission)), 0) from deal_rows d where d.agent_id = m.id and d.closed_ts >= p_from),
      'commission_prev', (select coalesce(round(sum(d.commission)), 0) from deal_rows d where d.agent_id = m.id and d.closed_ts < p_from),
      'commission_target', (select t.commission_target from targets t where t.agent_id = m.id),
      'active_listings', (select count(*) from props p where p.agent_id = m.id and p.status = 'active')
    ) order by m.display_name), '[]'::jsonb) as j
    from members m
  ),
  buckets_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'agent_id', b.agent_id, 'agent', m.display_name,
             'bucket_order', b.o, 'bucket', b.label, 'leads', b.n) order by m.display_name, b.o), '[]'::jsonb) as j
      from (
        select l.agent_id,
               case when l.resp_min is null then 6
                    when l.resp_min <= 5 then 1
                    when l.resp_min <= 15 then 2
                    when l.resp_min <= 60 then 3
                    when l.resp_min <= 240 then 4
                    else 5 end as o,
               count(*) as n
          from lead_cur l
         group by 1, 2
      ) b
      join members m on m.id = b.agent_id
      cross join lateral (select (array['עד 5 דק''', '5-15 דק''', '15-60 דק''', '1-4 שעות', 'מעל 4 שעות', 'ללא מענה'])[b.o] as label) lbl
  ),
  months as (
    select to_char(gs, 'YYYY-MM') as month, gs::date as m_from, (gs + interval '1 month')::date as m_to
      from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') gs
  ),
  monthly_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', mo.month, 'agent_id', m.id, 'agent', m.display_name,
      'leads',      (select count(*) from leads l where l.agency_id = v_agency and l.agent_id = m.id and l.created_at >= mo.m_from and l.created_at < mo.m_to),
      'recruited',  (select count(*) from props p where p.agent_id = m.id and p.created_at >= mo.m_from and p.created_at < mo.m_to),
      'exclusives', (select count(*) from property_exclusivities e where e.agency_id = v_agency and e.agent_id = m.id and e.starts_on >= mo.m_from and e.starts_on < mo.m_to),
      'agreements', (select count(*) from agreements a where a.agency_id = v_agency and a.agent_id = m.id and a.status = 'signed' and a.signed_at >= mo.m_from and a.signed_at < mo.m_to),
      'deals',      (select count(*) from props p where p.agent_id = m.id and p.status in ('sold','rented') and p.closed_ts >= mo.m_from and p.closed_ts < mo.m_to),
      'commission', 0  -- TODO: same estimate as deal_rows, per month (deal_rows only covers the two periods)
    ) order by mo.month, m.display_name), '[]'::jsonb) as j
    from months mo cross join members m
  ),
  sources_json as (
    -- TODO: map l.source to the same labels as LX_SOURCES / lead_analytics.sql:250-265, not raw text.
    select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'leads', s.n, 'deals', 0) order by s.n desc), '[]'::jsonb) as j
      from (select coalesce(l.source, 'other') as source, count(*) as n from lead_cur l group by 1) s
  ),
  expiring_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'property_id', p.id,
             'property', p.title,                              -- VERIFY column (title / address / listing_number)
             'agent', m.display_name,
             'exclusivity_end', e.ends_on,
             'asking_price', p.price,
             'days_on_market', (current_date - p.created_at::date),
             'showings', (select count(*) from agent_agenda_items a where a.property_id = p.id and a.kind = 'showing' and a.status <> 'canceled')
           ) order by e.ends_on), '[]'::jsonb) as j
      from property_exclusivities e
      join properties p on p.id = e.property_id
      left join members m on m.id = e.agent_id
     where e.agency_id = v_agency
       and e.released_at is null
       and e.ends_on between current_date and current_date + 30
  )
  select jsonb_build_object(
           'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_pfrom, 'prev_to', v_pto),
           'agents', (select j from agents_json),
           'response_buckets', (select j from buckets_json),
           'monthly', (select j from monthly_json),
           'lead_sources', (select j from sources_json),
           'expiring', (select j from expiring_json),
           'data_notes', jsonb_build_object('response_time_method', 'proxy', 'commission_method', 'estimate')
         )
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.office_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.office_dashboard(date, date) to authenticated;
