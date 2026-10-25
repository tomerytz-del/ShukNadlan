-- ===========================================================================
-- אזור ההטמעה: הודעות לסוכנים דרך גבריאלה (docs/csm-adoption.md, "קישורים לסוכנים")
-- ---------------------------------------------------------------------------
-- מנהלת ההטמעה מבקשת מגבריאלה "תשלחי ליוסי את הקישור להוספת נכס", וגבריאלה
-- שולחת אותו לסוכן/ת מהמספר שלה (csm_send_to_agent, ‏csm-tools.ts) - אחרי שהיא
-- ראתה את הנוסח ואישרה. הקישור רק מהרשימה הסגורה ב-csm-links.ts.
--
-- היומן כאן: מה נשלח, למי, מתי ובאיזה ערוץ (טקסט בתוך 24 השעות של הסוכן/ת,
-- תבנית מחוצה להן). שלושה שימושים: "מה שלחתי ליוסי?", התקרה היומית שמגינה על
-- דירוג האיכות של המספר אצל Meta, ובדיקה בדיעבד.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

create table if not exists public.csm_messages (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.csm_staff(id) on delete cascade,
  agent_id       uuid references public.agency_members(id) on delete cascade,
  link_key       text,
  url            text,
  body           text not null check (char_length(body) <= 4000),
  channel        text not null check (channel in ('text', 'template')),
  wa_message_id  text,
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists csm_messages_staff_idx on public.csm_messages (staff_id, created_at desc);
create index if not exists csm_messages_agent_idx on public.csm_messages (agent_id, created_at desc);

comment on table public.csm_messages is
  'הודעות שצוות ההטמעה שלח לסוכנים דרך גבריאלה (csm_send_to_agent). נכתב רק מ-whatsapp-webhook. docs/csm-adoption.md';

alter table public.csm_messages enable row level security;
revoke all on table public.csm_messages from anon;
revoke insert, update, delete on table public.csm_messages from authenticated;
grant select on table public.csm_messages to authenticated;
grant select, insert, update, delete on table public.csm_messages to service_role;
drop policy if exists "csm team reads messages" on public.csm_messages;
create policy "csm team reads messages" on public.csm_messages for select to authenticated
  using (public.current_is_csm());
