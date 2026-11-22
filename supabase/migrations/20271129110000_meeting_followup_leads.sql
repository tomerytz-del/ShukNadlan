-- ============================================================================
-- אישור ותזכורת לפגישה גם לליד מ"הלידים שלי", בלי כרטיס לקוח/ה.
--
-- version 20271129110000.
-- הפונקציות כאן נבנו מהגרסה האחרונה של כל אחת, 20270319090000_meeting_client_followup:
-- agent_agenda_client_outbox, agent_agenda_client_claim, agent_agenda_client_respond,
-- agent_agenda_client_feedback. אף מיגרציה מאוחרת יותר לא הגדירה אותן מחדש.
--
-- שני כללים:
--   1. איש הקשר הוא הלקוח/ה (client_id), ואם אין - הליד (lead_id). לקוח/ה גובר/ת.
--   2. טלפון של ליד נלקח רק כש-leads.status = 'unlocked' ורק כשהליד של אותו/ה
--      סוכן/ת. ליד נעול מוסתר ב-leads_masked, ושליחה אליו הייתה עוקפת את הנעילה.
--      ליד נעול או בלי טלפון מחזיר טלפון ריק, וה-claim ממשיך כמו ללקוח/ה בלי
--      טלפון: השורה נרשמת no_phone ולא יוצא דבר.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. איש הקשר של פריט ביומן
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_contact(
  p_agent_id  uuid,
  p_client_id uuid,
  p_lead_id   uuid
)
returns table (full_name text, phone text, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.full_name, c.phone, 'client'::text
    from public.agent_clients c
   where p_client_id is not null and c.id = p_client_id
  union all
  select l.raw_name, l.raw_phone, 'lead'::text
    from public.leads l
   where p_client_id is null
     and p_lead_id is not null
     and l.id = p_lead_id
     and l.agent_id = p_agent_id
     and l.status = 'unlocked'
  limit 1;
$$;

revoke all on function public.agent_agenda_contact(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_agenda_contact(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. הטריגר: ליד נחשב כמו לקוח/ה, והעמודה lead_id מפעילה אותו
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eligible   boolean;
  v_was        boolean := false;
  v_any_sent   boolean;
begin
  v_eligible := new.client_notify
            and (new.client_id is not null or new.lead_id is not null)
            and new.due_at is not null
            and new.kind in ('meeting','showing','signing');

  if tg_op = 'UPDATE' then
    v_was := old.client_notify
         and (old.client_id is not null or old.lead_id is not null)
         and old.due_at is not null
         and old.kind in ('meeting','showing','signing');
  end if;

  if not v_eligible or new.status = 'canceled' then
    delete from public.agent_agenda_client_messages where item_id = new.id and status = 'pending';
    if v_eligible and tg_op = 'UPDATE' and old.status = 'open'
       and new.client_response is distinct from 'canceled'
       and new.due_at > now()
       and exists (select 1 from public.agent_agenda_client_messages
                    where item_id = new.id and status = 'sent' and kind <> 'noreply') then
      insert into public.agent_agenda_client_messages (item_id, kind) values (new.id, 'cancel');
    end if;
    return null;
  end if;

  if new.status = 'done' or new.due_at <= now() then
    delete from public.agent_agenda_client_messages
     where item_id = new.id and status = 'pending' and kind <> 'feedback';
    return null;
  end if;

  -- פתוח, ובעתיד
  select exists (select 1 from public.agent_agenda_client_messages
                  where item_id = new.id and status = 'sent' and kind <> 'noreply')
    into v_any_sent;

  if tg_op = 'INSERT' or not v_was or old.status <> 'open' then
    delete from public.agent_agenda_client_messages where item_id = new.id and status = 'pending';
    insert into public.agent_agenda_client_messages (item_id, kind)
    values (new.id, case when v_any_sent then 'update' else 'confirm' end);
    perform public.agent_agenda_client_schedule(new);
    return null;
  end if;

  if new.due_at is distinct from old.due_at or new.location is distinct from old.location then
    -- אישור שעוד לא יצא ייבנה ממילא מהמועד החדש
    if not exists (select 1 from public.agent_agenda_client_messages
                    where item_id = new.id and status = 'pending' and kind in ('confirm','update')) then
      insert into public.agent_agenda_client_messages (item_id, kind) values (new.id, 'update');
    end if;
  end if;

  if new.due_at is distinct from old.due_at
     or new.ends_at is distinct from old.ends_at
     or new.kind is distinct from old.kind then
    perform public.agent_agenda_client_schedule(new);
  end if;

  return null;
end;
$$;

revoke all on function public.agent_agenda_client_outbox() from public, anon, authenticated;

drop trigger if exists agent_agenda_client_outbox on public.agent_agenda_items;
create trigger agent_agenda_client_outbox
  after insert or update of client_notify, client_id, lead_id, due_at, ends_at, location, status, kind
  on public.agent_agenda_items
  for each row execute function public.agent_agenda_client_outbox();

-- ---------------------------------------------------------------------------
-- 3. השליפה לשליחה: אותו גוף, איש הקשר מהפונקציה למעלה
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_claim(p_limit int default 30)
returns table (
  message_id    uuid,
  kind          text,
  item_id       uuid,
  item_kind     text,
  title         text,
  due_at        timestamptz,
  location      text,
  token         text,
  client_name   text,
  client_phone  text,
  agent_id      uuid,
  agent_name    text,
  agent_phone   text,
  agency_name   text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r      record;
  v_skip boolean;
begin
  for r in
    select m.id, m.kind, i.id as i_id, i.kind as i_kind, i.title, i.due_at,
           i.location, i.client_token, i.status, i.agent_id, i.client_response,
           c.full_name, c.phone, a.display_name, a.phone as a_phone, ag.name as agency_name
      from public.agent_agenda_client_messages m
      join public.agent_agenda_items i on i.id = m.item_id
      left join lateral public.agent_agenda_contact(i.agent_id, i.client_id, i.lead_id) c on true
      left join public.agency_members a on a.id = i.agent_id
      left join public.agencies ag on ag.id = a.agency_id
     where m.status = 'pending'
       and m.due_at <= now()
     order by m.due_at
     limit greatest(1, least(p_limit, 100))
     for update of m skip locked
  loop
    v_skip := not public.agent_agenda_enabled(r.agent_id)
      or case r.kind
           when 'cancel'   then false
           when 'feedback' then r.status = 'canceled'
                             or r.client_response is not distinct from 'canceled'
                             or r.due_at < now() - interval '2 days'
           else r.status <> 'open' or r.due_at <= now()
         end
      or (r.kind <> 'noreply'
          and (select count(*) from public.agent_agenda_client_messages x
                where x.item_id = r.i_id and x.status = 'sent' and x.kind <> 'noreply') >= 10);

    if not v_skip and r.kind = 'noreply' then
      v_skip := r.client_response is not null
        or not exists (select 1 from public.agent_agenda_client_messages x
                        where x.item_id = r.i_id and x.status = 'sent'
                          and x.kind in ('reminder','reminder_day'));
      if not v_skip then
        insert into public.notifications (agent_id, type, title, body, related_agenda_item_id)
        values (
          r.agent_id,
          'agenda_reminder',
          left('⏳ ' || coalesce(r.full_name, 'הלקוח/ה') || ' עוד לא אישר/ה הגעה', 200),
          left(concat_ws(' · ', r.title, public.agent_agenda_when_text(r.due_at),
                         'התזכורת יצאה ולא נענתה - כדאי להתקשר'), 400),
          r.i_id);
        update public.agent_agenda_client_messages
           set status = 'sent', sent_at = now()
         where id = r.id;
      end if;
    end if;

    if v_skip then
      update public.agent_agenda_client_messages
         set status = 'skipped', sent_at = now()
       where id = r.id;
      continue;
    end if;

    if r.kind <> 'noreply' then
      update public.agent_agenda_client_messages set status = 'sending' where id = r.id;
    end if;

    message_id   := r.id;
    kind         := r.kind;
    item_id      := r.i_id;
    item_kind    := r.i_kind;
    title        := r.title;
    due_at       := r.due_at;
    location     := r.location;
    token        := r.client_token;
    client_name  := r.full_name;
    client_phone := r.phone;
    agent_id     := r.agent_id;
    agent_name   := r.display_name;
    agent_phone  := r.a_phone;
    agency_name  := r.agency_name;
    return next;
  end loop;
end;
$$;

revoke all on function public.agent_agenda_client_claim(int) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. התשובה והמשוב של איש הקשר: השם מאותה פונקציה, והמשימה נקשרת גם לליד
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_respond(p_token text, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   record;
  v_title  text;
  v_kind   text;
begin
  if p_response not in ('confirmed','canceled','reschedule') then
    return jsonb_build_object('error', 'bad_response');
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('error', 'not_found');
  end if;

  select i.*, c.full_name as client_name
    into v_item
    from public.agent_agenda_items i
    left join lateral public.agent_agenda_contact(i.agent_id, i.client_id, i.lead_id) c on true
   where i.client_token = p_token
   for update of i;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if v_item.status = 'canceled' then
    return jsonb_build_object('error', 'canceled', 'item_id', v_item.id);
  end if;
  if v_item.status <> 'open' or v_item.due_at is null or v_item.due_at < now() - interval '30 minutes' then
    return jsonb_build_object('error', 'past', 'item_id', v_item.id);
  end if;

  if v_item.client_response is not distinct from p_response then
    return jsonb_build_object('ok', true, 'already', true, 'item_id', v_item.id, 'agent_id', v_item.agent_id);
  end if;

  update public.agent_agenda_items
     set client_response = p_response,
         client_responded_at = now(),
         status = case when p_response = 'canceled' then 'canceled' else status end
   where id = v_item.id;

  v_kind := case v_item.kind when 'showing' then 'לסיור' when 'signing' then 'לחתימה' else 'לפגישה' end;
  v_title := case p_response
    when 'confirmed'  then '✅ ' || coalesce(v_item.client_name, 'הלקוח/ה') || ' אישר/ה הגעה ' || v_kind
    when 'canceled'   then '❌ ' || coalesce(v_item.client_name, 'הלקוח/ה') || ' ביטל/ה את ה' || substr(v_kind, 2)
    else                   '📆 ' || coalesce(v_item.client_name, 'הלקוח/ה') || ' מבקש/ת מועד אחר ' || v_kind
  end;

  insert into public.notifications (agent_id, type, title, body, related_agenda_item_id)
  values (
    v_item.agent_id,
    'agenda_reminder',
    left(v_title, 200),
    left(concat_ws(' · ',
           v_item.title,
           public.agent_agenda_when_text(v_item.due_at),
           case p_response
             when 'canceled'   then 'הפריט בוטל ביומן. לקביעת מועד חדש - לחזור ללקוח/ה'
             when 'reschedule' then 'הפגישה עדיין ביומן. כדאי לחזור ללקוח/ה ולתאם'
           end), 400),
    v_item.id);

  return jsonb_build_object('ok', true, 'item_id', v_item.id, 'agent_id', v_item.agent_id);
end;
$$;

revoke all on function public.agent_agenda_client_respond(text, text) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_respond(text, text) to service_role;

create or replace function public.agent_agenda_client_feedback(p_token text, p_feedback text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  record;
  v_name  text;
  v_title text;
begin
  if p_feedback not in ('liked','unsure','not_for_me') then
    return jsonb_build_object('error', 'bad_feedback');
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('error', 'not_found');
  end if;

  select i.*, c.full_name as client_name
    into v_item
    from public.agent_agenda_items i
    left join lateral public.agent_agenda_contact(i.agent_id, i.client_id, i.lead_id) c on true
   where i.client_token = p_token
   for update of i;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_item.status = 'canceled' then
    return jsonb_build_object('error', 'canceled', 'item_id', v_item.id);
  end if;
  if v_item.due_at is null or v_item.due_at > now() then
    return jsonb_build_object('error', 'not_yet', 'item_id', v_item.id);
  end if;

  if v_item.client_feedback is not distinct from p_feedback then
    return jsonb_build_object('ok', true, 'already', true, 'item_id', v_item.id, 'agent_id', v_item.agent_id);
  end if;

  update public.agent_agenda_items
     set client_feedback = p_feedback, client_feedback_at = now()
   where id = v_item.id;

  v_name := coalesce(v_item.client_name, 'הלקוח/ה');
  v_title := case p_feedback
    when 'liked'  then '👍 ' || v_name || ' אהב/ה את הסיור'
    when 'unsure' then '🤔 ' || v_name || ' מתלבט/ת אחרי הסיור'
    else               '👎 ' || v_name || ': הנכס לא בשבילו/ה'
  end;

  insert into public.notifications (agent_id, type, title, body, related_agenda_item_id)
  values (
    v_item.agent_id,
    'agenda_reminder',
    left(v_title, 200),
    left(concat_ws(' · ', v_item.title,
           case p_feedback
             when 'liked'      then 'נפתחה משימה לחזור עם הצעה'
             when 'unsure'     then 'נפתחה משימה לחזור ולשמוע מה מעכב'
             else                   'נפתחה משימה לשלוח נכסים אחרים - אפשר לבקש מגבריאלה מיניסייט'
           end), 400),
    v_item.id);

  perform public.agent_agenda_add_auto(
    v_item.agent_id,
    'showing_feedback',
    'feedback:' || v_item.id,
    case when p_feedback = 'not_for_me' then 'task' else 'call' end,
    case p_feedback
      when 'liked'  then 'לחזור ל' || v_name || ' עם הצעה - אהב/ה את הסיור'
      when 'unsure' then 'לחזור ל' || v_name || ' - מתלבט/ת אחרי הסיור'
      else               'לשלוח ל' || v_name || ' נכסים אחרים'
    end,
    concat_ws(E'\n', 'בעקבות: ' || v_item.title,
      case when p_feedback = 'liked' then null
           else 'אפשר לכתוב לגבריאלה "תשלחי ל' || v_name || ' נכסים דומים" - היא תבנה מיניסייט.' end),
    public.agent_agenda_business_time(now() + interval '1 hour'),
    case when p_feedback = 'liked' then 'high' else 'normal' end,
    v_item.client_id,
    v_item.property_id,
    v_item.lead_id);

  return jsonb_build_object('ok', true, 'item_id', v_item.id, 'agent_id', v_item.agent_id);
end;
$$;

revoke all on function public.agent_agenda_client_feedback(text, text) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_feedback(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. פריטים שנשמרו לפני שהמיגרציה רצה
--
-- הבוט עולה לפני המיגרציה: פריט עם lead_id ו-client_notify שנשמר בין שני
-- הרגעים לא נכנס לתור (הטריגר הישן דרש client_id), ועדכון שאינו משנה ערך אינו
-- יוצר לו אישור. מכבים ומדליקים רק פריטים פתוחים ועתידיים שאין להם אף הודעה
-- בתור, כך שההרצה חוזרת בלי לשלוח עדכון כפול למי שכבר קיבל/ה.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(i.id), '{}') into v_ids
    from public.agent_agenda_items i
   where i.client_notify
     and i.client_id is null
     and i.lead_id is not null
     and i.status = 'open'
     and i.due_at > now()
     and i.kind in ('meeting','showing','signing')
     and not exists (select 1 from public.agent_agenda_client_messages m where m.item_id = i.id);
  update public.agent_agenda_items set client_notify = false where id = any (v_ids);
  update public.agent_agenda_items set client_notify = true  where id = any (v_ids);
end;
$$;
