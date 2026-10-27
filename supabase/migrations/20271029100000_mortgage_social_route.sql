-- ליד משכנתא מערוץ שברשימה עובר בחינם ליועצ/ת שכבר מסומן/ת במערכת.
--
-- מה mortgage-lead-intake כותבת היום למקור חברתי (בלי שינוי חוזה הקריאה
-- של social-lead-intake): source הוא אחד מ-
-- facebook_dm, facebook_comment, instagram_dm, instagram_comment,
-- ורק כשהקורא פנימי. אין עמודת channel. הטריגר mortgage_lead_set_channel
-- ממלא channel = facebook או instagram מהמקור הזה, כדי שהפלטפורמה תהיה
-- עמודה משלה. המקור המפורט נשאר ב-source.
--
-- היקף הניתוב החינמי הוא הרשימה mortgage_free_route_sources, לא קוד.
-- ברירת המחדל היא ארבעת המקורות החברתיים בלבד. מקור של האתר או של טופס
-- מטא נוסף בשורה, בלי דיפלוי. זה פתוח: האם להרחיב מעבר לרשתות.
--
-- הדגל mortgage_social_route_enabled כבוי (0): השורה נשארת new על המדף
-- בתשלום. דלוק (1): היועצ/ת עם הכי מעט שיוכים, ואז ה-id הנמוך, מקבל/ת
-- את הליד. sold_to_agent_id, status = sold, ו-mortgage_lead_purchases
-- בסכום 0 (payment_method = social_route) - כך ניתוב חינם נפרד ממכירה.
-- אין יועצ/ת - הליד נשאר על המדף.
--
-- היועץ מזוהה רק ב-agency_members.is_mortgage_advisor (פעיל/ה, החשבון
-- לא סגור). אין מספר טלפון בקוד. מי היועץ/ת בפועל פתוח: הדגל הזה הוא
-- מה שכבר מסומן במערכת.
--
-- ההתראה mortgage_social נכתבת ל-notifications עם
-- related_mortgage_lead_id. הקישור פותח את כרטיס הליד שנרכש
-- (/crm?goto=accLeadShelf&tab=mortgage&mortgage=<id>), לא את המגירה.
-- אין בה שם או טלפון של הפונה.
--
-- המונה ב-mortgage_social_routes. mortgage_social_route_stats מחזיר
-- free_routed. אחרי 10 הלידים review_due, והניתוב ממשיך - הבדיקה של
-- ההסכם ידנית.
-- היומן ב-mortgage-lead-intake עדיין רושם shelf. המקור לניתוב החינמי
-- הוא mortgage_social_routes. social-lead-intake, mortgage-lead-intake,
-- notify_agent_on_new_lead ו-notifications_apply_preferences לא מוחלפות.

insert into public.pricing_config (key, value, description)
values (
  'mortgage_social_route_enabled',
  0,
  '1 = ליד משכנתא מערוץ חברתי עובר בחינם ליועצ/ת (is_mortgage_advisor). 0 = נשאר על המדף בתשלום.'
)
on conflict (key) do nothing;

-- הפלטפורמה במפורש. המקור המפורט (הודעה / תגובה) נשאר ב-source.
alter table public.mortgage_leads
  add column if not exists channel text;

comment on column public.mortgage_leads.channel is
  'facebook או instagram, כשהמקור הוא ערוץ חברתי. נגזר מ-source. אתר וטופס מטא נשארים בלי channel.';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'mortgage_leads_channel_chk'
       and conrelid = 'public.mortgage_leads'::regclass
  ) then
    alter table public.mortgage_leads
      add constraint mortgage_leads_channel_chk
      check (channel is null or channel in ('facebook', 'instagram'));
  end if;
end $$;

update public.mortgage_leads
   set channel = case
     when source in ('facebook_dm', 'facebook_comment') then 'facebook'
     when source in ('instagram_dm', 'instagram_comment') then 'instagram'
     else channel
   end
 where channel is null
   and source in ('facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment');

create or replace function public.mortgage_lead_set_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel is null then
    new.channel := case
      when new.source in ('facebook_dm', 'facebook_comment') then 'facebook'
      when new.source in ('instagram_dm', 'instagram_comment') then 'instagram'
      else null
    end;
  end if;
  return new;
end;
$$;

comment on function public.mortgage_lead_set_channel() is
  'לפני insert: channel = facebook או instagram לפי source. חוזה הקריאה של mortgage-lead-intake לא משתנה.';

revoke all on function public.mortgage_lead_set_channel() from public, anon, authenticated;

drop trigger if exists mortgage_lead_set_channel on public.mortgage_leads;
create trigger mortgage_lead_set_channel
  before insert on public.mortgage_leads
  for each row execute function public.mortgage_lead_set_channel();

