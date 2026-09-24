-- ============================================================================
-- ‏property_planning_info: הדפדפן כותב גוש וחלקה בלבד
--
-- ## הפרצה
--
-- ‏20260910090000 נתנה ל-`authenticated` הרשאת `insert, update` על **כל**
-- הטבלה, וה-policy "agent full access own property planning info" מגבילה
-- רק את השורה (נכס של הסוכן/ת), לא את העמודות ולא את המסלול. כלומר כל
-- סוכן/ת - גם Pay&GO, גם מנוי/ה שפג - יכול/ה היה/תה לשלוח מהקונסול:
--
--   sb.from('property_planning_info').upsert({ property_id, land_use_designation: 'מגורים ד', ... })
--
-- והערך היה מוצג בדף הנכס, דרך property_planning_public, כ**מידע תכנוני
-- מה-GIS**. זה גרוע מעקיפת תשלום: זה ייעוד קרקע מומצא שקונה רואה/ה
-- ומאמין/ה לו.
--
-- ## מה נשאר פתוח לדפדפן, ולמה
--
-- ‏`gush`, ‏`helka` (ו-`property_id` כמפתח). שני מקומות ב-crm.js כותבים
-- אותם מהקלדה ידנית: אשף ההסכמים ("שמירה לכרטיס הנכס") ויצירת נכס מתוך
-- הסכם. זו הזנת נתונים של הסוכן/ת על נכס שלו/ה, בכל מסלול, ולא היכולת
-- שנמכרת ("מידע תכנוני - גוש, חלקה וייעוד קרקע" היא **השליפה האוטומטית**).
--
-- ## מי כותב את השאר
--
-- | מסלול | איך |
-- | --- | --- |
-- | עפולה, בטופס הנכס | ‏afula-planning-lookup עם `property_id`, ‏service_role, אחרי בדיקת בעלות ומסלול |
-- | עפולה, ברקע | ‏planning_record_result (security definer, service_role) |
-- | כל עיר אחרת | ‏govmap_save_planning (מיגרציה 20270101090000) |
--
-- ## מה עדיין אינו נסגר, ביושר
--
-- ‏govmap_save_planning מקבלת את הנתונים מהדפדפן, כי GovMap עונה לדפדפן
-- בלבד (עד תשובת מפ"י על קריאות שרת). היא אוכפת בעלות ומסלול ומאמתת
-- צורה, אבל סוכן/ת mid/premium יכול/ה לשלוח לה ערכים שלא הגיעו מ-GovMap.
-- ‏`source = 'govmap'` מסמן אותם. כשתהיה גישת שרת, השליפה עוברת לשרת
-- והפונקציה הזו יורדת. ‏docs/govmap.md.
--
-- ‏PostgREST מתרגם upsert ל-`insert ... on conflict do update set` על
-- העמודות שנשלחו - כולל `property_id` - ולכן גם `update(property_id)` נחוץ.
-- ה-policy (‏using, שמשמש גם כ-with check) מונעת להעביר שורה לנכס זר.
-- ============================================================================

revoke insert, update on table public.property_planning_info from authenticated;

grant insert (property_id, gush, helka) on table public.property_planning_info to authenticated;
grant update (property_id, gush, helka) on table public.property_planning_info to authenticated;

comment on table public.property_planning_info is
  'מידע תכנוני לנכס (גוש/חלקה/ייעוד/תוכניות). פנימי - לא נחשף לגולשים. הדפדפן כותב gush/helka בלבד; השאר נכתב ב-afula-planning-lookup, planning_record_result או govmap_save_planning. מיגרציה 20270102090000.';
