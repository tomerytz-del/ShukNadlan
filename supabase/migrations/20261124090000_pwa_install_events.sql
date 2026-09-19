-- ============================================================================
-- מדידת ההתקנות של האפליקציה (PWA), בדשבורד של מנהל/ת הפלטפורמה
--
-- מאז שיש באתר כפתור "התקנת האפליקציה" (‏assets/pwa-install.js,
-- ‏docs/pwa-install.md), האירועים שלו נדחפים ל-dataLayer ומשם ל-GA4. זה
-- עובד, אבל יש לו שלושה חורים שהופכים אותו לבלתי שמיש לשאלה "כמה אנשים
-- התקינו":
--
--   ‏1. **‏GA4 אינו במסד.** מנהל/ת הפלטפורמה רואה/ת את כל שאר המספרים
--      בדשבורד אחד, ובשביל ההתקנות צריך לצאת לממשק אחר, של חשבון אחר.
--   ‏2. **חוסם פרסומות מפיל את GTM.** בין 15% ל-30% מהגולשים בישראל —
--      ודווקא אלה שנוטים להתקין אפליקציות — לא נספרים שם כלל.
--   ‏3. **דפי האזור האישי אינם טוענים את events.js במכוון** (ראו
--      CLAUDE.md), ולכן **התקנה של סוכן/ת מה-CRM אינה נמדדת ב-GA4 בכלל.**
--      זה בדיוק הקהל שההתקנה נבנתה בשבילו.
--
-- הטבלה כאן היא המונה שלנו. היא אינה מחליפה את GA4 — שם יש פילוח לפי
-- קמפיין ומקור — אלא עונה על השאלה הפשוטה שהדשבורד שואל: כמה הותקנו, על
-- איזו מערכת, ומה קרה לאלה שראו את ההצעה ולא התקינו.
--
-- ## מה **לא** נשמר כאן, ולמה
--
-- אין user_id, אין agent_id, אין כתובת IP, ואין מחרוזת User-Agent. שורה
-- כאן היא מונה ולא מעקב: אירוע, סוג מערכת, וסוג הדף. הסיבה אינה רק
-- פרטיות — זו גם הסיבה שהטבלה יכולה להיות פתוחה לכתיבה אנונימית בלי
-- להיות נכס שכדאי לתקוף. מי שיכתוב לכאן זבל יטה מונה; הוא לא ידלוף דבר.
--
-- ‏`platform` הוא ה-mode של המודול ('prompt' / 'ios' / 'ios-other' /
-- ‏'in-app' / 'mac-safari'), כלומר **איזה מסלול התקנה הוצע**, ולא איזה
-- מכשיר יש למשתמש/ת. זו ההבחנה שמעניינת: באייפון אין התקנה בלחיצה, ולכן
-- הפער בין 'prompt' ל-'ios' הוא הפער בין מה שאפשר למדוד לבין מה שאפשר רק
-- להסביר.
--
-- ## הכתיבה אנונימית, וזה מכוון
--
-- ‏policy של insert בלבד ל-anon ול-authenticated, בדיוק כמו
-- ‏`anyone insert property views` שכבר קיימת. אין policy של select —
-- כלומר **אף לקוח לא יכול לקרוא מכאן שורה**, גם לא מנהל/ת הפלטפורמה.
-- הקריאה כולה עוברת דרך ה-RPC למטה, שמחזיר ספירות בלבד.
--
-- מה שכן מגן: ה-check constraint על הערכים המותרים, ו-`occurred_at`
-- שנקבע בשרת ולא מגיע מהלקוח — כדי שאי אפשר יהיה לשתול היסטוריה.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
-- ---------------------------------------------------------------------------
create table if not exists public.pwa_install_events (
  id           bigint generated always as identity primary key,

  -- שלבי המשפך, לפי הסדר שבו הם קורים:
  --   banner_shown  — הרצועה עלתה
  --   install_click — נלחץ כפתור ההתקנה (ברצועה או בתפריט)
  --   help_open     — נפתח ההסבר הידני (אייפון, מק)
  --   accepted      — דיאלוג המערכת אושר
  --   dismissed     — דיאלוג המערכת נדחה
  --   installed     — הדפדפן דיווח appinstalled
  --   banner_close  — נלחץ ✕
  event        text not null,

  -- מסלול ההתקנה שהוצע. ראו ההסבר למעלה.
  platform     text not null,

  -- שם הדף בלי הסיומת ('index', 'property', 'crm'). מאיפה מתקינים בפועל
  -- זו שאלה עם תשובה מעשית: היא קובעת לאן כדאי להחזיר את הכפתור.
  page         text,

  -- נקבע בשרת. הלקוח אינו שולח זמן.
  occurred_at  timestamptz not null default now()
);

comment on table public.pwa_install_events is
  'מונה התקנות האפליקציה (PWA). ספירות בלבד — בלי משתמש/ת, בלי IP ובלי User-Agent. נקרא רק דרך platform_pwa_report().';

