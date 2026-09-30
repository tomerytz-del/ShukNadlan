-- ---------------------------------------------------------------------------
-- יומן שיחות: מספר וירטואלי לסוכן/ת, הקלטה, תמלול וסיכום (פיילוט Twilio)
--
-- דפדפן אינו רואה את יומן השיחות של הטלפון בשום מכשיר, ולכן הדרך היחידה
-- ליומן אמיתי היא שהשיחה תעבור דרכנו: לקוח/ה מתקשר/ת למספר של Twilio,
-- השיחה מנותבת לנייד של הסוכן/ת ומוקלטת, ובסופה Twilio מדווחת לפונקציה
-- `twilio-voice`. היא מתמללת (Whisper), מסכמת (Claude), שומרת כאן, ושולחת
-- לסוכן/ת בוואטסאפ את הסיכום ואת ההקלטה. docs/call-tracking.md.
--
-- שלושה דברים נכנסים:
--
--   1. ‏agent_phone_lines — איזה מספר של Twilio שייך לאיזה/ו סוכן/ת, ולאן
--      לנתב. **אין כאן ממשק הקצאה**: בפיילוט השורה נכתבת בידי מנהל/ת
--      הפלטפורמה. מספר בלי שורה פעילה עונה בהודעה ומנתק - הוא לעולם אינו
--      "נופל" לסוכן/ת אחר/ת.
--   2. ‏agent_calls — שורה לכל שיחה. הסוכן/ת רואה רק את שלו/ה (אותו RLS
--      צר של agent_clients). הכתיבה רק מהפונקציה, ב-service_role.
--   3. ‏דלי call-recordings — פרטי. הסוכן/ת קורא/ת רק מתיקייה ששמה
--      ה-agent_id שלו/ה (בשביל נגן ב-CRM בקישור חתום). ‏**90 יום** ואז
--      מחיקה - cron יומי שקורא לפונקציה, כי מחיקת שורה מ-storage.objects
--      ב-SQL משאירה את הקובץ עצמו יתום.
-- ---------------------------------------------------------------------------

create table if not exists public.agent_phone_lines (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agency_members(id) on delete cascade,
  -- המספר של Twilio, בפורמט E.164 (‏+9724…). כך הוא מגיע ב-`To` של הוובהוק.
  twilio_number text not null unique,
  -- לאן לנתב, E.164. ‏null = הטלפון של הסוכן/ת ב-agency_members.
  forward_to    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.agent_phone_lines is
  'מספר Twilio של סוכן/ת (יומן שיחות). נכתב בידי מנהל/ת הפלטפורמה בלבד. docs/call-tracking.md';

alter table public.agent_phone_lines enable row level security;

drop policy if exists "agent reads own phone lines" on public.agent_phone_lines;
create policy "agent reads own phone lines"
  on public.agent_phone_lines for select to authenticated
  using (agent_id = public.current_agent_id());

create table if not exists public.agent_calls (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references public.agency_members(id) on delete cascade,
  line_id            uuid references public.agent_phone_lines(id) on delete set null,
  twilio_call_sid    text not null unique,
  direction          text not null default 'inbound',
  from_number        text,
  to_number          text,
  -- הלקוח/ה שזוהה/תה לפי תשע הספרות האחרונות, כמו בדיקת הכפילות בקובץ.
  client_id          uuid references public.agent_clients(id) on delete set null,
  -- ringing → answered | missed | busy | failed
  status             text not null default 'ringing',
  duration_sec       integer,
  recording_sid      text,
  recording_path     text,
  recording_duration integer,
  transcript         text,
  summary            text,
  -- מה שהמודל חילץ: דרישות (עיר, חדרים, תקציב), שם אם נאמר, והמלצה להמשך.
  extracted          jsonb,
  processed_at       timestamptz,
  notified_at        timestamptz,
  error              text,
  created_at         timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_calls_status_check') then
    alter table public.agent_calls add constraint agent_calls_status_check
      check (status in ('ringing','answered','missed','busy','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_calls_direction_check') then
    alter table public.agent_calls add constraint agent_calls_direction_check
      check (direction in ('inbound','outbound'));
  end if;
end $$;

create index if not exists agent_calls_agent_idx  on public.agent_calls (agent_id, created_at desc);
create index if not exists agent_calls_client_idx on public.agent_calls (client_id) where client_id is not null;
-- הסריקה של ה-cron: רק שורות שעוד מחזיקות הקלטה
create index if not exists agent_calls_recording_idx
  on public.agent_calls (created_at) where recording_path is not null;

comment on table public.agent_calls is
  'יומן שיחות (Twilio): שורה לכל שיחה, עם תמלול וסיכום. ההקלטה נמחקת אחרי 90 יום. docs/call-tracking.md';

alter table public.agent_calls enable row level security;

drop policy if exists "agent reads own calls" on public.agent_calls;
create policy "agent reads own calls"
  on public.agent_calls for select to authenticated
  using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- הדלי. ‏audio בלבד, ועד 50MB - שיחה של כשעה ב-mp3 של Twilio.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-recordings', 'call-recordings', false, 52428800,
        array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- קריאה בלבד, ורק מהתיקייה של הסוכן/ת עצמו/ה. אין policy של כתיבה או
-- מחיקה: אלה נעשות מהפונקציה ב-service_role.
drop policy if exists "agent reads own call recordings" on storage.objects;
create policy "agent reads own call recordings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = public.current_agent_id()::text
  );

-- ---------------------------------------------------------------------------
-- המחיקה אחרי 90 יום. יומי, ומותנה: בלי הקלטה ישנה אין קריאה בכלל.
-- ---------------------------------------------------------------------------
create or replace function public.call_recordings_expired_pending()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.agent_calls
     where recording_path is not null
       and created_at < now() - interval '90 days'
  );
$$;

revoke all on function public.call_recordings_expired_pending() from public, anon, authenticated;
grant execute on function public.call_recordings_expired_pending() to service_role;

do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/twilio-voice?task=cleanup';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('call-recordings-cleanup')
    where exists (select 1 from cron.job where jobname = 'call-recordings-cleanup');

  perform cron.schedule('call-recordings-cleanup', '41 3 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 60000
    )
    where public.call_recordings_expired_pending()
  $cron$, v_url));
end $$;
