-- ============================================================================
-- מונה החיפושים, תיקון אחרי שלושה ימים באוויר
--
-- הטבלה עלתה ב-28.9.2026 (‏PR ‎#479) ואספה 21 חיפושים בשלושה ימים. הבדיקה
-- של 1.10 מצאה שני דברים, ושניהם היו באחריות המימוש ולא באתר.
--
-- ## ‏1. הטור שבגללו הטבלה נבנתה לא יכול היה להתמלא
--
-- ‏`docs/search-analytics.md` הבטיח ש-"`result_count = 0` הוא עמודה ולא
-- הערה": חיפוש שחזר ריק מספר על נכס שכדאי להשיג. בפועל כל 21 השורות
-- חזרו עם תוצאות, **ולא מפני שכולם מצאו.**
--
-- החיפוש נרשם רק ב-`showSentenceResults()`, כלומר בלחיצה על "הצג N
-- נכסים". כשהמשפט מגיע לאפס תוצאות הממשק מציג "אין כרגע התאמה מדויקת"
-- עם כפתור הרחבה, ומי שרואה את זה לוחץ על ההרחבה ולא על "הצג 0 נכסים".
-- הרגע שבו אדם חיפש ולא מצא **נראה במסך ואינו נכתב למסד**.
--
-- התיקון בלקוח: ‏`assets/home.js` רושם שורה גם כשהמשפט **מתייצב** על
-- אפס תוצאות - אחרי השהיה, ופעם אחת לכל נוסח בטעינת עמוד. העמודה
-- ‏`submitted` היא מה שמפריד בין השניים, וזו הסיבה שהיא כאן:
--
--   ‏`submitted = true`  - מישהו לחץ "הצג N נכסים". חיפוש במובן המלא.
--   ‏`submitted = false` - המשפט נעצר על אפס ואיש לא ביקש לראות.
--
-- **למה עמודה ולא פשוט לספור הכול יחד:** בלי ההפרדה `totals.searches`
-- היה משנה משמעות באמצע - חלק מהשורות הן כוונה מאושרת וחלק מצב שהוסק -
-- ואחוז החיפושים הריקים היה נמדד מול מכנה שאינו כולל את המצבים שהתייצבו
-- על **מספר חיובי**. זו בדיוק השגיאה שתועדה ב-CLAUDE.md תחת *מדידה*:
-- הכותרת מבטיחה דבר אחד והמדד מודד אחר.
--
-- ## ‏2. ‏'bar' הוא שם של דבר שאינו קיים
--
-- הערך `source = 'bar'` נקרא בדשבורד "סרגל החיפוש". אין סרגל חיפוש:
-- מאז החיפוש במשפט אין ב-`index.html` לא `#searchFreeText`, לא
-- ‏`#searchBtn` ולא `#dealTypeSelect`. ‏`runSearch()` נשארה כמסלול שרץ
-- כש-`SentenceSearch` **נחסם** ונופלים ל-`applyDeepLinkFilters()`. לכן
-- הערך נקרא מעכשיו `fallback`, והשורה בדשבורד אומרת את זה.
--
-- **‏'bar' נשאר מותר באילוץ בכוונה.** דפדפן שמחזיק `assets/home.js`
-- במטמון ימשיך לשלוח אותו עוד זמן מה, ואילוץ שידחה אותו היה הופך את
-- החיפושים שלו ל-400 שקט. אפס שורות במסד נושאות אותו היום.
--
-- ## ‏3. תוצאה אחת בלבד
--
-- מה שכן נמצא ב-21 השורות: חיפוש לפי רחוב או שכונה מחזיר נכס בודד -
-- אושיסקין 1, קירשטיין 1, מרכז העיר 3-4 חדרים למכירה 1. זה אינו אפס
-- ולכן לא נספר בשום מקום, ומבחינת מי שמחפש זה כמעט אותו דבר. לכן הדוח
-- מחזיר מעכשיו `single_results` ו-`single_terms` לצד האפסים.
--
-- הקובץ אידמפוטנטי - אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ‏submitted: האם מישהו ביקש לראות את התוצאות
-- ---------------------------------------------------------------------------
alter table public.search_events
  add column if not exists submitted boolean not null default true;

comment on column public.search_events.submitted is
  'true = נלחץ "הצג N נכסים". false = המשפט התייצב על אפס תוצאות ואיש לא ביקש לראות. השורות האלה נספרות בנפרד, כדי ש-totals.searches לא ישנה משמעות.';

-- ---------------------------------------------------------------------------
-- 2. ‏source: fallback במקום bar, ו-bar נשאר מותר למטמון
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'search_events_source_check') then
    alter table public.search_events drop constraint search_events_source_check;
  end if;

  alter table public.search_events
    add constraint search_events_source_check
    check (source in ('sentence','fallback','bar'));
