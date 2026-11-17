-- ============================================================================
-- תזכורת רישיון: חשבון ההדגמה של Google Play אינו מקבל תזכורות
--
-- `play.review@shuknadlan.co.il` הוא חשבון הבדיקה של בודק/ת Google Play. אין לו
-- ואין צריך להיות לו מספר רישיון, ולכן הוא מופיע כל יום כ"נרשם/ה בלי רישיון"
-- ומקבל פעמון ומייל "דף המשרד והדף שלך עוד לא מוצגים לגולשים" (נראה ב-16.11.2026).
--
-- ההחרגה היא ברשימת המועמדים ולא בריצה, כדי שגם ה-dry_run של license-reminder
-- יראה אותה. הגוף זהה ל-20270723090000_license_reminder.sql, ועם תנאי אחד נוסף.
-- אידמפוטנטית: create or replace, בלי שינוי בחתימה או בהרשאות.
-- ============================================================================

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
       -- חשבון ההדגמה של Google Play: בלי רישיון בכוונה
       and lower(coalesce(m.email, '')) <> 'play.review@shuknadlan.co.il'
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
