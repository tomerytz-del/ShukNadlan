-- תור לשאלה תפעולית, כדי ששליחה חד-פעמית לא תדרוש מפתח service_role
-- מחוץ לשרת.
--
-- מי שמוסיף שורה הוא עורך ה-SQL (התפקיד postgres, בעל הטבלה, עוקף RLS).
-- pg_cron מרוקן אותה אל whatsapp-webhook?task=ops-question-drain עם
-- x-alert-cron-secret מ-Vault, אותו סוד של שאר המשימות. אין סוד חדש.
-- הריקון קורא ל-runOpsQuestion: רשימה סגורה, סוכן מאושר, חלון 24 שעות,
-- שעות שקט ושבת, מסלול ותקרות. הייחוד (purpose, agent_member_id) מונע
-- שליחה שנייה של אותה הודעה לאותו סוכן.
--
-- השורה אינה נכנסת כאן. מיזוג שמכניס שורה היה שולח ברגע שהפונקציה באוויר.
-- ההוספה היא insert מעורך ה-SQL, אחרי שהמיגרציה והפונקציה עלו.
-- docs/whatsapp-setup.md

create table if not exists public.ops_question_queue (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  agent_member_id uuid not null references public.agency_members (id),
  status text not null default 'pending',
  reason text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint ops_question_queue_purpose_agent_uniq unique (purpose, agent_member_id),
  constraint ops_question_queue_status_chk check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint ops_question_queue_purpose_chk check (purpose ~ '^[A-Za-z0-9_-]{1,40}$')
);

comment on table public.ops_question_queue is
  'תור לשאלה תפעולית. מוסיפים שורה מעורך ה-SQL (postgres). pg_cron מרוקן בלי מפתח service_role אצל המבקש. שורה אחת לכל purpose וסוכן. docs/whatsapp-setup.md';

comment on column public.ops_question_queue.agent_member_id is
  'agency_members.id, לא user_id. זה המזהה ש-allowedAgentIds ו-whatsapp_ops_questions.agent_id מצפים לו.';

create index if not exists ops_question_queue_due_idx
  on public.ops_question_queue (created_at)
  where status in ('pending', 'failed');

alter table public.ops_question_queue enable row level security;

revoke all on table public.ops_question_queue from public, anon, authenticated;
grant select, insert, update on table public.ops_question_queue to service_role;

-- אין policy. anon ו-authenticated בלי grant ובלי policy. postgres עוקף
-- כבעל הטבלה (עורך ה-SQL). service_role עוקף RLS ב-Supabase וצריך את
-- ה-grant כדי לקרוא ולעדכן מהפונקציה. אין FORCE, כדי שהבעלים יוכל להוסיף.

-- ---------------------------------------------------------------------------
-- התור לא ריק: pending, או failed שהריקון מנסה שוב (send_failed,
-- in_progress, db_error). partial_sent אינו כאן.
-- ---------------------------------------------------------------------------
create or replace function public.ops_question_queue_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ops_question_queue q
     where q.status = 'pending'
        or (q.status = 'failed' and q.reason in ('send_failed', 'in_progress', 'db_error'))
  );
$$;

comment on function public.ops_question_queue_ready() is
  'יש שורת תור שהריקון צריך לגעת בה. התנאי של cron ops-question-drain.';

revoke all on function public.ops_question_queue_ready() from public, anon, authenticated;
grant execute on function public.ops_question_queue_ready() to service_role;

-- כל חמש דקות, ורק כשיש מה לרוקן. 30 שניות ולא 5: השליחה סינכרונית,
-- בניגוד למשימות שחוזרות 202 וממשיכות ברקע.
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=ops-question-drain';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - ריקון שאלות תפעוליות לא תוזמן';
    return;
  end if;

  perform cron.unschedule('ops-question-drain')
    where exists (select 1 from cron.job where jobname = 'ops-question-drain');

  perform cron.schedule('ops-question-drain', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where public.ops_question_queue_ready();
  $cron$, v_url));
end;
$$;
