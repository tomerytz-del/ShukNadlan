-- ============================================================================
-- רישום פניות היריד: מתי פנייה על נכס ביריד הבתים הפתוחים התקבלה, בשעת השרת
--
-- קונה שפנה/תה לנכס ביריד דרך האתר לפני סוף היריד לא משלם/ת עמלת תיווך.
-- עד היום שום דבר בשרת לא רשם *מתי* פנייה כזו התקבלה באופן ששורד את סוף
-- היריד: הדגל open_house נכבה בסופו, וסוכן/ת יכול/ה למחוק ליד. הטבלה כאן
-- היא העדות - שורה אחת לכל ליד שנוצר בזמן שחלון היריד של הנכס פתוח.
--
--   ‏fair_inquiries            - יומן שמוסיפים לו בלבד. אין מחיקה ואין עריכה,
--                               חוץ מניקוי הפרטים האישיים ומה שהמפתחות הזרים
--                               מנקים בעצמם
--   ‏leads_log_fair_inquiry    - טריגר after insert על leads. בולע את השגיאות
--                               שלו: רישום לעולם אינו שובר קליטת ליד
--   ‏admin_fair_inquiries      - הייצוא של מנהל/ת הפלטפורמה (CSV ב-CRM)
--   ‏fair_inquiries_pii_purge  - שם וטלפון נמחקים אחרי שנתיים (כמו leads_pii)
--   ‏fair_contact_logging_enabled = 0 - לרישום לחיצות וואטסאפ וחיוג (PR נפרד)
--
-- **הסיווג.** טופס (דף הנכס, ההחלקה, בקשת תמונות) והדמיה - eligible. ליד
-- מפייסבוק ומאינסטגרם (‏social-lead-intake) ומטופס של מטא - נרשם עם המקור,
-- ‏external_ref ושעת הפלטפורמה, אבל pending_owner_decision: אין ויתור אוטומטי,
-- תומר מחליט. כל מקור שלא ברשימה הסגורה של eligible נופל ל-pending, ולא
-- להפך. ‏social-lead-intake עובר דרך property-inquiry-intake עם property_id,
-- ולכן ההבחנה היא לפי source ולא לפי סוג הליד.
--
-- **החלון נקבע כאן, בשעון השרת** (‏now()), ולא מהדפדפן או מ-created_at של
-- הליד. השוואה בין timestamptz - אותה תוצאה בכל אזור זמן של החיבור. ‏Asia/
-- Jerusalem משמש רק ל-fair_key ולתצוגה.
--
-- רק תוספות: טבלה, פונקציות, טריגר, שורה ב-pricing_config ושורה ב-
-- data_retention_settings. לא נוגעת ב-leads_masked, ב-notify_agent_on_new_lead
-- או ב-data_retention_run. ‏docs/open-house-fair.md, "רישום פניות היריד".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הטבלה
--
-- ‏property_id ב-set null ולא restrict: ה-CRM מוחק נכס ב-delete, ו-restrict
-- היה מפיל מחיקה של נכס שהייתה עליו פנייה ביריד. העדות נשמרת ב-property_label.
-- ‏lead_id ב-set null מאותה סיבה: סוכן/ת יכול/ה למחוק ליד, והשם והטלפון
-- נשמרים כאן בדיוק בשביל זה.
-- ---------------------------------------------------------------------------
create table if not exists public.fair_inquiries (
  id                 uuid primary key default gen_random_uuid(),
  ref                bigint generated always as identity unique,
  created_at         timestamptz not null default now(),
  property_id        uuid references public.properties(id) on delete set null,
  property_label     text,
  agent_id           uuid references public.agency_members(id) on delete set null,
  agency_id          uuid references public.agencies(id) on delete set null,
  channel            text not null,
  status             text not null,
  source             text,
  source_page        text,
  lead_type          text,
  external_ref       text,
  platform_at        timestamptz,
  fair_key           text not null,
  fair_start         timestamptz not null,
  fair_end           timestamptz not null,
  lead_id            uuid references public.leads(id) on delete set null,
  visitor_name       text,
  visitor_phone_e164 text,
  client_session     text,
  ip_hash            text,
  constraint fair_inquiries_channel_chk
    check (channel in ('form', 'visualization', 'social', 'meta_ads', 'whatsapp_click', 'call_click')),
  constraint fair_inquiries_status_chk
    check (status in ('eligible', 'pending_owner_decision')),
  constraint fair_inquiries_source_page_chk
    check (source_page is null or source_page in ('property', 'swipe', 'open_house', 'app')),
  constraint fair_inquiries_window_chk
    check (fair_end > fair_start and created_at >= fair_start and created_at <= fair_end),
  constraint fair_inquiries_session_len_chk
    check (client_session is null or length(client_session) <= 64)
);

