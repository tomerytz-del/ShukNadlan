-- וואטסאפ על ליד נעול לסוכן/ת במסלול free. הדגל כבוי.
--
-- ההחרגה אינה ב-notifications_apply_preferences. היא השורה
--   and m.tier in ('mid', 'premium')
-- ב-notification_push_due_agents, הגרסה ב-20271028133000.
-- הפונקציה הזו לא מוחלפת: הגוף שלה שייך לסיכום של גבריאלה, והחלפה
-- מכאן הייתה מוחקת אותו או נשברת על main לפניו.
--
-- free_locked_lead_claim הוא נתיב מקביל. notification-push קורא לו
-- אחרי notification_push_claim. רק tier = free, רק new_lead שהליד
-- שלו אינו unlocked.
--
-- הנוסח הוא "פנייה מפייסבוק/אינסטגרם על נכס X" (הערוץ לפי המקור,
-- ו-X הוא סוג הנכס והעיר). בלי שם ובלי טלפון, וגם בלי גוף ההתראה
-- מהפעמון. הכפתור הוא כרטיס הליד, /crm?goto=accLeads&lead=<id>,
-- וזה מסך הפתיחה.
--
-- ההודעה נרשמת ב-notification_push_log ולכן נספרת במפסק ההתפרצות.
-- כשהמפסק דלוק היא לא יוצאת מעל תקרת השעה או תקרת היממה (הכללית
-- ושל מסלול הליד, המחמירה מביניהן). מחוץ לחלון 24 השעות: תבנית אחת
-- ביממה. אם כבר יצאה תבנית, כולל באותו סבב, הליד נשאר בפעמון.
-- במעבר הדגל מ-0 ל-1 נרשמת enabled_at, וליד שנוצר לפניה לא יוצא.

insert into public.pricing_config (key, value, description)
values (
  'free_locked_lead_whatsapp',
  0,
  '1 = סוכן/ת במסלול free מקבל/ת וואטסאפ על ליד נעול. 0 = רק פעמון.'
)
on conflict (key) do nothing;

create table if not exists public.free_locked_lead_state (
  id         int primary key check (id = 1),
  enabled_at timestamptz
);

comment on table public.free_locked_lead_state is
  'חותמת ההדלקה של free_locked_lead_whatsapp. ליד שנוצר לפניה לא יוצא לוואטסאפ.';

revoke all on table public.free_locked_lead_state from public, anon, authenticated;
grant select, insert, update on table public.free_locked_lead_state to service_role;

alter table public.free_locked_lead_state enable row level security;

create or replace function public.free_locked_lead_flag_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key is distinct from 'free_locked_lead_whatsapp' then
    return new;
  end if;
  if coalesce(new.value, 0) = 1
     and (tg_op = 'INSERT' or coalesce(old.value, 0) is distinct from 1) then
    insert into public.free_locked_lead_state (id, enabled_at)
    values (1, pg_catalog.now())
    on conflict (id) do update
      set enabled_at = excluded.enabled_at;
  end if;
  return new;
end;
$$;

comment on function public.free_locked_lead_flag_touch() is
  'במעבר free_locked_lead_whatsapp מ-0 ל-1 רושם enabled_at. עדכון בלי שינוי הערך לא מזיז את החותמת.';

revoke all on function public.free_locked_lead_flag_touch() from public, anon, authenticated;
grant execute on function public.free_locked_lead_flag_touch() to service_role;

drop trigger if exists free_locked_lead_flag_touch on public.pricing_config;
create trigger free_locked_lead_flag_touch
  after insert or update on public.pricing_config
  for each row execute function public.free_locked_lead_flag_touch();

