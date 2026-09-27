-- ===========================================================================
-- משרד נולד עם עיר - ומשרד בלי עיר אינו נעלם בשקט
--
-- ## מה נמצא (27.9.2026)
--
-- ‏**שני מסלולי פתיחת המשרד** (agency-signup, ו-create-own-agency מה-CRM)
-- יצרו את המשרד עם שם בלבד - בלי כתובת ובלי עיר. ‏agencies.city_id התמלא
-- רק משני מקורות: הכתובת, כשמנהל/ת המשרד מילא/ה אותה בהגדרות (טריגר
-- agencies_set_city_id), או ההשלמה מהנכסים (agencies_backfill_city_id) -
-- שרצה **רק בתוך מיגרציות של שווקים**. משרד שנפתח בלי כתובת ולא העלה נכס
-- נשאר בלי עיר לתמיד. חמישה משרדים מעפולה ישבו כך (טריו נכסים, פא"י נכסים,
-- אביב נכסים, קבוצת מצליח, DESE GROUP).
--
-- ‏**איפה זה נראה ואיפה לא:** באתר הפומבי משרד בלי עיר מופיע בשוק ברירת
-- המחדל (market-scope.js, מצב exclude), כלומר בעפולה - ולכן זה לא נראה.
-- אבל ב-platform_market_report ובסף ההדלקה של הסוכן התפעולי משרד נספר רק
-- לפי העיר שלו, ועפולה נראתה עם חמישה משרדים פחות. ועם שמונה שווקים הכשל
-- מחריף: משרד חדש מנתניה בלי עיר היה מופיע באתר של עפולה.
--
-- ## ארבע שכבות
--
--   1. ‏**התיקון עכשיו** - ההשלמה הרגילה, ואז עפולה לכל משרד שנפתח לפני
--      החלוקה לשווקים ועדיין בלי עיר (האתר היה אז של עפולה בלבד).
--   2. ‏**עיר בפתיחה** - שני מסלולי הפתיחה מקבלים city_id (רשימה סגורה
--      בטופס, מ-market_city_names כאן), והטריגר כבר אינו דורס אותו.
--   3. ‏**הנכס הראשון** - משרד שעדיין בלי עיר מקבל את העיר של הנכס הראשון
--      שלו מיד, ולא במיגרציה הבאה.
--   4. ‏**אזהרה** - platform_agencies_without_city() לפאנל השווקים ב-CRM,
--      ו-agency_no_city בסוכן התפעולי.
--
-- ‏docs/regional-pages.md, "משרד בלי עיר".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2א. רשימת הערים לטופס הפתיחה
--
-- ‏cities_public חושפת רק ערים חיות, ובשווקים שעוד לא נפתחו אין אף אחת -
-- כלומר הטופס היה ריק. ערי השווקים עצמן אינן סוד: ‏market_cities_public כבר
-- חושפת את המזהים שלהן, ו-assets/markets.js את השווקים. כאן רק מזהה, שם
-- ושוק - בלי עמודות התפעול.
-- ---------------------------------------------------------------------------
create or replace view public.market_city_names as
select c.id, c.name, c.market_slug
  from public.cities c
 where c.market_slug is not null
   and c.active;

comment on view public.market_city_names is
  'ערי השווקים - מזהה, שם ושוק - לבחירת עיר המשרד בפתיחת משרד. בלי security_invoker בכוונה: הסינון הוא market_slug, ועמודות התפעול אינן כאן. ראו 20270115101000.';

grant select on public.market_city_names to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2ב. הטריגר: עיר שנבחרה אינה נדרסת
--
-- עד היום, ב-INSERT הטריגר כתב תמיד city_id_from_address(address) - ומשרד
-- חדש בלי כתובת קיבל null גם אם העיר נשלחה. עכשיו: רק כשאין עיר. זה גם
-- הכלל שכבר חל ב-UPDATE (החלטה ידנית אינה נדרסת).
-- ---------------------------------------------------------------------------
create or replace function public.agencies_set_city_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.city_id is null then
    new.city_id := public.city_id_from_address(new.address);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. הנכס הראשון משלים את עיר המשרד
--
-- אותה שכבה 2 של agencies_backfill_city_id, אבל ברגע שהנכס נשמר: משרד בלי
-- עיר מקבל את העיר של הנכס. רק כשהעיר ריקה - משרד עם עיר שמעלה נכס בעיר
-- אחרת (מתווך/ת מעפולה שמוכר/ת בנוף הגליל) נשאר בעיר שלו.
-- ---------------------------------------------------------------------------
create or replace function public.properties_fill_agency_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agency_id is not null and new.city_id is not null then
    update public.agencies
       set city_id = new.city_id
     where id = new.agency_id
       and city_id is null;
  end if;
  return new;
end $$;

comment on function public.properties_fill_agency_city() is
  'טריגר: משרד בלי עיר מקבל את העיר של הנכס שנשמר. לא דורס עיר קיימת. ראו 20270115101000.';

revoke all on function public.properties_fill_agency_city() from public, anon, authenticated;

drop trigger if exists properties_fill_agency_city_trg on public.properties;
create trigger properties_fill_agency_city_trg
  after insert or update of city_id, agency_id on public.properties
  for each row execute function public.properties_fill_agency_city();

-- ---------------------------------------------------------------------------
-- 4. האזהרה לפאנל השווקים
--
-- אותה תבנית של platform_market_report: security definer, בדיקת הרשאה
-- בשורה הראשונה, ושמות פומביים בלבד (שם משרד, תאריך, מספר נכסים).
-- ---------------------------------------------------------------------------
create or replace function public.platform_agencies_without_city()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', a.name,
             'slug', a.slug,
             'created_at', a.created_at,
             'props', (select count(*) from public.properties p where p.agency_id = a.id)
           ) order by a.created_at)
      from public.agencies a
     where a.city_id is null
  ), '[]'::jsonb);
end $$;

comment on function public.platform_agencies_without_city() is
  'משרדים בלי עיר - לא נספרים באף שוק. לפאנל השווקים ב-CRM, למנהל/ת פלטפורמה בלבד; מסרב ב-42501. ראו 20270115101000.';

revoke all on function public.platform_agencies_without_city() from public, anon, authenticated;
grant execute on function public.platform_agencies_without_city() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. התיקון: ההשלמה הרגילה, ואז עפולה למשרדים שנפתחו לפני החלוקה
--
-- ‏25.9.2026 בשעה 16:51 נוסף השוק השני (#424, 20270112090000). עד אז האתר היה
-- של עפולה בלבד, וכל מי שנרשם - נרשם אליו. משרד שנפתח אחרי ועדיין בלי עיר
-- אינו מנוחש: הוא מופיע בפאנל ובסוכן התפעולי.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  select * into r from public.agencies_backfill_city_id();
  raise notice 'agencies.city_id: % מכתובת, % מנכסים, % נותרו ריקים',
    r.from_address, r.from_properties, r.still_null;
end $$;

do $$
declare
  v_afula uuid;
  v_done  integer;
begin
  select id into v_afula from public.cities where muni_code = '7700';
  if v_afula is null then
    raise warning 'עפולה (7700) לא נמצאה ברישום - המשרדים לא שויכו';
    return;
  end if;
  update public.agencies
     set city_id = v_afula
   where city_id is null
     and created_at < timestamptz '2026-09-25 16:51+03';
  get diagnostics v_done = row_count;
  raise notice 'משרדים מלפני החלוקה שויכו לעפולה: %', v_done;
end $$;