comment on table public.fair_inquiries is
  'יומן פניות על נכסים ביריד הבתים הפתוחים, בשעת השרת. מוסיפים בלבד. docs/open-house-fair.md';

create index if not exists fair_inquiries_created_idx  on public.fair_inquiries (created_at desc);
create index if not exists fair_inquiries_agent_idx    on public.fair_inquiries (agent_id, created_at desc);
create index if not exists fair_inquiries_property_idx on public.fair_inquiries (property_id, created_at desc);
create index if not exists fair_inquiries_fair_idx     on public.fair_inquiries (fair_key, created_at);
create unique index if not exists fair_inquiries_lead_key
  on public.fair_inquiries (lead_id) where lead_id is not null;
create index if not exists fair_inquiries_rate_idx
  on public.fair_inquiries (ip_hash, property_id, created_at desc) where ip_hash is not null;

-- ---------------------------------------------------------------------------
-- 2. שורה שנכתבה לא משתנה
--
-- מותר רק: מפתח זר שמתנקה (מחיקת ליד, נכס, סוכן/ת או משרד), ניקוי השם
-- והטלפון (שמירת הנתונים), ומילוי חד-פעמי של platform_at ו-source_page
-- (‏property-inquiry-intake, אחרי ה-insert). מחיקה - אף פעם.
-- ---------------------------------------------------------------------------
create or replace function public.fair_inquiries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_free constant text[] := array['property_id', 'agent_id', 'agency_id', 'lead_id',
                                  'visitor_name', 'visitor_phone_e164', 'platform_at', 'source_page'];
begin
  if tg_op = 'DELETE' then
    raise exception 'fair_inquiries_append_only' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free)
     or (new.property_id is distinct from old.property_id and new.property_id is not null)
     or (new.agent_id is distinct from old.agent_id and new.agent_id is not null)
     or (new.agency_id is distinct from old.agency_id and new.agency_id is not null)
     or (new.lead_id is distinct from old.lead_id and new.lead_id is not null)
     or (new.visitor_name is distinct from old.visitor_name and new.visitor_name is not null)
     or (new.visitor_phone_e164 is distinct from old.visitor_phone_e164 and new.visitor_phone_e164 is not null)
     or (old.platform_at is not null and new.platform_at is distinct from old.platform_at)
     or (old.source_page is not null and new.source_page is distinct from old.source_page) then
    raise exception 'fair_inquiries_append_only' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.fair_inquiries_guard() from public, anon, authenticated;

drop trigger if exists fair_inquiries_guard on public.fair_inquiries;
create trigger fair_inquiries_guard
  before update or delete on public.fair_inquiries
  for each row execute function public.fair_inquiries_guard();

-- ---------------------------------------------------------------------------
-- 3. הרשאות
--
-- ‏anon - כלום. ‏authenticated - קריאה של השורות שלו/ה (ומנהל/ת - של המשרד),
-- בלי עמודות השם והטלפון: הפרטים עצמם נשארים ב-leads, עם המיסוך והפתיחה
-- הרגילים. ‏service_role - קריאה וכתיבה (‏property-inquiry-intake); עריכה
-- רק של שתי העמודות שהשומר מאפשר למלא.
-- ---------------------------------------------------------------------------
alter table public.fair_inquiries enable row level security;

revoke all on table public.fair_inquiries from public, anon, authenticated, service_role;
grant select, insert on table public.fair_inquiries to service_role;
grant update (platform_at, source_page) on table public.fair_inquiries to service_role;
grant select (id, ref, created_at, property_id, property_label, agent_id, agency_id, channel, status,
              source, source_page, lead_type, fair_key, fair_start, fair_end, lead_id)
  on table public.fair_inquiries to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'fair_inquiries'
                    and policyname = 'agent reads own fair inquiries') then
    create policy "agent reads own fair inquiries" on public.fair_inquiries
      for select to authenticated
      using (
        -- דרך הליד: מי שהליד אצלו עכשיו (גם אחרי הפנייה בין יועצים או שחרור),
        -- לפי ה-RLS של leads עצמה. ‏agent_id ו-agency_id כאן הם צילום ולא בעלות
        exists (select 1 from public.leads l where l.id = fair_inquiries.lead_id)
        or (lead_id is null
            and (agent_id = public.current_agent_id()
                 or (agency_id = public.current_agency_id() and public.current_member_role() = 'manager'))));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. הרישום
