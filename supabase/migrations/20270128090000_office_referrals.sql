-- ============================================================================
-- הפניות מהמשרד: לקוח/ה, נכס או ליד שמנהל/ת המשרד מסר/ה לסוכן/ת
--
-- בעל/ת המשרד מקבל/ת פנייה (קונה, בעל/ת נכס למכירה, ליד מדף המשרד) ומוסר/ת
-- אותה לסוכן/ת מהצוות. עד היום זה נעשה מחוץ למערכת: הלקוח/ה נכנס/ה לקובץ של
-- הסוכן/ת, ומאותו רגע המנהל/ת לא ראה/תה אותו/ה יותר — ה-RLS של
-- ‏agent_clients מכוון שלא יחזיר למנהל/ת לקוחות של סוכנים.
--
-- ההפנייה סוגרת את הפער בלי לפתוח את כל קובץ הלקוחות של המשרד למנהל/ת:
--
--   ‏referred_by — מי מסר/ה (agency_members.id של המנהל/ת). שורה עם ערך כאן
--     "נכנסה בהפנייה", והיא משותפת: הסוכן/ת המטפל/ת (agent_id) והמנהל/ת
--     שמסר/ה רואים ומעדכנים אותה שניהם.
--   ‏referred_at — מתי. ‏null כש-referred_by ריק.
--
-- ההעברה עצמה נעשית רק דרך refer_to_agent(): ה-policy הקיים על
-- ‏agent_clients דורש agent_id = current_agent_id() גם ב-with check, ולכן
-- מנהל/ת לא יכול/ה להעביר לקוח/ה לסוכן/ת ב-update רגיל — וזה טוב. הפונקציה
-- בודקת שהקורא/ת מנהל/ת, שהיעד הוא/היא סוכן/ת פעיל/ה באותו משרד, ושהשורה
-- שייכת לקורא/ת (או שכבר הופנתה על ידו/ה — העברה מחדש).
--
-- מה שלא משתנה: סוכן/ת רגיל/ה עדיין אינו/ה רואה לקוחות של אחרים, ומנהל/ת
-- אינו/ה רואה לקוחות שהסוכן/ת הכניס/ה בעצמו/ה. ‏docs/office-referrals.md
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות
-- ---------------------------------------------------------------------------
alter table public.agent_clients add column if not exists referred_by uuid
  references public.agency_members(id) on delete set null;
alter table public.agent_clients add column if not exists referred_at timestamptz;

alter table public.properties add column if not exists referred_by uuid
  references public.agency_members(id) on delete set null;
alter table public.properties add column if not exists referred_at timestamptz;

alter table public.leads add column if not exists referred_by uuid
  references public.agency_members(id) on delete set null;
alter table public.leads add column if not exists referred_at timestamptz;

comment on column public.agent_clients.referred_by is
  'מנהל/ת המשרד שמסר/ה את הלקוח/ה לסוכן/ת (הפנייה). השורה משותפת לשניהם. null = הסוכן/ת הכניס/ה בעצמו/ה.';
comment on column public.properties.referred_by is
  'מנהל/ת המשרד שמסר/ה את הנכס לסוכן/ת (הפנייה). השורה משותפת לשניהם.';
comment on column public.leads.referred_by is
  'מנהל/ת המשרד שמסר/ה את הליד לסוכן/ת (הפנייה). השורה משותפת לשניהם.';

create index if not exists agent_clients_referred_by_idx on public.agent_clients (referred_by) where referred_by is not null;
create index if not exists properties_referred_by_idx    on public.properties    (referred_by) where referred_by is not null;
create index if not exists leads_referred_by_idx         on public.leads         (referred_by) where referred_by is not null;

