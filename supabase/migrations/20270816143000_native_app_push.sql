-- ---------------------------------------------------------------------------
-- version 20270816143000: אחרי 20270815090000_neighborhood_deal_stats.
-- התראות לאפליקציה (Android / iOS). האתר ממשיך לעבוד בלעדיהן: הטריגרים
-- בולעים כשל, והרישום נעשה רק מהאפליקציה דרך register_app_push_device.
--
-- שני מקורות:
--   notifications          ליד, התאמה, או כל התראה שכבר נכתבת לסוכן/ת
--   saved_search_alerts    נכס חדש שמתאים לחיפוש שמור, אם המכשיר קושר
--                          את עצמו לאותו חיפוש (search_id)
--
-- השליחה עצמה אינה כאן. mobile/scripts/send-push.mjs מושך את התור כשיש
-- מפתח FCM או APNs. בלי מפתח השורות נשארות pending.
-- ---------------------------------------------------------------------------

create table if not exists public.app_push_devices (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  device_key uuid not null,
  user_id uuid,
  saved_search_id uuid references public.saved_searches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint app_push_devices_token_key unique (token),
  constraint app_push_devices_token_len check (char_length(token) between 20 and 4096)
);

comment on table public.app_push_devices is
  'מכשיר שהאפליקציה רשמה להתראות. האסימון הוא מזהה FCM או APNs, לא טלפון ולא שם.';

