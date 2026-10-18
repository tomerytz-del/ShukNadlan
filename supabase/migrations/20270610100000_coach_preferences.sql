-- ===========================================================================
-- הטון של המנטור: בחירה של כל סוכן/ת
-- ---------------------------------------------------------------------------
-- תומר, 18.10.2026: "חבר מקצועי וחם, או מאמן ישיר וקשוח - תאפשר לסוכן לבחור".
-- הבחירה בכרטיס המנטור (assets/crm-coach.js), והיא חלה על "שאל את המנטור"
-- (coach-ask) ועל הסיכום היומי של הסוכן/ת (office-coach, kind=agent).
-- הסיכומים השבועיים של הצוות והמשרד נקראים בידי כמה מנהלים, ולכן לא מושפעים.
-- docs/coaches.md, "הטון".
--
-- טבלה משלה ולא עמודה ב-agency_members: protect_sensitive_agency_member_fields
-- שומר שם על שדות שהסוכן/ת לא משנה בעצמו/ה, וזו העדפה אישית קטנה. היעדר שורה
-- = warm.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

create table if not exists public.coach_preferences (
  agent_id   uuid primary key references public.agency_members (id) on delete cascade,
  tone       text not null default 'warm',
  updated_at timestamptz not null default now(),
  constraint coach_preferences_tone_chk check (tone in ('warm', 'direct'))
);
comment on table public.coach_preferences is
  'הטון של המנטור שהסוכן/ת בחר/ה: warm (חבר מקצועי וחם) או direct (מאמן ישיר וקשוח). אין שורה = warm. docs/coaches.md';

alter table public.coach_preferences enable row level security;

drop policy if exists "agent reads own coach preferences" on public.coach_preferences;
create policy "agent reads own coach preferences" on public.coach_preferences
  for select to authenticated
  using (agent_id = (select public.current_agent_id()));

drop policy if exists "agent inserts own coach preferences" on public.coach_preferences;
create policy "agent inserts own coach preferences" on public.coach_preferences
  for insert to authenticated
  with check (agent_id = (select public.current_agent_id()));

drop policy if exists "agent updates own coach preferences" on public.coach_preferences;
create policy "agent updates own coach preferences" on public.coach_preferences
  for update to authenticated
  using (agent_id = (select public.current_agent_id()))
  with check (agent_id = (select public.current_agent_id()));

-- אין policy למחיקה: חזרה לברירת המחדל היא עדכון ל-warm
revoke all on public.coach_preferences from anon, authenticated;
grant select, insert, update on public.coach_preferences to authenticated;
