-- תקרת הביקוש סופרת את גל ההתאמה, והלולאות נועלות לפי id.
--
-- 20271030210000 כבר על main. כאן רק ההמשך:
--   * כשהתקרה נדלקת אחרי גל 1, נשארים greatest(0, v_cap - v_prior) מקומות.
--   * scraped_lead_matching_rest ו-scraped_leads_lifecycle עוברים על
--     השורות לפי id, כדי ששני סבבים לא יינעלו בסדר הפוך.
--   * שעון הבדיקה app.customer_at. בלי ההגדרה נשאר now().

create or replace function public.scraped_lead_notify_demand(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.scraped_leads%rowtype;
  v_title  text;
  v_body   text;
  v_n      int := 0;
  v_days   int := greatest(1, coalesce(
             (select value::int from public.pricing_config
               where key = 'notif_burst_scraped_stale_days'), 14));
  v_site   boolean;
  v_on     boolean;
  v_cap    int;
  v_fanout int;
  v_look   int;
  v_suppress boolean := false;
  v_match  boolean;
  v_done   boolean := false;
  v_hits   int := 0;
  v_all    int := 0;
  v_prior  int := 0;
  v_rn     int := 0;
  v_nid    uuid;
  v_line   text;
  v_street text;
  v_prooms numeric;
  rec      record;
begin
  select * into r from public.scraped_leads where id = p_id for update;
  if not found or r.demand_notified_at is not null or r.claimed_by is not null
     or not public.scraped_lead_is_demand(r.status, r.lead_type, r.no_broker, r.posted_at, r.city_id) then
    return 0;
  end if;

  if pg_catalog.to_regprocedure('public.notifications_suppress_on()') is not null then
    execute 'select public.notifications_suppress_on()' into v_suppress;
  end if;
  v_site := coalesce(r.push_site_only, false)
    or (r.posted_at is not null and r.posted_at < now() - make_interval(days => v_days))
    or coalesce(v_suppress, false);

  v_on := coalesce((select value::int from public.pricing_config
                     where key = 'open_demand_notify_cap_enabled'), 0) = 1;
  v_match := coalesce((select value::int from public.pricing_config
                        where key = 'scraped_lead_matching_enabled'), 0) = 1;
  v_cap := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_notify_cap'), 8), 80));
  v_look := greatest(1, least(coalesce(
             (select value::int from public.pricing_config
               where key = 'open_demand_pull_lookback_days'), 14), 90));

  v_title := 'ביקוש פתוח: '
    || case when r.lead_type = 'owner_inbound'
            then case r.deal_type when 'rent' then 'משכיר/ה' else 'מוכר/ת' end
            else case r.deal_type when 'rent' then 'מחפש/ת לשכור' else 'מחפש/ת לקנות' end end
    || ' ב' || r.city;
  v_body := concat_ws(' · ', r.property_type,
                      case when r.rooms is not null then trim_scale(r.rooms)::text || ' חדרים' end,
                      case when r.budget is not null
                           then case when r.lead_type = 'owner_inbound' then '₪' else 'עד ₪' end
                                || to_char(r.budget, 'FM999,999,999') end,
                      case when r.move_in is not null then 'כניסה: ' || r.move_in end,
                      case when r.no_broker is not null then 'כתבו ללא תיווך' end)
    || '. חינם, לסוכן/ת הראשון/ה שלוחץ/ת "אני פונה". אפשר להגיב רק בפוסט או בהודעת פייסבוק, לא ב-SMS ולא בוואטסאפ.';

  -- התאמה רק כשהתקרה כבויה. תקרה דלוקה נשארת המסלול של 20271029220000.
  if v_match and not v_on then
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);

    if r.match_first_at is not null
       and r.match_first_at > now() - interval '30 minutes' then
      return 0;
    elsif r.match_first_at is not null then
      select count(*)::int into v_rn
        from public.scraped_lead_match_dispatch d
       where d.scraped_lead_id = p_id;
      for rec in
        select a.agent_id
          from public.scraped_lead_demand_audience(p_id) a
         where not exists (
           select 1 from public.scraped_lead_match_dispatch d
            where d.scraped_lead_id = p_id and d.agent_id = a.agent_id
         )
         order by a.base_rn
      loop
        v_rn := v_rn + 1;
        insert into public.notifications (agent_id, type, title, body, suppress_push)
        values (
          rec.agent_id, 'open_demand', v_title, left(v_body, 500),
          v_site or (v_fanout > 0 and v_rn > v_fanout)
        )
        returning id into v_nid;
        insert into public.scraped_lead_match_dispatch
          (scraped_lead_id, agent_id, notification_id, wave, score)
        values (p_id, rec.agent_id, v_nid, 2, 0);
        v_n := v_n + 1;
      end loop;
      update public.scraped_leads set demand_notified_at = now() where id = p_id;
      return v_n;
    else
      select count(*)::int into v_all from public.scraped_lead_demand_audience(p_id);
      select count(*)::int into v_hits
        from public.scraped_lead_matches(p_id) h
        join public.scraped_lead_demand_audience(p_id) a on a.agent_id = h.agent_id;
      if v_hits > 0 then
        for rec in
          select h.agent_id, h.score, h.match_kind, h.matched_client_ids, h.matched_property_ids, h.exact
            from public.scraped_lead_matches(p_id) h
            join public.scraped_lead_demand_audience(p_id) a on a.agent_id = h.agent_id
           order by h.score desc, a.base_rn
        loop
          v_rn := v_rn + 1;
          v_street := null;
          v_prooms := null;
          if rec.match_kind = 'has_property' and rec.matched_property_ids[1] is not null then
            select p.street, p.rooms into v_street, v_prooms
              from public.properties p
             where p.id = rec.matched_property_ids[1];
          end if;
          v_line := public.scraped_lead_match_line(rec.match_kind, rec.exact, v_prooms, v_street);
          insert into public.notifications (
            agent_id, type, title, body, suppress_push,
            match_score, match_kind, matched_client_ids, matched_property_ids
          )
          values (
            rec.agent_id, 'open_demand', v_title,
            left(v_body || coalesce(E'\n' || v_line, ''), 500),
            v_site or (v_fanout > 0 and v_rn > v_fanout),
            rec.score, rec.match_kind, rec.matched_client_ids, rec.matched_property_ids
          )
          returning id into v_nid;
          insert into public.scraped_lead_match_dispatch (
            scraped_lead_id, agent_id, notification_id, wave, score, match_kind,
            matched_client_ids, matched_property_ids
          )
          values (
            p_id, rec.agent_id, v_nid, 1, rec.score, rec.match_kind,
            rec.matched_client_ids, rec.matched_property_ids
          );
          v_n := v_n + 1;
        end loop;
        if v_hits >= v_all then
          update public.scraped_leads
             set demand_notified_at = now(), match_first_at = now()
           where id = p_id;
        else
          update public.scraped_leads set match_first_at = now() where id = p_id;
        end if;
        return v_n;
      end if;
    end if;
  end if;

  -- מי שכבר קיבל בגל הראשון לא מקבל שוב, ונספר בתקרת 15.
  v_prior := coalesce((
    select count(*)::int from public.scraped_lead_match_dispatch d
     where d.scraped_lead_id = p_id
  ), 0);

  if not v_on then
    v_fanout := coalesce(
      (select value::int from public.pricing_config
        where key = 'notif_burst_demand_fanout'), 15);
    insert into public.notifications (agent_id, type, title, body, suppress_push)
    select s.id, 'open_demand', v_title, left(v_body, 500),
           v_site or (v_fanout > 0 and (s.rn + v_prior) > v_fanout)
      from (
        select m.id,
               row_number() over (
                 order by
                   case
                     when a.city_id = r.city_id then 0
                     when exists (
                       select 1
                         from public.agent_lead_preferences lp
                         join public.neighborhoods n
                           on n.id = any (lp.preferred_neighborhoods)
                        where lp.agent_id = m.id
                          and lp.active
                          and n.city_id = r.city_id
                     ) then 1
                     else 2
                   end,
                   w.last_message_at desc nulls last,
                   m.id
               ) as rn
          from public.agency_members m
          left join public.agencies a on a.id = m.agency_id
          left join public.whatsapp_conversations w on w.agent_id = m.id
         where m.active
           and public.agent_works_city(m.id, r.city_id)
           and public.agent_handles_type(m.id, r.property_type, r.deal_type)
           and not exists (
             select 1 from public.scraped_lead_match_dispatch d
              where d.scraped_lead_id = p_id and d.agent_id = m.id
           )
      ) s;
    get diagnostics v_n = row_count;
  else
    with eligible as (
      select m.id as agent_id, pulls.last_pull, noted.last_notified
        from public.agency_members m
        left join lateral (
          select max(x.at) as last_pull
            from (
              select l.unlocked_at as at
                from public.leads l
               where l.unlocked_by = m.id
                 and l.unlocked_at is not null
                 and l.unlocked_at >= now() - make_interval(days => v_look)
                 and l.unlocked_at > l.created_at + interval '1 second'
              union all
              select s.claimed_at
                from public.scraped_leads s
               where s.claimed_by = m.id
                 and s.claimed_at is not null
                 and s.claimed_at >= now() - make_interval(days => v_look)
            ) x
        ) pulls on true
        left join lateral (
          select max(n.created_at) as last_notified
            from public.notifications n
           where n.agent_id = m.id
             and n.type = 'open_demand'
        ) noted on true
       where m.active
         and m.released_at is null
         and coalesce(m.license_status, '') not in ('not_found', 'inactive')
         and public.notification_type_enabled(m.id, 'open_demand')
         and public.agent_works_city(m.id, r.city_id)
         and public.agent_handles_type(m.id, r.property_type, r.deal_type)
         and not exists (
           select 1 from public.scraped_lead_match_dispatch d
            where d.scraped_lead_id = p_id and d.agent_id = m.id
         )
    ),
    ranked as (
      select e.agent_id, e.last_pull, e.last_notified,
             row_number() over (
               order by e.last_pull asc nulls first,
                        e.last_notified asc nulls first,
                        random()
             ) as rk
        from eligible e
    ),
    picked as (
      select * from ranked where rk <= greatest(0, v_cap - v_prior)
    ),
    ins as (
      insert into public.notifications (agent_id, type, title, body, suppress_push)
      select p.agent_id, 'open_demand', v_title, left(v_body, 500), v_site
        from picked p
      returning agent_id
    ),
    logged as (
      insert into public.open_demand_notify_log
        (scraped_lead_id, agent_id, rank, reason, last_pull_at, last_notified_at, cap, lookback_days)
      select p_id, p.agent_id, p.rk,
             case when p.last_pull is null then 'no_pull' else 'recent_pull' end,
             p.last_pull, p.last_notified, v_cap, v_look
        from picked p
        join ins i on i.agent_id = p.agent_id
      returning agent_id
    )
    select count(*)::int into v_n
      from ins;
  end if;

  update public.scraped_leads set demand_notified_at = now() where id = p_id;
  return v_n;
