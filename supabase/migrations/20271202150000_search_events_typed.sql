-- ============================================================================
-- מונה החיפושים: מה שהוקלד בפועל (26.11.2026)
--
-- ‏**כל 405 החיפושים מהאתר ב-45 הימים האחרונים נרשמו כמשפט שהחיפוש בנה**
-- ("אני רוצה לשכור דירה ב..."), ואפס כטקסט שהוקלד. ‏`term` הוא `describe()`
-- של המצב אחרי הפירוש, ולכן מה שלא זוהה נעלם ממנו: "חנות החשמל" נרשמה כחנות
-- בלי רחוב, והחיפוש שלא מצא אותה לא השאיר שום עקבות. בלי הטקסט עצמו אי אפשר
-- לראות מה אנשים מנסים ולא מוצאים.
--
-- עמודה חדשה `typed`, באותה שורה: מה שהוקלד בשדה החופשי, אחרי ניקוי. ‏NULL
-- כשהחיפוש היה בבורר בלבד. אותן הגנות כמו `term` גם כאן וגם בלקוח (עד 80
-- תווים, בלי @, בלי רצף של תשע ספרות ומעלה), והלקוח מחמיר: טלפון עם מקפים
-- או רווחים ("050-123-4567") נפסל, וזה מה ש-`[0-9]{9,}` אינו תופס.
-- ‏`totals.searches` לא משתנה: זו אותה שורה.
--
-- הדוח מחזיר `typed_terms` ו-`typed_zero_terms` (ו-`totals.with_typed`), בלי לגעת
-- בשאר המפתחות. אותה חתימה, אותו אבטחה, אותן הרשאות.
--
-- אידמפוטנטי. ‏**הלקוח שולח `typed` ואם הטור טרם קיים, השורה נדחית - לכן הוא
-- שולח שוב בלעדיו** (assets/home.js, logSearchToDb).
-- ============================================================================

alter table public.search_events
  add column if not exists typed text;

comment on column public.search_events.typed is
  'מה שהוקלד בשדה החופשי אחרי ניקוי (עד 80 תווים, בלי @ ובלי תשע ספרות ברצף). NULL = חיפוש בבורר בלבד. term הוא המשפט שהחיפוש בנה מהפירוש.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'search_events_typed_check') then
    alter table public.search_events
      add constraint search_events_typed_check
      check (
        typed is null
        or (char_length(typed) between 1 and 80
            and typed !~ '@'
            and typed !~ '[0-9]{9,}')
      );
  end if;
end $$;

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
      'with_typed',     (select count(*) from sub where typed is not null),
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

    -- מה שהוקלד בשדה החופשי, כלשונו אחרי ניקוי (typed). המשפט שב-term נבנה
    -- מהפירוש ומסתיר מה נאמר: "חנות החשמל" הפכה ל"אני רוצה חנות עם כל גודל".
    -- **נספר במבקרים**, כמו zero_terms. רק שורות שנרשמו אחרי העמודה.
    'typed_zero_terms', (
      select coalesce(jsonb_agg(z order by z.people desc, z.typed), '[]'::jsonb)
        from (select typed,
                     count(distinct coalesce(session_id, 'row:' || id::text)) as people
                from win where typed is not null and result_count = 0
               group by typed
               order by 2 desc, typed
               limit 15) z
    ),

    'typed_terms', (
      select coalesce(jsonb_agg(t order by t.people desc, t.typed), '[]'::jsonb)
        from (select typed,
                     count(distinct coalesce(session_id, 'row:' || id::text)) as people
                from sub where typed is not null
               group by typed
               order by 2 desc, typed
               limit 25) t
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
  'מה חיפשו באתר בחלון ימים נתון, כמה חזרו ריקים וכמה החזירו נכס בודד, ומה הוקלד בפועל. למנהל/ת פלטפורמה בלבד.';

-- ‏revoke משלושתם בשם: ל-anon ול-authenticated יש הרשאה ישירה ולא דרך
-- ‏PUBLIC, ומי שמונה שניים מהשלושה משאיר את השלישי פתוח (ראו CLAUDE.md).
revoke all on function public.platform_search_report(integer) from public, anon, authenticated;
grant execute on function public.platform_search_report(integer) to authenticated;
