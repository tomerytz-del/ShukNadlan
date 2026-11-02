-- ============================================================================
-- בעל/ת נכס בלי סוג עסקה - לא מוכר/ת בשתיקה
--
-- deal_type היה not null default 'sale'. create_client עם client_kind=owner
-- ובלי deal_type שמר sale, ו-clientNeeds אמר "מוכר/ת" גם כשהסוכן/ת לא אמר/ה
-- מכירה או השכרה. ברירת המחדל יורדת: שורה חדשה חייבת deal_type מפורש, או
-- null רק אצל owner. מחפש/ת בלי ערך נדחה ב-check ולא הופך בשקט לקונה.
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
  if exists (
    select 1
      from pg_catalog.pg_attrdef d
      join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.agent_clients'::regclass
       and a.attname = 'deal_type'
  ) then
    alter table public.agent_clients alter column deal_type drop default;
  end if;
end $$;

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
  'sale או rent. אצל מחפש/ת חובה (קונה או שוכר/ת). אצל בעל/ת נכס מותר null כל עוד לא נאמר אם מוכר/ת או משכיר/ה. אין ברירת מחדל: מי שיוצר שורה שולח את הערך.';
