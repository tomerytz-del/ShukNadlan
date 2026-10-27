-- PR 1010, Part 7 §C.3: fields for the agent and agency cards.
-- Written in PR 1010, NOT applied. Before applying: copy the live agency_members_public definition
-- and add the new columns at the end, run the view-grants audit (security_invoker, no anon writes),
-- and confirm the update policy on agency_members covers the new columns.
alter table public.agency_members
  add column if not exists whatsapp_e164   text check (whatsapp_e164 ~ '^\+9725\d{8}$'),
  add column if not exists languages       text[] not null default '{he}',
  add column if not exists video_intro_url text,
  add column if not exists photo_focal_x   smallint check (photo_focal_x between 0 and 100),
  add column if not exists photo_focal_y   smallint check (photo_focal_y between 0 and 100),
  add column if not exists profile_completed_at timestamptz;

comment on column public.agencies.specialty_areas is 'deprecated: use service_markets/specialties';

-- response time: median of the last 90 days, only from 5 leads up
create or replace view public.agent_response_stats
with (security_invoker = true) as
select agent_id,
       count(*) filter (where first_response_at is not null) as answered_90d,
       percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at)/60)
         filter (where first_response_at is not null) as median_minutes
from public.leads
where agent_id is not null and created_at > now() - interval '90 days'
group by agent_id
having count(*) filter (where first_response_at is not null) >= 5;
-- the public view exposes a bucket only: 'within_hour' | 'same_day' | null (not minutes)

create or replace view public.agency_markets_v
with (security_invoker = true) as
select agency_id, array_agg(distinct m) as service_markets
from public.agency_members, unnest(service_markets) m
where active and is_active_agent
group by agency_id;

-- agency_members_public: add whatsapp_e164, languages, video_intro_url, photo_focal_x/y, gender
--   (create or replace view, same column order + additions at the end, same grants)

-- the lead source for /sell
-- lead_source_channel(): when source like 'sell_page%' then 'sell_page'
