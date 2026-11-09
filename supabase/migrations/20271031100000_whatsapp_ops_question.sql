-- שאלה תפעולית לסוכן/ת אחד/ת מתוך whatsapp-webhook?task=ops-question.
--
-- האופרטור שולח שאלה מהרשימה הסגורה בקוד (לא טקסט חופשי), רק בתוך
-- חלון 24 השעות של Meta. whatsapp_ops_question_claim תופסת את השורה,
-- אוכפת תקרה יומית (1 לסוכן/ת, 5 לכולם) ומאפשרת retry על failed
-- ועל claimed שנתקע. הייחוד (agent_id, purpose) מונע שליחה שנייה
-- אחרי status=sent.
-- לחיצה על הכפתור (מזהה ops_q:) נרשמת ב-whatsapp_ops_answers ולא משנה
-- שום נתון אחר.
--
-- שתי הטבלאות ל-service_role בלבד. RLS דלוק ובלי policy, וההרשאות
-- של anon ו-authenticated מורדות בשם. בלי grant ל-service_role
-- הפונקציה מקבלת permission denied אחרי 30.10.2026.

create table if not exists public.whatsapp_ops_questions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agency_members (id) on delete cascade,
  purpose text not null,
  body text not null,
  button_ids text[] not null,
  followup_body text,
  followup_button_ids text[],
  wa_message_ids text[] not null default '{}',
  status text not null default 'claimed',
  error text,
  created_at timestamptz not null default now(),
  constraint whatsapp_ops_questions_agent_purpose_uniq unique (agent_id, purpose),
  constraint whatsapp_ops_questions_status_chk check (status in ('claimed', 'sent', 'failed')),
  constraint whatsapp_ops_questions_purpose_chk check (purpose ~ '^[A-Za-z0-9_-]{1,40}$')
);

comment on table public.whatsapp_ops_questions is
  'שאלה תפעולית שנשלחה לסוכן/ת בוואטסאפ. שורה אחת לכל purpose. רק service_role.';

create table if not exists public.whatsapp_ops_answers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agency_members (id) on delete set null,
  purpose text not null,
  button_id text not null,
  button_title text not null,
  answered_at timestamptz not null default now()
);

comment on table public.whatsapp_ops_answers is
  'לחיצה על כפתור שאלה תפעולית. יומן בלבד: אין ממנה עדכון של נתוני הסוכן/ת. רק service_role.';

create index if not exists whatsapp_ops_answers_agent_answered_idx
  on public.whatsapp_ops_answers (agent_id, answered_at desc);

alter table public.whatsapp_ops_questions enable row level security;
revoke all on table public.whatsapp_ops_questions from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_ops_questions to service_role;

alter table public.whatsapp_ops_answers enable row level security;
revoke all on table public.whatsapp_ops_answers from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_ops_answers to service_role;

-- תפיסה אטומית: תקרה יומית, ו-retry שלא שורף purpose שנכשל או נתקע.
-- claimed שנתקע (התהליך מת לפני mark sent) משתחרר רק עם p_retry, כדי
-- ששליחה שהספיקה לצאת לא תישלח שוב מעצמה.

create or replace function public.whatsapp_ops_question_claim(
  p_agent uuid,
  p_purpose text,
  p_body text,
  p_button_ids text[],
  p_followup_body text,
  p_followup_button_ids text[],
  p_retry boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_agent_n int;
  v_global_n int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('whatsapp_ops_questions')::bigint);

  select q.status into v_status
    from public.whatsapp_ops_questions q
   where q.agent_id = p_agent and q.purpose = p_purpose
   for update;

  if found then
    if v_status = 'sent' then
      return 'already_sent';
    elsif v_status in ('failed', 'claimed') and p_retry then
      update public.whatsapp_ops_questions
         set status = 'claimed',
             error = null,
             body = p_body,
             button_ids = p_button_ids,
             followup_body = p_followup_body,
             followup_button_ids = p_followup_button_ids
       where agent_id = p_agent and purpose = p_purpose;
      return 'reclaimed';
    elsif v_status = 'failed' then
      return 'failed';
    else
      return 'in_progress';
    end if;
  end if;

  select count(*) into v_agent_n
    from public.whatsapp_ops_questions q
   where q.agent_id = p_agent
     and q.status in ('sent', 'claimed')
     and q.created_at > pg_catalog.now() - interval '1 day';
  if v_agent_n >= 1 then
    return 'agent_cap';
  end if;

  select count(*) into v_global_n
    from public.whatsapp_ops_questions q
   where q.status in ('sent', 'claimed')
     and q.created_at > pg_catalog.now() - interval '1 day';
  if v_global_n >= 5 then
    return 'global_cap';
  end if;

  insert into public.whatsapp_ops_questions (
    agent_id, purpose, body, button_ids, followup_body, followup_button_ids, status
  ) values (
    p_agent, p_purpose, p_body, p_button_ids, p_followup_body, p_followup_button_ids, 'claimed'
  );
  return 'claimed';
end;
$$;

comment on function public.whatsapp_ops_question_claim(uuid, text, text, text[], text, text[], boolean) is
  'תופסת שאלה תפעולית. תקרה 1 לסוכן/ת ו-5 לכולם ביממה, על sent ו-claimed. failed ו-claimed נתקע חוזרים רק עם p_retry. sent אינו נשלח שוב.';

revoke all on function public.whatsapp_ops_question_claim(uuid, text, text, text[], text, text[], boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_ops_question_claim(uuid, text, text, text[], text, text[], boolean) to service_role;

-- הצמדת היסטוריה בלי קריאה-ואז-כתיבה. last_message_at אינו זז בעדכון.

create or replace function public.whatsapp_ops_history_append(
  p_agent uuid,
  p_phone text,
  p_last_inbound timestamptz,
  p_entries jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.whatsapp_conversations (agent_id, wa_phone, history, last_message_at)
  values (
    p_agent,
    p_phone,
    coalesce(p_entries, '[]'::jsonb),
    coalesce(p_last_inbound, pg_catalog.now())
  )
  on conflict (agent_id) do update
     set history = coalesce(public.whatsapp_conversations.history, '[]'::jsonb)
                   || coalesce(excluded.history, '[]'::jsonb);
end;
$$;

comment on function public.whatsapp_ops_history_append(uuid, text, timestamptz, jsonb) is
  'מוסיף זוג הודעות להיסטוריית גבריאלה של סוכן/ת. עדכון אטומי ב-||, בלי לשנות את last_message_at.';

revoke all on function public.whatsapp_ops_history_append(uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_ops_history_append(uuid, text, timestamptz, jsonb) to service_role;
