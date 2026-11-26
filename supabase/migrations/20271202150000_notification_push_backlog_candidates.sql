-- ---------------------------------------------------------------------------
-- notification-push: השער של ה-cron מריץ את הפונקציות רק על המועמדות
--
-- 1. מה שבור. ‏`notification_push_ready()` היא התנאי של ה-job ‏`notification-push`
--    (כל 5 דקות), והסוכן התפעולי מחזיק עליה `slow_query` פתוח מ-23.11.2026:
--    ממוצע 385ms בסריקה של 25.11, גם אחרי 20271201130000 שקיצרה את
--    ‏`notification_push_due_agents`. ‏`cron.job_run_details` מראה מחזור יומי ולא
--    החמרה: ‏270-310ms בלילה ו-380-440ms ביום, באותה צורה ב-23, 24 ו-25.11.
--
--    ‏`explain analyze` על גוף `notification_push_has_backlog` ב-26.11 (‏246ms):
--    * 84ms ב-`notification_push_due_agents` (לא משתנה כאן).
--    * 102ms בסריקת `notifications`: המתכנן הריץ את `notification_digest_collectable`,
--      ‏`notification_push_stale_in_quiet` ו-`notification_push_is_ambient` על כל
--      540 ההתראות שבחלון 72 השעות, ורק אחר כך צירף לסוכנים. אחרי הצירוף
--      נשארות 58.
--    * 55ms ב-anti join מול `notification_push_log`: ‏`notification_push_log_holds`
--      רצה על כל 3,531 השורות של היומן, בלי חלון זמן. החלק הזה גדל עם היומן.
--
-- 2. מה נכנס, בלי לשנות תוצאה. אותם תנאים בדיוק, בסדר הערכה אחר:
--    * ‏`cand` (‏materialized): סוכנים שמותר לשלוח להם x התראות שלא נקראו בחלון,
--      לפי סוג. תנאים זולים בלבד. הפונקציות רצות על 58 שורות ולא על 540.
--    * ‏`offset 0` בתוך ה-`not exists` של היומן: הבדיקה נשארת תת-שאילתה לכל
--      מועמדת, על האינדקס `notification_push_log_agent_idx`, ו-`n.id = any(...)`
--      (הזול) מוערך לפני `notification_push_log_holds`.
--    * ‏`a.in_service_window` ו-`a.agent_id` נקראים מ-`cand` (‏`n.in_service_window`,
--      ‏`n.agent_id` - בצירוף הם אותו ערך).
--    הגוף הועתק ממה שרץ בפרודקשן (‏md5 של prosrc ‏0e27f65a357885564493c588000c48f2,
--    זהה ל-20271130100000), ושונו רק השורות האלה. כל הפונקציות בתנאים הן
--    ‏STABLE ובלי תופעות לוואי, ולכן סדר ההערכה אינו משנה את התוצאה.
--
-- 3. איך נבדק, בקריאה בלבד מול הפרודקשן (26.11.2026, 09:50 שעון ישראל):
--    קבוצת הזוגות (סוכן/ת, התראה) שעוברת את כל התנאים, בגוף הישן מול החדש,
--    ב-`p_exempt_only` ‏false ו-true: ‏0 מול 0. מכיוון שהתוצאה המלאה הייתה ריקה
--    באותו רגע, אותה השוואה גם בלי תנאי היומן (‏`log_holds`): ‏45 מול 45, אפס
--    הבדלים בשני הכיוונים (‏except). זמן: ‏246ms לגוף הישן, ‏112ms לחדש, מהם
--    ‏84ms ב-`due_agents` בשניהם.
--
-- החתימה וההרשאות לא משתנות. ‏`notification_push_ready` ו-`notification_push_claim`
-- אינן משתנות. אידמפוטנטית. ‏`docs/whatsapp-setup.md`, ‏`docs/ops-agent.md`.
-- ---------------------------------------------------------------------------

