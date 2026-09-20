-- ============================================================================
-- שיוך שכונה מהפין, ואזורי תכנון שאינם שכונות
--
-- ## מה נמדד לפני שנכתבה שורה
--
-- מתוך 81 הנכסים הפעילים בעפולה, **19 לא היו משויכים לשום שכונה**. נכס כזה
-- אינו מופיע בסרגל הסינון המהיר, ו-`ssaCityFromText()` אינה רואה אותו —
-- כלומר הוא פעיל באתר ואינו קיים בשום מסנן. אין על כך שגיאה בשום מקום.
--
-- הסיבה היא ש-`properties.neighborhood_id` נבחר **בטופס**: הוא דעה ולא
-- נתון. בזמן שהפין כבר יושב על שורת הנכס והמצולע כבר יושב ב-
-- `neighborhoods.boundary`, ושניהם יודעים את התשובה.
--
-- ## מה ה-ray casting החזיר מול המצולעים הקיימים
--
-- ‏81 נכסים פעילים בעפולה, ומתוכם 19 בלי שכונה ו-62 עם שכונה.
--
--   מתוך 19 חסרי השכונה:
--     נפתרו לשכונה אחת ויחידה ....... 16   ==> נכתבים
--     בלי פין ולכן בלי מה לחשב ......  3   ==> הכרעה אנושית
--
--   מתוך 62 המשויכים:
--     השיוך מסכים עם הפין ........... 49   ==> לא נוגעים
--     לא נפלו בשום מצולע ............  6   (כולם שדרות יצחק רבין 1)
--     נפלו בשני מצולעים .............  4   (אורנים 44, ו-3x חרוד 1)
--     בלי פין, עם שיוך ידני .........  3   ==> נשמרים כפי שהם
--
-- **המצולעים שצוירו ביד טובים.** ההנחה שצריך לייבא מחדש את כל עפולה
-- מ-GovMap הייתה שגויה: מה שחסר הוא מצולע אחד (לב העמק C1, שאינו מכסה את
-- שדרות יצחק רבין 1), וזה תיקון ידני של חמש דקות ב-
-- `neighborhood-boundary.html`.
--
-- ## שתי ההכרעות שקובעות את ההתנהגות
--
-- **1. חפיפה אינה מוכרעת אוטומטית.** ההצעה הראשונה הייתה "השיוך הידני
--    גובר אם הוא אחד המועמדים". היא נבדקה מול המציאות ונפלה: בשני
--    המקרים השיוך הידני היה **שגוי** (אורנים 44 סומן מרכז העיר וצריך
--    להיות מערב העיר; חרוד 1 סומן מזרח העיר וצריך להיות אזור התעשייה).
--    הכלל היה משמר את שתי הטעויות בדיוק במקרים שנועד להגן עליהם.
--
--    לכן: נפל ביותר ממצולע אחד ==> אין הכרעה. זו אותה פילוסופיה של
--    `deals_engine` — רשומה מעורפלת נזרקת ונספרת ולא מנוחשת.
--
-- **2. אין טריגר על `properties`.** מפתה להוסיף אחד, אבל על הטבלה הזו
--    כבר יושבים 21 טריגרים ו-11 מהם יורים על כל עמודה. השיוך הוא פעולה
--    מפורשת של מנהל/ת הפלטפורמה: דוח יבש, אישור, ואז החלה.
--
-- תיעוד: docs/neighborhood-assignment.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- אזורי תכנון
--
-- ‏"B1 אזור בתכנון" ו-"D1 שכונה בתכנון" הן טבעות של כ-2 קילומטר עם אפס
-- נכסים. הן אינן שכונות שהתרוקנו אלא שטח שטרם נבנה, ואין סיבה שגולש/ת
-- יראה אותן בסרגל הסינון.
--
-- אבל **לא מוחקים אותן**: הגבולות כבר סומנו, ובלי הדגל הזה מי שירצה
-- להחזיר אותן יצטרך לצייר מחדש. הן נדלקות מעצמן ברגע שייכנס נכס ראשון.
-- ---------------------------------------------------------------------------
alter table public.neighborhoods
  add column if not exists is_planned boolean not null default false;

