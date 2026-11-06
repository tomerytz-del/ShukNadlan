-- ============================================================================
-- קורס ההכנה: שיעור כצעדים
--
-- שיעור היה עמוד טקסט (body_html) ואחריו חידון. מעכשיו שיעור יכול להיות
-- רצף של צעדים קצרים - רעיון, דוגמה, בדיקה מהירה - ש-learn.html מציג מסך
-- אחד בכל פעם (docs/exam-course.md, "צעדים"). הצעדים נכתבים ב-
-- course-content/*.json ונכנסים דרך הגנרטור, כמו שאר התוכן.
--
--   steps: [{type: 'concept', title, text, icon}
--           {type: 'example', title, text, law}
--           {type: 'check', question: <slug של שאלה באותו שיעור>}]
--
-- צעד 'check' מצביע על שאלה לפי slug, ולכן course_attempt_start מחזירה
-- מעכשיו גם את ה-slug (אינו רגיש; התשובה וההסבר עדיין אינם חוזרים).
-- ‏body_html נשאר, כ"טקסט המלא" של השיעור, ולשיעור בלי steps הנגן מציג
-- אותו כמו קודם.
-- ============================================================================

alter table public.course_lessons
  add column if not exists steps jsonb not null default '[]'::jsonb;

comment on column public.course_lessons.steps is
  'רצף הצעדים של השיעור (concept / example / check). ריק = מצב טקסט + חידון.';

create or replace function public.course_attempt_start(p_kind text, p_lesson_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_n int;
  v_attempt uuid;
  v_free boolean := false;
  v_questions jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if p_kind not in ('quiz', 'exam', 'review') then
    return jsonb_build_object('error', 'invalid_kind');
  end if;

  if p_kind = 'quiz' then
    if p_lesson_id is null then return jsonb_build_object('error', 'missing_fields'); end if;
    select is_free into v_free from public.course_lessons where id = p_lesson_id and published;
    if v_free is null then return jsonb_build_object('error', 'not_found'); end if;
    if not v_free and not public.course_has_access() then
      return jsonb_build_object('error', 'course_not_enrolled');
    end if;
    select coalesce(array_agg(id order by position, created_at), '{}') into v_ids
      from public.course_questions where lesson_id = p_lesson_id and published;

  elsif p_kind = 'exam' then
    if not public.course_has_access() then
      return jsonb_build_object('error', 'course_not_enrolled');
    end if;
    select coalesce(value::int, 25) into v_n from public.pricing_config where key = 'course_exam_questions';
    v_n := coalesce(v_n, 25);
    select coalesce(array_agg(id), '{}') into v_ids from (
      select id from public.course_questions
       where published
       order by (kind = 'exam') desc, random()
       limit v_n
    ) s;
    -- הסדר בתוך המבחן אקראי גם הוא, אחרת שאלות המבחן האמיתי תמיד ראשונות
    select coalesce(array_agg(id order by random()), '{}') into v_ids
      from unnest(v_ids) as id;

  else -- review
    if not public.course_has_access() then
      return jsonb_build_object('error', 'course_not_enrolled');
    end if;
    -- שאלות שהתשובה האחרונה עליהן הייתה שגויה
    -- ה-limit בתוך תת-השאילתה: limit על שאילתת aggregate מגביל שורה אחת, לא 25
    select coalesce(array_agg(q order by last_at desc), '{}') into v_ids from (
      select latest.q, latest.last_at from (
        select distinct on (q) (a.elem->>'q')::uuid as q,
               (a.elem->>'ok')::boolean as ok, a.started_at as last_at
          from (select t.started_at, e.elem
                  from public.course_attempts t, jsonb_array_elements(t.answers) e(elem)
                 where t.user_id = v_uid) a
         order by q, a.started_at desc
      ) latest
      join public.course_questions cq on cq.id = latest.q and cq.published
      where latest.ok = false
      order by latest.last_at desc
      limit 25
    ) wrong;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('success', true, 'attempt_id', null, 'questions', '[]'::jsonb);
  end if;

  insert into public.course_attempts (user_id, kind, lesson_id, question_ids, total)
  values (v_uid, p_kind, case when p_kind = 'quiz' then p_lesson_id end, v_ids, array_length(v_ids, 1))
  returning id into v_attempt;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'slug', q.slug, 'question', q.question, 'options', q.options,
           'kind', q.kind, 'source', q.source, 'law_ref', q.law_ref)
           order by ord)
    into v_questions
    from unnest(v_ids) with ordinality as u(id, ord)
    join public.course_questions q on q.id = u.id;

  return jsonb_build_object('success', true, 'attempt_id', v_attempt,
                            'questions', coalesce(v_questions, '[]'::jsonb));
end;
$$;
revoke all on function public.course_attempt_start(text, uuid) from public, anon;
grant execute on function public.course_attempt_start(text, uuid) to authenticated, service_role;
