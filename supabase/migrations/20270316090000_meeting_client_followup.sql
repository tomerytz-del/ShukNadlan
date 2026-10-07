-- ============================================================================
-- פולואפ ללקוח/ה על פגישה שנקבעה דרך גבריאלה
--
-- סוכן/ת אומר/ת לגבריאלה "תקבעי לי סיור עם דני ביום ד' ב-17:00" (או מסמן/ת
-- "לשלוח ללקוח/ה" בטופס היומן ב-CRM), והלקוח/ה מקבל/ת:
--
--   1. **אישור** מיד, עם קישור לדף הפגישה (‏/meeting?t=<token>): הוספה ליומן
--      Google, ‏Apple או Outlook (קובץ ‎.ics‎), ניווט, ופרטי הסוכן/ת.
--   2. **תזכורת יום לפני** - רק לפגישה שנקבעה יותר מיומיים מראש.
--   3. **תזכורת שעה לפני**, עם שלושה כפתורים: אישור הגעה, ביטול, מועד אחר.
--      התשובה מגיעה לסוכן/ת כהתראה, ו"ביטול" מבטל את הפריט ביומן.
--   4. **עדכון** כשהמועד זז, ו**הודעת ביטול** כשהסוכן/ת מבטל/ת - מכל מקום
--      (הבוט, ה-CRM), כי הטריגר יושב על הטבלה.
--   5. **משוב אחרי סיור** - שעתיים אחרי הסיור (בשעות סבירות): אהבתי /
--      מתלבט/ת / לא בשבילי. התשובה פותחת לסוכן/ת משימה לחזור עם הצעה או עם
--      נכסים אחרים.
--
-- ולסוכן/ת: **התראה חצי שעה לפני** אם הלקוח/ה קיבל/ה תזכורת ולא ענה/תה.
--
-- ‏**המבנה הוא תור יוצא (outbox), בכוונה.** הטריגר רק רושם "מה צריך לצאת
-- ומתי"; התוכן נבנה בזמן השליחה מהפריט כמו שהוא אז. כך הזזה של פגישה
-- שהאישור שלה עוד לא יצא אינה שולחת שתי הודעות, ותזכורת תמיד נושאת את
-- המיקום העדכני.
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
alter table public.agent_agenda_items
  add column if not exists client_feedback text;
