-- ============================================================================
-- תזכורת לאימות רישיון - 48 שעות ו-7 ימים אחרי ההרשמה
--
-- שלב 5 בשדרוג אזור הניהול (docs/admin-redesign/HANDOFF.md, סעיף 7).
--
-- החשבון נפתח לפני אישור הרישיון, ומה שמחכה הוא האוויר: דף הסוכן/ת, דף
-- המשרד והמודעות (20270216090000_license_hold.sql). הכרטיס בראש הדשבורד
-- אומר את זה - אבל רק למי שנכנס/ה שוב. מי שנרשם/ה ולא חזר/ה לא שמע/ה על כך
-- דבר.
--
-- הכלל:
--   • **48 שעות** אחרי ההרשמה בלי `agent_license_ok` - פעמון (ומשם וואטסאפ
--     דרך notification-push) ומייל.
--   • **7 ימים** - תזכורת שנייה. אחר כך לא.
--   • **מי ששלח/ה צילום שמחכה לבדיקה** (`broker_license_appeals`, ‏pending)
--     אינו/ה מקבל/ת: הוא/היא עשה/תה את שלו/ה, והתור הוא שלנו (תיבת המשימות).
--   • **רק מי שנכנס/ה בעצמו/ה** (`user_id`). כרטיס שמנהל/ת המשרד פתח/ה לסוכן/ת
--     שעוד לא נכנס/ה אינו הרשמה: הפעמון שלו לא נקרא, ומייל "הדף שלך לא מוצג"
--     למי שלא הצטרף/ה הוא בלבול. ב-21.10.2026 שישה מתוך שבעה היו כאלה. השעון
--     מתחיל בכניסה (`greatest` של הכרטיס ושל המשתמש/ת), לא ביום שהכרטיס נפתח.
--   • **חלון של 30 יום:** חשבון ותיק יותר אינו "נרשם/ה עכשיו", ותזכורת ראשונה
--     אחרי חודשיים היא רעש. מי שנכנס/ה לחלון אחרי 7 ימים מקבל/ת רק את השנייה.
--
-- **אין כפילות עם מדריך ההתחלה:** ארבעת הדרבונים שלו (`onboarding_property`
-- ואחיו) נולדים מאירוע ועוסקים בצעדים שאחרי הרישיון. הרישיון עצמו לא היה לו
-- דרבון - רק הכרטיס בדשבורד, שאינו הודעה.
--
-- הסימון והפעמון נעשים כאן, בטרנזקציה אחת (`license_reminders_run`). המייל
-- יוצא אחר כך מ-`license-reminder` (Edge Function), כי שליחת מייל צריכה את
-- `sendPlatformEmail`. הסדר מעדיף את הכיוון הפחות מזיק: ריצה שנפלה אחרי
-- הסימון מחמיצה מייל, ולא שולחת לכולם פעמיים (כמו promo-lifecycle).
-- ============================================================================

select public.notification_types_add(array['onboarding_license']);

-- ---------------------------------------------------------------------------
-- היומן: שלב לכל סוכן/ת, פעם אחת
-- ---------------------------------------------------------------------------

create table if not exists public.license_reminders (
  member_id uuid not null references public.agency_members(id) on delete cascade,
  stage     smallint not null check (stage in (1, 2)),   -- 1 = 48 שעות, 2 = 7 ימים
  sent_at   timestamptz not null default now(),
  primary key (member_id, stage)
);

comment on table public.license_reminders is
  'תזכורות אימות רישיון שנשלחו (48 שעות = 1, שבוע = 2). docs/broker-registry.md';

alter table public.license_reminders enable row level security;
-- אין קריאה מהדפדפן: היומן משמש רק את הריצה היומית
revoke all on table public.license_reminders from anon, authenticated, service_role;
grant select, insert, delete on table public.license_reminders to service_role;

-- ---------------------------------------------------------------------------
-- המועמדים
--
-- קריאה בלבד - גם ה-dry_run של הפונקציה עובר כאן. ‏stage הוא השלב הגבוה
-- שהגיע זמנו; מי שכבר קיבל/ה אותו (או שלב גבוה יותר) אינו/ה ברשימה.
-- ---------------------------------------------------------------------------

