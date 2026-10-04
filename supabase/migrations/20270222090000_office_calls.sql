-- ---------------------------------------------------------------------------
-- יומן שיחות: תצוגת משרד - מנהל/ת רואה ומאזין/ה לשיחות של סוכני המשרד
-- (docs/call-tracking.md)
--
-- קריאה בלבד: השיחות, המספרים וההקלטות של מי שחבר/ה **היום** במשרד של
-- המנהל/ת. סוכן/ת שעבר/ה משרד יוצא/ת מהתצוגה מעצמו/ה, כי התנאי הוא
-- agency_id הנוכחי ולא היסטוריה. ארכוב ומחיקה נשארים של הסוכן/ת בלבד
-- (agent_call_set_archived ו-twilio-voice?task=delete בודקות current_agent_id).
--
-- אותה צורה כמו agency_invitations_manager_read: current_agency_id() ו-
-- current_member_role() = 'manager'. הסוכן/ת רואה ב-CRM שהמנהל/ת יכול/ה
-- להאזין, והלקוח/ה שומע/ת בתחילת השיחה שהיא מוקלטת.
-- ---------------------------------------------------------------------------

drop policy if exists "agency manager reads office calls" on public.agent_calls;
create policy "agency manager reads office calls"
  on public.agent_calls for select to authenticated
  using (
    (select public.current_member_role()) = 'manager'
    and agent_id in (select m.id from public.agency_members m
                      where m.agency_id = (select public.current_agency_id()))
  );

drop policy if exists "agency manager reads office phone lines" on public.agent_phone_lines;
create policy "agency manager reads office phone lines"
  on public.agent_phone_lines for select to authenticated
  using (
    (select public.current_member_role()) = 'manager'
    and agent_id in (select m.id from public.agency_members m
                      where m.agency_id = (select public.current_agency_id()))
  );

-- ההקלטות: התיקייה הראשונה בנתיב היא מזהה הסוכן/ת (ראו 20270202090000)
drop policy if exists "agency manager reads office call recordings" on storage.objects;
create policy "agency manager reads office call recordings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'call-recordings'
    and (select public.current_member_role()) = 'manager'
    and (storage.foldername(name))[1] in (
      select m.id::text from public.agency_members m
       where m.agency_id = (select public.current_agency_id()))
  );
