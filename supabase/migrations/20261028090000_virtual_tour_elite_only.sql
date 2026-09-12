-- ============================================================================
-- סיור 360° הוא יכולת של Elite, ומחיר הפקת הסרטון עולה ל-₪25
--
-- הסיור העצמאי (‏20261027090000_property_virtual_tours) נפתח לכל סוכן/ת, כי
-- אין בו עלות לספק חיצוני. ההחלטה העסקית שונה: הוא נכנס לסל של **Elite**
-- (‏tier = 'premium' במסד; השם המסחרי הוא Elite, ראו assets/tiers.js), יחד עם
-- ההדמיות ולידי בעל-הנכס.
--
-- ## הגייטינג הוא במסד ולא במסך
--
-- לסיור אין Edge Function: העורך ב-CRM כותב ישירות לטבלה ולדלי דרך
-- ‎supabase-js‎ בסשן של הסוכן/ת. לכן "רק Elite" חייב להיות **policy**, ולא
-- תנאי ב-JavaScript — אחרת כל מי שיפתח קונסולה בדפדפן יעקוף אותו. הכפתור
-- ב-CRM מוסתר לשאר המסלולים כדי לא להציע מה שאין, אבל הגבול עצמו כאן.
--
-- שלושה מקומות, ולא אחד:
--   1. ‏insert/update על ‎property_virtual_tours‎ — יצירה ועריכה של הסיור.
--   2. ‏insert/update על ‎storage.objects‎ בדלי ‎property-tours‎ — ההעלאה עצמה,
--      שקורית *לפני* הכתיבה לטבלה. בלעדיה מי שאינו/ה Elite היה/תה יכול/ה
--      למלא את הדלי בפנורמות ולהיחסם רק בשמירה.
--   3. ‏select — הצגת הסיור בדף הנכס לגולשים.
--
-- **‏delete נשאר פתוח לבעל/ת הנכס בלי תנאי מסלול.** מי שירד/ה מ-Elite צריך/ה
-- להיות מסוגל/ת למחוק את הסיור שלו/ה ואת הקבצים שלו/ה — נעילה שמונעת גם
-- מחיקה היא לכידת נתונים, לא גייטינג.
--
-- ## מה קורה למי שיורד/ת מ-Elite
--
-- הסיור **נשאר שמור** ומפסיק להופיע — בדיוק כמו ההדמיות, שהזכאות שלהן
-- נבדקת בזמן הקריאה (‏property_visualizations_enabled) ולא בזמן ההפקה. זו
-- גם ההבטחה שכתובה בדף המסלולים: "היכולות של המסלולים בתשלום מפסיקות להיות
-- זמינות עד שמשדרגים שוב". שדרוג חוזר מחזיר את הסיור כמו שהיה, בלי להעלות
-- שוב תמונה אחת.
--
-- ולכן ‎has_virtual_tour‎ מפסיק להיות "יש שורה עם חללים" והופך ל"יש סיור
-- **שמוצג**": בלי זה אריח הנכס היה ממשיך להבטיח "סיור וירטואלי" גם אחרי
-- שהסיור ירד מהדף, והפילטר היה מחזיר נכסים בלי סיור. הדגל תלוי מעכשיו בשני
-- דברים שמשתנים בזמנים שונים — הסצנות והמסלול — ולכן יש לו שני טריגרים:
-- אחד על הסיור, ואחד על ‎agency_members‎ (מסלול, ‎active‎, ‎billing_status‎).
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
-- מקור אמת אחד ל"מי רשאי/ת", בדיוק כמו ‎property_video_tier‎ ו-
-- ‎property_visualizations_enabled‎: ה-policies, הדגל וה-CRM נשענים עליו.
--
-- ‏security definer כי היא נקראת מתוך policies ומתוך טריגרים ומסתכלת על
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
  'האם הסוכן/ת זכאי/ת לסיור 360° — מסלול Elite (premium) פעיל בלבד. מקור האמת לכל ה-policies ולדגל has_virtual_tour.';

