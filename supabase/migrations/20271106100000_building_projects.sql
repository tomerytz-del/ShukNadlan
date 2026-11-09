-- ============================================================================
-- חברה יזמית של פרויקט בנייה, מקושרת לנכס ולגבריאלה
--
-- סוכן/ת שואל/ת "מי בנה את הבניין ברחוב X" ומקבל/ת תשובה מהטבלה, עם המקור
-- ועם אמירה מפורשת כשהנתון לא אומת. כשמעלים נכס בבנייה חדשה או בפרויקט
-- ואין יזם ידוע לכתובת, גבריאלה שואלת פעם אחת, בכפתור, בלי לחסום את הקליטה.
-- "לא יודע" נשמר בלי לנחש שם.
--
-- ## מה לא קורה כאן
--
-- הדגל app_config.building_projects_enabled נולד false. כל עוד הוא כבוי
-- אין שאלה, אין תשובה מהטבלה, ודוח ה-CMA לא מקבל שורת יזם.
-- כתובת מקושרת רק בהתאמה מדויקת (עיר + רחוב ומספר בית, אחרי כיווץ רווחים).
-- אין קירוב של שם רחוב. יזם שכבר רשום לא נדרס בערך אחר: הסטטוס הופך
-- conflict והשם נשאר.
--
-- ## הפיילוט
--
-- שש שורות לרובע יזרעאל בעפולה, source_type = web, verification = unverified,
-- בלי כתובות. פרויקט שביעי לא נמצא בריפו ולא בתיעוד, ולא הומצא.
--   שהם וטופז - אבני דרך
--   עדן המושבה הקטנה - אלמוגים
--   אדרת העמק - רם אדרת
--   קדמת נופר - דר נופרים
--   נוף בראשית - משולם לוינשטין (שותפים: אגדים, קימה ברזילי)
--   פארק ATECH - קבוצת GRP (מסחרי, עתידי)
-- בלי כתובת אין קישור לנכס. הקישור ייווצר רק כשכתובת מדויקת תירשם על השורה.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'building_project_source') then
    create type public.building_project_source as enum ('web', 'agent', 'municipality', 'manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'building_project_verification') then
    create type public.building_project_verification as enum ('unverified', 'verified', 'conflict');
  end if;
end $$;

create table if not exists public.building_projects (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  city                 text,
  neighborhood         text,
  developer_company    text,
  partners             text[] not null default '{}',
  source_type          public.building_project_source not null default 'manual',
  source_note          text,
  verification_status  public.building_project_verification not null default 'unverified',
  addresses            text[] not null default '{}',
  -- uuid של auth.users, בלי FK: ההחלה המקומית ב-CI משחזרת את public בלי
  -- auth.users, ומפתח זר חדש אליו מפיל את ה-job (relation "auth.users" does not exist).
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.building_projects is
  'פרויקט בנייה והחברה היזמית שלו. נכתב רק מהשרת. קריאה לסוכנים מחוברים. docs/building-projects.md';
comment on column public.building_projects.addresses is
  'כתובות מדויקות (רחוב ומספר בית) אחרי building_address_key. קישור לנכס רק בהתאמה מלאה.';
comment on column public.building_projects.verification_status is
  'unverified: לא אומת. verified: אומת. conflict: הגיע ערך סותר והשם הקיים לא הוחלף.';
comment on column public.building_projects.created_by is
  'מזהה המשתמש מ-agency_members.user_id. בלי מפתח זר ל-auth.users, כי ההחלה המקומית ב-CI אינה משחזרת את הסכימה הזו.';

create unique index if not exists building_projects_city_name_key
  on public.building_projects (city, name);
create index if not exists building_projects_addresses_idx
  on public.building_projects using gin (addresses);

drop trigger if exists building_projects_set_updated_at on public.building_projects;
create trigger building_projects_set_updated_at
  before update on public.building_projects
  for each row execute function public.set_updated_at();

alter table public.building_projects enable row level security;
revoke all on table public.building_projects from public, anon, authenticated;
grant select on table public.building_projects to authenticated;
grant select, insert, update, delete on table public.building_projects to service_role;

drop policy if exists building_projects_select_broker on public.building_projects;
create policy building_projects_select_broker
  on public.building_projects
  for select
  to authenticated
  using (public.current_agent_id() is not null);

alter table public.properties
  add column if not exists building_project_id uuid references public.building_projects(id) on delete set null;

comment on column public.properties.building_project_id is
  'פרויקט הבנייה של הכתובת. נקבע רק בהתאמת כתובת מדויקת, לא בניחוש.';

create index if not exists properties_building_project_id_idx
  on public.properties (building_project_id);

create table if not exists public.building_developer_prompts (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties(id) on delete cascade,
  agent_id             uuid not null references public.agency_members(id) on delete cascade,
  building_project_id  uuid references public.building_projects(id) on delete set null,
  city_key             text not null,
  address_key          text not null,
  address_label        text,
  status               text not null default 'pending'
                       check (status in ('pending', 'claimed', 'sent', 'failed', 'answered', 'unknown')),
  created_at           timestamptz not null default now(),
  claimed_at           timestamptz,
  sent_at              timestamptz,
  answered_at          timestamptz
);

create unique index if not exists building_developer_prompts_address_key
  on public.building_developer_prompts (city_key, address_key);
create index if not exists building_developer_prompts_open_idx
  on public.building_developer_prompts (created_at)
  where status in ('pending', 'claimed');

comment on table public.building_developer_prompts is
  'שאלה אחת לגבריאלה על החברה היזמית של בניין. שורה אחת לכתובת. claimed הוא תפיסה לפני השליחה. sent רק אחרי שמטא קיבלה. claimed ישן מ-15 דקות נתפס שוב.';

alter table public.building_developer_prompts enable row level security;
revoke all on table public.building_developer_prompts from public, anon, authenticated;
grant select, insert, update, delete on table public.building_developer_prompts to service_role;

insert into public.app_config (key, value, description) values
  ('building_projects_enabled', 'false',
   'true: מעקב חברה יזמית, שאלה לגבריאלה על פרויקט חדש, תשובה למי בנה, ושורה בדוח CMA. false: הכל כבוי.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- מפתח כתובת. רווחים בלבד. בלי קירוב שם רחוב.
-- ---------------------------------------------------------------------------
create or replace function public.building_address_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g'), '');
$$;

comment on function public.building_address_key(text) is
  'מפתח כתובת מדויק: רווחים מכווצים. לא מנרמל שם רחוב ולא מוחק מספר בית.';

revoke all on function public.building_address_key(text) from public, anon, authenticated;
grant execute on function public.building_address_key(text) to service_role;

create or replace function public.building_property_address_key(
  p_street text, p_house text, p_address text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.building_address_key(coalesce(
    nullif(btrim(concat_ws(' ', nullif(btrim(p_street), ''), nullif(btrim(p_house), ''))), ''),
    p_address));
$$;

revoke all on function public.building_property_address_key(text, text, text) from public, anon, authenticated;
grant execute on function public.building_property_address_key(text, text, text) to service_role;

create or replace function public.building_projects_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select lower(btrim(c.value)) in ('1', 'true', 'on', 'yes')
      from public.app_config c
     where c.key = 'building_projects_enabled'
  ), false);
$$;

comment on function public.building_projects_enabled() is
  'הדגל building_projects_enabled. חסר או כל ערך שאינו 1/true/on/yes = כבוי.';

revoke all on function public.building_projects_enabled() from public, anon, authenticated;
grant execute on function public.building_projects_enabled() to service_role;

-- פרויקט יחיד שהכתובת המדויקת רשומה אצלו. אפס או כמה: null, בלי לבחור.
create or replace function public.building_project_id_for_address(
  p_city text,
  p_address text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := public.building_address_key(p_address);
  v_id uuid;
  v_n int;
begin
  if v_key is null or v_key !~ '[0-9]' or nullif(btrim(coalesce(p_city, '')), '') is null then
    return null;
  end if;
  select count(*), (array_agg(b.id))[1]
    into v_n, v_id
    from public.building_projects b
   where public.city_name_key(b.city) = public.city_name_key(p_city)
     and exists (
       select 1 from unnest(b.addresses) a
        where public.building_address_key(a) = v_key
     );
  if v_n = 1 then
    return v_id;
  end if;
  return null;
end;
$$;

revoke all on function public.building_project_id_for_address(text, text) from public, anon, authenticated;
grant execute on function public.building_project_id_for_address(text, text) to service_role;

-- שם קיים לא מוחלף בשם אחר. אותו שם לא משנה סטטוס מאומת.
-- "לא יודע" אינו שם חברה.
create or replace function public.building_project_apply_developer(
  p_id uuid,
  p_company text,
  p_source public.building_project_source,
  p_note text,
  p_partners text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.building_projects;
  v_next text := nullif(regexp_replace(btrim(coalesce(p_company, '')), '[[:space:]]+', ' ', 'g'), '');
  v_cur text;
  v_extra text;
begin
  if v_next is not null then
    v_next := nullif(regexp_replace(v_next, '[?.!]+$', ''), '');
  end if;
  if v_next is null
     or v_next in ('לא יודע', 'לא יודעת', 'לא ידוע', 'אין לי מושג', 'לא מכיר', 'לא מכירה') then
    return 'ignored';
  end if;

  select * into v_row from public.building_projects where id = p_id for update;
  if not found then
    return 'ignored';
  end if;

  v_cur := nullif(regexp_replace(btrim(coalesce(v_row.developer_company, '')), '[[:space:]]+', ' ', 'g'), '');
  if v_cur is null then
    update public.building_projects
       set developer_company = v_next,
           source_type = p_source,
           source_note = coalesce(p_note, source_note),
           verification_status = case
             when verification_status = 'conflict' then 'conflict'::public.building_project_verification
             else 'unverified'::public.building_project_verification
           end,
           partners = case
             when cardinality(partners) > 0 then partners
             else coalesce(p_partners, '{}'::text[])
           end
     where id = p_id;
    return 'set';
  end if;

  if v_cur = v_next then
    update public.building_projects
       set partners = case
             when cardinality(partners) > 0 then partners
             else coalesce(p_partners, partners)
           end
     where id = p_id
       and cardinality(partners) = 0
       and coalesce(cardinality(p_partners), 0) > 0;
    return 'same';
  end if;

  v_extra := 'התנגשות: ' || v_next || ' (' || p_source::text || ')';
  update public.building_projects
     set verification_status = 'conflict',
         source_note = case
           when source_note is null or btrim(source_note) = '' then v_extra
           when position(v_extra in source_note) > 0 then source_note
           else source_note || ' ' || v_extra
         end
   where id = p_id;
  return 'conflict';
end;
$$;

comment on function public.building_project_apply_developer(uuid, text, public.building_project_source, text, text[]) is
  'רושם חברה יזמית. ערך סותר לא דורס את השם: verification_status הופך conflict. לא יודע = ignored.';

revoke all on function public.building_project_apply_developer(uuid, text, public.building_project_source, text, text[]) from public, anon, authenticated;
grant execute on function public.building_project_apply_developer(uuid, text, public.building_project_source, text, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- קישור נכס. רק התאמה מדויקת אחת. שינוי כתובת בלי התאמה מנתק קישור ישן.
-- ---------------------------------------------------------------------------
create or replace function public.properties_link_building_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_old text;
  v_id uuid;
begin
  v_key := public.building_property_address_key(new.street, new.house_number, new.address);
  v_id := public.building_project_id_for_address(new.city, v_key);
  if v_id is not null then
    new.building_project_id := v_id;
  elsif tg_op = 'UPDATE' and new.building_project_id is not null then
    v_old := public.building_property_address_key(old.street, old.house_number, old.address);
    if v_old is distinct from v_key then
      new.building_project_id := null;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'building project link skipped: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.properties_link_building_project() from public, anon, authenticated;
grant execute on function public.properties_link_building_project() to service_role;

drop trigger if exists properties_building_project_link on public.properties;
create trigger properties_building_project_link
  before insert or update of street, house_number, address, city
  on public.properties
  for each row execute function public.properties_link_building_project();

-- ---------------------------------------------------------------------------
-- שאלה אחת לכתובת, רק כשהדגל דלוק ואין חברה רשומה.
-- ---------------------------------------------------------------------------
create or replace function public.building_developer_prompt_enqueue(p_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.properties;
  v_key text;
  v_city text;
  v_project uuid;
  v_company text;
  v_id uuid;
begin
  if not public.building_projects_enabled() then
    return null;
  end if;
  select * into p from public.properties where id = p_property_id;
  if not found or p.agent_id is null then
    return null;
  end if;
  if p.condition is distinct from 'new_from_contractor'
     and p.condition is distinct from 'new'
     and coalesce(btrim(p.project_status), '') not in
       ('planning', 'permit_requested', 'permit_issued', 'construction_complete') then
    return null;
  end if;
  v_key := public.building_property_address_key(p.street, p.house_number, p.address);
  if v_key is null or v_key !~ '[0-9]' or nullif(btrim(coalesce(p.city, '')), '') is null then
    return null;
  end if;
  v_city := public.city_name_key(p.city);
  v_project := coalesce(p.building_project_id, public.building_project_id_for_address(p.city, v_key));
  if v_project is not null then
    select nullif(btrim(developer_company), '') into v_company
      from public.building_projects where id = v_project;
    if v_company is not null then
      return null;
    end if;
  end if;
  insert into public.building_developer_prompts (
    property_id, agent_id, building_project_id, city_key, address_key, address_label
  ) values (
    p.id, p.agent_id, v_project, v_city, v_key,
    btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', nullif(btrim(p.street), ''), nullif(btrim(p.house_number), ''))), ''),
      nullif(btrim(p.city), '')))
  )
  on conflict (city_key, address_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.building_developer_prompt_enqueue(uuid) from public, anon, authenticated;
grant execute on function public.building_developer_prompt_enqueue(uuid) to service_role;

create or replace function public.properties_enqueue_building_developer_ask()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.building_developer_prompt_enqueue(new.id);
  return new;
exception when others then
  raise warning 'building developer ask skipped: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.properties_enqueue_building_developer_ask() from public, anon, authenticated;
grant execute on function public.properties_enqueue_building_developer_ask() to service_role;

drop trigger if exists properties_building_developer_ask on public.properties;
create trigger properties_building_developer_ask
  after insert or update of condition, project_status, street, house_number, address, city
  on public.properties
  for each row execute function public.properties_enqueue_building_developer_ask();

-- pending, או claimed שנשאר בלי שליחה יותר מ-15 דקות. claimed טרי אינו נתפס שוב.
create or replace function public.building_developer_prompt_claimable(
  p_status text,
  p_claimed_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'pending'
      or (p_status = 'claimed'
          and p_claimed_at is not null
          and p_claimed_at < pg_catalog.now() - interval '15 minutes');
$$;

comment on function public.building_developer_prompt_claimable(text, timestamptz) is
  'אפשר לתפוס שאלה: pending, או claimed ישן מ-15 דקות. claimed טרי, sent ו-failed לא.';

revoke all on function public.building_developer_prompt_claimable(text, timestamptz) from public, anon, authenticated;
grant execute on function public.building_developer_prompt_claimable(text, timestamptz) to service_role;

-- תופס לשליחה. sent נכתב רק ב-building_developer_prompt_delivered, אחרי שמטא קיבלה.
create or replace function public.building_developer_prompt_take(
  p_property_id uuid,
  p_deliver boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.properties;
  v_key text;
  v_city text;
  v_prompt public.building_developer_prompts;
begin
  if not public.building_projects_enabled() then
    return jsonb_build_object('send', false, 'reason', 'disabled');
  end if;
  select * into p from public.properties where id = p_property_id;
  if not found then
    return jsonb_build_object('send', false, 'reason', 'missing');
  end if;
  v_key := public.building_property_address_key(p.street, p.house_number, p.address);
  v_city := public.city_name_key(p.city);
  select * into v_prompt
    from public.building_developer_prompts pr
   where pr.city_key = v_city and pr.address_key = v_key;
  if not found
     or not public.building_developer_prompt_claimable(v_prompt.status, v_prompt.claimed_at)
     or v_prompt.agent_id is distinct from p.agent_id then
    return jsonb_build_object('send', false, 'reason', 'not_pending');
  end if;
  if not coalesce(p_deliver, false) then
    return jsonb_build_object('send', false, 'reason', 'no_channel');
  end if;
  if not public.notification_send_window_open(now()) then
    return jsonb_build_object('send', false, 'deferred', true, 'reason', 'quiet_hours');
  end if;
  if not exists (
    select 1 from public.whatsapp_conversations c
     where c.agent_id = v_prompt.agent_id
       and c.last_message_at > now() - interval '23 hours'
  ) then
    return jsonb_build_object('send', false, 'deferred', true, 'reason', 'outside_24h');
  end if;
  update public.building_developer_prompts
     set status = 'claimed', claimed_at = now()
   where id = v_prompt.id
     and public.building_developer_prompt_claimable(status, claimed_at);
  if not found then
    return jsonb_build_object('send', false, 'reason', 'raced');
  end if;
  return jsonb_build_object(
    'send', true,
    'prompt_id', v_prompt.id,
    'address_label', v_prompt.address_label);
end;
$$;

revoke all on function public.building_developer_prompt_take(uuid, boolean) from public, anon, authenticated;
grant execute on function public.building_developer_prompt_take(uuid, boolean) to service_role;

create or replace function public.building_developer_prompts_claim(p_limit int default 20)
returns table (
  prompt_id uuid,
  agent_id uuid,
  wa_phone text,
  address_label text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if not public.building_projects_enabled() or not public.notification_send_window_open(now()) then
    return;
  end if;
  return query
  with due as (
    select pr.id
      from public.building_developer_prompts pr
      join public.whatsapp_conversations c on c.agent_id = pr.agent_id
     where public.building_developer_prompt_claimable(pr.status, pr.claimed_at)
       and c.last_message_at > now() - interval '23 hours'
     order by pr.created_at
     limit v_cap
     for update of pr skip locked
  ),
  upd as (
    update public.building_developer_prompts pr
       set status = 'claimed', claimed_at = now()
      from due
     where pr.id = due.id
       and public.building_developer_prompt_claimable(pr.status, pr.claimed_at)
    returning pr.id, pr.agent_id, pr.address_label
  )
  select upd.id, upd.agent_id, c.wa_phone, upd.address_label
    from upd
    join public.whatsapp_conversations c on c.agent_id = upd.agent_id;
end;
$$;

comment on function public.building_developer_prompts_claim(int) is
  'תופס שאלות יזם ל-claimed. sent נכתב רק אחרי השליחה. claimed טרי לא נתפס שוב. claimed ישן מ-15 דקות כן. הדגל הכבוי מחזיר אפס שורות.';

revoke all on function public.building_developer_prompts_claim(int) from public, anon, authenticated;
grant execute on function public.building_developer_prompts_claim(int) to service_role;

-- sent רק אחרי שמטא החזירה מזהה הודעה. claimed טרי לא חוזר ל-pending.
create or replace function public.building_developer_prompt_delivered(p_prompt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.building_developer_prompts
     set status = 'sent', sent_at = now()
   where id = p_prompt_id and status = 'claimed';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.building_developer_prompt_delivered(uuid) is
  'מסמן שהשאלה נמסרה. רק מ-claimed. כשל שליחה משאיר claimed עד ש-15 הדקות יעברו.';

revoke all on function public.building_developer_prompt_delivered(uuid) from public, anon, authenticated;
grant execute on function public.building_developer_prompt_delivered(uuid) to service_role;

create or replace function public.building_developer_prompt_unknown(
  p_prompt_id uuid,
  p_agent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.building_developer_prompts
     set status = 'unknown', answered_at = coalesce(answered_at, now())
   where id = p_prompt_id
     and agent_id = p_agent_id
     and status in ('pending', 'claimed', 'sent', 'unknown');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'unknown', true, 'stored', false);
end;
$$;

revoke all on function public.building_developer_prompt_unknown(uuid, uuid) from public, anon, authenticated;
grant execute on function public.building_developer_prompt_unknown(uuid, uuid) to service_role;

create or replace function public.building_developer_record(
  p_agent_id uuid,
  p_property_id uuid,
  p_company text,
  p_partners text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.properties;
  v_key text;
  v_company text := nullif(regexp_replace(btrim(coalesce(p_company, '')), '[[:space:]]+', ' ', 'g'), '');
  v_project uuid;
  v_action text;
  v_hood text;
  v_user uuid;
  v_label text;
begin
  if not public.building_projects_enabled() then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select * into p from public.properties where id = p_property_id and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  v_key := public.building_property_address_key(p.street, p.house_number, p.address);
  if v_key is null or v_key !~ '[0-9]' then
    return jsonb_build_object('ok', false, 'reason', 'address_required');
  end if;
  if v_company is not null then
    v_company := nullif(regexp_replace(v_company, '[?.!]+$', ''), '');
  end if;
  if v_company is null or char_length(v_company) > 80
     or v_company in ('לא יודע', 'לא יודעת', 'לא ידוע', 'אין לי מושג', 'לא מכיר', 'לא מכירה') then
    update public.building_developer_prompts
       set status = 'unknown', answered_at = coalesce(answered_at, now())
     where city_key = public.city_name_key(p.city)
       and address_key = v_key
       and agent_id = p_agent_id
       and status in ('pending', 'claimed', 'sent');
    return jsonb_build_object('ok', true, 'unknown', true, 'stored', false);
  end if;

  v_project := public.building_project_id_for_address(p.city, v_key);
  if v_project is null then
    select n.name into v_hood from public.neighborhoods n where n.id = p.neighborhood_id;
    select m.user_id into v_user from public.agency_members m where m.id = p_agent_id;
    v_label := 'בניין ' || v_key;
    begin
      insert into public.building_projects (
        name, city, neighborhood, developer_company, partners, source_type, source_note,
        verification_status, addresses, created_by
      ) values (
        v_label, nullif(btrim(p.city), ''), v_hood, v_company,
        coalesce(p_partners, '{}'::text[]), 'agent',
        'נמסר על ידי סוכן או סוכנת. לא אומת.',
        'unverified', array[v_key], v_user
      )
      returning id into v_project;
      v_action := 'set';
    exception when unique_violation then
      select id into v_project
        from public.building_projects
       where city = nullif(btrim(p.city), '') and name = v_label;
      if v_project is null then
        return jsonb_build_object('ok', false, 'reason', 'conflict_name');
      end if;
      v_action := public.building_project_apply_developer(
        v_project, v_company, 'agent',
        'נמסר על ידי סוכן או סוכנת. לא אומת.',
        p_partners);
    end;
  else
    v_action := public.building_project_apply_developer(
      v_project, v_company, 'agent',
      'נמסר על ידי סוכן או סוכנת. לא אומת.',
      p_partners);
  end if;

  update public.properties
     set building_project_id = v_project
   where id = p.id
     and (building_project_id is null or building_project_id = v_project);

  update public.building_developer_prompts
     set status = 'answered',
         answered_at = now(),
         building_project_id = v_project
   where city_key = public.city_name_key(p.city)
     and address_key = v_key
     and status in ('pending', 'claimed', 'sent');

  return jsonb_build_object('ok', true, 'action', v_action, 'stored', v_action in ('set', 'same', 'conflict'));
end;
$$;

comment on function public.building_developer_record(uuid, uuid, text, text[]) is
  'שומר את שם החברה שהסוכן/ת אמר/ה, unverified ומקור agent. לא דורס שם קיים סותר. לא יודע לא נרשם כחברה.';

revoke all on function public.building_developer_record(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.building_developer_record(uuid, uuid, text, text[]) to service_role;

create or replace function public.building_developer_lookup(
  p_city text,
  p_street text,
  p_house_number text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_n int;
  b public.building_projects;
begin
  if not public.building_projects_enabled() then
    return jsonb_build_object('ok', false, 'enabled', false, 'reason', 'disabled');
  end if;
  if nullif(btrim(coalesce(p_house_number, '')), '') is null then
    return jsonb_build_object('ok', false, 'house_number_required', true, 'found', false);
  end if;
  v_key := public.building_property_address_key(p_street, p_house_number, null);
  if v_key is null or v_key !~ '[0-9]' or nullif(btrim(coalesce(p_city, '')), '') is null then
    return jsonb_build_object('ok', false, 'house_number_required', true, 'found', false);
  end if;
  select count(*) into v_n
    from public.building_projects x
   where public.city_name_key(x.city) = public.city_name_key(p_city)
     and exists (
       select 1 from unnest(x.addresses) a
        where public.building_address_key(a) = v_key
     );
  if v_n > 1 then
    return jsonb_build_object('ok', true, 'found', false, 'ambiguous', true);
  end if;
  if v_n = 0 then
    return jsonb_build_object('ok', true, 'found', false);
  end if;
  select x.* into b
    from public.building_projects x
   where public.city_name_key(x.city) = public.city_name_key(p_city)
     and exists (
       select 1 from unnest(x.addresses) a
        where public.building_address_key(a) = v_key
     );
  if nullif(btrim(coalesce(b.developer_company, '')), '') is null then
    return jsonb_build_object('ok', true, 'found', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'found', true,
    'company', b.developer_company,
    'partners', to_jsonb(coalesce(b.partners, '{}'::text[])),
    'source', b.source_type,
    'source_label', case b.source_type
      when 'web' then 'אתר'
      when 'agent' then 'סוכן או סוכנת'
      when 'municipality' then 'רשות מקומית'
      when 'manual' then 'הזנה ידנית'
      else b.source_type::text
    end,
    'verification', b.verification_status,
    'project_name', b.name);
end;
$$;

comment on function public.building_developer_lookup(text, text, text) is
  'מי בנה את הבניין בכתובת מדויקת. בלי מספר בית לא מחזיר חברה. הדגל הכבוי מחזיר enabled false.';

revoke all on function public.building_developer_lookup(text, text, text) from public, anon, authenticated;
grant execute on function public.building_developer_lookup(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- דוח CMA: השורה מתווספת רק כשהדגל דלוק ויש חברה לכתובת המדויקת.
-- ---------------------------------------------------------------------------
create or replace function public.cma_attach_building_developer(p_report jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject jsonb;
  v_id uuid;
  v_city text;
  v_key text;
  v_project uuid;
  b public.building_projects;
  v_dev jsonb;
begin
  if p_report is null or p_report ? 'error' or not public.building_projects_enabled() then
    return p_report;
  end if;
  v_subject := p_report->'subject';
  if v_subject is null then
    return p_report;
  end if;
  if nullif(v_subject->>'id', '') is not null then
    select p.city,
           public.building_property_address_key(p.street, p.house_number, p.address),
           p.building_project_id
      into v_city, v_key, v_project
      from public.properties p
     where p.id = (v_subject->>'id')::uuid;
  else
    v_city := v_subject->>'city';
    v_key := public.building_property_address_key(
      v_subject->>'street', v_subject->>'house_number', v_subject->>'address');
    v_project := null;
  end if;
  if v_project is not null and v_key is not null then
    if not exists (
      select 1 from public.building_projects x
       where x.id = v_project
         and exists (
           select 1 from unnest(x.addresses) a
            where public.building_address_key(a) = v_key
         )
    ) then
      v_project := null;
    end if;
  end if;
  if v_project is null then
    v_project := public.building_project_id_for_address(v_city, v_key);
  end if;
  if v_project is null then
    return p_report;
  end if;
  select * into b from public.building_projects where id = v_project;
  if not found or nullif(btrim(coalesce(b.developer_company, '')), '') is null then
    return p_report;
  end if;
  v_dev := jsonb_build_object(
    'developer_company', b.developer_company,
    'developer_partners', to_jsonb(coalesce(b.partners, '{}'::text[])),
    'developer_source', b.source_type,
    'developer_source_label', case b.source_type
      when 'web' then 'אתר'
      when 'agent' then 'סוכן או סוכנת'
      when 'municipality' then 'רשות מקומית'
      when 'manual' then 'הזנה ידנית'
      else b.source_type::text
    end,
    'developer_verification', b.verification_status);
  return jsonb_set(p_report, '{subject}', v_subject || v_dev);
end;
$$;

comment on function public.cma_attach_building_developer(jsonb) is
  'מוסיף לדוח CMA חברה יזמית ומקור, רק כשהדגל דלוק והכתובת מדויקת. לא מוסיף מספר.';

revoke all on function public.cma_attach_building_developer(jsonb) from public, anon, authenticated;
grant execute on function public.cma_attach_building_developer(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- פיילוט רובע יזרעאל. on conflict do nothing: הרצה שנייה לא דורסת יזם.
-- פרויקט שביעי לא נמצא בריפו ולא בתיעוד.
-- ---------------------------------------------------------------------------
insert into public.building_projects (
  name, city, neighborhood, developer_company, partners, source_type, source_note,
  verification_status, addresses
) values
  ('שהם וטופז', 'עפולה', 'רובע יזרעאל', 'אבני דרך', '{}', 'web',
   'פיילוט רובע יזרעאל. מקור: אתר. לא אומת.', 'unverified', '{}'),
  ('עדן המושבה הקטנה', 'עפולה', 'רובע יזרעאל', 'אלמוגים', '{}', 'web',
   'פיילוט רובע יזרעאל. מקור: אתר. לא אומת.', 'unverified', '{}'),
  ('אדרת העמק', 'עפולה', 'רובע יזרעאל', 'רם אדרת', '{}', 'web',
   'פיילוט רובע יזרעאל. מקור: אתר. לא אומת.', 'unverified', '{}'),
  ('קדמת נופר', 'עפולה', 'רובע יזרעאל', 'דר נופרים', '{}', 'web',
   'פיילוט רובע יזרעאל. מקור: אתר. לא אומת.', 'unverified', '{}'),
  ('נוף בראשית', 'עפולה', 'רובע יזרעאל', 'משולם לוינשטין', array['אגדים', 'קימה ברזילי'], 'web',
   'פיילוט רובע יזרעאל. מקור: אתר. לא אומת.', 'unverified', '{}'),
  ('פארק ATECH', 'עפולה', 'רובע יזרעאל', 'קבוצת GRP', '{}', 'web',
   'פיילוט רובע יזרעאל. מסחרי, עתידי. מקור: אתר. לא אומת.', 'unverified', '{}')
on conflict (city, name) do nothing;

-- ---------------------------------------------------------------------------
-- התזמון. לא שולח כלום כל עוד הדגל כבוי: ה-HTTP לא יוצא.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook?task=building-developer-ask';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - שאלת החברה היזמית לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('building-developer-ask')
    where exists (select 1 from cron.job where jobname = 'building-developer-ask');
  perform cron.schedule('building-developer-ask', '*/10 * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 5000
    )
    where public.building_projects_enabled()
      and public.notification_send_window_open(now())
      and exists (
        select 1
          from public.building_developer_prompts pr
          join public.whatsapp_conversations c on c.agent_id = pr.agent_id
         where pr.status = 'pending'
           and c.last_message_at > now() - interval '23 hours'
      );
  $cron$, v_url));
end;
$$;


-- cma_report_finish מ-20270819090000, והחזרה עוברת ב-cma_attach_building_developer.
-- מיגרציה שמחליפה את הפונקציה הזו צריכה להשאיר את הקריאה, אחרת שורת היזם נעלמת מהדוח.
create or replace function public.cma_report_finish(
  p_r     jsonb,
  p_gush  text,
  p_helka text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_r        jsonb;
  v_as_of    timestamptz;
  v_loaded   boolean;
  v_min      integer;
  v_listed   integer;
  v_subject  jsonb := null;
  v_counts   jsonb;
  v_split    jsonb := null;
  v_p_n      integer;
  v_s_n      integer;
  v_size     numeric;
  v_range    jsonb := null;
  v_of       integer;
  -- הבניין של הנכס. נכס במערכת - מהמידע התכנוני; כתובת - מעסקאות שנרשמו בה
  v_gush     text := nullif(btrim(p_gush), '');
  v_helka    text := nullif(btrim(p_helka), '');
  v_psm      numeric;  -- המחיר המבוקש למ"ר של הנכס
begin
  v_r := p_r;

  select coalesce(max(value) filter (where key = 'cma_min_comparables'), 5),
         coalesce(max(value) filter (where key = 'cma_comparables_listed'), 8)
    into v_min, v_listed
    from public.pricing_config;

  -- ---- שכבת הבעלות (20270115091000, ללא שינוי) ----
  select l.source_modified into v_as_of
    from public.land_ownership_loads l
   where l.status = 'done'
   order by l.finished_at desc
   limit 1;
  -- ‏found ולא `v_as_of is null`: טעינה מ-source_url ידני מצליחה בלי תאריך.
  v_loaded := found;

  if v_loaded then
    select jsonb_build_object('ownership', o.ownership, 'mixed_units', o.mixed_units)
      into v_subject
      from public.land_ownership o
     where o.gush  = public.land_parcel_num(v_gush)
       and o.helka = public.land_parcel_num(v_helka);

    v_r := jsonb_set(v_r, '{comparables}',              public.cma_annotate_ownership(v_r->'comparables'));
    v_r := jsonb_set(v_r, '{neighborhood_comparables}', public.cma_annotate_ownership(v_r->'neighborhood_comparables'));
    v_r := jsonb_set(v_r, '{city_comparables}',         public.cma_annotate_ownership(v_r->'city_comparables'));

    -- על מה הממוצע נשען, לפי בעלות. רק עסקאות שנספרות ב-stats (‏in_stats),
    -- וכולן - **לפני** החיתוך למטה.
    select jsonb_build_object(
             'in_stats',  count(*),
             'private',   count(*) filter (where x->>'ownership' = 'P'),
             'state',     count(*) filter (where x->>'ownership' = 'S'),
             'local',     count(*) filter (where x->>'ownership' = 'L'),
             'other',     count(*) filter (where x->>'ownership' in ('M', 'O')),
             'unknown',   count(*) filter (where x->>'ownership' is null)),
           count(*) filter (where x->>'ownership' = 'P' and x->>'price_per_sqm' is not null),
           count(*) filter (where x->>'ownership' = 'S' and x->>'price_per_sqm' is not null)
      into v_counts, v_p_n, v_s_n
      from jsonb_array_elements(v_r->'comparables') x
     where (x->>'in_stats')::boolean;

    if v_p_n >= v_min and v_s_n >= v_min then
      select jsonb_build_object(
               'private_median_price_per_sqm', round(percentile_cont(0.5) within group (
                   order by (x->>'price_per_sqm')::numeric) filter (where x->>'ownership' = 'P')::numeric),
               'state_median_price_per_sqm',   round(percentile_cont(0.5) within group (
                   order by (x->>'price_per_sqm')::numeric) filter (where x->>'ownership' = 'S')::numeric),
               'private_sample', v_p_n,
               'state_sample',   v_s_n)
        into v_split
        from jsonb_array_elements(v_r->'comparables') x
       where (x->>'in_stats')::boolean
         and x->>'price_per_sqm' is not null;
    end if;
  end if;

  -- ---- 1. טווח השוק למ"ר ----
  --
  -- רק מעל הסף, כמו כל מספר אחר בדוח: רבעונים משלוש עסקאות הם רעש
  -- שנראה כמו טווח.
  if (v_r->'data_coverage'->>'has_statistics')::boolean then
    select case when count(*) >= v_min then jsonb_build_object(
             'p25_price_per_sqm',    round(percentile_cont(0.25) within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'median_price_per_sqm', round(percentile_cont(0.5)  within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'p75_price_per_sqm',    round(percentile_cont(0.75) within group (order by (x->>'price_per_sqm')::numeric)::numeric),
             'min_price_per_sqm',    min((x->>'price_per_sqm')::numeric),
             'max_price_per_sqm',    max((x->>'price_per_sqm')::numeric)) end
      into v_range
      from jsonb_array_elements(v_r->'comparables') x
     where (x->>'in_stats')::boolean
       and x->>'price_per_sqm' is not null;

    -- והאחוזון של הנכס בתוך הטווח: כמה מהעסקאות זולות ממנו למ"ר (שוויון
    -- נספר בחצי). זה המספר שהשעון בתצוגה מראה - "יקר מ-72% מהעסקאות
    -- הדומות" - ובאותו סף כמו הרבעונים.
    v_psm := nullif((v_r->'subject'->>'price_per_sqm')::numeric, 0);
    if v_range is not null and v_psm is not null then
      select v_range || jsonb_build_object('subject_percentile', round(100.0 *
               (count(*) filter (where (x->>'price_per_sqm')::numeric < v_psm)
                + 0.5 * count(*) filter (where (x->>'price_per_sqm')::numeric = v_psm))
               / count(*)))
        into v_range
        from jsonb_array_elements(v_r->'comparables') x
       where (x->>'in_stats')::boolean
         and x->>'price_per_sqm' is not null;
    end if;

    if v_range is not null then
      v_r := jsonb_set(v_r, '{stats}', (v_r->'stats') || v_range);
    end if;
  end if;

  -- ---- 2. העסקאות להצגה: הדומות ביותר, לא כולן ----
  --
  -- **ואותו בניין קודם.** אין במאגר שנת בנייה (0 מתוך 23 אלף), ולכן עסקה
  -- באותו גוש+חלקה היא הקירוב הטוב ביותר לגיל ולרמת הבנייה של הנכס: אותו
  -- בניין, אותו גיל, אותו מפרט. היא מסומנת `same_building` ומקבלת עדיפות
  -- שקולה ל-40% פער בשטח או ל-800 מ׳ - כלומר עסקה בבניין גוברת כמעט תמיד.
  v_size := nullif((v_r->'subject'->>'size_sqm')::numeric, 0);
  v_of   := jsonb_array_length(coalesce(v_r->'comparables', '[]'::jsonb));

  v_r := jsonb_set(v_r, '{comparables}', coalesce((
    select jsonb_agg(z.x || jsonb_build_object('similarity_rank', z.rn, 'same_building', z.same_building)
                     order by z.rn)
      from (
        select t.x, b.same_building,
               coalesce((t.x->>'in_stats')::boolean, false) as in_stats,
               bool_or(coalesce((t.x->>'in_stats')::boolean, false)) over () as any_in_stats,
               row_number() over (
                 order by
                   -- מה שנספר בממוצע קודם: הטבלה מראה על מה המספר נשען
                   case when coalesce((t.x->>'in_stats')::boolean, false) then 0 else 1 end,
                   -- שטח לא ידוע (של הנכס או של העסקה) = פער בינוני, לא אפס:
                   -- עסקה בלי שטח אינה "זהה בגודל"
                   coalesce(abs((t.x->>'size_sqm')::numeric - v_size) / v_size, 0.35)
                   + 0.5 * coalesce((t.x->>'distance_meters')::numeric, 1000) / 1000.0
                   + 0.4 * coalesce((current_date - (t.x->>'sold_at')::date), 365) / 365.0
                   - case when b.same_building then 0.4 else 0 end,
                   t.ord) as rn
          from jsonb_array_elements(coalesce(v_r->'comparables', '[]'::jsonb))
               with ordinality t(x, ord)
          cross join lateral (
            -- גוש וחלקה כמספרים (land_parcel_num), כמו בשכבת הבעלות:
            -- "016720" במאגר ו-"16720" במידע התכנוני הם אותה חלקה.
            select coalesce(v_gush is not null and exists (
                     select 1 from public.market_deals_official d
                      where d.id = nullif(t.x->>'id', '')::uuid
                        and public.land_parcel_num(d.gush)  = public.land_parcel_num(v_gush)
                        and public.land_parcel_num(d.helka) = public.land_parcel_num(v_helka)), false)
                   as same_building
          ) b
      ) z
     -- כשיש עסקאות שנספרות - רק הן. השלמה בעסקאות מסוג אחר הייתה ממלאת
     -- את הטבלה בשורות "סוג אחר" שהממוצע אינו נשען עליהן.
     where z.rn <= v_listed
       and (z.in_stats or not z.any_in_stats)), '[]'::jsonb));

  v_r := jsonb_set(v_r, '{data_coverage}', (v_r->'data_coverage') || jsonb_build_object(
    'comparables_listed',    jsonb_array_length(v_r->'comparables'),
    'comparables_listed_of', v_of));

  if not v_loaded then
    -- עוד לא נטען כלום: ownership: null אומר לתצוגה לשתוק.
    return public.cma_attach_building_developer(v_r || jsonb_build_object('ownership', null));
  end if;

  return public.cma_attach_building_developer(v_r || jsonb_build_object('ownership', jsonb_build_object(
    'as_of',        v_as_of,
    'subject',      v_subject,
    'counts',       v_counts,
    'split',        v_split,
    'min_required', v_min
  )));
end;
$$;


comment on function public.cma_report_finish(jsonb, text, text) is
  'השלב האחרון של דוח ה-CMA, ואחריו חברה יזמית כשהדגל דלוק ויש התאמת כתובת. docs/cma.md';

revoke all on function public.cma_report_finish(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cma_report_finish(jsonb, text, text) to service_role;
