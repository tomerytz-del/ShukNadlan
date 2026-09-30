-- ============================================================================
-- קליטה מהמייל: סוכן/ת מעביר/ה מייל, והעוזר האישי מטפל בו ועונה בוואטסאפ.
--
-- לכל סוכן/ת כתובת אישית בתיבת הפלטפורמה — ‏`shuknadlan+<token>@gmail.com`.
-- ‏Gmail מוסר כל כתובת עם `+` לאותה תיבה, ולכן אין כאן ספק חדש, DNS או MX:
-- הפונקציה `whatsapp-webhook` (‏?task=email-intake) קוראת את התיבה ב-IMAP
-- כל שתי דקות, מזהה את הסוכן/ת לפי הטוקן שבכתובת, ומעבירה את המייל לאותו
-- עוזר שמדבר איתו/ה בוואטסאפ. **שום תשובה לא יוצאת במייל.**
--
-- ‏**למה טוקן ולא כתובת השולח.** ה-From של מייל הוא טקסט שכל אחד כותב, ומי
-- שמגדיר/ה העברה אוטומטית (לידים מיד2, מאתר המשרד) מעביר/ה מיילים שה-From
-- שלהם הוא הפונה ולא הסוכן/ת. הטוקן הוא הדבר היחיד שמעיד בשם מי המייל הגיע.
--
-- ‏**למה טבלה נפרדת ולא עמודה ב-agency_members.** השורה של הסוכן/ת נקראת
-- ממקומות רבים (חברי המשרד, מנהל/ת הפלטפורמה), והטוקן הוא סוד: מי שמחזיק
-- בו מכניס לקוחות לקובץ של מישהו אחר. כאן הוא נקרא רק דרך הפונקציות למטה.
--
-- הפרטים: docs/email-intake.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הכתובת של כל סוכן/ת
-- ---------------------------------------------------------------------------
create table if not exists public.agent_email_intake (
  agent_id   uuid primary key references public.agency_members(id) on delete cascade,
  token      text not null unique check (token ~ '^[a-z0-9]{12}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

comment on table public.agent_email_intake is
  'הטוקן בכתובת הקליטה האישית (shuknadlan+<token>@gmail.com). נקרא ונכתב רק דרך email_intake_address / email_intake_rotate ומהשרת.';

alter table public.agent_email_intake enable row level security;
-- בלי מדיניות: הדפדפן מגיע לכאן רק דרך הפונקציות, שבודקות מי הקורא.
revoke all on table public.agent_email_intake from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. יומן המיילים שנקלטו
--
-- ‏(mailbox, uidvalidity, uid) הוא מפתח ה-claim: שתי הרצות חופפות של ה-cron
-- רואות את אותם מיילים, ורק זו שהכניסה את השורה מטפלת. בלי זה אותו לקוח
-- היה נוסף פעמיים — בדיוק מה ש-`whatsapp_messages.wa_message_id` מונע בוואטסאפ.
-- ---------------------------------------------------------------------------
create table if not exists public.email_intake_messages (
  id           bigint generated always as identity primary key,
  mailbox      text not null,
  uidvalidity  bigint not null,
  uid          bigint not null,
  agent_id     uuid references public.agency_members(id) on delete set null,
  message_id   text,
  from_addr    text,
  subject      text,
  status       text not null default 'processing'
               check (status in ('processing', 'done', 'failed', 'skipped')),
  detail       text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  unique (mailbox, uidvalidity, uid)
);

create index if not exists email_intake_messages_agent_idx
  on public.email_intake_messages (agent_id, created_at desc);

comment on table public.email_intake_messages is
  'מייל אחד שהגיע לכתובת קליטה של סוכן/ת, ומה נעשה בו. נכתב רק מ-whatsapp-webhook (service_role).';

alter table public.email_intake_messages enable row level security;
revoke all on table public.email_intake_messages from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. הסמן בתיבה
--
-- ה-UID האחרון שנבדק. התיבה היא תיבת הפלטפורמה ויש בה גם מייל שאינו שלנו,
-- ולכן לא מסמנים בה כלום (‏EXAMINE — קריאה בלבד) ולא מחפשים "לא נקרא": הסמן
-- הוא מה שמבדיל בין חדש לישן.
-- ---------------------------------------------------------------------------
create table if not exists public.email_intake_cursor (
  mailbox     text primary key,
  uidvalidity bigint not null,
  last_uid    bigint not null,
  updated_at  timestamptz not null default now()
);

alter table public.email_intake_cursor enable row level security;
revoke all on table public.email_intake_cursor from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. הכתובת — נוצרת בפעם הראשונה שמבקשים אותה
--
-- התיבה קבועה כאן ולא בסוד של הפונקציה, כי הדפדפן צריך להציג את הכתובת.
-- מי שמחליף/ה תיבה (INTAKE_IMAP_USER) מחליף/ה גם את השורה הזו.
-- ---------------------------------------------------------------------------
create or replace function public.email_intake_address()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  v_token text;
begin
  select id into v_agent
    from public.agency_members
   where user_id = (select auth.uid())
   limit 1;
  if v_agent is null then
    raise exception 'not_an_agent' using errcode = '42501';
  end if;

  select token into v_token from public.agent_email_intake where agent_id = v_agent;
  if v_token is null then
    insert into public.agent_email_intake (agent_id, token)
    values (v_agent, substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    on conflict (agent_id) do nothing;
    select token into v_token from public.agent_email_intake where agent_id = v_agent;
  end if;

  return 'shuknadlan+' || v_token || '@gmail.com';
end;
$$;

comment on function public.email_intake_address() is
  'כתובת הקליטה האישית של הסוכן/ת המחובר/ת. יוצרת טוקן בקריאה הראשונה.';

revoke all on function public.email_intake_address() from public, anon, authenticated;
grant execute on function public.email_intake_address() to authenticated, service_role;

-- החלפה: כתובת שדלפה (למשל נשלחה בטעות ללקוח/ה ב-CC) מפסיקה לעבוד מיד.
create or replace function public.email_intake_rotate()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  v_token text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  select id into v_agent
    from public.agency_members
   where user_id = (select auth.uid())
   limit 1;
  if v_agent is null then
    raise exception 'not_an_agent' using errcode = '42501';
  end if;

  insert into public.agent_email_intake (agent_id, token)
  values (v_agent, v_token)
  on conflict (agent_id) do update
    set token = excluded.token, rotated_at = now();

  return 'shuknadlan+' || v_token || '@gmail.com';
end;
$$;

comment on function public.email_intake_rotate() is
  'מחליפה את כתובת הקליטה של הסוכן/ת המחובר/ת. הכתובת הקודמת מפסיקה לעבוד מיד.';

revoke all on function public.email_intake_rotate() from public, anon, authenticated;
grant execute on function public.email_intake_rotate() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. התזמון
--
-- כל שתי דקות, ורק מרגע שלסוכן/ת אחד/ת לפחות יש כתובת — עד אז אין מה
-- לקרוא. הפונקציה עונה 202 מיד וממשיכה ברקע, ולכן 5 שניות מספיקות ל-pg_net.
--
-- אידמפוטנטי: unschedule לפני schedule.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=email-intake';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — קליטת המייל לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('email-intake')
    where exists (select 1 from cron.job where jobname = 'email-intake');

  perform cron.schedule('email-intake', '*/2 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    )
    where exists (select 1 from public.agent_email_intake);
  $cron$, v_url));
end;
$$;
