-- ===========================================================================
-- אזור ההטמעה: עצה מהמנטור כל בוקר (docs/csm-adoption.md, "עצה מהמנטור")
-- ---------------------------------------------------------------------------
-- המנטור של ההטמעה עונה כשהיא שואלת. כאן הוא פונה אליה מעצמו: כל בוקר עבודה,
-- בשעת סיכום הבוקר שלה, שלוש עצות קצרות מתוך התיק - עם מי להתחיל היום ולמה,
-- ומה לומר - בפעמון ובוואטסאפ, כמו שאר ההתראות (סוג mentor_tip, שאפשר לכבות).
--
-- המודל רץ ב-whatsapp-webhook?task=csm-mentor-tips (‏csmMentorTip ב-
-- ‏_shared/coach/csm.ts); כאן רק מי זכאית עכשיו, פעם ביום, ותפיסה אטומית.
--
--   1. סוג ההתראה mentor_tip: באילוץ, וב-csm_profile_apply (כדי שאפשר לכבות).
--   2. ‏csm_staff.last_tip_on, ‏csm_mentor_tip_ready() ו-csm_mentor_tip_claim().
--   3. ‏cron כל 10 דקות, שמעיר את הפונקציה רק כשיש מישהי בתור.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. הסוג
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'csm_notifications_kind_check'
              and pg_get_constraintdef(oid) not like '%mentor_tip%') then
    alter table public.csm_notifications drop constraint csm_notifications_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'csm_notifications_kind_check') then
    alter table public.csm_notifications add constraint csm_notifications_kind_check
      check (kind in ('new_agent','at_risk','meeting_reminder','call_ready','daily_digest','mentor_tip'));
  end if;
end $$;

