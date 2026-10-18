-- ===========================================================================
-- סביבת ההטמעה (CSM): הצנרת, פגישת "הצלחה ראשונה", משוב ותעדוף, וסיפורי הצלחה
-- ---------------------------------------------------------------------------
-- מנהלת ההטמעה מלווה כל סוכן/ת בפיילוט מההרשמה ועד שימוש עצמאי. עד היום לא
-- היה לזה מקום: השיחות, מה בוצע בפגישה, היעד לשבוע והבקשות לפיתוח ישבו
-- במחברת ובוואטסאפ, ולא היה דרך לראות מי נשאר/ה מאחור.
--
-- מה בקובץ (docs/csm-adoption.md):
--   1. ‏csm_agent_stage: שלב בצנרת לכל סוכן/ת (שש עמודות בקנבן), מועד הקשר
--      הבא והערה. שורה נכתבת רק כשמזיזים; בלי שורה = "נרשם/ה".
--   2. ‏csm_sessions: פגישת ההדרכה הראשונה (ופגישות המשך) - שאלון האבחון,
--      הצ'ק-ליסט של "הצלחה ראשונה", המשוב בסיום, היעד השבועי והערות פיתוח.
--   3. ‏csm_feedback + csm_feedback_votes: בקשות פיתוח וחיכוכים. כל סוכן/ת
--      שמבקש/ת את אותו דבר מצטרף/ת כהצבעה לשורה הקיימת, וזה המונה "ביקשו 3".
--   4. ‏csm_success_stories: ציטוט, מדד ו"לפני/אחרי", עם הסכמה לפרסום.
--   5. ‏csm_agents_overview(): שורה לכל סוכן/ת עם האותות מהמציאות - הודעה
--      אחרונה לגבריאלה, הודעות בשבוע, נכסים פעילים, לקוחות, פוסט, משימות
--      פתוחות - כדי שהקנבן וציון הבריאות לא יהיו עוד דבר שמסמנים ביד.
--
-- הכל למנהל/ת פלטפורמה בלבד (current_is_platform_admin). המידע כאן הוא
-- הערות פנימיות על סוכנים, ואין לו קורא/ת אחר/ת.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. השלב בצנרת
-- ---------------------------------------------------------------------------
create table if not exists public.csm_agent_stage (
  agent_id          uuid primary key references public.agency_members(id) on delete cascade,
  stage             text not null default 'registered'
                    check (stage in ('registered','call_scheduled','onboarded','active_pilot','champion','at_risk')),
  next_followup_at  timestamptz,
  notes             text check (notes is null or char_length(notes) <= 2000),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null
);

comment on table public.csm_agent_stage is
  'השלב של סוכן/ת בצנרת ההטמעה. בלי שורה = registered. docs/csm-adoption.md';

