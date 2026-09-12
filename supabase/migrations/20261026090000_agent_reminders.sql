-- ============================================================================
-- תזכורות לסוכנים — מייל וּוואטסאפ, עם שליטה של הסוכן/ת בכמות ובסוג
--
-- הפעמון ב-CRM מדווח על **אירועים**: ליד נכנס, ביקורת נכתבה, עסקה נסגרה.
-- אין בו שום דבר שמדווח על **היעדר** אירוע — וזה בדיוק מה שמחמיץ:
--
--   · שבעה נכסים פעילים בלי תמונה אחת. הם באוויר, הם לא נלחצים, ואף אחד
--     לא אמר לסוכן/ת שזו הסיבה.
--   · שבוע שלם בלי נכס חדש. שום אירוע לא קרה, ולכן שום התראה לא נשלחה.
--   · מודעה שתוקף ההתקשרות עליה נגמר בעוד עשרה ימים.
--
-- אירוע מצלצל בפעמון בזמן אמת; היעדר אירוע צריך מישהו שיסרוק ויזכיר. זה מה
-- שהקובץ הזה מוסיף, ובשני ערוצים שמגיעים לסוכן/ת גם כשהדשבורד סגור — מייל
-- ווואטסאפ.
--
-- ## שלוש החלטות שמסבירות את כל המבנה
--
-- **1. אין תור של "תזכורות ממתינות".** התזכורת אינה נרשמת בטבלה כשהיא נולדת
-- ואינה מסומנת כ"טופלה" כשהבעיה נפתרה — היא **מחושבת בכל קריאה** מתוך מצב
-- הנכסים (`agent_reminder_findings`). סוכן/ת שהעלה/תה תמונות בשש בבוקר לא
-- יקבל/תקבל בתשע תזכורת על מה שכבר תיקן/ה, ואין מה שיישאר תקוע כ"פתוח"
-- בגלל עדכון שנכנס במסלול אחר (ייבוא קובץ, הבוט בוואטסאפ, Edge Function).
-- אותה פונקציה מזינה גם את הרשימה בדשבורד וגם את ההודעה שיוצאת — מקור אמת
-- אחד, ולכן אין מצב שהמייל אומר שבעה והדשבורד מראה חמישה.
--
-- **2. הטבלה היחידה שנכתבת היא יומן המשלוח** (`agent_reminder_log`), והיא זו
-- שעונה על כל שאלות הקצב: מתי יצאה ההודעה האחרונה, כמה יצאו ב-30 הימים
-- האחרונים, ומתי הופיע סוג תזכורת מסוים בפעם האחרונה. שורה נכתבת **לפני**
-- השליחה ולא אחריה — נפילה אחרי שהמייל יצא ולפני שנרשם הייתה שולחת אותו
-- שוב בסבב הבא.
--
-- **3. הודעה אחת מקבצת את כל התזכורות** (digest) ולא הודעה לכל אחת. חמש
-- תזכורות = חמש הודעות = חסימה של המספר בוואטסאפ. ההודעה היא שורת התקציר,
-- והדשבורד הוא מסך הקריאה.
--
-- ## מה הסוכן/ת שולט/ת בו
--
-- | פקד | ברירת מחדל | מה הוא באמת עושה |
-- | --- | --- | --- |
-- | `channels` | `{email}` | מייל, וואטסאפ, שניהם או **אף אחד** |
-- | `cadence` | `weekly` | יומי / שבועי / כבוי |
-- | `max_per_30_days` | 6 | תקרה קשה, מעליה לא יוצא דבר |
-- | `muted_kinds` | `{}` | סוג תזכורת שלא רוצים לקבל |
-- | `quiet_from/to_hour` | 21→8 | שעות שקט, שעון ישראל |
--
-- ‏`muted_kinds` היא רשימת **מושתקים** ולא רשימת מאושרים, בדיוק כמו
-- ‏`agent_notification_preferences.muted_types`: היעדר שורה = קבלת הכול, וסוג
-- תזכורת חדש שייכנס בעתיד מגיע לכולם בלי מיגרציית backfill.
--
-- והגבול של ההשתקה, כמו במרכז ההתראות: היא מכבה את **ההודעה** ולא את
-- ההימצאות. ‏`agent_reminder_findings` ממשיכה להחזיר את הממצא, והוא ממשיך
-- להופיע בדשבורד — שם הוא לא מפריע לאיש.
--
-- ## תלויות קיימות
--
-- ‏`agency_members` (‏email, ‏phone_e164, ‏active, ‏closed_at), ‏`properties`,
-- ‏`property_views`, ‏`pricing_config`, ‏`current_agent_id()`, ‏pg_cron + pg_net
-- + vault (‏`alert_cron_secret`).
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המספרים העסקיים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד, כדי שאפשר יהיה
-- לכוון סף בלי פריסה מחדש. שינוי כאן משנה את מה שכל הסוכנים רואים, ולכן
-- לכל מפתח יש תיאור שמסביר במה הוא נוגע.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('agent_reminder_idle_days', 7,
   'כמה ימים בלי נכס חדש נחשבים לשתיקה שמצדיקה תזכורת'),
  ('agent_reminder_stale_days', 60,
   'נכס פעיל שלא נגעו בו כך וכך ימים מקבל תזכורת לרענון'),
  ('agent_reminder_expiry_days', 14,
   'כמה ימים לפני פקיעת תוקף המודעה מזכירים'),
  ('agent_reminder_default_cap', 6,
   'תקרת ברירת המחדל להודעות תזכורת ב-30 יום, לסוכן/ת שלא שינה/תה'),
  ('agent_reminder_video_min_props', 15,
   'מינימום נכסים בכל קבוצה (עם סרטון / בלי) לפני שמותר לפרסם יחס צפיות'),
  ('agent_reminder_video_min_views', 100,
   'מינימום צפיות בכל קבוצה לפני שמותר לפרסם יחס צפיות')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. ההעדפות
