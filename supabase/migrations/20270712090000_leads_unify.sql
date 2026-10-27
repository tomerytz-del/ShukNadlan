-- ---------------------------------------------------------------------------
-- "הלידים שלי" אחד: שיחה וליד שנרכש בחנות הופכים לליד
--
-- עד היום ל"הלידים שלי" הגיעו רק פניות מהאתר ולידי בעלים (leads). שיחה למספר
-- וירטואלי ישבה ב-agent_calls, וליד שנקנה בחנות - בטבלה של החנות שלו
-- (rss_leads, saved_searches, mortgage_leads) עם sold_to_agent_id. שלושה
-- מקומות, ולשניים מהם אין שלב, ארכיון או זמן תגובה. (docs/leads-unified.md;
-- העיצוב: docs/handoff/crm-settings-redesign, סעיף 3.10. החלטה של תומר,
-- 20.10.2026: האיחוד במסד ולא רק במסך.)
--
-- מה נכנס:
--   1. lead_type חדשים: 'call' ו-'store'. ‏**האילוץ נבנה מחדש ממה שקיים**
--      ועוד השניים - לא רשימה קשיחה, שהייתה מוחקת סוג ש-PR מקביל הוסיף.
--   2. leads.origin_id (השיחה או ליד החנות) עם ייחוד לפי (lead_type, origin_id)
--      - טריגר שרץ פעמיים לא יוצר ליד כפול. ‏leads.source_detail - "שלט ליד
--      המשטרה", "מחפשי דירה". ‏agent_calls.lead_id.
--   3. שיחה נכנסת ממספר שאינו בקובץ הלקוחות -> ליד, אלא אם יש כבר ליד פתוח
--      מאותו מספר ב-30 הימים האחרונים (אז השיחה מקושרת אליו). שיחה שנענתה
--      נרשמת כנענתה מיד; שיחה שטופלה אחר כך - agent_calls_first_response
--      הקיים כבר מסמן אותה לפי הטלפון. הסיכום והשם מהשיחה נכנסים לליד
--      כשהם מגיעים (עדכון של agent_calls).
--   4. רכישה בחנות (sold_to_agent_id שנקבע) -> ליד פתוח, בלי חיוב נוסף.
--   5. notify_agent_on_new_lead לא מצלצל על השניים: על שיחה כבר יוצא סיכום
--      בוואטסאפ (twilio-voice), ועל רכישה - הסוכן/ת לחץ/ה "קנייה" עכשיו. העתק
--      מלא של הגרסה בפרודקשן (md5 8de595d9...; אינה בשום מיגרציה), ותנאי אחד.
--   6. leads_masked: source_detail ו-origin_id בסוף ה-view.
--   7. backfill: רכישות קיימות (4 מחפשי דירה ו-1 משכנתא ב-20.10.2026) ושיחות
--      פתוחות מ-30 הימים האחרונים (2).
--
-- **מה זה משנה בדאשבורד המשרד:** שיחות ורכישות נספרות מעכשיו כלידים, וזמן
-- התגובה שלהן נמדד. זו ההחלטה; המספרים יעלו.
--
-- אידמפוטנטית.
-- ---------------------------------------------------------------------------

-- 1. סוגי הליד: מה שקיים ועוד 'call' ו-'store'
do $$
declare
  v_def   text;
  v_types text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'leads_lead_type_check' and conrelid = 'public.leads'::regclass;
  select coalesce(array_agg(m[1]), '{}') into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
  v_types := array(select distinct unnest(v_types || array['property_inquiry', 'owner_inbound', 'agent_direct_inquiry', 'visualization', 'call', 'store']) order by 1);
  alter table public.leads drop constraint if exists leads_lead_type_check;
  execute format('alter table public.leads add constraint leads_lead_type_check check (lead_type = any (%L::text[]))', v_types);
end $$;

-- 2. עמודות
alter table public.leads add column if not exists origin_id uuid;
alter table public.leads add column if not exists source_detail text;
alter table public.agent_calls add column if not exists lead_id uuid;

create unique index if not exists leads_origin_uniq
  on public.leads (lead_type, origin_id) where origin_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_calls_lead_id_fkey') then
    alter table public.agent_calls add constraint agent_calls_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_source_detail_len') then
    alter table public.leads add constraint leads_source_detail_len
      check (source_detail is null or char_length(source_detail) <= 120);
  end if;
end $$;

create index if not exists agent_calls_lead_id_idx on public.agent_calls (lead_id) where lead_id is not null;

