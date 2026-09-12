-- ============================================================================
-- התיאור השיווקי האוטומטי — מסלולי PROFESSIONAL ו-Elite בלבד
-- ----------------------------------------------------------------------------
-- עד כה התיאור נכתב לכל נכס פעיל, בלי קשר למסלול של הסוכן/ת. זה היה נכון
-- כשהיכולת נבנתה — היא לא הייתה חלק מהאריזה — ומרגע שהמסלולים קיבלו שמות
-- ומחירים (‏docs/pricing-and-tiers.md) הוא הפך לפער בין מה שדף המסלולים מבטיח
-- לבין מה שהשרת נותן. המסמך מבטיח "תיאור שיווקי אוטומטי ב-AI" ב-PROFESSIONAL
-- ומעלה, וכאן זה נאכף.
--
-- **שלוש נקודות, לא אחת.** לכל אחת תפקיד שונה, ואף אחת אינה מיותרת:
--
--   1. ‏queue_property_description — נקודת הכניסה היחידה לתור. חוסמת כאן
--      פירושה שהתור נשאר נקי: בלי הבדיקה הזו כל שמירת נכס של סוכן/ת Pay&GO
--      הייתה מייצרת שורת pending שאיש לא ימשוך לעולם.
--   2. ‏pending_property_descriptions — השאילתה שדרכה **כל** מסלול אוטומטי
--      עובר. זו רשת הביטחון: גם שורה שנכנסה לתור בדרך אחרת (‏backfill, שינוי
--      מסלול אחרי ההוספה לתור) לא תיכתב.
--   3. ‏request_property_description — הבקשה הידנית מה-CRM. מחזירה
--      ‎upgrade_required‎ כדי שהממשק יסביר, במקום להיכשל בשתיקה.
--
-- ‏**מה שלא נגדר:** הפרסום האוטומטי ברשתות החברתיות
-- (‏property-marketing-publish) נשאר פתוח לכל המסלולים — הוא מפרסם לדף של
-- הפלטפורמה ומשרת את המרקטפלייס עצמו, ולא רק את הסוכן/ת.
--
-- אידמפוטנטית: ‏create or replace בלבד, בלי DDL על טבלאות.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- הזכאות במקום אחד
--
-- אותם שלושה תנאים שכל יכולת בתשלום נשענת עליהם — מסלול, פעילות ומצב חיוב —
-- בדיוק כמו ב-property_map_view וב-property_visualizations. פונקציה אחת, כדי
-- שהתשובה לא תסטה בין שלוש נקודות האכיפה.
-- ---------------------------------------------------------------------------
create or replace function public.property_description_tier_ok(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.properties p
      join public.agency_members m on m.id = p.agent_id
     where p.id = p_property_id
       and m.active = true
       and m.billing_status = 'active'
       and m.tier in ('mid', 'premium')
  );
$$;

comment on function public.property_description_tier_ok(uuid) is
  'האם לנכס הזה מותר תיאור שיווקי אוטומטי — כלומר האם הסוכן/ת שלו במסלול בתשלום פעיל.';

revoke all on function public.property_description_tier_ok(uuid) from public;
revoke all on function public.property_description_tier_ok(uuid) from anon;
grant execute on function public.property_description_tier_ok(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. נקודת הכניסה לתור
--
-- הגוף זהה למקור (20260925090000) פרט לבדיקה החדשה — ‎create or replace‎
-- מחליף את הגוף כולו, ולכן הגרסה כאן חייבת להיות שלמה.
-- ---------------------------------------------------------------------------
create or replace function public.queue_property_description(
  p_property_id   uuid,
  p_reason        text default 'missing',
  p_force         boolean default false,
  p_delay_minutes int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay int;
  v_id    uuid;
begin
  if not exists (select 1 from public.properties where id = p_property_id) then
    return null;
  end if;

  -- מסלול הסוכן/ת. ‏null (ולא חריגה) כי הקוראים — טריגר, בקשה ידנית
  -- ו-backfill — כולם מתייחסים ל-null כ"לא נכנס לתור", וזו התנהגות נכונה
  -- גם כאן: אין מה לכתוב, ואין למה להיכשל.
  if not public.property_description_tier_ok(p_property_id) then
    return null;
  end if;

  v_delay := coalesce(
    p_delay_minutes,
    (select value::int from public.pricing_config
      where key = 'marketing_description_delay_minutes'),
    10);

  insert into public.property_description_jobs (property_id, reason, run_after)
  values (p_property_id, p_reason, now() + make_interval(mins => greatest(v_delay, 0)))
  on conflict (property_id) do update
    set status       = case when p_force then 'pending' else public.property_description_jobs.status end,
        reason       = case when p_force then p_reason else public.property_description_jobs.reason end,
        attempts     = case when p_force then 0 else public.property_description_jobs.attempts end,
        last_error   = case when p_force then null else public.property_description_jobs.last_error end,
        completed_at = case when p_force then null else public.property_description_jobs.completed_at end,
        run_after    = case when p_force
                            then now() + make_interval(mins => greatest(v_delay, 0))
                            else public.property_description_jobs.run_after end
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.queue_property_description(uuid, text, boolean, int) is
  'מכניסה נכס לתור כתיבת התיאור השיווקי. נקודת הכניסה היחידה — לטריגר, לבקשה הידנית ול-backfill. מסלולי mid/premium בלבד.';

revoke all on function public.queue_property_description(uuid, text, boolean, int) from public;
revoke all on function public.queue_property_description(uuid, text, boolean, int) from anon, authenticated;
grant execute on function public.queue_property_description(uuid, text, boolean, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. משיכת התור — רשת הביטחון
--
-- ‏join ולא exists בכוונה: התנאי הוא חלק מהשאילתה שמגדירה "מה מותר לכתוב
-- עכשיו", ולא סינון שנוסף אחריה. שורה של סוכן/ת שירד/ה מ-PROFESSIONAL
-- נשארת בתור ופשוט אינה נמשכת — וחוזרת מעצמה אם הוא/היא משדרג/ת בחזרה.
-- ---------------------------------------------------------------------------
create or replace function public.pending_property_descriptions(p_limit int default 5)
returns table (job_id uuid, property_id uuid, reason text)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'marketing_description_daily_cap'), 80) as daily_cap
  ),
  written_today as (
    select count(*) as n
      from public.property_description_jobs
     where status = 'done' and completed_at > now() - interval '24 hours'
  )
  select j.id, p.id, j.reason
    from public.property_description_jobs j
    join public.properties p on p.id = j.property_id
    join public.agency_members m on m.id = p.agent_id
   cross join cap
   cross join written_today
   where j.status = 'pending'
     and j.run_after <= now()
     and p.status = 'active'
     and nullif(btrim(coalesce(p.marketing_description, '')), '') is null
     and m.active = true
     and m.billing_status = 'active'
     and m.tier in ('mid', 'premium')
     and written_today.n < cap.daily_cap
     and coalesce((select value::int from public.pricing_config
                    where key = 'marketing_description_auto_enabled'), 1) = 1
   order by j.run_after
   limit least(greatest(coalesce(p_limit, 5), 1), 25);
