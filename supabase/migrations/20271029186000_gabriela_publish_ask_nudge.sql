-- תזכורת אחת אחרי 24 שעות, כשגבריאלה שאלה לאן לפרסם ולא נענתה.
-- רק בתוך שעות השליחה (אותן שעות שקט וימים שקטים של התזכורות).
-- אין כאן עדכון של status ל-active: בלי תשובה הנכס נשאר unpublished.
-- התזכורת השבועית (unpublished_at, שבעה ימים) נשארת בנפרד.
--
-- וגל פרסום: saved_search_pending_alerts מחזירה לכל מחפש/ת לכל היותר
-- את מה שנשאר מהתקרה היומית (ברירת מחדל 5), גם כשהרבה נכסים נעשים
-- active באותו רגע. שעות השקט נשארות השער של saved_search_quiet_now.
-- בלי החלון, סבב אחד היה שולח את כל הממתינים לפני שמישהו סומן sent.

select public.notification_types_add(array['publish_ask_nudge']);

create table if not exists public.gabriela_publish_asks (
  property_id uuid primary key references public.properties(id) on delete cascade,
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  asked_at timestamptz not null default now(),
  nudged_at timestamptz
);

comment on table public.gabriela_publish_asks is
  'נכס שגבריאלה שאלה עליו ולא נענתה. תזכורת אחת אחרי 24 שעות, בתוך שעות השליחה. לא מפרסם.';

alter table public.gabriela_publish_asks enable row level security;

revoke all on table public.gabriela_publish_asks from public, anon, authenticated;
grant select, insert, update, delete on table public.gabriela_publish_asks to service_role;

create index if not exists gabriela_publish_asks_due_idx
  on public.gabriela_publish_asks (asked_at)
  where nudged_at is null;