--
-- ‏_fair_inquiry_log - הליבה, אחת לטריגר ולמילוי לאחור. ‏p_at הוא הרגע
-- שנבדק מול החלון ונרשם כ-created_at: ‏now() בטריגר, ‏created_at של הליד
-- במילוי לאחור (הזמן היחיד שיש שם). ‏p_trusted - הליד נכתב בידי service
-- role (פונקציות הקליטה). ליד שיועץ/ת כתב/ה ישירות דרך PostgREST
-- (‏"agent insert own leads") נרשם, אבל לעולם אינו eligible.
-- ---------------------------------------------------------------------------
create or replace function public._fair_inquiry_log(p_lead public.leads, p_at timestamptz, p_trusted boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p       record;
  v_channel text;
  v_status  text;
begin
  if p_lead.property_id is null
     or p_lead.lead_type is null
     or p_lead.lead_type not in ('property_inquiry', 'visualization') then
    return;
  end if;

  select pr.id, pr.agent_id, pr.agency_id, pr.title, pr.city,
         pr.open_house, pr.open_house_start, pr.open_house_end
    into v_p
    from public.properties pr
   where pr.id = p_lead.property_id;

  if not found or v_p.open_house is not true
     or v_p.open_house_start is null or v_p.open_house_end is null
     or not (v_p.open_house_start <= p_at and p_at <= v_p.open_house_end) then
    return;
  end if;

  v_channel := case
    when p_lead.lead_type = 'visualization' then 'visualization'
    when p_lead.source in ('facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment') then 'social'
    when p_lead.source like 'meta\_ads\_%' then 'meta_ads'
    else 'form'
  end;
  -- רשימה סגורה של מה שזכאי. מקור חדש שלא נכנס לכאן נופל להחלטת תומר
  v_status := case
    when p_trusted
         and v_channel in ('form', 'visualization')
         and (p_lead.source is null or p_lead.source in ('swipe', 'photo_request')) then 'eligible'
    else 'pending_owner_decision'
  end;

  insert into public.fair_inquiries (
    created_at, property_id, property_label, agent_id, agency_id, channel, status, source,
    lead_type, external_ref, fair_key, fair_start, fair_end, lead_id, visitor_name, visitor_phone_e164)
  values (
    p_at, p_lead.property_id,
    nullif(concat_ws(' · ', nullif(btrim(v_p.title), ''), nullif(btrim(v_p.city), '')), ''),
    coalesce(p_lead.agent_id, v_p.agent_id), coalesce(p_lead.agency_id, v_p.agency_id),
    v_channel, v_status,
    coalesce(p_lead.source, case when v_channel = 'visualization' then 'visualization' else 'property_page' end),
    p_lead.lead_type, p_lead.external_ref,
    'oh:' || to_char(v_p.open_house_start at time zone 'Asia/Jerusalem', 'YYYYMMDD') || '-' ||
             to_char(v_p.open_house_end   at time zone 'Asia/Jerusalem', 'YYYYMMDD'),
    v_p.open_house_start, v_p.open_house_end, p_lead.id,
    p_lead.raw_name, coalesce(p_lead.phone_e164, p_lead.raw_phone))
  on conflict (lead_id) where lead_id is not null do nothing;
end $$;

revoke all on function public._fair_inquiry_log(public.leads, timestamptz, boolean) from public, anon, authenticated;

create or replace function public.leads_log_fair_inquiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- בלי JWT בכלל (מיגרציה, cron, psql) נחשב service role, כמו auth.role()
  perform public._fair_inquiry_log(new, now(),
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
             nullif(current_setting('request.jwt.claim.role', true), ''),
             'service_role') = 'service_role');
  return new;
exception when others then
  -- רישום לעולם אינו שובר קליטת ליד (אותו כלל כמו lead-routing.ts)
  raise warning 'leads_log_fair_inquiry failed for lead %: %', new.id, sqlerrm;
  return new;
end $$;

revoke all on function public.leads_log_fair_inquiry() from public, anon, authenticated;

drop trigger if exists leads_log_fair_inquiry on public.leads;
create trigger leads_log_fair_inquiry
  after insert on public.leads
  for each row execute function public.leads_log_fair_inquiry();

-- מילוי לאחור: לידים שכבר נכנסו בתוך החלון הנוכחי של הנכס שלהם. היום זה
-- אפס שורות (לנכס היחיד ביריד אין לידים מאז 5.10), ונשאר ליתר ביטחון.
-- ‏on conflict בליבה - הרצה חוזרת אינה מכפילה.
do $$
declare
  l public.leads;
begin
  for l in
    select le.*
      from public.leads le
      join public.properties pr on pr.id = le.property_id
     where le.lead_type in ('property_inquiry', 'visualization')
       and pr.open_house is true
       and pr.open_house_start is not null and pr.open_house_end is not null
       and le.created_at between pr.open_house_start and pr.open_house_end
  loop
    perform public._fair_inquiry_log(l, l.created_at);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. הייצוא של מנהל/ת הפלטפורמה
