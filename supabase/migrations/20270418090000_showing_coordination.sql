-- ============================================================================
-- תיאום ביקור עם הבעלים והמתווכים, ותזכורת שמקשרת לליד
-- ============================================================================
--
-- ## 1. תיאום ביקור
--
-- לקוח/ה ביקש/ה במיניסייט סיור בכמה נכסים. חלק מהם של הסוכן/ת (ואז מתאמים
-- עם הבעלים), וחלק של מתווכים אחרים - עמית/ה במשרד או משרד בשת"פ (ואז מתאמים
-- עם המתווך/ת שמחזיק/ה את הנכס). עד היום זה היה עשר שיחות טלפון.
--
-- עכשיו גבריאלה שואלת את הסוכן/ת בוואטסאפ "לשלוח לכולם בקשת תיאום?", ובאישור
-- (או בכפתור בפאנל המיניסייט ב-CRM) יוצאת לכל אחד/ת הודעה עם שלושה כפתורים:
-- מאשר/ת · מבקש/ת לדחות · לא מתאים, מועד אחר. כל תשובה חוזרת לסוכן/ת כהתראה.
--
-- ‏`showing_coord_requests` היא גם התור וגם היומן: שורה לכל נכס בסיור. השליחה
-- עצמה ב-`whatsapp-webhook?task=showing-coord` (‏showing-coord.ts); כאן רק
-- הבחירה, הרישום, התשובה והתזמון.
--
-- **מה נשלח לנמען/ת:** שם הסוכן/ת והמשרד, הכתובת של הנכס **שלו/ה**, והמועד.
-- לא שם הלקוח/ה ולא שאר הנכסים בסיור.
--
-- **הגייט:** ‏`agent_agenda_enabled` - אותו גייט של היומן ושל הפולואפ ללקוח/ה,
-- ושורה משלו ב-pricing.html.
--
-- ## 2. תזכורת מהיומן על ליד - קישור לליד
--
-- ‏"לחזור לליד חדש" יצאה לוואטסאפ עם קישור לפריט ביומן, ומשם עוד לחיצה עד
-- הליד. ‏`agent_agenda_dispatch` כותבת עכשיו גם את `related_lead_id`, ו-
-- ‏itemPath / הפעמון פותחים את הליד ישר. הליד נבדק מול `leads` לפני הכתיבה:
-- ‏FK שנופל היה מפיל את כל סבב ה-dispatch, לא רק את ההתראה הזו.
--
-- הקובץ אידמפוטנטי. הפרטים: docs/showing-coordination.md.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ההצעה לסוכן/ת - על שורת בקשת הסיור
-- ---------------------------------------------------------------------------
alter table public.client_showcase_meetings add column if not exists coord_offer text;
alter table public.client_showcase_meetings add column if not exists coord_offered_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_showcase_meetings_coord_offer_check') then
    alter table public.client_showcase_meetings add constraint client_showcase_meetings_coord_offer_check
      check (coord_offer in ('sent','failed','yes','no'));
  end if;
end $$;

comment on column public.client_showcase_meetings.coord_offer is
  'ההצעה של גבריאלה לשלוח בקשות תיאום לבעלים ולמתווכים: sent / failed / yes / no. null = עוד לא הוצעה.';

