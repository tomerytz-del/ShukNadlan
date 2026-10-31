-- לחיצת וואטסאפ וחיוג: נרשמת ביומן, בלי ליד, בלי שם, ורק כשהנכס ביריד.
-- נכשל ב-exception. רץ אחרי 20271031360000.

-- 1. לחיצה בתוך החלון: שורה אחת, eligible, בלי שם ובלי טלפון, בלי ליד חדש
do $$
declare
  r jsonb;
  row_ public.fair_inquiries;
  v_leads int;
  v_n int;
begin
  select count(*) into v_leads from public.leads;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property',
    repeat('a', 64), repeat('1', 32));
  if r->>'ok' <> 'true' or r->>'duplicate' <> 'false' or r->>'channel' <> 'whatsapp_click'
     or r->>'status' <> 'eligible' then
    raise exception 'C1 result %', r;
  end if;
  select * into row_ from public.fair_inquiries where ref = (r->>'ref')::bigint;
  if row_.visitor_name is not null or row_.visitor_phone_e164 is not null or row_.lead_id is not null then
    raise exception 'C1 pii or lead';
  end if;
  if row_.channel <> 'whatsapp_click' or row_.status <> 'eligible' or row_.source <> 'property'
     or row_.source_page <> 'property' then
    raise exception 'C1 classify';
  end if;
  if row_.property_label <> 'דירה, עלייה 20 · עפולה' then raise exception 'C1 label %', row_.property_label; end if;
  if row_.agent_id <> 'b0000000-0000-0000-0000-000000000001' then raise exception 'C1 agent'; end if;
  if row_.created_at < row_.fair_start or row_.created_at > row_.fair_end then raise exception 'C1 window'; end if;
  if row_.client_session <> repeat('1', 32) or row_.ip_hash <> repeat('a', 64) then raise exception 'C1 tech'; end if;
  if (select count(*) from public.leads) <> v_leads then raise exception 'C1 created a lead'; end if;
  select count(*) into v_n from public.fair_inquiries
   where client_session = repeat('1', 32) and channel = 'whatsapp_click';
  if v_n <> 1 then raise exception 'C1 rows %', v_n; end if;
end $$;

-- 2. אותה לחיצה שוב: אותה שורה, בלי כפילות. ערוץ שני כן נרשם.
do $$
declare r jsonb; v_ref bigint; v_n int;
begin
  select ref into v_ref from public.fair_inquiries
   where client_session = repeat('1', 32) and channel = 'whatsapp_click';
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property',
    repeat('b', 64), repeat('1', 32));
  if r->>'duplicate' <> 'true' or (r->>'ref')::bigint <> v_ref then raise exception 'C2 dup %', r; end if;
  select count(*) into v_n from public.fair_inquiries where client_session = repeat('1', 32);
  if v_n <> 1 then raise exception 'C2 rows %', v_n; end if;

  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'call', 'swipe',
    repeat('a', 64), repeat('1', 32));
  if r->>'duplicate' <> 'false' or r->>'channel' <> 'call_click' then raise exception 'C2 call %', r; end if;
  if (select source_page from public.fair_inquiries where ref = (r->>'ref')::bigint) <> 'swipe' then
    raise exception 'C2 page';
  end if;
end $$;

-- 3. דפדפן אחר על אותו IP נרשם. בלי גיבוב חוקי כולם באותו דלי, וטלפון אינו סשן.
do $$
declare r jsonb; v_n int; v_ref bigint;
begin
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property',
    repeat('a', 64), repeat('2', 32));
  if r->>'duplicate' <> 'false' then raise exception 'C3 other session %', r; end if;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'whatsapp', 'nope',
    null, '972501234567');
  if r->>'ok' <> 'true' or r->>'duplicate' <> 'false' then raise exception 'C3 shared %', r; end if;
  v_ref := (r->>'ref')::bigint;
  if (select client_session from public.fair_inquiries where ref = v_ref) is not null
     or (select ip_hash from public.fair_inquiries where ref = v_ref) <> repeat('0', 64)
     or (select visitor_phone_e164 from public.fair_inquiries where ref = v_ref) is not null then
    raise exception 'C3 stored a phone or skipped the bucket';
  end if;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property',
    'not-an-ip', '0501234567');
  if r->>'duplicate' <> 'true' or (r->>'ref')::bigint <> v_ref then raise exception 'C3 bucket dup %', r; end if;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'sms', 'property',
    repeat('a', 64), repeat('3', 32));
  if r->>'error' <> 'bad_channel' then raise exception 'C3 channel %', r; end if;
  select count(*) into v_n from public.fair_inquiries where client_session = repeat('3', 32);
  if v_n <> 0 then raise exception 'C3 stored bad channel'; end if;