-- ‏csm_profile_apply כמו ב-20270816090000, עם mentor_tip ברשימת הסוגים שאפשר לכבות
create or replace function public.csm_profile_apply(p_staff_id uuid, p jsonb, p_allow_phone boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.csm_staff%rowtype;
  v_txt   text;
  v_int   int;
  v_kinds text[] := array['new_agent','at_risk','meeting_reminder','call_ready','daily_digest','mentor_tip'];
  v_days  smallint[];
begin
  select * into v_row from public.csm_staff where id = p_staff_id and active for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  p := coalesce(p, '{}'::jsonb);

  if p ? 'display_name' then
    v_txt := nullif(btrim(coalesce(p->>'display_name', '')), '');
    if v_txt is null or char_length(v_txt) > 120 then
      return jsonb_build_object('error', 'bad_name');
    end if;
    v_row.display_name := v_txt;
  end if;

  if p ? 'phone' then
    if not p_allow_phone then
      return jsonb_build_object('error', 'phone_web_only');
    end if;
    v_txt := nullif(btrim(coalesce(p->>'phone', '')), '');
    if v_txt is null or public.normalize_msisdn(v_txt) is null then
      return jsonb_build_object('error', 'bad_phone');
    end if;
    -- אותו כלל של csm_staff_save: גבריאלה מזהה סוכנים קודם
    if exists (select 1 from public.agency_members m where m.phone_e164 = public.normalize_msisdn(v_txt)) then
      return jsonb_build_object('error', 'phone_is_agent');
    end if;
    if exists (select 1 from public.csm_staff s
                where s.phone_e164 = public.normalize_msisdn(v_txt) and s.id <> p_staff_id) then
      return jsonb_build_object('error', 'phone_taken');
    end if;
    v_row.phone := v_txt;
  end if;

  if p ? 'notify_whatsapp' then
    v_row.notify_whatsapp := coalesce((p->>'notify_whatsapp')::boolean, true);
  end if;

  if p ? 'notify_off' then
    if jsonb_typeof(p->'notify_off') <> 'array' then
      return jsonb_build_object('error', 'bad_notify_off');
    end if;
    select coalesce(array_agg(distinct k order by k), '{}') into v_row.notify_off
      from jsonb_array_elements_text(p->'notify_off') k where k = any(v_kinds);
  end if;

  if p ? 'digest_time' then
    if coalesce(p->>'digest_time', '') !~ '^([01]?\d|2[0-3]):[0-5]\d$' then
      return jsonb_build_object('error', 'bad_time');
    end if;
    v_row.digest_time := (p->>'digest_time')::time;
  end if;
  if p ? 'quiet_from' then
    if coalesce(p->>'quiet_from', '') !~ '^([01]?\d|2[0-3]):[0-5]\d$' then
      return jsonb_build_object('error', 'bad_time');
    end if;
    v_row.quiet_from := (p->>'quiet_from')::time;
  end if;
  if p ? 'quiet_to' then
    if coalesce(p->>'quiet_to', '') !~ '^([01]?\d|2[0-3]):[0-5]\d$' then
      return jsonb_build_object('error', 'bad_time');
    end if;
    v_row.quiet_to := (p->>'quiet_to')::time;
  end if;

  if p ? 'work_days' then
    if jsonb_typeof(p->'work_days') <> 'array' then
      return jsonb_build_object('error', 'bad_days');
    end if;
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days
      from jsonb_array_elements_text(p->'work_days') d where d ~ '^[0-6]$';
    v_row.work_days := v_days;
  end if;

  if p ? 'meeting_minutes' then
    v_int := case when coalesce(p->>'meeting_minutes', '') ~ '^\d{1,4}$' then (p->>'meeting_minutes')::int end;
    if v_int is null or v_int not between 10 and 240 then
      return jsonb_build_object('error', 'bad_minutes');
    end if;
    v_row.meeting_minutes := v_int;
  end if;
  if p ? 'reminder_minutes' then
    v_int := case when coalesce(p->>'reminder_minutes', '') ~ '^\d{1,4}$' then (p->>'reminder_minutes')::int end;
    if v_int is null or v_int not between 0 and 1440 then
      return jsonb_build_object('error', 'bad_minutes');
    end if;
    v_row.reminder_minutes := v_int;
  end if;

  if p ? 'meeting_link' then
    v_txt := nullif(btrim(coalesce(p->>'meeting_link', '')), '');
    if v_txt is not null and (char_length(v_txt) > 500 or v_txt !~* '^https://') then
      return jsonb_build_object('error', 'bad_link');
    end if;
    v_row.meeting_link := v_txt;
  end if;

  update public.csm_staff set
    display_name = v_row.display_name, phone = v_row.phone,
    notify_whatsapp = v_row.notify_whatsapp, notify_off = v_row.notify_off,
    digest_time = v_row.digest_time, quiet_from = v_row.quiet_from, quiet_to = v_row.quiet_to,
    work_days = v_row.work_days, meeting_minutes = v_row.meeting_minutes,
    reminder_minutes = v_row.reminder_minutes, meeting_link = v_row.meeting_link
   where id = p_staff_id;
  return jsonb_build_object('success', true, 'profile', public._csm_profile_json(p_staff_id));
exception when unique_violation then
  return jsonb_build_object('error', 'phone_taken');
end;
$$;

revoke all on function public.csm_profile_apply(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.csm_profile_apply(uuid, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. מי זכאית עכשיו: פעילה, הסוג דלוק, יום עבודה שלה, אחרי שעת סיכום הבוקר
--    ועד שלוש שעות אחריה (פריסה בצהריים לא שולחת "עצה לבוקר" בערב), פעם ביום
-- ---------------------------------------------------------------------------
alter table public.csm_staff add column if not exists last_tip_on date;

create or replace function public.csm_mentor_tip_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.csm_staff s
     where s.active and not ('mentor_tip' = any(s.notify_off))
       and s.last_tip_on is distinct from (now() at time zone 'Asia/Jerusalem')::date
       and extract(dow from now() at time zone 'Asia/Jerusalem')::smallint = any(s.work_days)
       and (now() at time zone 'Asia/Jerusalem') >= (now() at time zone 'Asia/Jerusalem')::date + s.digest_time
       and (now() at time zone 'Asia/Jerusalem') <  (now() at time zone 'Asia/Jerusalem')::date + s.digest_time + interval '3 hours');
$$;

revoke all on function public.csm_mentor_tip_ready() from public, anon, authenticated;
grant execute on function public.csm_mentor_tip_ready() to service_role;

-- תופסת ומסמנת באותה פעולה: שני סבבים במקביל לא יוציאו שתי עצות
create or replace function public.csm_mentor_tip_claim()
returns table (staff_id uuid, display_name text)
language sql
security definer
set search_path = ''
as $$
  update public.csm_staff s
     set last_tip_on = (now() at time zone 'Asia/Jerusalem')::date
   where s.active and not ('mentor_tip' = any(s.notify_off))
     and s.last_tip_on is distinct from (now() at time zone 'Asia/Jerusalem')::date
     and extract(dow from now() at time zone 'Asia/Jerusalem')::smallint = any(s.work_days)
     and (now() at time zone 'Asia/Jerusalem') >= (now() at time zone 'Asia/Jerusalem')::date + s.digest_time
     and (now() at time zone 'Asia/Jerusalem') <  (now() at time zone 'Asia/Jerusalem')::date + s.digest_time + interval '3 hours'
  returning s.id, s.display_name;
$$;

revoke all on function public.csm_mentor_tip_claim() from public, anon, authenticated;
grant execute on function public.csm_mentor_tip_claim() to service_role;

-- ---------------------------------------------------------------------------
-- 3. התזמון
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=csm-mentor-tips';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - העצה היומית של המנטור לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('csm-mentor-tips')
    where exists (select 1 from cron.job where jobname = 'csm-mentor-tips');

  perform cron.schedule('csm-mentor-tips', '*/10 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    )
    where public.csm_mentor_tip_ready();
  $cron$, v_url));
end;
$$;
