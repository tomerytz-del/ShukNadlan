-- ============================================================================
-- הפקת סיור 360° היא יכולת של Elite, ומחיר הפקת הסרטון עולה ל-₪25
--
-- הסיור העצמאי (‏20261027090000_property_virtual_tours) נפתח לכל סוכן/ת, כי
-- אין בו עלות לספק חיצוני. ההחלטה העסקית שונה: **ההפקה** נכנסת לסל של
-- ‏**Elite** (‏tier = 'premium' במסד; השם המסחרי הוא Elite, ראו
-- ‏assets/tiers.js), יחד עם ההדמיות ולידי בעל-הנכס.
--
-- ## הגבול הוא על ההפקה, לא על התצוגה
--
-- **סיור שהופק נשאר בדף הנכס לתמיד**, גם אם הסוכן/ת ירד/ה אחר כך ל-Pay&GO.
-- זו החלטה מודעת, והיא שונה מההדמיות (‏property_visualizations_enabled בודקת
-- מסלול בזמן *הקריאה*, ולכן הדמיה נעלמת מהדף בירידת מסלול):
--
--   · הסיור הוא **תוכן שהסוכן/ת יצר/ה ושילם/ה עליו במסלול** — הוא צילם/ה את
--     הפנורמות והשקיע/ה בסימון המעברים. מודעה חיה שמאבדת תוכן שכבר פורסם
--     פוגעת קודם כל בלקוח/ה של הנכס, שאינו/ה צד למנוי.
--   · ההדמיה נוצרת מחדש בלחיצה אחת וממילא לא באמת נעלמת (‏result_url נשאר);
--     פנורמה שצולמה בבית לקוח/ה לא מצולמת מחדש.
--
-- ומכאן נובע שגם ‎has_virtual_tour‎ **אינו** תלוי מסלול: הוא נשאר "יש שורה
-- עם לפחות חלל אחד", בדיוק כפי שהוגדר במיגרציה הקודמת, ולכן התגית באריח
-- והפילטר "סיור 3D" ממשיכים לומר את האמת. אין כאן טריגר על ‎agency_members‎
-- ואין כיבוי של דגלים קיימים.
--
-- ## הגייטינג הוא במסד ולא במסך
--
-- לסיור אין Edge Function: העורך ב-CRM כותב ישירות לטבלה ולדלי דרך
-- ‎supabase-js‎ בסשן של הסוכן/ת. לכן "רק Elite" חייב להיות **policy**, ולא
-- תנאי ב-JavaScript — אחרת כל מי שיפתח קונסולה בדפדפן יעקוף אותו. הכפתור
-- ב-CRM מוסתר לשאר המסלולים כדי לא להציע מה שאין, אבל הגבול עצמו כאן.
--
-- שני מקומות, ושניהם על כתיבה:
--   1. ‏insert/update על ‎property_virtual_tours‎ — יצירה ועריכה של הסיור.
--   2. ‏insert/update על ‎storage.objects‎ בדלי ‎property-tours‎ — ההעלאה עצמה,
--      שקורית *לפני* הכתיבה לטבלה. בלעדיה מי שאינו/ה Elite היה/תה יכול/ה
--      למלא את הדלי בפנורמות ולהיחסם רק בשמירה.
--
-- ‏**‎select‎ אינו נוגע במסלול** (ראו לעיל), ו-**‎delete‎ נשאר פתוח לבעל/ת
-- הנכס בלי תנאי מסלול**: מי שירד/ה מ-Elite צריך/ה להיות מסוגל/ת למחוק את
-- הסיור שלו/ה ואת הקבצים שלו/ה — נעילה שמונעת גם מחיקה היא לכידת נתונים,
-- לא גייטינג.
--
-- כלומר מה שקורה בירידה מ-Elite: הסיור הקיים ממשיך לעבוד בדף, הכפתור
-- ב-CRM נעלם, ועריכה או הוספת חלל נדחות ב-policy. שדרוג חוזר מחזיר את
-- העורך בדיוק למקום שבו נעצר.
--
-- ## והמחיר של הסרטון
--
-- ‏‎property_video_price_mid‎ עולה מ-20 ל-25 ₪. הערך יושב ב-pricing_config
-- ומשמש גם את ה-Edge Function וגם את דיאלוג הרכישה, ולכן זו שורת ‎update‎
-- אחת — והמקומות שמציגים אותו (‏pricing.html, ‏assets/tiers.js) מעודכנים
-- באותו PR.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הזכאות
--
-- מקור אמת אחד ל"מי רשאי/ת להפיק", בדיוק כמו ‎property_video_tier‎ ו-
-- ‎property_visualizations_enabled‎: ה-policies וה-CRM נשענים עליו.
--
-- ‏security definer כי היא נקראת מתוך policies ומסתכלת על
-- ‎agency_members‎, שיש עליה RLS משלה. ‏stable — התוצאה אינה משתנה בתוך
-- אותה שאילתה, וזה מה שמאפשר לתכנן שאילתה עם התנאי הזה.
--
-- שלושה תנאים ולא אחד: המסלול, חשבון פעיל (‏active), וחיוב פעיל
-- (‏billing_status). סוכן/ת שהמנוי שלו/ה הושעה אינו/ה Elite בפועל.
-- ---------------------------------------------------------------------------
create or replace function public.property_virtual_tour_eligible(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members m
     where m.id = p_agent_id
       and m.tier = 'premium'
       and m.active = true
       and m.billing_status = 'active'
  );
