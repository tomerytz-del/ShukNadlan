-- כפתורי "רלוונטי / לא רלוונטי" על ריכוז ההתאמות בוואטסאפ (docs/client-matching.md,
-- "משוב מהוואטסאפ").
--
-- ‏למה: באבחון גבריאלה (27.10-22.11.2026) 0% מהתראות ההתאמה טופלו, ובבדיקה
-- ב-27.11.2026 כל 757 השורות של 30 הימים האחרונים ב-client_match_alerts היו
-- 'new'. הסיכום (match_digest) יוצא בלי כפתור, והדרך היחידה לסמן התאמה היא
-- ה-CRM. בלי סימון אין גם שום משוב למנוע ההתאמות.
--
-- ‏מה כאן:
--   1. feedback / feedback_at על client_match_alerts. "לא רלוונטי" הוא גם
--      status = 'dismissed' (הסמנטיקה הקיימת: לא מוצג שוב, ונשמר בטריגרי
--      הניקוי), ו"רלוונטי" הוא status = 'seen'. feedback נפרד מ-status כי
--      'seen' נכתב גם מצפייה ב-CRM ולא אומר שהסוכן/ת שפט/ה את ההתאמה.
--   2. match_digest_alerts: ההתאמות שסיכום אחד דיבר עליהן, באותו חלון ובאותם
--      תנאים של client_match_digest_run (הצד של הלקוחות שלי בלבד).
--   3. match_feedback_set: הכתיבה, רק על התאמה של אותו/ה סוכן/ת.
--   4. הדגל match_feedback_buttons_enabled, כבוי. notification-push מוסיף את
--      הכפתורים רק כשהוא 1. הלחיצה נקלטת בוובהוק גם כשהדגל כבוי, כדי שכפתור
--      שכבר יצא לא ייפול למודל.

alter table public.client_match_alerts
  add column if not exists feedback    text,
  add column if not exists feedback_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'client_match_alerts_feedback_check'
       and conrelid = 'public.client_match_alerts'::regclass
  ) then
    alter table public.client_match_alerts
      add constraint client_match_alerts_feedback_check
      check (feedback is null or feedback in ('relevant', 'not_relevant'));
  end if;
end $$;

comment on column public.client_match_alerts.feedback is
  'משוב של הסוכן/ת על ההתאמה: relevant / not_relevant. null = לא נשפטה. נכתב רק ב-match_feedback_set.';
comment on column public.client_match_alerts.feedback_at is
  'מתי נכתב feedback.';

insert into public.pricing_config (key, value, description) values
  ('match_feedback_buttons_enabled', 0,
   'כפתורי רלוונטי / לא רלוונטי על ריכוז ההתאמות בוואטסאפ (בתוך חלון 24 השעות). 0 = כבוי.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- ההתאמות שסיכום אחד דיבר עליהן.
--
-- ‏החלון: מהסיכום הקודם של אותו/ה סוכן/ת (או 7 ימים אחורה) ועד רגע הסיכום.
-- ב-client_match_digest_run החלון מתחיל ב-last_sent_at, שזז גם בסבב בלי
-- הודעה. סבב כזה הוא סבב שלא היו בו התאמות פתוחות, ולכן הסיכום הקודם הוא
-- אותו גבול בפועל. אותם תנאים: לקוח/ה ונכס פעילים, בלי dismissed.
-- ‏total הוא כמה יש, והשורות חתוכות ל-p_limit (רשימה בוואטסאפ: עד 10).
-- ---------------------------------------------------------------------------
create or replace function public.match_digest_alerts(
  p_agent        uuid,
  p_notification uuid,
  p_limit        int default 10
)
returns table (
  alert_id       uuid,
  client_name    text,
  property_title text,
  score          int,
  feedback       text,
  total          int
)
language sql
stable
security definer
set search_path = ''
as $$
  with n as (
    select x.agent_id, x.created_at
      from public.notifications x
     where x.id = p_notification
       and x.agent_id = p_agent
       and x.type = 'match_digest'
  ),
  lo as (
    select coalesce(
             (select max(prev.created_at)
                from public.notifications prev, n
               where prev.agent_id = n.agent_id
                 and prev.type = 'match_digest'
                 and prev.created_at < n.created_at),
             (select n.created_at - interval '7 days' from n)
           ) as t
  ),
  m as (
    select a.id, c.full_name, p.title, a.score, a.feedback, a.created_at
      from n
      cross join lo
      join public.client_match_alerts a
        on a.agent_id = n.agent_id
       and a.created_at > lo.t
       and a.created_at <= n.created_at
       and a.status <> 'dismissed'
      join public.agent_clients c on c.id = a.client_id and c.status = 'active'
      join public.properties p    on p.id = a.property_id and p.status = 'active'
  )
  select m.id, m.full_name, m.title, m.score, m.feedback,
         (select count(*) from m)::int
    from m
   order by m.score desc, m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 10), 30));
$$;

revoke all on function public.match_digest_alerts(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.match_digest_alerts(uuid, uuid, int) to service_role;

comment on function public.match_digest_alerts(uuid, uuid, int) is
  'ההתאמות (הצד של הלקוחות שלי) שסיכום match_digest אחד דיבר עליהן. service_role בלבד: notification-push והוובהוק.';

-- ---------------------------------------------------------------------------
-- הכתיבה. רק התאמה של p_agent; התאמה של סוכן/ת אחר/ת מחזירה אפס שורות.
-- "לא רלוונטי" = dismissed. "רלוונטי" = seen, ומחזיר התאמה שסומנה בטעות
-- כלא רלוונטית (dismissed -> seen), כי זו בדיוק הלחיצה שמתקנת אותה.
-- ---------------------------------------------------------------------------
create or replace function public.match_feedback_set(
  p_agent    uuid,
  p_alert    uuid,
  p_feedback text
)
returns table (
  client_id      uuid,
  client_name    text,
  property_title text,
  score          int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_feedback is null or p_feedback not in ('relevant', 'not_relevant') then
    raise exception 'bad feedback %', p_feedback using errcode = '22023';
  end if;

  return query
  update public.client_match_alerts a
     set feedback    = p_feedback,
         feedback_at = now(),
         status      = case when p_feedback = 'not_relevant' then 'dismissed' else 'seen' end,
         seen_at     = coalesce(a.seen_at, now())
    from public.agent_clients c, public.properties p
   where a.id = p_alert
     and a.agent_id = p_agent
     and c.id = a.client_id
     and p.id = a.property_id
  returning c.id, c.full_name, p.title, a.score;
end;
$$;

revoke all on function public.match_feedback_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.match_feedback_set(uuid, uuid, text) to service_role;

comment on function public.match_feedback_set(uuid, uuid, text) is
  'משוב רלוונטי / לא רלוונטי על התאמה, מכפתור בוואטסאפ. service_role בלבד; הסינון לפי סוכן/ת בפונקציה.';
