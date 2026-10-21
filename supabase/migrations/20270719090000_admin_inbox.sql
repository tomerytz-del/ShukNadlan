-- ===========================================================================
-- תיבת המשימות של מנהל/ת הפלטפורמה (שלב 3 בשדרוג האדמין, docs/admin-inbox.md)
-- ---------------------------------------------------------------------------
-- ‏**מה היה:** ארבעה תורים שמחכים למנהל/ת הפלטפורמה, כל אחד באקורדיון משלו
-- ובלי זמן: לידים ללא יעד, בקשות החזר, ערעורי רישיון ו"חסר למנטור". מי שלא
-- פתח/ה את האקורדיון הנכון לא ידע/ה שמישהו מחכה, ולא היה דבר שאומר "זה כבר
-- יומיים".
--
-- ‏**מה נכנס:**
--   1. ‏admin_sla - זמן יעד לכל סוג, בדקות. החלטה של תומר מ-19.10.2026:
--      ליד 2 שעות, ערעור רישיון 12, החזר 48, חסר למנטור 72. מנהל/ת עורך/ת
--      מהכפתור "כללי זמן תגובה" (admin_sla_set).
--   2. ‏_admin_inbox_rows() - איחוד ארבעת התורים לשורות אחידות. **בלי טלפון,
--      מייל או תוכן פנייה**: השורה אומרת מה מחכה ולמי, וההחלטה עצמה נעשית
--      במסך הקיים של כל תור, עם ההרשאות, האישורים והמיילים שכבר יש לו.
--   3. ‏admin_inbox() ו-admin_inbox_counts() - לתיבה ולמונים בתפריט.
--   4. ‏admin_inbox_notify_overdue() ב-pg_cron כל רבע שעה: פריט שחרג מזמן
--      היעד מקבל התראה אחת לפעמון (admin_inbox_alerts זוכרת), ובסבב שבו כמה
--      חרגו יחד - התראה אחת שסופרת אותם.
--
-- ‏**מה לא כאן, ולמה** (בדיקה במסד ובקוד, 21.10.2026): כרטיס בעל מקצוע עולה
-- לאוויר מיד עם ההרשמה (ad_placements.status = 'active', אין שלב אישור);
-- ביקורת ממתינה לאישור מנהל/ת **המשרד** (accReviews) ואין סימון ביקורות;
-- וכתבה היא טיוטה של מי שכותב/ת אותה. ערכי זמן היעד שלהן נשמרים כבר כאן,
-- כדי שהתור שיבנה להן ייכנס לתיבה בלי מיגרציה נוספת להחלטה שכבר התקבלה.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. זמני היעד
-- ---------------------------------------------------------------------------
create table if not exists public.admin_sla (
  kind       text primary key,
  minutes    integer not null check (minutes > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.admin_sla is
  'זמן היעד (דקות) לכל סוג פריט בתיבת המשימות של מנהל/ת הפלטפורמה. נקרא ב-admin_inbox ונכתב רק דרך admin_sla_set.';

insert into public.admin_sla (kind, minutes) values
  ('unrouted_lead',     120),
  ('license_appeal',    720),
  ('refund',           2880),
  ('coach_gap',        4320),
  -- אין להם עדיין תור (ראו בראש הקובץ). ההחלטה נשמרת לתור שייבנה.
  ('flagged_review',    720),
  ('professional_card',2880),
  ('article',          4320)
on conflict (kind) do nothing;

alter table public.admin_sla enable row level security;
drop policy if exists admin_sla_admin_read on public.admin_sla;
create policy admin_sla_admin_read on public.admin_sla
  for select to authenticated using (public.current_is_platform_admin());
-- ‏authenticated קוראת (מנהל/ת בלבד, ב-RLS) וכותבת רק דרך admin_sla_set.
-- ‏service_role אינו ניגש: הפונקציות הן security definer של הבעלים.
revoke all on table public.admin_sla from anon, authenticated, service_role;
grant select on table public.admin_sla to authenticated;

create or replace function public.admin_sla_set(p_kind text, p_minutes integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 60 * 24 * 30 then
    raise exception 'sla_out_of_range' using errcode = '22023';
  end if;
  update public.admin_sla
     set minutes = p_minutes, updated_at = now(), updated_by = public.current_agent_id()
   where kind = p_kind;
  if not found then
    raise exception 'unknown_kind' using errcode = '22023';
  end if;
end $$;

comment on function public.admin_sla_set(text, integer) is
  'עדכון זמן יעד בתיבת המשימות (15 דקות עד 30 יום). מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_sla_set(text, integer) from public, anon, authenticated;
grant execute on function public.admin_sla_set(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ארבעת התורים כשורות אחידות
-- ---------------------------------------------------------------------------
-- ‏ref_id טקסט: שלושה תורים הם שורה עם uuid, ו"חסר למנטור" הוא נושא (שאלות
-- שקובצו לפי gap_topic, כמו ב-coach_knowledge_gaps) - ומזהה שלו הוא הנושא.
-- ‏created_at הוא מתי הפריט התחיל לחכות: לנושא, השאלה הראשונה שלא נענתה.
create or replace function public._admin_inbox_rows()
returns table (kind text, ref_id text, created_at timestamptz, meta jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'unrouted_lead', r.id::text, r.created_at,
         jsonb_build_object('lead_kind', r.lead_kind, 'reason', r.reason, 'city', r.city,
                            'deal_type', r.deal_type, 'source', r.source)
    from public.lead_routing_open r
  union all
  select 'refund', w.id::text, w.requested_at,
         jsonb_build_object('amount', coalesce(w.money_amount, w.amount),
                            'agent', (select m.display_name from public.agency_members m where m.id = w.agent_id))
    from public.wallet_refunds w
   where w.status = 'requested'
  union all
  select 'license_appeal', a.id::text, a.created_at,
         jsonb_build_object('name', a.applicant_name, 'license', a.license_number, 'source', a.source)
    from public.broker_license_appeals a
   where a.status = 'pending'
  union all
  select 'coach_gap', lower(btrim(q.gap_topic)), min(q.created_at),
         jsonb_build_object('topic', min(btrim(q.gap_topic)), 'asked', count(*))
    from public.coach_questions q
   where q.gap_topic is not null and q.gap_resolved_at is null
   group by lower(btrim(q.gap_topic))
$$;

comment on function public._admin_inbox_rows() is
  'ארבעת התורים של מנהל/ת הפלטפורמה כשורות אחידות, בלי טלפון, מייל או תוכן פנייה. נקרא רק מ-admin_inbox, admin_inbox_counts ו-admin_inbox_notify_overdue.';

revoke all on function public._admin_inbox_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. התיבה והמונים
-- ---------------------------------------------------------------------------
-- הסדר הוא הדחיפות: מה שחיכה הכי הרבה **ביחס לזמן היעד שלו** קודם (HANDOFF,
-- החלטה 3). ליד של שעה וחצי (75% מ-2 שעות) לפני החזר של יום (50% מ-48).
create or replace function public.admin_inbox(p_kind text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  with rows as (
    select r.kind, r.ref_id, r.created_at, r.meta,
           greatest(0, floor(extract(epoch from now() - r.created_at) / 60))::int as waiting_minutes,
           coalesce(s.minutes, 1440) as sla_minutes
      from public._admin_inbox_rows() r
      left join public.admin_sla s on s.kind = r.kind
     where p_kind is null or r.kind = p_kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind, 'ref_id', x.ref_id, 'created_at', x.created_at, 'meta', x.meta,
           'waiting_minutes', x.waiting_minutes, 'sla_minutes', x.sla_minutes,
           'overdue', x.waiting_minutes >= x.sla_minutes
         ) order by x.waiting_minutes::numeric / x.sla_minutes desc, x.created_at), '[]'::jsonb)
    into v_out
    from (select * from rows
           order by waiting_minutes::numeric / sla_minutes desc, created_at
           limit v_lim offset v_off) x;

  return v_out;
end $$;

comment on function public.admin_inbox(text, int, int) is
  'תיבת המשימות של מנהל/ת הפלטפורמה: הפריטים שממתינים, לפי היחס בין זמן ההמתנה לזמן היעד. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_inbox(text, int, int) from public, anon, authenticated;
grant execute on function public.admin_inbox(text, int, int) to authenticated;

create or replace function public.admin_inbox_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  with rows as (
    select r.kind,
           (extract(epoch from now() - r.created_at) / 60) >= coalesce(s.minutes, 1440) as overdue
      from public._admin_inbox_rows() r
      left join public.admin_sla s on s.kind = r.kind
  )
  select jsonb_build_object(
           'total',   (select count(*) from rows),
           'overdue', (select count(*) from rows where overdue),
           'kinds',   coalesce((select jsonb_object_agg(k.kind, jsonb_build_object('total', k.total, 'overdue', k.overdue))
                                  from (select kind, count(*) as total, count(*) filter (where overdue) as overdue
                                          from rows group by kind) k), '{}'::jsonb),
           'sla',     coalesce((select jsonb_object_agg(s.kind, s.minutes) from public.admin_sla s), '{}'::jsonb))
    into v_out;
  return v_out;
end $$;

comment on function public.admin_inbox_counts() is
  'מונים לתיבת המשימות: סך הכל, כמה חרגו מזמן היעד, לפי סוג, וזמני היעד. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_inbox_counts() from public, anon, authenticated;
grant execute on function public.admin_inbox_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. התראה על חריגה - פעם אחת לפריט
-- ---------------------------------------------------------------------------
select public.notification_types_add(array['admin_overdue']);

create table if not exists public.admin_inbox_alerts (
  kind        text not null,
  ref_id      text not null,
  notified_at timestamptz not null default now(),
  primary key (kind, ref_id)
);

comment on table public.admin_inbox_alerts is
  'אילו פריטים בתיבת המשימות כבר קיבלו התראת חריגה (admin_overdue). שורה נמחקת כשהפריט יוצא מהתיבה.';

alter table public.admin_inbox_alerts enable row level security;
-- רק admin_inbox_notify_overdue (security definer) כותבת וקוראת כאן
revoke all on table public.admin_inbox_alerts from anon, authenticated, service_role;

create or replace function public.admin_inbox_notify_overdue()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_new   integer;
  v_title text;
  v_body  text;
begin
  -- פריט שיצא מהתיבה (טופל) משחרר את השורה שלו
  delete from public.admin_inbox_alerts a
   where not exists (select 1 from public._admin_inbox_rows() r
                      where r.kind = a.kind and r.ref_id = a.ref_id);

  with overdue as (
    select r.kind, r.ref_id
      from public._admin_inbox_rows() r
      join public.admin_sla s on s.kind = r.kind
     where extract(epoch from now() - r.created_at) / 60 >= s.minutes
  ), fresh as (
    insert into public.admin_inbox_alerts (kind, ref_id)
    select o.kind, o.ref_id from overdue o
    on conflict (kind, ref_id) do nothing
    returning kind
  )
  select count(*),
         case when count(*) = 1 then
           case min(kind)
             when 'unrouted_lead'  then 'ליד ללא יעד'
             when 'refund'         then 'בקשת החזר'
             when 'license_appeal' then 'ערעור על אימות רישיון'
             when 'coach_gap'      then 'שאלה שהמנטור לא ידע לענות'
             else 'פריט'
           end || ' חרג/ה מזמן היעד'
         else count(*) || ' פריטים חרגו מזמן היעד' end
    into v_new, v_title
    from fresh;

  if v_new = 0 then
    return 0;
  end if;

  v_body := 'מחכים לך בתיבת המשימות, מהוותיק ביחס לזמן היעד שלו.';

  insert into public.notifications (agent_id, type, title, body)
  select m.id, 'admin_overdue', v_title, v_body
    from public.agency_members m
   where m.is_platform_admin and m.active;

  return v_new;
end $$;

comment on function public.admin_inbox_notify_overdue() is
  'pg_cron כל רבע שעה: פריט בתיבת המשימות שחרג מזמן היעד מקבל התראה אחת (admin_overdue) למנהלי הפלטפורמה. כמה פריטים באותו סבב - התראה אחת שסופרת אותם.';

revoke all on function public.admin_inbox_notify_overdue() from public, anon, authenticated;
grant execute on function public.admin_inbox_notify_overdue() to service_role;

-- מה שכבר חרג ביום המיגרציה אינו "חדש": בלי זה הסבב הראשון היה שולח התראה על
-- כל מה שהצטבר לפני שהתיבה קיימת. התיבה עצמה מציגה אותם באדום.
insert into public.admin_inbox_alerts (kind, ref_id)
select r.kind, r.ref_id
  from public._admin_inbox_rows() r
  join public.admin_sla s on s.kind = r.kind
 where extract(epoch from now() - r.created_at) / 60 >= s.minutes
on conflict (kind, ref_id) do nothing;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - התראות החריגה לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('admin-inbox-overdue')
    where exists (select 1 from cron.job where jobname = 'admin-inbox-overdue');

  perform cron.schedule('admin-inbox-overdue', '*/15 * * * *',
    'select public.admin_inbox_notify_overdue();');
end;
$$;
