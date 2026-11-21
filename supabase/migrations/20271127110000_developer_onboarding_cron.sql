-- ============================================================================
-- התזמון של תזכורות מדריך ההתחלה ליזמים (20271125090000)
--
-- נרשם יחד עם הפונקציה `developer-onboarding-reminders` ולא לפניה: תזמון בלי פונקציה היה קורא כל
-- יום לכתובת שאין בה כלום, בלי שאיש יתריע. פעם ביום, 07:41 UTC (09:41 בחורף, אחרי שעות השקט
-- של הלילה).
--
-- **התנאי הוא `developer_onboarding_reminders_due(1)`** ולא ספירה גסה: מי שהשלים/ה את המדריך מסומן/ת
-- בתוכה ולכן אינו/ה מפעיל/ה את הפונקציה כל יום לנצח, והתזכורת השנייה מחכה לעשרה ימים. ‏`timeout`
-- של 30 שניות: הפונקציה שולחת עד 20 מיילים בריצה.
--
-- אידמפוטנטית.
-- ============================================================================
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/developer-onboarding-reminders';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - תזכורות מדריך ההתחלה ליזמים לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('developer-onboarding-reminders')
    where exists (select 1 from cron.job where jobname = 'developer-onboarding-reminders');
  perform cron.schedule('developer-onboarding-reminders', '41 7 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from public.developer_onboarding_reminders_due(1));
  $cron$, v_url));
end;
$$;