--
-- העמודות ולא jsonb: כל אחת מהן נבדקת ב-`agent_reminder_due_agents` בכל
-- סבב, ושלוש מהן נושאות אילוץ. ‏jsonb היה הופך את הבדיקה לקאסטים ואת
-- האילוצים לטריגר.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_reminder_preferences (
  agent_id        uuid primary key references public.agency_members(id) on delete cascade,

  -- מערך ריק הוא בחירה לגיטימית ומשמעותה "רק בדשבורד, בלי הודעות". זו הדרך
  -- לכבות הכול בלי לכבות את הממצאים עצמם.
  channels        text[]   not null default '{email}',
  muted_kinds     text[]   not null default '{}',
  cadence         text     not null default 'weekly',

  -- 30 יום מתגלגלים ולא "חודש קלנדרי", וזה מכוון: תקרה קלנדרית מתאפסת ב-1
  -- בחודש, ואז סוכן/ת שקיבל/ה את המקסימום ב-28 בחודש מקבל/ת עוד שש ביומיים.
  max_per_30_days smallint not null default 6,

  quiet_from_hour smallint not null default 21,
  quiet_to_hour   smallint not null default 8,
  updated_at      timestamptz not null default now(),

  constraint agent_reminder_prefs_cadence_chk
    check (cadence in ('daily','weekly','off')),
  -- ‏<@ ולא טריגר: ערוץ שאינו מוכר לא יגיע לשרת ההתראות בתור "שלח ל-sms"
  -- ויישאר שם בשקט לנצח.
  constraint agent_reminder_prefs_channels_chk
    check (channels <@ array['email','whatsapp']::text[]),
  constraint agent_reminder_prefs_cap_chk
    check (max_per_30_days between 0 and 60),
  constraint agent_reminder_prefs_quiet_chk
    check (quiet_from_hour between 0 and 23 and quiet_to_hour between 0 and 23)
);

comment on table public.agent_reminder_preferences is
  'שליטת הסוכן/ת בתזכורות: ערוצים, קצב, תקרה, סוגים מושתקים ושעות שקט. היעדר שורה = ברירות המחדל (מייל, שבועי, 6 ב-30 יום, הכול מופעל).';
comment on column public.agent_reminder_preferences.channels is
  'תת-קבוצה של {email,whatsapp}. מערך ריק = בלי הודעות בכלל; הממצאים עדיין מוצגים בדשבורד.';
comment on column public.agent_reminder_preferences.muted_kinds is
  'סוגי תזכורת שלא יישלחו. הם ממשיכים להופיע בדשבורד — ההשתקה היא על ההודעה.';
comment on column public.agent_reminder_preferences.max_per_30_days is
  'תקרה קשה על מספר ההודעות ב-30 יום מתגלגלים. 0 = כיבוי מלא של השליחה.';

alter table public.agent_reminder_preferences enable row level security;

-- הסוכן/ת מנהל/ת את השורה של עצמו/ה בלבד. אין policy למחיקה: כיבוי נעשה
-- דרך הערכים (‏cadence='off' או channels ריק), ומחיקת השורה שקולה לחזרה
-- לברירות המחדל — מה שאפשר לעשות ממילא בעדכון.
drop policy if exists "agent reads own reminder preferences" on public.agent_reminder_preferences;
create policy "agent reads own reminder preferences"
  on public.agent_reminder_preferences for select
  using (agent_id = public.current_agent_id());

drop policy if exists "agent creates own reminder preferences" on public.agent_reminder_preferences;
create policy "agent creates own reminder preferences"
  on public.agent_reminder_preferences for insert
  with check (agent_id = public.current_agent_id());