-- היקף הניתוב החינמי. ברירת המחדל: רק מה ש-mortgage-lead-intake כותבת
-- למקור חברתי. שורה נוספת (homepage_calculator, property_page, טופס מטא)
-- מרחיבה את ההיקף בלי לשנות קוד.
create table if not exists public.mortgage_free_route_sources (
  source text primary key check (source ~ '^[a-z0-9_]{1,40}$')
);

comment on table public.mortgage_free_route_sources is
  'מקורות של mortgage_leads.source שעוברים בחינם כשהדגל דלוק. ברירת המחדל היא ארבעת הערוצים החברתיים.';

revoke all on table public.mortgage_free_route_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.mortgage_free_route_sources to service_role;

alter table public.mortgage_free_route_sources enable row level security;

insert into public.mortgage_free_route_sources (source)
values ('facebook_dm'), ('facebook_comment'), ('instagram_dm'), ('instagram_comment')
on conflict (source) do nothing;

alter table public.notifications
  add column if not exists related_mortgage_lead_id uuid references public.mortgage_leads(id) on delete set null;

comment on column public.notifications.related_mortgage_lead_id is
  'ליד משכנתא שההתראה פותחת. הקישור: accLeadShelf&tab=mortgage&mortgage=<id>.';

select public.notification_types_add(array['mortgage_social']);

create table if not exists public.mortgage_social_routes (
  lead_id     uuid primary key references public.mortgage_leads(id) on delete cascade,
  advisor_id  uuid not null references public.agency_members(id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.mortgage_social_routes is
  'ליד משכנתא מערוץ חברתי ששויך בחינם. שורה אחת לליד. המונה לבדיקת ההסכם אחרי 10.';

create index if not exists mortgage_social_routes_advisor_idx
  on public.mortgage_social_routes (advisor_id, created_at desc);

alter table public.mortgage_social_routes enable row level security;

revoke all on table public.mortgage_social_routes from public, anon, authenticated;
grant select on table public.mortgage_social_routes to authenticated, service_role;

drop policy if exists "advisor reads own social mortgage routes" on public.mortgage_social_routes;
create policy "advisor reads own social mortgage routes"
  on public.mortgage_social_routes for select
  using (advisor_id = public.current_agent_id());

drop policy if exists "platform admin reads social mortgage routes" on public.mortgage_social_routes;
create policy "platform admin reads social mortgage routes"
  on public.mortgage_social_routes for select
  using (coalesce(public.current_is_platform_admin(), false));

create or replace function public.mortgage_social_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on int;
  v_advisor uuid;
begin
  if not exists (
    select 1 from public.mortgage_free_route_sources s
     where s.source = new.source
  ) then
    return new;
  end if;

  select value into v_on
    from public.pricing_config
   where key = 'mortgage_social_route_enabled';
  if coalesce(v_on, 0) <> 1 then
    return new;
  end if;

  if new.status is distinct from 'new' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mortgage_social_route')::bigint
  );

  select m.id into v_advisor
    from public.agency_members m
   where m.is_mortgage_advisor is true
     and m.active is true
     and m.closed_at is null
   order by (
     select count(*)
       from public.mortgage_social_routes r
      where r.advisor_id = m.id
   ), m.id
   limit 1;

  if v_advisor is null then
    return new;
  end if;

  update public.mortgage_leads
     set status = 'sold',
         sold_at = pg_catalog.now(),
         sold_to_agent_id = v_advisor
   where id = new.id
     and status = 'new';
  if not found then
    return new;
  end if;

  insert into public.mortgage_lead_purchases (
    lead_id, agent_id, agency_id, amount, status, payment_method
  )
  select new.id, m.id, m.agency_id, 0, 'success', 'social_route'
    from public.agency_members m
   where m.id = v_advisor;

  insert into public.mortgage_social_routes (lead_id, advisor_id)
  values (new.id, v_advisor);

  insert into public.notifications (
    agent_id, type, title, body, related_mortgage_lead_id, suppress_push
  )
  values (
    v_advisor,
    'mortgage_social',
    'ליד משכנתא מהרשתות',
    'ליד ייעוץ משכנתאות הגיע אליך בלי חיוב. הפרטים בכרטיס הליד, במגירת המשכנתאות.',
    new.id,
    coalesce((
      select m.tier is distinct from 'mid' and m.tier is distinct from 'premium'
        from public.agency_members m
       where m.id = v_advisor
    ), true)
  );

  return new;
end;
$$;

comment on function public.mortgage_social_route() is
  'אחרי insert ל-mortgage_leads: אם הדגל דלוק והמקור ברשימה, שיוך חינם ליועצ/ת is_mortgage_advisor בסכום 0. כבוי כברירת מחדל.';

revoke all on function public.mortgage_social_route() from public, anon, authenticated;
grant execute on function public.mortgage_social_route() to service_role;

drop trigger if exists mortgage_social_route_after_insert on public.mortgage_leads;
create trigger mortgage_social_route_after_insert
  after insert on public.mortgage_leads
  for each row execute function public.mortgage_social_route();

-- המונה ליועצ/ת המחובר/ת. מנהל/ת פלטפורמה רואה גם פירוט לפי שם פרטי.
-- אין טלפון ואין שם מלא של פונה.
create or replace function public.mortgage_social_route_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_agent_id();
  v_admin boolean := coalesce(public.current_is_platform_admin(), false);
  v_advisor boolean := false;
  v_count int := 0;
begin
  if v_me is null and not v_admin then
    return pg_catalog.jsonb_build_object('error', 'not_signed_in');
  end if;

  if v_me is not null then
    select m.is_mortgage_advisor into v_advisor
      from public.agency_members m
     where m.id = v_me;
  end if;

  if coalesce(v_advisor, false) then
    select count(*)::int into v_count
      from public.mortgage_social_routes
     where advisor_id = v_me;
  elsif v_admin then
    select count(*)::int into v_count
      from public.mortgage_social_routes;
  else
    return pg_catalog.jsonb_build_object('error', 'not_a_mortgage_advisor');
  end if;

  return pg_catalog.jsonb_build_object(
    'routed', v_count,
    'free_routed', v_count,
    'review_after', 10,
    'review_due', v_count >= 10,
    'advisors', case when v_admin then (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'first_name', split_part(coalesce(m.display_name, ''), ' ', 1),
        'routed', c.n,
        'review_due', c.n >= 10
      ) order by c.n desc, split_part(coalesce(m.display_name, ''), ' ', 1)), '[]'::jsonb)
      from (
        select advisor_id, count(*)::int as n
          from public.mortgage_social_routes
         group by advisor_id
      ) c
      join public.agency_members m on m.id = c.advisor_id
    ) else '[]'::jsonb end
  );