end $$;

-- 4. לא ביריד: לא נמצא, נגמר, עוד לא התחיל, בלי דגל, לא פעיל. בלי שורה.
do $$
declare r jsonb; v_before int; v_after int;
begin
  select count(*) into v_before from public.fair_inquiries;
  r := public.fair_contact_click('00000000-0000-0000-0000-000000000099', 'whatsapp', 'property', repeat('c', 64), repeat('4', 32));
  if r->>'error' <> 'not_found' then raise exception 'C4 missing %', r; end if;
  r := public.fair_contact_click('c0000000-0000-0000-0000-000000000002', 'call', 'property', repeat('c', 64), repeat('4', 32));
  if r->>'error' <> 'not_in_fair' then raise exception 'C4 ended %', r; end if;
  r := public.fair_contact_click('c0000000-0000-0000-0000-000000000003', 'call', 'property', repeat('c', 64), repeat('4', 32));
  if r->>'error' <> 'not_in_fair' then raise exception 'C4 future %', r; end if;
  r := public.fair_contact_click('c0000000-0000-0000-0000-000000000004', 'whatsapp', 'property', repeat('c', 64), repeat('4', 32));
  if r->>'error' <> 'not_in_fair' then raise exception 'C4 off %', r; end if;
  update public.properties set status = 'unpublished' where id = 'c0000000-0000-0000-0000-000000000001';
  r := public.fair_contact_click('c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property', repeat('c', 64), repeat('4', 32));
  update public.properties set status = 'active' where id = 'c0000000-0000-0000-0000-000000000001';
  if r->>'error' <> 'not_in_fair' then raise exception 'C4 unpublished %', r; end if;
  select count(*) into v_after from public.fair_inquiries;
  if v_after <> v_before then raise exception 'C4 wrote a row'; end if;
end $$;

-- 5. anon ו-authenticated אינם קוראים. service_role קורא.
do $$
declare r jsonb;
begin
  begin
    set local role anon;
    perform public.fair_contact_click('c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property', repeat('d', 64), repeat('5', 32));
    raise exception 'C5 anon called';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    perform public.fair_contact_click('c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property', repeat('d', 64), repeat('5', 32));
    raise exception 'C5 authenticated called';
  exception when insufficient_privilege then
    reset role;
  end;
  set local role service_role;
  r := public.fair_contact_click('c0000000-0000-0000-0000-000000000001', 'whatsapp', 'open_house', repeat('d', 64), repeat('5', 32));
  reset role;
  if r->>'ok' <> 'true' or r->>'channel' <> 'whatsapp_click' then raise exception 'C5 service %', r; end if;
  if (select source_page from public.fair_inquiries where client_session = repeat('5', 32)) <> 'open_house' then
    raise exception 'C5 page';
  end if;
end $$;

-- 6. יועץ רואה ערוץ ושעה, לא גיבוב ולא סשן ולא שם. משרד אחר אינו רואה.
do $$
declare v_n int; v_ch text;
begin
  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select count(*), min(channel) into v_n, v_ch from public.fair_inquiries
   where channel in ('whatsapp_click', 'call_click');
  if v_n < 1 or v_ch is null then raise exception 'C6 agent sees %', v_n; end if;
  perform channel, created_at, status, lead_id, fair_end from public.fair_inquiries limit 1;
  begin
    perform ip_hash from public.fair_inquiries limit 1;
    raise exception 'C6 sees ip';
  exception when insufficient_privilege then null;
  end;
  begin
    perform client_session from public.fair_inquiries limit 1;
    raise exception 'C6 sees session';
  exception when insufficient_privilege then null;
  end;
  begin
    perform visitor_name from public.fair_inquiries limit 1;
    raise exception 'C6 sees name';
  exception when insufficient_privilege then null;
  end;
  begin
    perform source from public.fair_inquiries limit 1;
    raise exception 'C6 sees source';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  select count(*) into v_n from public.fair_inquiries where channel = 'call_click';
  reset role;
  if v_n < 1 then raise exception 'C6 manager misses call clicks'; end if;

  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000003', true);
  set local role authenticated;
  select count(*) into v_n from public.fair_inquiries where channel in ('whatsapp_click', 'call_click');
  reset role;
  if v_n <> 0 then raise exception 'C6 other office sees %', v_n; end if;
  perform set_config('test.agent', '', true);
