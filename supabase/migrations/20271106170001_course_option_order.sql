-- ============================================================================
-- קורס ההכנה: סדר החלופות מוגרל בשרת, לכל ניסיון
--
-- הסקירה של 6.11.2026 מצאה ש-21 מתוך 34 שאלות הבדיקה המהירה החזיקו את
-- התשובה הנכונה ב-ב. לערבב את ה-JSON היה פותר את זה פעם אחת ושובר ניסיון
-- פתוח: התשובה שנשמרה היא אינדקס, ואינדקס שמשמעותו השתנתה מתחת לרגליים
-- נבדק מול החלופה הלא נכונה. לכן הערבוב עובר לכאן:
--
--   * course_attempt_start מגרילה לכל שאלת practice בניסיון תמורה של 0-3,
--     שומרת אותה ב-course_attempts.option_orders ({question_id: [2,0,3,1]})
--     ומחזירה את החלופות בסדר המוגרל. perm[i] = האינדקס המקורי של החלופה
--     שמוצגת במקום i.
--   * course_answer מתרגמת את הבחירה המוצגת לאינדקס המקורי, בודקת ושומרת
--     אותו (answers.c נשאר במרחב המקורי, כמו לפני), ומחזירה correct/accepted
--     במרחב המוצג.
--   * course_attempt_finish מחזירה את הסקירה במרחב המוצג של אותו ניסיון.
--
-- שאלות exam (מבחני הרשם) נשארות בסדר של הרשם: ההסברים שם מפנים לאותיות
-- ("חלופה ג שגויה"), וארבע הגרסאות של כל מועד כבר מערבבות אותן. ניסיון
-- שנפתח לפני המיגרציה אין לו option_orders, וכל הפונקציות מתייחסות אליו
-- כסדר הזהות. הפרטים: docs/exam-course.md, "סדר החלופות".
-- ============================================================================

alter table public.course_attempts
  add column if not exists option_orders jsonb not null default '{}'::jsonb;

comment on column public.course_attempts.option_orders is
  'לכל שאלת practice בניסיון: תמורת החלופות שהוצגה, {question_id: [perm]}. perm[i] = האינדקס המקורי של החלופה במקום i. חסר = סדר הזהות.';

-- ---- עזרים (פנימיים: רק service_role, והפונקציות למטה רצות כ-definer) ----

-- תמורה אקראית של 0-3. volatile, ולכן מוערכת מחדש לכל שורה ב-jsonb_object_agg למטה.
create or replace function public.course_random_perm()
returns smallint[]
language sql
volatile
set search_path = ''
as $$
  select array_agg(i::smallint order by random()) from generate_series(0, 3) i;
$$;
revoke all on function public.course_random_perm() from public, anon, authenticated;
grant execute on function public.course_random_perm() to service_role;

-- התמורה של שאלה בניסיון, או הזהות כשאין (שאלת exam, או ניסיון ישן).
create or replace function public.course_perm_of(p_orders jsonb, p_question_id uuid)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(x::smallint order by ord)
       from jsonb_array_elements_text(p_orders -> p_question_id::text) with ordinality as t(x, ord)),
    '{0,1,2,3}'::smallint[]);
