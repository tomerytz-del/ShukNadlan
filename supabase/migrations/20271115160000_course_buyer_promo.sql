-- ============================================================================
-- מתנת הרכישה בקורס: חודש Elite נוסף על 60 ימי ה-Elite הקבועים
--
-- החלטת תומר (15.11.2026): מי שרכש/ה את קורס ההכנה ונרשם/ה בפלטפורמה כיועץ/ת
-- נדל״ן באותו חשבון Google מקבל/ת 90 ימי Elite במקום 60 (60 הימים הם התמחור
-- הקבוע, לא הטבה זמנית). ההטבה למצטרפים חדשים בלבד: מי שרכש/ה את הקורס **לפני** שהצטרף/ה כסוכן/ת. אין תאריך סיום.
--
-- הזיהוי הוא לפי `user_id`: `course_orders.user_id` ו-`agency_members.user_id`
-- מצביעים שניהם ל-`auth.users`. "שולם" = הזמנה ב-`success` שאינה `test_mode`;
-- גישה שנפתחה ב-`course_grant_access` אינה הזמנה ולכן אינה מזכה.
--
-- **המתג הוא מפתח ב-`pricing_config`, והוא נוצר כבוי (0).** הדף של הקורס קורא
-- אותו דרך `course_catalog` ומציג את המתנה רק כשהוא גדול מאפס, וההענקה
-- (`grantLaunchPromo`) קוראת אותו דרך `course_buyer_bonus_months`. כך הדף
-- וההענקה נדלקים יחד, אחרי שהמיגרציה רצה בפרודקשן, בשורת data אחת:
--   update public.pricing_config set value = 1 where key = 'course_buyer_bonus_months';
-- ============================================================================

insert into public.pricing_config (key, value, description) values
  ('course_buyer_bonus_months', 0,
   'קורס ההכנה: חודשי Elite נוספים למי שרכש/ה בתשלום ונרשם/ה כסוכן/ת עם אותו חשבון Google (למצטרפים חדשים בלבד). 0 = כבוי, והדף לא מציג את המתנה. docs/exam-course.md')
on conflict (key) do nothing;

create or replace function public.course_buyer_bonus_months(p_member_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
        from public.agency_members m
        join public.course_orders o on o.user_id = m.user_id
       where m.id = p_member_id
         and m.user_id is not null
         and o.status = 'success'
         and o.test_mode = false
    )
    then coalesce((select floor(value)::int from public.pricing_config
                    where key = 'course_buyer_bonus_months'), 0)
    else 0
  end;
$$;

comment on function public.course_buyer_bonus_months(uuid) is
  'כמה חודשי Elite נוספים מגיעים לבעל/ת הכרטיס כרוכש/ת קורס בתשלום (אותו user_id), לפי pricing_config.course_buyer_bonus_months. 0 למי שלא רכש/ה. docs/exam-course.md';

revoke all on function public.course_buyer_bonus_months(uuid) from public, anon, authenticated;
grant execute on function public.course_buyer_bonus_months(uuid) to service_role;

-- הדף הציבורי מגלה אם המתנה פעילה. מפתח אחד בסוף האובייקט, ושאר הפלט כמו שהיה.
create or replace function public.course_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'chapters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'title', c.title, 'summary', c.summary, 'position', c.position,
        'lessons', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'slug', l.slug, 'title', l.title, 'is_free', l.is_free,
            'questions', (select count(*) from public.course_questions q where q.lesson_id = l.id and q.published))
            order by l.position)
          from public.course_lessons l where l.chapter_id = c.id and l.published), '[]'::jsonb))
        order by c.position)
      from public.course_chapters c where c.published), '[]'::jsonb),
    'lessons_total', (select count(*) from public.course_lessons where published),
    'questions_total', (select count(*) from public.course_questions where published),
    'exam_questions_total', (select count(*) from public.course_questions where published and kind = 'exam'),
    'buyer_bonus_months', coalesce((select floor(value)::int from public.pricing_config
                                     where key = 'course_buyer_bonus_months'), 0)
  );
$$;
revoke all on function public.course_catalog() from public;
grant execute on function public.course_catalog() to anon, authenticated, service_role;