create table if not exists public.app_push_outbox (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.app_push_devices(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null,
  kind text not null check (kind in ('notification', 'saved_search')),
  source_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint app_push_outbox_once unique (device_id, kind, source_id)
);

comment on table public.app_push_outbox is
  'תור דחיפה לאפליקציה. send-push.mjs מסמן sending ואז sent או failed.';

alter table public.app_push_devices enable row level security;
alter table public.app_push_outbox enable row level security;

revoke all on table public.app_push_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.app_push_devices to service_role;

revoke all on table public.app_push_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.app_push_outbox to service_role;

create index if not exists app_push_devices_user_idx
  on public.app_push_devices (user_id)
  where disabled_at is null and user_id is not null;

create index if not exists app_push_devices_search_idx
  on public.app_push_devices (saved_search_id)
  where disabled_at is null and saved_search_id is not null;

create index if not exists app_push_outbox_pending_idx
  on public.app_push_outbox (created_at)
  where status = 'pending';

-- הרישום מהאפליקציה. האנונימי יכול לרשום מכשיר (התראת חיפוש שמור בלי חשבון),
-- והמחובר נקשר ל-auth.uid(). בלי device_key תואם אי אפשר לדרוס אסימון קיים.
create or replace function public.register_app_push_device(
  p_token text,
  p_platform text,
  p_device_key uuid,
  p_saved_search_id uuid default null,
  p_clear_user boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if p_platform not in ('android', 'ios') then
    raise exception 'platform';
  end if;
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 4096 then
    raise exception 'token';
  end if;
  if p_saved_search_id is not null and not exists (
    select 1 from public.saved_searches s where s.id = p_saved_search_id
  ) then
    p_saved_search_id := null;
  end if;
  if not exists (select 1 from public.app_push_devices d where d.token = p_token)
     and (select count(*) from public.app_push_devices d where d.device_key = p_device_key) >= 3 then
    raise exception 'too_many_devices';
  end if;

  insert into public.app_push_devices as d (token, platform, device_key, user_id, saved_search_id)
  values (
    p_token,
    p_platform,
    p_device_key,
    case when p_clear_user then null else v_user end,
    p_saved_search_id
  )
  on conflict (token) do update set
    platform = excluded.platform,
    updated_at = now(),
    disabled_at = null,
    saved_search_id = coalesce(excluded.saved_search_id, d.saved_search_id),
    user_id = case
      when p_clear_user then null
      when v_user is not null then v_user
      else d.user_id
    end
  where d.device_key = excluded.device_key
  returning d.id into v_id;

  if v_id is null then
    raise exception 'token_in_use';
  end if;
  return v_id;
end;
$$;

revoke all on function public.register_app_push_device(text, text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.register_app_push_device(text, text, uuid, uuid, boolean) to anon, authenticated, service_role;

create or replace function public.app_push_enqueue(
  p_device_id uuid,
  p_title text,
  p_body text,
  p_url text,
  p_kind text,
  p_source_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('notification', 'saved_search') then
    return;
  end if;
  if p_url is null or p_url !~ '^https://shuknadlan\.co\.il/' then
    return;
  end if;
  insert into public.app_push_outbox (device_id, title, body, url, kind, source_id)
  values (
    p_device_id,
    left(coalesce(nullif(btrim(p_title), ''), 'שוק נדל״ן'), 120),
    left(coalesce(nullif(btrim(p_body), ''), 'יש עדכון חדש'), 300),
    p_url,
    p_kind,
    p_source_id
  )
  on conflict (device_id, kind, source_id) do nothing;
end;
$$;

revoke all on function public.app_push_enqueue(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_push_enqueue(uuid, text, text, text, text, uuid) to service_role;

create or replace function public.app_push_claim_pending(p_limit integer)
returns table (
  id uuid,
  token text,
  platform text,
  title text,
  body text,
  url text,
  device_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with cte as (
    select o.id as oid
    from public.app_push_outbox o
    join public.app_push_devices d on d.id = o.device_id
    where o.status = 'pending'
      and d.disabled_at is null
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 40), 100))
    for update of o skip locked
  ),
  upd as (
    update public.app_push_outbox o
    set status = 'sending', attempts = o.attempts + 1
    from cte
    where o.id = cte.oid
    returning o.id, o.device_id, o.title, o.body, o.url
  )
  select upd.id, d.token, d.platform, upd.title, upd.body, upd.url, upd.device_id
  from upd
  join public.app_push_devices d on d.id = upd.device_id;
end;
$$;

revoke all on function public.app_push_claim_pending(integer) from public, anon, authenticated;
grant execute on function public.app_push_claim_pending(integer) to service_role;

create or replace function public.app_push_mark(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_disable_device boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device uuid;
begin
  if p_status not in ('pending', 'sent', 'failed') then
    raise exception 'status';
  end if;
  update public.app_push_outbox o
  set status = p_status,
      last_error = left(p_error, 300),
      sent_at = case when p_status = 'sent' then now() else o.sent_at end
  where o.id = p_id
    and o.status = 'sending'
  returning o.device_id into v_device;

  if p_disable_device and v_device is not null then
    update public.app_push_devices
    set disabled_at = now(), updated_at = now()
    where id = v_device;
  end if;
end;
$$;

revoke all on function public.app_push_mark(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.app_push_mark(uuid, text, text, boolean) to service_role;

create or replace function public.app_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_path text;
  v_dev uuid;
begin
  select am.user_id into v_user
  from public.agency_members am
  where am.id = new.agent_id;
  if v_user is null then
    return new;
  end if;

  v_path := case
    when new.type = 'lead_prefs_default' then '/crm?goto=accPrefs&focus=lead_prefs'
    when new.type = 'open_demand' then '/crm?goto=accLeads&tab=demand'
    when new.related_agreement_id is not null
      then '/crm?goto=accAgreements&agreement=' || new.related_agreement_id::text
    when new.type in ('review_new', 'review_alert') and new.related_review_id is not null
      then '/crm?goto=accReviews&review=' || new.related_review_id::text
    when new.type = 'agenda_reminder' and new.related_lead_id is not null
      then '/crm?goto=accLeads&lead=' || new.related_lead_id::text
    when new.type = 'agenda_reminder' and new.related_agenda_item_id is not null
      then '/crm?goto=accAgenda&agenda=' || new.related_agenda_item_id::text
    when new.type = 'client_match' and new.related_client_id is not null
      then '/crm?goto=accClients&client=' || new.related_client_id::text || '&focus=matches'
    when new.related_property_id is not null
      and new.type is distinct from 'deal_closed'
      and new.type is distinct from 'client_match'
      then '/crm?goto=accProperties&property=' || new.related_property_id::text
    when new.related_client_id is not null
      then '/crm?goto=accClients&client=' || new.related_client_id::text
    when new.related_lead_id is not null and new.type in ('new_lead', 'review_request', 'system')
      then '/crm?goto=accLeads&lead=' || new.related_lead_id::text
    else '/crm'
  end;

  for v_dev in
    select d.id from public.app_push_devices d
    where d.user_id = v_user and d.disabled_at is null
  loop
    perform public.app_push_enqueue(
      v_dev,
      new.title,
      new.body,
      'https://shuknadlan.co.il' || v_path,
      'notification',
      new.id
    );
  end loop;
  return new;
exception when others then
  raise warning 'app_push_on_notification: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_notification() from public, anon, authenticated;

drop trigger if exists app_push_on_notification on public.notifications;
create trigger app_push_on_notification
  after insert on public.notifications
  for each row execute function public.app_push_on_notification();

create or replace function public.app_push_on_saved_search_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_dev uuid;
begin
  select coalesce(nullif(btrim(p.title), ''), 'נכס חדש') into v_title
  from public.properties p
  where p.id = new.property_id;

  for v_dev in
    select d.id from public.app_push_devices d
    where d.saved_search_id = new.search_id and d.disabled_at is null
  loop
    perform public.app_push_enqueue(
      v_dev,
      coalesce(v_title, 'נכס חדש'),
      'נכס חדש שמתאים לחיפוש ששמרתם',
      'https://shuknadlan.co.il/property?id=' || new.property_id::text,
      'saved_search',
      new.id
    );
  end loop;
  return new;
exception when others then
  raise warning 'app_push_on_saved_search_alert: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_saved_search_alert() from public, anon, authenticated;

drop trigger if exists app_push_on_saved_search_alert on public.saved_search_alerts;
create trigger app_push_on_saved_search_alert
  after insert on public.saved_search_alerts
  for each row execute function public.app_push_on_saved_search_alert();

-- סגירת חשבון מוחקת את אסימוני ההתראות של אותו משתמש. כשל כאן אינו עוצר
-- את הסגירה עצמה.
create or replace function public.app_push_on_account_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.closed_at is not null and old.closed_at is null and new.user_id is not null then
    delete from public.app_push_devices where user_id = new.user_id;
  end if;
  return new;
exception when others then
  raise warning 'app_push_on_account_closed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_account_closed() from public, anon, authenticated;

drop trigger if exists app_push_on_account_closed on public.agency_members;
create trigger app_push_on_account_closed
  after update of closed_at on public.agency_members
  for each row execute function public.app_push_on_account_closed();
