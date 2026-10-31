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
-- מחזיר את השורה שכבר נכתבה. בלי סשן - אותו ip_hash. תקרת הצפה: 200
-- שורות חדשות לשעה לאותו ip על אותו נכס, ו-2,000 לשעה לאותו ip על הכל.
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

  -- גיבוב שכבר חושב בשרת. מחרוזת אחרת (טלפון, כתובת) אינה נשמרת.
  v_ip := case when p_ip_hash ~ '^[a-f0-9]{64}$' then p_ip_hash else null end;
  v_session := case when p_client_session ~ '^[a-f0-9]{32}$' then p_client_session else null end;
  if v_ip is null and v_session is null then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

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

  -- אותו IP ואותו נכס ננעלים יחד, כדי ששתי לחיצות במקביל לא יעברו את התקרה.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(coalesce(v_ip, v_session)),
    pg_catalog.hashtext(p_property_id::text));

  select f.ref, f.created_at, f.fair_end, f.channel, f.status
    into v_existing
    from public.fair_inquiries f
   where f.property_id = p_property_id
     and f.channel = v_channel
     and f.created_at > now() - interval '15 minutes'
     and (
       (v_session is not null and f.client_session = v_session)
       or (v_session is null and v_ip is not null and f.ip_hash = v_ip)
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
     and (
       (v_ip is not null and f.ip_hash = v_ip)
       or (v_ip is null and f.client_session = v_session)
     );
  if v_n >= 200 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if v_ip is not null then
    select count(*) into v_n
      from public.fair_inquiries f
     where f.channel in ('whatsapp_click', 'call_click')
       and f.created_at > now() - interval '1 hour'
       and f.ip_hash = v_ip;
    if v_n >= 2000 then
      return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;
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
