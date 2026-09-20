-- ============================================================================
-- ייבוא ידני של עסקאות רשמיות מ-GovMap
--
-- ## למה זה נדרש
--
-- ‏`market_deals_official` **ריקה לגמרי**. ‏`deals_engine` קיים ומתועד ולא
-- הניב שורה אחת, ולכן דוח ה-CMA - יכולת שכבר נמכרת ב-Mid/Premium - רץ
-- היום בלי מאגר עסקאות רשמי בשום עיר, כולל עפולה.
--
-- הפתרון: מנהל/ת הפלטפורמה מדביק/ה את טבלת העסקאות מפורטל GovMap, שמגיש
-- את מאגר רשות המיסים. ‏1,500 עסקאות בעפולה לבדה.
--
-- ## ‏`source` נשאר `tax_authority`, וזו אינה התחכמות
--
-- מפתה לסמן את השורות האלה כ-`manual`. **לא.** ‏`source` אומר **מי ייצר
-- את המספר**, וזו רשות המיסים - בין אם הוא נשאב בסקריפט ובין אם הועתק
-- ביד מהפורטל הממשלתי שמגיש אותו. ‏`price_basis` במסמך ההסבר של
-- `market_deals` מגדיר `official` במפורש כ"מקור רשמי (רשות המיסים)".
--
-- דרך הקליטה היא **מטא-דאטה**, ומקומה ב-`raw`:
--   {"ingest": "manual_paste", "portal": "govmap", "at": "..."}
--
-- שורה שתסומן `manual` הייתה נופלת ל-`else s.source` ב-`agent_cma_report`
-- ומוצגת לסוכן/ת כמחרוזת באנגלית, וגם מאבדת את הייחוס הנכון.
--
-- ## מה שכן נסגר כאן
--
-- לטבלה האחות `market_deals` יש `check` על `source`; לטבלה הזו לא היה.
-- עמודת טקסט חופשי עם ברירת מחדל פירושה ששגיאת הקלדה אחת יוצרת מקור
-- חדש בשקט, והוא יופיע בדוח כמחרוזת לא מתורגמת.
--
-- תיעוד: docs/market-deals-official.md
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.market_deals_official'::regclass
                    and conname  = 'market_deals_official_source_chk') then
    alter table public.market_deals_official add constraint market_deals_official_source_chk
      check (source in ('tax_authority'));
  end if;
end $$;

comment on column public.market_deals_official.source is
  'מי ייצר את המספר. tax_authority בין אם נשאב בסקריפט ובין אם הועתק ביד מ-GovMap - דרך הקליטה יושבת ב-raw ואינה משנה את הייחוס.';