-- ---------------------------------------------------------------------------
create or replace function public.admin_fair_inquiries(
  p_from     timestamptz default now() - interval '90 days',
  p_to       timestamptz default now(),
  p_fair_key text default null
)
returns table (
  ref                bigint,
  created_at_il      text,
  fair_end_il        text,
  fair_key           text,
  channel            text,
  status             text,
  source             text,
  source_page        text,
  external_ref       text,
  platform_at_il     text,
  property_id        uuid,
  property_title     text,
  property_city      text,
  agent_name         text,
  agency_name        text,
  lead_id            uuid,
  visitor_name       text,
  visitor_phone_e164 text,
  in_window          boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.current_is_platform_admin(), false) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  return query
  select f.ref,
         to_char(f.created_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI:SS'),
         to_char(f.fair_end   at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI:SS'),
         f.fair_key, f.channel, f.status, f.source, f.source_page, f.external_ref,
         to_char(f.platform_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI:SS'),
         f.property_id,
         coalesce(pr.title, f.property_label),
         pr.city,
         am.display_name,
         ag.name,
         f.lead_id, f.visitor_name, f.visitor_phone_e164,
         (f.created_at >= f.fair_start and f.created_at <= f.fair_end)
    from public.fair_inquiries f
    left join public.properties pr     on pr.id = f.property_id
    left join public.agency_members am on am.id = f.agent_id
    left join public.agencies ag       on ag.id = f.agency_id
   where f.created_at >= p_from
     and f.created_at <= p_to
     and (p_fair_key is null or f.fair_key = p_fair_key)
   order by f.created_at;
end $$;

revoke all on function public.admin_fair_inquiries(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_fair_inquiries(timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. שם וטלפון נמחקים אחרי שנתיים (החלטת תומר, 29.10)
--
-- המדיניות ב-data_retention_settings כמו כל השאר, והמחיקה במשימה חודשית
-- משלה: data_retention_run אינה משתנה כאן. היא תרשום את המדיניות עם 0
-- (אינה מכירה את הטבלה) עד שתצורף אליה. השורה נשארת, רק הפרטים נמחקים.
-- ---------------------------------------------------------------------------
insert into public.data_retention_settings (policy, keep_for, enabled, description)
values (
  'fair_inquiries_pii',
  interval '2 years',
  true,
  'שם וטלפון ביומן פניות היריד - השורה נשארת. נמחק במשימה החודשית fair-inquiries-pii-purge.'
)
on conflict (policy) do nothing;

create or replace function public.fair_inquiries_pii_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s   record;
  v_n integer := 0;
begin
  select * into s from public.data_retention_settings where policy = 'fair_inquiries_pii';
  if not found then
    return 0;
  end if;
  if s.enabled then
    update public.fair_inquiries
       set visitor_name = null, visitor_phone_e164 = null
     where created_at < now() - s.keep_for
       and (visitor_name is not null or visitor_phone_e164 is not null);
    get diagnostics v_n = row_count;
  else
    select count(*) into v_n from public.fair_inquiries
     where created_at < now() - s.keep_for
       and (visitor_name is not null or visitor_phone_e164 is not null);
  end if;
  insert into public.data_retention_runs (policy, dry_run, affected, details)
  values ('fair_inquiries_pii', not s.enabled, v_n,
          jsonb_build_object('fair_inquiries', v_n, 'job', 'fair-inquiries-pii-purge'));
  return v_n;
end $$;

revoke all on function public.fair_inquiries_pii_purge() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - המשימה fair-inquiries-pii-purge לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('fair-inquiries-pii-purge')
    where exists (select 1 from cron.job where jobname = 'fair-inquiries-pii-purge');
  -- פעם בחודש, ב-2 לחודש ב-04:47 UTC: רחוק מ-data-retention-run (‏53 3)
  perform cron.schedule('fair-inquiries-pii-purge', '47 4 2 * *',
                        $cron$select public.fair_inquiries_pii_purge()$cron$);
end $$;

-- ---------------------------------------------------------------------------
-- 7. הדגל ללחיצות (הנקודה עצמה ב-PR נפרד). נולד 0
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description)
values ('fair_contact_logging_enabled', 0,
  '1: רישום לחיצות וואטסאפ וחיוג בנכסי יריד (fair-contact-log) פעיל. 0: כבוי. רישום פניות מהטופס (fair_inquiries) פעיל תמיד, בלי קשר לדגל.')
on conflict (key) do nothing;