end $$;


comment on function public.scraped_lead_notify_demand(uuid) is
  'התראת open_demand. תקרה שנדלקת אחרי גל התאמה סופרת את מי שכבר קיבל. docs/scraped-leads.md';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

create or replace function public.scraped_lead_matching_rest()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
  v_one int;
begin
  if coalesce((select value::int from public.pricing_config
                where key = 'scraped_lead_matching_enabled'), 0) <> 1 then
    return 0;
  end if;
  for r in
    select s.id
      from public.scraped_leads s
     where s.demand_notified_at is null
       and s.claimed_by is null
       and s.match_first_at is not null
       and s.match_first_at <= now() - interval '30 minutes'
     order by s.id
  loop
    v_one := public.scraped_lead_notify_demand(r.id);
    v_n := v_n + coalesce(v_one, 0);
  end loop;
  return v_n;
end $$;

comment on function public.scraped_lead_matching_rest() is
  'גל שני של ביקוש פתוח. השורות לפי id, כדי שלא יינעלו בסדר הפוך.';

revoke all on function public.scraped_lead_matching_rest() from public, anon, authenticated;
grant execute on function public.scraped_lead_matching_rest() to service_role;

create or replace function public.scraped_leads_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_opened  int;
  v_sent    int := 0;
  v_deleted int;