comment on column public.neighborhoods.is_planned is
  'אזור בתכנון ולא שכונה מאוכלסת. מוסתר מסרגל הסינון כל עוד אין בו נכסים, ונדלק מעצמו כשנכנס הראשון. ראו hoodChoices() ב-assets/home.js.';

update public.neighborhoods
   set is_planned = true
 where city = 'עפולה'
   and name in ('B1 אזור בתכנון', 'D1 שכונה בתכנון')
   and is_planned is distinct from true;

-- ---------------------------------------------------------------------------
-- ‏point in polygon
--
-- אלגוריתם ray casting קלאסי על טבעת `[lat, lng]` פתוחה — בדיוק המבנה
-- ש-`neighborhoods.boundary` מחזיק (ראו 20260831120000) ושהמפה מזינה ל-
-- `L.polygon`. **לא PostGIS**: אין כאן שאילתות מרחביות, הצרכן היחיד הוא
-- הפונקציה שמתחתיה, והוספת תוסף בשביל 14 מצולעים היא מחיר בלי תמורה.
--
-- ‏`immutable` כי היא פונקציה טהורה של הקלט, וזה מה שמאפשר לקרוא לה
-- בתוך `where` בלי שהמתכנן יריץ אותה מחדש לכל שורה של אותו זוג.
--
-- הטבעת **נסגרת כאן**: הנקודה האחרונה מחוברת לראשונה, כי הפורמט שמור
-- פתוח. מי שישכח את זה יקבל מצולע שדולף דרך הצלע החסרה.
-- ---------------------------------------------------------------------------
create or replace function public.point_in_ring(
  p_ring jsonb, p_lat double precision, p_lng double precision)
returns boolean
language plpgsql
immutable
as $$
declare
  n      integer;
  i      integer;
  j      integer;
  yi     double precision; xi double precision;
  yj     double precision; xj double precision;
  inside boolean := false;
