-- ===========================================================================
-- מרלו״ג / מרכז לוגיסטי - סוג נכס מסחרי חדש, מוכר לדוח ה-CMA
--
-- ‏6.11.2026: "מרלו״ג" הופיע בתיאורים של 8 נכסים (4 מסווגים כמחסנים,
-- 3 כמבני תעשייה ואחד כאולמות) ולא היה סוג לבחירה. הסוג נוסף לטופס
-- (‏COMMERCIAL_PTYPE_OPTIONS ב-crm.js, ‏COMMERCIAL_PTYPES ב-agent.ts) ולליבת
-- החיפוש (‏PROPERTY_TYPES.logistics ב-search-core.js).
--
-- כאן הוא נכנס ל-`property_type_class`: סוג שאינו ברשימה חוזר `null`
-- ונופל מכל דוח CMA בלי שגיאה (הסקיל cma-report, "אותו סוג"). הגוף זהה
-- ל-20270226090000 חוץ מהערך החדש ברשימת ה-commercial; "בנין" נשאר
-- בחוץ, מאותה סיבה. ‏scripts/check_deals_normalize.py קורא את המיגרציה
-- **האחרונה** שמגדירה את הפונקציה, ולכן הרשימה כאן מלאה ולא רק התוספת.
-- ===========================================================================

create or replace function public.property_type_class(p_type text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when nullif(btrim(coalesce(p_type, '')), '') is null or btrim(p_type) = '-'
      then null
    when btrim(p_type) in ('דירה', 'דירת גן', 'גג/פנטהאוז', 'דו משפחתי',
                           'בית פרטי/קוטג''', 'יחידת דיור', 'דירות',
                           'פנטהאוז', 'קוטג''', 'וילה', 'טריפלקס', 'דופלקס',
                           'בית פרטי', 'דירת גג', 'מרתף/פרטר', 'סטודיו/לופט',
                           'קוטג'' דו משפחתי', 'קוטג'' חד משפחתי')
      then 'dwelling'
    -- ‏"בנין"/"בניין" **אינם** כאן (20270226090000): ב-GovMap זה סוג שמערבב
    -- דירות, משרדים וחנויות, ורובו בקומות עליונות.
    when btrim(p_type) in ('חנויות/שטח מסחרי', 'משרדים', 'מבני תעשייה',
                           'מחסן', 'חנות', 'משרד', 'מבנה מסחרי', 'אולם',
                           'מסחרי', 'אולמות', 'חלל עבודה משותף', 'בניין משרדים',
                           'מחסנים', 'סטודיו', 'קליניקות',
                           'מרלו״ג/מרכז לוגיסטי')
      then 'commercial'
    when btrim(p_type) in ('מגרש', 'מגרשים', 'קרקע', 'קרקעות', 'נחלה', 'משק')
      then 'land'
    else null   -- סוג שאיננו מכירים - וגם "בנין" - אינו מנוחש למחלקה
  end;
$$;

comment on function public.property_type_class(text) is
  'מחלקת השוואה לסוג נכס: dwelling / commercial / land, או null כשהסוג ריק, לא מוכר, או "בנין" של GovMap (שמערבב דירות, משרדים וחנויות). מגשרת בין אוצר המילים של האתר, של GovMap ושל deals_engine.';

revoke all on function public.property_type_class(text) from public, anon;
grant execute on function public.property_type_class(text) to authenticated, service_role;
