-- ליד משכנתא מערוץ חברתי עובר בחינם ליועצ/ת שכבר מסומן/ת במערכת.
--
-- נקודת החיבור, בלי לגעת ב-social-lead-intake, ב-mortgage-lead-intake,
-- ב-notify_agent_on_new_lead או ב-notifications_apply_preferences:
-- mortgage-lead-intake כותבת שורה ל-mortgage_leads (גם כשהמקור הוא
-- facebook_dm / facebook_comment / instagram_dm / instagram_comment,
-- ורק מקורא פנימי). הטריגר mortgage_social_route רץ אחרי ה-insert.
-- הדגל mortgage_social_route_enabled כבוי (0): השורה נשארת new על המדף
-- בתשלום, כמו היום. דלוק (1): היועצ/ת עם הכי מעט שיוכים, ואז ה-id הנמוך,
-- מקבל/ת את הליד בלי חיוב ארנק. אין יועצ/ת - הליד נשאר על המדף.
--
-- היועץ מזוהה רק ב-agency_members.is_mortgage_advisor (פעיל/ה, החשבון
-- לא סגור). אין מספר טלפון בקוד.
--
-- המונה ב-mortgage_social_routes. אחרי 10 הלידים review_due, והניתוב
-- ממשיך - הבדיקה של ההסכם ידנית.
-- היומן ב-mortgage-lead-intake עדיין רושם shelf, כי אסור לשנות את
-- הפונקציה. המקור לניתוב החינמי הוא הטבלה הזו.

insert into public.pricing_config (key, value, description)
values (
  'mortgage_social_route_enabled',
  0,
  '1 = ליד משכנתא מערוץ חברתי עובר בחינם ליועצ/ת (is_mortgage_advisor). 0 = נשאר על המדף בתשלום.'
)
on conflict (key) do nothing;

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
  if new.source not in (
    'facebook_dm', 'facebook_comment', 'instagram_dm', 'instagram_comment'
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

  insert into public.notifications (agent_id, type, title, body)
  values (
    v_advisor,
    'mortgage_social',
    'ליד משכנתא מהרשתות',
    'ליד ייעוץ משכנתאות מהרשתות החברתיות הגיע אליך בלי חיוב. הפרטים במגירת המשכנתאות, תחת הלידים שרכשת.'
  );

  return new;
end;
$$;

comment on function public.mortgage_social_route() is
  'אחרי insert ל-mortgage_leads: אם הדגל דלוק והמקור חברתי, שיוך חינם ליועצ/ת is_mortgage_advisor. בלי חיוב ארנק. כבוי כברירת מחדל.';

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
  'כמה לידי משכנתא מערוצים חברתיים שויכו בחינם. review_due מ-10. הניתוב לא נעצר.';

revoke all on function public.mortgage_social_route_stats() from public, anon;
grant execute on function public.mortgage_social_route_stats() to authenticated, service_role;