$$;

comment on function public.property_virtual_tour_eligible(uuid) is
  'האם הסוכן/ת זכאי/ת להפיק סיור 360° — מסלול Elite (premium) פעיל בלבד. נבדק בכתיבה לטבלה ולדלי; התצוגה אינה תלויה במסלול.';

grant execute on function public.property_virtual_tour_eligible(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. ‏policies: יצירה ועריכה ל-Elite בלבד
--
-- ‎select‎ ו-‎delete‎ נשארות בדיוק כפי שנוצרו ב-20261027090000 ואינן נוגעות
-- במסלול: קריאה לפי סטטוס הנכס ובעלות, ומחיקה לבעל/ת הנכס. מה שמשתנה כאן
-- הוא רק היכולת ליצור ולערוך.
-- ---------------------------------------------------------------------------
drop policy if exists "agent writes own property tour" on public.property_virtual_tours;
create policy "agent writes own property tour"
  on public.property_virtual_tours for insert to authenticated
  with check (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()
       and public.property_virtual_tour_eligible(p.agent_id)));

drop policy if exists "agent updates own property tour" on public.property_virtual_tours;
create policy "agent updates own property tour"
  on public.property_virtual_tours for update to authenticated
  using (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()
       and public.property_virtual_tour_eligible(p.agent_id)))
  with check (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and p.agent_id = public.current_agent_id()
       and public.property_virtual_tour_eligible(p.agent_id)));

-- ‏delete נשאר כפי שהיה: בעל/ת הנכס, בלי תנאי מסלול (ראו הכותרת).

-- ---------------------------------------------------------------------------
-- 3. ההעלאה לדלי
--
-- ההעלאה קורית לפני הכתיבה לטבלה, ולכן תנאי המסלול נדרש גם כאן. הדלי אינו
-- יודע לאיזה נכס הקובץ שייך (הנתיב הוא ‎<agent_id>/<property_id>/…‎ ואין
-- עליו ‎join‎), ולכן הזכאות נבדקת על הסוכן/ת המחובר/ת — מי שאינו/ה Elite
-- אינו/ה מעלה לדלי הזה בכלל.
--
-- ‏delete ו-select נשארים כפי שהיו, ולכן פנורמה שהועלתה נשארת קריאה לכולם.
-- ---------------------------------------------------------------------------
drop policy if exists "agent uploads own property tours" on storage.objects;
create policy "agent uploads own property tours"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
    and public.property_virtual_tour_eligible(public.current_agent_id())
  );

drop policy if exists "agent updates own property tours" on storage.objects;
create policy "agent updates own property tours"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
    and public.property_virtual_tour_eligible(public.current_agent_id())
  )
  with check (
    bucket_id = 'property-tours'
    and (storage.foldername(name))[1] = (public.current_agent_id())::text
    and public.property_virtual_tour_eligible(public.current_agent_id())
  );

-- ---------------------------------------------------------------------------
-- 4. מחיר הפקת הסרטון: ₪25
--
-- ‏update ולא insert: המפתח קיים מ-20261004090000, וה-seed שם אינו דורס
-- ערכים (‏on conflict do update set description בלבד). ה-Edge Function
-- ‎property-video-create‎ וגם דיאלוג הרכישה ב-CRM קוראים את הערך מכאן, ולכן
-- אין מה לפרוס מחדש.
-- ---------------------------------------------------------------------------
update public.pricing_config
   set value = 25,
       description = 'מחיר הפקת סרטון שיווקי לנכס לסוכן/ת בדרגת mid, בשקלים. Premium מפיק/ה בלי חיוב עד התקרה החודשית.'
 where key = 'property_video_price_mid'
   and value is distinct from 25;