-- ---------------------------------------------------------------------------
-- 2. הגישה המשותפת
--
-- ‏policies נוספים ולא שינוי של הקיימים: permissive policies מתחברים ב-OR,
-- ולכן מה שהסוכן/ת ראה/תה ועשה/תה עד היום לא זז.
--
-- המנהל/ת קורא/ת ומעדכנ/ת לקוח/ה שהפנה/תה — לא מוחק/ת: מחיקה היא של מי
-- שמטפל/ת. ה-with check מחייב שה-referred_by יישאר שלו/ה, כך שהמנהל/ת לא
-- יכול/ה "להעביר" את השורה הלאה ב-update ולעקוף את refer_to_agent().
-- ---------------------------------------------------------------------------
drop policy if exists "referrer reads referred clients" on public.agent_clients;
create policy "referrer reads referred clients"
  on public.agent_clients for select
  using (referred_by = public.current_agent_id());

drop policy if exists "referrer updates referred clients" on public.agent_clients;
create policy "referrer updates referred clients"
  on public.agent_clients for update
  using (referred_by = public.current_agent_id())
  with check (referred_by = public.current_agent_id());

-- נכסים: הקריאה כבר קיימת למנהל/ת (כל נכסי המשרד). נוספת רק העריכה.
drop policy if exists "referrer updates referred properties" on public.properties;
create policy "referrer updates referred properties"
  on public.properties for update
  using (referred_by = public.current_agent_id())
  with check (referred_by = public.current_agent_id());

-- לידים: גם כאן הקריאה קיימת למנהל/ת. אין עריכה — הליד נפתח ומטופל דרך
-- הפונקציות שלו (claim_lead, הארכיון), ואלה של הסוכן/ת המטפל/ת.

-- ---------------------------------------------------------------------------
-- 3. ‏leads_masked נושא את ההפנייה
--
-- ה-CRM טוען את הלידים דרך ה-view, ובלעדי העמודה אין לו איך לסמן "הפנייה"
-- או להציג את הליד גם למנהל/ת אחרי שנמסר. ההגדרה זהה לזו של
-- ‏20261230090000, והעמודות החדשות בסוף בלבד.
-- ---------------------------------------------------------------------------
create or replace view public.leads_masked
with (security_invoker = true) as
  select
    l.id,
    l.lead_type,
    l.deal_type,
    l.property_id,
    l.agency_id,
    l.agent_id,
    l.status,
    l.quota_source,
    case
      when l.status = 'unlocked' then l.raw_name
      when l.raw_name is null then null::text
      else (left(split_part(l.raw_name, ' ', 1), 1)
            || repeat('*', greatest(length(split_part(l.raw_name, ' ', 1)) - 1, 0)))
           || case
                when position(' ' in l.raw_name) > 0
                  then (' ' || left(split_part(l.raw_name, ' ', 2), 1))
                       || repeat('*', greatest(length(split_part(l.raw_name, ' ', 2)) - 1, 0))
                else ''
              end
    end as display_name,
    case
      when l.status = 'unlocked' then l.raw_phone
      when l.raw_phone is null then null::text
      else ((left(regexp_replace(l.raw_phone, '[^0-9]', '', 'g'), 2) || '-')
            || repeat('*', greatest(length(regexp_replace(l.raw_phone, '[^0-9]', '', 'g')) - 3, 0)))
           || right(regexp_replace(l.raw_phone, '[^0-9]', '', 'g'), 1)
    end as display_phone,
    l.city,
    l.neighborhood_id,
    l.property_type,
    l.unlocked_at,
    l.unlocked_by,
    l.created_at,
    l.property_details,
    case when l.status = 'unlocked' then l.raw_message else null::text end as display_message,
    l.source,
    -- העמודות החדשות, בסוף בלבד: `create or replace view` מסרב לכל מיקום אחר.
    l.referred_by,
    l.referred_at
  from public.leads l;