begin
  update public.scraped_leads
     set status = 'open_demand', open_demand_at = now(),
         raw_name = null, raw_phone = null, raw_message = null
   where status = 'pending_consent'
     and coalesce(consent_requested_at, created_at) < now() - interval '7 days'
     and posted_at > now() - interval '30 days';
  get diagnostics v_opened = row_count;

  for r in
    select id from public.scraped_leads
     where demand_notified_at is null and claimed_by is null
       and status in ('pending_consent', 'open_demand')
     order by id
  loop
    v_sent := v_sent + public.scraped_lead_notify_demand(r.id);
  end loop;

  delete from public.scraped_leads where posted_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  delete from public.scraped_lead_blocks where expires_at < now();

  return jsonb_build_object('opened', v_opened, 'notified', v_sent, 'deleted', v_deleted,
                            'launch', public.scraped_leads_launch_active());
end $$;

comment on function public.scraped_leads_lifecycle() is
  'כל שעה: ביקוש פתוח, התראה, מחיקה. הנעילה לפי id. docs/scraped-leads.md';

revoke all on function public.scraped_leads_lifecycle() from public, anon, authenticated;
grant execute on function public.scraped_leads_lifecycle() to service_role;

-- בלי app.customer_at זה now(), כמו קודם. הבדיקה מזריקה שעת בוקר.
create or replace function public.app_push_on_saved_search_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_dev uuid;
  v_key text;
  v_gate text;
  v_at timestamptz := coalesce(
    nullif(pg_catalog.current_setting('app.customer_at', true), '')::timestamptz,
    pg_catalog.now()
  );
