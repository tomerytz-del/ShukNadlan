-- ============================================================================
-- התזמון של תזכורות מדריך ההתחלה לבעלי מקצוע (20271128090000)
--
-- נרשם יחד עם הפונקציה `professional-onboarding-reminders` ולא לפניה: תזמון בלי פונקציה היה קורא כל
-- יום לכתובת שאין בה כלום. פעם ביום, 07:47 UTC. התנאי הוא `professional_onboarding_reminders_due(1)`: מי שהשלים
-- את המדריך מסומן בתוכה ואינו מפעיל את הפונקציה כל יום לנצח. `timeout` של 30 שניות: עד 20 מיילים בריצה.
--
-- אידמפוטנטית.
-- ============================================================================
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/professional-onboarding-reminders';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - תזכורות מדריך ההתחלה לבעלי מקצוע לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('professional-onboarding-reminders')
    where exists (select 1 from cron.job where jobname = 'professional-onboarding-reminders');
  perform cron.schedule('professional-onboarding-reminders', '47 7 * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from public.professional_onboarding_reminders_due(1));
  $cron$, v_url));
end;
$$;
