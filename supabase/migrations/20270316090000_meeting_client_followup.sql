-- ============================================================================
-- פולואפ ללקוח/ה על פגישה שנקבעה דרך גבריאלה
--
-- סוכן/ת אומר/ת לגבריאלה "תקבעי לי פגישה עם דני ביום ג' ב-17:00", והלקוח/ה
-- מקבל/ת מיד:
--
--   1. **אישור** בוואטסאפ, עם קישור לדף הפגישה (‏/meeting?t=<token>): הוספה
--      ליומן Google, ‏Apple או Outlook (קובץ ‎.ics‎), ניווט, ופרטי הסוכן/ת.
--   2. **תזכורת שעה לפני**, עם שלושה כפתורים: אישור הגעה, ביטול, מועד אחר.
--      התשובה מגיעה לסוכן/ת כהתראה (פעמון + וואטסאפ), ו"ביטול" מבטל את
--      הפריט ביומן.
--   3. **עדכון** כשהמועד זז, ו**הודעת ביטול** כשהסוכן/ת מבטל/ת - מכל מקום
--      (הבוט, ה-CRM), כי הטריגר יושב על הטבלה.
--
-- ‏**המבנה הוא תור יוצא (outbox), בכוונה.** הטריגר רק רושם "מה צריך לצאת
-- ומתי"; התוכן נבנה בזמן השליחה מהפריט כמו שהוא אז. כך הזזה של פגישה
-- שהאישור שלה עוד לא יצא אינה שולחת שתי הודעות, ותזכורת שעה לפני תמיד
-- נושאת את המיקום העדכני.
--
-- הפרטים: docs/meeting-client-followup.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות על הפריט
-- ---------------------------------------------------------------------------
alter table public.agent_agenda_items
  add column if not exists client_notify boolean not null default false;
alter table public.agent_agenda_items
  add column if not exists client_token text;
alter table public.agent_agenda_items
  add column if not exists client_response text;
alter table public.agent_agenda_items
  add column if not exists client_responded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'agent_agenda_items_client_response_check') then
    alter table public.agent_agenda_items
      add constraint agent_agenda_items_client_response_check
      check (client_response is null or client_response in ('confirmed','canceled','reschedule'));
  end if;
end;
$$;

create unique index if not exists agent_agenda_items_client_token
  on public.agent_agenda_items (client_token) where client_token is not null;

comment on column public.agent_agenda_items.client_notify is
  'לשלוח ללקוח/ה אישור, תזכורת שעה לפני ועדכונים בוואטסאפ. נדלק מהבוט (agenda_add). docs/meeting-client-followup.md';
comment on column public.agent_agenda_items.client_token is
  'המפתח של /meeting?t=<token> ושל כפתורי התזכורת. נוצר בטריגר כש-client_notify נדלק.';
comment on column public.agent_agenda_items.client_response is
  'התשובה האחרונה של הלקוח/ה: confirmed / canceled / reschedule. מתאפסת כשהמועד זז.';

