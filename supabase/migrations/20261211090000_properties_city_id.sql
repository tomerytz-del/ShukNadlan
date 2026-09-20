-- ============================================================================
-- ‏properties.city_id — קישור הנכס לישות העיר
--
-- ## מה זה פותר
--
-- ‏`properties.city` הוא טקסט חופשי. אי אפשר לשאול עליו "אילו נכסים באזור
-- שלי", אי אפשר להצטרף ממנו לאזור או למחוז, וכל השוואה עליו היא השוואת
-- מחרוזות שנשברת על הבדל כתיב אחד.
--
-- המיגרציה מוסיפה `city_id` לצד העמודה הקיימת, ולא במקומה.
--
-- ## שלוש החלטות
--
-- ‏**1. `city` נשאר, ו-`city_id` הוא nullable לעד.** עיר שלא הוכרה היא נכס
--    שנשמר, לא נכס שנחסם — אותה פילוסופיית fail-open של
--    `_shared/company-registry.ts`. נכס בעיר שטרם הוזנה לרישום ימשיך להתפרסם
--    בדיוק כמו היום, ויקבל `city_id` מעצמו ברגע שהעיר תיכנס.
--
-- ‏**2. הטריגר אינו משכתב את `properties.city`.** אפשר היה ליישר את הכתיב
--    לשם הקנוני (כמו `canonicalStreet` בטופס הרחוב), וזה מפתה — אבל
--    `client_property_match` משווה `p_property.city = any(p_client.cities)`
--    **כטקסט**, ו-`agent_clients.cities` הוא `text[]` חופשי. יישור צד אחד בלי
--    השני היה מנתק התאמות חיות **בשקט**, בלי שגיאה ובלי שאיש ידע. יישור
--    הכתיב יבוא יחד עם `agent_clients.city_ids`, באותה מיגרציה, או לא בכלל.
--
-- ‏**3. ה-backfill מנוגד ומנות, ולא `update` אחד גורף.** ראו למטה — זו
--    המלכודת המרכזית כאן.
--
-- ## מלכודת ה-backfill
--
-- על `properties` יושבים 21 טריגרים, **ו-11 מהם יורים על עדכון של כל עמודה**.
-- ביניהם `properties_saved_search_alerts_upd`,
-- `properties_client_match_alerts_upd` ו-`properties_queue_description_upd`,
-- **ואין בגופם שום בדיקת עמודה**: הם קוראים ל-`generate_*_alerts(new.id)`
-- ולתור תיאורי ה-AI ללא תנאי.
--
-- כלומר `update properties set city_id = …` על כל הטבלה מריץ יצירת התראות
-- ותור תיאורים **לכל שורה**. מה שמונע גל התראות אינו היקף העמודות אלא
-- האידמפוטנטיות של הפונקציות עצמן
-- (`on conflict (search_id, property_id) do nothing`), והעלות החישובית
-- נשארת לינארית: ב-110 שורות זניחה, ב-50,000 לא.
--
-- ‏**שימו לב:** `docs/geocoding.md` טען שהטריגרים האלה "מפורטים בעמודות
-- ספציפיות שאינן כוללות אותן". זה לא נכון, והמסמך תוקן באותו PR. המסקנה
-- שלו נכונה, אבל מי שיסתמך על הנימוק ויוסיף טריגר שאינו אידמפוטנטי — ישבור.
--
-- תיעוד: docs/cities-and-regions.md
-- ============================================================================

alter table public.properties
  add column if not exists city_id uuid references public.cities(id) on delete set null;

comment on column public.properties.city_id is
  'העיר מרישום הערים. nullable לעד: עיר שלא הוכרה אינה חוסמת שמירה. properties.city נשאר מקור התצוגה.';

-- אינדקס חלקי: כל שאילתה שתשתמש בו מסננת ממילא status=active (המפה,
-- החיפוש, דף העיר, מנוע ההתאמות), והאינדקס החלקי קטן משמעותית.
create index if not exists properties_city_id_active_idx
  on public.properties (city_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- הטריגר
--
-- ‏before insert or update **of city** — מוגבל לעמודה אחת בכוונה, כדי שעדכון
-- מחיר או תמונה לא ישלם על פענוח מיותר. זה טריגר `before`, ולכן הוא רק כותב
-- ל-NEW ואינו מייצר `update` נוסף.
--
-- ‏`city_id_for_name` מחזירה null כשאין התאמה, וזה בדיוק המצב הרצוי.
-- ---------------------------------------------------------------------------
create or replace function public.properties_set_city_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.city_id := public.city_id_for_name(new.city);
  return new;
end $$;

comment on function public.properties_set_city_id() is
  'פותר city_id משם העיר בשמירה. אינו משכתב את properties.city — ראו ההסבר במיגרציה 20261211090000.';

drop trigger if exists properties_set_city_id_trg on public.properties;
create trigger properties_set_city_id_trg
  before insert or update of city on public.properties
  for each row execute function public.properties_set_city_id();

-- ---------------------------------------------------------------------------
-- ‏backfill מנות
--
-- ‏`service_role` בלבד: זו פונקציה שמקבלת גודל מנה ומריצה `update` על
-- `properties`, ואין שום סיבה שתהיה נגישה מהדפדפן.
--
-- מחזירה כמה שורות נפתרו בפועל, כדי שאפשר יהיה להריץ בלולאה עד 0.
-- ---------------------------------------------------------------------------
create or replace function public.properties_backfill_city_id(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done integer;
begin
  with pick as (
    select p.id
      from public.properties p
     where p.city_id is null
       and nullif(btrim(coalesce(p.city, '')), '') is not null
       and public.city_id_for_name(p.city) is not null
     order by p.updated_at
     limit greatest(coalesce(p_limit, 500), 1)
  )
  update public.properties t
     set city_id = public.city_id_for_name(t.city)
    from pick
   where t.id = pick.id;
  get diagnostics v_done = row_count;
  return v_done;
end $$;

comment on function public.properties_backfill_city_id(integer) is
  'משלים city_id במנות. מנות ולא update גורף, כי 11 טריגרים על properties יורים על כל עמודה ומריצים יצירת התראות ותור תיאורים לכל שורה. service_role בלבד.';

revoke all on function public.properties_backfill_city_id(integer) from public, anon, authenticated;
grant execute on function public.properties_backfill_city_id(integer) to service_role;

-- ---------------------------------------------------------------------------
-- ההשלמה הראשונה
--
-- ‏`cities` ריקה ברגע כתיבת המיגרציה, ולכן זהו no-op בהרצה הראשונה —
-- ‏`city_id_for_name` מחזירה null לכל שורה והתנאי בפונקציה מסנן את כולן.
-- הקריאה נשארת כאן כדי שהמיגרציה תהיה שלמה בפני עצמה: ברגע שמיגרציית
-- ההזנה תרוץ, הרצה חוזרת של הקובץ הזה (או קריאה ידנית לפונקציה) תשלים.
-- ---------------------------------------------------------------------------
do $$
declare
  v integer;
  v_total integer := 0;
begin
  loop
    v := public.properties_backfill_city_id(500);
    v_total := v_total + v;
    exit when v = 0;
  end loop;
  raise notice 'properties.city_id: הושלמו % שורות', v_total;
end $$;
