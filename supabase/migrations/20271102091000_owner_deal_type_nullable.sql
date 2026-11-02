-- ============================================================================
-- בעל/ת נכס בלי סוג עסקה - לא מוכר/ת בשתיקה
--
-- deal_type היה not null default 'sale'. create_client עם client_kind=owner
-- ובלי deal_type שמר sale, ו-clientNeeds אמר "מוכר/ת" גם כשהסוכן/ת לא אמר/ה
-- מכירה או השכרה. ברירת המחדל של העמודה נשארת sale: ייבוא אנשי קשר ומחפש/ת
-- בלי שדה ממשיכים לקבל sale, וההתאמה (שוויון deal_type) לא משתנה.
--
-- לבעל/ת נכס מותר null. מחפש/ת עדיין חייב/ת ערך (ה-check החדש). בעל/ת נכס
-- ממילא לא נכנס/ת ל-client_property_match (השער client_kind = 'seeker'),
-- אז null לא פותח התאמות ולא שובר ציון. הכרטיס, ההסכם והבוט לא קוראים
-- ל-null "מוכר/ת": הם שואלים, או פותחים את אשף ההסכם בלי טופס מוכן.
-- ============================================================================

alter table public.agent_clients
  alter column deal_type drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_clients_deal_present_unless_owner'
      and conrelid = 'public.agent_clients'::regclass
  ) then
    alter table public.agent_clients
      add constraint agent_clients_deal_present_unless_owner
      check (client_kind = 'owner' or deal_type is not null);
  end if;
end $$;

comment on column public.agent_clients.deal_type is
  'sale או rent. אצל מחפש/ת חובה (קונה או שוכר/ת). אצל בעל/ת נכס מותר null כל עוד לא נאמר אם מוכר/ת או משכיר/ה. ברירת המחדל sale חלה רק כשהעמודה לא נשלחה.';
