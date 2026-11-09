-- ============================================================================
-- lead_escalations: גבריאלה שואלת לפי lead_id אם הליד טופל
-- ----------------------------------------------------------------------------
-- קריאה ל-service_role בלבד. אין טלפון ואין שם.
-- social-lead-intake לא משתנה. kind=buyer ממשיך להגיע עם consent_agent_contact,
-- והמזהה בשאילתה הוא search_id שחוזר מהקריאה (saved_searches.id).
--
-- ליד משויך: reminder_2h אחרי שעתיים פעילות, escalated_4h רק אחרי
-- שעתיים פעילות נוספות מאז התזכורת. לא שתיהן באותו סבב. השעון נעצר
-- מחוץ לחלון, וליד שנוצר לפני enabled_at לא נכנס. עד 10 מכל שלב בסבב.
-- הסלמה לנמען אחד: המנהל/ת הוותיק/ה. אם הסוכן/ת הוא/היא המנהל/ת, או
-- שאין מנהל/ת, ההסלמה למנהל/ת הפלטפורמה הוותיק/ה, בלי עותק שני.
-- מחפש/ת שכבר ירד/ה לביקוש הפתוח: escalated_4h אחרי 4 שעות פתוחות
-- (ראשון-חמישי 08:00-21:00, שישי 08:00-13:00, כלום משישי 13:00 עד ראשון 08:00)
-- אם אף סוכן/ת לא תפס/ה (claimed_by) ולא משך/ה (claim_lead), ורק אם
-- החיפוש נוצר אחרי enabled_at. עד 10 בסבב.
-- הדגל notif_send_window_friday_enabled נשאר 0. ב-0 הפונקציה מחזירה 0.
-- ============================================================================

create or replace function public.notification_business_elapsed(
  p_from timestamptz,
  p_to timestamptz
)
returns numeric
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select (p_from at time zone 'Asia/Jerusalem') as a,
           (p_to   at time zone 'Asia/Jerusalem') as b
  ),
  days as (
    select g::date as d
      from bounds b
      cross join lateral generate_series(
        date_trunc('day', b.a), date_trunc('day', b.b), interval '1 day') g
     where b.b > b.a
  ),
  spans as (
    select d.d,
           d.d + time '08:00' as open_at,
           d.d + case extract(dow from d.d)::int
                   when 5 then time '13:00'
                   when 6 then time '08:00'
                   else time '21:00'
                 end as close_at
      from days d
  )
  select coalesce(sum(
           extract(epoch from (least(s.close_at, b.b) - greatest(s.open_at, b.a)))
           / 3600.0
         ), 0)
    from spans s
    cross join bounds b
   where extract(dow from s.d)::int <> 6
     and least(s.close_at, b.b) > greatest(s.open_at, b.a);
$$;

comment on function public.notification_business_elapsed(timestamptz, timestamptz) is
  'שעות פתוחות בין שני רגעים, שעון ישראל: ראשון-חמישי 08:00-21:00, שישי 08:00-13:00, שבת סגורה (20271029250000).';

