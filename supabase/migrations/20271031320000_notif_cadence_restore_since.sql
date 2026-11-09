-- supabase/migrations/20271031320000_notif_cadence_restore_since.sql
-- כשלון שמירה לא קורא שוב ל-choose: choose מזיז את since לעכשיו,
-- ופריטים שלא נקראו מלפני השינוי יוצאים מהסיכום.
-- השחזור כותב רק צילום שנשמר בשרת בתחילת השמירה, לסוכן/ת עצמו/ה,
-- ורק כשכפתור הקצב דלוק.

-- CI משחזר את הסכימה עם pg_dump --no-acl ולא מריץ מיגרציה שכבר בפרודקשן.
revoke update on table public.agent_notification_preferences from public, anon, authenticated;
grant select, insert on table public.agent_notification_preferences to authenticated;
grant update (agent_id, muted_types, whatsapp_types, whatsapp_off_types, updated_at)
  on table public.agent_notification_preferences to authenticated;

alter table public.notif_cadence_log drop constraint if exists notif_cadence_log_event_chk;
alter table public.notif_cadence_log add constraint notif_cadence_log_event_chk
  check (event in ('open', 'choose', 'ask', 'back', 'snapshot', 'restore'));

create table if not exists public.notif_cadence_snapshot (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  cadence jsonb not null,
  since jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.notif_cadence_snapshot is
  'צילום הקצב וה-since בתחילת שמירה. השחזור כותב רק אותו, ולא ערכים מהדפדפן.';

alter table public.notif_cadence_snapshot enable row level security;
revoke all on table public.notif_cadence_snapshot from public, anon, authenticated;
grant select, insert, update, delete on table public.notif_cadence_snapshot to service_role;

create index if not exists notif_cadence_snapshot_agent_idx
  on public.notif_cadence_snapshot (agent_id, created_at desc);

-- חתימה ישנה קיבלה בחירה ו-since מהלקוח. לא בפרודקשן.
drop function if exists public.notif_cadence_restore(uuid, text, text, text);

create or replace function public.notif_cadence_actor_ok(p_agent uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := '';
  v_raw text;
begin
  if not public.notif_cadence_button_on() then
    return 'הקצב כבוי';
  end if;
  begin
    v_raw := nullif(current_setting('request.jwt.claims', true), '');
    if v_raw is not null then
      v_role := coalesce(v_raw::jsonb ->> 'role', '');
    end if;
  exception when others then
    v_role := '';
  end;
  if v_role = '' then
    begin
      v_role := coalesce(auth.role(), '');
    exception when others then
      v_role := '';
    end;
  end if;
  if v_role is distinct from 'service_role'
     and p_agent is distinct from public.current_agent_id() then
    return 'אין הרשאה לקצב של סוכן אחר';
  end if;
  if p_agent is null or not exists (
    select 1 from public.agency_members m
     where m.id = p_agent
       and m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ) then
    return 'אין הרשאה לקצב';
  end if;
  return null;
end;
$$;

revoke all on function public.notif_cadence_actor_ok(uuid) from public, anon, authenticated;
grant execute on function public.notif_cadence_actor_ok(uuid) to service_role;

create or replace function public.notif_cadence_begin(p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
  v_id uuid;
  v_cadence jsonb;
  v_since jsonb;
begin
  v_err := public.notif_cadence_actor_ok(p_agent);
  if v_err is not null then
    insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
    values (p_agent, null, 'snapshot', null);
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  select coalesce(p.whatsapp_cadence, '{}'::jsonb),
         coalesce(p.whatsapp_cadence_since, '{}'::jsonb)
    into v_cadence, v_since
    from public.agent_notification_preferences p
   where p.agent_id = p_agent;
  v_cadence := coalesce(v_cadence, '{}'::jsonb);
  v_since := coalesce(v_since, '{}'::jsonb);
  delete from public.notif_cadence_snapshot s
   where s.agent_id = p_agent
     and s.created_at < now() - interval '30 minutes';
  insert into public.notif_cadence_snapshot (agent_id, cadence, since)
  values (p_agent, v_cadence, v_since)
  returning id into v_id;
  insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
  values (p_agent, null, 'snapshot', null);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.notif_cadence_begin(uuid) is
  'צילום הקצב וה-since לפני שמירה. רק לסוכן/ת עצמו/ה, ורק כשהכפתור דלוק. תקף 30 דקות, כמו אישור הכיבוי.';

revoke all on function public.notif_cadence_begin(uuid) from public, anon, authenticated;
grant execute on function public.notif_cadence_begin(uuid) to authenticated, service_role;

create or replace function public.notif_cadence_restore(p_agent uuid, p_snapshot uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
  v_cadence jsonb;
  v_since jsonb;
begin
  v_err := public.notif_cadence_actor_ok(p_agent);
  if v_err is not null then
    insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
    values (p_agent, null, 'restore', null);
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  if p_snapshot is null then
    insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
    values (p_agent, null, 'restore', null);
    return jsonb_build_object('ok', false, 'error', 'אין צילום קצב לשחזור');
  end if;
  select s.cadence, s.since
    into v_cadence, v_since
    from public.notif_cadence_snapshot s
   where s.id = p_snapshot
     and s.agent_id = p_agent
     and s.created_at > now() - interval '30 minutes';
  if not found then
    insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
    values (p_agent, null, 'restore', null);
    return jsonb_build_object('ok', false, 'error', 'אין צילום קצב לשחזור, או שפג תוקפו');
  end if;
  -- הערכים הם הצילום, לא קלט מהדפדפן. כיבוי שחוזר היה כבר שמור,
  -- ולכן אינו בחירת "ללא" חדשה שצריכה אישור שני.
  insert into public.agent_notification_preferences (
    agent_id, whatsapp_cadence, whatsapp_cadence_since
  ) values (
    p_agent, v_cadence, v_since
  )
  on conflict (agent_id) do update
    set whatsapp_cadence = excluded.whatsapp_cadence,
        whatsapp_cadence_since = excluded.whatsapp_cadence_since,
        updated_at = now();
  insert into public.notif_cadence_log (agent_id, notif_type, event, choice)
  values (p_agent, null, 'restore', null);
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.notif_cadence_restore(uuid, uuid) is
  'מחזיר את צילום הקצב וה-since מתחילת השמירה. לא מקבל בחירה מהלקוח, ולא מזיז את since לעכשיו.';

revoke all on function public.notif_cadence_restore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.notif_cadence_restore(uuid, uuid) to authenticated, service_role;

comment on column public.agent_notification_preferences.whatsapp_cadence_since is
  'לכל סוג, מרגע השינוי. התראות מלפניו לא נשפכות לוואטסאפ. נכתב ב-notif_cadence_apply, ומשוחזר מצילום ב-notif_cadence_restore בלי להזיז את השעה.';