-- ---------------------------------------------------------------------------
-- 2. התור היוצא
-- ---------------------------------------------------------------------------
create table if not exists public.agent_agenda_client_messages (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.agent_agenda_items(id) on delete cascade,
  kind          text not null check (kind in ('confirm','update','cancel','reminder')),
  due_at        timestamptz not null default now(),
  -- pending → sending → sent / failed / no_channel / no_phone / opted_out / skipped
  status        text not null default 'pending'
                check (status in ('pending','sending','sent','failed','no_channel',
                                  'no_phone','opted_out','skipped')),
  mode          text check (mode is null or mode in ('template','text')),
  error         text,
  wa_message_id text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

comment on table public.agent_agenda_client_messages is
  'התור היוצא של הודעות ללקוח/ה על פגישה: אישור, עדכון, ביטול ותזכורת. נכתב בטריגר, נשלח ב-meeting-client. docs/meeting-client-followup.md';

create index if not exists agent_agenda_client_messages_due
  on public.agent_agenda_client_messages (due_at) where status = 'pending';
create index if not exists agent_agenda_client_messages_item
  on public.agent_agenda_client_messages (item_id);

alter table public.agent_agenda_client_messages enable row level security;
revoke all on public.agent_agenda_client_messages from anon;
revoke insert, update, delete on public.agent_agenda_client_messages from authenticated;

-- הסוכן/ת רואה ב-CRM מה יצא ללקוח/ה על הפגישות שלו/ה - קריאה בלבד.
drop policy if exists "agent reads own meeting client messages" on public.agent_agenda_client_messages;
create policy "agent reads own meeting client messages"
  on public.agent_agenda_client_messages for select
  to authenticated
  using (exists (select 1 from public.agent_agenda_items i
                  where i.id = item_id and i.agent_id = public.current_agent_id()));

-- ---------------------------------------------------------------------------
-- 3. הטריגר שלפני: טוקן, ואיפוס התשובה כשהמועד זז
--
-- תשובה "אישרתי הגעה" שייכת למועד שעליו נשאלה. פגישה שהוזזה צריכה אישור
-- חדש, ולכן התשובה מתאפסת - אלא אם באותו עדכון בדיוק נכתבה תשובה חדשה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_notify and new.client_token is null then
    new.client_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  if tg_op = 'UPDATE' then
    new.client_token := coalesce(old.client_token, new.client_token);
    if new.due_at is distinct from old.due_at
       and new.client_response is not distinct from old.client_response then
      new.client_response := null;
      new.client_responded_at := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.agent_agenda_client_before() from public, anon, authenticated;

drop trigger if exists agent_agenda_client_before on public.agent_agenda_items;
create trigger agent_agenda_client_before
  before insert or update on public.agent_agenda_items
  for each row execute function public.agent_agenda_client_before();

-- ---------------------------------------------------------------------------
-- 4. הטריגר שאחרי: מה נכנס לתור
--
--   הוספה (או הדלקת client_notify)  → אישור עכשיו + תזכורת שעה לפני
--   הזזת מועד                        → עדכון עכשיו (אם האישור כבר יצא) + תזכורת חדשה
--   ביטול בידי הסוכן/ת               → הודעת ביטול (אם משהו כבר יצא)
--   ביטול בידי הלקוח/ה, "בוצע"       → רק מנקה את מה שעוד ממתין
--
-- תזכורת שמועדה פחות מחמש דקות מעכשיו לא נוצרת: מי שקבע/ה פגישה בעוד
-- חצי שעה שולח/ת אישור, וזה מספיק.
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
            and new.client_id is not null
            and new.due_at is not null
            and new.kind in ('meeting','showing','signing');

  if tg_op = 'UPDATE' then
    v_was := old.client_notify
         and old.client_id is not null
         and old.due_at is not null
         and old.kind in ('meeting','showing','signing');
  end if;

  select exists (select 1 from public.agent_agenda_client_messages
                  where item_id = new.id and status = 'sent')
    into v_any_sent;

  -- כבוי / לא רלוונטי יותר: מנקים מה שממתין
  if not v_eligible then
    delete from public.agent_agenda_client_messages where item_id = new.id and status = 'pending';
    return null;
  end if;

  -- הפריט נסגר
  if new.status <> 'open' then
    delete from public.agent_agenda_client_messages where item_id = new.id and status = 'pending';
    if tg_op = 'UPDATE' and old.status = 'open' and new.status = 'canceled'
       and new.client_response is distinct from 'canceled'
       and v_any_sent and new.due_at > now() then
      insert into public.agent_agenda_client_messages (item_id, kind) values (new.id, 'cancel');
    end if;
    return null;
  end if;

  -- פתוח, ובעתיד
  if new.due_at <= now() then
    delete from public.agent_agenda_client_messages where item_id = new.id and status = 'pending';
    return null;
  end if;

  if tg_op = 'INSERT' or not v_was or old.status <> 'open' then
    -- חדש, נדלק עכשיו, או הוחזר לפתוחות
    delete from public.agent_agenda_client_messages where item_id = new.id and status = 'pending';
    insert into public.agent_agenda_client_messages (item_id, kind)
    values (new.id, case when v_any_sent then 'update' else 'confirm' end);
  elsif new.due_at is distinct from old.due_at or new.location is distinct from old.location then
    -- אישור שעוד לא יצא ייבנה ממילא מהמועד החדש
    if not exists (select 1 from public.agent_agenda_client_messages
                    where item_id = new.id and status = 'pending' and kind in ('confirm','update')) then
      insert into public.agent_agenda_client_messages (item_id, kind) values (new.id, 'update');
    end if;
  end if;

  if tg_op = 'INSERT' or not v_was or old.status <> 'open' or new.due_at is distinct from old.due_at then
    delete from public.agent_agenda_client_messages
     where item_id = new.id and status = 'pending' and kind = 'reminder';
    if new.due_at - interval '60 minutes' > now() + interval '5 minutes' then
      insert into public.agent_agenda_client_messages (item_id, kind, due_at)
      values (new.id, 'reminder', new.due_at - interval '60 minutes');
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.agent_agenda_client_outbox() from public, anon, authenticated;

drop trigger if exists agent_agenda_client_outbox on public.agent_agenda_items;
create trigger agent_agenda_client_outbox
  after insert or update of client_notify, client_id, due_at, location, status, kind
  on public.agent_agenda_items
  for each row execute function public.agent_agenda_client_outbox();

-- ---------------------------------------------------------------------------
-- 5. השליפה לשליחה
--
-- ‏`for update skip locked` - שני סבבים חופפים לא ישלחו פעמיים. השורה
-- עוברת ל-sending לפני שמשהו יוצא; קריסה באמצע משאירה אותה שם ולא שולחת
-- שוב - הודעה כפולה ללקוח/ה גרועה מהודעה שלא יצאה.
--
-- נבלעים כאן, בלי לשלוח: פריט שכבר אינו פתוח (חוץ מהודעת ביטול), פגישה
-- שכבר התחילה, מנוי שאינו עומד בגייט, ותקרה של שמונה הודעות לפגישה - סוכן/ת
-- שמזיז/ה פגישה עשר פעמים לא יציף/תציף את הלקוח/ה.
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
  r record;
begin
  for r in
    select m.id, m.kind, m.due_at as m_due, i.id as i_id, i.kind as i_kind, i.title, i.due_at,
           i.location, i.client_token, i.status, i.agent_id,
           c.full_name, c.phone, a.display_name, a.phone as a_phone, ag.name as agency_name
      from public.agent_agenda_client_messages m
      join public.agent_agenda_items i on i.id = m.item_id
      left join public.agent_clients c on c.id = i.client_id
      left join public.agency_members a on a.id = i.agent_id
      left join public.agencies ag on ag.id = a.agency_id
     where m.status = 'pending'
       and m.due_at <= now()
     order by m.due_at
     limit greatest(1, least(p_limit, 100))
     for update of m skip locked
  loop
    if (r.kind <> 'cancel' and r.status <> 'open')
       or (r.kind <> 'cancel' and r.due_at <= now())
       or not public.agent_agenda_enabled(r.agent_id)
       or (select count(*) from public.agent_agenda_client_messages x
            where x.item_id = r.i_id and x.status = 'sent') >= 8 then
      update public.agent_agenda_client_messages
         set status = 'skipped', sent_at = now()
       where id = r.id;
      continue;
    end if;

    update public.agent_agenda_client_messages set status = 'sending' where id = r.id;

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

create or replace function public.agent_agenda_client_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.agent_agenda_client_messages
                  where status = 'pending' and due_at <= now());