-- ---------------------------------------------------------------------------
-- 2. הפגישה
-- ---------------------------------------------------------------------------
create table if not exists public.csm_sessions (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.agency_members(id) on delete cascade,
  kind            text not null default 'first_win' check (kind in ('first_win','followup')),
  held_at         timestamptz not null default now(),
  -- חלק 1: ניסיון, מבנה, כלים, נכסים בשיווק, נקודת הכאב. המפתחות ב-CSM_DIAG
  -- ב-assets/crm-csm.js; jsonb כדי ששאלה חדשה לא תדרוש מיגרציה.
  diagnostic      jsonb not null default '{}'::jsonb,
  -- new | veteran | office, נגזר מהאבחון ונשמר כפי שנקבע בפגישה
  track           text check (track is null or track in ('new','veteran','office')),
  -- חלק 2: property, client, match, post, reminder → true/false
  first_win       jsonb not null default '{}'::jsonb,
  -- חלק 4
  clarity         smallint check (clarity is null or clarity between 1 and 5),
  time_saving     smallint check (time_saving is null or time_saving between 1 and 5),
  weekly_goal     text check (weekly_goal is null or char_length(weekly_goal) <= 300),
  followup_at     timestamptz,
  dev_notes       text check (dev_notes is null or char_length(dev_notes) <= 4000),
  notes           text check (notes is null or char_length(notes) <= 4000),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists csm_sessions_agent_idx on public.csm_sessions (agent_id, held_at desc);

comment on table public.csm_sessions is
  'פגישת הדרכה עם סוכן/ת: אבחון, צ''ק-ליסט הצלחה ראשונה, משוב ויעד שבועי. docs/csm-adoption.md';

-- ---------------------------------------------------------------------------
-- 3. משוב ותעדוף
-- ---------------------------------------------------------------------------
create table if not exists public.csm_feedback (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 2 and 160),
  description  text check (description is null or char_length(description) <= 4000),
  category     text not null default 'daily_efficiency'
               check (category in ('pilot_blocker','daily_efficiency','office_management')),
  severity     text not null default 'usability'
               check (severity in ('blocker','usability','enhancement')),
  status       text not null default 'open'
               check (status in ('open','planned','in_progress','done','declined')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.csm_feedback_votes (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references public.csm_feedback(id) on delete cascade,
  agent_id     uuid not null references public.agency_members(id) on delete cascade,
  session_id   uuid references public.csm_sessions(id) on delete set null,
  sentiment    text check (sentiment is null or sentiment in ('positive','neutral','negative')),
  note         text check (note is null or char_length(note) <= 2000),
  created_at   timestamptz not null default now(),
  unique (feedback_id, agent_id)
);

create index if not exists csm_feedback_votes_feedback_idx on public.csm_feedback_votes (feedback_id);

comment on table public.csm_feedback_votes is
  'סוכן/ת שביקש/ה את הבקשה. מספר השורות לבקשה = "ביקשו N סוכנים". docs/csm-adoption.md';

-- ---------------------------------------------------------------------------
-- 4. סיפורי הצלחה
-- ---------------------------------------------------------------------------
create table if not exists public.csm_success_stories (
  id                   uuid primary key default gen_random_uuid(),
  agent_id             uuid not null references public.agency_members(id) on delete cascade,
  quote                text check (quote is null or char_length(quote) <= 1000),
  metrics              text check (metrics is null or char_length(metrics) <= 300),
  before_text          text check (before_text is null or char_length(before_text) <= 1000),
  after_text           text check (after_text is null or char_length(after_text) <= 1000),
  permission_to_share  boolean not null default false,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: מנהל/ת פלטפורמה בלבד, לכל ארבע הפעולות
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['csm_agent_stage','csm_sessions','csm_feedback','csm_feedback_votes','csm_success_stories']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'platform admin manages') then
      execute format(
        'create policy "platform admin manages" on public.%I for all to authenticated
           using (public.current_is_platform_admin()) with check (public.current_is_platform_admin())', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. הסקירה: שורה לכל סוכן/ת פעיל/ה
-- ---------------------------------------------------------------------------
-- ‏security definer כי האותות יושבים בטבלאות שה-RLS שלהן מחזיר לכל סוכן/ת
-- רק את שלו/ה (whatsapp_messages, agent_clients, agent_agenda_items). הבדיקה
-- בראש הפונקציה היא מה שמגביל אותה למנהל/ת הפלטפורמה.
-- ‏"in" ב-whatsapp_messages עם agent_id = הודעה שהסוכן/ת שלח/ה לגבריאלה.
drop function if exists public.csm_agents_overview();

create function public.csm_agents_overview()
returns table (
  agent_id          uuid,
  display_name      text,
  phone             text,
  agency_id         uuid,
  agency_name       text,
  role              text,
  tier              text,
  joined_at         timestamptz,
  license_ok        boolean,
  stage             text,
  stage_set         boolean,
  next_followup_at  timestamptz,
  stage_notes       text,
  last_gabriela_at  timestamptz,
  gabriela_7d       int,
  active_listings   int,
  clients           int,
  has_post          boolean,
  open_tasks        int,
  sessions          int,
  last_session_at   timestamptz,
  last_track        text,
  last_first_win    jsonb,
  last_clarity      smallint,
  last_time_saving  smallint,
  last_weekly_goal  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select m.id,
           m.display_name,
           coalesce(m.phone_e164, m.phone),
           m.agency_id,
           a.name,
           m.role,
           m.tier,
           m.created_at,
           public.agent_license_ok(m.license_number, m.license_status),
           coalesce(s.stage, 'registered'),
           s.agent_id is not null,
           s.next_followup_at,
           s.notes,
           w.last_in,
           coalesce(w.in_7d, 0),
           (select count(*)::int from public.properties p where p.agent_id = m.id and p.status = 'active'),
           (select count(*)::int from public.agent_clients c where c.agent_id = m.id),
           exists (select 1 from public.properties p where p.agent_id = m.id and p.post_text is not null),
           (select count(*)::int from public.agent_agenda_items g where g.agent_id = m.id and g.status = 'open'),
           coalesce(ss.n, 0),
           ss.last_at,
           ls.track,
           ls.first_win,
           ls.clarity,
           ls.time_saving,
           ls.weekly_goal
      from public.agency_members m
      left join public.agencies a on a.id = m.agency_id
      left join public.csm_agent_stage s on s.agent_id = m.id
      left join lateral (
        select max(x.created_at) as last_in,
               count(*) filter (where x.created_at > now() - interval '7 days')::int as in_7d
          from public.whatsapp_messages x
         where x.agent_id = m.id and x.direction = 'in'
           and x.created_at > now() - interval '120 days'
      ) w on true
      left join lateral (
        select count(*)::int as n, max(z.held_at) as last_at
          from public.csm_sessions z where z.agent_id = m.id
      ) ss on true
      left join lateral (
        select z.track, z.first_win, z.clarity, z.time_saving, z.weekly_goal
          from public.csm_sessions z where z.agent_id = m.id
         order by z.held_at desc limit 1
      ) ls on true
     where m.active = true
       and m.closed_at is null
       and coalesce(m.is_platform_admin, false) = false
     order by m.created_at desc;
end;
$$;

revoke all on function public.csm_agents_overview() from public, anon, authenticated;
grant execute on function public.csm_agents_overview() to authenticated;

comment on function public.csm_agents_overview() is
  'סביבת ההטמעה: שורה לכל סוכן/ת עם השלב והאותות מהמציאות (גבריאלה, נכסים, לקוחות). מנהל/ת פלטפורמה בלבד. docs/csm-adoption.md';