create or replace function public.free_locked_lead_claim(p_limit int default 20)
returns table (
  log_id uuid,
  agent_id uuid,
  display_name text,
  phone_e164 text,
  channel_mode text,
  items jsonb,
  item_count int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_taken int := 0;
  v_cap   int := least(greatest(coalesce(p_limit, 20), 1), 40);
  v_look  int;
  v_gap   int;
  v_fail  int;
  v_lim   int;
  v_mode  text;
  v_items jsonb;
  v_ids   uuid[];
  v_types text[];
  v_log   uuid;
  v_fails int;
  v_guard int;
  v_sent_hour int;
  v_sent_day int;
  v_hour_cap int;
  v_day_cap int;
  ag      record;
begin
  if coalesce((select value from public.pricing_config
                where key = 'free_locked_lead_whatsapp'), 0) <> 1 then
    return;
  end if;

  select s.enabled_at into v_since
    from public.free_locked_lead_state s
   where s.id = 1;
  if v_since is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('notification_push_claim')::bigint
  );

  v_look := coalesce((select value from public.pricing_config
                       where key = 'notif_push_priority_lookback_hours'), 72);
  v_gap := coalesce((select value from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10);
  v_fail := coalesce((select value from public.pricing_config
                       where key = 'notif_push_max_failures_24h'), 3);

  for ag in
    select m.id,
           m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone,
           coalesce(
             (select c.last_message_at > pg_catalog.now() - interval '23 hours'
                from public.whatsapp_conversations c
               where c.agent_id = m.id),
             false) as in_window,
           coalesce(rp.quiet_from_hour, 21) as quiet_from,
           coalesce(rp.quiet_to_hour, 8) as quiet_to,
           coalesce(rp.quiet_days, '{5,6}'::smallint[]) as quiet_days
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier = 'free'
       and m.billing_status = 'active'
       and nullif(btrim(coalesce(m.phone_e164, '')), '') is not null
       and not ('new_lead' = any (coalesce(np.whatsapp_off_types, '{}'::text[])))
       and not public.agent_reminder_quiet_now(
             coalesce(rp.quiet_from_hour, 21),
             coalesce(rp.quiet_to_hour, 8),
             coalesce(rp.quiet_days, '{5,6}'::smallint[]))
  loop
    exit when v_taken >= v_cap;

    if not ag.in_window and exists (
      select 1
        from public.notification_push_log l
       where l.agent_id = ag.id
         and l.channel_mode = 'template'
         and l.created_at > pg_catalog.now() - interval '24 hours'
         and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
    ) then
      continue;
    end if;

    if ag.in_window and exists (
      select 1
        from public.notification_push_log l
       where l.agent_id = ag.id
         and l.created_at > pg_catalog.now() - make_interval(mins => v_gap)
         and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
    ) then
      continue;
    end if;

    select count(*) into v_fails
      from public.notification_push_log l
     where l.agent_id = ag.id
       and l.created_at > pg_catalog.now() - interval '24 hours'
       and not public.notification_push_log_holds(l.whatsapp_status, l.created_at);
    if coalesce(v_fails, 0) >= v_fail then
      continue;
    end if;

    -- אותן תקרות של מפסק ההתפרצות: שעה ויממה, והמסלול של ליד.
    -- השורה נספרת כי היא notification_push_log רגילה (גם pending).
    -- תבנית שכבר יצאה היום, כולל כזו שה-claim הרגיל תפס באותו סבב, חוסמת
    -- למעלה. כאן אין תבנית שנייה.
    v_guard := coalesce((select value from public.pricing_config
                          where key = 'notification_burst_guard_enabled'), 1);
    if v_guard = 1 then
      v_hour_cap := least(
        greatest(1, coalesce((select value from public.pricing_config where key = 'notif_burst_hour_cap'), 12)),
        greatest(1, coalesce((select value from public.pricing_config where key = 'notif_burst_lead_hour_cap'), 20))
      );
      v_day_cap := least(
        greatest(1, coalesce((select value from public.pricing_config where key = 'notif_burst_day_cap'), 30)),
        greatest(1, coalesce((select value from public.pricing_config where key = 'notif_burst_lead_day_cap'), 40))
      );
      select count(*) filter (where l.created_at > pg_catalog.now() - interval '1 hour'),
             count(*) filter (where l.created_at > pg_catalog.now() - interval '1 day')
        into v_sent_hour, v_sent_day
        from public.notification_push_log l
       where l.agent_id = ag.id
         and public.notification_push_log_holds(l.whatsapp_status, l.created_at);
      if coalesce(v_sent_hour, 0) >= v_hour_cap
         or coalesce(v_sent_day, 0) >= v_day_cap then
        continue;
      end if;
    end if;

    v_lim := case when ag.in_window then 9 else 1 end;

    select pg_catalog.jsonb_agg(s.item order by s.created_at desc),
           array_agg(s.id order by s.created_at desc),
           array_agg(distinct s.type)
      into v_items, v_ids, v_types
      from (
        select n.id, n.type, n.created_at,
               pg_catalog.jsonb_build_object(
                 'type', n.type,
                 'locked', true,
                 'source', ld.source,
                 'property_label', s_prop.prop_label,
                 'title', 'פנייה מ' || s_prop.via || ' על נכס ' || s_prop.prop_label,
                 'body', null,
                 'action_path', '/crm?goto=accLeads&lead=' || ld.id::text
               ) as item
          from public.notifications n
          join public.leads ld on ld.id = n.related_lead_id
          left join lateral (
            select left(coalesce(nullif(btrim(pg_catalog.concat_ws(' ',
                     nullif(btrim(coalesce(pr.property_type, ld.property_type)), ''),
                     nullif(btrim(coalesce(pr.city, ld.city)), '')
                   )), ''), 'הנכס'), 80) as prop_label,
                   case
                     when coalesce(ld.source, '') like 'instagram%' then 'אינסטגרם'
                     when coalesce(ld.source, '') like 'facebook%' then 'פייסבוק'
                     else 'פייסבוק/אינסטגרם'
                   end as via
              from (select 1) one
              left join public.properties pr on pr.id = ld.property_id
          ) s_prop on true
         where n.agent_id = ag.id
           and n.type = 'new_lead'
           and not n.read
           and not n.suppress_push
           and n.created_at > v_since
           and n.created_at > pg_catalog.now() - make_interval(hours => v_look)
           and ld.status is distinct from 'unlocked'
           and not exists (
             select 1
               from public.notification_push_log l
              where l.agent_id = n.agent_id
                and n.id = any (l.notification_ids)
                and public.notification_push_log_holds(l.whatsapp_status, l.created_at)
           )
         order by n.created_at desc
         limit v_lim
      ) s;

    continue when v_items is null or v_items = '[]'::jsonb;

    v_mode := case when ag.in_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (ag.id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query
    select v_log, ag.id, ag.display_name, ag.phone, v_mode, v_items,
           pg_catalog.jsonb_array_length(v_items)::int;
  end loop;
end;
$$;

comment on function public.free_locked_lead_claim(int) is
  'וואטסאפ על ליד נעול ל-tier free: פנייה מפייסבוק/אינסטגרם על נכס, בלי שם ובלי טלפון. נספר בתקרת ההתפרצות. תבנית אחת ב-24 שעות.';

revoke all on function public.free_locked_lead_claim(int) from public, anon, authenticated;
grant execute on function public.free_locked_lead_claim(int) to service_role;