-- ---------------------------------------------------------------------------
-- 4. ‏refer_to_agent — ההעברה
--
--   p_kind      'client' | 'property' | 'lead'
--   p_id        מזהה השורה
--   p_agent_id  הסוכן/ת המטפל/ת. המנהל/ת עצמו/ה = החזרה אליו/ה וביטול
--               ההפנייה (referred_by מתאפס).
--
-- ליד מועבר רק כשהוא פתוח (unlocked): ליד מוסתר שמועבר היה מגיע לסוכן/ת
-- כחיוב שלא בחר/ה בו, ובפתיחה הוא היה נגבה ממנו/ה ולא מהמשרד.
--
-- מחזירה jsonb ‏{ok, agent_name} או {ok:false, error} — אותה צורה של שאר
-- פעולות ה-CRM, כדי שההודעה בעברית תגיע לסוכן/ת כמו שהיא.
-- ---------------------------------------------------------------------------
create or replace function public.refer_to_agent(p_kind text, p_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       public.agency_members%rowtype;
  v_target   public.agency_members%rowtype;
  v_owner    uuid;
  v_referrer uuid;
  v_agency   uuid;
  v_status   text;
  v_label    text;
  v_back     boolean;
begin
  select * into v_me from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found or v_me.agency_id is null or v_me.role <> 'manager' then
    return jsonb_build_object('ok', false, 'error', 'רק מנהל/ת משרד יכול/ה למסור בהפנייה.');
  end if;

  select * into v_target from public.agency_members
   where id = p_agent_id and agency_id = v_me.agency_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הסוכן/ת שנבחר/ה אינו/ה פעיל/ה במשרד.');
  end if;
  v_back := v_target.id = v_me.id;

  if p_kind = 'client' then
    select agent_id, referred_by, agency_id, full_name
      into v_owner, v_referrer, v_agency, v_label
      from public.agent_clients where id = p_id for update;
  elsif p_kind = 'property' then
    select agent_id, referred_by, agency_id, title
      into v_owner, v_referrer, v_agency, v_label
      from public.properties where id = p_id for update;
    -- נכס של המשרד נמסר גם אם אינו של המנהל/ת — הוא ממילא רואה/ה אותו
    if found and v_agency = v_me.agency_id then v_owner := v_me.id; end if;
  elsif p_kind = 'lead' then
    select agent_id, referred_by, agency_id, status, coalesce(raw_name, 'ליד')
      into v_owner, v_referrer, v_agency, v_status, v_label
      from public.leads where id = p_id for update;
    if found and v_status <> 'unlocked' then
      return jsonb_build_object('ok', false, 'error', 'אפשר למסור רק ליד שכבר נפתח.');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'סוג לא מוכר.');
  end if;

  if v_owner is null or (v_owner <> v_me.id and v_referrer is distinct from v_me.id) then
    return jsonb_build_object('ok', false, 'error', 'לא נמצא, או שאינו שלך למסור.');
  end if;

  if p_kind = 'client' then
    update public.agent_clients
       set agent_id    = v_target.id,
           agency_id   = v_me.agency_id,
           referred_by = case when v_back then null else v_me.id end,
           referred_at = case when v_back then null else now() end
     where id = p_id;
  elsif p_kind = 'property' then
    update public.properties
       set agent_id    = v_target.id,
           referred_by = case when v_back then null else v_me.id end,
           referred_at = case when v_back then null else now() end
     where id = p_id;
  else
    update public.leads
       set agent_id    = v_target.id,
           referred_by = case when v_back then null else v_me.id end,
           referred_at = case when v_back then null else now() end
     where id = p_id;
  end if;

  if not v_back then
    insert into public.notifications (agent_id, type, title, body)
    values (v_target.id, 'system',
            case p_kind when 'client' then 'לקוח/ה נמסר/ה אליך בהפנייה'
                        when 'property' then 'נכס נמסר אליך בהפנייה'
                        else 'ליד נמסר אליך בהפנייה' end,
            coalesce(v_me.display_name, 'מנהל/ת המשרד') || ' מסר/ה לטיפולך: ' || coalesce(v_label, ''));
  end if;

  return jsonb_build_object('ok', true, 'agent_name', v_target.display_name, 'returned', v_back);
end;
$$;

comment on function public.refer_to_agent(text, uuid, uuid) is
  'מנהל/ת משרד מוסר/ת לקוח/ה, נכס או ליד פתוח לסוכן/ת מהצוות, ומסמן/ת אותו כהפנייה משותפת לשניהם.';

revoke all on function public.refer_to_agent(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.refer_to_agent(text, uuid, uuid) to authenticated;