create or replace function public.notification_push_has_backlog(p_exempt_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select pg_catalog.now() - make_interval(hours => greatest(
             72,
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_push_priority_lookback_hours'), 72),
             coalesce((select value::int from public.pricing_config
                        where key = 'notif_push_lookback_hours'), 12))) as since
  ),
  -- 20271202150000: קודם מצמצמים לסוכנים שמותר לשלוח להם ולסוגים שלהם, בתנאים
  -- זולים בלבד, ורק על מה שנשאר מריצים את הפונקציות. ‏materialized הוא גדר:
  -- בלעדיו המתכנן מחזיר את הפונקציות לסריקת notifications, על כל התראה בחלון.
  cand as materialized (
    select n.id, n.agent_id, n.type, n.created_at, n.push_deferred_at,
           n.related_property_id, n.related_lead_id, a.in_service_window
      from public.notification_push_due_agents() a
      join public.notifications n on n.agent_id = a.agent_id
     where not n.read
       and not n.suppress_push
       -- 20271109130000: חלון גס וזול לפני כל קריאה לפונקציה, על האינדקס
       -- notifications_push_window_idx. ‏greatest אינו קטן מ-coalesce של
       -- הענף הראשון ולא מ-created_at של השני, ולכן אינו משנה את התוצאה.
       and greatest(n.created_at, n.push_deferred_at) > (select g.since from g)
       and n.type = any(a.whatsapp_types)
  )
  select exists (
       select 1
         from cand n
         left join public.leads ld on ld.id = n.related_lead_id
        where public.notification_digest_collectable(n.type, n.created_at)
          and not (
            public.notif_cadence_button_on()
            and not public.whatsapp_template_cap_on()
            and exists (
              select 1 from public.notification_push_log lcad
               where lcad.agent_id = n.agent_id
                 and n.id = any(lcad.notification_ids)
                 and lcad.whatsapp_status = 'skipped_template_cap'
                 and public.whatsapp_template_local_day(lcad.created_at)
                     = public.whatsapp_template_local_day(pg_catalog.now())
            )
            and not public.lead_wa_digest_cap_allows(n.agent_id, null)
          )
          and (not coalesce(p_exempt_only, false)
               or public.notification_push_burst_exempt(n.type, ld.source))
          and (
            (
              coalesce(n.push_deferred_at, n.created_at) > now() - make_interval(hours =>
                  case when n.type = any(public.notification_push_priority_types())
                       then coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_priority_lookback_hours'), 72)
                       else coalesce((select value::int from public.pricing_config
                                       where key = 'notif_push_lookback_hours'), 12)
                  end)
              and not (
                public.whatsapp_template_cap_on()
                and exists (
                  select 1 from public.notification_push_log lheld
                   where lheld.agent_id = n.agent_id
                     and n.id = any(lheld.notification_ids)
                     and lheld.whatsapp_status = 'skipped_template_cap'
                     and lheld.created_at > pg_catalog.now() - interval '72 hours'
                )
              )
            )
            or (
              public.whatsapp_template_cap_on()
              and public.notif_il_digest_open(coalesce(
                    (select value::int from public.pricing_config
                      where key = 'notif_digest_window_minutes'), 15))
              and n.created_at > pg_catalog.now() - interval '72 hours'
              and exists (
                select 1 from public.notification_push_log lheld
                 where lheld.agent_id = n.agent_id
                   and n.id = any(lheld.notification_ids)
                   and lheld.whatsapp_status = 'skipped_template_cap'
                   and lheld.created_at > pg_catalog.now() - interval '72 hours'
              )
              and (
                n.in_service_window
                or public.whatsapp_template_cap_digest_kind(
                     pg_catalog.now(),
                     (select u.last_at from public.whatsapp_template_cap_usage(n.agent_id, null) u),
                     coalesce((select u.n from public.whatsapp_template_cap_usage(n.agent_id, null) u), 0),
                     public.whatsapp_template_cap_digest_reserved_used(n.agent_id, null)
                   ) in ('normal', 'reserved')
              )
            )
          )
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids)
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
            -- offset 0 משאיר את הבדיקה כתת-שאילתה לכל מועמדת (אינדקס לפי סוכן/ת),
            -- במקום anti join שמריץ את log_holds על כל היומן. התוצאה זהה.
            offset 0)
          and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at)
          and (not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
               or n.created_at <= now() - make_interval(mins =>
                    coalesce((select value::int from public.pricing_config
                               where key = 'notif_push_ambient_digest_minutes'), 180)))
  );
$$;

comment on function public.notification_push_has_backlog(boolean) is
  'גוף 20271130100000. 20271202150000: אותם תנאים, והפונקציות רצות רק על התראות של סוכנים שמותר לשלוח להם.';

revoke all on function public.notification_push_has_backlog(boolean) from public, anon, authenticated;
grant execute on function public.notification_push_has_backlog(boolean) to service_role;
