-- ===========================================================================
-- נושאים שחסרים למנטור (docs/coaches.md, "כשאין למנטור ידע")
--
-- שאלה מקצועית ש-playbook.ts אינו מכסה: המנטור אומר שאין לו עדיין את השיטה
-- בנושא ולא ממציא, ו-askCoach רושם את הנושא ב-coach_questions.gap_topic.
-- מנהל/ת הפלטפורמה רואה את הנושאים מקובצים (coach_knowledge_gaps) ב"ניהול
-- מערכת", ומסמן/ת "הוספתי לידע" אחרי שהנושא נכנס ל-playbook.ts.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

alter table public.coach_questions add column if not exists gap_topic text;
alter table public.coach_questions add column if not exists gap_resolved_at timestamptz;

comment on column public.coach_questions.gap_topic is
  'נושא שהמנטור אמר שאין לו עליו ידע (null = נענה מהידע). נכתב ב-askCoach. docs/coaches.md';
comment on column public.coach_questions.gap_resolved_at is
  'מתי מנהל/ת הפלטפורמה סימן/ה שהנושא נוסף ל-playbook.ts (coach_gap_resolve).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_questions_gap_topic_len') then
    alter table public.coach_questions
      add constraint coach_questions_gap_topic_len check (gap_topic is null or length(gap_topic) between 1 and 80);
  end if;
end $$;

create index if not exists coach_questions_gap_open_idx
  on public.coach_questions (created_at desc)
  where gap_topic is not null and gap_resolved_at is null;

-- ---------------------------------------------------------------------------
-- הרשימה: נושא, כמה פעמים, מתי לאחרונה, מאיזה מנטור, ועד שלוש שאלות לדוגמה.
-- הקיבוץ לפי הנושא אחרי lower/trim. מנהל/ת פלטפורמה בלבד.
-- ---------------------------------------------------------------------------
create or replace function public.coach_knowledge_gaps()
returns table (topic text, asked int, last_asked timestamptz, kinds text[], samples text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select min(btrim(q.gap_topic))                            as topic,
           count(*)::int                                      as asked,
           max(q.created_at)                                  as last_asked,
           array_agg(distinct q.kind)                         as kinds,
           (array_agg(q.question order by q.created_at desc))[1:3] as samples
      from public.coach_questions q
     where q.gap_topic is not null and q.gap_resolved_at is null
     group by lower(btrim(q.gap_topic))
     order by count(*) desc, max(q.created_at) desc
     limit 200;
end;
$$;

revoke all on function public.coach_knowledge_gaps() from public, anon, authenticated;
grant execute on function public.coach_knowledge_gaps() to authenticated;

-- "הוספתי לידע": מסמן את כל השאלות של אותו נושא. מחזיר כמה סומנו.
create or replace function public.coach_gap_resolve(p_topic text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.coach_questions
     set gap_resolved_at = now()
   where gap_topic is not null and gap_resolved_at is null
     and lower(btrim(gap_topic)) = lower(btrim(coalesce(p_topic, '')));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.coach_gap_resolve(text) from public, anon, authenticated;
grant execute on function public.coach_gap_resolve(text) to authenticated;
