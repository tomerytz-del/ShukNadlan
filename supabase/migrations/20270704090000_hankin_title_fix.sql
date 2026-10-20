-- ============================================================================
-- הכותרת האחרונה עם "יהושוע חנקין"
--
-- 20270703090000 תיקנה ארבעה נכסים שהרחוב שלהם היה "יהושוע חנקין". לנכס
-- הזה (חנקין 7, ‏120 מ"ר למכירה) הרחוב כבר היה נכון, ולכן הוא לא נכלל - אבל
-- הכותרת שלו עדיין כתובה "יהושוע". זו הכותרת היחידה באתר עם הכתיב הזה
-- (נספר 20.10.2026), וההכרעה התקבלה מול מנהל/ת הפלטפורמה.
--
-- התיאור השיווקי של הנכס טרי, וטביעת האצבע כוללת את הכותרת - לכן היא
-- מוחזרת באותה תבנית כמו 20261202090000_long_dash_backfill.sql, ותיקון
-- הכתיב אינו מסמן אותו כמתיישן.
--
-- אידמפוטנטית: מותנית בכותרת הישנה. בלי DDL.
-- ============================================================================

do $$
declare
  v_id    constant uuid := '5962cef7-c6b6-4af3-8577-858378dbff61';
  v_fresh boolean;
begin
  select p.marketing_description_fingerprint is not null
         and p.marketing_description_fingerprint = public.property_marketing_fingerprint(p)
    into v_fresh
    from public.properties p
   where p.id = v_id;

  update public.properties
     set title = replace(title, 'יהושוע חנקין', 'יהושע חנקין')
   where id = v_id
     and title like '%יהושוע חנקין%';

  if coalesce(v_fresh, false) then
    update public.properties p
       set marketing_description_fingerprint = public.property_marketing_fingerprint(src)
      from public.properties src
     where src.id = p.id
       and p.id = v_id
       and p.marketing_description_fingerprint is distinct from
           public.property_marketing_fingerprint(src);
  end if;
end $$;