-- ---------------------------------------------------------------------------
-- הייבוא
--
-- ‏`security definer` + הרשאה ל-`authenticated` + גידור פנימי ב-
-- `current_is_platform_admin()`. זו התבנית של `admin_apply_tier_change`
-- ושל `platform_ops_report`, ולא המצאה.
--
-- ## הפרסור אינו כאן
--
-- הפונקציה מקבלת שורות **מפורסרות** ומאמתת ערכים. הפרסור של טקסט ההדבקה
-- יושב בדפדפן, כי שם נדרשת תצוגה מקדימה מיידית לכל שורה. אימות אינו
-- פרסור, ולכן אין כאן שני עותקים של אותה לוגיקה - יש שתי שכבות שונות.
--
-- ## ‏`on conflict do nothing` ולא `do update`
--
-- התהליך רבעוני, והחודשים חופפים. ייבוא חוזר של טווח שכבר נטען חייב
-- להיות no-op ולא כתיבה מחדש: `updated_at` שמתעדכן על 1,400 שורות זהות
-- היה מסתיר את השאלה "מה באמת השתנה מאז".
-- ---------------------------------------------------------------------------
create or replace function public.market_deals_import(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_city      text;
  v_inserted  integer := 0;
  v_skipped   integer := 0;
  v_rejected  jsonb   := '[]'::jsonb;
  v_row       jsonb;
  v_key       text;
  v_price     numeric;
  v_sqm       numeric;
  v_sold      date;
  v_reason    text;
begin
  if not public.current_is_platform_admin() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'invalid_payload');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_reason := null;
    v_city   := nullif(btrim(coalesce(v_row->>'city', '')), '');
    v_key    := nullif(btrim(coalesce(v_row->>'external_key', '')), '');

    begin
      v_price := (v_row->>'sale_price')::numeric;
      v_sqm   := nullif(v_row->>'size_sqm', '')::numeric;
      v_sold  := (v_row->>'sold_at')::date;
    exception when others then
      v_reason := 'ערך מספרי או תאריך לא תקין';
    end;

    -- האימות. שורה פגומה **נספרת ומוחזרת ואינה מנוחשת** - כלל deals_engine
    -- (docs/market-deals-official.md), והוא חל גם על הזנה ידנית.
    if v_reason is null then
      v_reason := case
        when v_key   is null                  then 'חסר external_key'
        when v_city  is null                  then 'חסרה עיר'
        when v_sold  is null                  then 'חסר תאריך מכירה'
        when v_sold  > current_date           then 'תאריך מכירה בעתיד'
        when v_sold  < date '1990-01-01'      then 'תאריך מכירה מוקדם מדי'
        when v_price is null or v_price <= 0  then 'מחיר לא תקין'
        when v_price < 10000                  then 'מחיר נמוך באופן חשוד'
        when v_price > 500000000              then 'מחיר גבוה באופן חשוד'
        when v_sqm is not null and v_sqm <= 0 then 'שטח לא תקין'
        else null
      end;
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object('key', v_key, 'reason', v_reason);
      continue;
    end if;

    insert into public.market_deals_official
      (external_key, source, city, neighborhood, street, house_number,
       gush, helka, property_type, rooms, size_sqm, floor, sale_price, sold_at, raw)
    values (
      v_key, 'tax_authority', v_city,
      nullif(btrim(coalesce(v_row->>'neighborhood', '')), ''),
      nullif(btrim(coalesce(v_row->>'street', '')), ''),
      nullif(btrim(coalesce(v_row->>'house_number', '')), ''),
      nullif(btrim(coalesce(v_row->>'gush', '')), ''),
      nullif(btrim(coalesce(v_row->>'helka', '')), ''),
      nullif(btrim(coalesce(v_row->>'property_type', '')), ''),
      nullif(v_row->>'rooms', '')::numeric,
      v_sqm,
      nullif(btrim(coalesce(v_row->>'floor', '')), ''),
      v_price, v_sold,
      jsonb_build_object(
        'ingest',    'manual_paste',
        'portal',    'govmap',
        'at',        now(),
        'tat_helka', v_row->>'tat_helka')
    )
    on conflict (external_key) do nothing;

    if found then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'rejected', v_rejected,
    'rejected_count', jsonb_array_length(v_rejected));
end $$;

comment on function public.market_deals_import(jsonb) is
  'ייבוא עסקאות רשמיות שהודבקו מ-GovMap. מנהל/ת פלטפורמה בלבד. שורה פגומה נספרת ומוחזרת ואינה מנוחשת, וייבוא חוזר של טווח חופף הוא no-op דרך external_key.';

revoke all on function public.market_deals_import(jsonb) from public, anon;
grant execute on function public.market_deals_import(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- מה יש, ומתי עודכן - להזנת התזכורת הרבעונית
-- ---------------------------------------------------------------------------
create or replace function public.market_deals_coverage()
returns table (city text, deals bigint, oldest date, newest date, last_import timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.city, count(*), min(o.sold_at), max(o.sold_at), max(o.imported_at)
    from public.market_deals_official o
   where public.current_is_platform_admin()
   group by o.city
   order by max(o.sold_at) asc nulls first;
$$;

comment on function public.market_deals_coverage() is
  'כמה עסקאות יש בכל עיר ומה טריותן. מזינה את התזכורת הרבעונית ואת מסך ההדבקה.';

revoke all on function public.market_deals_coverage() from public, anon;
grant execute on function public.market_deals_coverage() to authenticated, service_role;
