-- ===========================================================================
-- פיזור תזמוני ה-cron: 27 jobs באותה דקה מיצו את חיבורי המסד
--
-- מה שבור: בין 16.11 ל-18.11.2026 היו ארבע דקות שבהן pg_cron קיבל
-- "connection failed" על 6-8 jobs בבת אחת (16.11 18:20, 17.11 13:30 ו-17:15,
-- 18.11 18:00), והסוכן התפעולי פתח עשרה ממצאי cron_failing, שבעה מהם high.
-- בלוג של Postgres באותה שנייה (18.11 18:00:00.855): שבע שורות
--   FATAL: remaining connection slots are reserved for roles with the
--   SUPERUSER attribute
-- כלומר לא job שבור אלא תקרת החיבורים: max_connections = 90, pg_cron פותח
-- חיבור libpq לכל job (cron.use_background_workers = off), ובדקה 0 ו-30 של
-- כל שעה רצים יחד 27 jobs - תשעה של "כל דקה", תשעה של "*/5", ארבעה של
-- "*/10", שלושה של "*/15" ושניים של "*/2". יחד עם כ-36 החיבורים הקבועים
-- (PostgREST, storage, pgbouncer) וגל של בקשות מה-CRM זה מגיע לתקרה.
--
-- מה נכנס: אותה תדירות בדיוק לכל job, בהיסט אחר. אחרי הפיזור השיא יורד
-- מ-27 ל-17 jobs בדקה (סימולציה על כל 76 התזמונים הפעילים:
-- scripts/cron_stagger_test.py). שלושה נשארים על הדקה העגולה בכוונה:
--   notification-push       - סיכומי ההתראות נשענים על משבצות של 5 דקות
--   missed-call-sla-alerts  - התראת SLA, לא מוסיפים לה המתנה
--   expire-promotions       - קידום שנגמר בשעה עגולה נסגר באותה דקה
--
-- מה לא משתנה: הפקודה של כל job. cron.alter_job נוגע רק ב-schedule, ולכן
-- אין כאן כתובת, כותרת או סוד. ו-job שהתזמון שלו כבר אינו הישן (שונה ביד,
-- או שהמיגרציה כבר רצה) נשאר כמו שהוא.
--
-- מה זה לא פותר: שלוש הדקות של "job startup timeout" (18.11 09:03, 10:03,
-- 13:15), שבהן נפלו כל ה-jobs כולל אלה של "כל דקה". שם המסד לא ענה כעשר
-- שניות, ובאותן דקות שלוש קריאות של פאנל מנהל/ת הפלטפורמה נחתכו ב-8 שניות
-- (deals_import_priorities, market_deals_coverage, csm_agents_overview).
-- הראשונה כבר טופלה ב-20271118100000.
-- ===========================================================================

do $$
declare
  r record;
  v_job bigint;
  v_cur text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron אינו מותקן - אין תזמונים לפזר';
    return;
  end if;

  for r in
    select * from (values
      -- כל 5 דקות (היסט 0 נשאר ל-notification-push ול-missed-call-sla-alerts,
      -- והיסט 2 כבר תפוס בידי property-description)
      ('property-marketing-publish',   '*/5 * * * *',  '1-59/5 * * * *'),
      ('showcase-wa',                  '*/5 * * * *',  '1-59/5 * * * *'),
      ('geocode-backfill',             '*/5 * * * *',  '2-59/5 * * * *'),
      ('ai-cache-warm',                '*/5 * * * *',  '3-59/5 * * * *'),
      ('property-video-reconcile',     '*/5 * * * *',  '3-59/5 * * * *'),
      ('wallet-topup-reconcile',       '*/5 * * * *',  '4-59/5 * * * *'),
      ('visualization-backfill-drain', '*/5 * * * *',  '4-59/5 * * * *'),
      -- כל 10 דקות (property-offers נשאר על 0)
      ('csm-mentor-tips',              '*/10 * * * *', '3-59/10 * * * *'),
      ('scraped-lead-matching-rest',   '*/10 * * * *', '6-59/10 * * * *'),
      ('building-developer-ask',       '*/10 * * * *', '8-59/10 * * * *'),
      -- כל 15 דקות (expire-promotions נשאר על 0; 7 ו-11 תפוסים)
      ('lead-response-escalations',    '*/15 * * * *', '4-59/15 * * * *'),
      ('admin-inbox-overdue',          '*/15 * * * *', '9-59/15 * * * *'),
      -- כל 2 דקות (saved-search-notify נשאר על הזוגיות)
      ('email-intake',                 '*/2 * * * *',  '1-59/2 * * * *')
    ) as t(jobname, old_schedule, new_schedule)
  loop
    select j.jobid, j.schedule into v_job, v_cur
      from cron.job j where j.jobname = r.jobname;
    if v_job is null then
      raise notice 'cron stagger: % אינו קיים, מדלגים', r.jobname;
    elsif v_cur = r.new_schedule then
      null;  -- כבר פוזר
    elsif v_cur <> r.old_schedule then
      raise notice 'cron stagger: % מתוזמן % ולא %, נשאר כמו שהוא',
        r.jobname, v_cur, r.old_schedule;
    else
      perform cron.alter_job(v_job, schedule := r.new_schedule);
    end if;
  end loop;
end $$;