end;
$$;

comment on function public.mortgage_social_route_stats() is
  'ספירת לידים שנותבו בחינם (free_routed). review_due מ-10. הניתוב לא נעצר.';

revoke all on function public.mortgage_social_route_stats() from public, anon;
grant execute on function public.mortgage_social_route_stats() to authenticated, service_role;

-- הקישור של ההתראה. שתי הפונקציות מוחלפות מהגרסה האחרונה שלהן
-- (20270902090000 ו-20270822090000), ועוד שדה אחד: מזהה ליד המשכנתא.

create or replace function public.notification_push_claim(p_limit int default 20)
returns table (log_id uuid, agent_id uuid, display_name text, phone_e164 text,
               channel_mode text, items jsonb, item_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
  v_look_p  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_priority_lookback_hours'), 72);
  v_prio    text[] := public.notification_push_priority_types();
  v_digest  int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_ambient_digest_minutes'), 180);
  v_wake    boolean;
begin
  -- קריאה אחת בכל רגע (20270425090000). שלושה cron-ים קוראים ל-notification-push
  -- (הכללי כל 5 דקות, היומן וסיכומי הסיור כל דקה), וכשהם נפגשים באותה שנייה
  -- שתי קריאות רצו במקביל, אף אחת לא ראתה את שורת היומן של השנייה, ושתיהן
  -- שלחו. הנעילה משתחררת בסוף הטרנזקציה, והקריאה השנייה רואה את מה שנרשם.
  perform pg_advisory_xact_lock(hashtext('notification_push_claim'));

  -- רישום בלבד; החסימה כבר שוחררה על ידי הפרדיקט.
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    -- המזהים נוסעים עם ההתראה: ‏notification-push בונה מהם את הקישור הישיר
    -- לפריט (itemPath), במקום קישור לקטגוריה.
    select jsonb_agg(jsonb_build_object(
             'type',        n.type,
             'title',       n.title,
             'body',        n.body,
             'property_id', n.related_property_id,
             'client_id',   coalesce(n.related_client_id,
                                     (select s.client_id from public.client_showcases s
                                       where s.id = n.related_showcase_id)),
             'lead_id',     n.related_lead_id,
             'mortgage_lead_id', n.related_mortgage_lead_id,
             -- נכס של משרד אחר (שיתוף) נפתח ב"שותפו איתי", לא ב"הנכסים שלי"
             'property_mine', (select p.agent_id = n.agent_id or p.referred_by is not distinct from n.agent_id
                                 from public.properties p where p.id = n.related_property_id),
             'agenda_item_id', n.related_agenda_item_id,
             'agreement_id',  n.related_agreement_id,
             -- ביקורת ממתינה - למי שמאשר/ת אותה; מפורסמת - לדף הסוכן/ת. לסוכן/ת
             -- שהביקורת עליו/ה וממתינה אין מה לעשות איתה, ולכן אין לה יעד.
             'review_id', (select rv.id from public.reviews rv
                            where rv.id = n.related_review_id and rv.status = 'pending'
                              and rv.agent_id is distinct from n.agent_id),
             'review_agent_slug', (select m.slug from public.reviews rv
                                     join public.agency_members m on m.id = rv.agent_id
                                    where rv.id = n.related_review_id and rv.status = 'published')
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type),
           -- יש כאן משהו שמצדיק הודעה: התראה שאינה רקע, או רקע שחיכה עד התקציר
           bool_or(not public.notification_push_is_ambient(n.type, n.agent_id, n.related_property_id)
                   or n.created_at <= now() - make_interval(mins => v_digest))
      into v_items, v_ids, v_types, v_wake
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and (n.created_at > now() - make_interval(hours =>
              case when n.type = any(v_prio) then v_look_p else v_look end)
            -- רילס ותוכן שיווקי שנוצרו בשקט מחכים לסוף השקט (20270902090000)
            or public.notification_push_quiet_hold(n.type, n.agent_id, n.created_at))
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
       -- תזכורת ישנה אינה עוקפת שעות שקט: היא מחכה לבוקר (20270422090000)
       and not public.notification_push_stale_in_quiet(n.type, n.agent_id, n.created_at);

    continue when v_items is null or not v_wake;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;


comment on function public.notification_push_claim(int) is
  'תופסת לכל סוכן/ת שמותר לשלוח לו/ה את כל ההתראות הפתוחות, ורושמת שורה ב-notification_push_log. חלון המבט לאחור ארוך יותר לסוגים שבעדיפות, התראות רקע לבד יוצאות רק כתקציר (20270420090000), ותזכורת ישנה מחכה לסוף שעות השקט (20270422090000). קריאה אחת בכל רגע, בנעילה (20270425090000). marketing_copy שנוצרה בשקט אינה פגה בו: החלון נספר רק בזמן שאינו שקט (20270902090000). mortgage_social נושאת את related_mortgage_lead_id כ-mortgage_lead_id.';

revoke all on function public.notification_push_claim(int) from public, anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;

create or replace function public.app_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_path text;
  v_dev uuid;
begin
  select am.user_id into v_user
  from public.agency_members am
  where am.id = new.agent_id;
  if v_user is null then
    return new;
  end if;

  v_path := case
    when new.type = 'mortgage_social' and new.related_mortgage_lead_id is not null
      then '/crm?goto=accLeadShelf&tab=mortgage&mortgage=' || new.related_mortgage_lead_id::text
    when new.type = 'lead_prefs_default' then '/crm?goto=accPrefs&focus=lead_prefs'
    when new.type = 'open_demand' then '/crm?goto=accLeads&tab=demand'
    when new.related_agreement_id is not null
      then '/crm?goto=accAgreements&agreement=' || new.related_agreement_id::text
    when new.type in ('review_new', 'review_alert') and new.related_review_id is not null
      then '/crm?goto=accReviews&review=' || new.related_review_id::text
    when new.type = 'agenda_reminder' and new.related_lead_id is not null
      then '/crm?goto=accLeads&lead=' || new.related_lead_id::text
    when new.type = 'agenda_reminder' and new.related_agenda_item_id is not null
      then '/crm?goto=accAgenda&agenda=' || new.related_agenda_item_id::text
    when new.type = 'client_match' and new.related_client_id is not null
      then '/crm?goto=accClients&client=' || new.related_client_id::text || '&focus=matches'
    when new.related_property_id is not null
      and new.type is distinct from 'deal_closed'
      and new.type is distinct from 'client_match'
      then '/crm?goto=accProperties&property=' || new.related_property_id::text
    when new.related_client_id is not null
      then '/crm?goto=accClients&client=' || new.related_client_id::text
    when new.related_lead_id is not null and new.type in ('new_lead', 'review_request', 'system')
      then '/crm?goto=accLeads&lead=' || new.related_lead_id::text
    else '/crm'
  end;

  for v_dev in
    select d.id from public.app_push_devices d
    where d.user_id = v_user and d.disabled_at is null
  loop
    perform public.app_push_enqueue(
      v_dev,
      new.title,
      new.body,
      'https://shuknadlan.co.il' || v_path,
      'notification',
      new.id
    );
  end loop;
  return new;
exception when others then
  raise warning 'app_push_on_notification: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.app_push_on_notification() from public, anon, authenticated;
