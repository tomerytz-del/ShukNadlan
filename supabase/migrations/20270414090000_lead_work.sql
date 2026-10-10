-- ---------------------------------------------------------------------------
-- ‏lead_work — שלב הטיפול והערה אישית לכל ליד, בכרטיס הליד ב-CRM
--
-- עד כאן לליד היו שני מצבים בלבד: נעול או פתוח. מה שקורה אחרי הפתיחה —
-- נוצר קשר, נקבע סיור, לא רלוונטי, נסגר — חי בראש של הסוכן/ת או במחברת,
-- ורשימה של ארבעים לידים פתוחים נראתה זהה בין זה שמחכה לשיחה חוזרת מחר
-- לבין זה שכבר נסגר.
--
-- ‏(lead_id, agent_id) ולא lead_id לבדו: ליד שנמסר בהפנייה גלוי גם
-- למנהל/ת וגם לסוכן/ת (docs/office-referrals.md). לכל אחד/ת מהם השלב
-- וההערה שלו/ה, ושורה אחת משותפת הייתה נחסמת ב-RLS לצד השני.
--
-- טבלה נפרדת ולא עמודות על leads: אותו נימוק של lead_archives — ‏leads_masked
-- הוא ה-view שהדשבורד קורא, ו-leads עצמה אינה פתוחה לעדכון מהדפדפן.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_work (
  lead_id    uuid not null references public.leads(id)          on delete cascade,
  agent_id   uuid not null references public.agency_members(id) on delete cascade,
  stage      text not null default 'new'
             check (stage in ('new','contacted','meeting','not_relevant','won')),
  note       text check (note is null or length(note) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (lead_id, agent_id)
);

comment on table public.lead_work is
  'שלב הטיפול והערה אישית של סוכן/ת על ליד, כפי שנבחרו בכרטיס הליד ב-CRM. פרטי לסוכן/ת; אינו משנה את הליד, את הבעלות עליו או את החיוב.';
comment on column public.lead_work.stage is
  'new = חדש, contacted = נוצר קשר, meeting = בתיאום פגישה/סיור, not_relevant = לא רלוונטי/לא ענה, won = נסגר בהצלחה.';

create index if not exists lead_work_agent_idx
  on public.lead_work (agent_id, updated_at desc);

alter table public.lead_work enable row level security;

drop policy if exists "agent manages own lead work" on public.lead_work;
create policy "agent manages own lead work"
  on public.lead_work for all
  using (exists (
    select 1 from public.agency_members
    where agency_members.id = lead_work.agent_id
      and agency_members.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.agency_members
    where agency_members.id = lead_work.agent_id
      and agency_members.user_id = (select auth.uid())));

grant select, insert, update, delete on public.lead_work to authenticated;