$$;
revoke all on function public.course_perm_of(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.course_perm_of(jsonb, uuid) to service_role;

-- אינדקס מקורי -> המקום שבו הוא מוצג.
create or replace function public.course_display_index(p_perm smallint[], p_canonical int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_canonical is null then null
              else array_position(p_perm, p_canonical::smallint) - 1 end;
$$;
revoke all on function public.course_display_index(smallint[], int) from public, anon, authenticated;
grant execute on function public.course_display_index(smallint[], int) to service_role;

-- מערך accepted במרחב המוצג (null נשאר null).
create or replace function public.course_display_accepted(p_perm smallint[], p_accepted smallint[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_accepted is null then null
              else (select to_jsonb(array_agg(public.course_display_index(p_perm, a))) from unnest(p_accepted) a) end;
$$;
revoke all on function public.course_display_accepted(smallint[], smallint[]) from public, anon, authenticated;
grant execute on function public.course_display_accepted(smallint[], smallint[]) to service_role;

-- החלופות בסדר המוצג.
create or replace function public.course_display_options(p_options jsonb, p_perm smallint[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(p_options -> p order by ord) from unnest(p_perm) with ordinality as u(p, ord);
$$;
revoke all on function public.course_display_options(jsonb, smallint[]) from public, anon, authenticated;
grant execute on function public.course_display_options(jsonb, smallint[]) to service_role;

-- ---- פתיחת ניסיון: כמו 20271106120000, ועוד ההגרלה ----
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
  v_orders jsonb;
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

  -- תמורה לכל שאלת practice; שאלות exam נשארות בסדר של הרשם (ראו למעלה)
  select coalesce(jsonb_object_agg(q.id::text, to_jsonb(public.course_random_perm())), '{}'::jsonb)
    into v_orders
    from unnest(v_ids) as u(id)
    join public.course_questions q on q.id = u.id
   where q.kind = 'practice';

  insert into public.course_attempts (user_id, kind, lesson_id, question_ids, total, option_orders)
  values (v_uid, p_kind, case when p_kind = 'quiz' then p_lesson_id end, v_ids, array_length(v_ids, 1), v_orders)
  returning id into v_attempt;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'slug', q.slug, 'question', q.question,
           'options', public.course_display_options(q.options, public.course_perm_of(v_orders, q.id)),
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

-- ---- מענה: הבחירה המוצגת מתורגמת למקורית, ונשמרת במקורית ----
create or replace function public.course_answer(p_attempt_id uuid, p_question_id uuid, p_choice int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_att public.course_attempts;
  v_q   public.course_questions;
  v_perm smallint[];
  v_canonical int;
  v_ok  boolean;
begin
  if v_uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into v_att from public.course_attempts where id = p_attempt_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_att.finished_at is not null then return jsonb_build_object('error', 'attempt_finished'); end if;
  if not (p_question_id = any (v_att.question_ids)) then
    return jsonb_build_object('error', 'question_not_in_attempt');
  end if;
  if p_choice is null or p_choice < 0 or p_choice > 3 then
    return jsonb_build_object('error', 'invalid_choice');
  end if;
  if exists (select 1 from jsonb_array_elements(v_att.answers) e
              where (e->>'q')::uuid = p_question_id) then
    return jsonb_build_object('error', 'already_answered');
  end if;

  select * into v_q from public.course_questions where id = p_question_id;
  v_perm := public.course_perm_of(v_att.option_orders, p_question_id);
  v_canonical := v_perm[p_choice + 1];
  v_ok := (v_q.correct = v_canonical) or (v_q.accepted is not null and v_canonical = any (v_q.accepted));

  update public.course_attempts
     set answers = answers || jsonb_build_object('q', p_question_id, 'c', v_canonical, 'ok', v_ok)
   where id = p_attempt_id;

  if v_att.kind = 'exam' then
    return jsonb_build_object('success', true, 'recorded', true);
  end if;
  return jsonb_build_object('success', true, 'ok', v_ok,
                            'correct', public.course_display_index(v_perm, v_q.correct),
                            'accepted', public.course_display_accepted(v_perm, v_q.accepted),
                            'explanation', v_q.explanation, 'law_ref', v_q.law_ref);
end;
$$;
revoke all on function public.course_answer(uuid, uuid, int) from public, anon;
grant execute on function public.course_answer(uuid, uuid, int) to authenticated, service_role;

-- ---- סיום: הסקירה במרחב המוצג של הניסיון ----
create or replace function public.course_attempt_finish(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_att public.course_attempts;
  v_correct int;
  v_pct int;
  v_pass int;
  v_passed boolean;
  v_review jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into v_att from public.course_attempts where id = p_attempt_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  select coalesce(value::int, 60) into v_pass from public.pricing_config where key = 'course_exam_pass_pct';
  v_pass := coalesce(v_pass, 60);

  if v_att.finished_at is null then
    select count(*) into v_correct from jsonb_array_elements(v_att.answers) e
     where (e->>'ok')::boolean;
    v_pct := case when v_att.total > 0 then round(100.0 * v_correct / v_att.total) else 0 end;
    v_passed := v_pct >= v_pass;
    update public.course_attempts
       set finished_at = now(), correct = v_correct, passed = v_passed
     where id = p_attempt_id;
    v_att.correct := v_correct; v_att.passed := v_passed; v_att.finished_at := now();

    if v_att.kind = 'quiz' and v_att.lesson_id is not null then
      insert into public.course_progress (user_id, lesson_id, opened_at, completed_at, best_score)
      values (v_uid, v_att.lesson_id, now(), case when v_passed then now() end, v_pct)
      on conflict (user_id, lesson_id) do update
        set completed_at = coalesce(public.course_progress.completed_at, case when v_passed then now() end),
            best_score   = greatest(coalesce(public.course_progress.best_score, 0), v_pct);
    end if;
  else
    v_correct := coalesce(v_att.correct, 0);
    v_pct := case when v_att.total > 0 then round(100.0 * v_correct / v_att.total) else 0 end;
    v_passed := coalesce(v_att.passed, false);
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'question', q.question,
           'options', public.course_display_options(q.options, perm),
           'correct', public.course_display_index(perm, q.correct),
           'accepted', public.course_display_accepted(perm, q.accepted),
           'explanation', q.explanation, 'law_ref', q.law_ref,
           'source', q.source,
           'choice', public.course_display_index(perm,
                       (select (e->>'c')::int from jsonb_array_elements(v_att.answers) e
                         where (e->>'q')::uuid = q.id limit 1)),
           'ok', coalesce((select (e->>'ok')::boolean from jsonb_array_elements(v_att.answers) e
                            where (e->>'q')::uuid = q.id limit 1), false))
           order by ord)
    into v_review
    from unnest(v_att.question_ids) with ordinality as u(id, ord)
    join public.course_questions q on q.id = u.id
    cross join lateral (select public.course_perm_of(v_att.option_orders, q.id) as perm) p;

  return jsonb_build_object('success', true, 'kind', v_att.kind, 'total', v_att.total,
                            'correct', v_correct, 'pct', v_pct, 'passed', v_passed,
                            'pass_pct', v_pass, 'review', coalesce(v_review, '[]'::jsonb));
end;
$$;
revoke all on function public.course_attempt_finish(uuid) from public, anon;
grant execute on function public.course_attempt_finish(uuid) to authenticated, service_role;
