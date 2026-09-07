-- ============================================================================
-- תזמון ה-reconcile של טעינות הארנק
--
-- **למה זה קובץ נפרד, ולא בסוף המיגרציה שאליה הוא שייך לוגית**
--
-- הבלוק הזה נכתב תחילה כתוספת לסוף ‎20261007090000_wallet_morning_payments.sql‎,
-- אחרי שאותו קובץ כבר מוזג והוחל. התוצאה: **הוא מעולם לא רץ, וה-workflow היה
-- ירוק.** ‏`supabase db push` מריץ מיגרציה רק אם ה-version שלה טרם רשום ב-
-- ‎supabase_migrations.schema_migrations‎ — ומכיוון ש-‎20261007090000‎ כבר היה
-- שם, הקובץ נדלג **בשלמותו**, כולל מה שנוסף לו אחרי ההחלה.
--
-- הכשל הזה ערמומי בדיוק כמו זה שמתואר ב-CLAUDE.md, ובכיוון ההפוך: שם רשומה
-- בלי קובץ מפילה את הצינור ברעש, וכאן קובץ שהשתנה אחרי ההחלה **לא מפיל
-- כלום** — אין שגיאה, אין אזהרה, וה-cron פשוט לא קיים. מי שסומך/ת על ירוק
-- ב-Actions כדי לדעת שהשינוי נכנס, יטעה.
--
-- **הכלל שנובע מזה: מיגרציה שהוחלה היא לקריאה בלבד.** כל שינוי, ולו הוספה
-- בסוף הקובץ, חייב version חדש.
--
-- ---------------------------------------------------------------------------
-- מה הבלוק עושה
--
-- אותה תבנית כמו ‎property-video-reconcile‎ (§11 במיגרציה 20261004090000):
-- ‏pg_cron קורא ל-Edge Function דרך pg_net, והסוד ל-header נקרא מ-Vault.
--
-- **זו אינה משימת ניקיון — זו הרשת שמתחת לכסף של הסוכן/ת.** ‏webhook הוא
-- הבטחה, לא ערובה: אם מורנינג ניסה/תה לקרוא אלינו בזמן פריסה, או שהתשובה
-- אבדה, הסוכן/ת שילם/ה ולא קיבל/ה כלום — והשורה תישאר 'pending' לנצח בלי
-- שאיש ידע. זה הכשל היקר ביותר האפשרי כאן, והוא **לא** נשען על שיתוף פעולה
-- של צד שלישי: ה-reconcile שואל את מורנינג בעצמו ומסיים כל ניסיון פתוח.
--
-- כל חמש דקות, מול STALE_MINUTES=10 בפונקציה: מי שנתקע/ה מקבל/ת תשובה תוך
-- רבע שעה במקרה הגרוע. תדירות גבוהה יותר לא תקצר את זה — הסף הוא מה שקובע.
-- ============================================================================
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/wallet-topup-callback?mode=reconcile';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — יש לתזמן את wallet-topup-callback?mode=reconcile בדרך אחרת';
    return;
  end if;

  perform cron.unschedule('wallet-topup-reconcile')
    where exists (select 1 from cron.job where jobname = 'wallet-topup-reconcile');

  perform cron.schedule('wallet-topup-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    );
  $cron$, v_url));
end;
$$;
