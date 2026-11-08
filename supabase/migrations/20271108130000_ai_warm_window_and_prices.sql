-- ============================================================================
-- החימום של גבריאלה רק סמוך לשיחה אמיתית, ומחירים ל-Haiku 5.5 ול-Gemini
-- (docs/platform-costs.md, "המטמון של גבריאלה" ו"עלות AI לפי יכולת")
--
-- 1. ‏ai_cache_warm_targets: עד היום "הקריאה האחרונה" כללה גם את קריאת החימום
--    עצמה, ולכן חימום שהתחיל המשיך כל שעה עד 22:00 גם בלי אף הודעה. ביום
--    שישי 6.11.2026: 13 חימומים מול 3 קריאות אמיתיות, ופעמיים כתיבה מחדש של
--    כל ההוראות (כ-$0.43 כל אחת) שאף אחד לא קרא. מעכשיו מחממים רק עד שלוש
--    שעות אחרי קריאה אמיתית אחרונה. מי שכותב/ת אחרי הפסקה ארוכה יותר משלם/ת
--    פעם אחת כתיבה מחדש - בדיוק מה שהחימום היה משלם בלי שמישהו ישתמש.
-- 2. ‏claude-haiku-5-5: מאמן הסוכן/ת והמבזקים עוברים אליו. ‏$0.10 / $0.50
--    למיליון עד 100K טוקנים בבקשה (שתי הקריאות קצרות בהרבה); מטמון לפי
--    המכפילים של Anthropic: קריאה 0.1, כתיבה ל-5 דקות 1.25, לשעה 2.
-- 3. ‏Gemini: עד היום "בלי מחיר". המחירים מאתרי השוואה ולא מדף התמחור של
--    Google (חסום בסשן שכתב את זה), ולכן הם הערכה: flash-lite ‏$0.30 / $2.50,
--    והדמיה ‏$0.50 לקלט ו-$60 למיליון טוקני פלט - הפלט הוא בעיקר טוקני
--    התמונה (‏~$0.067 לתמונה ב-1024px). ‏geminiRow סופר גם טוקני חשיבה וטקסט
--    בפלט, והם מתומחרים כאן במחיר התמונה - ולכן ההדמיה היא הערכה מלמעלה (כ-15%
--    לפי היומן, יותר כש-GEMINI_IMAGE_THINKING מוגדר). שינוי מחיר = שורת update.
-- ============================================================================

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
         between now() - interval '58 minutes' and now() - interval '50 minutes'
     and (select max(l.created_at) from public.ai_usage_log l
           where l.feature = t.bot) > now() - interval '3 hours';
$$;

revoke all on function public.ai_cache_warm_targets() from public, anon, authenticated;
grant execute on function public.ai_cache_warm_targets() to service_role;

comment on function public.ai_cache_warm_targets() is
  'הבוטים שהמטמון שלהם עומד לפוג בשעות היום, ורק עד 3 שעות אחרי קריאה אמיתית (לא חימום) - התנאי של ה-cron ai-cache-warm. docs/platform-costs.md';

insert into public.ai_model_prices
  (model, input_usd_mtok, output_usd_mtok, cache_read_usd_mtok, cache_write_usd_mtok, cache_write_1h_usd_mtok, unit_usd, unit_label) values
  ('claude-haiku-5-5',               0.10,  0.50, 0.01,  0.125, 0.20, null, null),
  ('gemini-3.5-flash-lite',          0.30,  2.50, 0.03,  0.30,  0.30, null, null),
  ('gemini-3.1-flash-image-preview', 0.50, 60.00, 0.05,  0.50,  0.50, null, null)
on conflict (model) do nothing;
