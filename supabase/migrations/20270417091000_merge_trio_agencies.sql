-- ===========================================================================
-- ‏טריו נכסים - איחוד שני המשרדים שנפתחו בטעות לאותו משרד
--
-- לבקשת מנהל הפלטפורמה (11.10.2026). המשרד נפתח פעמיים:
--
--   f5c077a3-…  "טריו נכסים - פתרונות נדל"ן בע"מ"  (14.9.2026)
--               חנן פרץ (מנהל) ואבשלום בדוס. אין בו נכסים.
--   9bd848cf-…  "טריו נכסים - פתרונות נדל"ן"        (7.10.2026)
--               ניסים בן עזרא (מנהל), חן חמו, מורן יפרח, אבי דדון, גלעד
--               דניאל. בו 25 הנכסים, הלוגו, תמונת הנושא והכתובת.
--
-- המשרד שנשאר הוא של ניסים (9bd848cf). חנן ואבשלום עוברים אליו, ושלושתם
-- מנהלים בו (role = 'manager' הוא כל ההרשאה של מנהל/ת משרד). מזהי החברים
-- אינם משתנים, ולכן כל מה שנקשר לחבר/ה (נכסים, לקוחות, ארנק, מסלול) עובר
-- איתם מעצמו. כל מה שנקשר למשרד הישן עובר לחדש, והמשרד הישן נמחק.
--
-- אידמפוטנטית: כל השינויים מסוננים לפי המזהה הישן, ובריצה חוזרת אחרי
-- המחיקה אין מה לעדכן.
-- ===========================================================================

do $$
declare
  old_id constant uuid := 'f5c077a3-4ba0-47bc-b5c7-cdfff0d2b70b';
  new_id constant uuid := '9bd848cf-2f80-47c0-89ac-481f7c41818e';
begin
  if not exists (select 1 from public.agencies where id = old_id) then
    return;
  end if;
  if not exists (select 1 from public.agencies where id = new_id) then
    raise exception 'merge_trio_agencies: target agency % is missing', new_id;
  end if;

  -- ‏החברים: חנן ואבשלום עוברים, ושניהם מנהלים
  update public.agency_members
     set agency_id = new_id
   where agency_id = old_id;

  update public.agency_members
     set role = 'manager'
   where agency_id = new_id
     and id in ('215dbc4f-fddd-4ab1-acd5-3c985a705cbd',   -- ניסים בן עזרא
                'da6e40be-7c07-422e-8ed5-b70dec858db1',   -- חנן פרץ
                'a5b72dea-7c77-4b73-907f-56515ed76cb7')   -- אבשלום בדוס
     and role is distinct from 'manager';

  update public.agency_members
     set released_from_agency_id = new_id
   where released_from_agency_id = old_id;

  -- ‏שיתופי נכסים שהמשרד הישן קיבל: מה שהחדש כבר קיבל, או שהוא נכס של
  -- החדש עצמו, נמחק (unique על property_id + shared_with_agency_id); השאר עובר
  delete from public.property_shares ps
   where ps.shared_with_agency_id = old_id
     and (exists (select 1 from public.properties p
                   where p.id = ps.property_id and p.agency_id = new_id)
          or exists (select 1 from public.property_shares x
                      where x.property_id = ps.property_id
                        and x.shared_with_agency_id = new_id));
  update public.property_shares set shared_with_agency_id = new_id
   where shared_with_agency_id = old_id;
  update public.property_shares set owner_agency_id = new_id
   where owner_agency_id = old_id;

  -- ‏החרגות שיתוף (מפתח agent_id + agency_id)
  delete from public.agent_share_exclusions e
   where e.agency_id = old_id
     and exists (select 1 from public.agent_share_exclusions x
                  where x.agent_id = e.agent_id and x.agency_id = new_id);
  update public.agent_share_exclusions set agency_id = new_id
   where agency_id = old_id;

  -- ‏הדירוג מחושב מחדש למשרד שנשאר
  delete from public.agency_rankings where agency_id = old_id;

  -- ‏כל השאר: היסטוריה ונתונים שנקשרו למשרד
  update public.agency_invitations          set agency_id = new_id where agency_id = old_id;
  update public.agency_member_claims        set agency_id = new_id where agency_id = old_id;
  update public.tier_changes                set agency_id = new_id where agency_id = old_id;
  update public.properties                  set agency_id = new_id where agency_id = old_id;
  update public.property_exclusivities      set agency_id = new_id where agency_id = old_id;
  update public.agent_clients               set agency_id = new_id where agency_id = old_id;
  update public.agent_targets               set agency_id = new_id where agency_id = old_id;
  update public.agreements                  set agency_id = new_id where agency_id = old_id;
  update public.contracts                   set agency_id = new_id where agency_id = old_id;
  update public.lead_charges                set agency_id = new_id where agency_id = old_id;
  update public.leads                       set agency_id = new_id where agency_id = old_id;
  update public.market_deals                set agency_id = new_id where agency_id = old_id;
  update public.mortgage_lead_purchases     set agency_id = new_id where agency_id = old_id;
  update public.office_coach_summaries      set agency_id = new_id where agency_id = old_id;
  update public.reviews                     set agency_id = new_id where agency_id = old_id;
  update public.rss_lead_purchases          set agency_id = new_id where agency_id = old_id;
  update public.saved_search_lead_purchases set agency_id = new_id where agency_id = old_id;
  update public.saved_searches              set agency_id = new_id where agency_id = old_id;

  delete from public.agencies where id = old_id;
end $$;
