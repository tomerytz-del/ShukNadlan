-- מייל שלא תפס נעילה לא מחכה בתוך הסבב, ותמונה ישנה לא משתיקה אלבום חדש.
--
-- מייל: סטטוס lock_wait עם next_attempt_at. התפיסה אטומית (SKIP LOCKED).
-- שורה processing ישנה מ-10 דקות נכשלת בלי להריץ את התור שוב.
-- תמונה: זמן לכל כתובת. ישנה מ-10 דקות יורדת בלי שאלה ובלי צירוף.

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

comment on function public.email_intake_claim_lock_wait(text, integer) is
  'תופס/ת מייל שממתין לנעילה. רק הרצה אחת מקבלת את השורה.';

revoke all on function public.email_intake_claim_lock_wait(text, integer) from public, anon, authenticated;
grant execute on function public.email_intake_claim_lock_wait(text, integer) to service_role;

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

alter table public.whatsapp_conversations
  add column if not exists pending_image_at timestamptz[] not null default '{}';

update public.whatsapp_conversations
   set pending_image_at = array_fill(
         coalesce(pending_images_since, pg_catalog.now() - interval '30 days'),
         array[cardinality(pending_images)]
       )
 where cardinality(pending_images) > 0
   and cardinality(pending_image_at) is distinct from cardinality(pending_images);

create or replace function public.whatsapp_pending_image_add(
  p_agent_id uuid,
  p_phone text,
  p_url text
) returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_n integer;
  v_key text;
begin
  if p_agent_id is null or p_url is null or btrim(p_url) = '' then
    return 0;
  end if;
  v_key := split_part(p_url, '?', 1);
  insert into public.whatsapp_conversations as c
    (agent_id, wa_phone, pending_images, pending_image_at, pending_images_since, updated_at)
  values (p_agent_id, coalesce(nullif(btrim(p_phone), ''), 'unknown'),
          array[p_url], array[pg_catalog.now()], pg_catalog.now(), pg_catalog.now())
  on conflict (agent_id) do update
     set pending_images = case
           when exists (
             select 1 from unnest(c.pending_images) u
              where split_part(u, '?', 1) = v_key
           ) then c.pending_images
           else c.pending_images || array[p_url]
         end,
         pending_image_at = case
           when exists (
             select 1 from unnest(c.pending_images) u
              where split_part(u, '?', 1) = v_key
           ) then c.pending_image_at
           else c.pending_image_at || array[pg_catalog.now()]
         end,
         pending_images_since = case
           when cardinality(c.pending_images) = 0 then pg_catalog.now()
           else coalesce(c.pending_images_since, pg_catalog.now())
         end,
         updated_at = pg_catalog.now()
  returning cardinality(c.pending_images) into v_n;
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.whatsapp_pending_image_add(uuid, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_image_add(uuid, text, text) to service_role;

create or replace function public.whatsapp_burst_add(
  p_agent_id uuid,
  p_phone text,
  p_text text,
  p_image_url text
) returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_seq bigint;
  v_key text;
  v_dup boolean;
begin
  v_key := case when p_image_url is null then null else split_part(p_image_url, '?', 1) end;
  insert into public.whatsapp_conversations as c
    (agent_id, wa_phone, pending_texts, pending_images, pending_image_at, pending_images_since, burst_seq, updated_at)
  values (
    p_agent_id,
    coalesce(nullif(btrim(p_phone), ''), 'unknown'),
    case when coalesce(btrim(p_text), '') <> '' then array[p_text] else '{}'::text[] end,
    case when p_image_url is not null then array[p_image_url] else '{}'::text[] end,
    case when p_image_url is not null then array[pg_catalog.now()] else '{}'::timestamptz[] end,
    case when p_image_url is not null then pg_catalog.now() end,
    1,
    pg_catalog.now()
  )
  on conflict (agent_id) do update
     set pending_texts = c.pending_texts || excluded.pending_texts,
         pending_images = c.pending_images || (
           case
             when p_image_url is null then '{}'::text[]
             when exists (
               select 1 from unnest(c.pending_images) u
                where split_part(u, '?', 1) = v_key
             ) then '{}'::text[]
             else array[p_image_url]
           end
         ),
         pending_image_at = c.pending_image_at || (
           case
             when p_image_url is null then '{}'::timestamptz[]
             when exists (
               select 1 from unnest(c.pending_images) u
                where split_part(u, '?', 1) = v_key
             ) then '{}'::timestamptz[]
             else array[pg_catalog.now()]
           end
         ),
         pending_images_since = case
           when cardinality(c.pending_images) > 0 then coalesce(c.pending_images_since, pg_catalog.now())
           when p_image_url is not null then pg_catalog.now()
           else c.pending_images_since
         end,
         burst_seq = c.burst_seq + 1,
         updated_at = pg_catalog.now()
  returning c.burst_seq into v_seq;
  return v_seq;
end;
$$;

revoke all on function public.whatsapp_burst_add(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_burst_add(uuid, text, text, text) to service_role;

create or replace function public.whatsapp_pending_images_take(p_agent_id uuid)
returns text[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_images text[];
begin
  select c.pending_images into v_images
    from public.whatsapp_conversations c
   where c.agent_id = p_agent_id
   for update;
  if v_images is null or cardinality(v_images) = 0 then
    return '{}'::text[];
  end if;
  update public.whatsapp_conversations
     set pending_images = '{}',
         pending_image_at = '{}',
         pending_images_since = null,
         updated_at = pg_catalog.now()
   where agent_id = p_agent_id;
  return v_images;
end;
$$;

revoke all on function public.whatsapp_pending_images_take(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_images_take(uuid) to service_role;

-- מוריד תמונות ישנות מהחלון. מה שנשאר הוא רק טרי, והשאלה עליו בלבד.
create or replace function public.whatsapp_pending_images_drop_stale(
  p_agent_id uuid,
  p_max_age interval
) returns text[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_urls text[];
  v_at timestamptz[];
  v_fresh text[] := '{}';
  v_fresh_at timestamptz[] := '{}';
  v_cutoff timestamptz;
  i integer;
begin
  if p_agent_id is null then
    return '{}'::text[];
  end if;
  v_cutoff := pg_catalog.now() - coalesce(p_max_age, interval '10 minutes');
  select c.pending_images, c.pending_image_at
    into v_urls, v_at
    from public.whatsapp_conversations c
   where c.agent_id = p_agent_id
   for update;
  if v_urls is null then
    return '{}'::text[];
  end if;
  for i in 1 .. cardinality(v_urls) loop
    if coalesce(v_at[i], '-infinity'::timestamptz) >= v_cutoff then
      v_fresh := v_fresh || v_urls[i];
      v_fresh_at := v_fresh_at || v_at[i];
    end if;
  end loop;
  update public.whatsapp_conversations
     set pending_images = v_fresh,
         pending_image_at = v_fresh_at,
         pending_images_since = case
           when cardinality(v_fresh_at) = 0 then null
           else v_fresh_at[1]
         end,
         updated_at = pg_catalog.now()
   where agent_id = p_agent_id;
  return v_fresh;
end;
$$;

comment on function public.whatsapp_pending_images_drop_stale(uuid, interval) is
  'מוריד/ה תמונות ישנות מהחלון. לא שואלים עליהן ולא מצרפים אותן.';

revoke all on function public.whatsapp_pending_images_drop_stale(uuid, interval) from public, anon, authenticated;
grant execute on function public.whatsapp_pending_images_drop_stale(uuid, interval) to service_role;
