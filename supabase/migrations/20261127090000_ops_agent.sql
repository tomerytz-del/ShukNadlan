-- ============================================================================
-- הסוכן התפעולי ומצבת המערכת — שתי לשוניות חדשות ב-CRM של מנהל/ת הפלטפורמה
--
-- ## מה היה חסר
--
-- לפלטפורמה יש היום 24 job-ים ב-pg_cron, שישה תורים, שני מנועים שרצים
-- ב-GitHub Actions, עשרות Edge Functions ו-121 מיגרציות. כשמשהו מזה
-- נשבר, **אין לזה שום סימן**: ה-job נכשל בשקט, התור מתמלא, והאתר ממשיך
-- להיראות תקין לחלוטין. הדרך היחידה לדעת הייתה לפתוח את הדשבורד של
-- Supabase, את לשונית Actions ואת הלוגים — אחד-אחד, ידנית, ורק אם כבר
-- חשדת שמשהו לא בסדר.
--
-- אותו דבר בכיוון השני: השאלות הניהוליות הבסיסיות ("כמה נכסים יש",
-- "כמה שיתופי פעולה נעשו", "כמה לקוחות יש לכל המתווכים ביחד") לא היו
-- נגישות משום מסך. הדוח החודשי הקיים
-- (`platform_admin_monthly_report`) עונה על "מה קרה החודש" — זרימה.
-- מה שלא היה הוא **מצבת**: כמה יש, בסך הכול, עכשיו.
--
-- ## מה נכנס כאן
--
--   1. `ops_findings` + `ops_scans` — הטבלאות שהסוכן התפעולי
--      (`ops_scan.py`, רץ ב-Actions כל שש שעות) כותב אליהן.
--   2. `platform_ops_report()` — בריאות, ביצועים, אופטימיזציה ואבטחה.
--   3. `platform_inventory_report()` — מצבת המערכת. כל מספר, לפי נושא.
--   4. `platform_ops_mute()` — השתקת ממצא שכבר הוחלט לחיות איתו.
--
-- ## למה הממצאים במסד ולא ב-Issue ב-GitHub
--
-- שלוש סיבות, והשלישית היא העיקרית:
--
--   * מנהל/ת הפלטפורמה כבר נמצא/ת ב-CRM. מסך שצריך לצאת אליו הוא מסך
--     שלא נפתח.
--   * ‏Issue הוא רשימה שמתארכת. טבלה עם `key` יציב מאפשרת לדעת **מה
--     חדש, מה נסגר ומה מחמיר**, וזה ההבדל בין דיווח לניטור.
--   * שורה במסד אפשר להצליב עם שאר הנתונים. "תור ההדמיות תקוע" ליד
--     "בוצעו 105 הדמיות" הוא סיפור אחד, לא שני מסכים.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ‏ops_scans — יומן הסריקות
--
-- למה טבלה נפרדת ולא עמודה בממצא: השאלה "מתי נסרקתי לאחרונה, והאם
-- הסריקה עצמה הצליחה" היא שאלה על הסוכן, לא על המערכת. **סוכן שהפסיק
-- לרוץ מציג בדיוק אותו מסך כמו מערכת בריאה** — אפס ממצאים חדשים — וזו
-- הסכנה המרכזית בכלי מהסוג הזה. לכן הדשבורד מתחיל בשורה "נסרק לפני X",
-- והיא נקראת מכאן.
-- ---------------------------------------------------------------------------
create table if not exists public.ops_scans (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean     not null default true,
  -- מערך של {name, ok, error, findings, checks, duration_ms} לכל probe.
  -- ‏probe שנפלה מופיעה כאן, והדשבורד מציג אזהרה: "בדיקת האבטחה לא רצה"
  -- אינו זהה ל"אין ממצאי אבטחה".
  probes       jsonb       not null default '[]'::jsonb,
  counts       jsonb       not null default '{}'::jsonb,
  error        text
);

