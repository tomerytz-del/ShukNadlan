-- ---------------------------------------------------------------------------
-- שימוש הוגן בגבריאלה: סימון ההודעות של 75% ו-90% (docs/whatsapp-setup.md, "שימוש הוגן")
--
-- סוכן/ת PROFESSIONAL מקבל/ת מגבריאלה הודעה אחת כשהשימוש החודשי עובר 75%
-- מהתקרה, ועוד אחת ב-90% - עם הצעה לעבור ל-Elite, שבו אין תקרה (החלטת תומר,
-- 9.11.2026). ב-100% ההודעה היא החסימה עצמה (FAIR_USE_MSG), בלי שורה כאן.
-- האחוז אינו חושף את התקרה; המספר עצמו נשאר פנימי (gabriela_fair_use_monthly).
--
-- שורה = נשלחה, והכתיבה היא התפיסה: insert ... on conflict do nothing, ומי
-- שהכניס/ה את השורה שולח/ת. כך גם שתי הודעות שמעובדות במקביל (רצף) אינן
-- שולחות פעמיים, בלי עמודה על whatsapp_conversations (עמודה חדשה שם נכנסת
-- ל-select של loadConversation לפני שהמיגרציה רצה ומפילה כל תור - הסקיל
-- whatsapp-bots). אותו דפוס כמו promo_notices (20270308090000).
--
-- month = היום הראשון של החודש בשעון ישראל. whatsapp-webhook בלבד (service_role).
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

create table if not exists public.gabriela_fair_use_notices (
  agent_id  uuid not null references public.agency_members(id) on delete cascade,
  month     date not null,
  threshold int  not null check (threshold in (75, 90)),
  sent_at   timestamptz not null default now(),
  primary key (agent_id, month, threshold)
);

comment on table public.gabriela_fair_use_notices is
  'הודעות 75% ו-90% משימוש הוגן בגבריאלה (PROFESSIONAL), פעם אחת לסף לחודש. שורה = נשלחה. whatsapp-webhook בלבד. docs/whatsapp-setup.md';

alter table public.gabriela_fair_use_notices enable row level security;

revoke all on public.gabriela_fair_use_notices from anon, authenticated;
grant all on public.gabriela_fair_use_notices to service_role;
