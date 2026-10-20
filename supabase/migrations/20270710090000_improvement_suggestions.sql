-- ---------------------------------------------------------------------------
-- הצעות לשיפור מהסוכנים
--
-- כפתור עם אייקון של זבוב ליד "עזרה" בתחתית התפריט ב-CRM (בקשה של תומר,
-- 20.10.2026; docs/improvement-suggestions.md). סוכן/ת כותב/ת מה כדאי לשפר,
-- וההצעה נשמרת כאן עם המסך שממנו נשלחה. מנהלי הפלטפורמה מקבלים התראה בפעמון
-- (ובוואטסאפ, לפי ההגדרות שלהם), ורואים את כל ההצעות ב"הצעות לשיפור".
--
-- ‏**למה טבלה ולא וואטסאפ או מייל:** הצעה שנשלחת בוואטסאפ מהטלפון של הסוכן/ת
-- נבלעת בשיחה, ואין רשימה אחת לעבור עליה ולסמן מה טופל.
--
-- ההרשאות (RLS):
--   ‏· insert - סוכן/ת מחובר/ת, ורק בשמו/ה (agent_id = current_agent_id()).
--   ‏· select - מי שכתב/ה, ומנהלי הפלטפורמה.
--   ‏· update - מנהלי הפלטפורמה בלבד (סימון "טופל"). אין delete.
--
-- תקרה: 10 הצעות בשעה לסוכן/ת, בטריגר. כפתור שנלחץ בלולאה לא ממלא את הפעמון.
--
-- סוג ההתראה נוסף דרך notification_types_add ולא בכתיבה מחדש של האילוץ
-- (סקיל agent-notifications, סעיף 4).
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

create table if not exists public.improvement_suggestions (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  agency_id   uuid references public.agencies(id) on delete set null,
  body        text not null,
  screen      text,
  status      text not null default 'new',
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'improvement_suggestions_body_len') then
    alter table public.improvement_suggestions
      add constraint improvement_suggestions_body_len check (char_length(btrim(body)) between 3 and 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'improvement_suggestions_screen_len') then
    alter table public.improvement_suggestions
      add constraint improvement_suggestions_screen_len check (screen is null or char_length(screen) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'improvement_suggestions_status_chk') then
    alter table public.improvement_suggestions
      add constraint improvement_suggestions_status_chk check (status in ('new', 'done'));
  end if;
end $$;

create index if not exists improvement_suggestions_created_idx
  on public.improvement_suggestions (created_at desc);
create index if not exists improvement_suggestions_agent_idx
  on public.improvement_suggestions (agent_id, created_at desc);

comment on table public.improvement_suggestions is
  'הצעות לשיפור שסוכנים שולחים מהכפתור בתפריט ה-CRM. docs/improvement-suggestions.md';

alter table public.improvement_suggestions enable row level security;

drop policy if exists improvement_suggestions_insert_own on public.improvement_suggestions;
create policy improvement_suggestions_insert_own on public.improvement_suggestions
  for insert to authenticated
  with check (agent_id = public.current_agent_id() and status = 'new' and handled_at is null);

drop policy if exists improvement_suggestions_select on public.improvement_suggestions;
create policy improvement_suggestions_select on public.improvement_suggestions
  for select to authenticated
  using (agent_id = public.current_agent_id() or public.current_is_platform_admin());

drop policy if exists improvement_suggestions_update_admin on public.improvement_suggestions;
create policy improvement_suggestions_update_admin on public.improvement_suggestions
  for update to authenticated
  using (public.current_is_platform_admin())
  with check (public.current_is_platform_admin());

revoke all on table public.improvement_suggestions from anon;
grant select, insert, update on table public.improvement_suggestions to authenticated;
grant select, insert, update, delete on table public.improvement_suggestions to service_role;

-- ---------------------------------------------------------------------------
-- לפני הכתיבה: המשרד נקבע מהשורה של הסוכן/ת (לא מהדפדפן), והתקרה נבדקת
-- ---------------------------------------------------------------------------
create or replace function public.improvement_suggestion_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.agency_id into new.agency_id
    from public.agency_members m where m.id = new.agent_id;
  new.body := btrim(new.body);
  if (select count(*) from public.improvement_suggestions s
       where s.agent_id = new.agent_id and s.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_suggestions' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.improvement_suggestion_before() from public, anon, authenticated;

drop trigger if exists improvement_suggestion_before on public.improvement_suggestions;
create trigger improvement_suggestion_before
  before insert on public.improvement_suggestions
  for each row execute function public.improvement_suggestion_before();

-- ---------------------------------------------------------------------------
-- אחרי הכתיבה: התראה לכל מנהל/ת פלטפורמה. בלי מזהה פריט - היעד הוא הרשימה
-- (ACC_BY_TYPE ב-notification-push ו-NOTIF_TYPES ב-crm.js: accSuggestions)
-- ---------------------------------------------------------------------------
select public.notification_types_add(array['improvement_suggestion']);

create or replace function public.improvement_suggestion_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select coalesce(nullif(btrim(m.display_name), ''), 'סוכן/ת') into v_name
    from public.agency_members m where m.id = new.agent_id;
  insert into public.notifications (agent_id, type, title, body)
  select a.id, 'improvement_suggestion',
         'הצעה לשיפור מ' || coalesce(v_name, 'סוכן/ת'),
         left(coalesce(new.screen || ': ', '') || new.body, 300)
    from public.agency_members a
   where a.is_platform_admin
     and a.id <> new.agent_id;
  return new;
end $$;

revoke all on function public.improvement_suggestion_notify() from public, anon, authenticated;

drop trigger if exists improvement_suggestion_notify on public.improvement_suggestions;
create trigger improvement_suggestion_notify
  after insert on public.improvement_suggestions
  for each row execute function public.improvement_suggestion_notify();