end $$;

-- 7. תקרה: 200 שורות לאותו IP על אותו נכס בשעה, והבאה נדחית. נכס אחר עובר.
do $$
declare
  i int;
  r jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_key text;
  v_n int;
begin
  select open_house_start, open_house_end,
         'oh:' || to_char(open_house_start at time zone 'Asia/Jerusalem', 'YYYYMMDD') || '-' ||
                 to_char(open_house_end at time zone 'Asia/Jerusalem', 'YYYYMMDD')
    into v_start, v_end, v_key
    from public.properties where id = 'c0000000-0000-0000-0000-000000000001';
  for i in 1..200 loop
    insert into public.fair_inquiries (
      property_id, agent_id, agency_id, channel, status, source, source_page,
      fair_key, fair_start, fair_end, ip_hash, client_session)
    values (
      'c0000000-0000-0000-0000-000000000001',
      'b0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000001',
      'whatsapp_click', 'eligible', 'property', 'property',
      v_key, v_start, v_end, repeat('e', 64), lpad(to_hex(i), 32, '0'));
  end loop;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'whatsapp', 'property',
    repeat('e', 64), repeat('f', 32));
  if r->>'error' <> 'rate_limited' then raise exception 'C7 cap %', r; end if;
  select count(*) into v_n from public.fair_inquiries where ip_hash = repeat('e', 64);
  if v_n <> 200 then raise exception 'C7 wrote past cap %', v_n; end if;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000005', 'call', 'property',
    repeat('e', 64), repeat('f', 32));
  if r->>'ok' <> 'true' or r->>'channel' <> 'call_click' then raise exception 'C7 other property %', r; end if;
end $$;

-- 8. תקרת האתר: 3,000 לחיצות בשעה על כל הנכסים וכל הכתובות. IP חדש נדחה.
do $$
declare
  i int;
  r jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_key text;
  v_n int;
begin
  select open_house_start, open_house_end,
         'oh:' || to_char(open_house_start at time zone 'Asia/Jerusalem', 'YYYYMMDD') || '-' ||
                 to_char(open_house_end at time zone 'Asia/Jerusalem', 'YYYYMMDD')
    into v_start, v_end, v_key
    from public.properties where id = 'c0000000-0000-0000-0000-000000000005';
  select count(*) into v_n from public.fair_inquiries
   where channel in ('whatsapp_click', 'call_click')
     and created_at > now() - interval '1 hour';
  for i in 1..(3000 - v_n) loop
    insert into public.fair_inquiries (
      property_id, agent_id, agency_id, channel, status, source, source_page,
      fair_key, fair_start, fair_end, ip_hash, client_session)
    values (
      'c0000000-0000-0000-0000-000000000005',
      'b0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000002',
      'call_click', 'eligible', 'property', 'property',
      v_key, v_start, v_end, repeat('9', 64), lpad(to_hex(100000 + i), 32, '0'));
  end loop;
  r := public.fair_contact_click(
    'c0000000-0000-0000-0000-000000000001', 'call', 'property',
    repeat('8', 64), repeat('8', 32));
  if r->>'error' <> 'rate_limited' then raise exception 'C8 global %', r; end if;
  select count(*) into v_n from public.fair_inquiries where ip_hash = repeat('8', 64);
  if v_n <> 0 then raise exception 'C8 wrote past the site cap'; end if;
end $$;

-- 9. הייצוא של מנהל הפלטפורמה כולל את הערוץ, בלי טלפון
do $$
declare v_n int;
begin
  perform set_config('test.admin', '1', true);
  set local role authenticated;
  select count(*) into v_n from public.admin_fair_inquiries(now() - interval '1 day', now() + interval '1 day')
   where channel = 'whatsapp_click' and visitor_phone_e164 is null and visitor_name is null;
  reset role;
  perform set_config('test.admin', '', true);
  if v_n < 1 then raise exception 'C8 export %', v_n; end if;
end $$;
