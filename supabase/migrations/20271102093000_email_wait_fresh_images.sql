-- מייל שלא תפס נעילה לא מחכה בתוך הסבב.
-- סטטוס lock_wait עם next_attempt_at. התפיסה אטומית (SKIP LOCKED) לפי uidvalidity.
-- שורה processing ישנה מ-10 דקות נכשלת בלי להריץ את התור שוב.
-- תמונות ממתינות לא נמחקות כאן: הן נשארות ל-create_property.

alter table public.email_intake_messages
  add column if not exists next_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.email_intake_messages'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%processing%'
  loop
    execute format('alter table public.email_intake_messages drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.email_intake_messages
  drop constraint if exists email_intake_messages_status_check;
alter table public.email_intake_messages
  add constraint email_intake_messages_status_check
  check (status in ('processing', 'done', 'failed', 'skipped', 'lock_wait'));

create or replace function public.email_intake_claim_lock_wait(
  p_mailbox text,
  p_uidvalidity bigint,
  p_limit integer
) returns setof public.email_intake_messages
language plpgsql
set search_path to ''
as $$
begin
  return query
  update public.email_intake_messages m
     set status = 'processing',
         processed_at = pg_catalog.now(),
         attempt_count = m.attempt_count + 1
   where m.id in (
     select w.id
       from public.email_intake_messages w
      where w.mailbox = p_mailbox
        and w.uidvalidity = p_uidvalidity
        and w.status = 'lock_wait'
        and w.attempt_count < 3
        and w.next_attempt_at is not null
        and w.next_attempt_at <= pg_catalog.now()
      order by w.id
      limit greatest(coalesce(p_limit, 1), 1)
      for update skip locked
   )
  returning m.*;
end;
$$;

comment on function public.email_intake_claim_lock_wait(text, bigint, integer) is
  'תופס/ת מייל שממתין לנעילה באותה תיבה. רק הרצה אחת מקבלת את השורה.';

revoke all on function public.email_intake_claim_lock_wait(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.email_intake_claim_lock_wait(text, bigint, integer) to service_role;

create or replace function public.email_intake_fail_stuck(
  p_mailbox text
) returns table (id bigint, agent_id uuid)
language plpgsql
set search_path to ''
as $$
begin
  return query
  update public.email_intake_messages m
     set status = 'failed',
         detail = 'stuck_processing',
         processed_at = pg_catalog.now()
   where m.id in (
     select w.id
       from public.email_intake_messages w
      where w.mailbox = p_mailbox
        and w.status = 'processing'
        and coalesce(w.processed_at, w.created_at) < pg_catalog.now() - interval '10 minutes'
      order by w.id
      for update skip locked
   )
  returning m.id, m.agent_id;
end;
$$;

comment on function public.email_intake_fail_stuck(text) is
  'מייל שנתקע ב-processing. לא מריצים את התור שוב.';

revoke all on function public.email_intake_fail_stuck(text) from public, anon, authenticated;
grant execute on function public.email_intake_fail_stuck(text) to service_role;

-- email_intake אינו בקצב: כשל של המייל עצמו, לא סיכום ולא עדיפות.
create or replace function public.notif_cadence_group(p_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_type = any(array[
      'ops_alert', 'security_alert', 'platform_signup', 'platform_upgrade',
      'deal_sync_summary', 'deal_data_gap', 'review_alert', 'lead_unrouted',
      'access_review', 'admin_overdue', 'market_nudge', 'budget_alert',
      'improvement_suggestion', 'email_intake'
    ]::text[]) then null
    else coalesce(
      (select g.cadence_group from public.notif_cadence_group_map g where g.notif_type = p_type),
      'system_mentor')
  end;
$$;

revoke all on function public.notif_cadence_group(text) from public, anon, authenticated;
grant execute on function public.notif_cadence_group(text) to service_role;