drop policy if exists "agent updates own reminder preferences" on public.agent_reminder_preferences;
create policy "agent updates own reminder preferences"
  on public.agent_reminder_preferences for update
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 3. יומן המשלוח
--
-- שורה אחת לכל **הודעה** (‏digest), לא לכל תזכורת. ‏kinds ו-items מתארים מה
-- היה בתוכה, ושני ה-status מתארים מה קרה בכל ערוץ בנפרד — סוכן/ת שביקש/ה
-- שניהם וקיבל/ה מייל אבל הוואטסאפ נכשל צריך/ה שהניסיון החוזר יהיה על
-- הוואטסאפ בלבד.
--
-- **‏created_at הוא שעון הקצב.** כל שלוש שאלות הקצב נענות ממנו: האם עבר
-- מספיק זמן מההודעה האחרונה, כמה הודעות יצאו ב-30 יום, ומתי סוג תזכורת
-- הופיע לאחרונה. ובכוונה ‏created_at ולא sent_at — ערוץ שנכשל שוב ושוב לא
-- אמור לייצר סבב חדש בכל שעה.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agency_members(id) on delete cascade,
  kinds           text[] not null,
  items           jsonb  not null,
  email_status    text not null default 'not_requested',
  whatsapp_status text not null default 'not_requested',
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,

  constraint agent_reminder_log_email_chk
    check (email_status    in ('not_requested','pending','sent','failed')),
  constraint agent_reminder_log_whatsapp_chk
    check (whatsapp_status in ('not_requested','pending','sent','failed'))
);

comment on table public.agent_reminder_log is
  'יומן הודעות התזכורת. שורה לכל הודעה מקובצת, ומקור האמת לקצב: מתי יצאה האחרונה, כמה יצאו ב-30 יום, ומתי כל סוג הופיע.';

-- שתי השאילתות החמות: "ההודעה האחרונה של הסוכן/ת הזה/הזו" ו-"האם הסוג הזה
-- יצא לאחרונה". הראשונה היא אינדקס רגיל, השנייה דורשת GIN על המערך.
create index if not exists agent_reminder_log_agent_idx
  on public.agent_reminder_log (agent_id, created_at desc);
create index if not exists agent_reminder_log_kinds_idx
  on public.agent_reminder_log using gin (kinds);

alter table public.agent_reminder_log enable row level security;

-- קריאה בלבד לסוכן/ת עצמו/ה, כתיבה רק דרך service_role בתוך ה-Edge Function
-- — אותה תבנית כמו notifications ו-whatsapp_messages.
drop policy if exists "agent reads own reminder log" on public.agent_reminder_log;
create policy "agent reads own reminder log"
  on public.agent_reminder_log for select
  using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 4. יחס הצפיות של נכס עם סרטון
--
-- "נכסים עם סרטון מקבלים פי X צפיות" הוא משפט שמותר לומר רק כשהנתונים
-- אומרים אותו. ולכן הפונקציה הזו מחזירה **null** בכל מצב שבו המדגם קטן
-- מדי, ומי שמרכיב/ה את ההודעה מנסח/ת אחרת. אין כאן מספר ברירת מחדל.
--
-- ארבעה תנאים לפני שמספר יוצא:
--   · מינימום נכסים בכל קבוצה (‏agent_reminder_video_min_props)
--   · מינימום צפיות בכל קבוצה (‏agent_reminder_video_min_views)
--   · לנכסים ניתנו לפחות 14 יום באוויר — נכס שפורסם אתמול מוריד כל ממוצע
--   · היחס עצמו גדול מ-1.2, כלומר יש באמת הפרש ולא רעש
--
-- ‏בפלטפורמה בגודלה היום שני התנאים הראשונים אינם מתקיימים, והפונקציה
-- מחזירה null. זה **לא** באג וזה לא מצב שצריך "לתקן" בהנחות: ברגע שיהיה
-- מדגם, המשפט יהפוך מאיכותני לכמותי מעצמו.
-- ---------------------------------------------------------------------------
create or replace function public.video_uplift_ratio()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_video_min_props'), 15) as min_props,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_video_min_views'), 100) as min_views
  ),
  pool as (
    select p.id,
           (coalesce(nullif(btrim(coalesce(p.video_url, '')), ''),
                     nullif(btrim(coalesce(p.tour_3d_url, '')), '')) is not null) as has_video
      from public.properties p
     where p.status = 'active'
       and p.created_at < now() - interval '14 days'
  ),
  -- ‏count(distinct pool.id) ולא count(*): ה-left join מכפיל את שורת הנכס
  -- לכל צפייה, ולכן count(*) היה מודד צפיות ומדווח עליהן כמספר נכסים —
  -- ובדיוק הקבוצה עם הסרטון (זו עם יותר צפיות) הייתה נראית גדולה יותר.
  grp as (
    select pool.has_video,
           count(distinct pool.id) as props,
           count(v.id)             as views
      from pool
      left join public.property_views v on v.property_id = pool.id
     group by pool.has_video
  ),
  sides as (
    select
      (select props from grp where has_video)           as vp,
      (select views from grp where has_video)           as vv,
      (select props from grp where not has_video)        as np,
      (select views from grp where not has_video)        as nv
  )
  select case
           when s.vp is null or s.np is null then null
           when s.vp < c.min_props or s.np < c.min_props then null
           when s.vv < c.min_views or s.nv < c.min_views then null
           when s.nv = 0 or s.np = 0 or s.vp = 0 then null
           when (s.vv::numeric / s.vp) / (s.nv::numeric / s.np) <= 1.2 then null
           else round((s.vv::numeric / s.vp) / (s.nv::numeric / s.np), 1)
         end
    from sides s cross join cfg c;
