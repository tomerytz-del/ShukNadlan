-- התאמת ליד מפוסט לסוכן/ת שיש לו/ה לקוח או נכס מתאים.
--
-- scraped_lead_matching_enabled נולד 0. כבוי: scraped_lead_notify_demand
-- ובחירת הסוכן/ת ב-scraped_lead_set_consent זהות למה שרץ היום.
-- דלוק: מי שיש לו/ה התאמה מקבל/ת את התראת open_demand מיד, עם שורה אחת
-- למה. השאר מקבלים אותה כעבור 30 דקות, רק אם הביקוש עוד לא נתפס.
-- הגל השני נבדק כל 10 דקות. אם הדגל כבה או שהתקרה נדלקת אחרי הגל
-- הראשון, המסלול הישן לא שולח שוב למי שכבר קיבל, וסופר אותם בתקרת 15.
-- תקרת open_demand_notify_cap לא משתנה: כשהיא דלוקה המסלול הישן רץ.
--
-- השליחה נשארת שורת notifications. שעות שקט, מסלול חינם בלי וואטסאפ,
-- ותקרת התבניות נשארים ב-notification-push. אין כאן שליחה ללקוח/ה.

insert into public.pricing_config (key, value, description) values
  ('scraped_lead_matching_enabled', 0,
   '1: ביקוש פתוח קודם לסוכן/ת עם התאמה, והשאר אחרי 30 דקות אם לא נתפס. 0: ההפצה והניתוב כמו היום.')
on conflict (key) do nothing;

alter table public.leads add column if not exists budget numeric;
alter table public.leads add column if not exists rooms numeric;
alter table public.leads add column if not exists move_in text;
alter table public.leads add column if not exists budget_source text;
alter table public.leads add column if not exists rooms_source text;
alter table public.leads add column if not exists move_in_source text;

comment on column public.leads.budget is
  'תקציב או מחיר מהפוסט, אם הליד נוצר מ-scraped_leads. null אם לא נאמר.';
comment on column public.leads.rooms is
  'חדרים מהפוסט. null אם לא נאמר.';
comment on column public.leads.move_in is
  'מועד כניסה מהפוסט, טקסט קצר. null אם לא נאמר.';
comment on column public.leads.budget_source is
  'מאיפה הגיע budget. scraped_lead כשהועתק מהפוסט.';
comment on column public.leads.rooms_source is
  'מאיפה הגיע rooms. scraped_lead כשהועתק מהפוסט.';
comment on column public.leads.move_in_source is
  'מאיפה הגיע move_in. scraped_lead כשהועתק מהפוסט.';

update public.leads l
   set budget = s.budget,
       budget_source = 'scraped_lead'
  from public.scraped_leads s
 where s.lead_id = l.id
   and l.budget is null
   and s.budget is not null;

update public.leads l
   set rooms = s.rooms,
       rooms_source = 'scraped_lead'
  from public.scraped_leads s
 where s.lead_id = l.id
   and l.rooms is null
   and s.rooms is not null;

update public.leads l
   set move_in = s.move_in,
       move_in_source = 'scraped_lead'
  from public.scraped_leads s
 where s.lead_id = l.id
   and l.move_in is null
   and s.move_in is not null;

alter table public.scraped_leads
  add column if not exists match_first_at timestamptz;

comment on column public.scraped_leads.match_first_at is
  'מתי יצאה ההתראה למי שיש לו/ה התאמה. השאר יוצאים 30 דקות אחרי, אם הדגל דלוק והביקוש לא נתפס. null כשהדגל כבוי.';

alter table public.notifications add column if not exists match_score int;
alter table public.notifications add column if not exists match_kind text;
alter table public.notifications add column if not exists matched_client_ids uuid[];
alter table public.notifications add column if not exists matched_property_ids uuid[];

comment on column public.notifications.match_score is
  'ציון ההתאמה של הביקוש לסוכן/ת. null כשאין התאמה או כשהדגל כבוי.';
comment on column public.notifications.match_kind is
  'has_seeker או has_property. null בלי התאמה.';
comment on column public.notifications.matched_client_ids is
  'לקוחות או חיפושים שמורים של הסוכן/ת עצמו/ה שגרמו להתאמה. לא של משרד אחר.';
