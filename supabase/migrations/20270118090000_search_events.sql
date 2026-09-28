-- ============================================================================
-- מונה החיפושים, בדשבורד של מנהל/ת הפלטפורמה
--
-- ‏`assets/home.js` דוחף `search` ל-dataLayer בשני מקומות: סרגל החיפוש
-- והמשפט ("מחפשים דירה להשכרה ב..."). משם זה מגיע ל-GA4 בלבד, ולכן
-- השאלה "מה אנשים מחפשים אצלנו" נשארה בלי תשובה בשלושה מצבים:
--
--   ‏1. **חוסם פרסומות מפיל את GTM**, ואיתו כל האירוע.
--   ‏2. **המכולה יכולה להיות לא מחוברת**, וזה כבר קרה: ההרצה הראשונה של
--      ‏`check_gtm_container.py` מצאה 13 אירועים בקוד מול 0 טריגרים
--      במכולה - כלומר שום אירוע מותאם לא הגיע ל-GA4.
--   ‏3. **הדשבורד מציג את כל שאר המספרים במקום אחד**, ויציאה לממשק אחר
--      בשביל מספר אחד היא יציאה שלא קורית.
--
-- הטבלה כאן אינה מחליפה את GA4 - שם יש פילוח לפי קמפיין ומקור - אלא
-- עונה על השאלה התפעולית: מה חיפשו, וכמה מהחיפושים חזרו ריקים.
--
-- ## החיפוש שהחזיר אפס הוא הממצא
--
-- זה הנתון שבגללו הטבלה נבנתה. חיפוש עם תוצאות מספר על המלאי שיש;
-- חיפוש שחזר ריק מספר על המלאי שחסר, כלומר על נכס שכדאי להשיג או על
-- שכונה שאין בה מספיק. ‏`result_count = 0` הוא לכן עמודה ולא הערה.
--
-- ## מה נשמר, ומה לא
--
-- אין `user_id`, אין כתובת IP ואין User-Agent - בדיוק כמו ב-
-- ‏`pwa_install_events`. מה שכן יש הוא שניים שדורשים הסבר:
--
-- ‏**`session_id`** הוא אותו `shuknadlan_session_id` שכבר קיים ב-
-- ‏`sessionStorage` ושמזין את `property_views`. הוא חי עד סגירת
-- הלשונית, אינו עובר בין מכשירים ואינו מזהה אדם - ובלעדיו אי אפשר
-- להבדיל בין "עשרה אנשים חיפשו" לבין "אדם אחד חיפש עשר פעמים", וזה
-- ההבדל שבין מסקנה לרעש.
--
-- ‏**`term`** הוא טקסט חופשי שאדם הקליד, ולכן הוא היחיד כאן שיכול
-- להכיל בטעות פרט אישי. שלוש הגנות, ושתיהן הראשונות גם בלקוח וגם
-- כאן, כי הלקוח אינו אמין:
--
--   ‏· אורך 80 תווים לכל היותר.
--   ‏· אין `@` - מי שהדביק אימייל לתיבת החיפוש לא נשמר.
--   ‏· אין רצף של תשע ספרות ומעלה - טלפון ישראלי הוא 9-10 ספרות.
--     **הסף אינו שרירותי:** מחיר כמו 1500000 הוא שבע ספרות וחייב
--     לעבור, אחרת נאבד בדיוק את החיפושים שמעניינים.
--
-- חיפוש מהמשפט אינו טקסט חופשי בכלל - הוא מורכב מהאפשרויות שלנו - ולכן
-- הוא נשמר כלשונו תחת `source = 'sentence'`.
--
-- ## הכתיבה אנונימית, הקריאה סגורה
--
-- ‏policy של insert בלבד, ו-GRANT של insert בלבד. שתי שכבות בלתי
-- תלויות, בדיוק מהסיבה שנלמדה ב-`pwa_install_events`: ‏RLS אינו חל על
-- ‏`truncate`, ו-policy אחת שתתווסף בטעות פותחת טבלה שלמה. הקריאה כולה
-- עוברת דרך `platform_search_report()`.
--
-- הקובץ אידמפוטנטי - אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
-- ---------------------------------------------------------------------------
create table if not exists public.search_events (
  id            bigint generated always as identity primary key,

  -- ‏'bar' = סרגל החיפוש (טקסט חופשי), 'sentence' = המשפט הבנוי
  source        text not null,

  -- מה הוקלד, אחרי ניקוי. ‏null כשהחיפוש היה בפילטרים בלבד, או כשהטקסט
  -- נפסל בניקוי (אימייל, טלפון).
  term          text,

  deal_type     text,        -- sale / rent / all
  category      text,        -- residential / commercial / all
  filter_count  integer not null default 0,
  result_count  integer not null default 0,

  -- ‏sessionStorage, חי עד סגירת הלשונית. ראו ההסבר למעלה.
  session_id    text,

  -- נקבע בשרת. הלקוח אינו שולח זמן.
  occurred_at   timestamptz not null default now()
);

