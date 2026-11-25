-- ============================================================================
-- תזכורת הרישיון מדלגת על כל משרד הדגמה, לא רק על חשבון Google Play.
--
-- 20271116100000 החריגה את play.review@shuknadlan.co.il לפי מייל. מאז נוסף
-- agencies.is_demo (20271130130000), ונפתח משרד הדגמה שני, לצוות ההטמעה
-- (demo-office-almog-elkobi). גם לו אין רישיון בכוונה, ובלי השינוי הזה
-- החשבון היה מקבל שתי תזכורות "להשלים רישיון". התנאי עובר לדגל של המשרד,
-- והמייל נשאר לצדו. שאר הפונקציה זהה להגדרה האחרונה.
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
       and lower(coalesce(m.email, '')) <> 'play.review@shuknadlan.co.il'
       and not public.agency_is_demo(m.agency_id)
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
