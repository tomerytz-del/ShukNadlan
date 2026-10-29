-- תרחישי יומן פניות היריד. נכשל ב-exception.
-- A = ‏b..01 (משרד א), M = ‏b..02 (מנהלת משרד א), B = ‏b..03 (משרד ב).

-- נכסים: P1 ביריד עכשיו (A), P2 החלון נגמר לפני דקה והדגל עדיין דולק,
-- P3 החלון מתחיל בעוד דקה, P4 בלי יריד, P5 ביריד עכשיו (B),
-- P6 חלון בעבר שנגמר ב-23:59:59 שעון ישראל (לבדיקת הגבול, מחוץ ל-now()), P7 יריד לפני 3 שנים.
insert into public.properties (id, agent_id, agency_id, title, city, open_house, open_house_start, open_house_end) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'דירה, עלייה 20', 'עפולה', true, now() - interval '3 days', now() + interval '2 days'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'דירה 2', 'עפולה', true, now() - interval '3 days', now() - interval '1 minute'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'דירה 3', 'עפולה', true, now() + interval '1 minute', now() + interval '3 days'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'דירה 4', 'עפולה', false, null, null),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002',
     'דירה 5', 'חיפה', true, now() - interval '1 day', now() + interval '1 day'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'דירה 6', 'עפולה', true, timestamptz '2025-10-05 00:00:00+03', timestamptz '2025-10-31 23:59:59+02'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     'דירה 7', 'עפולה', true, now() - interval '3 years' - interval '5 days', now() - interval '3 years' + interval '5 days');

-- 1. טופס בתוך החלון: שורה אחת, eligible, עם כל הצילום
do $$
declare r record; v_lead uuid; v_lead_at timestamptz; v_n int;
begin
  insert into public.leads (lead_type, property_id, agency_id, agent_id, raw_name, raw_phone, phone_e164)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001', 'דנה', '050-1234567', '972501234567')
  returning id, created_at into v_lead, v_lead_at;
  select count(*) into v_n from public.fair_inquiries where lead_id = v_lead;
  if v_n <> 1 then raise exception 'T1 rows %', v_n; end if;
  select * into r from public.fair_inquiries where lead_id = v_lead;
  if r.channel <> 'form' or r.status <> 'eligible' or r.source <> 'property_page' then
    raise exception 'T1 classify % % %', r.channel, r.status, r.source; end if;
  if abs(extract(epoch from r.created_at - v_lead_at)) > 1 then raise exception 'T1 time'; end if;
  if r.agent_id <> 'b0000000-0000-0000-0000-000000000001' or r.agency_id <> 'a0000000-0000-0000-0000-000000000001' then
    raise exception 'T1 owner'; end if;
  if r.visitor_name <> 'דנה' or r.visitor_phone_e164 <> '972501234567' then raise exception 'T1 pii'; end if;
  if r.property_label <> 'דירה, עלייה 20 · עפולה' then raise exception 'T1 label %', r.property_label; end if;
  if r.fair_start <> (select open_house_start from public.properties where id = 'c0000000-0000-0000-0000-000000000001')
     or r.fair_end <> (select open_house_end from public.properties where id = 'c0000000-0000-0000-0000-000000000001') then
    raise exception 'T1 window snapshot'; end if;
  if r.fair_key !~ '^oh:\d{8}-\d{8}$' then raise exception 'T1 key %', r.fair_key; end if;
  if r.ref is null then raise exception 'T1 ref'; end if;
end $$;

-- 2. מחוץ לחלון: נגמר לפני דקה (הדגל דולק), מתחיל בעוד דקה, בלי יריד
do $$
declare v_n int;
begin
  insert into public.leads (lead_type, property_id, raw_name, raw_phone) values
    ('property_inquiry', 'c0000000-0000-0000-0000-000000000002', 'x', '1'),
    ('property_inquiry', 'c0000000-0000-0000-0000-000000000003', 'x', '1'),
    ('property_inquiry', 'c0000000-0000-0000-0000-000000000004', 'x', '1');
  select count(*) into v_n from public.fair_inquiries
   where property_id in ('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003',
                         'c0000000-0000-0000-0000-000000000004');
  if v_n <> 0 then raise exception 'T2 rows %', v_n; end if;
