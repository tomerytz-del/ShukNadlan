-- ============================================================================
-- דגם דירה תלת-ממדי, שלב ב': דלי תוכניות המקור, והחזר אוטומטי לדגם תקוע
--
-- ## מה חסר אחרי שלב א'
--
-- ‏`start_plan_model` מחייבת ₪49 לפני שקריאת התוכנית רצה. ה-Edge Function
-- (`plan-model`) מחזירה את הכסף בכל כישלון שהיא רואה, אבל יש כישלונות שהיא אינה
-- רואה: הפונקציה נהרגה באמצע (תקרת זמן, פריסה), או שההחזר עצמו נכשל פעמיים. אז
-- נשאר דגם ב-`draft` או `reading` שכבר שולם עליו ולעולם לא יושלם, ושקט מוחלט:
-- אין שגיאה ואין מי שיבחין, חוץ מהסוכן/ת שרואה ₪49 שירדו ודגם שלא הגיע.
--
-- ## מה נכנס
--
-- 1. הדלי `plan-sources`: **פרטי**. תוכנית של דגם שלא פורסם היא חומר של היזם.
--    אין policies: רק ה-Edge Function (service_role) כותבת וקוראת, והבעלים מקבל/ת
--    כתובת חתומה לשעה (`plan_url`). הצופה אינו צריך את התוכנית, רק את המודל.
-- 2. ‏`plan_models_refund_stuck(p_minutes)`: מחזירה כל דגם שתקוע יותר מהחלון, דרך
--    `fail_plan_model` (ההחזר לפי שורת החיוב, אידמפוטנטי). החלון 30 דקות, ולא פחות
--    מ-10: קריאת תוכנית אורכת עד כשתי דקות, והחזר לדגם שעוד נקרא היה מחזיר כסף
--    על דגם שמיד אחר כך נפתח.
-- 3. ‏cron כל 10 דקות, **בלי HTTP**: הפונקציה רצה במסד עצמו. התנאי `where exists`
--    מונע 144 הרצות ריקות ביום כשאין דגם פתוח.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הדלי
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plan-sources', 'plan-sources', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. החזר לדגם תקוע
-- ---------------------------------------------------------------------------
create or replace function public.plan_models_refund_stuck(p_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_n   integer := 0;
begin
  for v_row in
    select id from public.plan_models
     where status in ('draft', 'reading')
       and updated_at < now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 10))
     order by updated_at
     limit 200
       for update skip locked
  loop
    perform public.fail_plan_model(v_row.id, 'stuck: no result within window');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.plan_models_refund_stuck(integer) is
  'מחזיר לארנק דגמי דירה שנשארו ב-draft/reading מעבר לחלון (ברירת מחדל 30 דקות, מינימום 10), דרך fail_plan_model. רץ מ-cron כל 10 דקות. docs/plan-3d-tour.md';

revoke all on function public.plan_models_refund_stuck(integer) from public, anon, authenticated;
grant execute on function public.plan_models_refund_stuck(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. התזמון
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - ההחזר האוטומטי לדגמי דירה תקועים לא תוזמן';
    return;
  end if;

  perform cron.unschedule('plan-models-refund-stuck')
    where exists (select 1 from cron.job where jobname = 'plan-models-refund-stuck');
  perform cron.schedule('plan-models-refund-stuck', '*/10 * * * *', $cron$
    select public.plan_models_refund_stuck(30)
     where exists (select 1 from public.plan_models where status in ('draft', 'reading'))
  $cron$);
end
$do$;
