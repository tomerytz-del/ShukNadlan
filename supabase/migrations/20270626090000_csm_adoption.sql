-- ===========================================================================
-- אזור ההטמעה (CSM): תפקיד חדש, הצנרת, פגישת "הצלחה ראשונה", משוב, הקלטות
-- ---------------------------------------------------------------------------
-- מנהלת ההדרכות וההטמעה מלווה כל סוכן/ת בפיילוט מההרשמה ועד שימוש עצמאי.
-- זה תפקיד חדש, **לא** סוכן/ת ולא מנהל/ת פלטפורמה: אזור נפרד (/csm), כניסה
-- עם Google, וגישה רק לכלי ההדרכה והמעקב - בלי ניהול הפלטפורמה, בלי משרד
-- ובלי נכסים או לידים משלה.
--
-- מה בקובץ (docs/csm-adoption.md):
--   0. ‏csm_staff: צוות ההטמעה - זהות נפרדת מ-agency_members. מנהל/ת הפלטפורמה
--      מזמין/ה לפי מייל (וטלפון, לגבריאלה); בכניסה הראשונה עם Google
--      ‏csm_claim() מחברת את החשבון לפי המייל המאומת. ‏current_is_csm() היא
--      ההרשאה לכל csm_*: צוות ההטמעה, ומנהל/ת הפלטפורמה שמפקח/ת.
--   1. ‏csm_agent_stage: שלב בצנרת לכל סוכן/ת, מועד הקשר הבא והערה.
--   2. ‏csm_sessions: פגישת ההדרכה - אבחון, צ'ק-ליסט, משוב, יעד והערות פיתוח.
--   3. ‏csm_feedback + csm_feedback_votes: בקשות פיתוח ו"ביקשו N".
--   4. ‏csm_success_stories: ציטוט, מדד ולפני/אחרי, עם הסכמה לפרסום.
--   5. ‏csm_agents_overview(): שורה לכל סוכן/ת עם פרטי קשר, השלב והשימוש.
--   6. ניהול הצוות בידי מנהל/ת הפלטפורמה: csm_staff_list / _save / _set_active.
--   7. ‏csm_calls ודלי csm-calls: הקלטת שיחה (מהאזור או מגבריאלה) → תמלול,
--      סיכום והמלצות (csm-workspace, ‏_shared/csm-call.ts).
--   8. ‏csm_mentor_questions: יומן מנטור ההטמעה; ‏csm_whatsapp_conversations:
--      ההיסטוריה של גבריאלה מול הצוות.
--
-- המיגרציה אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. צוות ההטמעה
-- ---------------------------------------------------------------------------
create table if not exists public.csm_staff (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users(id) on delete set null,
  email         text not null unique check (email = lower(btrim(email)) and email like '%_@_%'),
  display_name  text check (display_name is null or char_length(display_name) <= 120),
  phone         text check (phone is null or char_length(phone) <= 30),
  -- אותה נורמליזציה של agency_members.phone_e164: גבריאלה מזהה לפי from של Meta
  phone_e164    text generated always as (public.normalize_msisdn(phone)) stored,
  active        boolean not null default true,
  invited_by    uuid references auth.users(id) on delete set null,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists csm_staff_phone_idx on public.csm_staff (phone_e164) where phone_e164 is not null;

comment on table public.csm_staff is
  'צוות ההטמעה (מנהלות הדרכות והטמעה): זהות נפרדת מ-agency_members. נכתב רק בפונקציות csm_staff_*. docs/csm-adoption.md';

alter table public.csm_staff enable row level security;
revoke all on table public.csm_staff from anon;
drop policy if exists "csm staff reads own row" on public.csm_staff;
create policy "csm staff reads own row" on public.csm_staff for select to authenticated
  using (user_id = auth.uid() or public.current_is_platform_admin());

-- מי מחובר/ת מצוות ההטמעה (פעיל/ה). null = לא בצוות.
create or replace function public.current_csm_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.csm_staff s where s.user_id = auth.uid() and s.active limit 1;
$$;

revoke all on function public.current_csm_id() from public, anon, authenticated;
grant execute on function public.current_csm_id() to authenticated;

-- מי רואה את נתוני ההטמעה: הצוות, ומנהל/ת הפלטפורמה שמפקח/ת עליו
create or replace function public.current_is_csm()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_csm_id() is not null or public.current_is_platform_admin();
$$;

revoke all on function public.current_is_csm() from public, anon, authenticated;
grant execute on function public.current_is_csm() to authenticated;

comment on function public.current_is_csm() is
  'צוות ההטמעה או מנהל/ת פלטפורמה. ההרשאה לכל csm_*. docs/csm-adoption.md';

-- הכניסה הראשונה: חיבור החשבון להזמנה לפי המייל, ורק מייל שאומת (Google
-- מאמתת תמיד). מחזירה את השורה, או null למי שלא הוזמן/ה.
create or replace function public.csm_claim()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row   public.csm_staff%rowtype;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into v_row from public.csm_staff where user_id = auth.uid();
  if not found then
    select lower(btrim(u.email)) into v_email from auth.users u
     where u.id = auth.uid() and u.email_confirmed_at is not null;
    if v_email is null then
      return null;
    end if;
    update public.csm_staff
       set user_id = auth.uid(), claimed_at = now()
     where email = v_email and user_id is null
     returning * into v_row;
    if not found then
      return null;
    end if;
  end if;
  if not v_row.active then
    return jsonb_build_object('inactive', true);
  end if;
  return jsonb_build_object('id', v_row.id, 'display_name', v_row.display_name, 'email', v_row.email);
end;
$$;

revoke all on function public.csm_claim() from public, anon, authenticated;
grant execute on function public.csm_claim() to authenticated;

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
-- RLS: צוות ההטמעה ומנהל/ת פלטפורמה, לכל ארבע הפעולות
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['csm_agent_stage','csm_sessions','csm_feedback','csm_feedback_votes','csm_success_stories']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('drop policy if exists "csm team manages" on public.%I', t);
    execute format(
      'create policy "csm team manages" on public.%I for all to authenticated
         using (public.current_is_csm()) with check (public.current_is_csm())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. הסקירה: שורה לכל סוכן/ת פעיל/ה
-- ---------------------------------------------------------------------------
-- שני קוראים: הדפדפן (current_is_csm) ו-service_role - גבריאלה, מנטור ההטמעה
-- וניתוח השיחות, אחרי שזיהו את איש/אשת הצוות בעצמם. פונקציה אחת ולא core + עטיפה, כי
-- עטיפה צריכה לשכפל את רשימת העמודות.
--
-- ‏security definer כי האותות יושבים בטבלאות שה-RLS שלהן מחזיר לכל סוכן/ת רק
-- את שלו/ה (whatsapp_messages, agent_clients, agent_agenda_items), ו-auth.users.
-- ‏"in" ב-whatsapp_messages עם agent_id = הודעה שהסוכן/ת שלח/ה לגבריאלה.
-- ת.ז. אינה כאן, בכוונה: צוות ההטמעה צריך דרך לדבר עם הסוכן/ת, לא זיהוי.
drop function if exists public.csm_agents_overview();

create function public.csm_agents_overview()
returns table (
  agent_id          uuid,
  display_name      text,
  phone             text,
  email             text,
  agency_id         uuid,
  agency_name       text,
  agency_address    text,
  agency_city       text,
  role              text,
  tier              text,
  joined_at         timestamptz,
  last_login_at     timestamptz,
  license_ok        boolean,
  stage             text,
  stage_set         boolean,
  next_followup_at  timestamptz,
  stage_notes       text,
  last_gabriela_at  timestamptz,
  gabriela_7d       int,
  gabriela_30d      int,
  active_listings   int,
  listings_total    int,
  clients           int,
  has_post          boolean,
  open_tasks        int,
  mentor_30d        int,
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
  if not (public.current_is_csm() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
  select m.id,
         m.display_name,
         coalesce(m.phone_e164, m.phone),
         m.email,
         m.agency_id,
         a.name,
         a.address,
         c.name,
         m.role,
         m.tier,
         m.created_at,
         u.last_sign_in_at,
         public.agent_license_ok(m.license_number, m.license_status),
         coalesce(s.stage, 'registered'),
         s.agent_id is not null,
         s.next_followup_at,
         s.notes,
         w.last_in,
         coalesce(w.in_7d, 0),
         coalesce(w.in_30d, 0),
         coalesce(p.active, 0),
         coalesce(p.total, 0),
         (select count(*)::int from public.agent_clients ac where ac.agent_id = m.id),
         coalesce(p.has_post, false),
         (select count(*)::int from public.agent_agenda_items g where g.agent_id = m.id and g.status = 'open'),
         (select count(*)::int from public.coach_questions q
           where q.agent_id = m.id and q.created_at > now() - interval '30 days'),
         coalesce(ss.n, 0),
         ss.last_at,
         ls.track,
         ls.first_win,
         ls.clarity,
         ls.time_saving,
         ls.weekly_goal
    from public.agency_members m
    left join public.agencies a on a.id = m.agency_id
    left join public.cities c on c.id = a.city_id
    left join auth.users u on u.id = m.user_id
    left join public.csm_agent_stage s on s.agent_id = m.id
    left join lateral (
      select max(x.created_at) as last_in,
             count(*) filter (where x.created_at > now() - interval '7 days')::int as in_7d,
             count(*) filter (where x.created_at > now() - interval '30 days')::int as in_30d
        from public.whatsapp_messages x
       where x.agent_id = m.id and x.direction = 'in'
         and x.created_at > now() - interval '120 days'
    ) w on true
    left join lateral (
      select count(*) filter (where pr.status = 'active')::int as active,
             count(*)::int as total,
             bool_or(pr.post_text is not null) as has_post
        from public.properties pr where pr.agent_id = m.id
    ) p on true
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
grant execute on function public.csm_agents_overview() to authenticated, service_role;

comment on function public.csm_agents_overview() is
  'סביבת ההטמעה: שורה לכל סוכן/ת עם פרטי קשר, השלב והאותות מהמציאות. צוות ההטמעה, מנהל/ת פלטפורמה ו-service_role. docs/csm-adoption.md';

-- ---------------------------------------------------------------------------
-- 6. ניהול הצוות - מנהל/ת הפלטפורמה בלבד
-- ---------------------------------------------------------------------------
create or replace function public.csm_staff_list()
returns table (id uuid, email text, display_name text, phone text, active boolean, joined boolean, created_at timestamptz)
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
    select s.id, s.email, s.display_name, s.phone, s.active, s.user_id is not null, s.created_at
      from public.csm_staff s
     order by s.active desc, s.created_at;
end;
$$;

revoke all on function public.csm_staff_list() from public, anon, authenticated;
grant execute on function public.csm_staff_list() to authenticated;

-- הזמנה או עדכון לפי מייל. טלפון של סוכן/ת נדחה: גבריאלה מזהה סוכנים
-- קודם, ואז אשת הצוות הייתה מקבלת את העוזרת של הסוכנים ולא את שלה.
create or replace function public.csm_staff_save(p_email text, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_id    uuid;
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('error', 'invalid_email');
  end if;
  if v_phone is not null and exists (
      select 1 from public.agency_members m where m.phone_e164 = public.normalize_msisdn(v_phone)) then
    return jsonb_build_object('error', 'phone_is_agent');
  end if;
  insert into public.csm_staff (email, display_name, phone, invited_by)
  values (v_email, nullif(btrim(coalesce(p_name, '')), ''), v_phone, auth.uid())
  on conflict (email) do update
     set display_name = coalesce(excluded.display_name, public.csm_staff.display_name),
         phone = coalesce(excluded.phone, public.csm_staff.phone), active = true
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('error', 'phone_taken');
end;
$$;

revoke all on function public.csm_staff_save(text, text, text) from public, anon, authenticated;
grant execute on function public.csm_staff_save(text, text, text) to authenticated;

create or replace function public.csm_staff_set_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.csm_staff set active = p_active where id = p_id;
  return jsonb_build_object('success', found);
end;
$$;

revoke all on function public.csm_staff_set_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.csm_staff_set_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. הקלטות שיחה: תמלול, סיכום והמלצות
-- ---------------------------------------------------------------------------
-- ההקלטה עולה לדלי מהאזור (או נשמרת מגבריאלה), השורה נוצרת pending, ו-
-- csm-workspace (או גבריאלה) מתמללת ומנתחת ברקע ומעדכנת אותה. השיוך לסוכן/ת
-- לא חובה - שיחה עם מנהל/ת משרד לפני ההצטרפות גם היא שיחה.
create table if not exists public.csm_calls (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid default public.current_csm_id() references public.csm_staff(id) on delete set null,
  agent_id      uuid references public.agency_members(id) on delete set null,
  title         text check (title is null or char_length(title) <= 200),
  source        text not null default 'upload' check (source in ('upload', 'whatsapp')),
  audio_path    text,
  status        text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  error         text,
  transcript    text,
  analysis      jsonb,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists csm_calls_created_idx on public.csm_calls (created_at desc);

comment on table public.csm_calls is
  'הקלטות שיחה של צוות ההטמעה: תמלול, סיכום והמלצות (_shared/csm-call.ts). docs/csm-adoption.md';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('csm-calls', 'csm-calls', false, 26214400, null)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

-- העלאה וקריאה לצוות ההטמעה (ולמנהל/ת הפלטפורמה). מחיקה - דרך האזור.
drop policy if exists "csm uploads call recordings" on storage.objects;
create policy "csm uploads call recordings" on storage.objects for insert to authenticated
  with check (bucket_id = 'csm-calls' and public.current_is_csm());
drop policy if exists "csm reads call recordings" on storage.objects;
create policy "csm reads call recordings" on storage.objects for select to authenticated
  using (bucket_id = 'csm-calls' and public.current_is_csm());
drop policy if exists "csm deletes call recordings" on storage.objects;
create policy "csm deletes call recordings" on storage.objects for delete to authenticated
  using (bucket_id = 'csm-calls' and public.current_is_csm());

-- ---------------------------------------------------------------------------
-- 8. מנטור ההטמעה וגבריאלה מול הצוות
-- ---------------------------------------------------------------------------
create table if not exists public.csm_mentor_questions (
  id                  uuid primary key default gen_random_uuid(),
  staff_id            uuid not null references public.csm_staff(id) on delete cascade,
  channel             text not null default 'web' check (channel in ('web', 'whatsapp')),
  question            text not null check (char_length(question) between 1 and 300),
  answer              text,
  gap_topic           text check (gap_topic is null or char_length(gap_topic) <= 80),
  model               text,
  input_tokens        int,
  output_tokens       int,
  cache_read_tokens   int,
  cache_write_tokens  int,
  created_at          timestamptz not null default now()
);

create index if not exists csm_mentor_questions_staff_idx on public.csm_mentor_questions (staff_id, created_at desc);

-- ההיסטוריה של גבריאלה מול כל אשת צוות (טקסט בלבד, נגזם בקוד)
create table if not exists public.csm_whatsapp_conversations (
  staff_id    uuid primary key references public.csm_staff(id) on delete cascade,
  history     jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- RLS: היומן נקרא לצוות; השיחה בוואטסאפ - service_role בלבד (אין policy)
do $$
declare
  t text;
begin
  foreach t in array array['csm_calls','csm_mentor_questions','csm_whatsapp_conversations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

drop policy if exists "csm team manages" on public.csm_calls;
create policy "csm team manages" on public.csm_calls for all to authenticated
  using (public.current_is_csm()) with check (public.current_is_csm());
drop policy if exists "csm team reads mentor log" on public.csm_mentor_questions;
create policy "csm team reads mentor log" on public.csm_mentor_questions for select to authenticated
  using (public.current_is_csm());
