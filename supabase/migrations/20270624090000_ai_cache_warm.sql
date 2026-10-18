-- ============================================================================
-- המטמון של גבריאלה חי בשעות היום (docs/platform-costs.md, "המטמון של גבריאלה")
--
-- תור של גבריאלה קורא ~40K טוקנים של כלים והוראות מהמטמון ב-$0.02. כשעברה שעה
-- בלי הודעה המטמון פג, והתור הבא כותב את כולם מחדש למטמון של שעה - כ-$0.40 על
-- Opus 5. ב-14 הימים שלפני 18.10.2026: כ-3.4 פעמים ביום בשעות היום לבוט הסוכנים,
-- וכ-1.7 לבוט הציבורי - כלומר רוב הכסף של "ההודעה הראשונה".
--
-- כאן: אחרי 50 דקות של שקט, בין 07:00 ל-22:00, בקשה ריקה (‏max_tokens: 0) קוראת
-- את אותה קידומת ומאפסת את השעון. כ-$0.02 במקום $0.40, ובקשה אחת מכסה את כל
-- הסוכנים, כי הקידומת משותפת. בלילה המטמון פג בכוונה - שמירה לאורך הלילה עולה
-- יותר מכתיבה אחת בבוקר.
--
--   1. אינדקס ל-ai_usage_log לפי יכולת וזמן - ה-cron שואל כל 5 דקות.
--   2. ‏ai_cache_warm_targets() - אילו בוטים צריכים בקשה עכשיו.
--   3. ה-cron ‏ai-cache-warm - כל 5 דקות, ומעיר את הפונקציה רק כשיש יעד.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. אינדקס
-- ---------------------------------------------------------------------------
create index if not exists ai_usage_log_feature_created_idx
  on public.ai_usage_log (feature, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. ‏ai_cache_warm_targets
--
-- בוט שהקריאה האחרונה אליו (תור אמיתי או בקשת שמירה) הייתה לפני 50-58 דקות.
-- החלון רחב מ-5 דקות כדי שה-cron תמיד ייפול בתוכו, וצר משעה כדי שהבקשה תצא לפני
-- שהמטמון פג (השעה נמדדת מתחילת הבקשה, והשורה נכתבת בסופה). קריאה שהייתה לפני
-- יותר מ-58 דקות - המטמון כבר פג או עומד לפוג, ובקשה עכשיו הייתה כתיבה מלאה בשביל
-- הודעה שאולי לא תגיע.
-- ---------------------------------------------------------------------------
create or replace function public.ai_cache_warm_targets()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.bot), '{}'::text[])
    from unnest(array['gabriela_agent', 'gabriela_public']) as t(bot)
   where extract(hour from now() at time zone 'Asia/Jerusalem') between 7 and 21
     and (select max(l.created_at) from public.ai_usage_log l
           where l.feature in (t.bot, t.bot || '_warm'))
         between now() - interval '58 minutes' and now() - interval '50 minutes';
$$;

comment on function public.ai_cache_warm_targets() is
  'הבוטים שהמטמון של הפרומפט שלהם עומד לפוג בשעות היום - התנאי של ה-cron ai-cache-warm. docs/platform-costs.md';

revoke all on function public.ai_cache_warm_targets() from public, anon, authenticated;
grant execute on function public.ai_cache_warm_targets() to service_role;

-- ---------------------------------------------------------------------------
-- 3. התזמון - כל 5 דקות, ורק כשיש יעד
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=cache-warm';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - שמירת המטמון לא תוזמנה';
    return;
  end if;

  perform cron.unschedule('ai-cache-warm')
    where exists (select 1 from cron.job where jobname = 'ai-cache-warm');

  perform cron.schedule('ai-cache-warm', '*/5 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    where cardinality(public.ai_cache_warm_targets()) > 0;
  $cron$, v_url));
end;
$$;