-- ---------------------------------------------------------------------------
-- 2. הבקשות - שורה לכל נכס בסיור
-- ---------------------------------------------------------------------------
create table if not exists public.showing_coord_requests (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references public.client_showcase_meetings(id) on delete cascade,
  agent_id        uuid not null references public.agency_members(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  -- owner = בעלי הנכס של הסוכן/ת עצמו/ה · agent = המתווך/ת שמחזיק/ה את הנכס
  target          text not null check (target in ('owner','agent')),
  -- בלי FK בכוונה: FK שני ל-agency_members היה שובר כל embed לא מפורש
  -- מהטבלה הזו (PGRST201). ראו הסקיל new-migration.
  target_agent_id uuid,
  target_name     text,
  target_phone    text,
  window_start    timestamptz not null,
  status          text not null default 'pending',
  token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  wa_message_id   text,
  error           text,
  sent_at         timestamptz,
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (meeting_id, property_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'showing_coord_requests_status_check') then
    alter table public.showing_coord_requests add constraint showing_coord_requests_status_check
      check (status in ('pending','sending','sent','no_phone','no_channel','failed','opted_out',
                        'confirmed','postpone','declined','canceled'));
  end if;
end $$;

comment on table public.showing_coord_requests is
  'בקשת תיאום ביקור לבעלים או למתווך/ת של נכס בסיור מהמיניסייט. pending → sending → sent → confirmed/postpone/declined. docs/showing-coordination.md';

create index if not exists showing_coord_requests_pending
  on public.showing_coord_requests (created_at) where status = 'pending';
create index if not exists showing_coord_requests_agent
  on public.showing_coord_requests (agent_id, meeting_id);

alter table public.showing_coord_requests enable row level security;
revoke all on public.showing_coord_requests from anon;
revoke insert, update, delete on public.showing_coord_requests from authenticated;

-- הסוכן/ת רואה את שלו/ה. הטלפון כאן הוא ממילא שלו/ה: בעלים של נכס שלו/ה,
-- או מתווך/ת ש-shared_properties_for_me כבר חושף לו/ה.
drop policy if exists "agent reads own showing coord" on public.showing_coord_requests;
create policy "agent reads own showing coord" on public.showing_coord_requests
  for select to authenticated using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. ‏agent_showing_coord_start - יצירת הבקשות (הבוט, service_role)
--
-- נכס של הסוכן/ת → הבעלים מ-property_owners. נכס של אחר/ת (עמית/ה במשרד או
-- שת"פ) → המתווך/ת שמחזיק/ה אותו. בלי טלפון → no_phone, כדי שהפאנל יגיד את
-- זה ולא ישתוק. בקשה שנכשלה או בוטלה נפתחת מחדש בלחיצה נוספת; בקשה שיצאה או
-- נענתה - לא נשלחת פעמיים.
-- ---------------------------------------------------------------------------
create or replace function public.agent_showing_coord_start(p_agent_id uuid, p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meet    public.client_showcase_meetings%rowtype;
  v_pid     uuid;
  v_prop_id uuid;
  v_powner  uuid;
  v_target  text;
  v_tagent  uuid;
  v_name    text;
  v_phone   text;
  v_queued  int := 0;
  v_nophone int := 0;
  v_kept    int := 0;
  v_status  text;
begin
  select m.* into v_meet from public.client_showcase_meetings m
    join public.client_showcases s on s.id = m.showcase_id
   where m.id = p_meeting_id and s.agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_meet.status not in ('requested','confirmed') then
    return jsonb_build_object('error', 'meeting_closed');
  end if;
  if v_meet.starts_at < now() + interval '15 minutes' then
    return jsonb_build_object('error', 'too_late');
  end if;
  if not public.agent_agenda_enabled(p_agent_id) then
    return jsonb_build_object('error', 'tier_required');
  end if;

  foreach v_pid in array v_meet.property_ids loop
    v_prop_id := null; v_powner := null; v_name := null; v_phone := null;
    select p.id, p.agent_id into v_prop_id, v_powner from public.properties p where p.id = v_pid;
    continue when v_prop_id is null;

    if v_powner = p_agent_id then
      v_target := 'owner';
      v_tagent := null;
      select nullif(btrim(o.owner_name), ''), nullif(btrim(o.owner_phone), '')
        into v_name, v_phone
        from public.property_owners o where o.property_id = v_pid;
    else
      v_target := 'agent';
      v_tagent := v_powner;
      select nullif(btrim(m.display_name), ''), nullif(btrim(m.phone), '')
        into v_name, v_phone
        from public.agency_members m where m.id = v_powner and m.active = true;
    end if;

    v_status := case when v_phone is null then 'no_phone' else 'pending' end;

    insert into public.showing_coord_requests
      (meeting_id, agent_id, property_id, target, target_agent_id, target_name, target_phone,
       window_start, status)
    values (v_meet.id, p_agent_id, v_pid, v_target, v_tagent, v_name, v_phone,
            v_meet.starts_at, v_status)
    on conflict (meeting_id, property_id) do update
      set target = excluded.target, target_agent_id = excluded.target_agent_id,
          target_name = excluded.target_name, target_phone = excluded.target_phone,
          window_start = excluded.window_start, status = excluded.status,
          error = null, wa_message_id = null, sent_at = null, responded_at = null
      -- לא opted_out: מי שחסם/ה הודעות מהעסק לא מקבל/ת עוד אחת בלחיצה נוספת
      where public.showing_coord_requests.status in ('canceled','failed','no_channel','no_phone');

    if not found then
      v_kept := v_kept + 1;
    elsif v_status = 'pending' then
      v_queued := v_queued + 1;
    else
      v_nophone := v_nophone + 1;
    end if;
  end loop;

  update public.client_showcase_meetings
     set coord_offer = 'yes', coord_offered_at = coalesce(coord_offered_at, now())
   where id = v_meet.id;

  return jsonb_build_object('ok', true, 'queued', v_queued, 'no_phone', v_nophone, 'already', v_kept);
end;
$$;

comment on function public.agent_showing_coord_start(uuid, uuid) is
  'פותח בקשות תיאום ביקור (בעלים / מתווך/ת) לכל נכס בבקשת סיור מהמיניסייט. service_role בלבד - הבוט, עם מזהה סוכן/ת מפורש.';

revoke all on function public.agent_showing_coord_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_showing_coord_start(uuid, uuid) to service_role;

-- העטיפה ל-CRM: הזהות מה-JWT
create or replace function public.showing_coord_request(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
begin
  if v_agent is null then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  return public.agent_showing_coord_start(v_agent, p_meeting_id);
end;
$$;

revoke all on function public.showing_coord_request(uuid) from public, anon, authenticated;
grant execute on function public.showing_coord_request(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. ‏showing_coord_claim - מה לשלוח עכשיו
--
-- ‏sending לפני השליחה (כמו agent_agenda_client_claim): קריסה באמצע משאירה
-- את השורה שם ולא שולחת פעמיים - הודעה כפולה לבעלים גרועה מהודעה שלא יצאה.
-- סיור שבוטל או שמועדו כבר עבר אינו נשלח.
-- ---------------------------------------------------------------------------
create or replace function public.showing_coord_claim(p_meeting_id uuid default null, p_limit int default 30)
returns table (
  request_id   uuid,
  token        text,
  target       text,
  target_name  text,
  target_phone text,
  window_start timestamptz,
  agent_id     uuid,
  agent_name   text,
  agency_name  text,
  property_line text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.showing_coord_requests r
     set status = 'canceled'
   where r.status = 'pending'
     and (r.window_start < now()
          or exists (select 1 from public.client_showcase_meetings m
                      where m.id = r.meeting_id and m.status not in ('requested','confirmed')));

  return query
  with picked as (
    select r.id from public.showing_coord_requests r
     where r.status = 'pending'
       and (p_meeting_id is null or r.meeting_id = p_meeting_id)
     order by r.created_at
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
     for update skip locked
  ),
  upd as (
    update public.showing_coord_requests r
       set status = 'sending'
      from picked
     where r.id = picked.id
    returning r.*
  )
  select upd.id, upd.token, upd.target, upd.target_name, upd.target_phone, upd.window_start,
         upd.agent_id, m.display_name, a.name,
         concat_ws(', ', nullif(btrim(concat_ws(' ', p.street, p.house_number)), ''), p.city)
    from upd
    join public.agency_members m on m.id = upd.agent_id
    left join public.agencies a on a.id = m.agency_id
    join public.properties p on p.id = upd.property_id;
end;
$$;

revoke all on function public.showing_coord_claim(uuid, int) from public, anon, authenticated;
grant execute on function public.showing_coord_claim(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. ‏showing_coord_offer_claim - לאיזה סוכן/ת להציע עכשיו
--
-- רק בתוך חלון 24 השעות (‏whatsapp_conversations.last_message_at, 23 שעות):
-- הודעת כפתורים מחוצה לו נדחית ב-Meta. הצעה שלא יצאה ממתינה לפעם הבאה
-- שהסוכן/ת כותב/ת לגבריאלה, כל עוד הסיור לא עבר - ובינתיים הכפתור בפאנל
-- המיניסייט עושה אותו דבר.
-- ---------------------------------------------------------------------------
create or replace function public.showing_coord_offer_claim(p_limit int default 20)
returns table (
  meeting_id   uuid,
  agent_id     uuid,
  wa_phone     text,
  display_name text,
  client_name  text,
  starts_at    timestamptz,
  targets      jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with cand as (
    -- הטלפון בתת-שאילתה ולא ב-join: לסוכן/ת יכולות להיות כמה שורות שיחה,
    -- ו-join היה מכפיל את ההצעה
    select m.id as mid, s.agent_id as aid,
           (select c.wa_phone from public.whatsapp_conversations c
             where c.agent_id = s.agent_id and c.last_message_at > now() - interval '23 hours'
             order by c.last_message_at desc limit 1) as wa_phone,
           am.display_name, cl.full_name as client_name, m.starts_at, m.property_ids
      from public.client_showcase_meetings m
      join public.client_showcases s on s.id = m.showcase_id
      join public.agency_members am on am.id = s.agent_id and am.active = true
      left join public.agent_clients cl on cl.id = s.client_id
     where m.coord_offer is null
       and exists (select 1 from public.whatsapp_conversations c
                    where c.agent_id = s.agent_id and c.last_message_at > now() - interval '23 hours')
       and m.status in ('requested','confirmed')
       and m.starts_at > now() + interval '30 minutes'
       and m.created_at > now() - interval '3 days'
       and cardinality(m.property_ids) > 0
       and not exists (select 1 from public.showing_coord_requests r where r.meeting_id = m.id)
       and public.agent_agenda_enabled(s.agent_id)
     order by m.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update of m skip locked
  ),
  upd as (
    update public.client_showcase_meetings m
       set coord_offer = 'sent', coord_offered_at = now()
      from cand
     where m.id = cand.mid
    returning m.id
  )
  select cand.mid, cand.aid, cand.wa_phone, cand.display_name, cand.client_name, cand.starts_at,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'line', concat_ws(', ', nullif(btrim(concat_ws(' ', p.street, p.house_number)), ''), p.city),
                    'target', case when p.agent_id = cand.aid then 'owner' else 'agent' end,
                    'name', case when p.agent_id = cand.aid then o.owner_name else om.display_name end,
                    'has_phone', case when p.agent_id = cand.aid
                                      then nullif(btrim(coalesce(o.owner_phone, '')), '') is not null
                                      else nullif(btrim(coalesce(om.phone, '')), '') is not null end)), '[]'::jsonb)
            from unnest(cand.property_ids) as u(pid)
            join public.properties p on p.id = u.pid
            left join public.property_owners o on o.property_id = p.id
            left join public.agency_members om on om.id = p.agent_id)
    from cand
    join upd on upd.id = cand.mid;
end;
$$;

revoke all on function public.showing_coord_offer_claim(int) from public, anon, authenticated;
grant execute on function public.showing_coord_offer_claim(int) to service_role;

-- האם יש מה לעשות - כדי שה-cron של כל דקה לא יעיר את הפונקציה סתם
create or replace function public.showing_coord_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.showing_coord_requests where status = 'pending')
      or exists (
        select 1 from public.client_showcase_meetings m
          join public.client_showcases s on s.id = m.showcase_id
          join public.whatsapp_conversations c
            on c.agent_id = s.agent_id and c.last_message_at > now() - interval '23 hours'
         where m.coord_offer is null
           and m.status in ('requested','confirmed')
           and m.starts_at > now() + interval '30 minutes'
           and m.created_at > now() - interval '3 days');
$$;

revoke all on function public.showing_coord_ready() from public, anon, authenticated;
grant execute on function public.showing_coord_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 6. ‏showing_coord_respond - הנמען/ת לחץ/ה כפתור
--
-- ההתראה לסוכן/ת היא `agenda_reminder` ולא סוג חדש: היא דחופה (סיור "היום
-- בסביבות 17:00" בשישי לא מחכה לראשון), והסוג הזה עוקף שעות וימים שקטים.
-- ‏related_agenda_item_id כשהסיור כבר ביומן, ותמיד related_client_id - שני
-- המסלולים פותחים משהו אחד ולא קטגוריה.
-- ---------------------------------------------------------------------------
create or replace function public.showing_coord_respond(p_token text, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req    public.showing_coord_requests%rowtype;
  v_meet   public.client_showcase_meetings%rowtype;
  v_client uuid;
  v_cname  text;
  v_line   text;
  v_who    text;
  v_title  text;
begin
  if p_answer not in ('confirmed','postpone','declined') then
    return jsonb_build_object('error', 'bad_answer');
  end if;

  select * into v_req from public.showing_coord_requests where token = p_token for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  select concat_ws(', ', nullif(btrim(concat_ws(' ', p.street, p.house_number)), ''), p.city)
    into v_line from public.properties p where p.id = v_req.property_id;

  if v_req.status = 'canceled' then
    return jsonb_build_object('error', 'canceled', 'agent_id', v_req.agent_id, 'line', v_line);
  end if;
  if v_req.window_start < now() - interval '1 hour' then
    return jsonb_build_object('error', 'past', 'agent_id', v_req.agent_id, 'line', v_line);
  end if;
  if v_req.status = p_answer then
    return jsonb_build_object('ok', true, 'already', true, 'agent_id', v_req.agent_id,
                              'line', v_line, 'window_start', v_req.window_start);
  end if;

  update public.showing_coord_requests
     set status = p_answer, responded_at = now()
   where id = v_req.id;

  select * into v_meet from public.client_showcase_meetings where id = v_req.meeting_id;
  select s.client_id, c.full_name into v_client, v_cname
    from public.client_showcases s
    left join public.agent_clients c on c.id = s.client_id
   where s.id = v_meet.showcase_id;

  v_who := coalesce(nullif(btrim(v_req.target_name), ''),
                    case when v_req.target = 'owner' then 'הבעלים' else 'המתווך/ת' end);
  v_title := case p_answer
    when 'confirmed' then '✅ ' || v_who || ' אישר/ה את הביקור'
    when 'postpone'  then '🕒 ' || v_who || ' מבקש/ת לדחות את הביקור'
    else                  '📆 ' || v_who || ': המועד לא מתאים, לתאם מועד אחר' end;

  insert into public.notifications
    (agent_id, type, title, body, related_client_id, related_agenda_item_id)
  values (
    v_req.agent_id, 'agenda_reminder', left(v_title, 200),
    left(concat_ws(' · ', v_line,
                   public.agent_agenda_when_text(v_req.window_start),
                   'סיור עם ' || v_cname), 400),
    v_client, v_meet.agenda_item_id);

  return jsonb_build_object('ok', true, 'agent_id', v_req.agent_id, 'line', v_line,
                            'window_start', v_req.window_start);
end;
$$;

revoke all on function public.showing_coord_respond(text, text) from public, anon, authenticated;
grant execute on function public.showing_coord_respond(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. סיור שבוטל או נדחה - מה שעוד לא יצא לא יוצא
-- ---------------------------------------------------------------------------
create or replace function public.client_showcase_meetings_cancel_coord()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.showing_coord_requests
     set status = 'canceled'
   where meeting_id = new.id and status = 'pending';
  return null;
end;
$$;

revoke all on function public.client_showcase_meetings_cancel_coord() from public, anon, authenticated;

drop trigger if exists client_showcase_meetings_cancel_coord on public.client_showcase_meetings;
create trigger client_showcase_meetings_cancel_coord
  after update of status on public.client_showcase_meetings
  for each row when (new.status in ('declined','canceled') and old.status is distinct from new.status)
  execute function public.client_showcase_meetings_cancel_coord();

-- ---------------------------------------------------------------------------
-- 8. התזמון - כל דקה, ורק כשיש מה לעשות
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=showing-coord';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - תיאום הביקורים לא תוזמן';
    return;
  end if;

  perform cron.unschedule('showing-coord')
    where exists (select 1 from cron.job where jobname = 'showing-coord');

  perform cron.schedule('showing-coord', '* * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    )
    where public.showing_coord_ready();
  $cron$, v_url));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. ‏agent_agenda_dispatch - עם הליד
--
-- הגוף זהה ל-20270125090000 (הגרסה היחידה עד כאן), ועוד related_lead_id.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_dispatch()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select al.item_id, al.offset_minutes, al.fire_at,
           i.agent_id, i.kind, i.title, i.notes, i.location, i.due_at,
           i.priority, i.status, c.full_name as client_name,
           (select l.id from public.leads l where l.id = i.lead_id) as lead_id
      from public.agent_agenda_alerts al
      join public.agent_agenda_items i on i.id = al.item_id
      left join public.agent_clients c on c.id = i.client_id
     where al.fired_at is null
       and al.fire_at <= now()
     order by al.fire_at
     limit 200
     for update of al skip locked
  loop
    update public.agent_agenda_alerts
       set fired_at = now()
     where item_id = r.item_id and offset_minutes = r.offset_minutes;

    continue when r.status <> 'open'
               or r.fire_at < now() - interval '3 hours'
               or not public.agent_agenda_enabled(r.agent_id);

    -- עובר דרך notifications_apply_preferences: סוכן/ת שהשתיק/ה את הסוג
    -- בפעמון לא יקבל/תקבל אותו, וזו בחירה שלו/ה.
    insert into public.notifications (agent_id, type, title, body, related_agenda_item_id, related_lead_id)
    values (
      r.agent_id,
      'agenda_reminder',
      left(public.agent_agenda_alert_title(r.kind, r.title, r.offset_minutes, r.priority), 200),
      left(concat_ws(' · ',
             public.agent_agenda_when_text(r.due_at),
             r.location,
             'לקוח/ה: ' || r.client_name,
             left(r.notes, 140)), 400),
      r.item_id,
      r.lead_id);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.agent_agenda_dispatch() from public, anon, authenticated;
grant execute on function public.agent_agenda_dispatch() to service_role;
