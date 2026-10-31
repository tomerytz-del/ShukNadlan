-- מחזור החיים והגל השני יכולים לחכות זה לזה על אותן שורות.
--
-- scraped_leads_lifecycle נועל קודם את הפוסטים הישנים
-- (pending_consent שעברו 7 ימים, order by id for update),
-- ורק אחר כך עובר על כל הפוסטים להתראה לפי id.
-- scraped_lead_notify_demand נועלת כל שורה ב-for update.
-- scraped_lead_matching_rest עובר על הפוסטים לפי id ונועל באותה פונקציה.
-- מיון לפי id בתוך כל פונקציה לא סוגר את זה: מחזור החיים כבר מחזיק
-- שורה עם id גבוה לפני שהוא מגיע לשורה עם id נמוך, והגל השני יכול
-- להחזיק את הנמוכה ולחכות לגבוהה.
--
-- התיקון: מנעול ייעוץ אחד, scraped_leads_dispatch, כפקודה הראשונה.
-- מחזור החיים מחכה. הגל השני מוותר ומחזיר 0, והסבב הבא מנסה שוב.
-- הגופים הועתקו מ-20271030221500 ומ-20271030230000. חתימה, security
-- definer, search_path, הרשאות והערות בלי שינוי. חוץ מהמנעול ההתנהגות
-- זהה. scraped_lead_matching_enabled נשאר 0.
-- מי שמגדיר/ה את הפונקציות מחדש מעתיק/ה את הנעילה מכאן.

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
  if not pg_try_advisory_xact_lock(hashtext('scraped_leads_dispatch')) then return 0; end if;
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
  perform pg_advisory_xact_lock(hashtext('scraped_leads_dispatch'));
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