revoke all on function public.notification_business_elapsed(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_business_elapsed(timestamptz, timestamptz) to service_role;

create table if not exists public.lead_escalations (
  lead_id           uuid not null,
  stage             text not null check (stage in ('reminder_2h', 'escalated_4h')),
  escalated_at      timestamptz not null,
  escalated_to_role text check (escalated_to_role in ('agent', 'manager', 'platform_admin', 'unclaimed')),
  resolved_at       timestamptz,
  resolution        text check (resolution is null or resolution in ('opened', 'claimed', 'closed')),
  primary key (lead_id, stage),
  constraint lead_escalations_resolved check (
    (resolved_at is null and resolution is null)
    or (resolved_at is not null and resolution is not null)
  )
);

comment on table public.lead_escalations is
  'האם ליד הוסלם, בלי טלפון ובלי שם. service_role קורא. lead_id של מחפש/ת מהרשתות הוא saved_searches.id (20271029250000).';
comment on column public.lead_escalations.lead_id is
  'leads.id לליד משויך, או saved_searches.id (ה-search_id שחוזר מ-social-lead-intake) למחפש/ת בביקוש הפתוח.';
comment on column public.lead_escalations.stage is
  'reminder_2h לסוכן/ת אחרי שעתיים. escalated_4h למנהל/ת, למנהל/ת הפלטפורמה, או unclaimed בביקוש הפתוח.';
comment on column public.lead_escalations.resolution is
  'opened: יש מענה. claimed: תפיסה או משיכה בלי מענה. closed: ארכיון. null: עדיין לא טופל.';

alter table public.lead_escalations enable row level security;

revoke all on table public.lead_escalations from public, anon, authenticated, service_role;
grant select on table public.lead_escalations to service_role;

-- ---------------------------------------------------------------------------
-- חותמת ההדלקה. המעבר של הדגל מ-0 ל-1 רושם אותה. ליד שנוצר לפניה
-- לא נכנס לתזכורת ולא להסלמה. עדכון בלי שינוי הערך לא מזיז אותה.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_send_window_state (
  id         int primary key check (id = 1),
  enabled_at timestamptz
);

comment on table public.notification_send_window_state is
  'חותמת ההדלקה של notif_send_window_friday_enabled. ליד שנוצר לפניה לא מוסלם (20271029250000).';

revoke all on table public.notification_send_window_state from public, anon, authenticated, service_role;
grant select, insert, update on table public.notification_send_window_state to service_role;
alter table public.notification_send_window_state enable row level security;

create or replace function public.notification_send_window_flag_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key is distinct from 'notif_send_window_friday_enabled' then
    return new;
  end if;
  if coalesce(new.value, 0) = 1
     and (tg_op = 'INSERT' or coalesce(old.value, 0) is distinct from 1) then
    insert into public.notification_send_window_state (id, enabled_at)
    values (1, pg_catalog.now())
    on conflict (id) do update
      set enabled_at = excluded.enabled_at;
  end if;
  return new;
end;
$$;

comment on function public.notification_send_window_flag_touch() is
  'במעבר notif_send_window_friday_enabled מ-0 ל-1 רושם enabled_at. עדכון בלי שינוי הערך לא מזיז את החותמת (20271029250000).';

revoke all on function public.notification_send_window_flag_touch() from public, anon, authenticated;
grant execute on function public.notification_send_window_flag_touch() to service_role;

drop trigger if exists notification_send_window_flag_touch on public.pricing_config;
create trigger notification_send_window_flag_touch
  after insert or update on public.pricing_config
  for each row execute function public.notification_send_window_flag_touch();

-- ---------------------------------------------------------------------------
-- תזכורת ואז הסלמה, בנפרד. המפתח (lead_id, stage) הוא האידמפוטנטיות.
-- הספירה המוחזרת היא מספר שורות ההתראה, לא שורות הטבלה.
-- ---------------------------------------------------------------------------
create or replace function public.lead_response_escalations(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag  int;
  v_n     int := 0;
  v_ins   int;
  v_since timestamptz;
begin
  v_flag := coalesce((select value::int from public.pricing_config
                       where key = 'notif_send_window_friday_enabled'), 0);
  if v_flag <> 1 or not public.notification_send_window_open(p_now) then
    return 0;
  end if;

  select s.enabled_at into v_since
    from public.notification_send_window_state s
   where s.id = 1;
  if v_since is null then
    insert into public.notification_send_window_state (id, enabled_at)
    values (1, p_now)
    on conflict (id) do update
      set enabled_at = coalesce(public.notification_send_window_state.enabled_at, excluded.enabled_at)
    returning enabled_at into v_since;
  end if;

  with demand as (
    select distinct on (ss.id)
           ss.id as search_id,
           sc.claimed_by,
           sc.claimed_at,
           l.id as lead_row,
           l.first_response_at,
           l.unlocked_by,
           l.unlocked_at,
           l.created_at as lead_created
      from public.saved_searches ss
      join public.social_leads sl
        on sl.kind = 'buyer'
       and sl.channel = ss.source
       and sl.status in ('routing', 'routed')
       and sl.received_at >= ss.created_at - interval '30 minutes'
       and sl.received_at <= ss.created_at + interval '30 minutes'
       and (
            (public.phone_tail9(sl.payload->>'phone') is not null
             and public.phone_tail9(sl.payload->>'phone')
                 = public.phone_tail9(coalesce(ss.phone_e164, ss.phone)))
         or (nullif(lower(btrim(coalesce(sl.payload->>'email', ''))), '') is not null
             and lower(btrim(sl.payload->>'email'))
                 = lower(btrim(coalesce(ss.email, ''))))
       )
      join public.scraped_leads sc
        on sc.source = ss.source
       and sc.external_ref = sl.zernio_id
       and sc.lead_type = 'seeker_inbound'
      left join public.leads l
        on l.source = sc.source
       and l.external_ref = sc.external_ref
     where ss.id in (select e.lead_id from public.lead_escalations e where e.resolution is null)
     order by ss.id, sl.received_at desc
  ),
  picked as (
    select e.lead_id,
           e.stage,
           case
             when a.lead_id is not null or da.lead_id is not null then 'closed'
             when l.first_response_at is not null or d.first_response_at is not null then 'opened'
             when d.claimed_by is not null
               or (d.unlocked_by is not null
                   and d.unlocked_at > d.lead_created + interval '1 second')
               or (l.unlocked_by is not null
                   and l.unlocked_at > l.created_at + interval '1 second')
             then 'claimed'
           end as resolution,
           case
             when a.lead_id is not null then a.archived_at
             when da.lead_id is not null then da.archived_at
             when l.first_response_at is not null then l.first_response_at
             when d.first_response_at is not null then d.first_response_at
             when d.claimed_by is not null then coalesce(d.claimed_at, p_now)
             when d.unlocked_by is not null
                  and d.unlocked_at > d.lead_created + interval '1 second'
               then d.unlocked_at
             when l.unlocked_by is not null
                  and l.unlocked_at > l.created_at + interval '1 second'
               then l.unlocked_at
           end as at
      from public.lead_escalations e
      left join public.leads l on l.id = e.lead_id
      left join public.lead_archives a on a.lead_id = e.lead_id
      left join demand d on d.search_id = e.lead_id
      left join public.lead_archives da on da.lead_id = d.lead_row
     where e.resolution is null
  )
  update public.lead_escalations e
     set resolution = p.resolution,
         resolved_at = p.at
    from picked p
   where e.lead_id = p.lead_id
     and e.stage = p.stage
     and p.resolution is not null;

  with due as (
    select l.id
      from public.leads l
      join public.agency_members m
        on m.id = l.agent_id and m.active and m.closed_at is null
     where l.agent_id is not null
       and l.first_response_at is null
       and l.created_at >= v_since
       and l.created_at > p_now - interval '7 days'
       and public.notification_business_elapsed(l.created_at, p_now) >= 2
       and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
       and not exists (
         select 1 from public.lead_escalations e
          where e.lead_id = l.id and e.stage = 'reminder_2h')
     order by l.created_at
     limit 10
  ),
  marked as (
    insert into public.lead_escalations (lead_id, stage, escalated_at, escalated_to_role)
    select d.id, 'reminder_2h', p_now, 'agent'
      from due d
    on conflict (lead_id, stage) do nothing
    returning lead_id
  )
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  select l.agent_id, 'lead_response_reminder',
         'ליד בלי מענה',
         'עברו שעתיים והליד עדיין בלי מענה.',
         l.id, false
    from marked m
    join public.leads l on l.id = m.lead_id;
  get diagnostics v_ins = row_count;
  v_n := v_n + v_ins;

  with due as (
    select l.id as lead_id,
           l.agent_id,
           mgr.id as manager_id,
           adm.id as admin_id
      from public.leads l
      join public.lead_escalations e
        on e.lead_id = l.id
       and e.stage = 'reminder_2h'
       and e.resolution is null
      left join lateral (
        select m.id
          from public.agency_members m
         where m.agency_id = coalesce(
                 l.agency_id,
                 (select am.agency_id from public.agency_members am where am.id = l.agent_id))
           and m.role = 'manager'
           and m.active
           and m.closed_at is null
         order by m.created_at asc nulls last, m.id asc
         limit 1
      ) mgr on true
      left join lateral (
        select m.id
          from public.agency_members m
         where m.is_platform_admin
           and m.active
           and m.closed_at is null
         order by m.created_at asc nulls last, m.id asc
         limit 1
      ) adm on true
     where l.first_response_at is null
       and l.created_at >= v_since
       and l.created_at > p_now - interval '7 days'
       and public.notification_business_elapsed(e.escalated_at, p_now) >= 2
       and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
       and not exists (
         select 1 from public.lead_escalations x
          where x.lead_id = l.id and x.stage = 'escalated_4h')
     order by e.escalated_at
     limit 10
  ),
  chosen as (
    select d.lead_id,
           d.agent_id,
           case
             when d.manager_id is not null and d.manager_id is distinct from d.agent_id
               then d.manager_id
             when d.admin_id is not null and d.admin_id is distinct from d.agent_id
               then d.admin_id
           end as recipient_id,
           case
             when d.manager_id is not null and d.manager_id is distinct from d.agent_id
               then 'manager'
             when d.admin_id is not null and d.admin_id is distinct from d.agent_id
               then 'platform_admin'
             when d.manager_id is not null then 'manager'
             else 'agent'
           end as dest_role
      from due d
  ),
  marked as (
    insert into public.lead_escalations (lead_id, stage, escalated_at, escalated_to_role)
    select c.lead_id, 'escalated_4h', p_now, c.dest_role
      from chosen c
    on conflict (lead_id, stage) do nothing
    returning lead_id
  )
  insert into public.notifications (agent_id, type, title, body, related_lead_id, suppress_push)
  select c.recipient_id, 'lead_response_escalation',
         'ליד בלי מענה - למנהל/ת',
         'עברו ארבע שעות פעילות בלי מענה לליד.',
         c.lead_id, false
    from marked m
    join chosen c on c.lead_id = m.lead_id
   where c.recipient_id is not null;
  get diagnostics v_ins = row_count;
  v_n := v_n + v_ins;

  insert into public.lead_escalations (lead_id, stage, escalated_at, escalated_to_role)
  select d.lead_id, 'escalated_4h', p_now, 'unclaimed'
    from (
      select distinct on (ss.id)
             ss.id as lead_id,
             ss.created_at,
             sc.claimed_by,
             sc.source,
             sc.external_ref
        from public.saved_searches ss
        join public.social_leads sl
          on sl.kind = 'buyer'
         and sl.channel = ss.source
         and sl.status in ('routing', 'routed')
         and ss.source ~ '^(facebook|instagram)_[a-z]{2,20}$'
         and sl.received_at >= ss.created_at - interval '30 minutes'
         and sl.received_at <= ss.created_at + interval '30 minutes'
         and (
              (public.phone_tail9(sl.payload->>'phone') is not null
               and public.phone_tail9(sl.payload->>'phone')
                   = public.phone_tail9(coalesce(ss.phone_e164, ss.phone)))
           or (nullif(lower(btrim(coalesce(sl.payload->>'email', ''))), '') is not null
               and lower(btrim(sl.payload->>'email'))
                   = lower(btrim(coalesce(ss.email, ''))))
         )
        join public.scraped_leads sc
          on sc.source = ss.source
         and sc.external_ref = sl.zernio_id
         and sc.status = 'open_demand'
         and sc.lead_type = 'seeker_inbound'
       where ss.agency_id is null
         and ss.sold_to_agent_id is null
         and ss.created_at >= v_since
         and ss.created_at <= p_now
         and ss.created_at > p_now - interval '7 days'
       order by ss.id, sl.received_at desc
    ) d
   where public.notification_business_elapsed(d.created_at, p_now) >= 4
     and d.claimed_by is null
     and not exists (
       select 1 from public.leads l
        where l.source = d.source
          and l.external_ref = d.external_ref
          and (
            l.first_response_at is not null
            or (l.unlocked_by is not null
                and l.unlocked_at > l.created_at + interval '1 second')
          )
     )
   order by d.created_at
   limit 10
  on conflict (lead_id, stage) do nothing;

  return v_n;
end;
$$;

comment on function public.lead_response_escalations(timestamptz) is
  'תזכורת אחרי שעתיים פעילות, והסלמה לנמען אחד אחרי שעתיים פעילות נוספות. עד 10 בסבב, רק אחרי enabled_at. דגל 0 או חלון סגור מחזיר 0 (20271029250000).';

revoke all on function public.lead_response_escalations(timestamptz) from public, anon, authenticated;
grant execute on function public.lead_response_escalations(timestamptz) to service_role;

-- ליד שההסלמה עליו הגיעה לפעמון, גם כשהוא אינו של הסוכן/ת ולא של המשרד.
-- לא נפתח כל ליד בפלטפורמה: רק שורה שיש עליה התראה של המענה אצל הקורא/ת.
drop policy if exists "read escalated lead" on public.leads;
create policy "read escalated lead"
  on public.leads
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.notifications n
       where n.related_lead_id = leads.id
         and n.agent_id = public.current_agent_id()
         and n.type in ('lead_response_reminder', 'lead_response_escalation')
    )
  );