begin
  if tg_op = 'UPDATE' and not public.customer_send_window_on() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending' then
    return new;
  end if;
  if new.status is distinct from 'pending' then
    return new;
  end if;
  if not public.customer_send_window_on() then
    select coalesce(nullif(btrim(p.title), ''), 'נכס חדש') into v_title
      from public.properties p
     where p.id = new.property_id;
    for v_dev in
      select d.id from public.app_push_devices d
       where d.saved_search_id = new.search_id and d.disabled_at is null
    loop
      perform public.app_push_enqueue(
        v_dev, coalesce(v_title, 'נכס חדש'),
        'נכס חדש שמתאים לחיפוש ששמרתם',
        'https://shuknadlan.co.il/property?id=' || new.property_id::text,
        'saved_search', new.id
      );
    end loop;
    return new;
  end if;

  if not public.send_window_open('customer_push', v_at) then
    perform public.customer_message_defer(new.id, 'quiet');
    return new;
  end if;

  select public.customer_contact_key(s.phone_e164, s.email, s.id) into v_key
    from public.saved_searches s
   where s.id = new.search_id;
  if v_key is not null and exists (
    select 1 from public.app_push_devices d
     where d.saved_search_id = new.search_id and d.disabled_at is null
  ) then
    v_gate := public.customer_phone_claim(v_key, v_at, new.id, tg_op = 'UPDATE');
    if v_gate in ('ok', 'already') then
      perform public.customer_send_saved_search_push(new.id);
    end if;
    return new;
  end if;

  perform public.customer_send_saved_search_push(new.id);
  return new;
exception when others then
  raise warning 'app_push_on_saved_search_alert: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_saved_search_alert() from public, anon, authenticated;
grant execute on function public.app_push_on_saved_search_alert() to service_role;
