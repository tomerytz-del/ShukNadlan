-- ============================================================================
-- העברת תמונות הנכסים מהפרויקט הישן — תשתית לריצה חד-פעמית
--
-- הסרטונים כבר הועברו (‏migrate-legacy-videos), אבל התמונות נשארו: ‏156
-- קבצים בדלי ‎site-photos‎ של ‎nadlan-afula‎, ו-221 הפניות אליהם משלוש
-- עמודות בשלוש טבלאות — ‎properties.images‎, ‎property_image_tags.image_url‎
-- ו-‎property_visualizations.source_image_url‎. כל עוד הם שם, כיבוי הפרויקט
-- הישן מוחק את התמונות מ-47 מודעות פעילות באתר.
--
-- למה שתי פאזות ולא כתיבה תוך כדי העתקה, כמו שנעשה בסרטונים:
--
--   ‏properties_enqueue_base_visualization הוא ‎AFTER UPDATE OF status, images‎,
--   ולכן כל כתיבה ל-‎images‎ מפעילה אותו. בדיקה על 47 המודעות הראתה
--   ש-‎property_visualizations_enabled‎ מחזירה true לכולן — כלומר שכתוב
--   הכתובות היה מזמין 47 הדמיות AI חדשות, כל אחת בעלות אמיתית, על שינוי
--   שהוא טכני לגמרי ולא נגע ולו בפיקסל אחד.
--
--   לכן: פאזה 1 מעתיקה קבצים ורושמת מיפוי בלבד — הנתונים החיים לא זזים
--   ואפשר להריץ אותה בכמה מנות. פאזה 2 היא טרנזקציה אחת שמשכתבת את שלוש
--   העמודות מהמיפוי, עם הטריגר מושבת לאורכה. ‏DDL בפוסטגרס הוא
--   טרנזקציוני, ולכן כישלון באמצע מחזיר גם את ההשבתה — אין מצב שבו
--   הטריגר נשאר כבוי.
--
-- שאר הטריגרים על ‎properties‎ נבדקו אחד-אחד ואינם רלוונטיים לעדכון שנוגע
-- ב-‎images‎ בלבד: ‎client_match_alerts‎, ‎saved_search_alerts‎,
-- ‎queue_description‎ ו-‎queue_publication‎ חסומים בתנאי ‎WHEN‎ שדורש שינוי
-- בעמודה אחרת; שלושת טריגרי "נמכר/הושכר" דורשים מעבר סטטוס;
-- ו-‎track_marketing_copy‎ מחשב טביעת אצבע ש-‎property_marketing_fingerprint‎
-- אינה כוללת בה את ‎images‎ כלל.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. יומן ההעברה
--
-- גם מפת הכתובות שפאזה 2 עובדת ממנה, וגם מה שהופך את פאזה 1 לאידמפוטנטית:
-- קובץ שכבר הועתק פשוט לא חוזר לתור. הוא נשאר בטבלה גם אחרי שהסתיים הכל —
-- זו הראיה איזו כתובת ישנה הפכה לאיזו חדשה, והיא נחוצה כדי לבדוק את
-- ההעברה או להתחקות אחריה מאוחר יותר.
-- ---------------------------------------------------------------------------
create table if not exists public.legacy_photo_moves (
  legacy_url  text primary key,
  new_url     text        not null,
  bytes       bigint,
  property_id uuid,
  moved_at    timestamptz not null default now()
);

comment on table public.legacy_photo_moves is
  'יומן העברת תמונות הנכסים מהפרויקט הישן (nadlan-afula) לדלי property-images. '
  'שורה לכל קובץ: הכתובת הישנה, החדשה שהחליפה אותה, והנכס שאליו היא שייכת.';

-- אין מדיניות, ולכן אין גישה: ‏anon ו-authenticated לא קוראים ולא כותבים
-- כאן, ו-‎service_role‎ עוקף RLS ממילא. זו טבלת תחזוקה ולא תוכן.
alter table public.legacy_photo_moves enable row level security;

-- ---------------------------------------------------------------------------
-- 2. התור
--
-- כל כתובת ישנה שעדיין מופנית אליה מאחת משלוש העמודות ושטרם הועתקה, עם
-- הנכס והסוכן/ת שאליהם היא שייכת — כדי שהקובץ ינחת בנתיב שה-CRM כותב
-- אליו ממילא, ‎<agent_id>/<property_id>/‎. הנתיב אינו קישוט: ‎cleanupReplacedImages‎
-- ב-CRM מוחקת קבצים בהחלפה, וה-RLS של הדלי מרשה מחיקה רק בתיקייה של
-- הסוכן/ת. קובץ בנתיב אחר היה נשאר יתום בכל עריכה.
--
-- ‏DISTINCT ON כי אותו קובץ מופנה בממוצע מ-1.4 מקומות: הוא מועתק פעם אחת,
-- ופאזה 2 מחליפה את כל ההפניות אליו יחד.
-- ---------------------------------------------------------------------------
create or replace function public.legacy_photo_queue(p_limit int default 20)
returns table (legacy_url text, property_id uuid, agent_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with refs as (
    select x as url, p.id as pid, p.agent_id as aid
      from properties p, unnest(p.images) x
     where x like 'https://hgkxrnmzsyokkecyarwv.supabase.co/storage/v1/object/public/site-photos/%'
    union all
    select t.image_url, t.property_id, p.agent_id
      from property_image_tags t
      left join properties p on p.id = t.property_id
     where t.image_url like 'https://hgkxrnmzsyokkecyarwv.supabase.co/storage/v1/object/public/site-photos/%'
    union all
    select v.source_image_url, v.property_id, p.agent_id
      from property_visualizations v
      left join properties p on p.id = v.property_id
     where v.source_image_url like 'https://hgkxrnmzsyokkecyarwv.supabase.co/storage/v1/object/public/site-photos/%'
  )
  select distinct on (r.url) r.url, r.pid, r.aid
    from refs r
   where not exists (select 1 from legacy_photo_moves m where m.legacy_url = r.url)
   -- הפניה שיש לה סוכן/ת מנצחת, כדי שהנתיב ייצא מלא ולא ייפול לתיקיית הגיבוי
   order by r.url, r.aid nulls last, r.pid nulls last
   limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.legacy_photo_queue(int) is
  'התמונות מהפרויקט הישן שעדיין מופנות אליהן וטרם הועתקו. משמשת את '
  'migrate-legacy-photos. ריקה = ההעברה הושלמה.';

-- קריאה פנימית בלבד: הפונקציה חושפת מזהי סוכנים ונכסים ואין לה שום שימוש
-- בדפדפן.
revoke execute on function public.legacy_photo_queue(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. כמה נשאר
--
-- אותה שאילתה בדיוק, רק כמספר — כדי שאפשר יהיה לוודא בסוף שלא נשארה ולו
-- הפניה אחת בלי לשלוף את כולן.
-- ---------------------------------------------------------------------------
create or replace function public.legacy_photo_refs_left()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from properties p
      where exists (select 1 from unnest(p.images) x
                     where x like '%hgkxrnmzsyokkecyarwv%'))
  + (select count(*) from property_image_tags
      where image_url like '%hgkxrnmzsyokkecyarwv%')
  + (select count(*) from property_visualizations
      where source_image_url like '%hgkxrnmzsyokkecyarwv%');
$$;

comment on function public.legacy_photo_refs_left() is
  'כמה שורות עדיין מצביעות על ה-Storage של הפרויקט הישן. 0 = אין תלות.';

revoke execute on function public.legacy_photo_refs_left() from public, anon, authenticated;