create or replace function public.license_reminder_candidates()
returns table (
  member_id    uuid,
  stage        smallint,
  display_name text,
  email        text,
  is_manager   boolean,
  no_number    boolean,
  held         int
)
language sql
stable
security definer
set search_path = ''
as $$
  with joined as (
    select m.*, greatest(m.created_at, u.created_at) as joined_at
      from public.agency_members m
      join auth.users u on u.id = m.user_id
     where m.active
       and m.closed_at is null
       and not public.agent_license_ok(m.license_number, m.license_status)
  ), due as (
    select j.*,
           (case when now() - j.joined_at >= interval '7 days' then 2 else 1 end)::smallint as due_stage
      from joined j
     where j.joined_at <= now() - interval '48 hours'
       and j.joined_at >  now() - interval '30 days'
  )
  select d.id,
         d.due_stage,
         d.display_name,
         d.email,
         d.role = 'manager',
         d.license_number is null,
         (select count(*)::int from public.properties p
           where p.agent_id = d.id and p.license_hold_at is not null)
    from due d
   where not exists (select 1 from public.license_reminders r
                      where r.member_id = d.id and r.stage >= d.due_stage)
     and not exists (select 1 from public.broker_license_appeals a
                      where a.status = 'pending'
                        and ((d.email is not null and lower(a.applicant_email) = lower(d.email))
                          or (d.license_number is not null and a.license_number = d.license_number)));
$$;

revoke all on function public.license_reminder_candidates() from public, anon, authenticated;
grant execute on function public.license_reminder_candidates() to service_role;

-- ---------------------------------------------------------------------------
-- הריצה: סימון, פעמון, והחזרת השורות למייל
--
-- השלב שנשלח נרשם יחד עם השלבים שלפניו: מי שקיבל/ה ישר את השנייה (נכנס/ה
-- לחלון אחרי שבוע) אינו/ה מקבל/ת את הראשונה למחרת.
-- ---------------------------------------------------------------------------

create or replace function public.license_reminders_run()
returns table (
  member_id    uuid,
  stage        smallint,
  display_name text,
  email        text,
  is_manager   boolean,
  no_number    boolean,
  held         int
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c record;
  v_title text;
  v_body  text;
begin
  for c in select * from public.license_reminder_candidates() limit 500 loop
    insert into public.license_reminders (member_id, stage)
    select c.member_id, s::smallint from generate_series(1, c.stage) s
    on conflict do nothing;

    v_title := (case when c.stage = 2 then 'תזכורת: ' else '' end)
      || (case when c.is_manager then 'דף המשרד והדף שלך עוד לא מוצגים לגולשים'
               else 'הדף שלך עוד לא מוצג לגולשים' end);
    v_body := (case when c.no_number
                    then 'חסר מספר רישיון התיווך. הוספת המספר לוקחת דקה'
                    else 'העלאת אישור הרישיון לוקחת דקה' end)
      || ', והכול עולה לאוויר מיד עם האישור.'
      || (case when c.held = 1 then ' מודעה אחת ממתינה.'
               when c.held > 1 then ' ' || c.held || ' מודעות ממתינות.'
               else '' end);

    insert into public.notifications (agent_id, type, title, body)
    values (c.member_id, 'onboarding_license', v_title, v_body);

    member_id := c.member_id; stage := c.stage; display_name := c.display_name;
    email := c.email; is_manager := c.is_manager; no_number := c.no_number; held := c.held;
    return next;
  end loop;
end;
$$;

revoke all on function public.license_reminders_run() from public, anon, authenticated;
grant execute on function public.license_reminders_run() to service_role;

-- ---------------------------------------------------------------------------
-- פעם ביום, 07:23 UTC (בוקר בישראל). הוואטסאפ עובר את שעות השקט של
-- notification-push כמו כל התראה.
-- ---------------------------------------------------------------------------

do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/license-reminder';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - יש לתזמן את license-reminder בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('license-reminder')
    where exists (select 1 from cron.job where jobname = 'license-reminder');

  perform cron.schedule('license-reminder', '23 7 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    );
  $cron$, v_url));
end;
$$;