$$;

comment on function public.video_uplift_ratio() is
  'פי כמה צפיות מקבל נכס עם סרטון/סיור לעומת נכס בלעדיהם, או null כשהמדגם קטן מדי מלהצהיר על יחס. אין ברירת מחדל בכוונה.';

-- ה-grant מפורש למרות שהוא ברירת המחדל של Postgres, כי `agent_reminder_findings`
-- קוראת לכאן בהקשר של הסוכן/ת המחובר/ת (‏security invoker) — בלי ההרשאה הזו
-- הרשימה בדשבורד הייתה נופלת, ובשרת היא הייתה עובדת. הפונקציה מחזירה מספר
-- מצרפי על מודעות שממילא ציבוריות, ולכן אין כאן חשיפה.
grant execute on function public.video_uplift_ratio() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. הממצאים
--
-- **הלב של היכולת.** מחשבת, בקריאה אחת, את כל מה שיש להזכיר לסוכן/ת אחד/ת
-- כרגע. אותה פונקציה נקראת משני מקומות:
--
--   · מהדשבורד (‏crm.html) — כדי להציג את הרשימה החיה.
--   · מ-`agent_reminders_claim` — כדי להרכיב את ההודעה.
--
-- ולכן אין מצב שההודעה אומרת שבעה נכסים והדשבורד מראה חמישה.
--
-- **‏security invoker, ולא definer.** זו לא קפריזה אלא שכבת ההגנה: כשסוכן/ת
-- קורא/ת לפונקציה, ה-RLS של `properties` חל עליו/ה. בנוסף ל-RLS יש כאן גם
-- שער מפורש (‏`target`) שמצמצם קריאה של סוכן/ת מחובר/ת למזהה של עצמו/ה
-- בלבד; ‏`current_agent_id()` הוא null בקריאה פנימית עם service_role, ולכן
-- השרת עובר. ‏`agent_reminders_claim` היא definer, ולכן ה-RLS אינו חל שם
-- והיא רואה את כולם.
--
-- **‏action_acc** הוא מזהה הקטגוריה בדשבורד שבה מטפלים בממצא. הוא זה שהופך
-- את התזכורת לקישור שעושה משהו: המייל מפנה ל-‏`crm.html?goto=<action_acc>`,
-- והדשבורד מפעיל עליו ‏gotoSection. תזכורת בלי דרך לטפל בה היא רק נזיפה.
--
-- **‏sort_order ולא סדר אלפביתי.** הסדר הוא סדר הדחיפות, והוא נקבע כאן כדי
-- שההודעה במייל, ההודעה בוואטסאפ והרשימה בדשבורד יציגו את אותו סדר. סדר
-- שנקבע בכל קורא בנפרד היה מתפצל בפעם הראשונה שמישהו מוסיף סוג.
--
-- ## הוספת סוג תזכורת חדש
--
-- בלוק `select` נוסף ב-union כאן, שורה ב-`agent_reminder_kind_interval`,
-- ושורה ב-`REMINDER_KINDS` ב-crm.html (הכותרת וההסבר בפקדי הניהול).
-- ברירת המחדל של סוכן/ת קיים/ת היא לקבל אותו — ‏muted_kinds היא רשימת
-- מושתקים, ולכן אין צורך במיגרציית backfill.
--
-- שינוי **חתימה** (עמודה חדשה בטבלה שמוחזרת) דורש `drop function` לפני
-- ה-create, כי ‏`create or replace` אינו יכול לשנות את צורת ההחזרה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_findings(p_agent_id uuid)
returns table (
  kind          text,
  title         text,
  body          text,
  action_acc    text,
  subject_count int,
  sort_order    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    -- סוכן/ת מחובר/ת מקבל/ת את עצמו/ה בלבד; ‏service_role (שאין לו/ה
    -- ‏current_agent_id) מקבל/ת את מי שביקש/ה. מזהה שנחסם הופך ל-null,
    -- וכל הממצאים למטה יוצאים ריקים.
    select case
             when public.current_agent_id() is null then p_agent_id
             when public.current_agent_id() = p_agent_id then p_agent_id
           end as id
  ),
  cfg as (
    select
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_idle_days'), 7)    as idle_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_stale_days'), 60)   as stale_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_expiry_days'), 14)  as expiry_days
  ),
  -- ספירה אחת על הנכסים הפעילים, ולא ארבע שאילתות נפרדות. אגרגט בלי
  -- ‏group by מחזיר תמיד שורה אחת, גם כשאין אף נכס — ולכן `agg` בטוחה
  -- לשימוש ישיר גם עבור סוכן/ת בלי נכסים בכלל.
  agg as (
    select
      count(*) filter (
        where coalesce(array_length(p.images, 1), 0) = 0
          and nullif(btrim(coalesce(p.marketing_image, '')), '') is null
      )::int as no_images,
      count(*) filter (
        where nullif(btrim(coalesce(p.video_url, '')), '') is null
          and nullif(btrim(coalesce(p.tour_3d_url, '')), '') is null
      )::int as no_video,
      count(*) filter (
        where greatest(coalesce(p.bumped_at, p.created_at),
                       coalesce(p.updated_at, p.created_at))
              < now() - make_interval(days => (select stale_days from cfg))
      )::int as stale,
      count(*) filter (
        where p.listing_expires_at is not null
          and p.listing_expires_at >= current_date
          and p.listing_expires_at <= current_date + (select expiry_days from cfg)
      )::int as expiring
      from public.properties p
     where p.agent_id = (select id from target)
       and p.status = 'active'
  ),
  -- מתי נכנס נכס בפעם האחרונה — בכל סטטוס, כי גם נכס שנכנס ונמכר מיד הוא
  -- עבודה שנעשתה, ולא היה נכון להזכיר "שבוע לא הכנסת נכסים" למי שהכניס/ה
  -- ומכר/ה באותו שבוע.
  activity as (
    select
      (select max(p.created_at) from public.properties p
        where p.agent_id = (select id from target))                      as last_property_at,
      (select m.created_at from public.agency_members m
        where m.id = (select id from target))                            as member_since
  ),
  ratio as (select public.video_uplift_ratio() as x)

  -- 5א. נכסים בלי תמונה. הראשון ברשימה כי הוא הכי יקר: מודעה בלי תמונה
  --     כמעט לא נפתחת, ולכן היא גם לא מייצרת ליד וגם תופסת מקום במדף.
  select 'missing_images'::text,
         'נכסים באוויר בלי תמונה'::text,
         case when g.no_images = 1
              then 'נכס פעיל אחד שלך עדיין בלי תמונה.'
              else g.no_images || ' נכסים פעילים שלך עדיין בלי תמונה.'
         end
         || ' מודעה בלי תמונה כמעט לא נפתחת — העלאת תמונה אחת מחזירה אותה למשחק.',
         'accProperties'::text,
         g.no_images,
         1
    from agg g
   where g.no_images > 0

  union all

  -- 5ב. תוקף ההתקשרות. שנייה בדחיפות, וזו התזכורת היחידה שיש לה תאריך קשה
  --     מבחוץ — ולכן גם היחידה שאי אפשר "לפצות עליה אחר כך".
  select 'expiring_listings'::text,
         'תוקף מודעה שעומד להיגמר'::text,
         case when g.expiring = 1
              then 'תוקף ההתקשרות על מודעה אחת שלך נגמר בתוך ' || c.expiry_days || ' ימים.'
              else 'תוקף ההתקשרות על ' || g.expiring || ' מהמודעות שלך נגמר בתוך ' || c.expiry_days || ' ימים.'
         end
         || ' מודעה שפג תוקפה יורדת מהמדפים — כדאי לחדש את ההתקשרות או לעדכן את התאריך.',
         'accProperties'::text,
         g.expiring,
         2
    from agg g cross join cfg c
   where g.expiring > 0

  union all

  -- 5ג. מודעות שלא נגעו בהן. ‏greatest על bumped_at ועל updated_at: גם
  --     הקפצה וגם עדכון תוכן הם נגיעה, ואין טעם להזכיר על נכס שהוקפץ אתמול.
  select 'stale_listings'::text,
         'מודעות שלא עודכנו מזמן'::text,
         case when g.stale = 1
              then 'מודעה אחת שלך לא עודכנה ולא הוקפצה מעל ' || c.stale_days || ' יום.'
              else g.stale || ' מהמודעות שלך לא עודכנו ולא הוקפצו מעל ' || c.stale_days || ' יום.'
         end
         || ' עדכון מחיר, תמונה חדשה או הקפצה מחזירים אותן לראש המדף.',
         'accProperties'::text,
         g.stale,
         3
    from agg g cross join cfg c
   where g.stale > 0

  union all

  -- 5ד. שתיקה. התזכורת היחידה שאינה על נכס מסוים אלא על היעדר פעילות, ולכן
  --     היא נמדדת מול **כל** נכס שנכנס אי פעם ולא רק מול הפעילים.
  --
  --     שני התנאים ולא אחד: גם הנכס האחרון וגם מועד ההצטרפות חייבים להיות
  --     מעבר לסף. בלי השני, חשבון שנפתח היום וקיבל נכסים בייבוא עם תאריך
  --     היסטורי היה מקבל תזכורת על שתיקה ביום הראשון שלו.
  select 'idle_listings'::text,
         'כבר זמן מה לא נכנס נכס חדש'::text,
         case
           when a.last_property_at is null
             then 'עדיין לא הכנסת נכס למערכת. הנכס הראשון הוא מה שמכניס אותך למדפים ולחיפוש באתר.'
           else 'הנכס האחרון שהכנסת נרשם לפני '
                || (extract(day from (now() - a.last_property_at)))::int || ' ימים. '
                || 'מדף הבית והחיפוש מציגים קודם את מה שטרי — מודעה חדשה מחזירה אותך לראש התור.'
         end,
         'accProperties'::text,
         null::int,
         4
    from activity a cross join cfg c
   where a.member_since is not null
     and a.member_since < now() - make_interval(days => c.idle_days)
     and coalesce(a.last_property_at, a.member_since) < now() - make_interval(days => c.idle_days)

  union all

  -- 5ה. סרטון וסיור. **תזכורת-תובנה ולא תזכורת-משימה**, ולכן היא אחרונה
  --     בסדר וחוזרת פעם בחודש בלבד (‏agent_reminder_kind_interval).
  --
  --     הנוסח נחתך לפי `video_uplift_ratio()`: יש מדגם — יוצא מספר; אין
  --     מדגם — יוצא משפט איכותני. אין כאן מספר ברירת מחדל שנשמע טוב.
  select 'video_opportunity'::text,
         'נכסים בלי סרטון או סיור'::text,
         'ל-' || g.no_video || ' מהנכסים הפעילים שלך אין סרטון ואין סיור וירטואלי. '
         || case
              when r.x is not null
                then 'בפלטפורמה, נכס עם סרטון או סיור מקבל פי ' || trim(to_char(r.x, 'FM999990.0'))
                     || ' צפיות מנכס בלעדיהם.'
              else 'סרטון מחזיק את הגולש/ת בדף זמן רב יותר, ומודעה עם סרטון מסומנת כך גם במדף וגם בשיתוף.'
            end,
         'accProperties'::text,
         g.no_video,
         5
    from agg g cross join ratio r
   where g.no_video > 0;
