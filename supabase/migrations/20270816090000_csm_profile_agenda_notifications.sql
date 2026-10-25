-- ===========================================================================
-- אזור ההטמעה: הגדרות פרופיל, יומן והתראות (docs/csm-adoption.md)
-- ---------------------------------------------------------------------------
-- מנהלת ההטמעה קיבלה עד היום צנרת, משרדים, מנטור והקלטות - אבל לא דבר שפונה
-- אליה מעצמו: לא יומן של הפגישות שהיא קובעת, לא תזכורת לפני פגישה, לא "נרשם/ה
-- סוכן/ת חדש/ה", ולא סיכום בוקר. וגם לא מקום לשנות את השם, הנייד או מתי
-- להפריע לה. כל אלה נכנסים כאן, כ-csm_* - לא כשורה ב-agency_members ולא דרך
-- notifications של הסוכנים (הסקיל csm-adoption).
--
-- מה בקובץ:
--   1. ‏csm_staff: העדפות - התראות בוואטסאפ, סוגים כבויים, שעת סיכום הבוקר,
--      ימי עבודה, שעות שקט, אורך פגישה ותזכורת ברירת מחדל, קישור קבוע לפגישה
--      בווידאו. ‏csm_profile_get / csm_profile_save (היא בעצמה) ו-
--      ‏csm_profile_apply (הליבה, גם לגבריאלה דרך service_role).
--   2. ‏csm_agenda: היומן שלה - פגישה עם סוכן/ת, שיחת מעקב, ביקור במשרד,
--      הדרכה. פגישה עם סוכן/ת "נרשם/ה" מעבירה ל"נקבעה פגישה" וקובעת את מועד
--      הקשר (טריגר), כמו שהיא הייתה עושה ביד.
--   3. ‏csm_notifications: הפעמון שלה. נכתבות רק במסד (‏_csm_notify), עם מפתח
--      כפילות, וכל אחת נושאת את מצב המשלוח לוואטסאפ.
--   4. ‏csm_notify_run(): כל דקה ב-pg_cron - תזכורות לפגישות, סיכום הבוקר,
--      סוכן/ת חדש/ה, ומי שעבר/ה עכשיו את 5 הימים בלי גבריאלה. ‏csm_calls
--      שהסתיימה (מהאזור) כותבת התראה בטריגר.
--   5. המשלוח לוואטסאפ: ‏claim / mark ו-cron שמעיר את
--      ‏whatsapp-webhook?task=csm-notify רק כשיש מה לשלוח (‏csm-notify.ts).
--      ‏last_inbound_at ב-csm_whatsapp_conversations קובע טקסט חופשי (בתוך 24
--      השעות) או תבנית.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. הגדרות הפרופיל
-- ---------------------------------------------------------------------------
alter table public.csm_staff add column if not exists notify_whatsapp boolean not null default true;
-- הסוגים שכיבתה (גם בפעמון וגם בוואטסאפ). ריק = הכול דלוק.
alter table public.csm_staff add column if not exists notify_off text[] not null default '{}';
alter table public.csm_staff add column if not exists digest_time time not null default '08:30';
-- ‏extract(dow): 0 = ראשון. ברירת מחדל ראשון-חמישי.
alter table public.csm_staff add column if not exists work_days smallint[] not null default '{0,1,2,3,4}';
alter table public.csm_staff add column if not exists quiet_from time not null default '21:00';
alter table public.csm_staff add column if not exists quiet_to time not null default '08:00';
alter table public.csm_staff add column if not exists meeting_minutes smallint not null default 45;
alter table public.csm_staff add column if not exists reminder_minutes smallint not null default 30;
alter table public.csm_staff add column if not exists meeting_link text;
alter table public.csm_staff add column if not exists last_digest_on date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'csm_staff_meeting_minutes_check') then
    alter table public.csm_staff add constraint csm_staff_meeting_minutes_check
      check (meeting_minutes between 10 and 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csm_staff_reminder_minutes_check') then
    alter table public.csm_staff add constraint csm_staff_reminder_minutes_check
      check (reminder_minutes between 0 and 1440);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csm_staff_meeting_link_check') then
    alter table public.csm_staff add constraint csm_staff_meeting_link_check
      check (meeting_link is null or (char_length(meeting_link) <= 500 and meeting_link ~* '^https://'));
  end if;
end $$;

comment on column public.csm_staff.notify_off is
  'סוגי התראות שכובו (new_agent, at_risk, meeting_reminder, call_ready, daily_digest) - בפעמון ובוואטסאפ. docs/csm-adoption.md';

-- מתי לא להפריע בוואטסאפ, בשעון ישראל. from = to - אין שעות שקט.
create or replace function public._csm_in_quiet(p_from time, p_to time, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_from = p_to then false
    when p_from < p_to then (p_at at time zone 'Asia/Jerusalem')::time >= p_from
                        and (p_at at time zone 'Asia/Jerusalem')::time <  p_to
    else (p_at at time zone 'Asia/Jerusalem')::time >= p_from
      or (p_at at time zone 'Asia/Jerusalem')::time <  p_to
  end;
$$;

revoke all on function public._csm_in_quiet(time, time, timestamptz) from public, anon, authenticated;
grant execute on function public._csm_in_quiet(time, time, timestamptz) to service_role;

-- השיחה בוואטסאפ: מתי היא כתבה לאחרונה. טקסט חופשי מותר רק 24 שעות מאז
-- (‏Meta), ואחרי זה - התבנית. ‏updated_at אינו התשובה: הוא זז גם כשגבריאלה
-- כותבת, כולל ההתראות עצמן.
alter table public.csm_whatsapp_conversations add column if not exists last_inbound_at timestamptz;

create or replace function public._csm_profile_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'email', s.email,
    'display_name', s.display_name,
    'phone', s.phone,
    'notify_whatsapp', s.notify_whatsapp,
    'notify_off', to_jsonb(s.notify_off),
    'digest_time', to_char(s.digest_time, 'HH24:MI'),
    'work_days', to_jsonb(s.work_days),
    'quiet_from', to_char(s.quiet_from, 'HH24:MI'),
    'quiet_to', to_char(s.quiet_to, 'HH24:MI'),
    'meeting_minutes', s.meeting_minutes,
    'reminder_minutes', s.reminder_minutes,
    'meeting_link', s.meeting_link,
    'whatsapp_window_open', coalesce(c.last_inbound_at > now() - interval '23 hours', false),
    'last_whatsapp_at', c.last_inbound_at
  )
    from public.csm_staff s
    left join public.csm_whatsapp_conversations c on c.staff_id = s.id
   where s.id = p_id;
$$;

revoke all on function public._csm_profile_json(uuid) from public, anon, authenticated;
grant execute on function public._csm_profile_json(uuid) to service_role;

-- הפרופיל של אשת הצוות המחוברת
create or replace function public.csm_profile_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.current_csm_id();
begin
  if v_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return public._csm_profile_json(v_id);
end;
$$;

revoke all on function public.csm_profile_get() from public, anon, authenticated;
grant execute on function public.csm_profile_get() to authenticated;

-- הליבה: מעדכנת רק את המפתחות שנשלחו. ‏p_allow_phone - רק מהאזור: גבריאלה
-- מזהה אותה לפי הנייד, ושינוי שלו מתוך השיחה היה מנתק אותה באמצע.
-- המייל לא כאן בכוונה: הוא מפתח ההזמנה, ואחרי הכניסה הזהות היא user_id.
create or replace function public.csm_profile_apply(p_staff_id uuid, p jsonb, p_allow_phone boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.csm_staff%rowtype;
  v_txt   text;
  v_int   int;
  v_kinds text[] := array['new_agent','at_risk','meeting_reminder','call_ready','daily_digest'];
  v_days  smallint[];
begin
  select * into v_row from public.csm_staff where id = p_staff_id and active for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  p := coalesce(p, '{}'::jsonb);

  if p ? 'display_name' then
    v_txt := nullif(btrim(coalesce(p->>'display_name', '')), '');
    if v_txt is null or char_length(v_txt) > 120 then
      return jsonb_build_object('error', 'bad_name');
    end if;
    v_row.display_name := v_txt;
  end if;

  if p ? 'phone' then
    if not p_allow_phone then
      return jsonb_build_object('error', 'phone_web_only');
    end if;
    v_txt := nullif(btrim(coalesce(p->>'phone', '')), '');
    if v_txt is null or public.normalize_msisdn(v_txt) is null then
      return jsonb_build_object('error', 'bad_phone');
    end if;
    -- אותו כלל של csm_staff_save: גבריאלה מזהה סוכנים קודם
    if exists (select 1 from public.agency_members m where m.phone_e164 = public.normalize_msisdn(v_txt)) then
      return jsonb_build_object('error', 'phone_is_agent');
    end if;
    if exists (select 1 from public.csm_staff s
                where s.phone_e164 = public.normalize_msisdn(v_txt) and s.id <> p_staff_id) then
      return jsonb_build_object('error', 'phone_taken');
    end if;
    v_row.phone := v_txt;
  end if;

  if p ? 'notify_whatsapp' then
    v_row.notify_whatsapp := coalesce((p->>'notify_whatsapp')::boolean, true);
  end if;

  if p ? 'notify_off' then
    if jsonb_typeof(p->'notify_off') <> 'array' then
      return jsonb_build_object('error', 'bad_notify_off');
    end if;
    select coalesce(array_agg(distinct k order by k), '{}') into v_row.notify_off
      from jsonb_array_elements_text(p->'notify_off') k where k = any(v_kinds);
  end if;

  if p ? 'digest_time' then
    if coalesce(p->>'digest_time', '') !~ '^([01]?\d|2[0-3]):[0-5]\d$' then
      return jsonb_build_object('error', 'bad_time');
    end if;
    v_row.digest_time := (p->>'digest_time')::time;
  end if;
  if p ? 'quiet_from' then
    if coalesce(p->>'quiet_from', '') !~ '^([01]?\d|2[0-3]):[0-5]\d$' then
      return jsonb_build_object('error', 'bad_time');
    end if;
    v_row.quiet_from := (p->>'quiet_from')::time;
  end if;
  if p ? 'quiet_to' then
    if coalesce(p->>'quiet_to', '') !~ '^([01]?\d|2[0-3]):[0-5]\d$' then
      return jsonb_build_object('error', 'bad_time');
    end if;
    v_row.quiet_to := (p->>'quiet_to')::time;
  end if;

  if p ? 'work_days' then
    if jsonb_typeof(p->'work_days') <> 'array' then
      return jsonb_build_object('error', 'bad_days');
    end if;
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days
      from jsonb_array_elements_text(p->'work_days') d where d ~ '^[0-6]$';
    v_row.work_days := v_days;
  end if;

  if p ? 'meeting_minutes' then
    v_int := case when coalesce(p->>'meeting_minutes', '') ~ '^\d{1,4}$' then (p->>'meeting_minutes')::int end;
    if v_int is null or v_int not between 10 and 240 then
      return jsonb_build_object('error', 'bad_minutes');
    end if;
    v_row.meeting_minutes := v_int;
  end if;
  if p ? 'reminder_minutes' then
    v_int := case when coalesce(p->>'reminder_minutes', '') ~ '^\d{1,4}$' then (p->>'reminder_minutes')::int end;
    if v_int is null or v_int not between 0 and 1440 then
      return jsonb_build_object('error', 'bad_minutes');
    end if;
    v_row.reminder_minutes := v_int;
  end if;

  if p ? 'meeting_link' then
    v_txt := nullif(btrim(coalesce(p->>'meeting_link', '')), '');
    if v_txt is not null and (char_length(v_txt) > 500 or v_txt !~* '^https://') then
      return jsonb_build_object('error', 'bad_link');
    end if;
    v_row.meeting_link := v_txt;
  end if;

  update public.csm_staff set
    display_name = v_row.display_name, phone = v_row.phone,
    notify_whatsapp = v_row.notify_whatsapp, notify_off = v_row.notify_off,
    digest_time = v_row.digest_time, quiet_from = v_row.quiet_from, quiet_to = v_row.quiet_to,
    work_days = v_row.work_days, meeting_minutes = v_row.meeting_minutes,
    reminder_minutes = v_row.reminder_minutes, meeting_link = v_row.meeting_link
   where id = p_staff_id;
  return jsonb_build_object('success', true, 'profile', public._csm_profile_json(p_staff_id));
exception when unique_violation then
  return jsonb_build_object('error', 'phone_taken');
end;
$$;

revoke all on function public.csm_profile_apply(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.csm_profile_apply(uuid, jsonb, boolean) to service_role;

-- מהאזור: היא בעצמה, לפי ה-JWT. מנהל/ת הפלטפורמה בלי שורה בצוות - לא.
create or replace function public.csm_profile_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.current_csm_id();
begin
  if v_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return public.csm_profile_apply(v_id, p, true);
end;
$$;

revoke all on function public.csm_profile_save(jsonb) from public, anon, authenticated;
grant execute on function public.csm_profile_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. היומן
-- ---------------------------------------------------------------------------
create table if not exists public.csm_agenda (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null default public.current_csm_id() references public.csm_staff(id) on delete cascade,
  agent_id          uuid references public.agency_members(id) on delete set null,
  kind              text not null default 'followup'
                    check (kind in ('first_win','followup','call','office_visit','training','other')),
  title             text check (title is null or char_length(title) <= 200),
  starts_at         timestamptz not null,
  duration_minutes  smallint not null default 45 check (duration_minutes between 5 and 600),
  location          text check (location is null or char_length(location) <= 300),
  meeting_url       text check (meeting_url is null or (char_length(meeting_url) <= 500 and meeting_url ~* '^https?://')),
  notes             text check (notes is null or char_length(notes) <= 4000),
  status            text not null default 'scheduled' check (status in ('scheduled','done','cancelled','no_show')),
  -- null = ברירת המחדל שלה (csm_staff.reminder_minutes); 0 = בלי תזכורת
  reminder_minutes  smallint check (reminder_minutes is null or reminder_minutes between 0 and 1440),
  reminded_at       timestamptz,
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists csm_agenda_staff_idx on public.csm_agenda (staff_id, starts_at);
create index if not exists csm_agenda_agent_idx on public.csm_agenda (agent_id, starts_at) where agent_id is not null;
create index if not exists csm_agenda_due_idx on public.csm_agenda (starts_at) where status = 'scheduled' and reminded_at is null;

comment on table public.csm_agenda is
  'היומן של צוות ההטמעה: פגישות עם סוכנים ומשרדים, שיחות מעקב והדרכות. תזכורת בפעמון ובוואטסאפ (csm_notify_run). docs/csm-adoption.md';

alter table public.csm_agenda enable row level security;
revoke all on table public.csm_agenda from anon;
grant select, insert, update, delete on table public.csm_agenda to authenticated, service_role;
drop policy if exists "csm team manages" on public.csm_agenda;
create policy "csm team manages" on public.csm_agenda for all to authenticated
  using (public.current_is_csm()) with check (public.current_is_csm());

-- מועד שזז - התזכורת חוזרת לתור
create or replace function public.csm_agenda_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.starts_at is distinct from old.starts_at
       or new.reminder_minutes is distinct from old.reminder_minutes
       or (new.status = 'scheduled' and old.status <> 'scheduled') then
      new.reminded_at := null;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists csm_agenda_before_write on public.csm_agenda;
create trigger csm_agenda_before_write before insert or update on public.csm_agenda
  for each row execute function public.csm_agenda_before_write();

-- פגישה עתידית עם סוכן/ת: מועד הקשר בצנרת = הפגישה, ומי שעוד "נרשם/ה" עובר/ת
-- ל"נקבעה פגישה". רק קדימה - מי שכבר בפיילוט נשאר/ת שם.
create or replace function public.csm_agenda_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agent_id is not null and new.status = 'scheduled' and new.starts_at > now()
     and new.kind in ('first_win','followup','call','office_visit')
     and (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at
          or new.agent_id is distinct from old.agent_id or new.status is distinct from old.status) then
    insert into public.csm_agent_stage (agent_id, stage, next_followup_at, updated_at, updated_by)
    values (new.agent_id, 'call_scheduled', new.starts_at, now(), auth.uid())
    on conflict (agent_id) do update
       set stage = case when public.csm_agent_stage.stage = 'registered' then 'call_scheduled'
                        else public.csm_agent_stage.stage end,
           next_followup_at = excluded.next_followup_at,
           updated_at = now(),
           updated_by = coalesce(excluded.updated_by, public.csm_agent_stage.updated_by);
  end if;
  return null;
end;
$$;

revoke all on function public.csm_agenda_after_write() from public, anon, authenticated;

drop trigger if exists csm_agenda_after_write on public.csm_agenda;
create trigger csm_agenda_after_write after insert or update on public.csm_agenda
  for each row execute function public.csm_agenda_after_write();

-- ---------------------------------------------------------------------------
-- 3. ההתראות
-- ---------------------------------------------------------------------------
create table if not exists public.csm_notifications (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.csm_staff(id) on delete cascade,
  kind        text not null check (kind in ('new_agent','at_risk','meeting_reminder','call_ready','daily_digest')),
  title       text not null check (char_length(title) <= 200),
  body        text check (body is null or char_length(body) <= 3000),
  agent_id    uuid references public.agency_members(id) on delete cascade,
  call_id     uuid references public.csm_calls(id) on delete cascade,
  event_id    uuid references public.csm_agenda(id) on delete cascade,
  dedupe_key  text,
  read_at     timestamptz,
  -- null = לא לוואטסאפ; skipped = הערוץ כבוי או אין נייד
  wa_state    text check (wa_state is null or wa_state in ('pending','sending','sent','failed','skipped')),
  wa_error    text,
  wa_sent_at  timestamptz,
  wa_claimed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (staff_id, dedupe_key)
);

create index if not exists csm_notifications_staff_idx on public.csm_notifications (staff_id, created_at desc);
create index if not exists csm_notifications_wa_idx on public.csm_notifications (created_at) where wa_state in ('pending','sending');

comment on table public.csm_notifications is
  'הפעמון של צוות ההטמעה. נכתב רק במסד (_csm_notify), והמשלוח לוואטסאפ ב-whatsapp-webhook?task=csm-notify. docs/csm-adoption.md';

alter table public.csm_notifications enable row level security;
revoke all on table public.csm_notifications from anon;
revoke insert, update, delete on table public.csm_notifications from authenticated;
grant select on table public.csm_notifications to authenticated;
grant select, insert, update, delete on table public.csm_notifications to service_role;
drop policy if exists "csm staff reads own notifications" on public.csm_notifications;
create policy "csm staff reads own notifications" on public.csm_notifications for select to authenticated
  using (staff_id = public.current_csm_id() or public.current_is_platform_admin());

-- סימון כנקרא: הכול (null), או רשימה. שלה בלבד.
create or replace function public.csm_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.current_csm_id();
  v_n  int;
begin
  if v_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.csm_notifications set read_at = now()
   where staff_id = v_id and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.csm_notifications_read(uuid[]) from public, anon, authenticated;
grant execute on function public.csm_notifications_read(uuid[]) to authenticated;

-- הכתיבה היחידה: סוג שכבוי - לא נכתב; וואטסאפ - רק כשהערוץ דלוק ויש נייד.
-- ‏dedupe_key הופך כל מקור לבטוח להרצה חוזרת.
create or replace function public._csm_notify(
  p_staff uuid, p_kind text, p_title text, p_body text,
  p_agent uuid default null, p_call uuid default null, p_event uuid default null, p_dedupe text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s  public.csm_staff%rowtype;
  v_id uuid;
begin
  select * into v_s from public.csm_staff where id = p_staff and active;
  if not found or p_kind = any(v_s.notify_off) then
    return null;
  end if;
  insert into public.csm_notifications (staff_id, kind, title, body, agent_id, call_id, event_id, dedupe_key, wa_state)
  values (p_staff, p_kind, left(p_title, 200), left(p_body, 3000), p_agent, p_call, p_event, p_dedupe,
          case when v_s.notify_whatsapp and v_s.phone_e164 is not null then 'pending' else 'skipped' end)
  on conflict (staff_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public._csm_notify(uuid, text, text, text, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public._csm_notify(uuid, text, text, text, uuid, uuid, uuid, text) to service_role;

-- הקלטה שהועלתה מהאזור הסתיימה (או נכשלה). מגבריאלה - לא: שם התשובה חוזרת
-- בשיחה עצמה.
create or replace function public.csm_calls_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'upload' and new.staff_id is not null
     and new.status in ('done','failed') and new.status is distinct from old.status then
    perform public._csm_notify(
      new.staff_id, 'call_ready',
      case when new.status = 'done' then 'ההקלטה מוכנה: ' else 'ההקלטה נכשלה: ' end || coalesce(new.title, 'שיחה'),
      case when new.status = 'done' then left(coalesce(new.analysis->>'summary', ''), 600)
           else coalesce(new.error, '') || ' אפשר לנסות שוב בלשונית "הקלטות".' end,
      new.agent_id, new.id, null, 'call:' || new.id || ':' || new.status);
  end if;
  return null;
end;
$$;

revoke all on function public.csm_calls_notify() from public, anon, authenticated;

drop trigger if exists csm_calls_notify on public.csm_calls;
create trigger csm_calls_notify after update of status on public.csm_calls
  for each row execute function public.csm_calls_notify();

-- ---------------------------------------------------------------------------
-- 4. המקורות: כל דקה
-- ---------------------------------------------------------------------------
-- מי בסיכון, בלי csm_agents_overview: היא דורשת current_is_csm() או
-- service_role דרך auth.role(), וב-pg_cron אין אף אחד מהם. אותה הגדרה של
-- csmRisk ב-assets/crm-csm.js: לא עצמאי/ת, הצטרף/ה לפני 5 ימים ומעלה, ו-5
-- ימים ומעלה בלי הודעה לגבריאלה.
create or replace function public._csm_risk_agents()
returns table (agent_id uuid, display_name text, agency_name text, phone text, joined_at timestamptz, last_in timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.display_name, a.name, coalesce(m.phone, m.phone_e164), m.created_at, w.last_in
    from public.agency_members m
    left join public.agencies a on a.id = m.agency_id
    left join public.csm_agent_stage s on s.agent_id = m.id
    left join lateral (
      select max(x.created_at) as last_in from public.whatsapp_messages x
       where x.agent_id = m.id and x.direction = 'in' and x.created_at > now() - interval '120 days'
    ) w on true
   where m.active = true and m.closed_at is null and coalesce(m.is_platform_admin, false) = false
     and coalesce(s.stage, 'registered') <> 'champion'
     and m.created_at <= now() - interval '5 days'
     and (w.last_in is null or w.last_in <= now() - interval '5 days');
$$;

revoke all on function public._csm_risk_agents() from public, anon, authenticated;
grant execute on function public._csm_risk_agents() to service_role;

create or replace function public._csm_hhmm(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'Asia/Jerusalem', 'HH24:MI');
$$;

revoke all on function public._csm_hhmm(timestamptz) from public, anon, authenticated;
grant execute on function public._csm_hhmm(timestamptz) to service_role;

create or replace function public.csm_notify_run()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n      int := 0;
  v_now    timestamptz := now();
  v_local  timestamp := now() at time zone 'Asia/Jerusalem';
  v_today  date := (now() at time zone 'Asia/Jerusalem')::date;
  e        record;
  s        record;
  r        record;
  v_lines  text;
  v_cnt    int;
  v_body   text;
begin
  -- א. תזכורת לפני פגישה
  for e in
    select g.*, st.reminder_minutes as staff_reminder, m.display_name as agent_name,
           ag.name as agency_name, coalesce(m.phone, m.phone_e164) as agent_phone
      from public.csm_agenda g
      join public.csm_staff st on st.id = g.staff_id and st.active
      left join public.agency_members m on m.id = g.agent_id
      left join public.agencies ag on ag.id = m.agency_id
     where g.status = 'scheduled' and g.reminded_at is null
       and g.starts_at > v_now
       and coalesce(g.reminder_minutes, st.reminder_minutes) > 0
       and g.starts_at - make_interval(mins => coalesce(g.reminder_minutes, st.reminder_minutes)) <= v_now
     for update of g skip locked
  loop
    update public.csm_agenda set reminded_at = v_now where id = e.id;
    if public._csm_notify(
         e.staff_id, 'meeting_reminder',
         'ב-' || public._csm_hhmm(e.starts_at) || ': ' || coalesce(nullif(e.title, ''), e.agent_name, 'פגישה'),
         concat_ws(E'\n',
           case when e.agent_name is not null then 'עם ' || e.agent_name || coalesce(' (' || e.agency_name || ')', '') end,
           case when e.agent_phone is not null then 'טלפון: ' || e.agent_phone end,
           case when e.location is not null then 'איפה: ' || e.location end,
           case when e.meeting_url is not null then 'קישור: ' || e.meeting_url end,
           case when e.notes is not null then left(e.notes, 400) end),
         e.agent_id, null, e.id, 'mtg:' || e.id || ':' || extract(epoch from e.starts_at)::bigint) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- ב. סוכן/ת חדש/ה ומי שעבר/ה עכשיו את 5 הימים - כל 5 דקות, לכל הצוות.
  -- ‏"עכשיו" = בתוך היום שאחרי החצייה, כך שבהרצה הראשונה לא יוצף הפעמון
  -- בכל מי שכבר היה בסיכון לפני כן (הם בסיכום הבוקר).
  if extract(minute from v_now)::int % 5 = 0 then
    for r in
      select m.id, m.display_name, a.name as agency_name, coalesce(m.phone, m.phone_e164) as phone, m.role
        from public.agency_members m
        left join public.agencies a on a.id = m.agency_id
       where m.created_at > v_now - interval '1 day'
         and m.active = true and m.closed_at is null and coalesce(m.is_platform_admin, false) = false
    loop
      for s in select id from public.csm_staff where active loop
        if public._csm_notify(s.id, 'new_agent',
             'נרשם/ה: ' || coalesce(r.display_name, 'סוכן/ת חדש/ה'),
             concat_ws(E'\n',
               coalesce(r.agency_name, 'בלי משרד') || case when r.role = 'manager' then ' · מנהל/ת משרד' else '' end,
               case when r.phone is not null then 'טלפון: ' || r.phone end,
               'כדאי לקבוע פגישת הצלחה ראשונה בימים הקרובים.'),
             r.id, null, null, 'new:' || r.id) is not null then
          v_n := v_n + 1;
        end if;
      end loop;
    end loop;

    for r in
      select * from public._csm_risk_agents() k
       where coalesce(k.last_in, k.joined_at) > v_now - interval '6 days'
    loop
      for s in select id from public.csm_staff where active loop
        if public._csm_notify(s.id, 'at_risk',
             coalesce(r.display_name, 'סוכן/ת') || ': 5 ימים בלי גבריאלה',
             concat_ws(E'\n',
               r.agency_name,
               case when r.last_in is null then 'עוד לא כתב/ה לגבריאלה מאז ההרשמה.' end,
               case when r.phone is not null then 'טלפון: ' || r.phone end),
             r.agent_id, null, null, 'risk:' || r.agent_id || ':' || coalesce(r.last_in::date::text, 'never')) is not null then
          v_n := v_n + 1;
        end if;
      end loop;
    end loop;
  end if;

  -- ג. סיכום הבוקר: בשעה שבחרה, בימי העבודה שלה, פעם ביום, ועד שלוש שעות
  -- אחרי (פריסה בצהריים לא שולחת סיכום "בוקר" בערב)
  for s in
    select st.* from public.csm_staff st
     where st.active and not ('daily_digest' = any(st.notify_off))
       and st.last_digest_on is distinct from v_today
       and extract(dow from v_local)::smallint = any(st.work_days)
       and v_local >= v_today + st.digest_time
       and v_local <  v_today + st.digest_time + interval '3 hours'
     for update of st skip locked
  loop
    update public.csm_staff set last_digest_on = v_today where id = s.id;
    v_body := '';

    select count(*), string_agg(public._csm_hhmm(g.starts_at) || ' ' ||
             coalesce(nullif(g.title, ''), m.display_name, 'פגישה'), E'\n' order by g.starts_at)
      into v_cnt, v_lines
      from public.csm_agenda g
      left join public.agency_members m on m.id = g.agent_id
     where g.staff_id = s.id and g.status = 'scheduled'
       and (g.starts_at at time zone 'Asia/Jerusalem')::date = v_today;
    if v_cnt > 0 then
      v_body := v_body || 'פגישות היום (' || v_cnt || '):' || E'\n' || v_lines || E'\n\n';
    end if;

    select count(*), string_agg(coalesce(m.display_name, 'סוכן/ת'), ', ' order by st2.next_followup_at)
      into v_cnt, v_lines
      from public.csm_agent_stage st2
      join public.agency_members m on m.id = st2.agent_id and m.active and m.closed_at is null
     where (st2.next_followup_at at time zone 'Asia/Jerusalem')::date <= v_today
       and st2.stage <> 'champion'
       and not exists (select 1 from public.csm_agenda g2
                        where g2.agent_id = st2.agent_id and g2.status = 'scheduled'
                          and (g2.starts_at at time zone 'Asia/Jerusalem')::date = v_today);
    if v_cnt > 0 then
      v_body := v_body || 'לחזור היום (' || v_cnt || '): ' || left(v_lines, 500) || E'\n\n';
    end if;

    select count(*) into v_cnt from public._csm_risk_agents();
    if v_cnt > 0 then
      v_body := v_body || 'בסיכון - 5 ימים ומעלה בלי גבריאלה: ' || v_cnt || E'\n';
    end if;

    select count(*) into v_cnt from public.agency_members m
     where m.created_at > v_now - interval '1 day' and m.active and coalesce(m.is_platform_admin, false) = false;
    if v_cnt > 0 then
      v_body := v_body || 'נרשמו ב-24 השעות האחרונות: ' || v_cnt || E'\n';
    end if;

    if v_body <> '' then
      if public._csm_notify(s.id, 'daily_digest', 'הבוקר שלך באזור ההטמעה', btrim(v_body, E'\n'),
           null, null, null, 'digest:' || v_today) is not null then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.csm_notify_run() from public, anon, authenticated;
grant execute on function public.csm_notify_run() to service_role;

comment on function public.csm_notify_run() is
  'התראות צוות ההטמעה: תזכורת לפגישה, סוכן/ת חדש/ה, מי שעבר/ה 5 ימים בלי גבריאלה, וסיכום הבוקר. pg_cron כל דקה (csm-notify). docs/csm-adoption.md';

-- ---------------------------------------------------------------------------
-- 5. המשלוח לוואטסאפ (whatsapp-webhook?task=csm-notify, ‏csm-notify.ts)
-- ---------------------------------------------------------------------------
create or replace function public.csm_notify_wa_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.csm_notifications n
      join public.csm_staff s on s.id = n.staff_id and s.active
     where n.wa_state = 'pending' and n.created_at > now() - interval '18 hours'
       and (n.kind = 'meeting_reminder' or not public._csm_in_quiet(s.quiet_from, s.quiet_to)));
$$;

revoke all on function public.csm_notify_wa_ready() from public, anon, authenticated;
grant execute on function public.csm_notify_wa_ready() to service_role;

-- תופסת עד p_limit לשליחה. שעות השקט שלה דוחות (לא מבטלות), חוץ מתזכורת
-- לפגישה שלה. מה שחיכה יותר מ-18 שעות - כבר לא רלוונטי, ונשאר בפעמון בלבד.
create or replace function public.csm_notify_wa_claim(p_limit int default 20)
returns table (id uuid, staff_id uuid, phone_e164 text, display_name text, kind text,
               title text, body text, in_window boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.csm_notifications n set wa_state = 'skipped', wa_error = 'stale'
   where n.wa_state = 'pending' and n.created_at <= now() - interval '18 hours';
  update public.csm_notifications n set wa_state = 'pending'
   where n.wa_state = 'sending' and n.wa_claimed_at < now() - interval '10 minutes';

  return query
  with picked as (
    select n.id from public.csm_notifications n
      join public.csm_staff s on s.id = n.staff_id and s.active
     where n.wa_state = 'pending'
       and (n.kind = 'meeting_reminder' or not public._csm_in_quiet(s.quiet_from, s.quiet_to))
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update of n skip locked
  ), upd as (
    update public.csm_notifications n set wa_state = 'sending', wa_claimed_at = now()
      from picked where n.id = picked.id
    returning n.*
  )
  select u.id, u.staff_id, s.phone_e164, s.display_name, u.kind, u.title, u.body,
         coalesce(c.last_inbound_at > now() - interval '23 hours', false)
    from upd u
    join public.csm_staff s on s.id = u.staff_id
    left join public.csm_whatsapp_conversations c on c.staff_id = u.staff_id
   order by u.created_at;
end;
$$;

revoke all on function public.csm_notify_wa_claim(int) from public, anon, authenticated;
grant execute on function public.csm_notify_wa_claim(int) to service_role;

create or replace function public.csm_notify_wa_mark(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.csm_notifications
     set wa_state = case when p_ok then 'sent' else 'failed' end,
         wa_sent_at = case when p_ok then now() end,
         wa_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and wa_state = 'sending';
$$;

revoke all on function public.csm_notify_wa_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.csm_notify_wa_mark(uuid, boolean, text) to service_role;

-- כל דקה: המקורות במסד, ואז הערה ל-whatsapp-webhook רק כשיש מה לשלוח
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=csm-notify';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - התראות צוות ההטמעה לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('csm-notify')
    where exists (select 1 from cron.job where jobname = 'csm-notify');

  perform cron.schedule('csm-notify', '* * * * *', format($cron$
    select public.csm_notify_run();
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    )
    where public.csm_notify_wa_ready();
  $cron$, v_url));
end;
$$;