comment on table public.search_events is
  'מונה חיפושים באתר הציבורי. בלי משתמש/ת, בלי IP ובלי User-Agent; הטקסט מנוקה מאימייל ומטלפון. כתיבה בלבד לקהל הציבורי, בשתי שכבות. נקרא רק דרך platform_search_report().';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'search_events_source_check') then
    alter table public.search_events
      add constraint search_events_source_check check (source in ('bar','sentence'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'search_events_deal_check') then
    alter table public.search_events
      add constraint search_events_deal_check
      check (deal_type is null or deal_type in ('sale','rent','all'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'search_events_category_check') then
    alter table public.search_events
      add constraint search_events_category_check
      check (category is null or category in ('residential','commercial','all'));
  end if;

  -- שלוש ההגנות על הטקסט החופשי. ראו ההסבר בראש הקובץ.
  if not exists (select 1 from pg_constraint where conname = 'search_events_term_check') then
    alter table public.search_events
      add constraint search_events_term_check
      check (
        term is null
        or (char_length(term) between 1 and 80
            and term !~ '@'
            and term !~ '[0-9]{9,}')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'search_events_session_check') then
    alter table public.search_events
      add constraint search_events_session_check
      check (session_id is null or session_id ~ '^sess_[a-z0-9]{1,48}$');
  end if;

  -- מונים שליליים או מטורפים הם קלט שבור, לא נתון
  if not exists (select 1 from pg_constraint where conname = 'search_events_counts_check') then
    alter table public.search_events
      add constraint search_events_counts_check
      check (filter_count between 0 and 50 and result_count between 0 and 100000);
  end if;
end $$;

-- הדוח תמיד שואל "בחלון הזמן הזה", ולכן זה האינדקס שצריך.
create index if not exists search_events_occurred_idx
  on public.search_events (occurred_at desc);

alter table public.search_events enable row level security;

-- ---------------------------------------------------------------------------
-- 2. ‏RLS + GRANT: כתיבה לכולם, קריאה לאיש
-- ---------------------------------------------------------------------------
drop policy if exists "anyone insert search events" on public.search_events;
create policy "anyone insert search events"
  on public.search_events
  for insert
  to anon, authenticated
  with check (true);

-- השכבה השנייה. הלקוח שולח `Prefer: return=minimal`, ולכן insert בלי
-- returning ואין צורך ב-select. ‏id הוא identity ולא serial, ולכן אין
-- צורך בהרשאה על רצף.
revoke all on table public.search_events from anon, authenticated;
grant insert on table public.search_events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. הדוח - ספירות ומונחים, למנהל/ת פלטפורמה בלבד
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
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    'totals', jsonb_build_object(
      'searches',      (select count(*) from win),
      'sessions',      (select count(distinct session_id) from win where session_id is not null),
      'zero_results',  (select count(*) from win where result_count = 0),
      'with_term',     (select count(*) from win where term is not null),
      'median_results',(select coalesce(percentile_cont(0.5) within group (order by result_count), 0)::int from win)
    ),

    'by_source', (
      select coalesce(jsonb_agg(x order by x.searches desc), '[]'::jsonb)
        from (select source,
                     count(*) as searches,
                     count(*) filter (where result_count = 0) as zero_results
                from win group by source) x
    ),

    'by_deal', (
      select coalesce(jsonb_agg(d order by d.searches desc), '[]'::jsonb)
        from (select coalesce(deal_type, 'unknown') as deal_type,
                     coalesce(category, 'unknown')  as category,
                     count(*) as searches
                from win group by 1, 2) d
    ),

    -- מה חיפשו בפועל. חמישה־עשר המובילים; רשימה ארוכה כאן היא רעש.
    'top_terms', (
      select coalesce(jsonb_agg(t order by t.searches desc, t.term), '[]'::jsonb)
        from (select term,
                     count(*) as searches,
                     count(*) filter (where result_count = 0) as zero_results
                from win where term is not null
               group by term
               order by count(*) desc, term
               limit 15) t
    ),

    -- הממצא: מה חיפשו ולא מצאו. גם מונח שהופיע פעם אחת נחשב כאן, כי
    -- נכס שחסר במלאי אינו צריך להיות פופולרי כדי להיות שווה השגה.
    'zero_terms', (
      select coalesce(jsonb_agg(z order by z.searches desc, z.term), '[]'::jsonb)
        from (select term, count(*) as searches
                from win where term is not null and result_count = 0
               group by term
               order by count(*) desc, term
               limit 15) z
    ),

    'daily', (
      select coalesce(jsonb_agg(dd order by dd.day), '[]'::jsonb)
        from (select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
                     count(*) as searches,
                     count(*) filter (where result_count = 0) as zero_results
                from win group by 1) dd
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_search_report(integer) is
  'מה חיפשו באתר בחלון ימים נתון, וכמה חיפושים חזרו ריקים. למנהל/ת פלטפורמה בלבד.';

-- ‏revoke משלושתם בשם: ל-anon ול-authenticated יש הרשאה ישירה ולא דרך
-- ‏PUBLIC, ומי שמונה שניים מהשלושה משאיר את השלישי פתוח (ראו CLAUDE.md).
revoke all on function public.platform_search_report(integer) from public, anon, authenticated;
grant execute on function public.platform_search_report(integer) to authenticated;
