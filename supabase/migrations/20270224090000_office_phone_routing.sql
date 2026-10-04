-- ---------------------------------------------------------------------------
-- מספרים וירטואליים במשרד: שיוך בין סוכנים, חלוקה בסבב, והתראה על שיחה
-- שלא נענתה ולא חזרו אליה (docs/call-tracking.md)
--
-- 1. שיוך - מנהל/ת המשרד מעביר/ה מספר לסוכן/ת אחר/ת במשרד. המספר עובר עם
--    החיוב: החידוש הבא יורד מהארנק של הבעלים החדש/ה (ה-UI אומר את זה לפני
--    האישור). השיחות הישנות נשארות אצל מי שקיבל/ה אותן. מספר כלול ב-Elite
--    מאבד את ה"כלול" במעבר - הוא היה כלול במסלול של הבעלים הקודם/ת.
--
-- 2. סבב (ring_mode = 'round_robin') - כל שיחה מתחילה אצל הבא/ה בתור
--    (rr_cursor), ואם אין מענה עוברת לבא/ה אחריו/ה, עד ארבעה. מי שעונה הוא/היא
--    agent_id של השיחה - ולכן הסיכום, ההקלטה והכרטיס מגיעים אליו/ה. שיחה
--    שאף אחד לא ענה לה נרשמת אצל מי שהתור היה שלו/ה.
--
-- 3. התראה - agencies.missed_call_sla_minutes (null = כבוי). שיחה שלא נענתה,
--    שלא סומנה "חזרתי" (handled_at) ושלא הגיעה אחריה שיחה שנענתה מאותו מספר,
--    מתריעה למנהלי/ות המשרד בפעמון (ומשם בוואטסאפ). בין 08:00 ל-21:00 בלבד:
--    שיחה שהוחמצה בלילה מתריעה בבוקר. **שיחה יוצאת מהנייד אינה נראית לנו**,
--    ולכן "חזרתי" הוא סימון של הסוכן/ת ולא זיהוי.
-- ---------------------------------------------------------------------------

alter table public.agent_phone_lines add column if not exists ring_mode   text not null default 'single';
alter table public.agent_phone_lines add column if not exists ring_agents uuid[];
alter table public.agent_phone_lines add column if not exists rr_cursor   int  not null default 0;

alter table public.agent_calls add column if not exists ring_attempts  uuid[] not null default '{}';
alter table public.agent_calls add column if not exists handled_at     timestamptz;
alter table public.agent_calls add column if not exists sla_alerted_at timestamptz;