end $$;

-- 3. הגבול 23:59:59 שעון ישראל, באותה תוצאה בשני אזורי זמן
do $$
declare
  l public.leads;
  tz text;
  v_in int; v_out int;
begin
  foreach tz in array array['UTC', 'Asia/Jerusalem'] loop
    perform set_config('timezone', tz, true);
    insert into public.leads (lead_type, property_id, raw_name, raw_phone)
    values ('property_inquiry', 'c0000000-0000-0000-0000-000000000006', 'גבול', '1') returning * into l;
    perform public._fair_inquiry_log(l, timestamptz '2025-10-31 23:59:58+02');
    insert into public.leads (lead_type, property_id, raw_name, raw_phone)
    values ('property_inquiry', 'c0000000-0000-0000-0000-000000000006', 'גבול', '1') returning * into l;
    perform public._fair_inquiry_log(l, timestamptz '2025-11-01 00:00:01+02');
  end loop;
  select count(*) filter (where created_at = timestamptz '2025-10-31 23:59:58+02'),
         count(*) filter (where created_at = timestamptz '2025-11-01 00:00:01+02')
    into v_in, v_out
    from public.fair_inquiries where property_id = 'c0000000-0000-0000-0000-000000000006';
  if v_in <> 2 or v_out <> 0 then raise exception 'T3 boundary in=% out=%', v_in, v_out; end if;
  if (select distinct fair_key from public.fair_inquiries where property_id = 'c0000000-0000-0000-0000-000000000006')
     <> 'oh:20251005-20251031' then raise exception 'T3 key'; end if;
end $$;

-- 4. סיווג: הדמיה זכאית, רשת חברתית ומטא ממתינים, מקור לא מוכר ממתין,
--    ליד בלי נכס - כלום
do $$
declare v_id uuid; r record; v_n int;
begin
  insert into public.leads (lead_type, property_id, raw_name, raw_phone, source)
  values ('visualization', 'c0000000-0000-0000-0000-000000000001', 'הדמיה', '1', 'swipe') returning id into v_id;
  select * into r from public.fair_inquiries where lead_id = v_id;
  if r.channel <> 'visualization' or r.status <> 'eligible' or r.lead_type <> 'visualization' then
    raise exception 'T4 viz % %', r.channel, r.status; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone)
  values ('visualization', 'c0000000-0000-0000-0000-000000000001', 'הדמיה', '1') returning id into v_id;
  select * into r from public.fair_inquiries where lead_id = v_id;
  if r.status <> 'eligible' or r.source <> 'visualization' then raise exception 'T4 viz null source'; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone, source)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'סוויפ', '1', 'swipe') returning id into v_id;
  if (select status from public.fair_inquiries where lead_id = v_id) <> 'eligible' then raise exception 'T4 swipe'; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone, source)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'תמונות', '1', 'photo_request') returning id into v_id;
  if (select status from public.fair_inquiries where lead_id = v_id) <> 'eligible' then raise exception 'T4 photo'; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone, source, external_ref)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'פייסבוק', '1', 'facebook_dm', 'zr_123') returning id into v_id;
  select * into r from public.fair_inquiries where lead_id = v_id;
  if r.channel <> 'social' or r.status <> 'pending_owner_decision' or r.external_ref <> 'zr_123' or r.source <> 'facebook_dm' then
    raise exception 'T4 social % % %', r.channel, r.status, r.external_ref; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone, source)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'מטא', '1', 'meta_ads_property_form') returning id into v_id;
  select * into r from public.fair_inquiries where lead_id = v_id;
  if r.channel <> 'meta_ads' or r.status <> 'pending_owner_decision' then raise exception 'T4 meta'; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone, source)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'אחר', '1', 'swipe_sponsored') returning id into v_id;
  if (select status from public.fair_inquiries where lead_id = v_id) <> 'pending_owner_decision' then
    raise exception 'T4 unknown source must wait'; end if;

  insert into public.leads (lead_type, property_id, raw_name, raw_phone)
  values ('property_inquiry', null, 'בלי נכס', '1');
  insert into public.leads (lead_type, property_id, raw_name, raw_phone)
  values ('owner_listing', 'c0000000-0000-0000-0000-000000000001', 'סוג אחר', '1') returning id into v_id;
  select count(*) into v_n from public.fair_inquiries where lead_id = v_id or visitor_name = 'בלי נכס';
  if v_n <> 0 then raise exception 'T4 non-eligible types logged %', v_n; end if;
