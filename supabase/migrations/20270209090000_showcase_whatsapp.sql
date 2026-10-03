-- ============================================================================
-- המיניסייט: וואטסאפ ללקוח/ה כשהסוכן/ת עונה או מחליט/ה על סיור
--
-- ## מה חסר
--
-- הלקוח/ה שואל/ת על נכס או מבקש/ת סיור במיניסייט (‏20270208090000), והסוכן/ת
-- עונה מה-CRM. התשובה נשמרה ב-`client_showcase_messages` וחיכתה שם - עד
-- שהלקוח/ה יחזור/תחזור לעמוד מעצמו/ה. "אישרתי את הסיור מחר ב-10" שלא הגיע
-- הוא סיור שלא קורה.
--
-- ## מה נכנס
--
-- תור על שורת המיניסייט, ולא שליחה מהטריגר:
--
--   ‏· טריגר על תשובה של הסוכן/ת (`author = 'agent'`) ועל החלטה על סיור
--     (`requested` → `confirmed` / `declined`) מסמן `wa_pending_at` ומוסיף את
--     הסוג ל-`wa_pending_kinds`.
--   ‏· ‏cron כל חמש דקות קורא ל-`client-showcase` (‏`action = wa_notify`), רק
--     כש-`showcase_wa_ready()` אומרת שיש מה לשלוח.
--
-- ## שלוש החלטות
--
-- **1. הודעה אחת לכל רצף.** סוכן/ת שעונה על ארבע שאלות ברצף שולח/ת ארבע
-- הודעות במיניסייט ו**אחת** בוואטסאפ: התור מתמלא, ה-cron שולח פעם אחת, ובין
-- שתי הודעות לאותו מיניסייט עוברות לפחות 30 דקות. חמש הודעות מספר שהלקוח/ה
-- אינו/ה מכיר/ה הן הדרך המהירה לחסימה - ולחסימה מחיר אצל כל הנמענים.
--
-- **2. מה שנקרא לא נשלח.** לקוח/ה שפתח/ה את העמוד אחרי שהתור התמלא כבר ראה/תה
-- את התשובה. ה-Edge Function מנקה את התור בלי לשלוח.
--
-- **3. שעות שקט 22:00-08:00 (שעון ישראל).** הודעה שהתור צבר בלילה יוצאת
-- בבוקר, מקובצת. זה המקור לכך שהשליחה ב-cron ולא בטריגר: טריגר אינו יכול
-- לחכות.
--
-- ‏`wa_notify` הוא הבחירה של הלקוח/ה (מתג בעמוד), וגם מה שנכבה כש-Meta מחזירה
-- 131050 - הנמען/ת ביקש/ה להפסיק לקבל הודעות מהעסק.
--
-- תלויות: `client_showcases`, `client_showcase_messages`,
-- ‏`client_showcase_meetings`, ‏pg_cron + pg_net + vault (‏`alert_cron_secret`).
-- הפרטים: docs/client-showcase.md. הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. התור והמצב על שורת המיניסייט
-- ---------------------------------------------------------------------------
alter table public.client_showcases add column if not exists wa_notify boolean not null default true;
alter table public.client_showcases add column if not exists wa_pending_at timestamptz;
alter table public.client_showcases add column if not exists wa_pending_kinds text[] not null default '{}';
alter table public.client_showcases add column if not exists wa_last_sent_at timestamptz;
alter table public.client_showcases add column if not exists wa_last_status text;
alter table public.client_showcases add column if not exists wa_last_error text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_showcases_wa_last_status_check') then
    alter table public.client_showcases add constraint client_showcases_wa_last_status_check
      check (wa_last_status is null or wa_last_status in
        ('sent','failed','no_channel','no_phone','opted_out','seen'));
  end if;
end $$;

comment on column public.client_showcases.wa_notify is
  'הלקוח/ה מקבל/ת וואטסאפ על תשובה או החלטה על סיור. מתג בעמוד; נכבה גם כש-Meta מחזירה 131050.';
comment on column public.client_showcases.wa_pending_at is
  'יש מה לשלוח מאז. null = התור ריק. נכתב בטריגר, נמחק ב-client-showcase (wa_notify).';