$$;

comment on function public.pending_property_descriptions(int) is
  'הנכסים שמותר לכתוב להם תיאור עכשיו: יש סוכן/ת במסלול בתשלום פעיל, והנכס עדיין בלי תיאור. נכס שכבר יש לו תיאור אינו חוזר מכאן — זו ההגנה שמונעת דריסת טקסט של אדם.';

revoke all on function public.pending_property_descriptions(int) from public;
revoke all on function public.pending_property_descriptions(int) from anon, authenticated;
grant execute on function public.pending_property_descriptions(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. הבקשה הידנית
--
-- ‏upgrade_required מוחזר **אחרי** בדיקת הבעלות ולפני ה-cooldown: מי שמבקש/ת
-- נוסח לנכס שאינו שלו/ה צריך/ה לקבל את התשובה הזו ולא הצצה למסלול של אחרים,
-- ומי שזכאי/ת לא צריך/ה לחכות ל-cooldown רק כדי לגלות שהיכולת חסומה.
-- ---------------------------------------------------------------------------
create or replace function public.request_property_description(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    uuid;
  v_agency   uuid;
  v_admin    boolean;
  v_prop     record;
  v_cooldown int;
  v_last     timestamptz;
  v_job      uuid;
begin
  select m.id, m.agency_id, coalesce(m.is_platform_admin, false)
    into v_agent, v_agency, v_admin
    from public.agency_members m
   where m.user_id = (select auth.uid())
     and m.active = true;

  if v_agent is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select id, agent_id, agency_id, status into v_prop
    from public.properties where id = p_property_id;
  if v_prop.id is null then
    return jsonb_build_object('error', 'property_not_found');
  end if;

  if not (v_admin or v_prop.agent_id = v_agent
          or (v_agency is not null and v_prop.agency_id = v_agency)) then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  if not public.property_description_tier_ok(p_property_id) then
    return jsonb_build_object(
      'error', 'upgrade_required',
      'detail', 'כתיבת תיאור שיווקי ב-AI זמינה במסלולים PROFESSIONAL ו-Elite');
  end if;

  v_cooldown := coalesce((select value::int from public.pricing_config
                           where key = 'marketing_description_manual_cooldown_seconds'), 45);

  select updated_at into v_last
    from public.property_description_jobs where property_id = p_property_id;
  if v_last is not null and v_last > now() - make_interval(secs => greatest(v_cooldown, 0)) then
    return jsonb_build_object('error', 'cooldown_active', 'retry_after_seconds',
      ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown)) - now()))::int);
  end if;

  v_job := public.queue_property_description(p_property_id, 'manual', true, 0);
  return jsonb_build_object('success', true, 'job_id', v_job);
end;
$$;

comment on function public.request_property_description(uuid) is
  'בקשת רענון תיאור שיווקי מהסוכן/ת: הרשאה, מסלול ו-cooldown. הכתיבה עצמה ב-Edge Function.';

revoke all on function public.request_property_description(uuid) from public;
revoke all on function public.request_property_description(uuid) from anon;
grant execute on function public.request_property_description(uuid) to authenticated, service_role;