end $$;

-- 5. אותו ליד פעמיים - שורה אחת
do $$
declare l public.leads; v_n int;
begin
  select * into l from public.leads where raw_name = 'דנה';
  perform public._fair_inquiry_log(l, now());
  perform public._fair_inquiry_log(l, l.created_at);
  select count(*) into v_n from public.fair_inquiries where lead_id = l.id;
  if v_n <> 1 then raise exception 'T5 rows %', v_n; end if;
end $$;

-- 6. כשל ברישום אינו מפיל את הליד
alter table public.fair_inquiries add constraint fair_inquiries_test_break check (channel = 'none') not valid;
do $$
declare v_id uuid;
begin
  insert into public.leads (lead_type, property_id, raw_name, raw_phone)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000001', 'שבור', '1') returning id into v_id;
  if not exists (select 1 from public.leads where id = v_id) then raise exception 'T6 lead lost'; end if;
  if exists (select 1 from public.fair_inquiries where lead_id = v_id) then raise exception 'T6 row despite failure'; end if;
end $$;
alter table public.fair_inquiries drop constraint fair_inquiries_test_break;

-- 7. שינוי החלון אחר כך לא נוגע בשורה; מחיקת הליד משאירה אותה בלי lead_id
do $$
declare v_before record; v_after record; v_lead uuid;
begin
  select f.*, f.lead_id as l into v_before from public.fair_inquiries f
    join public.leads le on le.id = f.lead_id where le.raw_name = 'דנה';
  update public.properties set open_house = false, open_house_end = now() + interval '9 days'
   where id = 'c0000000-0000-0000-0000-000000000001';
  select * into v_after from public.fair_inquiries where id = v_before.id;
  if v_after.fair_end <> v_before.fair_end or v_after.fair_key <> v_before.fair_key then raise exception 'T7 snapshot moved'; end if;
  update public.properties set open_house = true, open_house_end = v_before.fair_end
   where id = 'c0000000-0000-0000-0000-000000000001';
  delete from public.leads where id = v_before.lead_id;
  select * into v_after from public.fair_inquiries where id = v_before.id;
  if not found or v_after.lead_id is not null or v_after.visitor_name <> 'דנה' then raise exception 'T7 lead delete'; end if;
end $$;

-- 8. הרשאות
insert into public.leads (lead_type, property_id, agent_id, agency_id, raw_name, raw_phone)
values ('property_inquiry', 'c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000002', 'בחיפה', '1');

