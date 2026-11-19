-- ===========================================================================
-- קק״ל בעפולה הוא הרחוב "קרן קיימת לישראל"
--
-- אנשים כותבים קק״ל, קק"ל, קקל, קק'ל או רח' קק"ל. street_name_key מוריד
-- גרשיים ותחילית "רח", ולכן כולן אותו מפתח. השם שגבריאלה מציגה ושומרת
-- הוא השם המלא שב-street_registry.
--
-- זו שורה ב-street_registry_aliases, אותה טבלה שהטופס והייבוא כבר
-- מתרגמים לפיה. אין כאן מנגנון מקביל, ואין עדכון של נכסים קיימים.
--
-- עפולה על רשימת gis, ו-street_registry_absorb_gov חוזרת לפני שהיא
-- מוחקת נרדפים. source = 'manual' מסמן שזו החלטה ולא שורה מהמאגר.
-- ===========================================================================

insert into public.street_registry_aliases (city, alias, name, source)
select 'עפולה', 'קק״ל', r.name, 'manual'
  from public.street_registry r
 where r.city = 'עפולה'
   and r.active
   and r.name = 'קרן קיימת לישראל'
   and not exists (
     select 1 from public.street_registry_aliases a
      where a.city = 'עפולה'
        and a.alias_key = public.street_name_key('קק״ל')
   );