$$;

revoke all on function public.agent_agenda_client_ready() from public, anon, authenticated;
grant execute on function public.agent_agenda_client_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 6. התשובה של הלקוח/ה: כפתור בוואטסאפ או בדף הפגישה
--
-- אותה פונקציה לשני הערוצים, כדי ששניהם יכתבו אותו דבר ויתריעו אותו דבר.
-- אידמפוטנטית: אותה תשובה פעמיים (לחיצה כפולה, או כפתור ואחר כך הדף) אינה
-- מתריעה פעמיים. "ביטול" מבטל את הפריט ביומן; "מועד אחר" משאיר אותו פתוח
-- ומבקש מהסוכן/ת לחזור.
--
-- ההתראה לסוכן/ת היא `agenda_reminder` על אותו פריט: דחופה (עוקפת שעות
-- שקט - ביטול שעה לפני אינו יכול לחכות לבוקר), ולחיצה עליה בפעמון פותחת
-- את הפריט ביומן.
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
    left join public.agent_clients c on c.id = i.client_id
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

-- ---------------------------------------------------------------------------
-- 7. התזמון: כל דקה, ורק כשיש מה לשלוח
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/meeting-client';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - ההודעות ללקוח/ה על פגישות לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('meeting-client-dispatch')
    where exists (select 1 from cron.job where jobname = 'meeting-client-dispatch');
  perform cron.schedule('meeting-client-dispatch', '* * * * *', format($cron$
    select net.http_post(
      url := %L,
      body := '{"action":"dispatch"}'::jsonb,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.agent_agenda_client_ready();
  $cron$, v_url));
end;
$$;
