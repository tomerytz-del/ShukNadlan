-- ============================================================================
-- קורס ההכנה למבחן המתווכים - הסכימה, הרכישה וההתקדמות
--
-- מוצר חדש באתר: קורס אינטראקטיבי להכנה לבחינת רשם המתווכים, שנמכר
-- לגולש/ת פרטי/ת (לא לסוכן/ת) ב-₪199 כולל מע״מ לגישה של שישה חודשים.
-- התיעוד: docs/exam-course.md. הדפים: course.html (מכירה) ו-learn.html
-- (הלמידה). הפונקציה: supabase/functions/course-purchase.
--
-- ארבע החלטות שמסבירות את המבנה:
--
-- 1. **הלומד/ת הוא/היא משתמש/ת auth בלי שום שורה עסקית.** עד היום כל מי
--    שנכנס/ה לאתר היה/הייתה סוכן/ת, יזם/ית, בעל/ת מקצוע או צוות ההטמעה.
--    כאן המפתח הוא auth.users ישירות (course_enrollments.user_id), ולא
--    agency_members - סוכן/ת שרוצה ללמוד נכנס/ת עם אותו חשבון Google
--    ומקבל/ת אותו טיפול.
--
-- 2. **הרכישה היא המכונה החמישית של wallet-topup-callback.** שורת pending
--    ב-course_orders, טופס תשלום אצל מורנינג, אימות חוזר מול ה-API, ורק אז
--    complete_course_order פותחת את הגישה. אותה צורה בדיוק כמו ad_orders -
--    גם כאן מי שמשלם/ת אינו/ה סוכן/ת, ולכן אין ארנק ואין קרדיט. המחיר כולל
--    מע״מ (מחיר לצרכן/ית), בניגוד לארנק: pricing_config.course_price_gross
--    הוא הסכום לגבייה, ו-amount_before_vat נגזר ממנו לרישום.
--
-- 3. **התשובות הנכונות לעולם אינן נשלפות מהטבלה.** course_questions סגורה
--    לדפדפן לגמרי; השאלות מגיעות מ-course_attempt_start (בלי correct ובלי
--    explanation) והבדיקה נעשית ב-course_answer במסד. כך הציון שנרשם הוא
--    ציון אמיתי, והחידון בסוף שיעור ומבחן הסימולציה הם אותו מנגנון.
--
-- 4. **התוכן הוא מיגרציה.** פרקים, שיעורים ושאלות נכנסים ב-upsert לפי slug
--    מקובץ שנוצר ב-scripts/course_content_sql.py מתוך course/content/*.json.
--    body_html נכתב רק בידינו (service_role) ומוכנס ל-innerHTML בדף -
--    לכן הטבלה אינה פתוחה לכתיבה לאף תפקיד אחר.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. התמחור והפרמטרים של המבחן
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('course_price_gross', 199,
   'קורס ההכנה למבחן המתווכים: המחיר לצרכן/ית, כולל מע״מ (בניגוד לשאר המחירון). docs/exam-course.md'),
  ('course_access_months', 6,
   'קורס ההכנה: כמה חודשי גישה נפתחים ברכישה אחת. רכישה נוספת מאריכה מסוף התקופה.'),
  ('course_exam_questions', 25,
   'קורס ההכנה: מספר השאלות במבחן סימולציה, כמו בבחינת הרשם (25 שאלות, 4 נקודות כל אחת).'),
  ('course_exam_pass_pct', 60,
   'קורס ההכנה: אחוז המעבר בסימולציה ובחידון שיעור, כמו ציון העובר בבחינת הרשם (60).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. התוכן: פרקים, שיעורים, שאלות
-- ---------------------------------------------------------------------------
create table if not exists public.course_chapters (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  summary     text,
  position    int  not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.course_chapters is
  'קורס ההכנה למבחן המתווכים - פרק. נכתב רק ממיגרציה (course/content). docs/exam-course.md';

create table if not exists public.course_lessons (
  id          uuid primary key default gen_random_uuid(),
  chapter_id  uuid not null references public.course_chapters(id) on delete cascade,
  slug        text not null,
  title       text not null,
  position    int  not null default 0,
  -- משפט הפתיחה של המנטור, מוצג בבועה לצד הדמות
  intro       text,
  -- גוף השיעור. HTML מוגבל (p, ul, li, strong, h3, blockquote) שנכתב בידינו
  body_html   text not null default '',
  -- נקודות המפתח לזכירה, מערך מחרוזות
  key_points  jsonb not null default '[]'::jsonb,
  -- הסעיף או התקנה שהשיעור מלמד, כפי שמוצג ללומד/ת ("תקנות 2-4")
  source_ref  text,
  video_url   text,
  -- שיעור טעימה: נפתח גם בלי רכישה (ולכן גם ל-anon)
  is_free     boolean not null default false,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (chapter_id, slug)
);
comment on table public.course_lessons is
  'קורס ההכנה - שיעור. body_html מוכנס ל-innerHTML בדף, ולכן הטבלה נכתבת רק ממיגרציה.';

create table if not exists public.course_questions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  chapter_id   uuid references public.course_chapters(id) on delete set null,
  lesson_id    uuid references public.course_lessons(id) on delete set null,
  -- practice: נכתבה לקורס. exam: שאלה ממבחן אמיתי של הרשם (source אומר איזה)
  kind         text not null default 'practice' check (kind in ('practice', 'exam')),
  source       text,
  question     text not null,
  -- ארבע חלופות, בסדר א-ד
  options      jsonb not null,
  -- האינדקס של התשובה הנכונה ב-options (0-3)
  correct      smallint not null check (correct between 0 and 3),
  -- מועדים שבהם הרשם קיבל שתי תשובות: כל האינדקסים שנחשבים נכונים. null =
  -- רק correct. שאלה שהרשם ביטל ("כל התשובות מתקבלות") נכנסת published=false.
  accepted     smallint[],
  explanation  text,
  law_ref      text,
  position     int not null default 0,
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);
comment on table public.course_questions is
  'קורס ההכנה - שאלה. סגורה לדפדפן: correct ו-explanation נחשפים רק דרך course_answer.';

create index if not exists course_lessons_chapter_idx on public.course_lessons (chapter_id, position);
create index if not exists course_questions_lesson_idx on public.course_questions (lesson_id, position);
create index if not exists course_questions_kind_idx on public.course_questions (kind) where published;

-- ---------------------------------------------------------------------------
-- 3. הרכישה והגישה
-- ---------------------------------------------------------------------------
create table if not exists public.course_orders (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  email                text,
  months               int not null check (months between 1 and 24),
  -- הסכום שנגבה בפועל, כולל מע״מ. נשמר ולא מחושב מחדש.
  amount               numeric not null check (amount > 0),
  amount_before_vat    numeric not null check (amount_before_vat > 0),
  vat_rate             numeric not null,
  status               text not null default 'pending'
                         check (status in ('pending', 'success', 'failed')),
  test_mode            boolean not null default false,
  provider             text default 'morning',
  provider_form_id     text,
  provider_payment_url text,
  provider_charge_id   text,
  provider_document_id text,
  provider_pdf_url     text,
  period_start         timestamptz,
  period_end           timestamptz,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  failure_reason       text
);
comment on table public.course_orders is
  'רכישת גישה לקורס ההכנה. אותה מכונת מצבים כמו wallet_topups (KINDS ב-wallet-topup-callback).';

create unique index if not exists course_orders_provider_charge_uniq
  on public.course_orders (provider, provider_charge_id) where provider_charge_id is not null;
create index if not exists course_orders_pending_idx
  on public.course_orders (status, created_at) where status = 'pending';
create index if not exists course_orders_user_idx on public.course_orders (user_id, created_at desc);

create table if not exists public.course_enrollments (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  test_mode   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.course_enrollments is
  'מי רשאי/ת ללמוד בקורס ועד מתי. שורה אחת למשתמש/ת; רכישה נוספת מאריכה.';

-- ---------------------------------------------------------------------------
-- 4. ההתקדמות
-- ---------------------------------------------------------------------------
create table if not exists public.course_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  lesson_id    uuid not null references public.course_lessons(id) on delete cascade,
  opened_at    timestamptz not null default now(),
  completed_at timestamptz,
  best_score   int,
  primary key (user_id, lesson_id)
);

create table if not exists public.course_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- quiz: חידון בסוף שיעור. exam: סימולציה. review: חזרה על טעויות
  kind         text not null check (kind in ('quiz', 'exam', 'review')),
  lesson_id    uuid references public.course_lessons(id) on delete set null,
  question_ids uuid[] not null,
  -- [{q: uuid, c: int, ok: bool}] לפי סדר המענה
  answers      jsonb not null default '[]'::jsonb,
  total        int not null,
  correct      int,
  passed       boolean,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists course_attempts_user_idx on public.course_attempts (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 5. הרשאות ו-RLS
--
-- התוכן נקרא ישירות מהדפדפן (פרקים לכולם, שיעורים לפי גישה), ההתקדמות
-- והרכישות נקראות רק על ידי בעליהן, וכל כתיבה עוברת בפונקציות. השאלות
-- סגורות לגמרי - ראו ההחלטה 3 למעלה.
-- ---------------------------------------------------------------------------
alter table public.course_chapters    enable row level security;
alter table public.course_lessons     enable row level security;
alter table public.course_questions   enable row level security;
alter table public.course_orders      enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_progress    enable row level security;
alter table public.course_attempts    enable row level security;

-- ‏revoke all לפני כל grant: ברירת המחדל (אם עוד קיימת) נותנת ל-authenticated
-- גם insert/update/delete, והתוכן וההתקדמות נכתבים רק דרך פונקציות.
revoke all on table public.course_chapters from public, anon, authenticated;
grant select on table public.course_chapters to anon, authenticated;
grant all on table public.course_chapters to service_role;

revoke all on table public.course_lessons from public, anon, authenticated;
grant select on table public.course_lessons to anon, authenticated;
grant all on table public.course_lessons to service_role;

revoke all on table public.course_questions from public, anon, authenticated;
grant all on table public.course_questions to service_role;

revoke all on table public.course_orders from public, anon, authenticated;
grant select on table public.course_orders to authenticated;
grant all on table public.course_orders to service_role;

revoke all on table public.course_enrollments from public, anon, authenticated;
grant select on table public.course_enrollments to authenticated;
grant all on table public.course_enrollments to service_role;

revoke all on table public.course_progress from public, anon, authenticated;
grant select on table public.course_progress to authenticated;
grant all on table public.course_progress to service_role;

revoke all on table public.course_attempts from public, anon, authenticated;
grant select on table public.course_attempts to authenticated;
grant all on table public.course_attempts to service_role;

-- האם למשתמש/ת המחובר/ת יש גישה פעילה. stable כדי ש-policy יוכל לקרוא לה
-- פעם אחת לשאילתה.
create or replace function public.course_has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.course_enrollments
     where user_id = auth.uid() and expires_at > now()
  );
$$;
revoke all on function public.course_has_access() from public, anon;
grant execute on function public.course_has_access() to authenticated, service_role;

drop policy if exists "course chapters are public" on public.course_chapters;
create policy "course chapters are public" on public.course_chapters
  for select using (published);

drop policy if exists "course lessons by access" on public.course_lessons;
create policy "course lessons by access" on public.course_lessons
  for select using (published and (is_free or public.course_has_access()));

drop policy if exists "course orders own" on public.course_orders;
create policy "course orders own" on public.course_orders
  for select using (user_id = auth.uid());

drop policy if exists "course enrollment own" on public.course_enrollments;
create policy "course enrollment own" on public.course_enrollments
  for select using (user_id = auth.uid());

drop policy if exists "course progress own" on public.course_progress;
create policy "course progress own" on public.course_progress
  for select using (user_id = auth.uid());

drop policy if exists "course attempts own" on public.course_attempts;
create policy "course attempts own" on public.course_attempts
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. המחיר - במסד, לא בדפדפן
-- ---------------------------------------------------------------------------
create or replace function public.course_price()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gross  numeric;
  v_vat    numeric;
  v_months int;
begin
  select value into v_gross from public.pricing_config where key = 'course_price_gross';
  if v_gross is null then
    return jsonb_build_object('error', 'price_not_configured');
  end if;
  select value into v_vat from public.pricing_config where key = 'vat_rate';
  v_vat := coalesce(v_vat, 0.18);
  select value::int into v_months from public.pricing_config where key = 'course_access_months';
  v_months := coalesce(v_months, 6);

  return jsonb_build_object(
    'amount', v_gross,
    'amount_before_vat', round(v_gross / (1 + v_vat), 2),
    'vat_rate', v_vat,
    'months', v_months
  );
end;
$$;
revoke all on function public.course_price() from public, anon, authenticated;
grant execute on function public.course_price() to service_role;

-- ---------------------------------------------------------------------------
-- 7. פאזה 1 - פתיחת ההזמנה (course-purchase)
-- ---------------------------------------------------------------------------
create or replace function public.start_course_order(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price jsonb;
  v_id    uuid;
  v_open  int;
begin
  if p_user_id is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  v_price := public.course_price();
  if v_price ? 'error' then return v_price; end if;

  -- אותו חסם של ad_orders: לחיצות חוזרות אינן פותחות תור של pending
  select count(*) into v_open from public.course_orders
   where user_id = p_user_id and status = 'pending'
     and created_at > now() - interval '30 minutes';
  if v_open >= 3 then
    return jsonb_build_object('error', 'too_many_open_orders');
  end if;

  insert into public.course_orders
    (user_id, email, months, amount, amount_before_vat, vat_rate, status, provider)
  values
    (p_user_id, left(coalesce(p_email, ''), 200), (v_price->>'months')::int,
     (v_price->>'amount')::numeric,
     (v_price->>'amount_before_vat')::numeric,
     (v_price->>'vat_rate')::numeric,
     'pending', 'morning')
  returning id into v_id;

  return jsonb_build_object('success', true, 'order_id', v_id,
                            'amount', (v_price->>'amount')::numeric,
                            'months', (v_price->>'months')::int);
end;
$$;
revoke all on function public.start_course_order(uuid, text) from public, anon, authenticated;
grant execute on function public.start_course_order(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. פאזה 2 - פתיחת הגישה
--
-- **הפונקציה היחידה שפותחת גישה בתשלום.** נעילת שורה, בדיקת סטטוס, והשוואת
-- סכום מול מה שאנחנו רשמנו. התקופה מצטברת: רכישה לפני שהגישה נגמרה
-- מתחילה מסופה.
-- ---------------------------------------------------------------------------
create or replace function public.complete_course_order(
  p_order_id           uuid,
  p_verified_amount    numeric,
  p_provider_charge_id text default null,
  p_document_id        text default null,
  p_pdf_url            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.course_orders;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  select * into v_order from public.course_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('error', 'order_not_found');
  end if;
  if v_order.status = 'success' then
    return jsonb_build_object('success', true, 'already_completed', true);
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('error', 'order_not_pending', 'status', v_order.status);
  end if;

  if p_verified_amount is not null and p_verified_amount <> v_order.amount then
    update public.course_orders
       set status = 'failed',
           failure_reason = format('amount_mismatch: expected %s, provider reported %s',
                                   v_order.amount, p_verified_amount)
     where id = p_order_id;
    return jsonb_build_object('error', 'amount_mismatch',
                              'expected', v_order.amount, 'reported', p_verified_amount);
  end if;

  select case when expires_at > now() then expires_at else now() end
    into v_from
    from public.course_enrollments where user_id = v_order.user_id;
  v_from := coalesce(v_from, now());
  v_to := v_from + (v_order.months || ' months')::interval;

  insert into public.course_enrollments (user_id, email, starts_at, expires_at, test_mode)
  values (v_order.user_id, v_order.email, now(), v_to, false)
  on conflict (user_id) do update
    set expires_at = excluded.expires_at,
        email      = coalesce(excluded.email, public.course_enrollments.email),
        test_mode  = false,
        updated_at = now();

  update public.course_orders
     set status               = 'success',
         completed_at         = now(),
         provider_charge_id   = coalesce(p_provider_charge_id, provider_charge_id),
         provider_document_id = coalesce(p_document_id, provider_document_id),
         provider_pdf_url     = coalesce(p_pdf_url, provider_pdf_url),
         period_start         = v_from,
         period_end           = v_to
   where id = p_order_id;

  return jsonb_build_object('success', true, 'user_id', v_order.user_id,
                            'period_start', v_from, 'period_end', v_to);
end;
$$;
revoke all on function public.complete_course_order(uuid, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_course_order(uuid, numeric, text, text, text) to service_role;

create or replace function public.fail_course_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.course_orders
     set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 300)
   where id = p_order_id and status = 'pending';
  return jsonb_build_object('success', found);
end;
$$;
revoke all on function public.fail_course_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_course_order(uuid, text) to service_role;

-- גישה בלי תשלום - למנהל/ת פלטפורמה (בדיקות) ולמי שתומר פותח/ת לו/ה ידנית.
-- נקראת רק מ-course-purchase אחרי בדיקת is_platform_admin, או ב-SQL ידני.
create or replace function public.course_grant_access(p_user_id uuid, p_months int default 6, p_test_mode boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_email text;
begin
  if p_user_id is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select email into v_email from auth.users where id = p_user_id;
  select case when expires_at > now() then expires_at else now() end
    into v_from from public.course_enrollments where user_id = p_user_id;
  v_from := coalesce(v_from, now());
  v_to := v_from + (greatest(coalesce(p_months, 6), 1) || ' months')::interval;
  insert into public.course_enrollments (user_id, email, starts_at, expires_at, test_mode)
  values (p_user_id, v_email, now(), v_to, coalesce(p_test_mode, true))
  on conflict (user_id) do update
    set expires_at = excluded.expires_at, updated_at = now();
  return jsonb_build_object('success', true, 'expires_at', v_to);
end;
$$;
revoke all on function public.course_grant_access(uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.course_grant_access(uuid, int, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 9. מה הלומד/ת רואה כשהדף נפתח
-- ---------------------------------------------------------------------------
create or replace function public.course_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_enr public.course_enrollments;
  v_progress jsonb;
  v_exams jsonb;
  v_total int;
  v_done int;
  v_pending boolean;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  select * into v_enr from public.course_enrollments where user_id = v_uid;

  select exists (
    select 1 from public.course_orders
     where user_id = v_uid and status = 'pending'
       and created_at > now() - interval '3 hours'
  ) into v_pending;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id', p.lesson_id,
           'opened_at', p.opened_at,
           'completed_at', p.completed_at,
           'best_score', p.best_score)), '[]'::jsonb)
    into v_progress
    from public.course_progress p where p.user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'total', a.total, 'correct', a.correct,
           'passed', a.passed, 'finished_at', a.finished_at)
           order by a.finished_at desc), '[]'::jsonb)
    into v_exams
    from (select * from public.course_attempts
           where user_id = v_uid and kind = 'exam' and finished_at is not null
           order by finished_at desc limit 10) a;

  select count(*) into v_total from public.course_lessons where published;
  select count(*) into v_done from public.course_progress p
    join public.course_lessons l on l.id = p.lesson_id and l.published
   where p.user_id = v_uid and p.completed_at is not null;

  return jsonb_build_object(
    'enrolled', v_enr.user_id is not null and v_enr.expires_at > now(),
    'expires_at', v_enr.expires_at,
    'expired', v_enr.user_id is not null and v_enr.expires_at <= now(),
    'test_mode', coalesce(v_enr.test_mode, false),
    'pending_order', v_pending,
    'lessons_total', v_total,
    'lessons_done', v_done,
    'progress', v_progress,
    'exams', v_exams,
    'exam_questions', (select value::int from public.pricing_config where key = 'course_exam_questions'),
    'pass_pct', (select value::int from public.pricing_config where key = 'course_exam_pass_pct')
  );
end;
$$;
revoke all on function public.course_me() from public, anon;
grant execute on function public.course_me() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9א. הקטלוג לדף המכירה - פתוח לכולם, קריאה בלבד
--
-- ‏course.html מציג את הפרקים ואת שמות השיעורים גם למי שלא רכש/ה. RLS של
-- course_lessons מסתיר מ-anon כל שיעור שאינו חינמי, ולכן הכותרות מגיעות
-- מכאן: שמות וספירות בלבד, בלי גוף השיעור ובלי שאלות. רשומה ב-PUBLIC_RPC
-- של הסוכן התפעולי (ops_agent/config.py).
-- ---------------------------------------------------------------------------
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
    'exam_questions_total', (select count(*) from public.course_questions where published and kind = 'exam')
  );
$$;
revoke all on function public.course_catalog() from public;
grant execute on function public.course_catalog() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. פתיחת שיעור
--
-- רושמת opened_at, ושיעור שאין בו שאלות מסומן כהושלם כבר כאן - אחרת
-- אי אפשר היה להשלים אותו לעולם.
-- ---------------------------------------------------------------------------
create or replace function public.course_lesson_open(p_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lesson public.course_lessons;
  v_q int;
begin
  if v_uid is null then return jsonb_build_object('error', 'unauthorized'); end if;
  select * into v_lesson from public.course_lessons where id = p_lesson_id and published;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not v_lesson.is_free and not public.course_has_access() then
    return jsonb_build_object('error', 'course_not_enrolled');
  end if;

  select count(*) into v_q from public.course_questions
   where lesson_id = p_lesson_id and published;

  insert into public.course_progress (user_id, lesson_id, opened_at, completed_at)
  values (v_uid, p_lesson_id, now(), case when v_q = 0 then now() end)
  on conflict (user_id, lesson_id) do update
    set opened_at = now(),
        completed_at = coalesce(public.course_progress.completed_at,
                                case when v_q = 0 then now() end);

  return jsonb_build_object('success', true, 'questions', v_q);
end;
$$;
revoke all on function public.course_lesson_open(uuid) from public, anon;
grant execute on function public.course_lesson_open(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. התחלת ניסיון: חידון שיעור, סימולציה, או חזרה על טעויות
--
-- מחזירה את השאלות **בלי** התשובה וההסבר. הסימולציה מגרילה
-- course_exam_questions שאלות, קודם ממבחנים אמיתיים ואז מתרגול.
-- ---------------------------------------------------------------------------
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
    select coalesce(array_agg(q order by last_at desc), '{}') into v_ids from (
      select distinct on (q) (a.elem->>'q')::uuid as q,
             (a.elem->>'ok')::boolean as ok, a.started_at as last_at
        from (select t.started_at, e.elem
                from public.course_attempts t, jsonb_array_elements(t.answers) e(elem)
               where t.user_id = v_uid) a
       order by q, a.started_at desc
    ) latest
    join public.course_questions cq on cq.id = latest.q and cq.published
    where latest.ok = false
    limit 25;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('success', true, 'attempt_id', null, 'questions', '[]'::jsonb);
  end if;

  insert into public.course_attempts (user_id, kind, lesson_id, question_ids, total)
  values (v_uid, p_kind, case when p_kind = 'quiz' then p_lesson_id end, v_ids, array_length(v_ids, 1))
  returning id into v_attempt;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'question', q.question, 'options', q.options,
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

-- ---------------------------------------------------------------------------
-- 12. מענה על שאלה
--
-- הבדיקה כאן, לא בדפדפן. בחידון ובחזרה התשובה חוזרת מיד עם ההסבר;
-- בסימולציה חוזר רק אישור, וההסברים מגיעים בסיום.
-- ---------------------------------------------------------------------------
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
  v_ok := (v_q.correct = p_choice) or (v_q.accepted is not null and p_choice = any (v_q.accepted));

  update public.course_attempts
     set answers = answers || jsonb_build_object('q', p_question_id, 'c', p_choice, 'ok', v_ok)
   where id = p_attempt_id;

  if v_att.kind = 'exam' then
    return jsonb_build_object('success', true, 'recorded', true);
  end if;
  return jsonb_build_object('success', true, 'ok', v_ok, 'correct', v_q.correct,
                            'accepted', to_jsonb(v_q.accepted),
                            'explanation', v_q.explanation, 'law_ref', v_q.law_ref);
end;
$$;
revoke all on function public.course_answer(uuid, uuid, int) from public, anon;
grant execute on function public.course_answer(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. סיום ניסיון
--
-- מחשבת ציון, מסמנת שיעור כהושלם כשחידון עבר את הסף, ומחזירה את הסקירה
-- המלאה (כולל שאלות שלא נענו - הן נספרות כשגויות, כמו בבחינה).
-- ---------------------------------------------------------------------------
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
           'id', q.id, 'question', q.question, 'options', q.options,
           'correct', q.correct, 'accepted', to_jsonb(q.accepted),
           'explanation', q.explanation, 'law_ref', q.law_ref,
           'source', q.source,
           'choice', (select (e->>'c')::int from jsonb_array_elements(v_att.answers) e
                       where (e->>'q')::uuid = q.id limit 1),
           'ok', coalesce((select (e->>'ok')::boolean from jsonb_array_elements(v_att.answers) e
                            where (e->>'q')::uuid = q.id limit 1), false))
           order by ord)
    into v_review
    from unnest(v_att.question_ids) with ordinality as u(id, ord)
    join public.course_questions q on q.id = u.id;

  return jsonb_build_object('success', true, 'kind', v_att.kind, 'total', v_att.total,
                            'correct', v_correct, 'pct', v_pct, 'passed', v_passed,
                            'pass_pct', v_pass, 'review', coalesce(v_review, '[]'::jsonb));
end;
$$;
revoke all on function public.course_attempt_finish(uuid) from public, anon;
grant execute on function public.course_attempt_finish(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. ה-reconcile רואה גם את הטבלה החמישית
--
-- זהה ל-20270107090000 פרט לשורה הנוספת בתנאי. superset כמו שם.
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן מחדש';
    return;
  end if;

  perform cron.unschedule('wallet-topup-reconcile')
    where exists (select 1 from cron.job where jobname = 'wallet-topup-reconcile');

  perform cron.schedule('wallet-topup-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (select 1 from public.wallet_topups       where status = 'pending')
       or exists (select 1 from public.subscription_orders where status = 'pending')
       or exists (select 1 from public.ad_orders           where status = 'pending')
       or exists (select 1 from public.developer_topups    where status = 'pending')
       or exists (select 1 from public.course_orders       where status = 'pending');
  $cron$, v_base || 'wallet-topup-callback?mode=reconcile'));
end;
$$;
