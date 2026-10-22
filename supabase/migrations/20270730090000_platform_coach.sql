-- ============================================================================
-- המנטור של מנהל/ת הפלטפורמה - סיכום שבועי, ועדכון באמצע השבוע רק על חריגה
--
-- שלב 9 בשדרוג אזור הניהול (docs/admin-redesign/HANDOFF.md, סעיף 9). תומר,
-- 22.10.2026: "שבועי + חריגות". אותו רכיב ואותו חוזה פלט (v2) של שלושת
-- המנטורים, דרך office-coach עם ‏?kind=platform. ‏docs/coaches.md.
--
--   ‏· ראשון בבוקר: סיכום שבועי.
--   ‏· שני עד שבת: הפונקציה רצה כל בוקר, מחשבת את החריגות (payload.ts,
--     ‏platformTriggers) ו**קוראת למודל רק כשיש חריגה שלא הופיעה בסיכום
--     האחרון**. בוקר בלי חריגה חדשה - בלי קריאה, בלי שורה ובלי התראה.
--
-- הקלט (‏platform_coach_input) הוא אותן שש פונקציות שמזינות את מרכז הפיקוד,
-- כדי שהמנטור ידבר על המספרים שמנהל/ת הפלטפורמה רואה/ה. הצמצום לאגרגטים -
-- בלי שמות משרדים, סוכנים ופונים - ב-compactPlatform, ונבדק ב-
-- scripts/office_coach_test.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ההתראה - "המנטור: ..." בפעמון של מנהלי הפלטפורמה
-- ---------------------------------------------------------------------------
select public.notification_types_add(array['platform_coach']);

-- ---------------------------------------------------------------------------
-- 2. הסיכומים. שורה ליום לכל היותר: weekly בראשון (או ביום הראשון שבו
--    ההרצה הצליחה באותו שבוע), exception בכל יום אחר שבו הייתה חריגה חדשה.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_coach_summaries (
  id                 uuid primary key default gen_random_uuid(),
  day                date not null unique,
  kind               text not null check (kind in ('weekly', 'exception')),
  summary            jsonb not null,
  -- החריגות שהיו בקלט (platformTriggers) - כדי שאותה חריגה לא תחזור מחר
  triggers           text[] not null default '{}',
  model              text,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  actions_done       smallint[] not null default '{}',
  created_at         timestamptz not null default now()
);

comment on table public.platform_coach_summaries is
  'המנטור של מנהל/ת הפלטפורמה: סיכום שבועי (weekly) ועדכון על חריגה חדשה (exception). אגרגטים בלבד. נכתב ב-office-coach?kind=platform. docs/coaches.md';

alter table public.platform_coach_summaries enable row level security;

drop policy if exists platform_coach_summaries_admin_read on public.platform_coach_summaries;
create policy platform_coach_summaries_admin_read on public.platform_coach_summaries
  for select to authenticated using (public.current_is_platform_admin());

revoke all on table public.platform_coach_summaries from anon, authenticated;
grant select on table public.platform_coach_summaries to authenticated;
grant select, insert, update on table public.platform_coach_summaries to service_role;

-- ---------------------------------------------------------------------------
-- 3. הקלט: שש הפונקציות של מרכז הפיקוד, כפי שמנהל/ת הפלטפורמה רואה/ה אותן
--
-- כל אחת בודקת current_is_platform_admin(), כלומר auth.uid() של מנהל/ת.
-- ‏office-coach רץ מ-cron עם service_role, בלי משתמש/ת - ולכן הפונקציה הזו
-- (שרק service_role מריץ) מציבה בתוך הטרנזקציה את ה-claims של מנהל/ת
-- פלטפורמה פעיל/ה, קוראת לשש, ומחזירה את ה-claims למה שהיו. החלופה - ליבה
-- ועטיפה לכל אחת מהשש - הייתה מעתיקה שש פונקציות שלמות לטובת קורא אחד.
-- הפלט גולמי, כולל שמות (stuck_license, agencies); הצמצום ב-compactPlatform.
-- ---------------------------------------------------------------------------
create or replace function public.platform_coach_input()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin  uuid;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  v_out    jsonb;
begin
  select m.user_id into v_admin
    from public.agency_members m
   where m.is_platform_admin and m.active and m.user_id is not null
   order by m.created_at
   limit 1;
  if v_admin is null then
    raise exception 'platform_coach_input: no platform admin' using errcode = 'P0002';
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_out := jsonb_build_object(
    'generated_at', now(),
    'cc',     public.admin_command_center(),
    'report', public.platform_admin_monthly_report(3),
    'counts', public.admin_inbox_counts(),
    'growth', public.admin_growth(),
    'budget', public.platform_budget_status(),
    'ads',    public.admin_ads_spend(null, null)
  );

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_out;
end $$;

comment on function public.platform_coach_input() is
  'הקלט של המנטור למנהל/ת הפלטפורמה: אותן שש פונקציות של מרכז הפיקוד. service_role בלבד (office-coach). הצמצום לאגרגטים ב-compactPlatform. docs/coaches.md';

revoke all on function public.platform_coach_input() from public, anon, authenticated;
grant execute on function public.platform_coach_input() to service_role;

-- ---------------------------------------------------------------------------
-- 4. "סמן כבוצע" - גם למנטור הפלטפורמה. העתק מלא מ-20270601160000, עם ענף
--    platform בסוף.
-- ---------------------------------------------------------------------------
create or replace function public.coach_action_done(p_kind text, p_summary_id uuid, p_index int, p_done boolean)
returns smallint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out smallint[];
  v_i   smallint;
begin
  if p_index is null or p_index not between 0 and 2 then
    raise exception 'coach_action_done: bad index' using errcode = '22023';
  end if;
  v_i := p_index::smallint;

  if p_kind = 'agent' then
    update public.agent_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id and s.agent_id = public.current_agent_id()
    returning s.actions_done into v_out;
  elsif p_kind = 'team' then
    update public.team_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id
       and (s.team_id = public.current_led_team_id()
            or (public.current_member_role() = 'manager' and s.agency_id = public.current_agency_id()))
    returning s.actions_done into v_out;
  elsif p_kind = 'office' then
    update public.office_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id
       and public.current_member_role() = 'manager' and s.agency_id = public.current_agency_id()
    returning s.actions_done into v_out;
  elsif p_kind = 'platform' then
    update public.platform_coach_summaries s
       set actions_done = case when coalesce(p_done, false)
                               then array(select distinct x from unnest(s.actions_done || v_i) x order by x)
                               else array_remove(s.actions_done, v_i) end
     where s.id = p_summary_id and public.current_is_platform_admin()
    returning s.actions_done into v_out;
  else
    raise exception 'coach_action_done: bad kind' using errcode = '22023';
  end if;

  if v_out is null then
    raise exception 'coach_action_done: not allowed' using errcode = '42501';
  end if;
  return v_out;
end;
$$;
revoke all on function public.coach_action_done(text, uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.coach_action_done(text, uuid, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. כל בוקר, 05:37 UTC (‏08:37 בקיץ). ראשון - הסיכום השבועי; שאר הימים -
--    רק אם יש חריגה חדשה (ההחלטה בפונקציה, בלי קריאה למודל כשאין).
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/office-coach?kind=platform';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - יש לתזמן את platform-coach בדרך אחרת';
    return;
  end if;
  perform cron.unschedule('platform-coach')
    where exists (select 1 from cron.job where jobname = 'platform-coach');
  perform cron.schedule('platform-coach', '37 5 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 150000
    );
  $cron$, v_url));
end;
$$;
