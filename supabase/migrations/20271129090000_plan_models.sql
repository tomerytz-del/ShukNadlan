-- ============================================================================
-- דגם דירה תלת-ממדי: הטבלאות, המחיר והחיוב (שלב א', בלי ממשק ובלי Edge Function)
--
-- ## מה זה
--
-- סיור תלת-ממדי שנבנה מתוכנית דירה: המודל (קירות, חדרים, פתחים), הריהוט, הסגנון,
-- זוויות הצפייה ותבניות התאורה, והתמונות שנוצרות ממנו בהדמיה (Gemini). הצופה
-- הולך בו בדף הנכס או בדף הפרויקט. התכנון המלא: docs/plan-3d-tour.md.
--
-- ## מי משלם ומה
--
-- * **הסיור שייך לדגם דירה, לא לדירה.** בבניין של 12 דירות עם שתיים בקומה יש שני
--   דגמים, והיזם משלם פעמיים. כל הדירות מאותו דגם מציגות אותו סיור.
-- * **דגם מהופך מראה הוא דגם נוסף** ומחויב כרכישה חדשה. ההיפוך עצמו נעשה בשלב
--   הבא (אין SQL שהופך גיאומטריה), וכאן נרשם רק `mirrored_from`.
-- * ‏**₪49 לדגם, לפני מע"מ, מהארנק** (`plan_model_price`). הארנק עובד לפני מע"מ
--   (הסקיל wallet-charges), ולכן הפונקציה כאן אינה מוסיפה מע"מ.
-- * **סוכן/ת: מסלול Elite בלבד** (`premium`, פעיל, `billing_status = 'active'`),
--   כמו סיור 360. **יזם/משווק: בלי מסלול** - ארנק היזם, חשבון `developers` פעיל.
-- * **20 הדמיות כלולות לכל דגם** (`plan_model_included_renders`). המונה צמוד לדגם
--   ולא לדירה: דירות מאותו דגם חולקות אותו. ההדמיות עצמן בשלב ג'.
--
-- ## "מחייבים ואז קונים"
--
-- החיוב יורד ב-`start_plan_model`, באותה טרנזקציה שבה נוצר הדגם. קריאת מודל
-- הראייה על התוכנית (שלב ב') היא הספק החיצוני, וכישלון שלה מחזיר את הכסף ב-
-- `fail_plan_model` **לפי שורת החיוב** ולא לפי המחיר היום (המחיר ב-pricing_config
-- עלול להשתנות). ההחזר אידמפוטנטי. דגם שכבר `ready` אינו ניתן להחזר כאן.
--
-- ## למה אין insert מהדפדפן
--
-- רכישה היא ירידת כסף. הדפדפן אינו שולח מחיר ואינו יוצר שורה: `start_plan_model`
-- היא `service_role` בלבד (הפונקציה מקבלת מזהה בעלים, והרשאה ל-`authenticated`
-- הייתה מאפשרת לכל סוכן/ת לחייב ארנק של אחר/ת). ה-Edge Function של שלב ב' קוראת
-- לה אחרי שזיהתה את המשתמש/ת מה-JWT. `plan_model_quote` היא העטיפה לדפדפן: המזהה
-- נלקח מה-JWT, ועל כן אפשר לפתוח אותה ל-`authenticated`.
--
-- ## מה נעול
--
-- עמודות שקובעות כסף ובעלות (`owner_kind`, `agent_id`, `developer_id`, `status`,
-- `amount_charged`, `renders_*`, `project_id`, `source_plan_path`, `mirrored_from`)
-- ננעלות פעמיים. **הרשאת update היא לפי עמודות** (שם, מודל, הגדרות, זוויות, תאורה
-- ופרסום בלבד), כך שעמודה שתתווסף בשלבים הבאים נעולה כברירת מחדל ולא פתוחה עד
-- שמישהו ייזכר. והטריגר הוא הגיבוי (הסקיל new-migration, כלל 7): הוא גם חוסם עריכה
-- של דגם שאינו ready, כי complete_plan_model הייתה דורסת אותה.
--
-- ## מה לא נמחק
--
-- אין policy של `delete` לבעלים: דגם שנקנה אינו נמחק בלחיצה. הדף ממשיך להציג
-- סיור שפורסם גם כשהמסלול פג (כמו סיור 360), כי זה תוכן ששולם עליו.
--
-- ## עוד לא נעשה (שלבים הבאים)
--
-- ב': Edge Function שקוראת את התוכנית ובונה את המודל, והחזר אוטומטי לדגם תקוע
--     ב-draft/reading. ג': הדמיות Gemini (טבלת plan_model_renders). ד': הצופה
--     בדפי הנכס והפרויקט, העורך ב-CRM, וגבריאלה. ה': שורה ב-pricing.html וב-COMPARE.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המחיר וההדמיות הכלולות: pricing_config, לא קוד
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('plan_model_price', 49,
   'סיור תלת-ממדי: מחיר לדגם דירה בשקלים, לפני מע"מ, מהארנק. סוכן/ת (Elite בלבד) ויזם/משווק. דגם מהופך מראה הוא דגם נוסף'),
  ('plan_model_included_renders', 20,
   'סיור תלת-ממדי: מספר הדמיות התמונה (Gemini) הכלולות בכל דגם. ארבעה סגנונות על סלון, מטבח, שתי זוויות וניסיונות חוזרים')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. הדגם
-- ---------------------------------------------------------------------------
create table if not exists public.plan_models (
  id               uuid primary key default gen_random_uuid(),

  -- הבעלים: סוכן/ת (agency_members) או יזם (developers), בדיוק אחד מהם
  owner_kind       text not null check (owner_kind in ('agent', 'developer')),
  agent_id         uuid references public.agency_members(id) on delete cascade,
  developer_id     uuid references public.developers(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,

  name             text not null check (char_length(btrim(name)) between 1 and 120),

  -- draft: נרכש, מחכה לתוכנית · reading: קריאת התוכנית רצה · ready · failed (הוחזר)
  status           text not null default 'draft'
                     check (status in ('draft', 'reading', 'ready', 'failed')),
  mirrored_from    uuid references public.plan_models(id) on delete set null,
  source_plan_path text,

  -- המודל והעריכות. מבנה: docs/plan-3d-tour.md. הגדלים נחסמים כאן כי הדף קורא את
  -- השורה כולה, ושורה של מגה-בייט היא תקלה ולא סיור
  model            jsonb not null default '{}'::jsonb,
  settings         jsonb not null default '{}'::jsonb,
  views            jsonb not null default '[]'::jsonb,
  lights           jsonb not null default '[]'::jsonb,

  published        boolean not null default false,

  renders_included integer not null default 0 check (renders_included >= 0),
  renders_used     integer not null default 0 check (renders_used >= 0),
  amount_charged   numeric not null default 0 check (amount_charged >= 0),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint plan_models_owner_one check (
    (owner_kind = 'agent'     and agent_id     is not null and developer_id is null) or
    (owner_kind = 'developer' and developer_id is not null and agent_id     is null)
  ),
  constraint plan_models_json_types check (
    jsonb_typeof(model) = 'object' and jsonb_typeof(settings) = 'object'
    and jsonb_typeof(views) = 'array' and jsonb_typeof(lights) = 'array'
  ),
  constraint plan_models_json_size check (
    length(model::text) < 800000 and length(settings::text) < 20000
    and length(views::text) < 100000 and length(lights::text) < 100000
  ),
  constraint plan_models_published_ready check (not published or status = 'ready'),
  constraint plan_models_renders_cap check (renders_used <= renders_included)
);

comment on table public.plan_models is
  'דגם דירה תלת-ממדי (סיור). שייך לסוכן/ת או ליזם, נקנה ב-₪49 מהארנק. נכתב רק דרך start_plan_model/complete_plan_model/fail_plan_model ועריכת הבעלים. docs/plan-3d-tour.md';

create index if not exists plan_models_agent_idx     on public.plan_models (agent_id)     where agent_id is not null;
create index if not exists plan_models_developer_idx on public.plan_models (developer_id) where developer_id is not null;
create index if not exists plan_models_project_idx   on public.plan_models (project_id)   where project_id is not null;
-- דגם פתוח (שולם ועוד לא הושלם): כמעט תמיד ריק, ומשרת את ה-cron שמחזיר דגם תקוע
create index if not exists plan_models_open_idx on public.plan_models (created_at)
  where status in ('draft', 'reading');

-- ---------------------------------------------------------------------------
-- 3. שורת החיוב: מה שנגבה בפועל. ההחזר נעשה לפיה
-- ---------------------------------------------------------------------------
create table if not exists public.plan_model_charges (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid references public.plan_models(id) on delete set null,
  owner_kind    text not null check (owner_kind in ('agent', 'developer')),
  agent_id      uuid,
  developer_id  uuid,
  amount        numeric not null check (amount > 0),
  status        text not null default 'charged' check (status in ('charged', 'refunded')),
  refund_reason text,
  created_at    timestamptz not null default now(),
  refunded_at   timestamptz
);

comment on table public.plan_model_charges is
  'חיוב על דגם דירה: הסכום כפי שירד מהארנק, לא נגזר מחדש מ-pricing_config. ההחזר (fail_plan_model) לפי השורה הזו. ללא מפתח זר לבעלים: היומן נשמר גם אחרי מחיקת חשבון.';

create unique index if not exists plan_model_charges_model_key
  on public.plan_model_charges (model_id) where model_id is not null;
create index if not exists plan_model_charges_agent_idx
  on public.plan_model_charges (agent_id) where agent_id is not null;
create index if not exists plan_model_charges_developer_idx
  on public.plan_model_charges (developer_id) where developer_id is not null;

-- ---------------------------------------------------------------------------
-- 4. נעילת העמודות שהדפדפן אינו משנה
-- ---------------------------------------------------------------------------
create or replace function public.plan_models_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- דגם שעוד נקרא (או שנכשל והוחזר) אינו נערך: complete_plan_model הייתה דורסת את העריכה
  if old.status <> 'ready' then
    raise exception 'אפשר לערוך את הדגם רק אחרי שהוא מוכן'
      using errcode = '42501';
  end if;

  if new.owner_kind       is distinct from old.owner_kind
  or new.agent_id         is distinct from old.agent_id
  or new.developer_id     is distinct from old.developer_id
  or new.project_id       is distinct from old.project_id
  or new.status           is distinct from old.status
  or new.mirrored_from    is distinct from old.mirrored_from
  or new.source_plan_path is distinct from old.source_plan_path
  or new.renders_included is distinct from old.renders_included
  or new.renders_used     is distinct from old.renders_used
  or new.amount_charged   is distinct from old.amount_charged
  or new.created_at       is distinct from old.created_at then
    raise exception 'אי אפשר לשנות כאן בעלות, סטטוס, חיוב או מונה הדמיות'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_models_guard_trg on public.plan_models;
create trigger plan_models_guard_trg
  before update on public.plan_models
  for each row execute function public.plan_models_guard();

-- ---------------------------------------------------------------------------
-- 5. RLS והרשאות טבלה
-- ---------------------------------------------------------------------------
alter table public.plan_models enable row level security;
alter table public.plan_model_charges enable row level security;

drop policy if exists "plan_models owner read" on public.plan_models;
create policy "plan_models owner read" on public.plan_models
  for select to authenticated
  using (
    agent_id = (select public.current_agent_id())
    or developer_id = (select public.current_developer_id())
  );

-- הצופה (גם אנונימי) קורא דגם שפורסם ורק אותו
drop policy if exists "plan_models public read" on public.plan_models;
create policy "plan_models public read" on public.plan_models
  for select to anon, authenticated
  using (published and status = 'ready');

drop policy if exists "plan_models owner update" on public.plan_models;
create policy "plan_models owner update" on public.plan_models
  for update to authenticated
  -- בלי with check: ב-update הוא יורש את using, ושני עותקים של אותו תנאי הם שניים שיתפצלו
  using (
    agent_id = (select public.current_agent_id())
    or developer_id = (select public.current_developer_id())
  );

drop policy if exists "plan_model_charges owner read" on public.plan_model_charges;
create policy "plan_model_charges owner read" on public.plan_model_charges
  for select to authenticated
  using (
    agent_id = (select public.current_agent_id())
    or developer_id = (select public.current_developer_id())
  );

-- בלי insert ובלי delete לדפדפן: כסף ובעלות נכתבים רק בפונקציות למטה
-- ‏revoke all קודם: ברירת המחדל של Supabase נותנת ל-authenticated הרשאה ישירה על הכול,
-- וגרנט חלקי אחריה משאיר INSERT ו-TRUNCATE (הסקיל new-migration, כלל 4א)
revoke all on table public.plan_models from public, anon, authenticated;
-- הצופה האנונימי מקבל רק מה שהסיור צריך. חיוב, מונה הדמיות, בעלים ונתיב התוכנית אינם שלו
grant select (id, name, status, published, project_id, model, settings, views, lights, updated_at)
  on table public.plan_models to anon;
grant select on table public.plan_models to authenticated;
grant update (name, model, settings, views, lights, published) on table public.plan_models to authenticated;
grant select, insert, update, delete on table public.plan_models to service_role;

revoke all on table public.plan_model_charges from public, anon, authenticated;
grant select on table public.plan_model_charges to authenticated;
grant select, insert, update, delete on table public.plan_model_charges to service_role;

-- ---------------------------------------------------------------------------
-- 6. זכאות לרכישה
--
-- ‏service_role בלבד: מקבלת מזהה בעלים. סוכן/ת: Elite פעיל, דרך property_virtual_tour_eligible.
-- יזם: חשבון פעיל (suspended נחסם), בלי מסלול, כי ליזמים אין Elite.
-- ---------------------------------------------------------------------------
create or replace function public.plan_model_eligible(p_owner_kind text, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- אותה הגדרה של "Elite בפועל" כמו סיור 360, ולא עותק שלה
    when p_owner_kind = 'agent' then public.property_virtual_tour_eligible(p_owner_id)
    when p_owner_kind = 'developer' then exists (
      select 1 from public.developers d
       where d.id = p_owner_id and d.status = 'active')
    else false
  end;
$$;

revoke all on function public.plan_model_eligible(text, uuid) from public, anon, authenticated;
grant execute on function public.plan_model_eligible(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. רכישה: מחייבים ואז יוצרים, באותה טרנזקציה
-- ---------------------------------------------------------------------------
create or replace function public.start_plan_model(
  p_owner_kind text,
  p_owner_id   uuid,
  p_name       text,
  p_project_id uuid default null,
  p_mirror_of  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent    uuid := case when p_owner_kind = 'agent' then p_owner_id end;
  v_dev      uuid := case when p_owner_kind = 'developer' then p_owner_id end;
  v_price    numeric;
  v_included integer;
  v_balance  numeric;
  v_rows     integer;
  v_id       uuid;
begin
  if p_owner_kind not in ('agent', 'developer') then
    return jsonb_build_object('error', 'bad_owner_kind');
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    return jsonb_build_object('error', 'name_required');
  end if;

  if not public.plan_model_eligible(p_owner_kind, p_owner_id) then
    return jsonb_build_object(
      'error', 'tier_required',
      'required_tier', case when p_owner_kind = 'agent' then 'premium' else null end,
      'detail', case when p_owner_kind = 'agent'
        then 'סיור תלת-ממדי זמין במסלול Elite.'
        else 'חשבון היזם אינו פעיל.' end);
  end if;

  -- הפרויקט והדגם המקורי חייבים להיות של אותו בעלים
  if p_project_id is not null then
    if p_owner_kind <> 'developer' or not exists (
      select 1 from public.projects where id = p_project_id and developer_id = p_owner_id) then
      return jsonb_build_object('error', 'not_your_project');
    end if;
  end if;
  if p_mirror_of is not null and not exists (
    select 1 from public.plan_models
     where id = p_mirror_of and status = 'ready'
       and agent_id is not distinct from v_agent
       and developer_id is not distinct from v_dev) then
    return jsonb_build_object('error', 'mirror_source_invalid');
  end if;

  v_price    := coalesce((select value from public.pricing_config where key = 'plan_model_price'), 49);
  v_included := coalesce((select value from public.pricing_config where key = 'plan_model_included_renders'), 20);

  -- הניכוי עצמו הוא התנאי (credit_balance >= מחיר), לא רק בדיקה לפניו
  if p_owner_kind = 'agent' then
    update public.agency_members
       set credit_balance = credit_balance - v_price
     where id = p_owner_id and credit_balance >= v_price
    returning credit_balance into v_balance;
  else
    update public.developers
       set credit_balance = credit_balance - v_price
     where id = p_owner_id and credit_balance >= v_price
    returning credit_balance into v_balance;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('error', 'insufficient_balance', 'required', v_price);
  end if;

  insert into public.plan_models (
    owner_kind, agent_id, developer_id, project_id, name, mirrored_from,
    renders_included, amount_charged
  ) values (
    p_owner_kind, v_agent, v_dev,
    p_project_id, btrim(p_name), p_mirror_of, v_included, v_price
  ) returning id into v_id;

  insert into public.plan_model_charges (model_id, owner_kind, agent_id, developer_id, amount)
  values (v_id, p_owner_kind, v_agent, v_dev, v_price);

  return jsonb_build_object(
    'success', true, 'model_id', v_id, 'amount_charged', v_price,
    'renders_included', v_included, 'balance', v_balance);
end;
$$;

revoke all on function public.start_plan_model(text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_plan_model(text, uuid, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. הצלחה וכישלון של קריאת התוכנית
--
-- ‏fail_plan_model: מחזירה את מה שנגבה לפי שורת החיוב. אידמפוטנטית (שורה שכבר
-- refunded לא מזוכה שוב). לא מחזירה דגם ready: אותו כבר שילמו עליו וקיבלו.
-- ‏complete_plan_model: שומרת את המודל ופותחת אותו. לא דורסת דגם שכבר ready.
-- ‏mark_plan_model_reading: התוכנית עלתה והקריאה התחילה. כל שינוי סטטוס עובר בפונקציה,
-- באותה נעילת שורה, ולא ב-update גולמי מה-Edge Function.
-- ---------------------------------------------------------------------------
create or replace function public.mark_plan_model_reading(p_model_id uuid, p_source_plan_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.plan_models where id = p_model_id for update;
  if not found then
    return jsonb_build_object('error', 'model_not_found');
  end if;
  if v_status <> 'draft' then
    return jsonb_build_object('error', 'bad_status', 'status', v_status);
  end if;
  update public.plan_models
     set status = 'reading', source_plan_path = p_source_plan_path
   where id = p_model_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mark_plan_model_reading(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_plan_model_reading(uuid, text) to service_role;

create or replace function public.complete_plan_model(
  p_model_id uuid,
  p_model    jsonb,
  p_settings jsonb default '{}'::jsonb,
  p_lights   jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.plan_models;
begin
  select * into v_m from public.plan_models where id = p_model_id for update;
  if not found then
    return jsonb_build_object('error', 'model_not_found');
  end if;
  if v_m.status = 'ready' then
    return jsonb_build_object('success', true, 'already_ready', true);
  end if;
  if v_m.status not in ('draft', 'reading') then
    return jsonb_build_object('error', 'bad_status', 'status', v_m.status);
  end if;

  update public.plan_models
     set status = 'ready', model = p_model, settings = coalesce(p_settings, '{}'::jsonb),
         lights = coalesce(p_lights, lights)
   where id = p_model_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.complete_plan_model(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_plan_model(uuid, jsonb, jsonb, jsonb) to service_role;

create or replace function public.fail_plan_model(p_model_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m      public.plan_models;
  v_c      public.plan_model_charges;
  v_refund numeric := 0;
begin
  select * into v_m from public.plan_models where id = p_model_id for update;
  if not found then
    return jsonb_build_object('error', 'model_not_found');
  end if;
  if v_m.status = 'ready' then
    return jsonb_build_object('error', 'already_ready');
  end if;

  select * into v_c from public.plan_model_charges where model_id = p_model_id for update;
  if found and v_c.status = 'charged' then
    v_refund := v_c.amount;
    if v_c.owner_kind = 'agent' then
      update public.agency_members set credit_balance = credit_balance + v_c.amount
       where id = v_c.agent_id;
    else
      update public.developers set credit_balance = credit_balance + v_c.amount
       where id = v_c.developer_id;
    end if;
    update public.plan_model_charges
       set status = 'refunded', refunded_at = now(), refund_reason = left(p_reason, 300)
     where id = v_c.id;
  end if;

  update public.plan_models set status = 'failed' where id = p_model_id;
  return jsonb_build_object('success', true, 'refunded', v_refund);
end;
$$;

revoke all on function public.fail_plan_model(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_plan_model(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. הצעת מחיר לדפדפן: המזהה מה-JWT, לכן פתוחה ל-authenticated
--
-- ‏p_owner_kind בוחר איזה חשבון נבדק. מי שאין לו אותו (סוכן/ת ששואל/ת כיזם) מקבל/ת
-- not_found, לא שגיאה: ה-UI מציג כפתור "זמין ב-Elite" או מסתיר, לפי התשובה.
-- ---------------------------------------------------------------------------
create or replace function public.plan_model_quote(p_owner_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_price    numeric;
  v_included integer;
  v_balance  numeric;
begin
  if p_owner_kind = 'agent' then
    v_id := public.current_agent_id();
    select credit_balance into v_balance from public.agency_members where id = v_id;
  elsif p_owner_kind = 'developer' then
    v_id := public.current_developer_id();
    select credit_balance into v_balance from public.developers where id = v_id;
  else
    return jsonb_build_object('error', 'bad_owner_kind');
  end if;
  if v_id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  v_price    := coalesce((select value from public.pricing_config where key = 'plan_model_price'), 49);
  v_included := coalesce((select value from public.pricing_config where key = 'plan_model_included_renders'), 20);

  return jsonb_build_object(
    'eligible', public.plan_model_eligible(p_owner_kind, v_id),
    'required_tier', case when p_owner_kind = 'agent' then 'premium' else null end,
    'price', v_price,
    'renders_included', v_included,
    'balance', coalesce(v_balance, 0));
end;
$$;

revoke all on function public.plan_model_quote(text) from public, anon;
grant execute on function public.plan_model_quote(text) to authenticated, service_role;
