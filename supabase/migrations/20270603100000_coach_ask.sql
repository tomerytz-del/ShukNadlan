-- ===========================================================================
-- "שאל את המאמן": שאלה חופשית לשלושת מאמני ה-AI
-- ---------------------------------------------------------------------------
-- שלב 8 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 8;
-- docs/coaches.md, "שאל את המאמן"). ה-Edge Function ‏coach-ask עונה על שאלה
-- מול הסיכום האחרון והמספרים של אותו מאמן, ושומרת כאן כל שאלה ותשובה.
--
-- מה בקובץ:
--   1. ‏coach_questions - יומן השאלות: מי שאל/ה, לאיזה מאמן, מה נענה, באיזה
--      מודל ובכמה טוקנים. הסוכן/ת קורא/ת את השאלות של עצמו/ה בלבד, ואין כתיבה
--      מהדפדפן - רק הפונקציה, ב-service_role.
--   2. ‏coach_ask_count_today() - כמה שאלות היום (שעון ישראל), למגבלה היומית.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

create table if not exists public.coach_questions (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agency_members (id) on delete cascade,
  agency_id     uuid references public.agencies (id) on delete cascade,
  kind          text not null check (kind in ('agent', 'team', 'office')),
  question      text not null check (length(question) between 1 and 300),
  answer        text,
  model         text,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null default now()
);
comment on table public.coach_questions is
  '"שאל את המאמן" (coach-ask): כל שאלה ותשובה, עם המודל והטוקנים. נכתב ב-service_role בלבד; הסוכן/ת קורא/ת את שלו/ה. docs/coaches.md';

create index if not exists coach_questions_agent_day_idx
  on public.coach_questions (agent_id, created_at desc);

alter table public.coach_questions enable row level security;
drop policy if exists "agent reads own coach questions" on public.coach_questions;
create policy "agent reads own coach questions" on public.coach_questions
  for select to authenticated
  using (agent_id = (select public.current_agent_id()));
revoke all on public.coach_questions from anon, authenticated;
grant select on public.coach_questions to authenticated;

-- המגבלה היומית נספרת לפי היום בישראל (coach_today, 20270601160000), כדי
-- שהמכסה תתחדש בחצות של הסוכן/ת ולא בשלוש בלילה
create or replace function public.coach_ask_count_today(p_agent uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int
    from public.coach_questions q
   where q.agent_id = p_agent
     and q.created_at >= (public.coach_today()::timestamp at time zone 'Asia/Jerusalem');
$$;

revoke all on function public.coach_ask_count_today(uuid) from public, anon, authenticated;
grant execute on function public.coach_ask_count_today(uuid) to service_role;
