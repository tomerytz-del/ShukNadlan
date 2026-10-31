-- ============================================================================
-- לחיצה על וואטסאפ או על חיוג בנכס ביריד נרשמת ב-fair_inquiries
-- ----------------------------------------------------------------------------
-- עד עכשיו נרשמה רק פנייה מהטופס (הטריגר leads_log_fair_inquiry). לחיצה
-- אינה ליד: אין שם ואין טלפון, והכנסה ל-leads הייתה מפעילה התראה. השורה
-- נכתבת כאן ישר ליומן הקיים, באותם ערוצים שכבר הוגדרו (whatsapp_click,
-- call_click), עם אותו חלון, אותה שמירה לשנתיים ואותו טיהור. אין דגל
-- ואין cron חדש.
--
-- מי קורא: רק service_role, מ-fair-contact-log. הדפדפן אינו קורא לפונקציה.
-- השעון הוא now() של השרת. נכס שאינו פעיל או שמחוץ לחלון אינו נרשם.
-- כפילות: אותו דפדפן (client_session) על אותו נכס ואותו ערוץ ב-15 דקות
-- מחזיר את השורה שכבר נכתבה. בלי סשן - אותו ip_hash. תקרות, כולן לשעה:
-- 200 שורות חדשות לאותו גיבוב על אותו נכס, 500 על הנכס מכל הכתובות,
-- 2,000 לאותו גיבוב על כל הנכסים, ו-3,000 על האתר כולו. גיבוב חסר
-- הוא 64 אפסים, אותו דלי שבשרת. IPv6 מגובב לפי /64 לפני שהוא מגיע לכאן.
-- תקרת האתר נבדקת בלי מנעול. המנעול הוא לננכס, ובלי המתנה: אם הוא תפוס
-- הלחיצה לא נרשמת והחיבור משתחרר. מילוי התקרה הגלובלית נכתב לממצא
-- תפעולי בדרגה medium, בלי התראה ליועץ ובלי הודעה ללקוח.
-- אין שם, אין טלפון, ואין כתיבה ל-leads.
-- אידמפוטנטית. docs/open-house-fair.md, "רישום פניות היריד".
-- ============================================================================

