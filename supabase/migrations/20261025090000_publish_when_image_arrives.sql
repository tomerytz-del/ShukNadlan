-- ===========================================================================
-- נכס שקיבל תמונה מתפרסם — גם אם הוא כבר יצא מהתור
--
-- מיגרציה 20261020090000 קבעה שנכס בלי תמונה אינו נבחר לפרסום, והטריגר
-- ‏properties_publication_image_delay מחדש את חלון ההשהיה כשהתמונה הראשונה
-- מגיעה. שניהם נכונים — אבל שניהם עובדים רק על שורה שעדיין `pending`.
--
-- ‏11 הנכסים שנקלטו בייבוא של 9.9.2026 בלי תמונות אינם כאלה: הם סומנו
-- ‏`posted` באותו יום על סמך תשובת 200 מ-Make, בזמן שאף פוסט לא עלה.
-- ‏`posted` הוא סטטוס סופי, ו-`unique (property_id, channel)` חוסם שורה
-- שנייה — ולכן תמונה שתועלה להם מחר לא הייתה משנה דבר, בשקט.
--
-- הדרישה העסקית: **נכס מתפרסם ברגע שיש לו תמונה**, בלי קשר למה קרה לשורה
-- שלו קודם. שני שינויים:
--
--   1. הטריגר מחיה שורה סופית שאין לה פוסט אמיתי — ולא רק מחדש חלון.
--   2. תפוגת "שבוע בלי תמונה" יורדת. שורה בלי תמונה ממתינה עד שתגיע אחת.
--
-- אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. הטריגר — מחדש חלון, ומחיה שורה שלא הביאה פוסט
--
-- ## למה זה לא יכול לייצר פוסט כפול
--
-- שלושה תנאים מצטברים, וכל אחד מהם לבדו כמעט מספיק:
--
--   א. **הטריגר יורה רק כשהנכס היה בלי תמונה ועכשיו יש לו אחת.** נכס שכבר
--      היו לו תמונות לא נכנס לכאן לעולם — כלומר כל נכס שהגיע לפרסום מוצלח
--      עם תמונות מוגן מעצם הבנייה.
--   ב. **רק שורות עם `post_id is null`** מוחיות. מזהה פוסט הוא הראיה
--      שפוסט קיים; שורה שיש לה מזהה לא נוגעים בה.
--   ג. **`skipped` לא מוחיה.** זו החלטה מפורשת — קו הבסיס של ההתקנה
--      (‏§9 במיגרציה 20260906092000, "61 פוסטים ברצף הם הצפה של הדף") ונכס
--      שכבר אינו פעיל. נכס ותיק שיקבל תמונה חדשה לא יתפרץ לדף.
--
-- ומאז ש-`facebook_autopost_require_post_id` דלוק (11.9.2026), `posted` בלי
-- ‏`post_id` לא יכול להיווצר יותר: פרסום שלא אושר נשאר `pending` או נופל
-- ל-`failed`. כלומר הקבוצה שתנאי ב׳ מתיר היא סגורה — 15 שורות מהתקופה שלפני
-- המתג — ומכולן רק מי שאין לה תמונה עד היום יכולה בכלל להגיע לכאן.
-- ---------------------------------------------------------------------------
create or replace function public.properties_publication_image_delay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay int;
  v_after timestamptz;
begin
  if public.property_has_publishable_image(old.images, old.marketing_image)
     or not public.property_has_publishable_image(new.images, new.marketing_image) then
    return null;
  end if;

  v_delay := coalesce((select value::int from public.pricing_config
                        where key = 'facebook_autopost_delay_minutes'), 20);
  v_after := now() + make_interval(mins => greatest(v_delay, 0));

  -- שורה שממתינה ממילא: רק מחדשים את החלון, כדי שהפוסט לא ייצא באמצע
  -- העלאת הגלריה.
  update public.property_publications
     set publish_after = v_after
   where property_id = new.id
     and status = 'pending'
     and publish_after <= v_after;

  -- שורה שכבר יצאה מהתור בלי שהביאה פוסט — מוחזרת אליו נקייה.
  update public.property_publications
     set status        = 'pending',
         attempts      = 0,
         last_error    = null,
         post_url      = null,
         posted_at     = null,
         publish_after = v_after
   where property_id = new.id
     and status in ('posted', 'failed')
     and post_id is null;

  return null;
exception when others then
  -- כמו בטריגר הכניסה לתור: פרסום ברשתות לא ימנע מסוכן/ת לשמור נכס.
  raise warning 'properties_publication_image_delay נכשל לנכס %: %', new.id, sqlerrm;
  return null;
end;
$$;

comment on function public.properties_publication_image_delay() is
  'כשנכס מקבל את תמונתו הראשונה: מחדשת את חלון ההשהיה לשורה שממתינה, ומחזירה לתור שורה שיצאה ממנו בלי להביא פוסט (post_id ריק). skipped אינו מוחיה — זו החלטה מפורשת.';

revoke all on function public.properties_publication_image_delay() from public;
revoke all on function public.properties_publication_image_delay() from anon, authenticated;

drop trigger if exists properties_publication_image_delay on public.properties;
create trigger properties_publication_image_delay
  after update of images, marketing_image on public.properties
  for each row
  execute function public.properties_publication_image_delay();

-- ---------------------------------------------------------------------------
-- 2. תפוגת "שבוע בלי תמונה" יורדת
--
-- מיגרציה 20261020090000 סימנה `skipped` שורה שממתינה לתמונה מעל שבוע,
-- בנימוק שמודעה בת שבוע שיוצאת כ"חדשה בשוק" אינה הפוסט שרצינו.
--
-- הנימוק נכון, אבל הוא מתנגש עם הכלל שנקבע כאן — ומפסיד. הוא גם היה יוצר
-- מלכודת: שורה שסומנה `skipped` אינה מוחיה על ידי הטריגר שלמעלה (תנאי ג׳),
-- ולכן סוכן/ת שהעלה/תה תמונות ביום השמיני הייתה מגלה ששום דבר לא קורה
-- ושאין שום הודעה שמסבירה למה.
--
-- שורה בלי תמונה פשוט ממתינה עכשיו. היא אינה עולה דבר: שאילתת התור מסננת
-- אותה, ותנאי ה-cron לא יורה בגללה. וכשהתמונה תגיע, הפוסט ייצא 20 דקות
-- אחריה — כלומר טרי ביחס לרגע שבו המודעה באמת נעשתה ראויה לפרסום, ולא
-- ביחס לרגע שבו נוצרה שורה ריקה.
--
-- ניקוי הנכסים שאינם פעילים נשאר כמו שהיה.
-- ---------------------------------------------------------------------------
create or replace function public.expire_property_publications()
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.property_publications pub
       set status = 'skipped',
           last_error = coalesce(pub.last_error, 'הנכס כבר אינו פעיל')
      from public.properties p
     where p.id = pub.property_id
       and pub.status = 'pending'
       and p.status is distinct from 'active'
       and pub.created_at < now() - interval '2 days'
    returning 1
  )
  select count(*)::int from done;
$$;

comment on function public.expire_property_publications() is
  'מסמנת skipped שורות שממתינות על נכס שכבר אינו פעיל. שורה שממתינה לתמונה אינה פגה — היא תתפרסם ברגע שתגיע תמונה.';

revoke all on function public.expire_property_publications() from public;
revoke all on function public.expire_property_publications() from anon, authenticated;
grant execute on function public.expire_property_publications() to service_role;
