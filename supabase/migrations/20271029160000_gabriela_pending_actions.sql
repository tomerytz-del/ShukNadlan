-- בקשת הנפקה מוואטסאפ. הכפתור נושא מזהה קצר, והתיקונים (עמלה, תאריכים,
-- הערות, מייל) יושבים כאן. לחיצה שנייה רואה executed_at או new_subject_id
-- ולא יוצרת הסכם נוסף. אחרי expires_at הכפתור נדחה.
-- הפונקציה עולה לפני המיגרציה: כשהטבלה חסרה אין כפתור, ויש משפט לנסות שוב.

create table if not exists public.whatsapp_pending_actions (
  id text primary key,
  agent_id uuid not null references public.agency_members (id) on delete cascade,
  action text not null,
  subject_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  executed_at timestamptz,
  new_subject_id uuid,
  result text,
  constraint whatsapp_pending_actions_action_chk check (action in ('reissue'))
);

comment on table public.whatsapp_pending_actions is
  'בקשת אישור מוואטסאפ שטרם בוצעה. רק service_role. הכפתור נושא את id.';

alter table public.whatsapp_pending_actions enable row level security;

revoke all on table public.whatsapp_pending_actions from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_pending_actions to service_role;