create or replace function public.fair_contact_click(
  p_property_id uuid,
  p_channel text,
  p_source_page text,
  p_ip_hash text,
  p_client_session text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
  v_page text;
  v_source text;
  v_ip text;
  v_session text;
  v_p record;
  v_existing record;
  v_n integer;
  v_ref bigint;
  v_at timestamptz;
  v_end timestamptz;
  v_status text;
  v_wrote integer;
begin
  v_channel := case p_channel
    when 'whatsapp' then 'whatsapp_click'
    when 'whatsapp_click' then 'whatsapp_click'
    when 'call' then 'call_click'
    when 'call_click' then 'call_click'
    else null
  end;
  if v_channel is null then
    return jsonb_build_object('ok', false, 'error', 'bad_channel');
  end if;

  v_page := case
    when p_source_page in ('property', 'swipe', 'open_house', 'app') then p_source_page
    else null
  end;
  v_source := coalesce(v_page, 'click');

  -- גיבוב שכבר חושב בשרת. מחרוזת אחרת (טלפון, כתובת) נופלת לדלי המשותף.
  v_ip := case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash else repeat('0', 64) end;
  v_session := case when p_client_session ~ '^[a-f0-9]{32}$' then p_client_session else null end;

  select pr.id, pr.agent_id, pr.agency_id, pr.title, pr.city, pr.status,
         pr.open_house, pr.open_house_start, pr.open_house_end
    into v_p
    from public.properties pr
   where pr.id = p_property_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_p.status is distinct from 'active'
     or v_p.open_house is not true
     or v_p.open_house_start is null
     or v_p.open_house_end is null
     or not (v_p.open_house_start <= now() and now() <= v_p.open_house_end) then
    return jsonb_build_object('ok', false, 'error', 'not_in_fair');
  end if;

  -- תקרת האתר לפני כל מנעול. הצפה שכבר מלאה לא מחזיקה חיבור בהמתנה.
  select count(*) into v_n
    from public.fair_inquiries f
   where f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour';
  if v_n >= 3000 then
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('fair-contact-cap-alert')::bigint)
       and to_regclass('public.ops_findings') is not null then
      begin
        insert into public.ops_findings (key, area, code, severity, subject, title, detail, suggestion, metric, metric_unit)
        values (
          'fair_click_global_cap', 'health', 'fair_click_cap', 'medium', 'fair_inquiries',
          'תקרת לחיצות היריד מלאה',
          'בשעה האחרונה נרשמו לפחות 3000 לחיצות על וואטסאפ ועל חיוג. לחיצות נוספות לא נשמרות עד שהחלון מתגלגל.',
          'לבדוק ביומן אם זו הצפה. אין הודעה ליועצים ואין הודעה ללקוחות.',
          v_n, 'clicks')
        on conflict (key) do update
          set last_seen = pg_catalog.now(),
              prev_metric = public.ops_findings.metric,
              metric = excluded.metric,
              detail = excluded.detail,
              resolved_at = null
        where public.ops_findings.last_seen < pg_catalog.now() - interval '5 minutes'
           or public.ops_findings.resolved_at is not null;
        get diagnostics v_wrote = row_count;
        if v_wrote > 0 then
          raise warning 'fair_contact_global_cap count=%', v_n;
        end if;
      exception when others then
        raise warning 'fair_contact_global_cap alert failed: %', sqlerrm;
      end;
    elsif to_regclass('public.ops_findings') is null then
      raise warning 'fair_contact_global_cap count=%', v_n;
    end if;
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'cap', 'global');
  end if;

  select count(*) into v_n
    from public.fair_inquiries f
   where f.property_id = p_property_id
     and f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour';
  if v_n >= 500 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'cap', 'property');
  end if;

  -- מנעול לננכס, בלי המתנה. תפוס: לא רושמים ומשחררים את החיבור מיד.
  if not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtext('fair-contact-click'),
       pg_catalog.hashtext(p_property_id::text)) then
    return jsonb_build_object('ok', true, 'logged', false, 'skipped', 'busy');
  end if;

  select count(*) into v_n
    from public.fair_inquiries f
   where f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour';
  if v_n >= 3000 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'cap', 'global');
  end if;

  select count(*) into v_n
    from public.fair_inquiries f
   where f.property_id = p_property_id
     and f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour';
  if v_n >= 500 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'cap', 'property');
  end if;

  select f.ref, f.created_at, f.fair_end, f.channel, f.status
    into v_existing
    from public.fair_inquiries f
   where f.property_id = p_property_id
     and f.channel = v_channel
     and f.created_at > now() - interval '15 minutes'
     and (
       (v_session is not null and f.client_session = v_session)
       or (v_session is null and f.ip_hash = v_ip)
     )
   order by f.created_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'ok', true, 'logged', true, 'duplicate', true,
      'ref', v_existing.ref, 'created_at', v_existing.created_at,
      'fair_end', v_existing.fair_end, 'channel', v_existing.channel,
      'status', v_existing.status);
  end if;

  select count(*) into v_n
    from public.fair_inquiries f
   where f.property_id = p_property_id
     and f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour'
     and f.ip_hash = v_ip;
  if v_n >= 200 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select count(*) into v_n
    from public.fair_inquiries f
   where f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour'
     and f.ip_hash = v_ip;
  if v_n >= 2000 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select count(*) into v_n
    from public.fair_inquiries f
   where f.channel in ('whatsapp_click', 'call_click')
     and f.created_at > now() - interval '1 hour';
  if v_n >= 3000 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'cap', 'global');
  end if;

  begin
    insert into public.fair_inquiries (
      property_id, property_label, agent_id, agency_id,
      channel, status, source, source_page,
      fair_key, fair_start, fair_end,
      client_session, ip_hash)
    values (
      v_p.id,
      nullif(concat_ws(' · ', nullif(btrim(v_p.title), ''), nullif(btrim(v_p.city), '')), ''),
      v_p.agent_id, v_p.agency_id,
      v_channel, 'eligible', v_source, v_page,
      'oh:' || to_char(v_p.open_house_start at time zone 'Asia/Jerusalem', 'YYYYMMDD') || '-' ||
               to_char(v_p.open_house_end   at time zone 'Asia/Jerusalem', 'YYYYMMDD'),
      v_p.open_house_start, v_p.open_house_end,
      v_session, v_ip)
    returning ref, created_at, fair_end, status into v_ref, v_at, v_end, v_status;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'error', 'not_in_fair');
  end;

  return jsonb_build_object(
    'ok', true, 'logged', true, 'duplicate', false,
    'ref', v_ref, 'created_at', v_at, 'fair_end', v_end,
    'channel', v_channel, 'status', v_status);
end $$;

revoke all on function public.fair_contact_click(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fair_contact_click(uuid, text, text, text, text) to service_role;

comment on function public.fair_contact_click(uuid, text, text, text, text) is
  'לחיצת וואטסאפ או חיוג על נכס ביריד. נכתב ל-fair_inquiries בלי ליד ובלי התראה. service_role בלבד.';