comment on column public.leads.origin_id is
  'השיחה (agent_calls.id) או ליד החנות (rss_leads / saved_searches / mortgage_leads) שממנו נולד הליד. ייחודי לפי lead_type. docs/leads-unified.md';
comment on column public.leads.source_detail is
  'פרט על המקור שמוצג בתגית: שם המספר הווירטואלי, החנות שממנה נרכש. docs/leads-unified.md';

-- ---------------------------------------------------------------------------
-- 3. שיחה -> ליד
-- ---------------------------------------------------------------------------
create or replace function public.agent_call_to_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tail   text := public.phone_tail9(new.from_number);
  v_lead   uuid;
  v_agency uuid;
  v_label  text;
begin
  if new.direction is distinct from 'inbound' or new.agent_id is null or v_tail is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- מספר שכבר בקובץ הלקוחות אינו ליד
    if new.client_id is not null then
      return new;
    end if;
    -- ליד פתוח מאותו מספר ב-30 הימים האחרונים - השיחה מצטרפת אליו
    select l.id into v_lead
      from public.leads l
     where l.agent_id = new.agent_id
       and public.phone_tail9(l.raw_phone) = v_tail
       and l.created_at > now() - interval '30 days'
       and not exists (select 1 from public.lead_archives a where a.lead_id = l.id)
     order by l.created_at desc
     limit 1;
    if v_lead is null then
      select m.agency_id into v_agency from public.agency_members m where m.id = new.agent_id;
      select nullif(btrim(pl.label), '') into v_label from public.agent_phone_lines pl where pl.id = new.line_id;
      insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_phone, raw_name,
                                raw_message, source, source_detail, origin_id, created_at, first_response_at)
      values ('call', new.agent_id, v_agency, 'unlocked', new.created_at, new.from_number,
              nullif(btrim(new.extracted ->> 'caller_name'), ''), new.summary, 'call', v_label, new.id,
              new.created_at, case when new.status = 'answered' then new.created_at end)
      on conflict (lead_type, origin_id) where origin_id is not null do nothing
      returning id into v_lead;
    end if;
    if v_lead is not null then
      update public.agent_calls set lead_id = v_lead where id = new.id and lead_id is null;
    end if;
    return new;
  end if;

  -- UPDATE: הסיכום, השם ו"נענתה" מגיעים אחרי השיחה
  if new.lead_id is not null then
    update public.leads l
       set raw_message = coalesce(l.raw_message, new.summary),
           raw_name = coalesce(l.raw_name, nullif(btrim(new.extracted ->> 'caller_name'), '')),
           first_response_at = coalesce(l.first_response_at,
                                        case when new.status = 'answered' then new.created_at end)
     where l.id = new.lead_id and l.lead_type = 'call';
  end if;
  return new;
end $$;

comment on function public.agent_call_to_lead() is
  'שיחה נכנסת ממספר שאינו בקובץ הלקוחות הופכת לליד (או מצטרפת לליד פתוח מאותו מספר). docs/leads-unified.md';
revoke all on function public.agent_call_to_lead() from public, anon, authenticated;

-- ‏a_ בשם: לפני trg_agent_calls_first_response, שמסמן מענה לפי הטלפון
drop trigger if exists a_agent_calls_to_lead on public.agent_calls;
create trigger a_agent_calls_to_lead
  after insert or update of summary, extracted, status on public.agent_calls
  for each row execute function public.agent_call_to_lead();

-- ---------------------------------------------------------------------------
-- 4. רכישה בחנות -> ליד
-- ---------------------------------------------------------------------------
create or replace function public.store_purchase_to_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
  v_name   text;
  v_phone  text;
  v_msg    text;
  v_detail text;
  v_city   text;
  v_type   text;
  v_deal   text;
