-- אחרי 20271031350000: אין דגל, שורה ישנה נמחקת, יועץ/ת רואה רק ערוץ שעה וסטטוס.
-- אידמפוטנטי: הרצה שנייה (אחרי שהשורה הישנה כבר נמחקה) עוברת גם היא.

do $$
declare
  v_old int;
  v_fresh int;
  v_n int;
  v_fresh_after int;
  v_exp int;
  v_seen int;
begin
  if exists (select 1 from public.pricing_config where key = 'fair_contact_logging_enabled') then
    raise exception 'flag still present';
  end if;
  if (select keep_for from public.data_retention_settings where policy = 'fair_inquiries')
       is distinct from interval '2 years'
     or (select enabled from public.data_retention_settings where policy = 'fair_inquiries') is not true then
    raise exception 'row retention';
  end if;

  select count(*) filter (where created_at < now() - interval '2 years'),
         count(*) filter (where created_at >= now() - interval '2 years')
    into v_old, v_fresh
    from public.fair_inquiries;

  v_n := public.fair_inquiries_purge();
  select count(*) into v_fresh_after from public.fair_inquiries
   where created_at >= now() - interval '2 years';
  if exists (select 1 from public.fair_inquiries where created_at < now() - interval '2 years') then
    raise exception 'old row kept';
  end if;
  if v_fresh_after <> v_fresh then raise exception 'fresh rows changed % -> %', v_fresh, v_fresh_after; end if;
  if v_n <> v_old then raise exception 'purge deleted % of %', v_n, v_old; end if;
  if exists (select 1 from public.fair_inquiries f
              join public.leads le on le.id = f.lead_id
             where le.raw_name = 'ישן') then
    raise exception 'three year row kept';
  end if;
  -- הליד של דנה נמחק בתרחיש אחר; הצילום בשורה נשאר, והשורה עצמה צעירה משנתיים.
  if not exists (select 1 from public.fair_inquiries
                  where visitor_name = 'דנה' and channel = 'form'
                    and created_at >= now() - interval '2 years') then
    raise exception 'fresh row missing';
  end if;
  if not exists (select 1 from public.data_retention_runs
                  where policy = 'fair_inquiries' and affected = v_n and dry_run = false) then
    raise exception 'purge not logged';
  end if;

  select count(*) into v_exp from public.fair_inquiries f
    left join public.leads le on le.id = f.lead_id
   where le.agent_id = 'b0000000-0000-0000-0000-000000000001'
      or (f.lead_id is null and f.agent_id = 'b0000000-0000-0000-0000-000000000001');
  if v_exp < 1 then raise exception 'no row for agent A'; end if;

  perform set_config('test.agent', 'b0000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select count(*) into v_seen from public.fair_inquiries;
  if v_seen <> v_exp then raise exception 'agent A sees % of %', v_seen, v_exp; end if;
  perform channel, created_at, status, lead_id, fair_end from public.fair_inquiries limit 1;
  begin
    perform visitor_name from public.fair_inquiries limit 1;
    raise exception 'agent sees name';
  exception when insufficient_privilege then null;
  end;
  begin
    perform visitor_phone_e164 from public.fair_inquiries limit 1;
    raise exception 'agent sees phone';
  exception when insufficient_privilege then null;
  end;
  begin
    perform property_label from public.fair_inquiries limit 1;
    raise exception 'agent sees label';
  exception when insufficient_privilege then null;
  end;
  begin
    perform source from public.fair_inquiries limit 1;
    raise exception 'agent sees source';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ip_hash from public.fair_inquiries limit 1;
    raise exception 'agent sees ip';
  exception when insufficient_privilege then null;
  end;
  begin
    perform client_session from public.fair_inquiries limit 1;
    raise exception 'agent sees session';
  exception when insufficient_privilege then null;
  end;
  begin
    perform agent_id from public.fair_inquiries limit 1;
    raise exception 'agent sees agent_id';
  exception when insufficient_privilege then null;
  end;
  begin
    perform set_config('fair_inquiries.purge', '1', true);
    delete from public.fair_inquiries;
    raise exception 'agent delete with purge mark';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fair_inquiries_purge();
    raise exception 'agent ran purge';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role anon;
  begin
    perform public.fair_inquiries_purge();
    raise exception 'anon ran purge';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('test.agent', '', true);
  -- הסימון של המחיקה חי רק בטרנזקציה הזו. בלי לכבות אותו, מחיקת הבעלים
  -- שכאן הייתה עוברת כי הבדיקה של היועץ/ת הדליקה אותו.
  perform set_config('fair_inquiries.purge', '', true);

  begin
    delete from public.fair_inquiries where visitor_name = 'דנה';
    raise exception 'owner delete without purge mark';
  exception when insufficient_privilege then null;
  end;
end $$;
