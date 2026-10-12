-- ============================================================================
-- המצולע של "מרכז העיר" (עפולה): הקצה הדרומי מכסה את דב ברכאן
--
-- ## מה נמצא
--
-- דב ברכאן 9 ו-11 (שני נכסים פעילים) יושבים ברצועה צרה בין הצלע הדרומית
-- של "מרכז העיר" לצלע הצפונית של "אזור התעשייה", ולא נופלים בשום מצולע
-- (`no_polygon`). לכן הטריגר מ-20270115092000 לא שייך להם שכונה, וכל סינון
-- לפי שכונה העלים אותם. העסקה הרשמית בדב ברכאן 13 כבר משויכת ל"מרכז העיר"
-- לפי השם שרשות המיסים רשמה - וזו גם ההכרעה של מנהל הפלטפורמה (12.10.2026):
-- דב ברכאן הוא מרכז העיר.
--
-- ## התיקון
--
-- שני קודקודים חדשים בצלע הדרומית, בין שני הקודקודים הקיימים שם
-- ([32.606237,35.288696] ו-[32.606237,35.290052]). כל שאר הטבעת נשאר.
-- נמדד לפני הכתיבה (shapely, ו-point_in_ring מול המסד):
--
--   • שטח נוסף: כ-5,600 מ"ר, רצועה אחת.
--   • החפיפה עם כל מצולע שכן **זהה** לפני ואחרי ("אזור התעשייה", "דרום העיר"
--     ושאר השכנים).
--   • משנים סטטוס: בדיוק שני הנכסים בדב ברכאן 9 ו-11, ועסקה אחת (דב ברכאן
--     13, שכבר משויכת למרכז העיר). ירושלים 27 ושאר הנקודות ברצועה נשארים
--     ב"אזור התעשייה". שני הנכסים נמצאים 9 מטר ומעלה בתוך הצלע החדשה.
--
-- ## לא דורסים עריכה ידנית
--
-- כמו ב-20270115093000: העדכון חל **רק** כשה-`boundary` הוא בדיוק הטבעת
-- הישנה. אם נערך בינתיים ב-`neighborhood-boundary.html`, המיגרציה מדלגת
-- ומודיעה.
--
-- ## השיוך
--
-- הטריגר על properties יורה רק על שינוי lat/lng/city, ולכן שינוי מצולע
-- אינו משייך מעצמו. כאן - אותה השלמה של 20270115092000: רק נכס בלי שכונה
-- שהפין שלו נופל עכשיו במצולע אחד ויחיד, ובשמירה על טביעת האצבע של התיאור
-- השיווקי למי שהיה טרי לפני. נבדק כ-select מול הטבעת החדשה: ההשלמה נוגעת
-- בדיוק בשני הנכסים בדב ברכאן; שלושת האחרים בלי שכונה (נורדאו 10, רימון 11,
-- הצפצפות 3) נופלים בשני מצולעים ונשארים להכרעה, כמו קודם.
--
-- **עסקאות לא מתעדכנות כאן**, ולא צריך: `neighborhoods_relink_deals` יורה
-- רק על שינוי שם או עיר, לא מצולע. העסקה היחידה ברצועה (דב ברכאן 13) כבר
-- משויכת למרכז העיר לפי השם.
--
-- תיעוד: docs/neighborhood-assignment.md
-- ============================================================================

do $$
declare
  v_old constant jsonb := '[[32.607169,35.286341],[32.606237,35.288696],[32.606237,35.290052],[32.611512,35.294958],[32.613075,35.295172],[32.615825,35.289338],[32.615825,35.287911],[32.614277,35.285681],[32.613184,35.284708],[32.612158,35.286305],[32.611001,35.286323],[32.608356,35.284967],[32.60821,35.284818]]';
  v_new constant jsonb := '[[32.607169,35.286341],[32.606237,35.288696],[32.6056,35.2896],[32.6059,35.29015],[32.606237,35.290052],[32.611512,35.294958],[32.613075,35.295172],[32.615825,35.289338],[32.615825,35.287911],[32.614277,35.285681],[32.613184,35.284708],[32.612158,35.286305],[32.611001,35.286323],[32.608356,35.284967],[32.60821,35.284818]]';
  v_now jsonb;
begin
  select boundary into v_now
    from public.neighborhoods
   where city = 'עפולה' and name = 'מרכז העיר';

  if not found then
    raise notice 'מרכז העיר לא נמצאה, מדלג';
  elsif v_now = v_new then
    raise notice 'מרכז העיר: המצולע כבר מעודכן';
  elsif v_now is distinct from v_old then
    raise notice 'מרכז העיר: המצולע נערך ידנית מאז, לא דורסים';
  else
    update public.neighborhoods
       set boundary = v_new
     where city = 'עפולה' and name = 'מרכז העיר';
    raise notice 'מרכז העיר: הקצה הדרומי הורחב אל דב ברכאן';
  end if;
end $$;

-- השלמת השכונה לנכסים שהמצולע מכסה עכשיו (אותה תבנית כמו 20270115092000)
do $$
declare
  v_fresh uuid[];
  v_rows  bigint;
begin
  create temporary table _hood_fill on commit drop as
    select p.id,
           public.neighborhood_for_city_point(p.city_id, p.city, p.lat, p.lng) as hood_id
      from public.properties p
     where p.neighborhood_id is null
       and p.lat is not null and p.lng is not null;
  delete from _hood_fill where hood_id is null;

  select array_agg(p.id) into v_fresh
    from public.properties p
    join _hood_fill f on f.id = p.id
   where p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  update public.properties p
     set neighborhood_id = f.hood_id
    from _hood_fill f
   where f.id = p.id
     and p.neighborhood_id is null;
  get diagnostics v_rows = row_count;
  raise notice 'שיוך שכונה מהפין: % נכסים', v_rows;

  update public.properties p
     set marketing_description_fingerprint = public.property_marketing_fingerprint(src)
    from public.properties src
   where src.id = p.id
     and p.id = any(coalesce(v_fresh, '{}'::uuid[]))
     and p.marketing_description_fingerprint is distinct from
         public.property_marketing_fingerprint(src);
  get diagnostics v_rows = row_count;
  raise notice 'טביעות אצבע שהוחזרו: % נכסים', v_rows;
end $$;
