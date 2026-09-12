-- ============================================================================
-- חדר שינה כמטרת הדמיה — נכס פרטי להשכרה
--
-- נכס להשכרה מקבל הלבשת בית ולא הדמיית שיפוץ (ראו RenderMode ב-
-- supabase/functions/_shared/visualization.ts), ובמסלול הזה נוספת מטרה
-- רביעית: חדר שינה. שוכר/ת בוחר/ת דירה לפי הסלון, המטבח, החצר וחדר השינה —
-- וחדר שינה שכולו ריהוט הוא בדיוק מה שהדמיית ריהוט יודעת להראות.
--
-- **חדר אחד ולא יותר.** חדר שינה שני ושלישי הם אותה מיטה באותו סגנון בחדר
-- קטן יותר: עוד קריאת Gemini לכל סגנון בלי שום מידע חדש. הבחירה נעשית
-- בקוד (privateTargetsFor), וכאן רק נפתחת האפשרות בסכימה.
--
-- שני שינויים, שניהם הרחבה של רשימת ערכים מותרים — אף ערך קיים לא יוצא:
--
--   1. property_visualizations.target  += 'bedroom'
--   2. property_image_tags.room_type   += 'master_bedroom'
--
-- ‏master_bedroom מאפשר לבחור את **יחידת ההורים** ולא את חדר הילדים. תמונות
-- שכבר סווגו נשארות 'bedroom' ואינן מסווגות מחדש (הסיווג עולה כסף, ו-
-- classified_at כבר רשום), ולכן הקוד מתייחס אליו כהעדפה עם נפילה ל-'bedroom'
-- ולא כתנאי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. מטרת ההדמיה
-- ---------------------------------------------------------------------------
-- drop לפני add ולא בדיקת pg_constraint: הרעיון כאן הוא *להחליף* אילוץ קיים,
-- ואילוץ ישן ששרד היה ממשיך לדחות 'bedroom' גם אחרי שהחדש נוסף לצדו. שם
-- האילוץ הוא שם ברירת המחדל של Postgres, כפי שהוא בפרודקשן.
alter table public.property_visualizations
  drop constraint if exists property_visualizations_target_check;

alter table public.property_visualizations
  add constraint property_visualizations_target_check
  check (target in ('exterior', 'living_room', 'kitchen', 'bedroom', 'interior_main'));

-- ---------------------------------------------------------------------------
-- 2. סיווג התמונה
-- ---------------------------------------------------------------------------
alter table public.property_image_tags
  drop constraint if exists property_image_tags_room_type_check;

alter table public.property_image_tags
  add constraint property_image_tags_room_type_check
  check (room_type in ('facade', 'yard', 'living_room', 'kitchen',
                       'master_bedroom', 'bedroom', 'bathroom', 'balcony', 'other'));

comment on column public.property_image_tags.room_type is
  'facade/yard לתמונות חוץ · living_room/kitchen/master_bedroom/bedroom/bathroom/balcony לתמונות פנים · other כשלא מזוהה. master_bedroom = יחידת הורים, ההעדפה להדמיית חדר השינה בנכס להשכרה.';

-- ---------------------------------------------------------------------------
-- 3. הפרמטר העסקי
-- ---------------------------------------------------------------------------
-- אף קוד אינו קורא את הערך הזה — הוא תיעוד שיושב במסד — ודווקא לכן אסור לו
-- להישאר שקרי: בהשכרה יש ארבע מטרות ולא שלוש.
insert into public.pricing_config (key, value, description) values
  ('visualization_base_targets_max', 4,
   'מספר תמונות הבסיס המקסימלי לנכס פרטי — למכירה: חוץ, סלון, מטבח. להשכרה גם חדר שינה')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;