end $$;

-- ---------------------------------------------------------------------------
-- 3. הדוח
-- ---------------------------------------------------------------------------
create or replace function public.platform_search_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_from timestamptz;
  v_out  jsonb;
begin
  if not current_is_platform_admin() then
    raise exception 'הדוח פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;

  v_days := greatest(1, least(365, coalesce(p_days, 30)));
  v_from := now() - make_interval(days => v_days);

  with win as (
    select * from search_events where occurred_at >= v_from
  ),
  -- חיפוש במובן המלא: מישהו ביקש לראות את התוצאות. כל המספרים
  -- שמשווים בין תקופות נגזרים מכאן בלבד.
  sub as (
    select * from win where submitted
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    'totals', jsonb_build_object(
      'searches',       (select count(*) from sub),
      -- כל מי שנגע בחיפוש, כולל מי שרק הגיע לאפס ולא לחץ
      'sessions',       (select count(distinct session_id) from win where session_id is not null),
      'zero_results',   (select count(*) from sub where result_count = 0),
      'single_results', (select count(*) from sub where result_count = 1),
      -- התייצב על אפס ואיש לא ביקש לראות. לא חלק מ-searches.
      'settled_zero',   (select count(*) from win where not submitted),
      'with_term',      (select count(*) from sub where term is not null),
      'median_results', (select coalesce(percentile_cont(0.5) within group (order by result_count), 0)::int from sub)
    ),

    'by_source', (
      select coalesce(jsonb_agg(x order by x.searches desc), '[]'::jsonb)
        from (select source,
                     count(*) as searches,
                     count(*) filter (where result_count = 0) as zero_results
                from sub group by source) x
    ),

    'by_deal', (
      select coalesce(jsonb_agg(d order by d.searches desc), '[]'::jsonb)
        from (select coalesce(deal_type, 'unknown') as deal_type,
                     coalesce(category, 'unknown')  as category,
                     count(*) as searches
                from sub group by 1, 2) d
    ),

    'top_terms', (
      select coalesce(jsonb_agg(t order by t.searches desc, t.term), '[]'::jsonb)
        from (select term,
                     count(*) as searches,
                     count(*) filter (where result_count = 0) as zero_results
                from sub where term is not null
               group by term
               order by count(*) desc, term
               limit 15) t
    ),

    -- הממצא. **נספר במבקרים ולא בשורות**, ומשתי הקבוצות גם יחד: אותו
    -- אדם יכול להתייצב על אפס ואז גם ללחוץ "הצג 0 נכסים", ושתי שורות
    -- על אותו חיפוש היו קוראות לזה שני אנשים.
    'zero_terms', (
      select coalesce(jsonb_agg(z order by z.people desc, z.term), '[]'::jsonb)
        from (select term,
                     count(distinct coalesce(session_id, 'row:' || id::text)) as people
                from win where term is not null and result_count = 0
               group by term
               order by 2 desc, term
               limit 15) z
    ),

    -- תוצאה אחת אינה אפס, ומבחינת מי שמחפש זה כמעט אותו דבר: רחוב או
    -- שכונה שיש בהם נכס בודד הם מלאי חסר בדיוק כמו אפס.
    'single_terms', (
      select coalesce(jsonb_agg(s order by s.people desc, s.term), '[]'::jsonb)
        from (select term,
                     count(distinct coalesce(session_id, 'row:' || id::text)) as people
                from sub where term is not null and result_count = 1
               group by term
               order by 2 desc, term
               limit 15) s
    ),

    'daily', (
      select coalesce(jsonb_agg(dd order by dd.day), '[]'::jsonb)
        from (select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
                     count(*) filter (where submitted) as searches,
                     count(*) filter (where submitted and result_count = 0) as zero_results,
                     count(*) filter (where not submitted) as settled_zero
                from win group by 1) dd
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_search_report(integer) is
  'מה חיפשו באתר בחלון ימים נתון, כמה חזרו ריקים וכמה החזירו נכס בודד. למנהל/ת פלטפורמה בלבד.';

-- ‏revoke משלושתם בשם: ל-anon ול-authenticated יש הרשאה ישירה ולא דרך
-- ‏PUBLIC, ומי שמונה שניים מהשלושה משאיר את השלישי פתוח (ראו CLAUDE.md).
revoke all on function public.platform_search_report(integer) from public, anon, authenticated;
grant execute on function public.platform_search_report(integer) to authenticated;