alter table public.agent_agenda_items
  add column if not exists client_feedback_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'agent_agenda_items_client_response_check') then
    alter table public.agent_agenda_items
      add constraint agent_agenda_items_client_response_check
      check (client_response is null or client_response in ('confirmed','canceled','reschedule'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'agent_agenda_items_client_feedback_check') then
    alter table public.agent_agenda_items
      add constraint agent_agenda_items_client_feedback_check
      check (client_feedback is null or client_feedback in ('liked','unsure','not_for_me'));
  end if;
end;
$$;

-- סוג משימה אוטומטית חדש: "לחזור ללקוח/ה אחרי משוב על סיור". הרשימה המלאה
-- מ-20270125090000 ועוד אחד בסוף. נכבה כמו כל סוג ב-agent_agenda_preferences.
alter table public.agent_agenda_items drop constraint if exists agent_agenda_items_auto_kind_check;
alter table public.agent_agenda_items add constraint agent_agenda_items_auto_kind_check
  check (auto_kind is null or auto_kind in
    ('lead_followup','agreement_followup','exclusivity_end','listing_expiry','showing_feedback'));

create unique index if not exists agent_agenda_items_client_token
  on public.agent_agenda_items (client_token) where client_token is not null;

comment on column public.agent_agenda_items.client_notify is
  'לשלוח ללקוח/ה אישור, תזכורות ועדכונים בוואטסאפ. נדלק מהבוט (agenda_add) או מהטופס ב-CRM. docs/meeting-client-followup.md';
comment on column public.agent_agenda_items.client_token is
  'המפתח של /meeting?t=<token> ושל הכפתורים בהודעות. נוצר בטריגר כש-client_notify נדלק.';
comment on column public.agent_agenda_items.client_response is
  'התשובה האחרונה של הלקוח/ה לפני הפגישה: confirmed / canceled / reschedule. מתאפסת כשהמועד זז.';
comment on column public.agent_agenda_items.client_feedback is
  'המשוב של הלקוח/ה אחרי סיור: liked / unsure / not_for_me.';

-- ---------------------------------------------------------------------------
-- 2. התור היוצא
--
-- ‏`noreply` היא השורה היחידה שאינה הודעה ללקוח/ה: בדיקה חצי שעה לפני
-- הפגישה שמתריעה לסוכן/ת אם התזכורת יצאה ולא נענתה. היא יושבת באותו תור
-- כדי שהזזה וביטול ינהלו אותה באותו מקום בדיוק כמו את התזכורת.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_agenda_client_messages (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.agent_agenda_items(id) on delete cascade,
  kind          text not null,
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

alter table public.agent_agenda_client_messages
  drop constraint if exists agent_agenda_client_messages_kind_check;
alter table public.agent_agenda_client_messages
  add constraint agent_agenda_client_messages_kind_check
  check (kind in ('confirm','update','cancel','reminder','reminder_day','feedback','noreply'));

comment on table public.agent_agenda_client_messages is
  'התור היוצא של הודעות ללקוח/ה על פגישה: אישור, עדכון, ביטול, תזכורות ומשוב, ובדיקת "לא ענה/תה" לסוכן/ת. נכתב בטריגר, נשלח ב-meeting-client. docs/meeting-client-followup.md';

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
-- 4. מועדי ההודעות שנגזרים מהמועד של הפגישה
--
--   ‏reminder      שעה לפני (אם זה יותר מחמש דקות מעכשיו)
--   ‏noreply       חצי שעה לפני - רק כשיש תזכורת שעשויה לא להיענות
--   ‏reminder_day  יום לפני, לפגישה שנקבעה יותר מ-48 שעות מראש, בין 08:00
--                 ל-20:00.
--   ‏feedback      סיור בלבד: שעתיים אחרי הסוף, בשעת עבודה
--                 (‏agent_agenda_business_time) - סיור שנגמר ב-19:00 מקבל
--                 את השאלה ב-09:00 למחרת ולא ב-21:00.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_client_schedule(p_item public.agent_agenda_items)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l timestamp;
begin
  delete from public.agent_agenda_client_messages
   where item_id = p_item.id and status = 'pending'
     and kind in ('reminder','reminder_day','noreply','feedback');

  if p_item.due_at - interval '60 minutes' > now() + interval '5 minutes' then
    insert into public.agent_agenda_client_messages (item_id, kind, due_at)
    values (p_item.id, 'reminder', p_item.due_at - interval '60 minutes'),
           (p_item.id, 'noreply',  p_item.due_at - interval '30 minutes');
  end if;

  if p_item.due_at > now() + interval '48 hours' then
    l := (p_item.due_at - interval '24 hours') at time zone 'Asia/Jerusalem';
    -- מחוץ ל-08:00-20:00 → ‏20:00 של היום שלפני הפגישה. פגישה ב-07:30 ביום
    -- ד' מקבלת אותה ב-20:00 ביום ג' (ולא ב-07:30), ופגישה ב-21:00 - ב-20:00.
    if extract(hour from l) < 8 or extract(hour from l) >= 20 then
      l := date_trunc('day', l) + interval '20 hours';
    end if;
    insert into public.agent_agenda_client_messages (item_id, kind, due_at)
    values (p_item.id, 'reminder_day', l at time zone 'Asia/Jerusalem');
  end if;

  if p_item.kind = 'showing' then
    insert into public.agent_agenda_client_messages (item_id, kind, due_at)
    values (p_item.id, 'feedback', public.agent_agenda_business_time(
              coalesce(p_item.ends_at, p_item.due_at + interval '60 minutes') + interval '2 hours'));
  end if;
end;
$$;

revoke all on function public.agent_agenda_client_schedule(public.agent_agenda_items) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. הטריגר שאחרי: מה נכנס לתור
--
--   הוספה / הדלקה / החזרה לפתוחות → אישור עכשיו (או עדכון אם משהו כבר יצא) + המועדים
--   הזזת מועד                       → עדכון עכשיו (אם האישור כבר יצא) + המועדים מחדש
--   שינוי מיקום                     → עדכון עכשיו
--   ביטול בידי הסוכן/ת              → הודעת ביטול (אם משהו כבר יצא)
--   ביטול בידי הלקוח/ה, כיבוי       → מוחק את כל מה שממתין
--   "בוצע", או פגישה שכבר עברה      → מוחק הכול חוץ מהמשוב: סוכן/ת שמסמן/ת
--                                     סיור כבוצע עדיין רוצה לשמוע איך היה
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
  after insert or update of client_notify, client_id, due_at, ends_at, location, status, kind
  on public.agent_agenda_items
  for each row execute function public.agent_agenda_client_outbox();

-- ---------------------------------------------------------------------------
-- 6. השליפה לשליחה
--
-- ‏`for update skip locked` - שני סבבים חופפים לא ישלחו פעמיים. השורה
-- עוברת ל-sending לפני שמשהו יוצא; קריסה באמצע משאירה אותה שם ולא שולחת
-- שוב - הודעה כפולה ללקוח/ה גרועה מהודעה שלא יצאה.
--
-- נבלעים כאן (`skipped`), בלי לשלוח:
--   · אישור/עדכון/תזכורות - כשהפריט אינו פתוח או שהפגישה כבר התחילה
--   · משוב - כשהפגישה בוטלה (גם בידי הלקוח/ה), או שעברו יותר מיומיים
--   · מנוי שאינו עומד בגייט של היומן
--   · תקרה של עשר הודעות לפגישה - סוכן/ת שמזיז/ה פגישה עשר פעמים לא
--     יציף/תציף את הלקוח/ה
--
-- ‏`noreply` מטופלת כאן עד הסוף: אם תזכורת יצאה והלקוח/ה לא ענה/תה,
-- נכתבת התראה לסוכן/ת והשורה חוזרת עם status 'sent', רק כדי ש-meeting-client
-- יעיר את notification-push מיד.
-- ---------------------------------------------------------------------------
drop function if exists public.agent_agenda_client_claim(int);
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
      left join public.agent_clients c on c.id = i.client_id
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
-- 7. התשובה של הלקוח/ה לפני הפגישה: כפתור בוואטסאפ או בדף הפגישה
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
-- 8. המשוב אחרי סיור
--
-- נשמר על הפריט, מתריע לסוכן/ת, ופותח משימה אוטומטית
-- (‏`showing_feedback`, דרך agent_agenda_add_auto - גייט, כיבוי וכפילות):
--
--   liked       → "לחזור ל<שם> עם הצעה"                שיחה, מיוחדת
--   unsure      → "לחזור ל<שם> - מתלבט/ת אחרי הסיור"   שיחה
--   not_for_me  → "לשלוח ל<שם> נכסים אחרים"            משימה
--
-- אפשר לשנות משוב (לחיצה שנייה על כפתור אחר): הפריט מתעדכן וההתראה יוצאת
-- שוב, אבל המשימה נפתחת פעם אחת לסיור (‏source_key).
-- ---------------------------------------------------------------------------
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
    left join public.agent_clients c on c.id = i.client_id
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
    null::uuid);

  return jsonb_build_object('ok', true, 'item_id', v_item.id, 'agent_id', v_item.agent_id);
end;
$$;

revoke all on function public.agent_agenda_client_feedback(text, text) from public, anon, authenticated;
grant execute on function public.agent_agenda_client_feedback(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. התזמון: כל דקה, ורק כשיש מה לשלוח
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
