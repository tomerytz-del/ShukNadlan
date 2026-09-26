-- ============================================================================
-- שיוך שכונה אוטומטי מהפין — טריגר צר, והשלמה למפרע
--
-- ## מה נמצא
--
-- בסינון לפי שכונות בדף הבית של עפולה, בלשונית "השכרה": 5 נכסים בתוצאות,
-- ורק 3 מהם בכל השכונות יחד. השניים החסרים (החורש 5, שדרות רובע יזרעאל 32)
-- לא היו משויכים לשום שכונה, ולכן כל סינון לפי שכונה העלים אותם.
--
-- בעפולה כולה: **19 נכסים פעילים בלי שכונה** שהפין שלהם נופל במצולע אחד
-- ויחיד. 16 מהם הם בדיוק ה-fill שנמדד ב-20261212099000 — שם נבנו הכלים
-- (`neighborhood_assignment_report`, `neighborhood_apply_from_point`), אבל
-- ההחלה עצמה לא הורצה מעולם. ושלושה נכסים חדשים נוספו לרשימה מאז. כלומר
-- "פעולה מפורשת של מנהל/ת" התבררה בפועל כ"פעולה שאיש אינו מבצע", והפער רק
-- גדל עם כל נכס חדש שסוכן/ת לא בחר/ה לו שכונה (השדה "לא חובה" בטופס).
--
-- ## מה משתנה בהחלטה של 20261212099000, ומה לא
--
-- ההחלטה שם — "אין טריגר על properties" — נשענה על כך ש-11 טריגרים יורים
-- על כל עדכון. הטריגר כאן אינו מצטרף אליהם:
--
--   • ‏`before insert or update of lat, lng, city` — עדכון מחיר או תמונה
--     אינו מפעיל אותו.
--   • ‏`when (new.neighborhood_id is null and new.lat/lng is not null)` —
--     גם כשהוא מופעל, הפונקציה אינה נקראת לנכס שכבר יש לו שכונה.
--   • ‏`before` — כותב ל-NEW בלבד, בלי update נוסף ובלי להפעיל את השאר.
--
-- **והחוזה נשמר במלואו:** הטריגר כותב רק את מה שהדוח מסווג `fill` —
-- שכונה חסרה ומצולע אחד ויחיד. חפיפה (`ambiguous`), פין מחוץ לכל מצולע
-- (`no_polygon`) ושינוי של שיוך קיים (`change`) נשארים להכרעה אנושית, בדיוק
-- כמו קודם. שיוך שסוכן/ת בחר/ה לעולם אינו נדרס.
--
-- ## סדר הטריגרים
--
-- טריגרי `before` רצים לפי שם. ‏`properties_set_neighborhood_trg` בא אחרי
-- ‏`properties_set_city_id_trg` (‏c < n), ולכן `new.city_id` כבר פתור; ולפני
-- ‏`properties_track_marketing_copy` (‏s < t), ולכן טביעת האצבע של תיאור
-- שנכתב באותה שמירה כבר כוללת את השכונה — ואינו מסומן מתיישן בטעות.
--
-- תיעוד: docs/neighborhood-assignment.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- השכונה של נקודה בעיר, לפי city_id
--
-- ‏`neighborhood_for_point` משווה את שם העיר כטקסט, ו"קרית ים" מול "קריית
-- ים" היה מחזיר null בשקט. כאן ההשוואה היא על `city_id` — אותו מפתח שכבר
-- מסנן את השכונות בדף הבית — ורק כשהוא חסר נופלים לשם.
--
-- אותו חוזה: מזהה רק כשיש התאמה אחת ויחידה; אחרת null ("לא ידוע").
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_for_city_point(
  p_city_id uuid, p_city text, p_lat double precision, p_lng double precision)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- ‏(array_agg(...))[1] ולא min(): ל-PostgreSQL 17 אין min/max ל-uuid.
  select case when count(*) = 1 then (array_agg(n.id))[1] end
    from public.neighborhoods n
   where (case when p_city_id is not null then n.city_id = p_city_id
               else n.city = p_city end)
     and n.boundary is not null
     and public.point_in_ring(n.boundary, p_lat, p_lng);
$$;

comment on function public.neighborhood_for_city_point(uuid, text, double precision, double precision) is
  'השכונה שהנקודה נופלת בה בעיר (לפי city_id, ובהיעדרו לפי שם), אם ורק אם היא אחת. אחרת null.';

revoke all on function public.neighborhood_for_city_point(uuid, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.neighborhood_for_city_point(uuid, text, double precision, double precision)
  to service_role;

-- ---------------------------------------------------------------------------
-- הטריגר
-- ---------------------------------------------------------------------------
create or replace function public.properties_set_neighborhood()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.neighborhood_id := public.neighborhood_for_city_point(
    new.city_id, new.city, new.lat, new.lng);
  return new;
end $$;

comment on function public.properties_set_neighborhood() is
  'ממלא neighborhood_id חסר מהפין, רק כשהוא נופל במצולע אחד ויחיד. אינו דורס שיוך קיים. ראו 20270114103000.';

revoke all on function public.properties_set_neighborhood() from public, anon, authenticated;

drop trigger if exists properties_set_neighborhood_trg on public.properties;
create trigger properties_set_neighborhood_trg
  before insert or update of lat, lng, city on public.properties
  for each row
  when (new.neighborhood_id is null and new.lat is not null and new.lng is not null)
  execute function public.properties_set_neighborhood();

-- ---------------------------------------------------------------------------
-- השלמה למפרע
--
-- כל נכס (לא רק פעיל — טיוטה שתפורסם מחר צריכה לצאת משויכת) בלי שכונה,
-- עם פין, שנופל במצולע אחד ויחיד.
--
-- **טביעת האצבע של התיאור השיווקי:** ‏`neighborhood_id` הוא חלק מ-
-- ‏`property_marketing_fingerprint()`, ולכן השלמה תמימה הייתה מסמנת כל
-- תיאור טרי כמתיישן — קריאת Claude מיותרת לכל נכס, על שיוך שאינו שינוי
-- בנכס עצמו. אותו טיפול כמו ב-20261202090000: מי שהיה טרי **לפני** מקבל
-- טביעת אצבע מעודכנת, ומי שכבר היה מתיישן נשאר מתיישן.
--
-- אידמפוטנטית: הרצה שנייה לא מוצאת נכס חסר שניתן לפתור, ואינה נוגעת בדבר.
-- ---------------------------------------------------------------------------
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

  -- 1. מי טרי לפני ההשלמה
  select array_agg(p.id) into v_fresh
    from public.properties p
    join _hood_fill f on f.id = p.id
   where p.marketing_description_fingerprint is not null
     and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p);

  -- 2. ההשלמה
  update public.properties p
     set neighborhood_id = f.hood_id
    from _hood_fill f
   where f.id = p.id
     and p.neighborhood_id is null;
  get diagnostics v_rows = row_count;
  raise notice 'שיוך שכונה מהפין: % נכסים', v_rows;

  -- 3. החזרת טביעת האצבע למי שהיה טרי
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
