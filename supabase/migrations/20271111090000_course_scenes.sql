-- ============================================================================
-- קורס ההכנה: סצנות "עצרו את התמונה"
--
-- שיעור יכול לשאת צעד מסוג scene: סיפור מונפש שקופא ברגע ההחלטה ושואל את
-- שאלת הבדיקה. הפתיחה (עד ההקפאה) יושבת ב-course_lessons.steps כמו שאר הצעדים.
-- **הסופים** ("מה היה קורה" ו"איך זה נגמר") חושפים את התשובה הנכונה, ולכן הם
-- יושבים על השאלה עצמה ויוצאים רק מ-course_answer, אחרי שהתשובה נרשמה - כמו
-- ההסבר. course_questions סגורה לדפדפן (docs/exam-course.md, "התשובות אינן
-- בדפדפן"), והעמודה החדשה יורשת את זה.
--
-- בסימולציה (kind = 'exam') course_answer אינו מחזיר דבר מלבד "נרשם", ולכן
-- גם לא את הסופים.
-- ============================================================================

alter table public.course_questions add column if not exists scene jsonb;

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
                            'explanation', v_q.explanation, 'law_ref', v_q.law_ref,
                            'scene', v_q.scene);
end;
$$;
revoke all on function public.course_answer(uuid, uuid, int) from public, anon;
grant execute on function public.course_answer(uuid, uuid, int) to authenticated, service_role;
