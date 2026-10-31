-- ============================================================================
-- רישום פניות היריד תמיד פעיל, בלי דגל (החלטת תומר, 31.10.2026)
-- ----------------------------------------------------------------------------
-- ‏fair_contact_logging_enabled נולד 0 ב-20271031220000 והודלקה ל-1
-- ב-20271031340000. שום קוד לא קרא אותו: הטריגר leads_log_fair_inquiry רושם
-- פנייה מהטופס תמיד. הדגל היה מתג כבוי בלי צרכן, ולכן הוא יורד. אין מצב כבוי.
--
-- רישום לחיצות וואטסאפ וחיוג (‏fair-contact-log) לא נבנה, ואינו נבנה כאן.
--
-- שמירה: עד היום נמחקו רק השם והטלפון אחרי שנתיים, והשורה נשארה. מכאן השורה
-- כולה נמחקת אחרי שנתיים (‏fair_inquiries_purge), באותו אופק של
-- fair_inquiries_pii. המחיקה רק כשהפונקציה מסמנת את הטרנזקציה; כל מחיקה
-- אחרת נשארת חסומה ב-fair_inquiries_guard.
--
-- יועץ/ת רואה מהשורה רק ערוץ, שעה, סטטוס, ואת שני השדות שהתג ב-CRM קורא
-- (‏lead_id, fair_end). בלי שם, טלפון, תווית נכס או מקור.
-- אידמפוטנטית. ‏docs/open-house-fair.md, "רישום פניות היריד".
-- ============================================================================

delete from public.pricing_config
 where key = 'fair_contact_logging_enabled';

-- ---------------------------------------------------------------------------
-- השומר: מחיקה רק ממשימת השמירה
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
    if coalesce(current_setting('fair_inquiries.purge', true), '') is distinct from '1' then
      raise exception 'fair_inquiries_append_only' using errcode = '42501';
    end if;
    return old;
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

-- ---------------------------------------------------------------------------
-- מחיקת השורה אחרי שנתיים. השם והטלפון עדיין מתנקים ב-fair_inquiries_pii_purge
-- (אותו אופק); אם המחיקה רצה קודם, אין מה לנקות.
-- ---------------------------------------------------------------------------
insert into public.data_retention_settings (policy, keep_for, enabled, description)
values (
  'fair_inquiries',
  interval '2 years',
  true,
  'שורה ביומן פניות היריד נמחקת כולה. המשימה החודשית fair-inquiries-purge.'
)
on conflict (policy) do nothing;

create or replace function public.fair_inquiries_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s   record;
  v_n integer := 0;
begin
  select * into s from public.data_retention_settings where policy = 'fair_inquiries';
  if not found then
    return 0;
  end if;
  if s.enabled then
    perform set_config('fair_inquiries.purge', '1', true);
    delete from public.fair_inquiries
     where created_at < now() - s.keep_for;
    get diagnostics v_n = row_count;
  else
    select count(*) into v_n from public.fair_inquiries
     where created_at < now() - s.keep_for;
  end if;
  insert into public.data_retention_runs (policy, dry_run, affected, details)
  values ('fair_inquiries', not s.enabled, v_n,
          jsonb_build_object('fair_inquiries', v_n, 'job', 'fair-inquiries-purge'));
  return v_n;
end $$;

revoke all on function public.fair_inquiries_purge() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - המשימה fair-inquiries-purge לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('fair-inquiries-purge')
    where exists (select 1 from cron.job where jobname = 'fair-inquiries-purge');
  -- פעם בחודש, ב-2 לחודש ב-05:17 UTC: אחרי fair-inquiries-pii-purge (‏47 4)
  perform cron.schedule('fair-inquiries-purge', '17 5 2 * *',
                        $cron$select public.fair_inquiries_purge()$cron$);
end $$;

-- ---------------------------------------------------------------------------
-- מה שיועץ/ת קורא/ת מהיומן: ערוץ, שעה, סטטוס, והשניים שהתג ב-CRM צריך.
-- לא שם, לא טלפון, לא תווית, לא מקור.
-- ---------------------------------------------------------------------------
revoke select (id, ref, property_id, property_label, agent_id, agency_id,
               source, source_page, lead_type, fair_key, fair_start)
  on table public.fair_inquiries from authenticated;

grant select (created_at, channel, status, fair_end, lead_id)
  on table public.fair_inquiries to authenticated;
