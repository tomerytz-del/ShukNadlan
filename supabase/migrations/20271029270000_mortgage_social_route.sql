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
-- ההתראה היא new_lead, עם related_lead_id של שורת ה-leads ש-
-- store_purchase_to_lead יוצרת באותו update. new_lead כבר ב-
-- notification_push_priority_types, והקישור הקיים פותח את כרטיס הליד
-- (/crm?goto=accLeads&lead=<id>). notify_agent_on_new_lead אינו כותב
-- שורה שנייה: הוא חוזר מיד כש-lead_type הוא store. אין בה שם או טלפון
-- של הפונה. המקור ב-leads הוא הערוץ החברתי (facebook_dm וחבריו),
-- ו-source_detail אומר פייסבוק או אינסטגרם, וחינם.
--
-- המונה ב-mortgage_social_routes. mortgage_social_route_stats מחזיר
-- free_routed. אחרי 10 הלידים review_due, והניתוב ממשיך - הבדיקה של
-- ההסכם ידנית.
-- היומן ב-mortgage-lead-intake עדיין רושם shelf. המקור לניתוב החינמי
-- הוא mortgage_social_routes. social-lead-intake, mortgage-lead-intake,
-- notify_agent_on_new_lead, notifications_apply_preferences,
-- notification_push_claim ו-app_push_on_notification לא מוחלפות.

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
  v_lead uuid;
  v_platform text;
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

  -- store_purchase_to_lead רץ בתוך ה-update של sold_to_agent_id, לפני
  -- שהשליטה חוזרת לכאן, וכותב leads עם lead_type = 'store' ו-
  -- source_detail = 'משכנתאות'. notify_agent_on_new_lead חוזר מיד על
  -- lead_type 'store' (וגם על 'call'), ולכן אינו כותב התראה. השורה
  -- למטה היא ההתראה היחידה, והיא new_lead כדי שתצא גם בוואטסאפ.
  select l.id into v_lead
    from public.leads l
   where l.lead_type = 'store'
     and l.origin_id = new.id;

  v_platform := case
    when new.channel = 'facebook'
      or new.source in ('facebook_dm', 'facebook_comment') then 'פייסבוק'
    when new.channel = 'instagram'
      or new.source in ('instagram_dm', 'instagram_comment') then 'אינסטגרם'
    else null
  end;

  if v_lead is not null and v_platform is not null
     and new.source in ('facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment') then
    update public.leads
       set source = new.source,
           source_detail = 'משכנתאות · ' || v_platform || ' · חינם'
     where id = v_lead
       and source = 'store'
       and source_detail = 'משכנתאות';
  end if;

  if v_lead is not null then
    insert into public.notifications (
      agent_id, type, title, body, related_lead_id, suppress_push
    )
    values (
      v_advisor,
      'new_lead',
      'ליד משכנתא חדש מהרשתות',
      'ליד ייעוץ משכנתאות הגיע אליך בלי חיוב. הפרטים בכרטיס הליד.',
      v_lead,
      coalesce((
        select m.tier is distinct from 'mid' and m.tier is distinct from 'premium'
          from public.agency_members m
         where m.id = v_advisor
      ), true)
    );
  end if;

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
