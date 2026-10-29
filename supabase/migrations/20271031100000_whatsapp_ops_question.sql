-- שאלה תפעולית לסוכן/ת אחד/ת מתוך whatsapp-webhook?task=ops-question.
--
-- האופרטור שולח הודעת וואטסאפ אחת (ואפשר שנייה מיד אחריה) עם כפתורי
-- תשובה, רק בתוך חלון 24 השעות של Meta. השורה ב-whatsapp_ops_questions
-- נתפסת לפני השליחה, והייחוד (agent_id, purpose) מונע שליחה שנייה.
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
