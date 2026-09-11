-- ===========================================================================
-- ‏cron שיורה רק כשיש עבודה — ארבע המשימות הנותרות
--
-- ‏מיגרציה 20261020090000 עשתה את זה ל-property-marketing-publish. ארבע
-- משימות נוספות עדיין מעירות Edge Function כל כמה דקות רק כדי לשמוע
-- "אין כלום":
--
--   saved-search-notify        כל 2 דקות  ≈ 21,600 קריאות בחודש
--   property-description       כל 5 דקות  ≈  8,250
--   property-video-reconcile   כל 5 דקות  ≈  5,800
--   wallet-topup-reconcile     כל 5 דקות  ≈  5,400
--                                          ─────────
--                                          ≈ 41,000 קריאות בחודש
--
-- בכל ארבע התורים היו ריקים ברגע הכתיבה, כלומר כל הקריאות האלה היו סרק.
--
-- הקצב, ההשהיות, התקרות ומתגי הכיבוי **לא משתנים**. מה שמשתנה הוא רק מתי
-- ‏net.http_post מופעל: `select ... where exists (...)` בלי FROM מייצר אפס
-- שורות כשהתנאי שקרי, ואז הפונקציה בתוך רשימת ה-target אינה מוערכת כלל.
--
-- ## הכלל שלפיו נבחר כל תנאי
--
-- **‏superset, לעולם לא subset.** התנאי בודק רק את מצב התור — סטטוס, זמן
-- בשלות, והאם הישות שמעליו עדיין פעילה. תקרות יומיות ומתגי כיבוי נשארים
-- בחוץ **בכוונה**: הם נבדקים ממילא בפונקציה, ואילו כאן הם היו מוסיפים
-- דרך לפספס שורה. התוצאה: ביום שבו התקרה מלאה נירה כמה פעמים לשווא — ואף
-- פעם לא נשאיר שורה ממתינה.
--
-- **אין שכפול של קבועים מה-TypeScript.** לשתי משימות ה-reconcile יש
-- ‏`STALE_MINUTES` בקוד השרת (‏30 לווידאו, 10 לארנק). לא העתקתי אותם לכאן:
-- קבוע שמוגדר פעמיים הוא קבוע שיתפצל, והתוצאה תהיה שורה שהתנאי חוסם ולשרת
-- יש מה לעשות איתה. במקום זה התנאי בודק רק **שיש בקשה פתוחה בכלל**, ומשאיר
-- את שאלת "האם היא כבר תקועה מספיק" לשרת. בקשות פתוחות הן קצרות-חיים, ולכן
-- החיסכון כמעט זהה.
--
-- כל חמש הטבלאות שהתנאים נוגעים בהן נושאות אינדקס על הסטטוס
-- (‏`saved_search_alerts_queue_idx`, ‏`property_description_jobs_queue_idx`,
-- ‏`idx_property_video_jobs_open`, ‏`wallet_topups_pending_idx`,
-- ‏`subscription_orders_pending_idx`), כך שכל בדיקה היא חיפוש אינדקס.
--
-- אידמפוטנטית: unschedule לפני schedule, לכל משימה בנפרד.
-- ===========================================================================

do $$
declare
  v_base text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — אין מה לתזמן מחדש';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 1. התראות חיפוש שמור — כל 2 דקות
  --
  -- הגדולה מכולן, ולה גם החיסכון הגדול ביותר: `saved_search_quiet_now()`
  -- נכנס לתנאי. בשעות השקט השרת ממילא לא שולח דבר, ועד היום הוא הועַר 30
  -- פעם בשעה כדי לגלות את זה מחדש. זה אותו ביטוי בדיוק שהפונקציה בודקת,
  -- ולכן אין כאן ויתור על שום התראה — רק הימנעות מלשאול.
  -- -------------------------------------------------------------------------
  perform cron.unschedule('saved-search-notify')
    where exists (select 1 from cron.job where jobname = 'saved-search-notify');

  perform cron.schedule('saved-search-notify', '*/2 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where not public.saved_search_quiet_now()
      and exists (
        select 1
          from public.saved_search_alerts a
          join public.saved_searches s on s.id = a.search_id
          join public.properties     p on p.id = a.property_id
         where a.status = 'pending'
           and s.status = 'active'
           and p.status = 'active'
      );
  $cron$, v_base || 'saved-search-notify'));

  -- -------------------------------------------------------------------------
  -- 2. תיאור שיווקי — כל 5 דקות, בהיסט של 2 דקות מהפרסום
  --
  -- תנאי הריקנות של `marketing_description` נמצא כאן ולא רק בפונקציה, כי
  -- הוא מה שמבדיל שורת תור שבאמת ממתינה לעבודה משורה שהעבודה שלה כבר נעשתה
  -- במסלול אחר.
  -- -------------------------------------------------------------------------
  perform cron.unschedule('property-description')
    where exists (select 1 from cron.job where jobname = 'property-description');

  perform cron.schedule('property-description', '2-59/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (
      select 1
        from public.property_description_jobs j
        join public.properties p on p.id = j.property_id
       where j.status = 'pending'
         and j.run_after <= now()
         and p.status = 'active'
         and nullif(btrim(coalesce(p.marketing_description, '')), '') is null
    );
  $cron$, v_base || 'property-description'));

  -- -------------------------------------------------------------------------
  -- 3. ‏reconcile של סרטוני שיווק — כל 5 דקות
  --
  -- שלושת הסטטוסים הם "הבקשה בדרך": אם אין אף אחת כזו, אין מה ליישב מול
  -- ‏fal. הסף של 30 הדקות נשאר בשרת בלבד (ראו הכלל למעלה).
  -- -------------------------------------------------------------------------
  perform cron.unschedule('property-video-reconcile')
    where exists (select 1 from cron.job where jobname = 'property-video-reconcile');

  perform cron.schedule('property-video-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (
      select 1 from public.property_video_jobs
       where status in ('generating_clips', 'merging', 'uploading')
    );
  $cron$, v_base || 'property-video-callback?mode=reconcile'));

  -- -------------------------------------------------------------------------
  -- 4. ‏reconcile של תשלומים — כל 5 דקות
  --
  -- שתי טבלאות, כי טעינת ארנק ורכישת מנוי הן אותו מסלול על שתי טבלאות
  -- (‏`KINDS` בשרת). די באחת מהן כדי להצדיק את הקריאה. הסף של 10 הדקות
  -- ותוקף 180 הדקות נשארים בשרת.
  --
  -- כאן הזהירות חשובה במיוחד — מדובר בכסף. התנאי חוסם רק מצב שבו **אין אף
  -- ניסיון תשלום פתוח**, ואז גם לשרת לא היה מה לעשות.
  -- -------------------------------------------------------------------------
  perform cron.unschedule('wallet-topup-reconcile')
    where exists (select 1 from cron.job where jobname = 'wallet-topup-reconcile');

  perform cron.schedule('wallet-topup-reconcile', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where exists (select 1 from public.wallet_topups       where status = 'pending')
       or exists (select 1 from public.subscription_orders where status = 'pending');
  $cron$, v_base || 'wallet-topup-callback?mode=reconcile'));
end;
$$;
