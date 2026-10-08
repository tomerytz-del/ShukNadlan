-- ============================================================================
-- קישור ישיר בכל התראה לסוכן/ת: לנכס, לכרטיס הלקוח/ה או לליד
-- ============================================================================
--
-- עד היום התראה על נכס ("נכתב תיאור שיווקי לנכס", "הסרטון מוכן", "נכס חדש
-- מתאים ללקוח/ה שלך") הובילה לקטגוריה כולה - ‏/crm?goto=accProperties - והסוכן/ת
-- נשאר/ה לחפש את הנכס ברשימה. ההתראה ידעה על איזה נכס מדובר, ופשוט לא שמרה
-- את זה: בטבלה היו רק ‏related_lead_id, ‏related_agenda_item_id ו-
-- ‏related_showcase_id.
--
-- המיגרציה הזו:
--
--   1. מוסיפה ‏related_property_id ו-related_client_id ל-notifications.
--   2. מחליפה את שמונה הפונקציות שכותבות התראה על נכס או על לקוח/ה, כך שיכתבו
--      גם את המזהה. **הגוף זהה לגרסה האחרונה של כל אחת**, ורק ה-insert ל-
--      notifications השתנה (ומקף ארוך אחד בטקסט שמוצג, ב-mark_property_description).
--   3. מחזירה את המזהים מ-notification_push_claim, כדי שההודעה בוואטסאפ תישא
--      קישור ישיר. ‏showcase_activity מקבלת את הלקוח/ה דרך ‏related_showcase_id.
--
-- התראה שמכסה כמה נכסים או כמה לקוחות (שלוש התאמות בבת אחת, מסירה של עשרה
-- נכסים) נשארת בלי מזהה ומובילה לקטגוריה - אין נכס אחד שהוא "הנכון".
--
-- ‏on delete set null: נכס או לקוח/ה שנמחקו לא מוחקים את ההתראה; הקישור פשוט
-- נופל חזרה לקטגוריה. ‏notifications אינה מפנה עדיין לאף אחת משתי הטבלאות,
-- ולכן מפתח זר יחיד לכל אחת אינו שובר embed קיים.
--
-- הפרטים: docs/notifications-center.md, "קישור ישיר".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists related_property_id uuid;
alter table public.notifications
  add column if not exists related_client_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_related_property_id_fkey') then
    alter table public.notifications
      add constraint notifications_related_property_id_fkey
      foreign key (related_property_id) references public.properties(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_related_client_id_fkey') then
    alter table public.notifications
      add constraint notifications_related_client_id_fkey
      foreign key (related_client_id) references public.agent_clients(id) on delete set null;
  end if;
end $$;

-- מחיקת נכס או לקוח/ה מחפשת כאן את השורות לאיפוס; בלי אינדקס זו סריקה מלאה.
create index if not exists notifications_related_property_id_idx
  on public.notifications (related_property_id) where related_property_id is not null;
create index if not exists notifications_related_client_id_idx
  on public.notifications (related_client_id) where related_client_id is not null;

comment on column public.notifications.related_property_id is
  'הנכס שההתראה עוסקת בו, כשיש אחד. ממנו נבנה הקישור הישיר - בפעמון וב-notification-push.';
comment on column public.notifications.related_client_id is
  'הלקוח/ה בקובץ שההתראה עוסקת בו/ה, כשיש אחד/ת. ממנו נבנה הקישור הישיר לכרטיס.';

-- ---------------------------------------------------------------------------
-- 2. תיאור שיווקי שנכתב אוטומטית (גרסה: 20260925090000)
-- ---------------------------------------------------------------------------
create or replace function public.mark_property_description(
  p_job_id uuid,
  p_ok     boolean,
  p_error  text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max      int;
  v_status   text;
  v_attempts smallint;
  v_reason   text;
  v_agent    uuid;
  v_title    text;
  v_prop     uuid;
begin
  v_max := coalesce((select value::int from public.pricing_config
                      where key = 'marketing_description_max_attempts'), 4);

  select j.attempts, j.reason, p.agent_id, p.title, p.id
    into v_attempts, v_reason, v_agent, v_title, v_prop
    from public.property_description_jobs j
    join public.properties p on p.id = j.property_id
   where j.id = p_job_id;
  if v_attempts is null then
    return null;
  end if;

  v_status := case
    when p_ok then 'done'
    when v_attempts >= v_max then 'failed'
    else 'pending'
  end;

  update public.property_description_jobs
     set status       = v_status,
         last_error   = case when p_ok then null else p_error end,
         completed_at = case when p_ok then now() else completed_at end
   where id = p_job_id;

  if p_ok and v_reason <> 'manual' and v_agent is not null then
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    values (v_agent, 'marketing_copy', 'נכתב תיאור שיווקי לנכס',
            coalesce(v_title, 'לנכס שלך') ||
            ' - המערכת כתבה תיאור שיווקי מנתוני המודעה. כדאי לעבור עליו בכרטיס הנכס ולערוך אם צריך.',
            v_prop);
  end if;

  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. סרטון שיווקי - הופק / נכשל (גרסה: 20261119090000)
-- ---------------------------------------------------------------------------
create or replace function public.complete_property_video_job(p_job_id uuid, p_result_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job   public.property_video_jobs;
  v_title text;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('success', true, 'already_done', true, 'result_url', v_job.result_url);
  end if;

  update public.properties set video_url = p_result_url where id = v_job.property_id
    returning title into v_title;

  update public.property_video_jobs
     set status = 'done', result_url = p_result_url, error_detail = null, updated_at = now()
   where id = p_job_id;

  -- ‏marketing_copy ולא סוג חדש: ראו ההסבר בראש הקובץ. הטריגר
  -- ‏notifications_apply_preferences מסנן בשקט סוכן/ת שהשתיק/ה את הסוג.
  insert into public.notifications (agent_id, type, title, body, related_property_id)
  values (
    v_job.agent_id,
    'marketing_copy',
    'הסרטון מוכן: ' || coalesce(v_title, 'נכס'),
    'הסרטון השיווקי הופק והוצמד לנכס.'
      || case when v_job.replaced_existing then ' הסרטון הקודם הוחלף.' else '' end,
    v_job.property_id
  );

  return jsonb_build_object(
    'success', true,
    'result_url', p_result_url,
    'previous_video_url', v_job.previous_video_url
  );
end;
$$;

create or replace function public.fail_property_video_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     public.property_video_jobs;
  v_refund  numeric := 0;
  v_title   text;
  v_notify  boolean := false;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('error', 'already_done');
  end if;

  -- ‏ההתראה יוצאת רק במעבר לכישלון. ‏reconcile ו-callback יכולים שניהם להגיע
  -- לאותה בקשה, ובקשה שכבר failed לא מתריעה שוב — בדיוק כמו שהיא לא מחזירה
  -- כסף שוב.
  if v_job.status <> 'failed' then
    update public.property_video_jobs
       set status = 'failed', error_detail = p_reason, updated_at = now()
     where id = p_job_id;
    v_notify := true;
  end if;

  if v_job.amount_charged > 0 and not v_job.refunded then
    update public.agency_members
       set credit_balance = credit_balance + v_job.amount_charged
     where id = v_job.agent_id;

    update public.property_video_jobs set refunded = true where id = p_job_id;
    update public.property_video_charges
       set status = 'refunded'
     where job_id = p_job_id and status = 'charged';

    v_refund := v_job.amount_charged;
  end if;

  if v_notify then
    select title into v_title from public.properties where id = v_job.property_id;
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    values (
      v_job.agent_id,
      'marketing_copy',
      'הפקת הסרטון נכשלה: ' || coalesce(v_title, 'נכס'),
      case when v_refund > 0
           -- ‏rtrim על הנקודה: ‎FM…0.99‎ מחזיר "25." לסכום עגול, ו-"‏₪25." בהודעה
           -- נראה כמו מספר שנקטע.
           then 'הארנק זוכה ב-₪' || rtrim(trim(to_char(v_refund, 'FM999999990.99')), '.') || '. אפשר לנסות שוב.'
           else 'לא נגבה תשלום. אפשר לנסות שוב.' end,
      v_job.property_id
    );
  end if;

  return jsonb_build_object('success', true, 'refunded', v_refund);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. התאמות - נכס חדש מול הקובץ, ולקוח/ה חדש/ה מול הנכסים (גרסה: 20270115097000)
-- ---------------------------------------------------------------------------
create or replace function public.generate_client_match_alerts(p_property_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop      public.properties%rowtype;
  v_min_score int;
  v_created   int := 0;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found or v_prop.status <> 'active' then
    return 0;
  end if;

  v_min_score := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);

  with reach as (
    select m.id as agent_id,
           case when v_prop.agent_id = m.id then 'own' else 'agency' end as source,
           0 as proximity
      from public.agency_members m
     where m.active = true
       and v_prop.agency_id is not null
       and m.agency_id = v_prop.agency_id
    union all
    select m.id, 'shared', 1
      from public.property_shares ps
      join public.agency_members m
        on m.agency_id = ps.shared_with_agency_id
       and m.active = true
     where ps.property_id = v_prop.id
  ),
  audience as (
    select distinct on (agent_id) agent_id, source
      from reach
     order by agent_id, proximity
  ),
  hits as (
    select a.agent_id, c.id as client_id, a.source,
           mt.score, mt.reasons, mt.missing_features
      from audience a
      join public.agent_clients c
        on c.agent_id = a.agent_id
       and c.status = 'active'
      cross join lateral public.client_property_match(c, v_prop) mt
     where mt.score >= v_min_score
  ),
  ins as (
    insert into public.client_match_alerts
      (agent_id, client_id, property_id, source, score, reasons, missing_features)
    select h.agent_id, h.client_id, v_prop.id, h.source, h.score, h.reasons, h.missing_features
      from hits h
    on conflict (client_id, property_id) do nothing
    returning agent_id, client_id
  ),
  named as (
    select i.agent_id, i.client_id, c.full_name
      from ins i
      join public.agent_clients c on c.id = i.client_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body,
                                      related_property_id, related_client_id)
    select n.agent_id,
           'client_match',
           'נכס חדש מתאים ללקוח/ה שלך',
           '"' || v_prop.title || '" מתאים ' ||
           case when count(*) = 1
                then 'ל' || min(n.full_name)
                else 'ל-' || count(*) || ' לקוחות מקובץ הלקוחות שלך' end,
           v_prop.id,
           -- לקוח/ה אחד/ת: הקישור פותח את הכרטיס שלו/ה. כמה: את רשימת ההתראות.
           case when count(*) = 1 then (array_agg(n.client_id))[1] end
      from named n
     group by n.agent_id
    returning 1
  ),
  -- הצד השני: המפרסם/ת. רק התאמות אצל סוכן/ת **אחר/ת** - לקוח/ה שלך על
  -- נכס שלך כבר צלצל/ה אצלך למעלה.
  others as (
    select i.agent_id, count(*) as clients
      from ins i
     where i.agent_id is distinct from v_prop.agent_id
     group by i.agent_id
  ),
  listing as (
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    select v_prop.agent_id,
           'listing_match',
           'הנכס שלך מתאים ללקוח/ה של סוכן/ת אחר/ת',
           '"' || v_prop.title || '" מתאים ל' ||
           case when sum(o.clients) = 1 then 'לקוח/ה' else '-' || sum(o.clients) || ' לקוחות' end ||
           ' של ' ||
           string_agg(coalesce(m.display_name, 'סוכן/ת') ||
                      coalesce(' (' || a.name || ')', '') ||
                      coalesce(', ' || m.phone, ''),
                      ' · ' order by o.clients desc) ||
           '. שווה ליצור קשר לשיתוף פעולה.',
           v_prop.id
      from others o
      join public.agency_members m on m.id = o.agent_id
      left join public.agencies a on a.id = m.agency_id
     where v_prop.agent_id is not null
       and exists (select 1 from public.agency_members lm
                    where lm.id = v_prop.agent_id and lm.active = true)
    having count(*) > 0
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

create or replace function public.generate_client_match_alerts_for_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client    public.agent_clients%rowtype;
  v_agent     public.agency_members%rowtype;
  v_min_score int;
  v_created   int := 0;
begin
  select * into v_client from public.agent_clients where id = p_client_id;
  if not found or v_client.status <> 'active' then
    return 0;
  end if;

  select * into v_agent from public.agency_members
   where id = v_client.agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return 0;
  end if;

  v_min_score := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);

  with reach as (
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as source,
           0 as proximity
      from public.properties p
     where p.agency_id = v_agent.agency_id
       and p.status = 'active'
    union all
    select ps.property_id, 'shared', 1
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  ),
  pool as (
    select distinct on (pid) pid, source
      from reach
     order by pid, proximity
  ),
  hits as (
    select p.id as property_id, p.agent_id as listing_agent_id, p.title,
           pool.source, mt.score, mt.reasons, mt.missing_features
      from pool
      join public.properties p on p.id = pool.pid
      cross join lateral public.client_property_match(v_client, p) mt
     where mt.score >= v_min_score
  ),
  ins as (
    insert into public.client_match_alerts
      (agent_id, client_id, property_id, source, score, reasons, missing_features)
    select v_agent.id, v_client.id, h.property_id, h.source, h.score, h.reasons, h.missing_features
      from hits h
    on conflict (client_id, property_id) do nothing
    returning property_id
  ),
  landed as (
    select h.property_id, h.listing_agent_id, h.title, h.score
      from ins i
      join hits h on h.property_id = i.property_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body,
                                      related_property_id, related_client_id)
    select v_agent.id,
           'client_match',
           'נכסים קיימים מתאימים ללקוח/ה שלך',
           case when count(*) = 1
                then '"' || min(l.title) || '" מתאים ל' || v_client.full_name
                else count(*) || ' נכסים מתאימים ל' || v_client.full_name ||
                     ', הבולט: "' || (array_agg(l.title order by l.score desc))[1] || '"' end,
           case when count(*) = 1 then (array_agg(l.property_id))[1] end,
           v_client.id
      from landed l
    having count(*) > 0
    returning 1
  ),
  -- הצד השני: כל מפרסם/ת אחר/ת, צלצול אחד עם כל הנכסים שלו/ה שהתאימו.
  listing as (
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    select l.listing_agent_id,
           'listing_match',
           'הנכס שלך מתאים ללקוח/ה של סוכן/ת אחר/ת',
           case when count(*) = 1 then '"' || min(l.title) || '" מתאים'
                else count(*) || ' מהנכסים שלך מתאימים' end ||
           ' ללקוח/ה של ' || coalesce(v_agent.display_name, 'סוכן/ת') ||
           coalesce(' (' || (select a.name from public.agencies a where a.id = v_agent.agency_id) || ')', '') ||
           coalesce(', ' || v_agent.phone, '') ||
           '. שווה ליצור קשר לשיתוף פעולה.',
           case when count(*) = 1 then (array_agg(l.property_id))[1] end
      from landed l
      join public.agency_members lm on lm.id = l.listing_agent_id and lm.active = true
     where l.listing_agent_id is distinct from v_agent.id
     group by l.listing_agent_id
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. מסירה בהפנייה (גרסאות: 20270128090000, 20270130090000, 20270131090000)
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
    insert into public.notifications (agent_id, type, title, body,
                                      related_property_id, related_client_id, related_lead_id)
    values (v_target.id, 'system',
            case p_kind when 'client' then 'לקוח/ה נמסר/ה אליך בהפנייה'
                        when 'property' then 'נכס נמסר אליך בהפנייה'
                        else 'ליד נמסר אליך בהפנייה' end,
            coalesce(v_me.display_name, 'מנהל/ת המשרד') || ' מסר/ה לטיפולך: ' || coalesce(v_label, ''),
            case when p_kind = 'property' then p_id end,
            case when p_kind = 'client' then p_id end,
            case when p_kind = 'lead' then p_id end);
  end if;

  return jsonb_build_object('ok', true, 'agent_name', v_target.display_name, 'returned', v_back);
end;
$$;

create or replace function public.refer_clients_to_agent(p_ids uuid[], p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     public.agency_members%rowtype;
  v_target public.agency_members%rowtype;
  v_back   boolean;
  v_moved  int := 0;
  v_total  int := coalesce(cardinality(p_ids), 0);
begin
  select * into v_me from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found or v_me.agency_id is null or v_me.role <> 'manager' then
    return jsonb_build_object('ok', false, 'error', 'רק מנהל/ת משרד יכול/ה למסור בהפנייה.');
  end if;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'לא נבחרו לקוחות.');
  end if;
  if v_total > 500 then
    return jsonb_build_object('ok', false, 'error', 'אפשר למסור עד 500 לקוחות בפעם אחת.');
  end if;

  select * into v_target from public.agency_members
   where id = p_agent_id and agency_id = v_me.agency_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הסוכן/ת שנבחר/ה אינו/ה פעיל/ה במשרד.');
  end if;
  v_back := v_target.id = v_me.id;

  update public.agent_clients c
     set agent_id    = v_target.id,
         agency_id   = v_me.agency_id,
         referred_by = case when v_back then null else v_me.id end,
         referred_at = case when v_back then null else now() end
   where c.id = any(p_ids)
     and (c.agent_id = v_me.id or c.referred_by = v_me.id)
     and c.agent_id <> v_target.id;
  get diagnostics v_moved = row_count;

  if v_moved > 0 and not v_back then
    insert into public.notifications (agent_id, type, title, body, related_client_id)
    values (v_target.id, 'system',
            case when v_moved = 1 then 'לקוח/ה נמסר/ה אליך בהפנייה'
                 else v_moved || ' לקוחות נמסרו אליך בהפנייה' end,
            coalesce(v_me.display_name, 'מנהל/ת המשרד') || ' מסר/ה לטיפולך '
              || case when v_moved = 1 then 'לקוח/ה אחד/ת' else v_moved || ' לקוחות' end
              || '. הם מסומנים "הפנייה" בקובץ הלקוחות שלך.',
            case when v_moved = 1 and v_total = 1 then p_ids[1] end);
  end if;

  return jsonb_build_object('ok', true, 'moved', v_moved, 'skipped', v_total - v_moved,
                            'agent_name', v_target.display_name, 'returned', v_back);
end;
$$;

create or replace function public.refer_properties_to_agent(p_ids uuid[], p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     public.agency_members%rowtype;
  v_target public.agency_members%rowtype;
  v_back   boolean;
  v_moved  int := 0;
  v_total  int := coalesce(cardinality(p_ids), 0);
begin
  select * into v_me from public.agency_members
   where user_id = (select auth.uid()) and active = true;
  if not found or v_me.agency_id is null or v_me.role <> 'manager' then
    return jsonb_build_object('ok', false, 'error', 'רק מנהל/ת משרד יכול/ה למסור בהפנייה.');
  end if;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'לא נבחרו נכסים.');
  end if;
  if v_total > 500 then
    return jsonb_build_object('ok', false, 'error', 'אפשר למסור עד 500 נכסים בפעם אחת.');
  end if;

  select * into v_target from public.agency_members
   where id = p_agent_id and agency_id = v_me.agency_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הסוכן/ת שנבחר/ה אינו/ה פעיל/ה במשרד.');
  end if;
  v_back := v_target.id = v_me.id;

  update public.properties p
     set agent_id    = v_target.id,
         referred_by = case when v_back then null else v_me.id end,
         referred_at = case when v_back then null else now() end
   where p.id = any(p_ids)
     and p.agency_id = v_me.agency_id
     and p.agent_id <> v_target.id;
  get diagnostics v_moved = row_count;

  if v_moved > 0 and not v_back then
    insert into public.notifications (agent_id, type, title, body, related_property_id)
    values (v_target.id, 'system',
            case when v_moved = 1 then 'נכס נמסר אליך בהפנייה'
                 else v_moved || ' נכסים נמסרו אליך בהפנייה' end,
            coalesce(v_me.display_name, 'מנהל/ת המשרד') || ' מסר/ה לטיפולך '
              || case when v_moved = 1 then 'נכס אחד' else v_moved || ' נכסים' end
              || '. הם מסומנים "הפנייה" ברשימת הנכסים שלך.',
            case when v_moved = 1 and v_total = 1 then p_ids[1] end);
  end if;

  return jsonb_build_object('ok', true, 'moved', v_moved, 'skipped', v_total - v_moved,
                            'agent_name', v_target.display_name, 'returned', v_back);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. הדחיפה לוואטסאפ מחזירה את המזהים (גרסה: 20261101090000)
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_claim(p_limit int default 20)
returns table (
  log_id       uuid,
  agent_id     uuid,
  display_name text,
  phone_e164   text,
  channel_mode text,
  items        jsonb,
  item_count   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
begin
  -- רישום בלבד; החסימה כבר שוחררה על ידי הפרדיקט.
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    -- המזהים נוסעים עם ההתראה: ‏notification-push בונה מהם את הקישור הישיר
    -- לנכס, לכרטיס הלקוח/ה או לליד, במקום קישור לקטגוריה.
    select jsonb_agg(jsonb_build_object(
             'type',        n.type,
             'title',       n.title,
             'body',        n.body,
             'property_id', n.related_property_id,
             'client_id',   coalesce(n.related_client_id,
                                     (select s.client_id from public.client_showcases s
                                       where s.id = n.related_showcase_id)),
             'lead_id',     n.related_lead_id
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type)
      into v_items, v_ids, v_types
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and n.created_at > now() - make_interval(hours => v_look)
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at));

    continue when v_items is null;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'רושמת שורת יומן לכל סוכן/ת שיש לו/ה התראות פתוחות שטרם נשלחו, ומחזירה אותן לשליחה. הרישום קודם לשליחה — כך נפילה באמצע לא מייצרת הודעה כפולה, ושורה שלא יצאה אינה מבליעה את ההתראות שבתוכה.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