grant execute on function public.property_virtual_tour_eligible(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. הדגל תלוי מעכשיו גם במסלול
--
-- ‎has_virtual_tour‎ עונה על השאלה "להראות תגית סיור?", ולכן הוא חייב לרדת
-- כשהסיור מפסיק להיות מוצג — בין אם החללים נמחקו ובין אם המסלול ירד.
-- ---------------------------------------------------------------------------
comment on column public.properties.has_virtual_tour is
  'יש לנכס סיור 360° שמוצג בפועל: לפחות חלל אחד ב-property_virtual_tours *וגם* סוכן/ת Elite פעיל/ה. נכתב בטריגרים בלבד.';

create or replace function public.sync_property_has_virtual_tour()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid := coalesce(new.property_id, old.property_id);
  v_has boolean;
begin
  select exists (
           select 1 from public.property_virtual_tours t
            where t.property_id = v_property_id
              and t.scenes <> '{}'::jsonb)
         and public.property_virtual_tour_eligible(p.agent_id)
    into v_has
    from public.properties p
   where p.id = v_property_id;

  -- הנכס עצמו נמחק והסיור ירד איתו ב-cascade: אין למי לכתוב
  if v_has is null then return null; end if;

  -- ‏is distinct from ולא כתיבה בכל מקרה: עדכון של properties גורר את כל
  -- הטריגרים שלה (‏updated_at, התראות, תורים), ואין סיבה להעיר אותם כששום
  -- דבר לא השתנה — למשל בשמירה חוזרת של אותו סיור.
  update public.properties
     set has_virtual_tour = v_has
   where id = v_property_id
     and has_virtual_tour is distinct from v_has;

  return null;
end;
$$;

/* הטריגר השני: המסלול. שינוי tier הוא הרגע שבו הסיור מופיע או נעלם בלי
   שאיש נגע בסצנות — שדרוג, ירידה, סיום הטבת ההשקה (‏promo-lifecycle) או
   השעיית חיוב. ‏update of מצמצם את ההפעלות לשלוש העמודות שמשנות זכאות,
   וה-when חוסם הפעלה על עדכון שלא שינה אותן בפועל.                        */
create or replace function public.sync_agent_properties_virtual_tour()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligible boolean := public.property_virtual_tour_eligible(new.id);
begin
  update public.properties p
     set has_virtual_tour = f.flag
    from (
      select p2.id,
             v_eligible and exists (
               select 1 from public.property_virtual_tours t
                where t.property_id = p2.id
                  and t.scenes <> '{}'::jsonb) as flag
        from public.properties p2
       where p2.agent_id = new.id
    ) f
   where p.id = f.id
     and p.has_virtual_tour is distinct from f.flag;

  return null;
end;
$$;

comment on function public.sync_agent_properties_virtual_tour() is
  'מיישר את has_virtual_tour של כל נכסי הסוכן/ת אחרי שינוי מסלול/פעילות/חיוב. סיור של מי שירד/ה מ-Elite נשאר שמור ומפסיק להופיע.';

drop trigger if exists agency_members_sync_virtual_tour on public.agency_members;
create trigger agency_members_sync_virtual_tour
  after update of tier, active, billing_status on public.agency_members
  for each row
  when (old.tier is distinct from new.tier
        or old.active is distinct from new.active
        or old.billing_status is distinct from new.billing_status)
  execute function public.sync_agent_properties_virtual_tour();

-- יישור חד-פעמי להגדרה החדשה: נכסים של מי שאינו/ה Elite מאבדים את הדגל
update public.properties p
   set has_virtual_tour = false
 where p.has_virtual_tour
   and not public.property_virtual_tour_eligible(p.agent_id);

-- ---------------------------------------------------------------------------
-- 3. ‏policies: יצירה ועריכה ל-Elite, מחיקה לבעל/ת הנכס, קריאה לפי תצוגה
-- ---------------------------------------------------------------------------

/* קריאה. שני מסלולים:
     · בעל/ת הנכס — תמיד, בכל מסלול ובכל סטטוס. זה מה שמאפשר לעורך ב-CRM
       להראות סיור של נכס שנמכר, ולמי שירד/ה מ-Elite לראות ולמחוק את מה
       שבנה/תה.
     · כל השאר — סיור של נכס ‎active‎ של סוכן/ת Elite פעיל/ה. ברגע שהמסלול
       יורד הסיור מפסיק להיות קריא לגולשים, וסקציית הסיור בדף הנכס לא
       נפתחת בכלל.                                                          */
drop policy if exists "read tours of active or own properties" on public.property_virtual_tours;
create policy "read tours of active or own properties"
  on public.property_virtual_tours for select
  using (exists (
    select 1 from public.properties p
     where p.id = property_virtual_tours.property_id
       and (p.agent_id = public.current_agent_id()
            or (p.status = 'active'
                and public.property_virtual_tour_eligible(p.agent_id)))));

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
-- 4. ההעלאה לדלי
--
-- ההעלאה קורית לפני הכתיבה לטבלה, ולכן תנאי המסלול נדרש גם כאן. הדלי אינו
-- יודע לאיזה נכס הקובץ שייך (הנתיב הוא ‎<agent_id>/<property_id>/…‎ ואין
-- עליו ‎join‎), ולכן הזכאות נבדקת על הסוכן/ת המחובר/ת — מי שאינו/ה Elite
-- אינו/ה מעלה לדלי הזה בכלל.
--
-- ‏delete ו-select נשארים כפי שהיו.
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
-- 5. מחיר הפקת הסרטון: ₪25
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