alter table public.agencies add column if not exists missed_call_sla_minutes int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_phone_lines_ring_mode_check') then
    alter table public.agent_phone_lines add constraint agent_phone_lines_ring_mode_check
      check (ring_mode in ('single', 'round_robin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agencies_missed_call_sla_check') then
    alter table public.agencies add constraint agencies_missed_call_sla_check
      check (missed_call_sla_minutes is null or missed_call_sla_minutes between 5 and 1440);
  end if;
end $$;

create index if not exists agent_calls_sla_pending_idx
  on public.agent_calls (created_at)
  where status in ('missed', 'busy', 'failed') and handled_at is null and sla_alerted_at is null;

-- ---------------------------------------------------------------------------
-- 1. שיוך מספר לסוכן/ת אחר/ת במשרד - מנהל/ת בלבד
-- ---------------------------------------------------------------------------
create or replace function public.office_phone_line_assign(p_line_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_line   public.agent_phone_lines%rowtype;
  v_from   text;
  v_to     text;
  v_num    text;
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    return jsonb_build_object('error', 'not_manager');
  end if;

  select * into v_line from public.agent_phone_lines
   where id = p_line_id and status <> 'released' for update;
  if not found or not exists (select 1 from public.agency_members
                               where id = v_line.agent_id and agency_id = v_agency) then
    return jsonb_build_object('error', 'line_not_in_office');
  end if;
  select display_name into v_to from public.agency_members
   where id = p_agent_id and agency_id = v_agency and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_in_office');
  end if;
  if v_line.agent_id = p_agent_id then
    return jsonb_build_object('success', true, 'unchanged', true);
  end if;

  -- אותו כלל של order_phone_line: מחוץ ל-Elite מספר אחד בתשלום לסוכן/ת
  if v_line.monthly_price is not null
     and not public.phone_line_included_eligible(p_agent_id)
     and exists (select 1 from public.agent_phone_lines
                  where agent_id = p_agent_id and status in ('pending', 'active')
                    and monthly_price is not null) then
    return jsonb_build_object('error', 'tier_required', 'required_tier', 'premium',
      'detail', coalesce(v_to, 'הסוכן/ת') || ' כבר מחזיק/ה מספר וירטואלי, ומספר נוסף זמין רק במסלול Elite.');
  end if;

  select display_name into v_from from public.agency_members where id = v_line.agent_id;
  v_num := '0' || substr(v_line.twilio_number, 5);

  update public.agent_phone_lines
     set agent_id = p_agent_id, included = false, forward_to = null,
         downgrade_deadline = null, downgrade_keep = false
   where id = p_line_id;

  insert into public.notifications (agent_id, type, title, body) values
    (p_agent_id, 'system', 'קיבלת מספר וירטואלי',
     format('מנהל/ת המשרד העביר/ה אליך את המספר %s%s. שיחות אליו יגיעו לנייד שלך, עם הקלטה וסיכום.%s',
            v_num, coalesce(' (' || v_line.label || ')', ''),
            case when v_line.monthly_price is not null
                 then format(' החידוש החודשי (%s ₪) יורד מהארנק שלך.', v_line.monthly_price) else '' end)),
    (v_line.agent_id, 'system', 'מספר וירטואלי הועבר',
     format('המספר %s%s הועבר ל%s. השיחות הקודמות שלו נשארות אצלך ביומן.',
            v_num, coalesce(' (' || v_line.label || ')', ''), coalesce(v_to, 'סוכן/ת אחר/ת')));

  return jsonb_build_object('success', true, 'from', v_from, 'to', v_to);
end;
$$;

revoke all on function public.office_phone_line_assign(uuid, uuid) from public, anon, authenticated;
grant execute on function public.office_phone_line_assign(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. חלוקה בסבב - מנהל/ת בלבד. 2 עד 8 סוכנים, כולם במשרד ופעילים.
-- ---------------------------------------------------------------------------
create or replace function public.office_phone_line_set_ring(p_line_id uuid, p_mode text, p_agents uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_agents uuid[];
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    return jsonb_build_object('error', 'not_manager');
  end if;
  if not exists (select 1 from public.agent_phone_lines l
                   join public.agency_members m on m.id = l.agent_id
                  where l.id = p_line_id and l.status <> 'released' and m.agency_id = v_agency) then
    return jsonb_build_object('error', 'line_not_in_office');
  end if;
  if p_mode not in ('single', 'round_robin') then
    return jsonb_build_object('error', 'bad_mode');
  end if;

  if p_mode = 'single' then
    update public.agent_phone_lines set ring_mode = 'single', ring_agents = null, rr_cursor = 0
     where id = p_line_id;
    return jsonb_build_object('success', true);
  end if;

  -- הסדר נשמר כמו שנבחר, בלי כפילויות, ורק מי שבמשרד ופעיל/ה
  select array_agg(x.id order by x.ord) into v_agents
    from (select distinct on (a.id) a.id, a.ord
            from unnest(p_agents) with ordinality as a(id, ord)
            join public.agency_members m on m.id = a.id and m.agency_id = v_agency and m.active = true
           order by a.id, a.ord) x;
  if coalesce(array_length(v_agents, 1), 0) < 2 then
    return jsonb_build_object('error', 'need_two_agents');
  end if;
  if array_length(v_agents, 1) > 8 then
    return jsonb_build_object('error', 'too_many_agents');
  end if;

  update public.agent_phone_lines set ring_mode = 'round_robin', ring_agents = v_agents, rr_cursor = 0
   where id = p_line_id;
  return jsonb_build_object('success', true, 'agents', to_jsonb(v_agents));
end;
$$;

revoke all on function public.office_phone_line_set_ring(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.office_phone_line_set_ring(uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- מי הבא/ה בתור לשיחה הזו. נקראת מ-twilio-voice: בפעם הראשונה מקדמת את
-- התור של המספר, ובכל אי-מענה מחזירה את הבא/ה אחרי מי שכבר צלצל אצלם.
-- עד ארבעה ניסיונות לשיחה - מעבר לזה הלקוח/ה מחכה יותר מדקה.
-- ---------------------------------------------------------------------------
create or replace function public.phone_line_ring_next(p_call_sid text, p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line     public.agent_phone_lines%rowtype;
  v_attempts uuid[];
  v_n        int;
  v_base     int;
  v_i        int;
  v_cand     uuid;
  v_phone    text;
begin
  select * into v_line from public.agent_phone_lines where id = p_line_id for update;
  if not found or v_line.ring_mode <> 'round_robin' or coalesce(array_length(v_line.ring_agents, 1), 0) = 0 then
    return jsonb_build_object('done', true);
  end if;
  select ring_attempts into v_attempts from public.agent_calls where twilio_call_sid = p_call_sid for update;
  if not found then
    return jsonb_build_object('done', true);
  end if;
  v_attempts := coalesce(v_attempts, '{}');
  if coalesce(array_length(v_attempts, 1), 0) >= 4 then
    return jsonb_build_object('done', true);
  end if;

  v_n := array_length(v_line.ring_agents, 1);
  if coalesce(array_length(v_attempts, 1), 0) = 0 then
    v_base := v_line.rr_cursor % v_n;
    update public.agent_phone_lines set rr_cursor = (rr_cursor + 1) % v_n where id = p_line_id;
  else
    v_base := coalesce(array_position(v_line.ring_agents, v_attempts[1]), 1) - 1;
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_cand := v_line.ring_agents[((v_base + v_i) % v_n) + 1];
    continue when v_cand = any(v_attempts);
    select coalesce(nullif(m.phone_e164, ''), m.phone) into v_phone
      from public.agency_members m where m.id = v_cand and m.active = true;
    continue when v_phone is null or v_phone = '';
    update public.agent_calls
       set ring_attempts = v_attempts || v_cand, agent_id = v_cand
     where twilio_call_sid = p_call_sid;
    return jsonb_build_object('agent_id', v_cand, 'phone', v_phone,
                              'attempt', coalesce(array_length(v_attempts, 1), 0) + 1);
  end loop;
  return jsonb_build_object('done', true);
end;
$$;

revoke all on function public.phone_line_ring_next(text, uuid) from public, anon, authenticated;
grant execute on function public.phone_line_ring_next(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. "חזרתי" - הסוכן/ת מסמן/ת שיחה שלא נענתה כמטופלת (רק את שלו/ה)
-- ---------------------------------------------------------------------------
create or replace function public.agent_call_set_handled(p_call_id uuid, p_handled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.agent_calls
     set handled_at = case when p_handled then now() else null end
   where id = p_call_id and agent_id = public.current_agent_id()
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke all on function public.agent_call_set_handled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.agent_call_set_handled(uuid, boolean) to authenticated;

-- הזמן להתראה - מנהל/ת בלבד. null = כבוי.
create or replace function public.office_set_missed_call_sla(p_minutes int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if public.current_member_role() is distinct from 'manager' or v_agency is null then
    return false;
  end if;
  if p_minutes is not null and (p_minutes < 5 or p_minutes > 1440) then
    raise exception 'invalid minutes';
  end if;
  update public.agencies set missed_call_sla_minutes = p_minutes where id = v_agency;
  return true;
end;
$$;

revoke all on function public.office_set_missed_call_sla(int) from public, anon, authenticated;
grant execute on function public.office_set_missed_call_sla(int) to authenticated;

create or replace function public.my_office_missed_call_sla()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select a.missed_call_sla_minutes from public.agencies a where a.id = public.current_agency_id();
$$;

revoke all on function public.my_office_missed_call_sla() from public, anon, authenticated;
grant execute on function public.my_office_missed_call_sla() to authenticated;

-- ---------------------------------------------------------------------------
-- הסבב של ההתראות: cron כל 5 דקות, בלי Edge Function - שורה בפעמון לכל
-- מנהל/ת, ומשם הדחיפה לוואטסאפ הרגילה (notification_push_due_agents).
-- ---------------------------------------------------------------------------
create or replace function public.claim_missed_call_sla_alerts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  v_hour  int := extract(hour from now() at time zone 'Asia/Jerusalem');
begin
  if v_hour < 8 or v_hour >= 21 then
    return 0;
  end if;

  with due as (
    select c.id, c.from_number, c.created_at, m.agency_id, m.display_name,
           a.missed_call_sla_minutes as sla, l.label
      from public.agent_calls c
      join public.agency_members m on m.id = c.agent_id
      join public.agencies a on a.id = m.agency_id
      left join public.agent_phone_lines l on l.id = c.line_id
     where c.status in ('missed', 'busy', 'failed')
       and c.handled_at is null and c.sla_alerted_at is null
       and a.missed_call_sla_minutes is not null
       and c.created_at > now() - interval '24 hours'
       and c.created_at + make_interval(mins => a.missed_call_sla_minutes) <= now()
       and c.from_number like '+%'
       and not exists (select 1 from public.agent_calls c2
                        where c2.agent_id = c.agent_id and c2.from_number = c.from_number
                          and c2.status = 'answered' and c2.created_at > c.created_at)
     for update of c skip locked
  ), marked as (
    update public.agent_calls t set sla_alerted_at = now()
      from due where t.id = due.id
    returning due.*
  ), sent as (
    insert into public.notifications (agent_id, type, title, body)
    select mgr.id, 'system', 'שיחה שלא נענתה ולא חזרו אליה',
           format('%s לא ענה/תה ל-%s ב-%s%s, ועברו %s דקות בלי שסומן "חזרתי".',
                  coalesce(marked.display_name, 'סוכן/ת'),
                  '0' || substr(marked.from_number, 5),
                  to_char(marked.created_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
                  coalesce(' (דרך ' || marked.label || ')', ''),
                  marked.sla)
      from marked
      join public.agency_members mgr on mgr.agency_id = marked.agency_id
                                    and mgr.role = 'manager' and mgr.active = true
    returning 1
  )
  select count(*) into v_count from marked;
  return v_count;
end;
$$;

revoke all on function public.claim_missed_call_sla_alerts() from public, anon, authenticated;
grant execute on function public.claim_missed_call_sla_alerts() to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;
  perform cron.unschedule('missed-call-sla-alerts')
    where exists (select 1 from cron.job where jobname = 'missed-call-sla-alerts');
  perform cron.schedule('missed-call-sla-alerts', '*/5 * * * *',
                        'select public.claim_missed_call_sla_alerts();');
end $$;