$$;

comment on function public.agent_reminder_findings(uuid) is
  'כל מה שיש להזכיר לסוכן/ת כרגע, מחושב מהמצב ולא מתור. אותה פונקציה מזינה את הרשימה בדשבורד ואת ההודעה שיוצאת. security invoker + שער מפורש — סוכן/ת מחובר/ת רואה/ת את עצמו/ה בלבד.';

grant execute on function public.agent_reminder_findings(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. כל סוג והקצב שלו
--
-- הפרדה שחוזרת על עצמה בכל המבנה: **הממצא** נכון כל הזמן, אבל **ההזכרה**
-- עליו חוזרת בקצב שמתאים לו. נכס בלי תמונה הוא משימה, ומותר להזכיר עליה
-- שבועית; "נכסים עם סרטון מקבלים יותר צפיות" הוא תובנה, ושבועית היא נדנוד.
--
-- ‏immutable ולא stable: זו טבלת החלטות ולא שאילתה, והיא נכנסת לתוך
-- ‏`not exists` בלולאה של claim.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_kind_interval(p_kind text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_kind
           when 'missing_images'    then interval '7 days'
           when 'idle_listings'     then interval '7 days'
           when 'stale_listings'    then interval '14 days'
           when 'expiring_listings' then interval '7 days'
           when 'video_opportunity' then interval '30 days'
           -- סוג שטרם נרשם כאן מקבל את הקצב השמרני. עדיף שתזכורת חדשה תצא
           -- פעם בשבועיים מדי מאשר בכל סבב עד שמישהו יבחין.
           else interval '14 days'
         end;
$$;

comment on function public.agent_reminder_kind_interval(text) is
  'המרווח המינימלי בין שתי הופעות של אותו סוג תזכורת אצל אותו/ה סוכן/ת. משימה — שבוע; תובנה — חודש.';

-- ---------------------------------------------------------------------------
-- 7. שעות השקט
--
-- ‏Asia/Jerusalem במפורש: השרת ב-UTC, ו-"21:00" של סוכן/ת הוא שעון ישראל.
-- חלון שחוצה חצות (21→8) הוא `or` ולא `and`, ושעת התחלה השווה לשעת הסיום
-- משמעה "בלי שעות שקט".
--
-- מקבלת את השעות כפרמטרים ולא קוראת את שורת ההעדפות בעצמה, כדי שתהיה
-- פונקציה טהורה שאפשר לבדוק, וכדי שהקורא (‏due_agents) יקרא את ההעדפות
-- פעם אחת.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_quiet_now(p_from int, p_to int)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
           when p_from is null or p_to is null then false
           when p_from = p_to then false
           when p_from < p_to then h.h >= p_from and h.h < p_to
           else h.h >= p_from or h.h < p_to
         end
    from (select extract(hour from (now() at time zone 'Asia/Jerusalem'))::int as h) h;
$$;

comment on function public.agent_reminder_quiet_now(int, int) is
  'האם אנחנו בתוך שעות השקט של הסוכן/ת (שעון ישראל). חלון שחוצה חצות נתמך.';

-- ---------------------------------------------------------------------------
-- 8. מי בשל/ה להודעה עכשיו
--
-- **כל תנאי הקצב במקום אחד**, כי שני קוראים שונים צריכים בדיוק את אותו
-- תנאי: ה-cron שואל "האם יש בכלל למי לשלוח" לפני שהוא מעיר Edge Function,
-- ו-claim עובר/ת על התוצאה. תנאי משוכפל היה מתפצל, והתוצאה הייתה cron
-- שיורה לריק או — גרוע יותר — cron ששותק כשיש עבודה.
--
-- מה **לא** נבדק כאן: האם יש בכלל ממצא. זו החלק היקר (‏findings לכל סוכן/ת),
-- והוא נשאר ב-claim. הפרדה כזו היא כל הרעיון של ה-cron המותנה
-- (‏20261021090000): השאלה הזולה במסד, השאלה היקרה בשרת.
--
-- ‏closed_at ו-active שניהם: חשבון בתהליך סגירה עדיין active עד המועד
-- שנקבע, ותזכורת "כדאי להעלות תמונות" למי שביקש/ה לסגור היא בדיוק ההודעה
-- שאין לשלוח.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_due_agents()
returns table (
  agent_id        uuid,
  display_name    text,
  email           text,
  phone_e164      text,
  channels        text[],
  muted_kinds     text[],
  cadence         text,
  last_sent_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with dflt as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'agent_reminder_default_cap'), 6) as cap
  ),
  agents as (
    select
      m.id, m.display_name,
      nullif(btrim(coalesce(m.email, '')), '')      as email,
      nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
      coalesce(p.channels,        array['email']::text[]) as channels,
      coalesce(p.muted_kinds,     '{}'::text[])           as muted_kinds,
      coalesce(p.cadence,         'weekly')               as cadence,
      coalesce(p.max_per_30_days, d.cap)                  as cap,
      coalesce(p.quiet_from_hour, 21)                     as quiet_from,
      coalesce(p.quiet_to_hour,   8)                      as quiet_to
      from public.agency_members m
      cross join dflt d
      left join public.agent_reminder_preferences p on p.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
  ),
  recent as (
    select l.agent_id,
           max(l.created_at)                                             as last_at,
           count(*) filter (where l.created_at > now() - interval '30 days') as n30
      from public.agent_reminder_log l
     group by l.agent_id
  )
  select a.id, a.display_name, a.email, a.phone_e164,
         a.channels, a.muted_kinds, a.cadence, r.last_at
    from agents a
    left join recent r on r.agent_id = a.id
   where a.cadence <> 'off'
     and a.cap > 0
     and coalesce(array_length(a.channels, 1), 0) > 0
     -- ערוץ בלי כתובת אינו ערוץ. בלי הבדיקה הזו היינו מעירים את השרת בכל
     -- שעה בשביל סוכן/ת שביקש/ה וואטסאפ ולא הזין/ה מספר.
     and (('email'    = any(a.channels) and a.email      is not null)
       or ('whatsapp' = any(a.channels) and a.phone_e164 is not null))
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
     and coalesce(r.n30, 0) < a.cap
     -- ‏20 שעות ל"יומי" ולא 24: דייג'סט שיצא ב-9:05 לא אמור לחסום את זה של
     -- מחר ב-9:00 ולהזליג את השעה יום אחר יום. אותו היגיון ל"שבועי".
     and (r.last_at is null
          or r.last_at < now() - case a.cadence
                                   when 'daily' then interval '20 hours'
                                   else              interval '6 days'
                                 end);
