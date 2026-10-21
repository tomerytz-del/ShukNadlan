-- ---------------------------------------------------------------------------
-- סימניות לנכסים ששותפו איתי
--
-- שלב 5 בעיצוב מחדש של ה-CRM (סעיף 3.14; docs/properties-unified.md): בלשונית
-- "שיתופים" במסך "נכסים" לכל נכס יש סימנייה, וצ'יפ "שמורים" שמציג רק אותם.
-- שמירה היא של הסוכן/ת ולא של המשרד - מה שאני שומר/ת לבדיקה אינו מה
-- שהשותף/ה שלי בחדר שומר/ת.
--
-- ‏**למה טבלה ולא localStorage:** סוכנים עובדים מהטלפון ומהמחשב, ונכס ששמרו
-- בבוקר בשטח צריך לחכות להם בערב במשרד.
--
-- ההרשאות (RLS): כל אחד/ת רואה, מוסיף/ה ומוחק/ת רק את השורות שלו/ה
-- (agent_id = current_agent_id()). אין update - שמירה היא שורה או היעדר שורה.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

create table if not exists public.property_bookmarks (
  agent_id     uuid not null references public.agency_members(id) on delete cascade,
  property_id  uuid not null references public.properties(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (agent_id, property_id)
);

create index if not exists property_bookmarks_property_idx
  on public.property_bookmarks (property_id);

comment on table public.property_bookmarks is
  'נכסים שסוכן/ת שמר/ה בלשונית "שיתופים" ב-CRM. docs/properties-unified.md';

alter table public.property_bookmarks enable row level security;

drop policy if exists property_bookmarks_select_own on public.property_bookmarks;
create policy property_bookmarks_select_own on public.property_bookmarks
  for select to authenticated
  using (agent_id = public.current_agent_id());

drop policy if exists property_bookmarks_insert_own on public.property_bookmarks;
create policy property_bookmarks_insert_own on public.property_bookmarks
  for insert to authenticated
  with check (agent_id = public.current_agent_id());

drop policy if exists property_bookmarks_delete_own on public.property_bookmarks;
create policy property_bookmarks_delete_own on public.property_bookmarks
  for delete to authenticated
  using (agent_id = public.current_agent_id());

revoke all on table public.property_bookmarks from anon;
grant select, insert, delete on table public.property_bookmarks to authenticated;
grant select, insert, update, delete on table public.property_bookmarks to service_role;