comment on column public.notifications.matched_property_ids is
  'נכסים פעילים של הסוכן/ת שגרמו להתאמה.';

create table if not exists public.scraped_lead_match_dispatch (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  scraped_lead_id       uuid not null,
  agent_id              uuid not null,
  notification_id       uuid,
  lead_id               uuid,
  wave                  smallint not null,
  score                 int,
  match_kind            text,
  matched_client_ids    uuid[] not null default '{}',
  matched_property_ids  uuid[] not null default '{}',
  constraint scraped_lead_match_dispatch_wave_chk check (wave in (1, 2)),
  constraint scraped_lead_match_dispatch_kind_chk
    check (match_kind is null or match_kind in ('has_seeker', 'has_property'))
);

comment on table public.scraped_lead_match_dispatch is
  'מי קיבל/ה ביקוש בגלל התאמה, באיזה גל, ועם אילו מזהים. אין מפתח זר: מחיקת הפוסט לא מוחקת את המדידה.';

create unique index if not exists scraped_lead_match_dispatch_agent_uniq
  on public.scraped_lead_match_dispatch (scraped_lead_id, agent_id);
create index if not exists scraped_lead_match_dispatch_due_idx
  on public.scraped_lead_match_dispatch (scraped_lead_id, wave);

alter table public.scraped_lead_match_dispatch enable row level security;
revoke all on table public.scraped_lead_match_dispatch from public, anon, authenticated;
grant select, insert, update, delete on table public.scraped_lead_match_dispatch to service_role;

-- שורה אחת להתראה. בלי שם מלא, בלי טלפון, בלי קישור.
create or replace function public.scraped_lead_match_line(
  p_kind text, p_exact boolean, p_rooms numeric, p_street text
) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'has_seeker' and coalesce(p_exact, false)
      then 'יש לך לקוח שמחפש בדיוק כזה'
    when p_kind = 'has_seeker'
      then 'יש לך לקוח שמחפש בעיר הזו'
    when p_kind = 'has_property' then
      'יש לך נכס שמתאים'
      || case
           when p_rooms is not null then ': ' || trim_scale(p_rooms)::text || ' חד׳'
           else ''
         end
      || case
           when nullif(btrim(coalesce(p_street, '')), '') is not null then
             case when p_rooms is not null then ' ברח׳ ' else ': ברח׳ ' end
             || left(btrim(p_street), 40)
           else ''
         end
    else null
  end;
$$;

comment on function public.scraped_lead_match_line(text, boolean, numeric, text) is
  'שורה אחת לסוכן/ת על התאמה. בדיוק כזה רק כשעיר, עסקה, חדרים ומחיר נפגשו. בלי טלפון ובלי קישור.';

revoke all on function public.scraped_lead_match_line(text, boolean, numeric, text)
  from public, anon, authenticated;
grant execute on function public.scraped_lead_match_line(text, boolean, numeric, text) to service_role;