$$;

comment on function public.agent_reminder_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן הודעת תזכורת עכשיו — ערוצים, קצב, תקרת 30 יום ושעות שקט. אינה בודקת אם יש ממצא; זה החלק היקר ונשאר ב-claim.';

revoke all on function public.agent_reminder_due_agents() from public;
revoke all on function public.agent_reminder_due_agents() from anon, authenticated;
grant execute on function public.agent_reminder_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 9. השאלה הזולה של ה-cron
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminders_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.agent_reminder_due_agents());
$$;

comment on function public.agent_reminders_ready() is
  'האם יש בכלל סוכן/ת שבשל/ה להודעה. נקראת מה-cron לפני net.http_post, כדי לא להעיר Edge Function כדי לשמוע "אין כלום".';

revoke all on function public.agent_reminders_ready() from public;
revoke all on function public.agent_reminders_ready() from anon, authenticated;
grant execute on function public.agent_reminders_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 10. התפיסה
--
-- **רושמת את שורת היומן לפני שהשרת שולח**, ומחזירה אותה. הסדר הזה הוא מה
-- שמונע הודעה כפולה: שרת שנפל אחרי שהמייל יצא ולפני שהצליח לדווח משאיר
-- שורה עם ‏email_status='pending' — כלומר "יצא, לא ידוע אם הגיע" — ולא
-- סוכן/ת שבשל/ה לסבב נוסף בעוד דקה.
--
-- ‏plpgsql ולא sql, כי ‏findings נקראת לכל סוכן/ת בנפרד ורק מי שיש לו/ה
-- ממצא נרשם/ת. ‏security definer, ולכן ה-RLS אינו חל וה-findings שנקראת
-- מכאן רואה את הנכסים של כולם.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminders_claim(p_limit int default 20)
returns table (
  log_id       uuid,
  agent_id     uuid,
  display_name text,
  email        text,
  phone_e164   text,
  channels     text[],
  items        jsonb,
  item_count   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_items  jsonb;
  v_kinds  text[];
  v_log    uuid;
  v_taken  int := 0;
  v_cap    int := least(greatest(coalesce(p_limit, 20), 1), 200);
begin
  for a in select * from public.agent_reminder_due_agents() loop
    exit when v_taken >= v_cap;

    -- הממצאים של הסוכן/ת, בשני סינונים:
    --   · סוג שהוא/היא השתיק/ה — לא נשלח (אבל כן מוצג בדשבורד)
    --   · סוג שיצא לאחרונה בתוך המרווח שלו — לא חוזר
    -- ‏order by f.sort_order ולא לפי שם הסוג: הסדר הוא סדר הדחיפות שנקבע
    -- ב-findings, וההודעה חייבת להציג אותו סדר שהדשבורד מציג.
    select jsonb_agg(jsonb_build_object(
             'kind',   f.kind,
             'title',  f.title,
             'body',   f.body,
             'action', f.action_acc,
             'count',  f.subject_count
           ) order by f.sort_order),
           array_agg(f.kind order by f.sort_order)
      into v_items, v_kinds
      from public.agent_reminder_findings(a.agent_id) f
     where not (f.kind = any(a.muted_kinds))
       and not exists (
             select 1
               from public.agent_reminder_log l
              where l.agent_id = a.agent_id
                and f.kind = any(l.kinds)
                and l.created_at > now() - public.agent_reminder_kind_interval(f.kind)
           );

    continue when v_items is null;

    insert into public.agent_reminder_log
      (agent_id, kinds, items, email_status, whatsapp_status)
    values (
      a.agent_id, v_kinds, v_items,
      case when 'email'    = any(a.channels) and a.email      is not null then 'pending' else 'not_requested' end,
      case when 'whatsapp' = any(a.channels) and a.phone_e164 is not null then 'pending' else 'not_requested' end
    )
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.email, a.phone_e164,
                        a.channels, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.agent_reminders_claim(int) is
  'רושמת שורת יומן לכל סוכן/ת שבשל/ה ויש לו/ה ממצא, ומחזירה אותה לשליחה. הרישום קודם לשליחה — כך נפילה באמצע לא מייצרת הודעה כפולה.';

revoke all on function public.agent_reminders_claim(int) from public;
revoke all on function public.agent_reminders_claim(int) from anon, authenticated;
grant execute on function public.agent_reminders_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 11. הסימון
--
-- ‏sent_at נקבע כאן ולא בשרת, ורק כשערוץ אחד לפחות הצליח. "נשלחה" היא
-- החלטה של המוצר (די בערוץ אחד) ולא של הקוד ששלח.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminders_mark(
  p_log_id          uuid,
  p_email_status    text,
  p_whatsapp_status text,
  p_error           text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email_status not in ('not_requested','pending','sent','failed')
     or p_whatsapp_status not in ('not_requested','pending','sent','failed') then
    raise exception 'agent_reminders_mark: סטטוס ערוץ לא מוכר';
  end if;

  update public.agent_reminder_log
     set email_status    = p_email_status,
         whatsapp_status = p_whatsapp_status,
         last_error      = left(nullif(btrim(coalesce(p_error, '')), ''), 500),
         sent_at         = case
                             when p_email_status = 'sent' or p_whatsapp_status = 'sent'
                               then coalesce(sent_at, now())
                             else sent_at
                           end
   where id = p_log_id;
end;
$$;

comment on function public.agent_reminders_mark(uuid, text, text, text) is
  'מעדכנת את תוצאת שני הערוצים על שורת יומן. sent_at נקבע רק כשערוץ אחד לפחות הצליח.';

revoke all on function public.agent_reminders_mark(uuid, text, text, text) from public;
revoke all on function public.agent_reminders_mark(uuid, text, text, text) from anon, authenticated;
grant execute on function public.agent_reminders_mark(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 12. התזמון
--
-- פעם בשעה ב-:15, ורק כשיש למי לשלוח — אותה תבנית של cron מותנה מ-
-- ‏20261021090000. ‏`agent_reminders_ready()` הוא בדיוק התנאי ש-claim
-- מיישמת, ולא קירוב שלו, ולכן אין כאן מסלול שבו ה-cron שותק כשיש עבודה.
--
-- למה שעתי ולא יומי בשעה קבועה: שעות השקט הן **פר סוכן/ת**. מי שהגדיר/ה
-- שקט עד 10:00 צריך/ה סבב שיגיע ב-10, ומי שעד 8:00 — ב-8. סבב יומי אחד
-- בשעה קבועה היה מכריח את כולם לאותו חלון.
--
-- אידמפוטנטי: unschedule לפני schedule.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/agent-reminders';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן — התזכורות לא תוזמנו';
    return;
  end if;

  perform cron.unschedule('agent-reminders')
    where exists (select 1 from cron.job where jobname = 'agent-reminders');

  perform cron.schedule('agent-reminders', '15 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1)))
    )
    where public.agent_reminders_ready();
  $cron$, v_url));
end;
$$;
