-- תרחישי התקרה. נכשל ב-exception. now() קבוע בטרנזקציה, ולכן
-- היסטוריית ההתראות נשתלת עם interval ולא נשענת על created_at של השורות
-- שהפונקציה כותבת באותה ריצה.
do $$
declare
  v_city uuid := '11111111-1111-1111-1111-111111111111';
  a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  b uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  c uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  d uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  e uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  f uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  g uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  h uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  i uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  j uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10';
  k uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11';
  v_post uuid;
  v_n int;
  v_ids uuid[];
begin
  if (select value::int from public.pricing_config where key = 'open_demand_notify_cap_enabled') <> 0 then
    raise exception 'flag default';
  end if;
  if (select value::int from public.pricing_config where key = 'open_demand_notify_cap') <> 8 then
    raise exception 'cap default';
  end if;
  if (select value::int from public.pricing_config where key = 'open_demand_pull_lookback_days') <> 14 then
    raise exception 'lookback default';
  end if;

  insert into public.agency_members (id, active, license_status, license_number, agency_id) values
    (a, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (b, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (c, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (d, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (e, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (f, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (g, true, 'not_found', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (h, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (i, true, 'verified', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (j, true, 'unverified', null, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'),
    (k, true, 'manual', '1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
  on conflict (id) do update set
    active = excluded.active,
    license_status = excluded.license_status,
    license_number = excluded.license_number,
    agency_id = excluded.agency_id;
  update public.agency_members set released_at = now() where id = f;
  insert into public.cap_stub_block (agent_id, kind) values (h, 'mute'), (i, 'type');

  insert into public.leads (unlocked_by, unlocked_at, created_at) values
    (d, now() - interval '10 days', now() - interval '20 days'),
    (e, now() - interval '1 day', now() - interval '5 days'),
    (j, now() - interval '20 days', now() - interval '30 days'),
    (k, now() - interval '2 days', now() - interval '2 days');
  insert into public.scraped_leads (claimed_by, claimed_at, city_id, city, status, posted_at)
  values (d, now() - interval '3 days', v_city, 'עפולה', 'open_demand', now());

  insert into public.notifications (agent_id, type, created_at) values
    (b, 'open_demand', now() - interval '2 days'),
    (c, 'open_demand', now() - interval '1 hour');

  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', now())
  returning id into v_post;
  v_n := public.scraped_lead_notify_demand(v_post);
  -- 11 סוכנים, בלי מי שהשתיק/ה ובלי מי שלא מתעסק/ת בסוג. מנותק ו-not_found נשארים.
  if v_n <> 9 then
    raise exception 'flag off count %', v_n;
  end if;
  if exists (select 1 from public.open_demand_notify_log) then
    raise exception 'flag off wrote a log';
  end if;
  if public.scraped_lead_notify_demand(v_post) <> 0 then
    raise exception 'second call';
  end if;

  delete from public.notifications;
  insert into public.notifications (agent_id, type, created_at) values
    (b, 'open_demand', now() - interval '2 days'),
    (c, 'open_demand', now() - interval '1 hour');

  update public.pricing_config set value = 1 where key = 'open_demand_notify_cap_enabled';
  update public.pricing_config set value = 3 where key = 'open_demand_notify_cap';

  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, rooms, budget, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', 4, 1500000, now())
  returning id into v_post;
  v_n := public.scraped_lead_notify_demand(v_post);
  if v_n <> 3 then
    raise exception 'cap count %', v_n;
  end if;
  select array_agg(agent_id) into v_ids
    from public.open_demand_notify_log where scraped_lead_id = v_post;
  -- אין תפיסה בחלון ומעולם לא קיבלו: a, j, ו-k (ליד שנולד פתוח אינו תפיסה).
  if not (a = any(v_ids) and j = any(v_ids) and k = any(v_ids)) or cardinality(v_ids) <> 3 then
    raise exception 'expected never-pulled never-notified, got %', v_ids;
  end if;
  if exists (
    select 1 from public.open_demand_notify_log
     where scraped_lead_id = v_post and (reason <> 'no_pull' or rank > 3 or cap <> 3 or lookback_days <> 14)
  ) then
    raise exception 'log fields';
  end if;
  if exists (
    select 1 from public.notifications n
     join public.open_demand_notify_log l on l.agent_id = n.agent_id
    where l.scraped_lead_id = v_post and n.suppress_push
  ) then
    raise exception 'fresh post suppressed';
  end if;

  -- השתקה לא תופסת מקום בתקרה: a היה בקבוצה הראשונה.
  insert into public.cap_stub_block (agent_id, kind) values (a, 'mute');
  delete from public.notifications;
  insert into public.notifications (agent_id, type, created_at) values
    (b, 'open_demand', now() - interval '2 days'),
    (c, 'open_demand', now() - interval '1 hour');
  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', now())
  returning id into v_post;
  v_n := public.scraped_lead_notify_demand(v_post);
  select array_agg(agent_id) into v_ids
    from public.open_demand_notify_log where scraped_lead_id = v_post;
  if v_n <> 3 or cardinality(v_ids) <> 3 or a = any(v_ids) or not (j = any(v_ids) and k = any(v_ids) and b = any(v_ids)) then
    raise exception 'mute consumed a slot: %', v_ids;
  end if;
  delete from public.cap_stub_block where agent_id = a;

  -- חלון 30 יום: התפיסה של j בת 20 הימים נספרת, והוא יורד מהראש.
  update public.pricing_config set value = 30 where key = 'open_demand_pull_lookback_days';
  delete from public.notifications;
  insert into public.notifications (agent_id, type, created_at) values
    (b, 'open_demand', now() - interval '2 days'),
    (c, 'open_demand', now() - interval '1 hour');
  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', now())
  returning id into v_post;
  perform public.scraped_lead_notify_demand(v_post);
  select array_agg(agent_id) into v_ids
    from public.open_demand_notify_log where scraped_lead_id = v_post;
  if cardinality(v_ids) <> 3 or not (a = any(v_ids) and k = any(v_ids) and b = any(v_ids)) or j = any(v_ids) then
    raise exception 'lookback 30 set %', v_ids;
  end if;
  if (select reason from public.open_demand_notify_log where scraped_lead_id = v_post and agent_id = j) is not null then
    raise exception 'j should not be logged';
  end if;

  -- רק מי שתפס/ה בחלון: הישן קודם. random לא הופך את הסדר.
  update public.pricing_config set value = 14 where key = 'open_demand_pull_lookback_days';
  update public.pricing_config set value = 2 where key = 'open_demand_notify_cap';
  update public.agency_members set active = false where id in (a, b, c, k, j);
  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'owner_inbound', 'rent', v_city, 'עפולה', 'דירה', now())
  returning id into v_post;
  perform public.scraped_lead_notify_demand(v_post);
  select array_agg(agent_id order by rank) into v_ids
    from public.open_demand_notify_log where scraped_lead_id = v_post;
  if v_ids <> array[d, e]::uuid[] then
    raise exception 'older pull first, got %', v_ids;
  end if;
  if (select reason from public.open_demand_notify_log where scraped_lead_id = v_post and agent_id = d) <> 'recent_pull' then
    raise exception 'd reason';
  end if;

  update public.agency_members set active = true where id in (a, b, c, k, j);
  update public.pricing_config set value = 8 where key = 'open_demand_notify_cap';
  delete from public.notifications;
  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', now() - interval '20 days')
  returning id into v_post;
  v_n := public.scraped_lead_notify_demand(v_post);
  -- זכאים: a b c d e j k. f מנותק, g not_found, h מושתק, i לא בסוג.
  if v_n <> 7 then
    raise exception 'stale cap %', v_n;
  end if;
  if exists (select 1 from public.notifications where not suppress_push) then
    raise exception 'stale was pushed';
  end if;

  delete from public.notifications;
  perform set_config('app.suppress_push', '1', true);
  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', now())
  returning id into v_post;
  perform public.scraped_lead_notify_demand(v_post);
  if exists (select 1 from public.notifications where not suppress_push) then
    raise exception 'suppress flag ignored';
  end if;
  if exists (
    select 1 from public.open_demand_notify_log l
    where l.scraped_lead_id = v_post
      and l.agent_id in (f, g, h, i)
  ) then
    raise exception 'ineligible logged';
  end if;

  -- הפונקציה חסרה אחרי ההחלה: הפוסט עדיין מופץ, וה-cron לא נופל.
  drop function public.notifications_suppress_on();
  perform set_config('app.suppress_push', '1', true);
  delete from public.notifications;
  insert into public.scraped_leads (status, lead_type, deal_type, city_id, city, property_type, posted_at)
  values ('open_demand', 'seeker_inbound', 'sale', v_city, 'עפולה', 'דירה', now())
  returning id into v_post;
  v_n := public.scraped_lead_notify_demand(v_post);
  if v_n <> 7 then
    raise exception 'missing suppress fn count %', v_n;
  end if;
  if exists (select 1 from public.notifications where suppress_push) then
    raise exception 'missing fn still suppressed';
  end if;
end $$;
