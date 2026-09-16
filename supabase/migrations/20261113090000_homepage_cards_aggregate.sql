-- ============================================================================
-- כרטיסי דף הבית — הספירה עוברת למסד במקום לרוץ בדפדפן על כל הנכסים
--
-- ## מה קורה היום
--
-- דף הבית מריץ שתי שאילתות שמושכות **את כל הנכסים הפעילים**, רק כדי לגזור
-- מהם שלושה דברים לכל כרטיס: מספר הנכסים, תחומי ההתמחות, ואזורי הפעילות.
--
--   loadLeadingAgents    → properties.select(agent_id, category,
--                          property_type, project_status).limit(2000)
--   loadLeadingAgencies  → properties.select(agency_id, category,
--                          property_type, project_status, city,
--                          neighborhoods(name)).limit(2000)
--
-- כלומר כל גולש/ת שפותח/ת את דף הבית מוריד/ה פעמיים את טבלת הנכסים, ואז
-- הדפדפן סופר. עם 71 נכסים פעילים זה לא מורגש; ב-2,000 אלו שתי התשובות
-- הכבדות ביותר בעמוד, והתקרה ‎limit(2000)‎ הופכת מ"גבול בטיחות" למכסה
-- שמתחילה **לחתוך** נכסים — ואז הספירה בכרטיס פשוט שגויה, בלי שום סימן.
--
-- ## מה נכנס כאן
--
-- שתי פונקציות שמחזירות שורה אחת לכל סוכן/ת ומשרד, עם המספרים מוכנים:
-- ‏Postgres סופר על האינדקס ומחזיר עשרות שורות במקום אלפים.
--
-- ## למה SECURITY INVOKER ולא DEFINER
--
-- ‏RLS על properties כבר מתיר ל-anon לקרוא נכסים פעילים — זה מה שדף הבית
-- עושה היום ישירות. ולכן אין כאן שום צורך לעקוף אותו: הפונקציות רצות
-- בהרשאות הקורא/ת, ו-RLS ממשיך לחול בדיוק כמו קודם. ‏SECURITY DEFINER היה
-- מוסיף עוד פונקציה לרשימה שצריך לבדוק בכל סקירת אבטחה, בלי שום תמורה.
--
-- ## הלוגיקה חייבת להישאר זהה ל-JS
--
-- ‏specs נגזר מ-AGENCY_SPECS ב-index.html, וה-SQL כאן מעתיק אותו אחד לאחד:
--
--   residential  category <> 'commercial'  וגם סוג הנכס אינו קרקע
--   commercial   category  = 'commercial'  וגם סוג הנכס אינו קרקע
--   land         סוג הנכס הוא קרקע/מגרש/משק
--   projects     יש project_status
--
-- **הסדר משמעותי**: הכרטיס מצייר את התגיות לפי סדר המערך, ולכן המערך
-- נבנה בסדר הקבוע הזה ולא לפי שכיחות.
--
-- ‏project_status נבדק ב-JS כ-‎!!p.project_status‎, כלומר מחרוזת ריקה היא
-- "אין פרויקט". ‎nullif(btrim(...), '')‎ כאן משחזר בדיוק את זה — ‎is not
-- null‎ לבדו היה סופר מחרוזת ריקה כפרויקט.
--
-- ‏areas (למשרדים בלבד) — שם השכונה כשיש, אחרת שם העיר, לפי שכיחות
-- יורדת, שלושה ראשונים. תיקו נשבר לפי שם כדי שהתוצאה תהיה יציבה בין
-- קריאות; ב-JS הוא נשבר לפי סדר ההגעה מהמסד, שאינו מובטח ממילא.
--
-- ## אידמפוטנטיות
--
-- ‎create or replace‎ בלבד, בלי DDL על טבלאות. בטוח להרצה חוזרת.
-- ============================================================================

-- סוגי הנכס שנחשבים קרקע. חייב להישאר זהה ל-AGENCY_LAND_TYPES ב-index.html.
create or replace function public.homepage_land_types()
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select array['מגרש', 'מגרשים', 'משק חקלאי/נחלה', 'משק עזר', 'קרקע חקלאית']::text[];
$$;

comment on function public.homepage_land_types() is
  'סוגי נכס שנחשבים קרקע בכרטיסי דף הבית. זהה ל-AGENCY_LAND_TYPES ב-index.html.';


create or replace function public.homepage_agent_cards()
returns table(agent_id uuid, active_count integer, specs text[])
language sql
stable
set search_path to 'public'
as $$
  with active as (
    select p.agent_id,
           p.category,
           p.property_type = any(public.homepage_land_types()) as is_land,
           nullif(btrim(coalesce(p.project_status, '')), '') is not null as is_project
      from public.properties p
     where p.status = 'active'
       and p.agent_id is not null
  )
  select a.agent_id,
         count(*)::int,
         array_remove(array[
           case when bool_or(a.category <> 'commercial' and not a.is_land) then 'residential' end,
           case when bool_or(a.category  = 'commercial' and not a.is_land) then 'commercial'  end,
           case when bool_or(a.is_land)                                    then 'land'        end,
           case when bool_or(a.is_project)                                 then 'projects'    end
         ], null)
    from active a
   group by a.agent_id;
$$;

comment on function public.homepage_agent_cards() is
  'שורה לכל סוכן/ת עם מספר הנכסים הפעילים ותחומי ההתמחות. מחליף שליפה של כל הנכסים לדפדפן.';


create or replace function public.homepage_agency_cards()
returns table(agency_id uuid, active_count integer, specs text[], areas text[])
language sql
stable
set search_path to 'public'
as $$
  with active as (
    select p.agency_id,
           p.category,
           p.property_type = any(public.homepage_land_types()) as is_land,
           nullif(btrim(coalesce(p.project_status, '')), '') is not null as is_project,
           nullif(btrim(coalesce(n.name, p.city, '')), '') as area
      from public.properties p
      left join public.neighborhoods n on n.id = p.neighborhood_id
     where p.status = 'active'
       and p.agency_id is not null
  ),
  ranked_areas as (
    select a.agency_id,
           a.area,
           row_number() over (
             partition by a.agency_id
             order by count(*) desc, a.area
           ) as rn
      from active a
     where a.area is not null
     group by a.agency_id, a.area
  )
  select a.agency_id,
         count(*)::int,
         array_remove(array[
           case when bool_or(a.category <> 'commercial' and not a.is_land) then 'residential' end,
           case when bool_or(a.category  = 'commercial' and not a.is_land) then 'commercial'  end,
           case when bool_or(a.is_land)                                    then 'land'        end,
           case when bool_or(a.is_project)                                 then 'projects'    end
         ], null),
         coalesce((
           select array_agg(r.area order by r.rn)
             from ranked_areas r
            where r.agency_id = a.agency_id
              and r.rn <= 3
         ), array[]::text[])
    from active a
   group by a.agency_id;
$$;

comment on function public.homepage_agency_cards() is
  'שורה לכל משרד עם מספר הנכסים הפעילים, תחומי ההתמחות ושלושת אזורי הפעילות המובילים.';


-- ‏קריאה בלבד, ודף הבית אנונימי — ולכן anon חייב/ת EXECUTE. ‏RLS ממשיך
-- לחול (SECURITY INVOKER), ולכן זה אינו מרחיב גישה לשום נתון שלא היה
-- נגיש קודם דרך select רגיל על properties.
grant execute on function public.homepage_agent_cards()   to anon, authenticated, service_role;
grant execute on function public.homepage_agency_cards()  to anon, authenticated, service_role;
grant execute on function public.homepage_land_types()    to anon, authenticated, service_role;