comment on table public.ops_scans is
  'יומן ההרצות של הסוכן התפעולי (ops_scan.py). סריקה שלא רצה היא עצמה ממצא.';

create index if not exists ops_scans_started_idx
  on public.ops_scans (started_at desc);

-- ---------------------------------------------------------------------------
-- 2. ‏ops_findings — הממצאים עצמם
--
-- ‏`key` הוא המפתח הראשי, ולא `id` רץ. זו ההחלטה היחידה שחשובה כאן:
-- אותה בעיה על אותו אובייקט מקבלת את אותו מפתח בכל סריקה, ולכן
-- ‏`insert … on conflict (key) do update` הוא כל מנגנון המעקב.
-- בלעדיו כל סריקה הייתה מייצרת 40 ממצאים "חדשים", ואחרי שבוע איש לא
-- היה קורא את הרשימה.
--
-- ‏`first_seen` אינו מתעדכן בעדכון — "מתי זה התחיל" היא לרוב השאלה
-- החשובה יותר. ‏`prev_metric` שומר את הערך הקודם לפני הדריסה, וזה מה
-- שמאפשר לומר "החמיר מ-3 ל-11" במקום רק "יש בעיה".
-- ---------------------------------------------------------------------------
create table if not exists public.ops_findings (
  key          text primary key,

  area         text not null,   -- health | performance | frontend | behavior | security | cost
  code         text not null,   -- מזהה סוג הבעיה, בלי הנושא
  severity     text not null,   -- critical | high | medium | low | info
  subject      text,            -- על מה בדיוק: טבלה, דף, פונקציה

  title        text not null,
  detail       text not null,
  suggestion   text,

  metric       numeric,
  metric_unit  text,
  prev_metric  numeric,
  evidence     jsonb not null default '{}'::jsonb,

  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  resolved_at  timestamptz,
  -- השתקה ידנית: ממצא שהוחלט לחיות איתו. הוא ממשיך להיסרק ולהתעדכן,
  -- אבל אינו נספר בכותרת ואינו צובע את הפאנל באדום. **אין כאן מחיקה**:
  -- ממצא שנמחק חוזר בסריקה הבאה כאילו הוא חדש, והשתקה בלי תוקף היא
  -- הדרך לשכוח מבעיה אמיתית.
  muted_until  timestamptz,
  muted_note   text,

  scan_id      bigint references public.ops_scans(id) on delete set null
);

