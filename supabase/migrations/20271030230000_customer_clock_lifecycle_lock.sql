-- שעון הבדיקה app.customer_at נקרא רק בתוך הגוף, ורק בסשן בדיקה.
-- המרה שבורה נופלת ל-now() בלי להפיל את ה-INSERT/UPDATE.
-- עדכון ההסכמה נועל לפי id, באותו סדר כמו הלולאה שאחריו.

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
  -- נעילה לפי id לפני העדכון. עדכון בלי סדר נועל את אותן שורות
  -- בסדר שרירותי, ואז הלולאה (order by id) יכולה להיתקע מול ריצה שנייה.
  with due as (
    select s.id
      from public.scraped_leads s
     where s.status = 'pending_consent'
       and coalesce(s.consent_requested_at, s.created_at) < now() - interval '7 days'
       and s.posted_at > now() - interval '30 days'
     order by s.id
     for update
  )
  update public.scraped_leads u
     set status = 'open_demand', open_demand_at = now(),
         raw_name = null, raw_phone = null, raw_message = null
    from due
   where u.id = due.id;
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
  'כל שעה: ביקוש פתוח, התראה, מחיקה. גם עדכון ההסכמה ננעל לפי id. docs/scraped-leads.md';

revoke all on function public.scraped_leads_lifecycle() from public, anon, authenticated;
grant execute on function public.scraped_leads_lifecycle() to service_role;

-- הפונקציה security definer, ולכן current_user בתוכה הוא הבעלים.
-- session_user נשאר מי שנכנס: ב-Supabase זה authenticator (ואז set role
-- ל-service_role). שעון הבדיקה חל רק כש-app.test_mode = on וגם
-- session_user וגם current_user אינם service_role או authenticator.
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
  v_at timestamptz;
  v_raw text;
begin
  v_at := pg_catalog.now();
  if pg_catalog.current_setting('app.test_mode', true) = 'on'
     and session_user::text not in ('service_role', 'authenticator')
     and current_user::text not in ('service_role', 'authenticator') then
    begin
      v_raw := nullif(pg_catalog.current_setting('app.customer_at', true), '');
      if v_raw is not null then
        v_at := v_raw::timestamptz;
      end if;
    exception when others then
      v_at := pg_catalog.now();
    end;
  end if;

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
