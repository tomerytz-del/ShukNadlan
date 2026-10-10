-- ---------------------------------------------------------------------------
-- תזכורות וטיפים: בלי מקף ארוך בטקסט שהסוכן/ת רואה/ה
--
-- שלושה גופי ממצא ב-`agent_reminder_findings` נכתבו עם מקף ארוך ("כמעט לא
-- נפתחת — העלאת תמונה..."), והם מוצגים ב"תזכורות וטיפים" בדשבורד ויוצאים
-- במייל. ‏`check_long_dash.py` אינו רואה אותם, כי הטקסט נבנה במסד ולא בקובץ
-- שהאתר מגיש, וגם הניקוי למפרע (‏20261202090000) ניקה שורות ולא גופי
-- פונקציות. בוואטסאפ ‏formatForWhatsapp() כבר ניקה אותם.
--
-- הפונקציה מועתקת כלשונה מהגרסה האחרונה (‏20261027090000), והשינוי היחיד
-- הוא שלושת המקפים. ‏create or replace שומר על ההרשאות (‏grant ל-
-- authenticated ו-service_role מ-20261026090000), ולכן אין כאן שורת grant.
--
-- אידמפוטנטית.
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
          and not p.has_virtual_tour
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
         || ' מודעה בלי תמונה כמעט לא נפתחת - העלאת תמונה אחת מחזירה אותה למשחק.',
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
         || ' מודעה שפג תוקפה יורדת מהמדפים - כדאי לחדש את ההתקשרות או לעדכן את התאריך.',
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
                || 'מדף הבית והחיפוש מציגים קודם את מה שטרי - מודעה חדשה מחזירה אותך לראש התור.'
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
  'כל מה שיש להזכיר לסוכן/ת כרגע, מחושב מהמצב ולא מתור. אותה פונקציה מזינה את הרשימה בדשבורד ואת ההודעה שיוצאת. security invoker + שער מפורש - סוכן/ת מחובר/ת רואה/ת את עצמו/ה בלבד. טקסט הממצאים בלי מקף ארוך (20270413090000).';