comment on table public.ops_findings is
  'ממצאי הסוכן התפעולי. מפתח יציב לכל בעיה — כך יודעים מה חדש, מה נסגר ומה מחמיר.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ops_findings_severity_check') then
    alter table public.ops_findings
      add constraint ops_findings_severity_check
      check (severity in ('critical','high','medium','low','info'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ops_findings_area_check') then
    alter table public.ops_findings
      add constraint ops_findings_area_check
      check (area in ('health','performance','frontend','behavior','security','cost'));
  end if;
end $$;

-- הדשבורד תמיד שואל "מה פתוח, לפי חומרה". זה האינדקס שמשרת אותו.
create index if not exists ops_findings_open_idx
  on public.ops_findings (severity, last_seen desc)
  where resolved_at is null;

create index if not exists ops_findings_area_idx
  on public.ops_findings (area, resolved_at);

-- ---------------------------------------------------------------------------
-- 3. ‏RLS: אף לקוח אינו קורא מכאן שורה
--
-- אותה החלטה כמו ב-pwa_install_events: ‏RLS דלוק, **אפס policies**.
-- הכתיבה נעשית מהסוכן דרך חיבור ישיר (SUPABASE_DB_URL ב-Actions), שאינו
-- עובר דרך PostgREST כלל. הקריאה כולה דרך ה-RPC למטה.
--
-- זה חשוב במיוחד כאן: `ops_findings` הוא **מפת חולשות המערכת**. טבלה
-- שמפרטת אילו פונקציות פתוחות לאנונימי/ת ואילו טבלאות בלי RLS היא הדבר
-- האחרון שצריך להיות קריא דרך ה-API.
-- ---------------------------------------------------------------------------
alter table public.ops_findings enable row level security;
alter table public.ops_scans    enable row level security;

-- ---------------------------------------------------------------------------
-- 4. ‏platform_ops_report — בריאות, ביצועים, אופטימיזציה ואבטחה
--
-- אותו דפוס של platform_pwa_report: ‏security definer שעוקף RLS, ובשורה
-- הראשונה בדיקת current_is_platform_admin(). בלעדיה זו נקודת קצה פתוחה
-- לכל אנונימי/ת — ‏PostgREST חושף כל פונקציה ב-/rest/v1/rpc/.
-- ---------------------------------------------------------------------------
create or replace function public.platform_ops_report(p_days integer default 30)
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

  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    -- ‏1. הסריקה האחרונה. הדשבורד פותח בזה בכוונה: סוכן שהפסיק לרוץ
    --    נראה בדיוק כמו מערכת בריאה, וזו הטעות שהכי קל ליפול בה.
    'scan', (
      select jsonb_build_object(
               'id',          s.id,
               'at',          s.finished_at,
               'ok',          s.ok,
               'age_minutes', round(extract(epoch from (now() - s.finished_at)) / 60),
               'probes',      s.probes,
               'failed_probes', (
                 select coalesce(jsonb_agg(p->>'name'), '[]'::jsonb)
                   from jsonb_array_elements(s.probes) p
                  where (p->>'ok')::boolean is not true
               ))
        from ops_scans s
       where s.finished_at is not null
       order by s.finished_at desc
       limit 1
    ),

    -- ‏2. הספירות. ממצא מושתק אינו נספר — זו כל הנקודה בהשתקה.
    'counts', (
      select jsonb_build_object(
               'critical', count(*) filter (where severity = 'critical'),
               'high',     count(*) filter (where severity = 'high'),
               'medium',   count(*) filter (where severity = 'medium'),
               'low',      count(*) filter (where severity = 'low'),
               'info',     count(*) filter (where severity = 'info'),
               'open',     count(*),
               'new',      count(*) filter (where first_seen > now() - interval '48 hours'),
               'muted',    (select count(*) from ops_findings
                             where resolved_at is null
                               and muted_until is not null
                               and muted_until > now()))
        from ops_findings
       where resolved_at is null
         and (muted_until is null or muted_until <= now())
    ),

    -- ‏3. לפי תחום — זה מה שמצייר את ארבע הרצועות בראש הפאנל
    'areas', (
      select coalesce(jsonb_agg(x order by x.rank), '[]'::jsonb)
        from (
          select area,
                 count(*)                                          as open,
                 count(*) filter (where severity in ('critical','high')) as urgent,
                 min(case severity when 'critical' then 1 when 'high' then 2
                                   when 'medium'   then 3 when 'low'  then 4
                                   else 5 end)                     as rank
            from ops_findings
           where resolved_at is null
             and (muted_until is null or muted_until <= now())
           group by area
        ) x
    ),

    -- ‏4. הממצאים הפתוחים. ‏trend מחושב כאן ולא בדפדפן: הוא נגזר משתי
    --    עמודות שרק המסד רואה, ולוגיקה כזו בדפדפן מתפצלת מהאמת.
    'findings', (
      -- ‏src.f ולא f: לתת-שאילתה ולעמודה שבתוכה אותו שם, ו-`jsonb_agg(f)`
      -- הוא בדיוק סוג הביטוי שיתפרש יום אחד כשורה שלמה במקום כעמודה.
      select coalesce(jsonb_agg(src.f order by src.rank, src.last_seen desc),
                      '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'key',        key,
                   'area',       area,
                   'code',       code,
                   'severity',   severity,
                   'subject',    subject,
                   'title',      title,
                   'detail',     detail,
                   'suggestion', suggestion,
                   'metric',     metric,
                   'metric_unit',metric_unit,
                   'prev_metric',prev_metric,
                   'evidence',   evidence,
                   'first_seen', first_seen,
                   'last_seen',  last_seen,
                   'age_days',   greatest(0, round(extract(epoch from (now() - first_seen)) / 86400)),
                   'is_new',     first_seen > now() - interval '48 hours',
                   'muted',      muted_until is not null and muted_until > now(),
                   'muted_until',muted_until,
                   'trend',      case
                                   when metric is null or prev_metric is null then null
                                   when metric > prev_metric then 'worse'
                                   when metric < prev_metric then 'better'
                                   else 'same'
                                 end
                 ) as f,
                 case severity when 'critical' then 1 when 'high' then 2
                               when 'medium'   then 3 when 'low'  then 4
                               else 5 end as rank,
                 last_seen
            from ops_findings
           where resolved_at is null
           order by rank, last_seen desc
           limit 200
        ) src
    ),

    -- ‏5. מה נסגר מאליו. בלי זה הדשבורד מראה רק חובות, ואף פעם לא
    --    תשלומים — ואז הוא מדכא ולא מועיל.
    'resolved', (
      select coalesce(jsonb_agg(src.r order by src.resolved_at desc), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'key', key, 'area', area, 'severity', severity,
                   'title', title, 'resolved_at', resolved_at,
                   'lasted_days', greatest(0, round(
                     extract(epoch from (resolved_at - first_seen)) / 86400))
                 ) as r, resolved_at
            from ops_findings
           where resolved_at is not null
             and resolved_at >= v_from
           order by resolved_at desc
           limit 25
        ) src
    ),

    -- ‏6. מגמה יומית: נפתחו מול נסגרו. שתי עקומות שמצטלבות הן התשובה
    --    לשאלה "האם אנחנו מדביקים את הקצב".
    'history', (
      select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
        from (
          select to_char(day, 'YYYY-MM-DD') as day,
                 (select count(*) from ops_findings f
                   where date_trunc('day', f.first_seen) = day)   as opened,
                 (select count(*) from ops_findings f
                   where date_trunc('day', f.resolved_at) = day)  as resolved
            from generate_series(date_trunc('day', v_from),
                                 date_trunc('day', now()),
                                 interval '1 day') as day
        ) d
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_ops_report(integer) is
  'ממצאי הסוכן התפעולי לדשבורד. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_ops_report(integer) from public, anon;
grant execute on function public.platform_ops_report(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ‏platform_ops_mute — השתקת ממצא שהוחלט לחיות איתו
--
-- למה זה קיים בכלל: דוח שמציג שבועות ברציפות ממצא שכבר הוחלט לא לתקן
-- הוא דוח שמלמדים להתעלם ממנו — ואז גם הממצא החדש שלידו לא נקרא.
--
-- ההשתקה **בתוקף מוגבל** ובכוונה. "לא רלוונטי" קבוע הוא איך שבעיה
-- אמיתית נעלמת; חודש שקט ואז שאלה חוזרת הוא התנהגות בריאה.
-- ---------------------------------------------------------------------------
create or replace function public.platform_ops_mute(
  p_key  text,
  p_days integer default 30,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_days  integer;
  v_until timestamptz;
begin
  if not current_is_platform_admin() then
    raise exception 'השתקת ממצא פתוחה למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;

  -- ‏0 או שלילי = ביטול ההשתקה. זו הדרך להחזיר ממצא לרשימה.
  v_days := coalesce(p_days, 30);
  if v_days <= 0 then
    update ops_findings
       set muted_until = null, muted_note = null
     where key = p_key;
    return jsonb_build_object('key', p_key, 'muted_until', null);
  end if;

  -- תקרה של 180 יום: השתקה לשנתיים היא מחיקה בתחפושת.
  v_until := now() + make_interval(days => least(180, v_days));

  update ops_findings
     set muted_until = v_until,
         muted_note  = nullif(btrim(coalesce(p_note, '')), '')
   where key = p_key;

  if not found then
    raise exception 'ממצא לא נמצא: %', p_key using errcode = 'P0002';
  end if;

  return jsonb_build_object('key', p_key, 'muted_until', v_until);
end;
$$;

comment on function public.platform_ops_mute(text, integer, text) is
  'השתקת ממצא תפעולי לתקופה מוגבלת. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_ops_mute(text, integer, text) from public, anon;
grant execute on function public.platform_ops_mute(text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ‏platform_inventory_report — מצבת המערכת
--
-- ## במה זה שונה מהדוח החודשי
--
-- ‏`platform_admin_monthly_report` הוא **זרימה**: מה נכנס החודש, מה
-- השתנה מול החודש שעבר. הפונקציה כאן היא **מצבת**: כמה יש עכשיו, בסך
-- הכול, מאז ומתמיד — ולצד כל מספר, כמה מתוכו נוסף בחלון הנבחר.
--
-- שתי השאלות שונות, ושתיהן ניהוליות. "נכנסו 12 לידים החודש" אינו עונה
-- על "כמה לקוחות יש בסך הכול למתווכים שלנו", וזו בדיוק השאלה שנשאלת
-- כשמדברים עם משקיע/ה או עם משרד חדש.
--
-- ## למה הכול בפונקציה אחת
--
-- ‏15 קריאות RPC נפרדות היו 15 חיבורים, 15 מצבי טעינה ו-15 מקומות
-- להישבר. הספירות כאן זולות — הטבלה הגדולה במסד היא 640KB — ולכן
-- הפונקציה רצה במאות מילישניות ומחזירה מסמך אחד.
--
-- ## למה `count(*)` ולא מונה שנשמר
--
-- מונה שנשמר הוא מונה שמשקר: כל מחיקה, כל שינוי סטטוס וכל תיקון ידני
-- מסיטים אותו, ואיש לא מגלה. ספירה חיה תמיד נכונה. ברגע שטבלה תגדל
-- מספיק כדי שזה יכאב — זו תהיה החלטה מודעת עם מונה מתוחזק, ולא ברירת
-- מחדל שנבחרה מראש בלי צורך.
-- ---------------------------------------------------------------------------
create or replace function public.platform_inventory_report(p_days integer default 30)
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

  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  v_days,

    -- ================================================== אנשים ועסקים
    'people', jsonb_build_object(
      'agencies',           (select count(*) from agencies),
      'agencies_new',       (select count(*) from agencies where created_at >= v_from),
      'agents',             (select count(*) from agency_members where active),
      'agents_total',       (select count(*) from agency_members),
      'agents_new',         (select count(*) from agency_members where created_at >= v_from),
      'agents_closed',      (select count(*) from agency_members where closed_at is not null),
      'agents_onboarded',   (select count(*) from agency_members where onboarding_done_at is not null),
      'platform_admins',    (select count(*) from agency_members where is_platform_admin),
      'mortgage_advisors',  (select count(*) from agency_members where is_mortgage_advisor and active),
      'developers',         (select count(*) from developers),
      'developers_new',     (select count(*) from developers where created_at >= v_from),
      -- לפי מסלול: זו התשובה ל"כמה מהם משלמים"
      'by_tier', (
        select coalesce(jsonb_object_agg(tier, n), '{}'::jsonb)
          from (select coalesce(tier, 'ללא') as tier, count(*) as n
                  from agency_members where active group by 1) t
      ),
      'paying', (select count(*) from agency_members
                  where active and paid_tier is not null
                    and (paid_tier_until is null or paid_tier_until > now())),
      'license_verified', (select count(*) from agency_members
                            where active and license_status = 'verified')
    ),

    -- ================================================== נכסים
    'properties', jsonb_build_object(
      'total',        (select count(*) from properties),
      'active',       (select count(*) from properties where status = 'active'),
      'new',          (select count(*) from properties where created_at >= v_from),
      'promoted',     (select count(*) from properties
                        where is_promoted and (promoted_until is null or promoted_until > now())),
      'open_house',   (select count(*) from properties where open_house),
      'with_images',  (select count(*) from properties
                        where status = 'active' and coalesce(array_length(images, 1), 0) > 0),
      'with_video',   (select count(*) from properties
                        where status = 'active' and video_url is not null),
      'with_tour',    (select count(*) from properties
                        where status = 'active' and has_virtual_tour),
      'with_text',    (select count(*) from properties
                        where status = 'active' and marketing_description is not null),
      'geocoded',     (select count(*) from properties
                        where status = 'active' and lat is not null and lng is not null),
      'avg_price',    (select round(avg(price)) from properties
                        where status = 'active' and price > 0),
      'median_price', (select round(percentile_cont(0.5) within group (order by price))
                         from properties where status = 'active' and price > 0),
      'by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from properties group by 1) t
      ),
      'by_deal', (
        select coalesce(jsonb_object_agg(deal_type, n), '{}'::jsonb)
          from (select coalesce(deal_type, '—') as deal_type, count(*) as n
                  from properties where status = 'active' group by 1) t
      ),
      'by_category', (
        select coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
          from (select coalesce(category, '—') as category, count(*) as n
                  from properties where status = 'active' group by 1) t
      ),
      'top_cities', (
        select coalesce(jsonb_agg(x.c order by x.n desc), '[]'::jsonb)
          from (select jsonb_build_object('city', coalesce(city, '—'), 'n', count(*)) as c,
                       count(*) as n
                  from properties where status = 'active'
                 group by city order by count(*) desc limit 8) x
      )
    ),

    -- ================================================== שיתופי פעולה
    -- זו השאלה שהפלטפורמה כולה נבנתה סביבה, ולכן היא קבוצה משלה ולא
    -- שורה בתוך "נכסים".
    'collaboration', jsonb_build_object(
      'shares',            (select count(*) from property_shares),
      'shares_new',        (select count(*) from property_shares where created_at >= v_from),
      'properties_shared', (select count(distinct property_id) from property_shares),
      'agencies_sharing',  (select count(distinct owner_agency_id) from property_shares),
      'agencies_receiving',(select count(distinct shared_with_agency_id) from property_shares),
      'opted_in',          (select count(*) from properties
                             where status = 'active' and shared_with_partners),
      'opted_out_agents',  (select count(*) from agent_share_exclusions),
      -- הסכמים: הצורה המשפטית של שיתוף הפעולה
      'agreements',        (select count(*) from agreements),
      'agreements_signed', (select count(*) from agreements where status = 'signed'),
      'agreements_new',    (select count(*) from agreements where created_at >= v_from),
      'agreements_by_kind', (
        select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
          from (select coalesce(kind, '—') as kind, count(*) as n
                  from agreements group by 1) t
      ),
      'agreements_by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from agreements group by 1) t
      ),
      'exclusivities_active', (select count(*) from property_exclusivities
                                where released_at is null
                                  and (ends_on is null or ends_on >= current_date)),
      'contracts',         (select count(*) from contracts),
      'contracts_signed',  (select count(*) from contracts where status = 'signed')
    ),

    -- ================================================== לקוחות המתווכים
    'clients', jsonb_build_object(
      'total',      (select count(*) from agent_clients),
      'active',     (select count(*) from agent_clients where status = 'active'),
      'new',        (select count(*) from agent_clients where created_at >= v_from),
      'with_agent', (select count(distinct agent_id) from agent_clients),
      'per_agent',  (select round(count(*)::numeric
                                  / greatest(count(distinct agent_id), 1), 1)
                       from agent_clients),
      'by_deal', (
        select coalesce(jsonb_object_agg(deal_type, n), '{}'::jsonb)
          from (select coalesce(deal_type, '—') as deal_type, count(*) as n
                  from agent_clients group by 1) t
      ),
      -- התאמות שהמערכת מצאה ללקוחות האלה — זו התמורה שהם מקבלים
      'matches',      (select count(*) from client_match_alerts),
      'matches_new',  (select count(*) from client_match_alerts where created_at >= v_from),
      'matches_seen', (select count(*) from client_match_alerts where seen_at is not null)
    ),

    -- ================================================== מדיה והדמיות
    'media', jsonb_build_object(
      'visualizations',       (select count(*) from property_visualizations),
      'visualizations_done',  (select count(*) from property_visualizations
                                where status = 'done'),
      'visualizations_new',   (select count(*) from property_visualizations
                                where created_at >= v_from),
      'visualizations_by_kind', (
        select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
          from (select coalesce(kind, '—') as kind, count(*) as n
                  from property_visualizations group by 1) t
      ),
      'visualization_jobs', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from visualization_jobs group by 1) t
      ),
      'videos',        (select count(*) from property_video_jobs where result_url is not null),
      'videos_new',    (select count(*) from property_video_jobs
                         where result_url is not null and created_at >= v_from),
      'video_jobs', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from property_video_jobs group by 1) t
      ),
      'virtual_tours', (select count(*) from property_virtual_tours),
      'image_tags',    (select count(*) from property_image_tags),
      'project_media', (select count(*) from project_media)
    ),

    -- ================================================== לידים וביקוש
    'demand', jsonb_build_object(
      'leads',        (select count(*) from leads),
      'leads_new',    (select count(*) from leads where created_at >= v_from),
      'leads_open',   (select count(*) from leads where unlocked_at is null),
      'leads_by_type', (
        select coalesce(jsonb_object_agg(lead_type, n), '{}'::jsonb)
          from (select coalesce(lead_type, '—') as lead_type, count(*) as n
                  from leads group by 1) t
      ),
      'leads_by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
          from (select coalesce(status, '—') as status, count(*) as n
                  from leads group by 1) t
      ),
      'mortgage_leads',  (select count(*) from mortgage_leads),
      'project_leads',   (select count(*) from project_leads),
      'rss_leads',       (select count(*) from rss_leads where is_lead),
      'rss_leads_sold',  (select count(*) from rss_leads where sold_at is not null),
      'saved_searches',  (select count(*) from saved_searches where status = 'active'),
      'saved_alerts_sent', (select coalesce(sum(alerts_sent), 0) from saved_searches),
      'reviews',         (select count(*) from reviews where status = 'published'),
      'avg_rating',      (select round(avg(rating)::numeric, 2) from reviews
                           where status = 'published')
    ),

    -- ================================================== כסף
    -- כל שורה כאן היא סכום של עסקאות שהצליחו בלבד, וכל טבלה נמדדת לפי
    -- **ערך הסטטוס שלה עצמה**: ‏`success` בטעינות ובמנויים, ‏`charged`
    -- בחיובי הסרטונים והפרויקטים, ‏`paid` בטעינות של יזמים, ו-
    -- ‏`active`/`expired` בקידומים (שם 'expired' פירושו חודש שהסתיים,
    -- כלומר כסף שכן נגבה). ערך אחיד אחד לכל הטבלאות היה מחזיר אפס
    -- בשקט בחצי מהשורות — וזו בדיוק הצורה של מספר ניהולי שגוי.
    --
    -- ‏test_mode מוחרג: טעינת בדיקה שנספרת כהכנסה היא איך שמספר הופך
    -- לחסר ערך.
    'money', jsonb_build_object(
      'topups',        (select coalesce(sum(amount), 0) from wallet_topups
                         where status = 'success' and not coalesce(test_mode, false)),
      'topups_window', (select coalesce(sum(amount), 0) from wallet_topups
                         where status = 'success' and not coalesce(test_mode, false)
                           and created_at >= v_from),
      'refunds',       (select coalesce(sum(amount), 0) from wallet_refunds
                         where status = 'completed'),
      'lead_charges',  (select coalesce(sum(amount), 0) from lead_charges
                         where status = 'success'),
      'rss_purchases', (select coalesce(sum(amount), 0) from rss_lead_purchases
                         where status = 'success'),
      'mortgage_purchases', (select coalesce(sum(amount), 0) from mortgage_lead_purchases
                              where status = 'success'),
      'search_purchases',   (select coalesce(sum(amount), 0) from saved_search_lead_purchases
                              where status = 'success'),
      'promotions',    (select coalesce(sum(amount), 0) from promotion_charges
                         where status in ('active', 'expired')),
      'videos',        (select coalesce(sum(amount), 0) from property_video_charges
                         where status = 'charged'),
      'subscriptions', (select coalesce(sum(amount), 0) from subscription_orders
                         where status = 'success' and not coalesce(test_mode, false)),
      'ads',           (select coalesce(sum(amount), 0) from ad_orders
                         where status = 'success' and not coalesce(test_mode, false)),
      'project_charges', (select coalesce(sum(amount), 0) from project_charges
                           where status = 'charged'),
      'developer_topups', (select coalesce(sum(amount), 0) from developer_topups
                            where status = 'paid' and not coalesce(test_mode, false)),
      'wallet_balance', (select coalesce(sum(credit_balance), 0) from agency_members
                          where active),
      'invoices',      (select count(*) from invoices),
      -- טעינות בדיקה — מוצגות בנפרד כדי שיהיה ברור שהן קיימות ולא נספרות
      'test_topups',   (select count(*) from wallet_topups where coalesce(test_mode, false))
    ),

    -- ================================================== פרויקטים חדשים
    'projects', jsonb_build_object(
      'total',      (select count(*) from projects),
      'published',  (select count(*) from projects where status = 'active'),
      'new',        (select count(*) from projects where created_at >= v_from),
      'units',      (select coalesce(sum(total_units), 0) from projects
                      where status = 'active'),
      'units_free', (select coalesce(sum(available_units), 0) from projects
                      where status = 'active'),
      'views',      (select count(*) from project_views where viewed_at >= v_from)
    ),

    -- ================================================== קהל ותנועה
    'audience', jsonb_build_object(
      'property_views',   (select count(*) from property_views where viewed_at >= v_from),
      'unique_visitors',  (select count(distinct visitor_session_id)
                             from property_views where viewed_at >= v_from),
      'newsletter',       (select count(*) from newsletter_subscribers
                            where unsubscribed_at is null),
      'newsletter_new',   (select count(*) from newsletter_subscribers
                            where created_at >= v_from and unsubscribed_at is null),
      'open_house_subs',  (select count(*) from open_house_subscribers
                            where unsubscribed_at is null),
      'whatsapp_chats',   (select count(*) from whatsapp_conversations),
      'whatsapp_public',  (select count(*) from whatsapp_public_conversations),
      'whatsapp_in',      (select count(*) from whatsapp_messages
                            where direction = 'in' and created_at >= v_from),
      'pwa_installs',     (select count(*) from pwa_install_events
                            where event = 'installed'),
      'notifications',    (select count(*) from notifications where created_at >= v_from),
      'notifications_unread', (select count(*) from notifications where not read)
    ),

    -- ================================================== תוכן ומאגרים
    'content', jsonb_build_object(
      'articles',      (select count(*) from articles),
      'news_items',    (select count(*) from news_items where status = 'published'),
      'news_new',      (select count(*) from news_items where created_at >= v_from),
      'neighborhoods', (select count(*) from neighborhoods),
      'streets',       (select count(*) from street_registry),
      'market_deals',  (select count(*) from market_deals),
      'planning_info', (select count(*) from property_planning_info)
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.platform_inventory_report(integer) is
  'מצבת המערכת: כמה יש מכל דבר, ומה נוסף בחלון. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.platform_inventory_report(integer) from public, anon;
grant execute on function public.platform_inventory_report(integer) to authenticated;