-- ‏check constraints בתוך do: ‏add constraint אינו מכיר if not exists,
-- והמיגרציה עלולה לרוץ שוב.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pwa_install_events_event_check') then
    alter table public.pwa_install_events
      add constraint pwa_install_events_event_check
      check (event in ('banner_shown','install_click','help_open',
                       'accepted','dismissed','installed','banner_close'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pwa_install_events_platform_check') then
    alter table public.pwa_install_events
      add constraint pwa_install_events_platform_check
      check (platform in ('prompt','ios','ios-other','in-app','mac-safari','unknown'));
  end if;

  -- ‏page מגיע מהלקוח, ולכן הוא חסום באורך ובתבנית. שם דף הוא מזהה קצר
  -- ולא טקסט חופשי, וטור טקסט פתוח לכתיבה אנונימית הוא הזמנה לזבל.
  if not exists (select 1 from pg_constraint where conname = 'pwa_install_events_page_check') then
    alter table public.pwa_install_events
      add constraint pwa_install_events_page_check
      check (page is null or page ~ '^[a-z0-9_-]{1,40}$');
  end if;
end $$;

-- הדוח תמיד שואל "בחלון הזמן הזה", ולכן זה האינדקס היחיד שצריך.
create index if not exists pwa_install_events_occurred_idx
  on public.pwa_install_events (occurred_at desc);

alter table public.pwa_install_events enable row level security;

-- ---------------------------------------------------------------------------
-- 2. ‏RLS: כתיבה לכולם, קריאה לאיש
--
-- מי שגולש/ת באתר אינו/ה מחובר/ת, ולכן הכתיבה חייבת להיות פתוחה ל-anon —
-- אותה החלטה בדיוק שכבר נעשתה ב-property_views. מה שמצמצם אותה הוא
-- ה-check constraints למעלה ו**היעדר** policy של select: שורה שנכתבה
-- לכאן אי אפשר לקרוא בחזרה דרך ה-API, בשום תפקיד.
-- ---------------------------------------------------------------------------
drop policy if exists "anyone insert pwa install events" on public.pwa_install_events;
create policy "anyone insert pwa install events"
  on public.pwa_install_events
  for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 3. הדוח — ספירות בלבד, למנהל/ת פלטפורמה בלבד
--
-- אותו דפוס של platform_admin_monthly_report: ‏security definer שעוקף את
-- ה-RLS, ובשורה הראשונה שלו בדיקת current_is_platform_admin(). בלעדיה הוא
-- מסרב עם 42501 — כי בלי הבדיקה הזו פונקציה כזו היא נקודת קצה פתוחה לכל
-- אנונימי/ת (‏PostgREST חושף כל פונקציה ב-/rest/v1/rpc/).
--
-- למה RPC נפרד ולא הרחבה של הדוח החודשי: הדוח החודשי עונה על שאלות של
-- כסף וקהל, והוא כבר ארוך. התקנות הן נושא נפרד עם חלון זמן משלו, ופונקציה
-- קטנה שאפשר לקרוא במבט אחד עדיפה על עוד ענף בפונקציה של 300 שורות.
-- ---------------------------------------------------------------------------
create or replace function public.platform_pwa_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days  integer;
  v_from  timestamptz;
  v_out   jsonb;
begin
  if not current_is_platform_admin() then
    raise exception 'הדוח פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;

  -- חלון בין יום לשנה. ‏null או ערך מטורף הופכים ל-30, ולא לשגיאה.
  v_days := greatest(1, least(365, coalesce(p_days, 30)));
  v_from := now() - make_interval(days => v_days);

  with win as (
    select event, platform, page
      from pwa_install_events
     where occurred_at >= v_from
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    -- המשפך בחלון. ‏help_open הוא "התקנה" של אייפון מבחינת הכוונה, אבל
    -- הוא לא התקנה בפועל — הדפדפן שם אינו מדווח דבר — ולכן הוא ספירה
    -- נפרדת ולא מחובר ל-installed.
    'funnel', jsonb_build_object(
      'banner_shown',  (select count(*) from win where event = 'banner_shown'),
      'install_click', (select count(*) from win where event = 'install_click'),
      'help_open',     (select count(*) from win where event = 'help_open'),
      'accepted',      (select count(*) from win where event = 'accepted'),
      'dismissed',     (select count(*) from win where event = 'dismissed'),
      'installed',     (select count(*) from win where event = 'installed'),
      'banner_close',  (select count(*) from win where event = 'banner_close')
    ),

    -- הצטברות מאז ומתמיד, כדי שהמספר בדשבורד לא יתאפס עם החלון
    'installed_total', (select count(*) from pwa_install_events where event = 'installed'),

    -- לפי מסלול: כמה ראו הצעה וכמה הגיעו עד הסוף בכל אחד מהם
    'by_platform', (
      select coalesce(jsonb_agg(x order by x.shown desc), '[]'::jsonb)
        from (
          select platform,
                 count(*) filter (where event = 'banner_shown')  as shown,
                 count(*) filter (where event = 'install_click') as clicked,
                 count(*) filter (where event = 'help_open')     as helped,
                 count(*) filter (where event = 'installed')     as installed
            from win
           group by platform
        ) x
    ),

    -- מאיזה דף מתקינים בפועל. חמישה המובילים — רשימה ארוכה כאן היא רעש.
    'by_page', (
      select coalesce(jsonb_agg(y order by y.installed desc, y.clicked desc), '[]'::jsonb)
        from (
          select coalesce(page, 'unknown') as page,
                 count(*) filter (where event = 'install_click') as clicked,
                 count(*) filter (where event in ('installed','help_open')) as installed
            from win
           group by 1
           order by 3 desc, 2 desc
           limit 5
        ) y
    ),

    -- מגמה יומית להתקנות, לגרף העמודות
    'daily', (
      select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
        from (
          select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
                 count(*) filter (where event = 'installed')  as installed,
                 count(*) filter (where event = 'help_open')  as helped
            from pwa_install_events
           where occurred_at >= v_from
           group by 1
        ) d
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_pwa_report(integer) is
  'משפך ההתקנות של האפליקציה בחלון ימים נתון. ספירות בלבד, למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_pwa_report(integer) from public, anon;
grant execute on function public.platform_pwa_report(integer) to authenticated;