do $$
declare v_n int; v_total int; v_ok boolean;
begin
  select count(*) into v_total from public.fair_inquiries;

  -- anon: כלום
  set local role anon;
  begin
    perform 1 from public.fair_inquiries limit 1;
    raise exception 'T8 anon select allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.fair_inquiries (channel, status, fair_key, fair_start, fair_end)
    values ('form', 'eligible', 'x', now() - interval '1 day', now() + interval '1 day');
    raise exception 'T8 anon insert allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- יועץ/ת A: רק השורות של A, בלי טלפון
  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select count(*) into v_n from public.fair_inquiries;
  if v_n = 0 or exists (select 1 from public.fair_inquiries where agent_id <> 'b0000000-0000-0000-0000-000000000001') then
    raise exception 'T8 agent A sees %', v_n; end if;
  begin
    perform visitor_phone_e164 from public.fair_inquiries limit 1;
    raise exception 'T8 agent sees phone';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.fair_inquiries set status = 'eligible';
    raise exception 'T9 authenticated update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.fair_inquiries;
    raise exception 'T9 authenticated delete allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.admin_fair_inquiries();
    raise exception 'T8 non-admin export allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- יועץ B: רק השורה בחיפה
  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000003', true);
  set local role authenticated;
  select count(*) into v_n from public.fair_inquiries;
  if v_n <> 1 then raise exception 'T8 agent B sees %', v_n; end if;
  reset role;

  -- מנהלת משרד א: כל המשרד (גם שורה בלי agent של המנהלת)
  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  select count(*) into v_n from public.fair_inquiries;
  if v_n <> v_total - 1 then raise exception 'T8 manager sees % of %', v_n, v_total - 1; end if;
  reset role;

  -- מנהל/ת פלטפורמה: הייצוא, בשעון ישראל
  perform set_config('test.admin', '1', true);
  set local role authenticated;
  select count(*) into v_n from public.admin_fair_inquiries(timestamptz '2020-01-01', timestamptz '2100-01-01');
  if v_n <> v_total then raise exception 'T8 admin export % of %', v_n, v_total; end if;
  if not exists (select 1 from public.admin_fair_inquiries(timestamptz '2020-01-01', timestamptz '2100-01-01', 'oh:20251005-20251031')
                  where created_at_il = '2025-10-31 23:59:58' and fair_end_il = '2025-10-31 23:59:59' and in_window) then
    raise exception 'T8 admin export israel time'; end if;
  select bool_and(in_window) into v_ok from public.admin_fair_inquiries(timestamptz '2020-01-01', timestamptz '2100-01-01');
  if not v_ok then raise exception 'T8 in_window'; end if;
  reset role;
  perform set_config('test.admin', '', true);
end $$;

-- 9. גם service_role אינו מוחק או משנה; ממלא platform_at פעם אחת
do $$
declare v_id uuid;
begin
  select id into v_id from public.fair_inquiries where source = 'facebook_dm';
  set local role service_role;
  update public.fair_inquiries set platform_at = now() - interval '5 minutes', source_page = 'app' where id = v_id;
  begin
    update public.fair_inquiries set platform_at = now() where id = v_id;
    raise exception 'T9 platform_at rewritten';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.fair_inquiries set status = 'eligible' where id = v_id;
    raise exception 'T9 status rewritten';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.fair_inquiries where id = v_id;
    raise exception 'T9 service delete allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
  begin
    update public.fair_inquiries set created_at = created_at + interval '1 second' where id = v_id;
    raise exception 'T9 owner rewrote created_at';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.fair_inquiries where id = v_id;
    raise exception 'T9 owner delete allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 10. השם והטלפון נמחקים אחרי שנתיים, השורה נשארת
do $$
declare l public.leads; v_n int; r record;
begin
  insert into public.leads (lead_type, property_id, raw_name, raw_phone)
  values ('property_inquiry', 'c0000000-0000-0000-0000-000000000007', 'ישן', '0500000000') returning * into l;
  perform public._fair_inquiry_log(l, now() - interval '3 years');
  v_n := public.fair_inquiries_pii_purge();
  if v_n < 1 then raise exception 'T10 purged %', v_n; end if;
  select * into r from public.fair_inquiries where lead_id = l.id;
  if not found or r.visitor_name is not null or r.visitor_phone_e164 is not null then raise exception 'T10 pii kept'; end if;
  if exists (select 1 from public.fair_inquiries f join public.leads le on le.id = f.lead_id
              where le.raw_name = 'פייסבוק' and f.visitor_name is null) then raise exception 'T10 fresh pii cleared'; end if;
  if not exists (select 1 from public.data_retention_runs where policy = 'fair_inquiries_pii' and affected = v_n) then
    raise exception 'T10 run not logged'; end if;
end $$;

-- הדגל והמדיניות
do $$ begin
  if (select value from public.pricing_config where key = 'fair_contact_logging_enabled') <> 0 then
    raise exception 'flag default'; end if;
  if (select keep_for from public.data_retention_settings where policy = 'fair_inquiries_pii') <> interval '2 years' then
    raise exception 'retention default'; end if;
end $$;
