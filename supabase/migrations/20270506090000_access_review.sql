-- ===========================================================================
-- סקירת הרשאות חצי-שנתית (access review)
--
-- ‏ISO 27001 ‏5.18 ותקנה 8 לתקנות אבטחת מידע: לבדוק מדי פעם שההרשאות עדיין
-- נכונות - מי מנהל/ת פלטפורמה, מי מנהל/ת משרד, ומי עדיין פעיל/ה אף שלא
-- נכנס/ה חודשים. החלטת הבעלים (13.10.2026): **פעמיים בשנה**, 1 בינואר
-- ו-1 ביולי.
--
-- ‏**מה קורה:** ‏access_review_open() יוצרת שורה ב-access_reviews עם צילום
-- של ההרשאות באותו רגע, ושולחת התראת access_review לכל מנהלי הפלטפורמה.
-- ב-CRM ("יומן ביקורת אבטחה") רואים את הצילום ולוחצים "עברתי ואישרתי".
-- האישור נשמר עם מי ומתי, ונרשם ביומן הביקורת - **זו הראיה לביקורת**.
-- שינוי הרשאה עצמו נעשה במסכים הרגילים (צוות, מנויים), ונרשם שם.
--
-- ‏docs/access-review.md
-- ===========================================================================

create table if not exists public.access_reviews (
  id           bigserial primary key,
  opened_at    timestamptz not null default now(),
  snapshot     jsonb not null,
  reviewed_at  timestamptz,
  reviewed_by  uuid,
  note         text
);

create index if not exists access_reviews_opened_idx on public.access_reviews (opened_at desc);

alter table public.access_reviews enable row level security;
revoke all on table public.access_reviews from public, anon, authenticated;
grant select on table public.access_reviews to authenticated;
revoke all on sequence public.access_reviews_id_seq from public, anon, authenticated;
drop policy if exists "platform admin reads access reviews" on public.access_reviews;
create policy "platform admin reads access reviews"
  on public.access_reviews for select to authenticated
  using (public.current_is_platform_admin());

do $$ begin perform public.notification_types_add(array['access_review']); end $$;

-- ---------------------------------------------------------------------------
-- הצילום: שלוש רשימות. **מה שלא נמצא כאן לא נבדק**, ולכן כל הרשאה רחבה
-- חדשה (תפקיד, דגל) נכנסת לכאן באותו PR.
-- ---------------------------------------------------------------------------
create or replace function public.access_review_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select m.id, m.user_id, m.display_name, m.email, m.role, m.active,
           m.is_platform_admin, a.name as agency_name,
           u.last_sign_in_at,
           -- מנהל/ת פלטפורמה חייב/ת אימות מעצם התפקיד (‏_mfa_pending_self,
           -- ‏docs/mfa.md), גם בלי רישום ב-agent_wa_2fa או ב-mfa_factors
           (m.is_platform_admin
            or exists (select 1 from public.agent_wa_2fa w where w.user_id = m.user_id)
            or exists (select 1 from auth.mfa_factors f
                        where f.user_id = m.user_id and f.status = 'verified')) as has_2fa
      from public.agency_members m
      left join public.agencies a on a.id = m.agency_id
      left join auth.users u on u.id = m.user_id
  )
  select jsonb_build_object(
    'platform_admins', coalesce((select jsonb_agg(jsonb_build_object(
        'name', display_name, 'email', email, 'agency', agency_name,
        'active', active, 'has_2fa', has_2fa, 'last_sign_in_at', last_sign_in_at)
        order by display_name) from m where is_platform_admin), '[]'::jsonb),
    'managers', coalesce((select jsonb_agg(jsonb_build_object(
        'name', display_name, 'email', email, 'agency', agency_name,
        'has_2fa', has_2fa, 'last_sign_in_at', last_sign_in_at)
        order by agency_name, display_name) from m where role = 'manager' and active), '[]'::jsonb),
    -- פעיל/ה במערכת אבל לא נכנס/ה 90 יום: הרשאה שאף אחד לא משתמש בה, והראשונה
    -- לבדוק אם היא עוד צריכה להיות שם.
    'dormant', coalesce((select jsonb_agg(jsonb_build_object(
        'name', display_name, 'email', email, 'agency', agency_name, 'role', role,
        'last_sign_in_at', last_sign_in_at)
        order by last_sign_in_at nulls first) from m
        where active and user_id is not null
          and (last_sign_in_at is null or last_sign_in_at < now() - interval '90 days')), '[]'::jsonb),
    'active_members', (select count(*) from m where active)
  );
$$;

revoke all on function public.access_review_snapshot() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- פתיחת סקירה: מה-cron, או ידנית מה-CRM (מנהל/ת פלטפורמה). סקירה פתוחה
-- שעוד לא אושרה אינה נפתחת שוב - הצילום שלה מתעדכן במקום.
-- ---------------------------------------------------------------------------
create or replace function public.access_review_open()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  -- מה-cron אין JWT; מהדפדפן - רק מנהל/ת פלטפורמה
  if auth.uid() is not null and not public.current_is_platform_admin() then
    raise exception 'רק מנהל/ת פלטפורמה יכול/ה לפתוח סקירת הרשאות' using errcode = '42501';
  end if;

  select id into v_id from public.access_reviews where reviewed_at is null
   order by opened_at desc limit 1;
  if v_id is not null then
    update public.access_reviews set snapshot = public.access_review_snapshot() where id = v_id;
    return v_id;
  end if;

  insert into public.access_reviews (snapshot) values (public.access_review_snapshot())
  returning id into v_id;

  insert into public.notifications (agent_id, type, title, body)
  select m.id, 'access_review',
         'סקירת הרשאות חצי-שנתית',
         'הגיע הזמן לעבור על מנהלי הפלטפורמה, מנהלי המשרדים ומי שלא נכנס/ה 90 יום, '
         || 'ולאשר ביומן הביקורת שההרשאות נכונות.'
    from public.agency_members m
   where m.is_platform_admin and m.active;
  return v_id;
end $$;

revoke all on function public.access_review_open() from public, anon, authenticated;
grant execute on function public.access_review_open() to authenticated;

create or replace function public.access_review_approve(p_id bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'רק מנהל/ת פלטפורמה יכול/ה לאשר סקירת הרשאות' using errcode = '42501';
  end if;
  update public.access_reviews
     set reviewed_at = now(), reviewed_by = auth.uid(), note = nullif(btrim(p_note), '')
   where id = p_id and reviewed_at is null;
  if not found then
    raise exception 'הסקירה לא נמצאה או שכבר אושרה' using errcode = 'P0002';
  end if;
  perform public._audit('access_review_approved', null, p_id::text,
                        jsonb_build_object('note', nullif(btrim(p_note), '')));
end $$;

revoke all on function public.access_review_approve(bigint, text) from public, anon, authenticated;
grant execute on function public.access_review_approve(bigint, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - access_review_open לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('access-review-open')
    where exists (select 1 from cron.job where jobname = 'access-review-open');
  -- ‏1 בינואר ו-1 ביולי, 06:17 UTC (09:17 / 08:17 בישראל)
  perform cron.schedule('access-review-open', '17 6 1 1,7 *',
                        'select public.access_review_open()');
end $$;