begin
  if p_ring is null or p_lat is null or p_lng is null then return false; end if;
  if jsonb_typeof(p_ring) <> 'array' then return false; end if;
  n := jsonb_array_length(p_ring);
  if n < 3 then return false; end if;

  j := n - 1;                                  -- הצלע האחרונה סוגרת את הטבעת
  for i in 0 .. n - 1 loop
    yi := (p_ring -> i ->> 0)::double precision;
    xi := (p_ring -> i ->> 1)::double precision;
    yj := (p_ring -> j ->> 0)::double precision;
    xj := (p_ring -> j ->> 1)::double precision;

    -- הצלע חוצה את קו הרוחב של הנקודה, והחיתוך נמצא ממזרח לה
    if ((yi > p_lat) <> (yj > p_lat))
       and (p_lng < (xj - xi) * (p_lat - yi) / nullif(yj - yi, 0) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;

  return inside;
end $$;

comment on function public.point_in_ring(jsonb, double precision, double precision) is
  'ray casting על טבעת [lat,lng] פתוחה, כפורמט neighborhoods.boundary. סוגרת את הטבעת בעצמה.';

-- ---------------------------------------------------------------------------
-- השכונה של נקודה
--
-- מחזירה מזהה **רק** כשיש התאמה אחת ויחידה. אפס מצולעים ושני מצולעים
-- מחזירים שניהם `null`, וזו אינה עצלות אלא החוזה: `null` פירושו "לא ידוע",
-- לא "אין שכונה". מי שצריך להבחין ביניהם קורא לדוח שמתחת.
--
-- אותה הבחנה בדיוק שבין `null` ל-`throw` בחוזה הגאוקודינג
-- (`docs/geocoding.md`), ומאותה סיבה: תשובה שאינה ודאית שמתחזה לסופית היא
-- מה שמרעיל את הנתונים בשקט.
--
-- ‏`security definer` כי היא קוראת את `neighborhoods` מתוך טריגרים ומדוחות
-- של מנהל/ת פלטפורמה. היא מחזירה **uuid בלבד** — אין כאן מה לדלוף.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_for_point(
  p_city text, p_lat double precision, p_lng double precision)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- ‏(array_agg(...))[1] ולא min(): ל-PostgreSQL 17 **אין** min/max ל-uuid
  -- (הם נוספו ב-18), והפונקציה הייתה נופלת בזמן ריצה ולא בדחיפה.
  select case when count(*) = 1 then (array_agg(n.id))[1] end
    from public.neighborhoods n
   where n.city = p_city
     and n.boundary is not null
     and public.point_in_ring(n.boundary, p_lat, p_lng);
$$;

comment on function public.neighborhood_for_point(text, double precision, double precision) is
  'השכונה שהנקודה נופלת בה, אם ורק אם היא אחת. אפס מצולעים או שניים מחזירים null: null הוא "לא ידוע" ולא "אין שכונה".';

revoke all on function public.neighborhood_for_point(text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.neighborhood_for_point(text, double precision, double precision)
  to service_role;

-- ---------------------------------------------------------------------------
-- הדוח היבש
--
-- **זה הכלי, ולא ההחלה.** מי שמריץ רואה שורה לכל נכס שמשהו בו אינו מסתדר,
-- עם השיוך הנוכחי, השיוך המחושב ומספר המצולעים — ורק אז מחליט.
--
-- ‏`verdict` הוא מה שקובע מה ההחלה תעשה:
--   fill      — אין שיוך, יש מצולע אחד. ייכתב.
--   change    — יש שיוך, יש מצולע אחד, והם שונים. ייכתב.
--   ambiguous — שני מצולעים או יותר. **לא ייכתב**, עולה להכרעה אנושית.
--   no_polygon— פין תקין שאינו נופל בשום מצולע. **לא ייכתב** — סימן שהמצולע
--               חסר, ולא שהנכס חסר שכונה.
--   no_pin    — אין lat/lng. **לא ייכתב**, והשיוך הידני הקיים נשמר.
--
-- ‏`service_role` בלבד: הדוח קורא כתובות של נכסים מכל המשרדים.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_assignment_report(p_city text)
returns table (
  property_id  uuid,
  street       text,
  house_number text,
  assigned_now text,
  computed     text,
  computed_id  uuid,
  n_matches    integer,
  verdict      text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select p.id, p.street, p.house_number, p.lat, p.lng, p.neighborhood_id,
           (select array_agg(n.id order by n.name)
              from public.neighborhoods n
             where n.city = p_city
               and n.boundary is not null
               and public.point_in_ring(n.boundary, p.lat, p.lng)) as hits
      from public.properties p
     where p.status = 'active' and p.city = p_city)
  select m.id, m.street, m.house_number,
         (select n.name from public.neighborhoods n where n.id = m.neighborhood_id),
         (select string_agg(n.name, ' + ' order by n.name)
            from public.neighborhoods n where n.id = any(coalesce(m.hits, '{}'::uuid[]))),
         -- מזהה חוזר רק כשיש התאמה אחת. ההחלה משתמשת בו ולא בשם, כדי
         -- שלא תהיה שום דרך ש-`computed` המחורז ישמש בטעות כמפתח.
         case when array_length(m.hits, 1) = 1 then m.hits[1] end,
         coalesce(array_length(m.hits, 1), 0),
         case
           when m.lat is null or m.lng is null              then 'no_pin'
           when coalesce(array_length(m.hits, 1), 0) = 0    then 'no_polygon'
           when array_length(m.hits, 1) > 1                 then 'ambiguous'
           when m.neighborhood_id is null                   then 'fill'
           when m.neighborhood_id <> m.hits[1]              then 'change'
           else 'ok'
         end
    from m
   order by 8, 2, 3;
$$;

comment on function public.neighborhood_assignment_report(text) is
  'דוח יבש לשיוך שכונות מהפין. מוצג ומאושר לפני כל כתיבה. ambiguous ו-no_polygon לעולם אינם נכתבים.';

revoke all on function public.neighborhood_assignment_report(text) from public, anon, authenticated;
grant execute on function public.neighborhood_assignment_report(text) to service_role;

-- ---------------------------------------------------------------------------
-- ההחלה
--
-- כותבת **רק** `fill` ו-`change`. כל השאר נשאר כפי שהוא, וזו כל הנקודה.
-- ---------------------------------------------------------------------------
create or replace function public.neighborhood_apply_from_point(p_city text)
returns table (filled integer, changed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fill    integer := 0;
  v_change  integer := 0;
begin
  with r as (select property_id, computed_id
               from public.neighborhood_assignment_report(p_city)
              where verdict = 'fill' and computed_id is not null)
  update public.properties p
     set neighborhood_id = r.computed_id
    from r where p.id = r.property_id;
  get diagnostics v_fill = row_count;

  with r as (select property_id, computed_id
               from public.neighborhood_assignment_report(p_city)
              where verdict = 'change' and computed_id is not null)
  update public.properties p
     set neighborhood_id = r.computed_id
    from r where p.id = r.property_id;
  get diagnostics v_change = row_count;

  return query select v_fill, v_change;
end $$;

comment on function public.neighborhood_apply_from_point(text) is
  'מחילה את מה שהדוח סיווג fill או change בלבד. הרצת neighborhood_assignment_report קודם אינה המלצה.';

revoke all on function public.neighborhood_apply_from_point(text) from public, anon, authenticated;
grant execute on function public.neighborhood_apply_from_point(text) to service_role;

-- ---------------------------------------------------------------------------
-- שבע ההכרעות האנושיות
--
-- ארבע חפיפות ושלושה נכסים בלי פין. שאלתי, ואלה התשובות. הן נכנסות כאן
-- ולא כחישוב, כי אין ממה לחשב אותן: בחפיפה שני המצולעים אמרו "כן", ובלי
-- פין אין מה לשאול.
--
-- אידמפוטנטי דרך `is distinct from`: הרצה חוזרת אינה נוגעת בשורה, ולכן
-- אינה מפעילה את 11 הטריגרים שיורים על כל עמודה ב-`properties`.
--
-- שלושת חסרי הפין צריכים גם גאוקוד — השיוך אינו מחליף פין, הוא רק מחזיר
-- אותם לסרגל הסינון בינתיים.
-- ---------------------------------------------------------------------------
do $$
declare
  v_row    record;
  v_hood   uuid;
  v_total  integer := 0;
  v_fixes  constant jsonb := jsonb_build_array(
    -- חפיפה: שני מצולעים אמרו כן, והשיוך הידני היה שגוי בשניהם
    jsonb_build_object('p','25a3897b-eb2e-4efa-a01d-0dd5158a51f1','h','מערב העיר (שיכון גאולים)'), -- אורנים 44
    jsonb_build_object('p','3b279556-baa3-4db1-a445-2411cac819d6','h','אזור התעשייה'),             -- חרוד 1
    jsonb_build_object('p','4598c9e4-59a0-4238-b402-b0df4760d963','h','אזור התעשייה'),             -- חרוד 1
    jsonb_build_object('p','7b2758b5-3ee7-44f2-a752-87e007d17079','h','אזור התעשייה'),             -- חרוד 1
    -- בלי פין: אין מה לחשב
    jsonb_build_object('p','48da21e3-22eb-41f8-9867-288d2861406a','h','מרכז העיר'),                -- ארלוזורוב 22
    jsonb_build_object('p','e754e3d6-3cbe-4386-8809-89f536a01e46','h','מרכז העיר'),                -- הרב לוין
    jsonb_build_object('p','040a95f4-a064-40bb-8f19-bf3799ef5fa2','h','רובע יזרעאל'));             -- רום יעל 7
begin
  for v_row in select * from jsonb_array_elements(v_fixes) as t(f) loop
    select n.id into v_hood
      from public.neighborhoods n
     where n.city = 'עפולה' and n.name = (v_row.f ->> 'h');

    if v_hood is null then
      raise notice 'שכונה לא נמצאה, מדלג: %', v_row.f ->> 'h';
      continue;
    end if;

    update public.properties
       set neighborhood_id = v_hood
     where id = (v_row.f ->> 'p')::uuid
       and neighborhood_id is distinct from v_hood;

    if found then v_total := v_total + 1; end if;
  end loop;

  raise notice 'שיוך שכונה ידני: עודכנו % שורות', v_total;
end $$;