begin
  if new.sold_to_agent_id is null or (tg_op = 'UPDATE' and old.sold_to_agent_id is not distinct from new.sold_to_agent_id) then
    return new;
  end if;
  select m.agency_id into v_agency from public.agency_members m where m.id = new.sold_to_agent_id;

  if tg_table_name = 'rss_leads' then
    v_detail := 'חנות הלידים';
    v_msg    := coalesce(nullif(btrim(new.raw_content), ''), new.teaser_description);
    v_city   := new.city;
    v_type   := new.property_type;
  elsif tg_table_name = 'saved_searches' then
    v_detail := 'מחפשי דירה';
    v_name   := new.full_name;
    v_phone  := coalesce(new.phone_e164, new.phone);
    v_msg    := coalesce(nullif(btrim(new.free_text), ''), new.label);
    v_city   := new.cities[1];
    v_type   := new.property_types[1];
    v_deal   := case when new.deal_type in ('sale', 'rent') then new.deal_type end;
  elsif tg_table_name = 'mortgage_leads' then
    v_detail := 'משכנתאות';
    v_name   := new.full_name;
    v_phone  := coalesce(new.phone_e164, new.phone);
    v_msg    := 'ליד ייעוץ משכנתא'
                || coalesce(' · הלוואה ₪' || to_char(new.loan_amount, 'FM999,999,999'), '');
  else
    return new;
  end if;

  insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_name, raw_phone,
                            raw_message, city, property_type, deal_type, source, source_detail, origin_id, created_at)
  values ('store', new.sold_to_agent_id, v_agency, 'unlocked', coalesce(new.sold_at, now()), v_name, v_phone,
          left(v_msg, 4000), v_city, v_type, v_deal, 'store', v_detail, new.id, coalesce(new.sold_at, now()))
  on conflict (lead_type, origin_id) where origin_id is not null do nothing;
  return new;
end $$;

comment on function public.store_purchase_to_lead() is
  'ליד שנרכש בחנות (rss_leads / saved_searches / mortgage_leads) נכנס ל"הלידים שלי" כליד פתוח. docs/leads-unified.md';
revoke all on function public.store_purchase_to_lead() from public, anon, authenticated;

drop trigger if exists store_purchase_to_lead on public.rss_leads;
create trigger store_purchase_to_lead after update of sold_to_agent_id on public.rss_leads
  for each row execute function public.store_purchase_to_lead();
drop trigger if exists store_purchase_to_lead on public.saved_searches;
create trigger store_purchase_to_lead after update of sold_to_agent_id on public.saved_searches
  for each row execute function public.store_purchase_to_lead();
drop trigger if exists store_purchase_to_lead on public.mortgage_leads;
create trigger store_purchase_to_lead after update of sold_to_agent_id on public.mortgage_leads
  for each row execute function public.store_purchase_to_lead();

-- ---------------------------------------------------------------------------
-- 5. בלי צלצול "ליד חדש" על שיחה ועל רכישה (העתק מלא מהפרודקשן + תנאי אחד)
-- ---------------------------------------------------------------------------
create or replace function public.notify_agent_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    else 'ליד חדש'
  end;

  v_where := coalesce(nullif(new.city, ''), 'עפולה');
  v_body := v_where
    || coalesce(' · ' || nullif(new.property_type, ''), '')
    || case new.deal_type when 'sale' then ' · מכירה' when 'rent' then ' · השכרה' else '' end
    || case when new.status = 'unlocked' then ' · פתוח' else ' · ממתין לפתיחה' end;

  insert into public.notifications (agent_id, type, title, body, related_lead_id)
  values (new.agent_id, 'new_lead', v_title, v_body, new.id);

  return new;
end;
$$;

revoke all on function public.notify_agent_on_new_lead() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. leads_masked - שתי עמודות חדשות בסוף
--
-- security_invoker חובה. create or replace בלי האפשרות מאפס אותה, וה-view
-- חוזר לרוץ כבעלים (postgres, BYPASSRLS) בלי where. כך מפתח ה-anon הציבורי
-- קרא את כל הלידים הפתוחים. הבדיקה scripts/check_leads_masked_invoker.py
-- חוסמת את זה.
--
-- revoke לפני grant: view חדש נולד עם ALL ל-anon ול-authenticated מכוח
-- הרשאות ברירת המחדל של הסכימה, ו-grant select מוסיף ואינו מחליף.
-- ---------------------------------------------------------------------------
create or replace view public.leads_masked
with (security_invoker = true) as
 select id,
    lead_type,
    deal_type,
    property_id,
    agency_id,
    agent_id,
    status,
    quota_source,
        case
            when status = 'unlocked'::text then raw_name
            when raw_name is null then null::text
            else ("left"(split_part(raw_name, ' '::text, 1), 1) || repeat('*'::text, greatest(length(split_part(raw_name, ' '::text, 1)) - 1, 0))) ||
            case
                when position((' '::text) in (raw_name)) > 0 then (' '::text || "left"(split_part(raw_name, ' '::text, 2), 1)) || repeat('*'::text, greatest(length(split_part(raw_name, ' '::text, 2)) - 1, 0))
                else ''::text
            end
        end as display_name,
        case
            when status = 'unlocked'::text then raw_phone
            when raw_phone is null then null::text
            else (("left"(regexp_replace(raw_phone, '[^0-9]'::text, ''::text, 'g'::text), 2) || '-'::text) || repeat('*'::text, greatest(length(regexp_replace(raw_phone, '[^0-9]'::text, ''::text, 'g'::text)) - 3, 0))) || "right"(regexp_replace(raw_phone, '[^0-9]'::text, ''::text, 'g'::text), 1)
        end as display_phone,
    city,
    neighborhood_id,
    property_type,
    unlocked_at,
    unlocked_by,
    created_at,
    property_details,
        case
            when status = 'unlocked'::text then raw_message
            else null::text
        end as display_message,
    source,
    referred_by,
    referred_at,
    source_detail,
    origin_id
   from public.leads l;