comment on column public.client_showcases.wa_last_status is
  'sent / failed / no_channel (אין תבנית ומחוץ לחלון 24 השעות) / no_phone / opted_out / seen (נקרא לפני שנשלח).';

-- ‏partial index - התור קטן, והשאילתה של ה-cron רצה כל חמש דקות
create index if not exists client_showcases_wa_pending
  on public.client_showcases (wa_pending_at) where wa_pending_at is not null;

-- ---------------------------------------------------------------------------
-- 2. הטריגרים שממלאים את התור
-- ---------------------------------------------------------------------------
create or replace function public.showcase_queue_wa(p_showcase_id uuid, p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.client_showcases
     set wa_pending_at = coalesce(wa_pending_at, now()),
         wa_pending_kinds = case when p_kind = any (wa_pending_kinds)
                                 then wa_pending_kinds else wa_pending_kinds || p_kind end
   where id = p_showcase_id and status = 'active' and wa_notify;
$$;

comment on function public.showcase_queue_wa(uuid, text) is
  'מסמן/ת שיש וואטסאפ לשלוח ללקוח/ה במיניסייט. נקראת מהטריגרים בלבד.';

revoke all on function public.showcase_queue_wa(uuid, text) from public, anon, authenticated;
grant execute on function public.showcase_queue_wa(uuid, text) to service_role;

create or replace function public.client_showcase_messages_queue_wa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author = 'agent' then
    perform public.showcase_queue_wa(new.showcase_id, 'reply');
  end if;
  return new;
end;
$$;

drop trigger if exists client_showcase_messages_queue_wa on public.client_showcase_messages;
create trigger client_showcase_messages_queue_wa
  after insert on public.client_showcase_messages
  for each row execute function public.client_showcase_messages_queue_wa();

create or replace function public.client_showcase_meetings_queue_wa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- רק החלטה של הסוכן/ת. ביטול (`canceled`) מגיע מהלקוח/ה עצמו/ה.
  if new.status in ('confirmed','declined') and new.status is distinct from old.status then
    perform public.showcase_queue_wa(new.showcase_id,
      case when new.status = 'confirmed' then 'meeting_confirmed' else 'meeting_declined' end);
  end if;
  return new;
end;
$$;

drop trigger if exists client_showcase_meetings_queue_wa on public.client_showcase_meetings;
create trigger client_showcase_meetings_queue_wa
  after update of status on public.client_showcase_meetings
  for each row execute function public.client_showcase_meetings_queue_wa();

-- פונקציות טריגר אינן נקראות דרך PostgREST, אבל הן `security definer` -
-- ולכן גם אותן סוגרים לכולם (‏check_function_grants).
revoke all on function public.client_showcase_messages_queue_wa() from public, anon, authenticated;
revoke all on function public.client_showcase_meetings_queue_wa() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. האם יש מה לשלוח עכשיו - מה שה-cron בודק לפני net.http_post
-- ---------------------------------------------------------------------------
create or replace function public.showcase_wa_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(hour from (now() at time zone 'Asia/Jerusalem'))::int between 8 and 21
     and exists (
       select 1 from public.client_showcases
        where wa_pending_at is not null
          and status = 'active'
          and wa_notify
          and (wa_last_sent_at is null or wa_last_sent_at < now() - interval '30 minutes'));
$$;

comment on function public.showcase_wa_ready() is
  'האם יש וואטסאפ למיניסייט שממתין ומותר לשלוח עכשיו (08:00-22:00, 30 דקות מהקודם). נקראת מה-cron.';

revoke all on function public.showcase_wa_ready() from public, anon, authenticated;
grant execute on function public.showcase_wa_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 4. התזמון - כל חמש דקות, ורק כשיש מה לשלוח. אידמפוטנטי.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/client-showcase';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - הוואטסאפ של המיניסייט לא תוזמן';
    return;
  end if;

  perform cron.unschedule('showcase-wa')
    where exists (select 1 from cron.job where jobname = 'showcase-wa');

  perform cron.schedule('showcase-wa', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      body := '{"action":"wa_notify"}'::jsonb,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where public.showcase_wa_ready();
  $cron$, v_url));
end;
$$;