-- agent_id, ציון, סוג, ומזהים של הסוכן/ת עצמו/ה בלבד.
create or replace function public.scraped_lead_matches(p_id uuid)
returns table (
  agent_id uuid,
  score int,
  match_kind text,
  matched_client_ids uuid[],
  matched_property_ids uuid[],
  exact boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with lead as (
    select s.*
      from public.scraped_leads s
     where s.id = p_id
  ),
  seeker_rows as (
    select c.agent_id,
           c.id as client_id,
           null::uuid as property_id,
           (
             10
             + case when l.deal_type is not null and c.deal_type = l.deal_type then 10 else 0 end
             + case
                 when l.rooms is not null and (c.min_rooms is not null or c.max_rooms is not null)
                 then 25 else 0
               end
             + case
                 when l.budget is not null and c.max_price is not null
                  and l.budget <= c.max_price * 1.10
                 then 25 else 0
               end
           )::int as score,
           (
             l.deal_type is not null and c.deal_type = l.deal_type
             and l.rooms is not null and (c.min_rooms is not null or c.max_rooms is not null)
             and l.budget is not null and c.max_price is not null
             and l.budget <= c.max_price * 1.10
             and (c.min_price is null or l.budget >= c.min_price)
           ) as exact
      from lead l
      join public.agent_clients c
        on c.client_kind = 'seeker'
       and c.status = 'active'
     where l.lead_type = 'owner_inbound'
       and exists (
         select 1 from unnest(c.cities) city_name
          where btrim(city_name) = btrim(l.city)
       )
       and (l.deal_type is null or c.deal_type = l.deal_type)
       and (
         l.rooms is null
         or (
           (c.min_rooms is null or l.rooms >= c.min_rooms - case when c.max_rooms is null then 1 else 0 end)
           and (c.max_rooms is null or l.rooms <= c.max_rooms + case when c.min_rooms is null then 1 else 0 end)
         )
       )
       and (
         l.budget is null or c.max_price is null or l.budget <= c.max_price * 1.10
       )
       and (
         l.budget is null or c.min_price is null or l.budget >= c.min_price
       )
    union all
    select ss.sold_to_agent_id,
           ss.id,
           null::uuid,
           (
             10
             + case when l.deal_type is not null and ss.deal_type = l.deal_type then 10 else 0 end
             + case
                 when l.rooms is not null and (ss.min_rooms is not null or ss.max_rooms is not null)
                 then 25 else 0
               end
             + case
                 when l.budget is not null and ss.max_price is not null
                  and l.budget <= ss.max_price * 1.10
                 then 25 else 0
               end
             + case
                 when l.neighborhood_id is not null
                  and l.neighborhood_id = any (ss.neighborhood_ids)
                 then 20 else 0
               end
           )::int,
           (
             l.deal_type is not null and ss.deal_type = l.deal_type
             and l.rooms is not null and (ss.min_rooms is not null or ss.max_rooms is not null)
             and l.budget is not null and ss.max_price is not null
             and l.budget <= ss.max_price * 1.10
             and (ss.min_price is null or l.budget >= ss.min_price)
           )
      from lead l
      join public.saved_searches ss
        on ss.sold_to_agent_id is not null
       and ss.status = 'active'
       and ss.lead_status = 'sold'
     where l.lead_type = 'owner_inbound'
       and (
         exists (
           select 1 from unnest(ss.cities) city_name
            where btrim(city_name) = btrim(l.city)
         )
         or (l.neighborhood_id is not null and l.neighborhood_id = any (ss.neighborhood_ids))
       )
       and (l.deal_type is null or ss.deal_type = l.deal_type)
       and (
         l.rooms is null
         or (
           (ss.min_rooms is null or l.rooms >= ss.min_rooms - case when ss.max_rooms is null then 1 else 0 end)
           and (ss.max_rooms is null or l.rooms <= ss.max_rooms + case when ss.min_rooms is null then 1 else 0 end)
         )
       )
       and (
         l.budget is null or ss.max_price is null or l.budget <= ss.max_price * 1.10
       )
       and (
         l.budget is null or ss.min_price is null or l.budget >= ss.min_price
       )
  ),
  property_rows as (
    select p.agent_id,
           null::uuid as client_id,
           p.id as property_id,
           (
             10
             + case when l.deal_type is not null and p.deal_type = l.deal_type then 10 else 0 end
             + case
                 when l.rooms is not null and p.rooms is not null and abs(p.rooms - l.rooms) <= 1
                 then 25 else 0
               end
             + case
                 when l.budget is not null and p.price is not null and p.price <= l.budget * 1.15
                 then 25 else 0
               end
             + case
                 when l.neighborhood_id is not null and p.neighborhood_id = l.neighborhood_id
                 then 20 else 0
               end
           )::int as score,
           (
             l.deal_type is not null and p.deal_type = l.deal_type
             and l.rooms is not null and p.rooms is not null and abs(p.rooms - l.rooms) <= 1
             and l.budget is not null and p.price is not null and p.price <= l.budget * 1.15
           ) as exact
      from lead l
      join public.properties p on p.agent_id is not null
     where l.lead_type = 'seeker_inbound'
       and p.status = 'active'
       and (p.listing_expires_at is null or p.listing_expires_at >= current_date)
       and (
         (l.city_id is not null and p.city_id = l.city_id)
         or btrim(coalesce(p.city, '')) = btrim(l.city)
       )
       and (l.deal_type is null or p.deal_type = l.deal_type)
       and (
         l.rooms is null or p.rooms is null or abs(p.rooms - l.rooms) <= 1
       )
       and (
         l.budget is null or p.price is null or p.price <= l.budget * 1.15
       )
  ),
  rows as (
    select * from seeker_rows
    union all
    select * from property_rows
  )
  select r.agent_id,
         max(r.score)::int,
         case
           when (select lead_type from lead) = 'owner_inbound' then 'has_seeker'
           else 'has_property'
         end,
         coalesce(
           (array_agg(r.client_id order by r.score desc, r.client_id)
              filter (where r.client_id is not null))[1:12],
           '{}'::uuid[]
         ),
         coalesce(
           (array_agg(r.property_id order by r.score desc, r.property_id)
              filter (where r.property_id is not null))[1:12],
           '{}'::uuid[]
         ),
         coalesce((array_agg(r.exact order by r.score desc))[1], false)
    from rows r
   where r.agent_id is not null
   group by r.agent_id;
$$;

comment on function public.scraped_lead_matches(uuid) is
  'התאמות של פוסט לסוכנים. בעלים: לקוח או חיפוש שמור של אותו/ה סוכן/ת. מחפש/ת: נכס פעיל שלא פג. שדה חסר בפוסט לא פוסל. docs/scraped-leads.md';

revoke all on function public.scraped_lead_matches(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_matches(uuid) to service_role;

-- קהל ההפצה כשהדגל דלוק והתקרה כבויה. אותו סדר כמו המסלול הישן.
create or replace function public.scraped_lead_demand_audience(p_id uuid)
returns table (agent_id uuid, base_rn bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         row_number() over (
           order by
             case
               when a.city_id = s.city_id then 0
               when exists (
                 select 1
                   from public.agent_lead_preferences lp
                   join public.neighborhoods n
                     on n.id = any (lp.preferred_neighborhoods)
                  where lp.agent_id = m.id
                    and lp.active
                    and n.city_id = s.city_id
               ) then 1
               else 2
             end,
             w.last_message_at desc nulls last,
             m.id
         )
    from public.scraped_leads s
    join public.agency_members m
      on m.active
     and public.agent_works_city(m.id, s.city_id)
     and public.agent_handles_type(m.id, s.property_type, s.deal_type)
    left join public.agencies a on a.id = m.agency_id
    left join public.whatsapp_conversations w on w.agent_id = m.id
   where s.id = p_id;
$$;

comment on function public.scraped_lead_demand_audience(uuid) is
  'סוכנים שהיו מקבלים את הביקוש היום, באותו סדר. רק כשדגל ההתאמה דלוק.';

revoke all on function public.scraped_lead_demand_audience(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_demand_audience(uuid) to service_role;

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
      select * from ranked where rk <= v_cap
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
  'התראת open_demand פעם אחת לפוסט. דגל התאמה כבוי: כמו קודם. דלוק והתקרה כבויה: קודם מי שיש לו/ה התאמה, והשאר אחרי 30 דקות אם לא נתפס. docs/scraped-leads.md';

revoke all on function public.scraped_lead_notify_demand(uuid) from public, anon, authenticated;
grant execute on function public.scraped_lead_notify_demand(uuid) to service_role;

-- הגל השני. דגל כבוי: חוזר מיד, בלי לקרוא פוסטים.
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
  loop
    v_one := public.scraped_lead_notify_demand(r.id);
    v_n := v_n + coalesce(v_one, 0);
  end loop;
  return v_n;
end $$;

comment on function public.scraped_lead_matching_rest() is
  'גל שני של ביקוש פתוח, 30 דקות אחרי ההתאמה, אם הדגל דלוק והביקוש לא נתפס.';

revoke all on function public.scraped_lead_matching_rest() from public, anon, authenticated;
grant execute on function public.scraped_lead_matching_rest() to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'scraped-lead-matching-rest') then
    perform cron.unschedule('scraped-lead-matching-rest');
  end if;
  perform cron.schedule(
    'scraped-lead-matching-rest',
    '*/10 * * * *',
    'select public.scraped_lead_matching_rest()'
  );
end $$;

-- בחירת סוכן/ת אחרי הסכמה. הדגל כבוי: אותו סבב. דלוק: הציון הגבוה,
-- אחרי מי שכבר לחץ/ה "אני פונה".
create or replace function public.scraped_lead_set_consent(p_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s         public.scraped_leads%rowtype;
  v_agent   uuid;
  v_agency  uuid;
  v_lead    uuid;
  v_msg     text;
  v_label   text;
  v_cands   int;
  v_free    boolean;
  v_by      text := 'rotation';
  v_launch  boolean := public.scraped_leads_launch_active();
  v_match   boolean;
  v_hit     record;
  v_line    text;
  v_street  text;
  v_prooms  numeric;
begin
  select * into s from public.scraped_leads where id = p_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if s.status <> 'pending_consent' then
    return jsonb_build_object('error', 'already_' || s.status);
  end if;

  if p_state = 'requested' then
    update public.scraped_leads set consent_requested_at = coalesce(consent_requested_at, now()) where id = p_id;
    return jsonb_build_object('success', true, 'status', 'pending_consent');
  end if;

  if p_state = 'declined' then
    insert into public.scraped_lead_blocks (ref_hash, expires_at)
    values (encode(extensions.digest(s.source || '|' || s.external_ref, 'sha256'), 'hex'), s.posted_at + interval '30 days')
    on conflict (ref_hash) do nothing;
    delete from public.scraped_leads where id = p_id;
    return jsonb_build_object('success', true, 'status', 'deleted');
  end if;

  if p_state <> 'consented' then
    return jsonb_build_object('error', 'invalid_state');
  end if;

  v_match := coalesce((select value::int from public.pricing_config
                        where key = 'scraped_lead_matching_enabled'), 0) = 1;

  select count(*) into v_cands
    from public.agency_members m
   where m.active and public.agent_works_city(m.id, s.city_id)
     and public.agent_handles_type(m.id, s.property_type, s.deal_type)
     and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch);

  if s.claimed_by is not null then
    select m.id, m.agency_id into v_agent, v_agency
      from public.agency_members m
     where m.id = s.claimed_by and m.active
       and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch);
    if v_agent is not null then
      v_by := 'claim';
    end if;
  end if;

  if v_agent is null and v_match then
    select m.id, m.agency_id into v_agent, v_agency
      from public.scraped_lead_matches(p_id) h
      join public.agency_members m on m.id = h.agent_id
     where m.active
       and public.agent_works_city(m.id, s.city_id)
       and public.agent_handles_type(m.id, s.property_type, s.deal_type)
       and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch)
     order by h.score desc, m.id
     limit 1;
    if v_agent is not null then
      v_by := 'match';
    end if;
  end if;

  if v_agent is null then
    select m.id, m.agency_id into v_agent, v_agency
      from public.agency_members m
     where m.active and public.agent_works_city(m.id, s.city_id)
       and public.agent_handles_type(m.id, s.property_type, s.deal_type)
       and (s.lead_type = 'seeker_inbound' or m.tier in ('mid', 'premium') or v_launch)
     order by (select max(l.created_at) from public.leads l
                where l.agent_id = m.id and l.source in ('facebook_group', 'facebook_marketplace')) asc nulls first,
              m.id
     limit 1;
  end if;

  v_free := v_agent is not null and v_launch;

  v_label := case s.source when 'facebook_marketplace' then 'מרקטפלייס' else 'קבוצת פייסבוק' end
             || coalesce(' · ' || s.source_detail, '');
  v_msg := left(concat_ws(E'\n', s.raw_message,
                          'פורסם: ' || to_char(s.posted_at at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI'),
                          'הפוסט: ' || s.post_url), 4000);

  insert into public.leads (
    lead_type, agent_id, agency_id, status, quota_source, unlocked_at, unlocked_by,
    raw_name, raw_phone, raw_message,
    city, neighborhood_id, deal_type, property_type, property_details,
    source, source_detail, external_ref,
    budget, rooms, move_in, budget_source, rooms_source, move_in_source
  )
  values (
    s.lead_type, v_agent, v_agency,
    case when v_free then 'unlocked' else 'masked' end,
    case when v_free then 'launch_free' end,
    case when v_free then now() end,
    case when v_free then v_agent end,
    coalesce(s.raw_name, 'פונה מפייסבוק'), s.raw_phone, v_msg,
    s.city, s.neighborhood_id, s.deal_type, s.property_type,
    nullif(concat_ws(' · ', s.property_details,
                     case when s.rooms is not null then trim_scale(s.rooms)::text || ' חדרים' end,
                     case when s.budget is not null then 'עד ₪' || to_char(s.budget, 'FM999,999,999') end,
                     case when s.move_in is not null then 'כניסה: ' || s.move_in end), ''),
    s.source, left(v_label, 120), s.external_ref,
    s.budget, s.rooms, s.move_in,
    case when s.budget is not null then 'scraped_lead' end,
    case when s.rooms is not null then 'scraped_lead' end,
    case when s.move_in is not null then 'scraped_lead' end
  )
  on conflict (source, external_ref) where external_ref is not null do nothing
  returning id into v_lead;

  if v_lead is null then
    select id into v_lead from public.leads where source = s.source and external_ref = s.external_ref;
  end if;

  update public.scraped_leads
     set status = 'consented', consent_answered_at = now(), lead_id = v_lead,
         raw_name = null, raw_phone = null, raw_message = null
   where id = p_id;

  if v_match and v_by = 'match' and v_agent is not null and v_lead is not null then
    select h.score, h.match_kind, h.matched_client_ids, h.matched_property_ids, h.exact
      into v_hit
      from public.scraped_lead_matches(p_id) h
     where h.agent_id = v_agent;
    if found then
      v_street := null;
      v_prooms := null;
      if v_hit.match_kind = 'has_property' and v_hit.matched_property_ids[1] is not null then
        select p.street, p.rooms into v_street, v_prooms
          from public.properties p
         where p.id = v_hit.matched_property_ids[1];
      end if;
      v_line := public.scraped_lead_match_line(v_hit.match_kind, v_hit.exact, v_prooms, v_street);
      update public.notifications n
         set match_score = v_hit.score,
             match_kind = v_hit.match_kind,
             matched_client_ids = v_hit.matched_client_ids,
             matched_property_ids = v_hit.matched_property_ids,
             body = left(n.body || coalesce(E'\n' || v_line, ''), 500)
       where n.related_lead_id = v_lead
         and n.agent_id = v_agent
         and n.type = 'new_lead';
      insert into public.scraped_lead_match_dispatch (
        scraped_lead_id, agent_id, lead_id, wave, score, match_kind,
        matched_client_ids, matched_property_ids
      )
      values (
        p_id, v_agent, v_lead, 1, v_hit.score, v_hit.match_kind,
        v_hit.matched_client_ids, v_hit.matched_property_ids
      )
      on conflict (scraped_lead_id, agent_id) do nothing;
    end if;
  end if;

  perform public.log_lead_routing(jsonb_build_object(
    'source', s.source,
    'lead_kind', case when s.lead_type = 'owner_inbound' then 'agent_owner' else 'agent_buyer' end,
    'lead_table', 'leads',
    'lead_id', v_lead,
    'routing', case when v_agent is not null then 'assigned' else 'unrouted' end,
    'recipients', case when v_agent is not null then 1 else 0 end,
    'reason', case when v_agent is null then 'no_agent_in_city' end,
    'summary', concat_ws(' · ', case s.lead_type when 'owner_inbound' then 'בעלים' else 'מחפש/ת' end,
                         case s.deal_type when 'rent' then 'השכרה' when 'sale' then 'מכירה' end,
                         s.property_type, s.city, v_label,
                         case when v_by = 'claim' then 'למי שפנה/תה מהביקוש הפתוח' end,
                         case when v_by = 'match' then 'התאמה' end,
                         case when v_free then 'השקה: בחינם' end),
    'city', s.city,
    'neighborhood_id', s.neighborhood_id,
    'deal_type', s.deal_type,
    'property_type', s.property_type,
    'assigned_agent_id', v_agent));

  return jsonb_build_object('success', true, 'status', 'consented', 'lead_id', v_lead,
                            'agent_id', v_agent, 'candidates', v_cands, 'launch_free', v_free,
                            'assigned_by', v_by);
end $$;

comment on function public.scraped_lead_set_consent(uuid, text) is
  'requested / consented / declined. דגל התאמה דלוק: הליד לציון הגבוה, אחרי מי שתפס/ה. כבוי: הסבב הישן. docs/scraped-leads.md';

revoke all on function public.scraped_lead_set_consent(uuid, text) from public, anon, authenticated;
grant execute on function public.scraped_lead_set_consent(uuid, text) to service_role;