revoke all on public.leads_masked from public, anon, authenticated;
grant select on public.leads_masked to authenticated;

-- ---------------------------------------------------------------------------
-- 7. backfill
-- ---------------------------------------------------------------------------
-- רכישות קיימות: אותו מיפוי של store_purchase_to_lead, כ-insert ישיר
insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_name, raw_phone,
                          raw_message, city, property_type, deal_type, source, source_detail, origin_id, created_at)
select 'store', s.sold_to_agent_id, m.agency_id, 'unlocked', coalesce(s.sold_at, now()), s.full_name,
       coalesce(s.phone_e164, s.phone), left(coalesce(nullif(btrim(s.free_text), ''), s.label), 4000),
       s.cities[1], s.property_types[1], case when s.deal_type in ('sale', 'rent') then s.deal_type end,
       'store', 'מחפשי דירה', s.id, coalesce(s.sold_at, now())
  from public.saved_searches s join public.agency_members m on m.id = s.sold_to_agent_id
 where s.sold_to_agent_id is not null
on conflict (lead_type, origin_id) where origin_id is not null do nothing;

insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_name, raw_phone,
                          raw_message, source, source_detail, origin_id, created_at)
select 'store', s.sold_to_agent_id, m.agency_id, 'unlocked', coalesce(s.sold_at, now()), s.full_name,
       coalesce(s.phone_e164, s.phone),
       'ליד ייעוץ משכנתא' || coalesce(' · הלוואה ₪' || to_char(s.loan_amount, 'FM999,999,999'), ''),
       'store', 'משכנתאות', s.id, coalesce(s.sold_at, now())
  from public.mortgage_leads s join public.agency_members m on m.id = s.sold_to_agent_id
 where s.sold_to_agent_id is not null
on conflict (lead_type, origin_id) where origin_id is not null do nothing;

insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_message, city, property_type,
                          source, source_detail, origin_id, created_at)
select 'store', s.sold_to_agent_id, m.agency_id, 'unlocked', coalesce(s.sold_at, now()),
       left(coalesce(nullif(btrim(s.raw_content), ''), s.teaser_description), 4000), s.city, s.property_type,
       'store', 'חנות הלידים', s.id, coalesce(s.sold_at, now())
  from public.rss_leads s join public.agency_members m on m.id = s.sold_to_agent_id
 where s.sold_to_agent_id is not null
on conflict (lead_type, origin_id) where origin_id is not null do nothing;

-- שיחות פתוחות מ-30 הימים האחרונים, ממספר שאינו בקובץ: אותו מסלול
insert into public.leads (lead_type, agent_id, agency_id, status, unlocked_at, raw_phone, raw_name,
                          raw_message, source, source_detail, origin_id, created_at, first_response_at)
select 'call', c.agent_id, m.agency_id, 'unlocked', c.created_at, c.from_number,
       nullif(btrim(c.extracted ->> 'caller_name'), ''), c.summary, 'call', nullif(btrim(pl.label), ''), c.id,
       c.created_at,
       case when c.status = 'answered' then c.created_at else c.handled_at end
  from public.agent_calls c
  join public.agency_members m on m.id = c.agent_id
  left join public.agent_phone_lines pl on pl.id = c.line_id
 where c.direction = 'inbound' and c.client_id is null and c.archived_at is null and c.lead_id is null
   and c.created_at > now() - interval '30 days'
   and public.phone_tail9(c.from_number) is not null
on conflict (lead_type, origin_id) where origin_id is not null do nothing;

update public.agent_calls c set lead_id = l.id
  from public.leads l
 where l.lead_type = 'call' and l.origin_id = c.id and c.lead_id is null;