create or replace function public.gabriela_publish_ask_touch(p_property_id uuid, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_property_id is null or p_agent_id is null then
    return;
  end if;
  insert into public.gabriela_publish_asks (property_id, agent_id)
  values (p_property_id, p_agent_id)
  on conflict (property_id) do nothing;
end;
$$;

comment on function public.gabriela_publish_ask_touch(uuid, uuid) is
  'רושם שנשאלה שאלת פרסום. שורה קיימת לא מזיזה את השעון, ותזכורת שכבר יצאה לא מתאפסת.';

revoke all on function public.gabriela_publish_ask_touch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gabriela_publish_ask_touch(uuid, uuid) to service_role;

create or replace function public.gabriela_publish_ask_clear(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.gabriela_publish_asks where property_id = p_property_id;
end;
$$;

comment on function public.gabriela_publish_ask_clear(uuid) is
  'הסוכן/ת ענה/תה או שהנכס פורסם. אין תזכורת של 24 השעות.';

revoke all on function public.gabriela_publish_ask_clear(uuid) from public, anon, authenticated;
grant execute on function public.gabriela_publish_ask_clear(uuid) to service_role;

create or replace function public.gabriela_publish_ask_nudge_claim(p_limit int default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  with due as (
    select a.property_id, a.agent_id, p.title
      from public.gabriela_publish_asks a
      join public.properties p on p.id = a.property_id and p.agent_id = a.agent_id
      join public.agency_members m on m.id = a.agent_id
      left join public.agent_reminder_preferences pref on pref.agent_id = a.agent_id
     where a.nudged_at is null
       and a.asked_at <= now() - interval '24 hours'
       and p.status = 'unpublished'
       and m.active
       and m.closed_at is null
       and not public.agent_reminder_quiet_now(
             coalesce(pref.quiet_from_hour, 21),
             coalesce(pref.quiet_to_hour, 8),
             coalesce(pref.quiet_days, '{5,6}'::smallint[]))
     order by a.asked_at
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update of a skip locked
  ),
  marked as (
    update public.gabriela_publish_asks a
       set nudged_at = now()
      from due
     where a.property_id = due.property_id
       and a.nudged_at is null
    returning a.property_id, a.agent_id, due.title
  ),
  ins as (
    -- suppress_push = false במפורש: זו תזכורת חיה, והיא אמורה לצאת לוואטסאפ.
    insert into public.notifications (agent_id, type, title, body, related_property_id, suppress_push)
    select
      m.agent_id,
      'publish_ask_nudge',
      'הנכס ממתין לפרסום',
      case
        when nullif(btrim(coalesce(m.title, '')), '') is null
          then 'הנכס עדיין לא עלה לאתר. אם תרצו לפרסם אותו, אפשר לבחור יעד בשיחה או מהכרטיס. בלי בחירה הוא נשאר במאגר.'
        else 'הנכס "' || left(btrim(m.title), 80) ||
             '" עדיין לא עלה לאתר. אם תרצו לפרסם אותו, אפשר לבחור יעד בשיחה או מהכרטיס. בלי בחירה הוא נשאר במאגר.'
      end,
      m.property_id,
      false
      from marked m
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end;
$$;

comment on function public.gabriela_publish_ask_nudge_claim(int) is
  'תזכורת אחת לנכס שלא נענה, 24 שעות אחרי השאלה, רק מחוץ לשעות השקט. לא משנה את סטטוס הנכס.';

revoke all on function public.gabriela_publish_ask_nudge_claim(int) from public, anon, authenticated;
grant execute on function public.gabriela_publish_ask_nudge_claim(int) to service_role;

-- התקרה נספרת בתוך אותה משיכה. בלי row_number, עשרים נכסים חדשים לאותו
-- חיפוש היו יוצאים בסבב אחד כל עוד sent_today עדיין 0.
create or replace function public.saved_search_pending_alerts(p_limit int default 50)
returns table (
  alert_id      uuid,
  search_id     uuid,
  full_name     text,
  phone_e164    text,
  email         text,
  contact_channel text,
  label         text,
  unsubscribe_token text,
  click_token   text,
  property_id   uuid,
  title         text,
  price         numeric,
  rooms         numeric,
  size_sqm      numeric,
  floor         int,
  city          text,
  neighborhood  text,
  street        text,
  property_type text,
  deal_type     text,
  image_url     text
)
language sql
security definer
set search_path = ''
as $$
  with cap as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'saved_search_daily_cap'), 5) as daily_cap
  ),
  sent_today as (
    select a.search_id, count(*)::int as n
      from public.saved_search_alerts a
     where a.status = 'sent' and a.sent_at > now() - interval '24 hours'
     group by a.search_id
  ),
  ready as (
    select
      a.id as alert_id,
      s.id as search_id,
      s.full_name,
      s.phone_e164,
      s.email,
      s.contact_channel,
      s.label,
      s.unsubscribe_token,
      a.click_token,
      p.id as property_id,
      p.title,
      p.price,
      p.rooms::numeric as rooms,
      coalesce(p.size_sqm, p.area_sqm)::numeric as size_sqm,
      p.floor::int as floor,
      p.city,
      n.name as neighborhood,
      p.street,
      p.property_type,
      p.deal_type,
      (case when array_length(p.images, 1) > 0 then p.images[1] else null end) as image_url,
      a.created_at,
      row_number() over (partition by a.search_id order by a.created_at, a.id) as rn,
      coalesce(t.n, 0) as sent_n,
      cap.daily_cap
    from public.saved_search_alerts a
    join public.saved_searches s on s.id = a.search_id
    join public.properties p on p.id = a.property_id
    left join public.neighborhoods n on n.id = p.neighborhood_id
    cross join cap
    left join sent_today t on t.search_id = a.search_id
    where a.status = 'pending'
      and s.status = 'active'
      and p.status = 'active'
      and not public.saved_search_quiet_now()
  )
  select
    alert_id, search_id, full_name, phone_e164, email, contact_channel,
    label, unsubscribe_token, click_token, property_id, title, price, rooms,
    size_sqm, floor, city, neighborhood, street, property_type, deal_type, image_url
  from ready
  where rn <= greatest(daily_cap - sent_n, 0)
  order by created_at, alert_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

comment on function public.saved_search_pending_alerts(int) is
  'ההתראות שמותר לשלוח עכשיו. שעות שקט, ותקרה יומית לכל חיפוש גם בתוך אותו סבב.';

revoke all on function public.saved_search_pending_alerts(int) from public, anon, authenticated;
grant execute on function public.saved_search_pending_alerts(int) to service_role;
