-- ---------------------------------------------------------------------------
-- ‏כלל היריד בנתונים: הזכאות נקבעת ברגע הפנייה (‏PR 1010, חלק 7 §A.4b; החלטה 6
-- של תומר, 27.10.2026).
--
-- Written in PR 1010, NOT applied. The owner applies it after merge (move it to
-- supabase/migrations with the next free version, or run it through the pipeline).
-- הקוד באתר וב-CRM כבר סובל את היעדרה: הכרטיס ב-CRM מציג את התג רק כשהעמודה
-- קיימת ודלוקה.
--
-- **הכלל:** מי שפונה על דירה בזמן שהיא ביריד לא משלם/ת עמלת תיווך, גם אם ההסכם
-- נחתם אחר כך. שדות open_house_* על הנכס משתנים או מתנקים אחרי היריד ואינם
-- יכולים להוכיח את זה חודש אחרי - ולכן הליד זוכר בעצמו, בשרת, ברגע ההכנסה,
-- ולעולם לא מחושב מחדש.
--
-- זכאי = ‏leads.property_id על נכס עם open_house ו-
--        ‏open_house_start <= created_at < open_house_end (אותו חלון של OpenHouse.live).
--
-- כל ערוץ שיוצר ליד על הנכס מקבל את זה מעצמו, כי זה טריגר ולא קוד בפונקציה:
-- טופס דף הנכס, גיליון ההחלקה, כרטיס היריד, לחיצה על וואטסאפ, גבריאלה.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists open_house_eligible boolean not null default false,
  add column if not exists open_house_end_snapshot timestamptz;

comment on column public.leads.open_house_eligible is
  'הפנייה הגיעה בזמן שהנכס היה ביריד הבתים הפתוחים - ללא עמלת תיווך לקונה. נקבע בהכנסה ולעולם לא מחושב מחדש.';
comment on column public.leads.open_house_end_snapshot is
  'מועד סיום היריד של הנכס ברגע הפנייה (לטקסט "היריד לדירה הסתיים ב-…; הפנייה הגיעה לפני כן").';

create or replace function public.leads_open_house_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts timestamptz := coalesce(new.created_at, now());
begin
  -- הדפדפן אינו יכול לקבוע זכאות: מה שנשלח נדרס בחישוב מהנכס
  new.open_house_eligible := false;
  new.open_house_end_snapshot := null;
  if new.property_id is not null then
    select true, p.open_house_end
      into new.open_house_eligible, new.open_house_end_snapshot
      from public.properties p
     where p.id = new.property_id
       and p.open_house
       and p.open_house_start <= v_ts
       and p.open_house_end > v_ts;
    new.open_house_eligible := coalesce(new.open_house_eligible, false);
  end if;
  return new;
end;
$$;

revoke all on function public.leads_open_house_snapshot() from public, anon, authenticated;

drop trigger if exists leads_open_house_snapshot on public.leads;
create trigger leads_open_house_snapshot
  before insert on public.leads
  for each row execute function public.leads_open_house_snapshot();

-- ‏עדכון לא מוחק זכות שכבר ניתנה: העמודות לא נכתבות אחרי ההכנסה
create or replace function public.leads_open_house_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.open_house_eligible := old.open_house_eligible;
  new.open_house_end_snapshot := old.open_house_end_snapshot;
  return new;
end;
$$;

revoke all on function public.leads_open_house_freeze() from public, anon, authenticated;

drop trigger if exists leads_open_house_freeze on public.leads;
create trigger leads_open_house_freeze
  before update of open_house_eligible, open_house_end_snapshot on public.leads
  for each row execute function public.leads_open_house_freeze();

-- ‏leads_masked: שתי העמודות בסוף (‏create or replace view - עמודה חדשה רק בסוף).
-- הגוף הועתק מהפרודקשן ב-27.10.2026.
create or replace view public.leads_masked as
 SELECT id,
    lead_type,
    deal_type,
    property_id,
    agency_id,
    agent_id,
    status,
    quota_source,
        CASE
            WHEN (status = 'unlocked'::text) THEN raw_name
            WHEN (raw_name IS NULL) THEN NULL::text
            ELSE ((left(split_part(raw_name, ' '::text, 1), 1) || repeat('*'::text, GREATEST((length(split_part(raw_name, ' '::text, 1)) - 1), 0))) ||
            CASE
                WHEN (POSITION((' '::text) IN (raw_name)) > 0) THEN ((' '::text || left(split_part(raw_name, ' '::text, 2), 1)) || repeat('*'::text, GREATEST((length(split_part(raw_name, ' '::text, 2)) - 1), 0)))
                ELSE ''::text
            END)
        END AS display_name,
        CASE
            WHEN (status = 'unlocked'::text) THEN raw_phone
            WHEN (raw_phone IS NULL) THEN NULL::text
            ELSE (((left(regexp_replace(raw_phone, '[^0-9]'::text, ''::text, 'g'::text), 2) || '-'::text) || repeat('*'::text, GREATEST((length(regexp_replace(raw_phone, '[^0-9]'::text, ''::text, 'g'::text)) - 3), 0))) || right(regexp_replace(raw_phone, '[^0-9]'::text, ''::text, 'g'::text), 1))
        END AS display_phone,
    city,
    neighborhood_id,
    property_type,
    unlocked_at,
    unlocked_by,
    created_at,
    property_details,
        CASE
            WHEN (status = 'unlocked'::text) THEN raw_message
            ELSE NULL::text
        END AS display_message,
    source,
    referred_by,
    referred_at,
    source_detail,
    origin_id,
    open_house_eligible,
    open_house_end_snapshot
   FROM public.leads l;

alter view public.leads_masked set (security_invoker = true);

-- ‏ההתראה לסוכן/ת על ליד חדש: אותה שורה כמו בכרטיס. הגוף מהפרודקשן (27.10.2026)
-- ועוד שורה אחת.
create or replace function public.notify_agent_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_title text;
  v_body  text;
  v_where text;
begin
  if new.agent_id is null then
    return new;
  end if;
  -- 20270712090000: על שיחה כבר יוצא סיכום בוואטסאפ, ורכישה נעשתה הרגע בלחיצה
  if new.lead_type in ('call', 'store') then
    return new;
  end if;

  v_title := case new.lead_type
    when 'owner_inbound'         then 'ליד חדש: בעל נכס'
    when 'property_inquiry'      then 'ליד חדש: התעניינות בנכס'
    when 'agent_direct_inquiry'  then 'ליד חדש: פנייה ישירה אליך'
    -- 20270812090000: פוסט בפייסבוק של מי שמחפש/ת, אחרי שהסכים/ה שנחזור
    when 'seeker_inbound'        then 'ליד חדש: מחפש/ת נכס'
    else 'ליד חדש'
  end;

  v_where := coalesce(nullif(new.city, ''), 'עפולה');
  v_body := v_where
    || coalesce(' · ' || nullif(new.property_type, ''), '')
    || case new.deal_type when 'sale' then ' · מכירה' when 'rent' then ' · השכרה' else '' end
    || case when new.status = 'unlocked' then ' · פתוח' else ' · ממתין לפתיחה' end
    -- חלק 7 §A.4b: הזכאות נקבעה ברגע הפנייה (leads_open_house_snapshot)
    || case when new.open_house_eligible then ' · פנייה בתקופת היריד · ללא עמלת תיווך' else '' end;

  insert into public.notifications (agent_id, type, title, body, related_lead_id)
  values (new.agent_id, 'new_lead', v_title, v_body, new.id);

  return new;
end;
$function$;
