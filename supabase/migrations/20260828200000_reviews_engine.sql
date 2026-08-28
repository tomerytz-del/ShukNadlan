-- ============================================================================
-- מנוע הדירוג — סגירת הלולאה
--
-- התשתית לדירוג כבר קיימת בפרויקט מאז מודול 3: טבלת `reviews` (עם
-- linked_lead_id חובה — אימות, לא טופס פתוח), דף `review-request.html`,
-- ה-Edge Function `submit-review`, מסך האישור של מנהל/ת המשרד ב-CRM,
-- ו-`compute_agent_rankings` / `compute_agency_rankings` שמחשבים
-- bayesian_rating ו-composite_score אחת לשבועיים.
--
-- מה שחסר זה לא עוד מנגנון — אלא שלושה חיבורים שגורמים למנגנון הקיים לעבוד:
--
--   1. איסוף אוטומטי. עד היום הדרך היחידה לקבל ביקורת הייתה שסוכן/ת ייזכר/תיזכר
--      להעתיק ידנית קישור ולשלוח אותו. התוצאה: ביקורת אחת בכל המערכת. כאן
--      נוספים טריגר על נכס שנמכר, ו-cron יומי על ליד שנפתח ולא הבשיל לביקורת.
--
--   2. הסלמה של ביקורת כוכב אחד למנהל/ת הפלטפורמה. ביקורת 1★ היא גם סיכון
--      מוניטין וגם נקודת כשל שכדאי לבדוק — ולכן היא לא נשארת רק אצל המשרד
--      שמאשר/דוחה את עצמו.
--
--   3. כיול הציון. bayesian_rating_m עמד על 10, כלומר סוכן/ת נזקק/ה ל-10
--      ביקורות רק כדי שהדירוג האמיתי ישקול חצי. בשוק בגודל הזה זה אומר
--      שהדירוג לעולם לא זז מהממוצע. יורד ל-3.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. סוגי התראה חדשים
--
-- הבדיקה על notifications.type הייתה סגורה ל-new_lead/system בלבד. שני הסוגים
-- החדשים מופרדים בכוונה: review_request היא תזכורת שגרתית לסוכן/ת, ואילו
-- review_alert היא הסלמה למנהל/ת הפלטפורמה — ה-CRM מציג אותן אחרת.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert'));

-- ---------------------------------------------------------------------------
-- 2. פרמטרים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד.
-- ---------------------------------------------------------------------------
update public.pricing_config set value = 3 where key = 'bayesian_rating_m';

insert into public.pricing_config (key, value, description)
values ('review_request_delay_days', 7,
        'כמה ימים אחרי פתיחת ליד נשלחת לסוכן/ת תזכורת לבקש חוות דעת')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. יומן בקשות חוות הדעת
--
-- שורה אחת לכל ליד שכבר התבקשה עבורו חוות דעת — unique(lead_id) הוא מה שמונע
-- מה-cron להציק לסוכן/ת על אותו ליד כל יום מחדש. הטבלה גם התיעוד של *למה*
-- נשלחה הבקשה, מה שמאפשר בהמשך למדוד איזה טריגר באמת מייצר ביקורות.
-- ---------------------------------------------------------------------------
create table if not exists public.review_requests (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null unique references public.leads(id) on delete cascade,
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  reason      text not null check (reason in ('deal_closed','lead_aged')),
  created_at  timestamptz not null default now()
);

comment on table public.review_requests is
  'ליד שכבר התבקשה עבורו חוות דעת. unique(lead_id) מונע תזכורות חוזרות על אותו ליד.';
comment on column public.review_requests.reason is
  'deal_closed = הנכס המשויך סומן כנמכר · lead_aged = הליד נפתח ולא הבשיל לביקורת.';

create index if not exists review_requests_agent_idx on public.review_requests (agent_id);

alter table public.review_requests enable row level security;

-- אין policy של INSERT ללקוח — הבקשות נוצרות אך ורק בטריגר/cron (security definer),
-- בדיוק כמו notifications. הסוכן/ת רק קורא/ת את השורות של עצמו/ה.
drop policy if exists "agent reads own review requests" on public.review_requests;
create policy "agent reads own review requests"
  on public.review_requests for select
  using (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 4. יצירת בקשה — פונקציית העזר המשותפת
--
-- גם הטריגר וגם ה-cron מגיעים לכאן, כדי שכלל הזכאות יישב במקום אחד: ליד פתוח,
-- משויך לסוכן/ת, שעדיין אין עליו ביקורת ואין עליו בקשה קודמת.
-- ---------------------------------------------------------------------------
create or replace function public.request_review_for_lead(p_lead_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead   leads%rowtype;
  v_agent  uuid;
begin
  select * into v_lead from leads where id = p_lead_id;
  if not found or v_lead.status <> 'unlocked' then
    return false;
  end if;

  -- unlocked_by הוא מי ששילם/ה על הליד ולכן מי שבאמת טיפל/ה בלקוח/ה;
  -- agent_id הוא נפילה לאחור עבור לידים ישנים שנפתחו לפני שהעמודה מולאה.
  v_agent := coalesce(v_lead.unlocked_by, v_lead.agent_id);
  if v_agent is null then
    return false;
  end if;

  if exists (select 1 from reviews where linked_lead_id = p_lead_id) then
    return false;
  end if;
  if exists (select 1 from review_requests where lead_id = p_lead_id) then
    return false;
  end if;

  insert into review_requests (lead_id, agent_id, reason)
  values (p_lead_id, v_agent, p_reason);

  insert into notifications (agent_id, type, title, body, related_lead_id)
  values (
    v_agent,
    'review_request',
    case p_reason
      when 'deal_closed' then 'מזל טוב — עכשיו הזמן לבקש חוות דעת'
      else 'תזכורת: בקשת חוות דעת מהלקוח/ה'
    end,
    case p_reason
      when 'deal_closed' then 'הנכס סומן כנמכר. שליחת הקישור ללקוח/ה עכשיו היא הרגע עם סיכויי המענה הגבוהים ביותר.'
      else 'הליד נפתח לפני זמן מה ועדיין אין עליו חוות דעת. אפשר לשלוח את הקישור בלחיצה אחת.'
    end,
    p_lead_id
  );

  return true;
end;
$$;

comment on function public.request_review_for_lead(uuid, text) is
  'יוצרת בקשת חוות דעת + התראה לסוכן/ת עבור ליד פתוח. מחזירה false אם הליד לא זכאי או שכבר טופל.';

-- ---------------------------------------------------------------------------
-- 5. טריגר א׳ — נכס נמכר
--
-- הרגע שבו לקוח/ה הכי נוטה/ה להשאיר חוות דעת הוא מיד אחרי סגירת העסקה.
-- הטריגר נפרד מ-handle_property_sold הקיים (שכותב ל-market_deals) כדי לא
-- לערבב שתי אחריות בפונקציה אחת.
--
-- הביקורת נשארת קשורה לליד ולא לנכס — linked_lead_id הוא מנגנון האימות של
-- המערכת (מודול 3 §3.4), ולכן נכס שנמכר בלי ליד משויך פשוט לא מייצר בקשה.
-- ---------------------------------------------------------------------------
create or replace function public.request_reviews_on_property_sold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  -- גם 'rented' ולא רק 'sold': עסקת שכירות נסגרה בדיוק כמו עסקת מכירה, והלקוח/ה
  -- באותה נקודה בדיוק. handle_property_sold הקיימת מגיבה רק ל-'sold' כי היא
  -- כותבת ל-market_deals, שהיא טבלת עסקאות מכר — כאן ההקשר אחר.
  if new.status in ('sold','rented') and (old.status is distinct from new.status) then
    for v_lead_id in
      select id from leads
      where property_id = new.id and status = 'unlocked'
    loop
      perform request_review_for_lead(v_lead_id, 'deal_closed');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists properties_request_reviews_on_sold on public.properties;
create trigger properties_request_reviews_on_sold
  after update on public.properties
  for each row execute function public.request_reviews_on_property_sold();

-- ---------------------------------------------------------------------------
-- 6. ה-cron היומי — ליד שנפתח ולא הבשיל
--
-- לא לכל עסקה יש נכס מסומן במערכת, ולא כל ליד מגיע לעסקה. הסריקה היומית היא
-- הרשת השנייה: ליד שנפתח לפני review_request_delay_days ימים ועדיין אין עליו
-- ביקורת מקבל תזכורת אחת — ובזכות unique(lead_id) רק אחת, לתמיד.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_review_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delay_days numeric;
  v_lead_id    uuid;
  v_count      integer := 0;
begin
  select value into v_delay_days from pricing_config where key = 'review_request_delay_days';
  v_delay_days := coalesce(v_delay_days, 7);

  for v_lead_id in
    select l.id
    from leads l
    where l.status = 'unlocked'
      and l.unlocked_at is not null
      and l.unlocked_at < now() - make_interval(days => v_delay_days::int)
      -- גבול עליון: אין טעם להתחיל לרדוף אחרי לידים בני חצי שנה ברגע שהמנגנון עולה
      and l.unlocked_at > now() - interval '90 days'
      and not exists (select 1 from reviews         r where r.linked_lead_id = l.id)
      and not exists (select 1 from review_requests q where q.lead_id       = l.id)
    order by l.unlocked_at
    limit 200
  loop
    if request_review_for_lead(v_lead_id, 'lead_aged') then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.enqueue_review_requests() is
  'סריקה יומית: ליד פתוח שעברו עליו review_request_delay_days ימים ואין עליו ביקורת מקבל תזכורת אחת.';

-- ---------------------------------------------------------------------------
-- 7. הסלמת ביקורת כוכב אחד למנהל/ת הפלטפורמה
--
-- ביקורת 1★ נשלחת לאישור המשרד כמו כל ביקורת אחרת — אבל המשרד הוא צד מעוניין,
-- ולכן היא מגיעה במקביל גם למנהל/ת הפלטפורמה. ההתראה נשלחת על ה-INSERT, כלומר
-- לפני ואם-בכלל המשרד יאשר או ידחה אותה.
-- ---------------------------------------------------------------------------
create or replace function public.alert_platform_admin_on_low_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_agent    text;
begin
  if new.rating > 1 then
    return new;
  end if;

  select display_name into v_agent from agency_members where id = new.agent_id;

  for v_admin_id in
    select id from agency_members where is_platform_admin = true and active = true
  loop
    insert into notifications (agent_id, type, title, body, related_lead_id)
    values (
      v_admin_id,
      'review_alert',
      'ביקורת כוכב אחד ממתינה לבדיקה',
      coalesce(v_agent, 'סוכן/ת') || ' קיבל/ה דירוג 1★'
        || coalesce(' · ' || nullif(btrim(new.text), ''), ''),
      new.linked_lead_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists reviews_alert_platform_admin on public.reviews;
create trigger reviews_alert_platform_admin
  after insert on public.reviews
  for each row execute function public.alert_platform_admin_on_low_review();

-- מנהל/ת הפלטפורמה יושב/ת במשרד משלו/ה, ולכן ה-policy הקיימת
-- ("manager view own agency reviews") לא הייתה מאפשרת לו/ה לפתוח את הביקורת
-- שההתראה מצביעה עליה. קריאה בלבד — האישור/דחייה נשארים בידי המשרד.
drop policy if exists "platform admin reads all reviews" on public.reviews;
create policy "platform admin reads all reviews"
  on public.reviews for select
  using (exists (
    select 1 from public.agency_members
    where agency_members.user_id = (select auth.uid())
      and agency_members.is_platform_admin = true));

-- ---------------------------------------------------------------------------
-- 8. שובר-שוויון בחלוקת לידי בעל-נכס
--
-- ‏owner-lead-intake מחלק לידים ברוטציה שוויונית: הוא ממיין את המועמדים ובוחר
-- את הבא בתור אחרי last_agent_id. עד היום המיון היה לפי UUID — כלומר סדר
-- אקראי לחלוטין.
--
-- הפונקציה הזו מחליפה את המיון האקראי במיון לפי composite_score. חשוב מה היא
-- *לא* עושה: היא לא מסננת אף סוכן/ת ולא נותנת לאיש יותר לידים. הרוטציה עדיין
-- עוברת על כל המועמדים במחזור מלא, כך שכולם מקבלים אותה כמות לידים — הדירוג
-- קובע רק מי ראשון בתור כשנפתח מחזור חדש. זה בדיוק "שובר-שוויון": משפיע
-- כשהכול שווה, ולא הופך את החלוקה לתחרות.
--
-- ‏coalesce(...,-1) מציב סוכן/ת ללא שורת דירוג בסוף התור ולא זורק/ת אותו/ה
-- מהרשימה, ו-id הוא המיון המשני כדי שהסדר יהיה יציב בין קריאות.
-- ---------------------------------------------------------------------------
create or replace function public.order_lead_candidates(p_agent_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t.id order by t.score desc, t.id), '{}'::uuid[])
  from (
    -- group by גם מסיר כפילויות מהמערך הנכנס, כך שהפונקציה בטוחה לקריאה ישירה
    select a.id, max(coalesce(r.composite_score, -1)) as score
    from unnest(p_agent_ids) as a(id)
    left join agent_rankings r on r.agent_id = a.id
    group by a.id
  ) t;
$$;

comment on function public.order_lead_candidates(uuid[]) is
  'ממיינת מועמדים לליד לפי composite_score יורד. שובר-שוויון בלבד — הרוטציה עדיין מחלקת שווה בשווה, זה רק סדר התור.';

grant execute on function public.order_lead_candidates(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 9. תצוגת דירוג ציבורית
--
-- ‏index.html שולף היום את כל שורות reviews לדפדפן ומחשב ממוצע ב-JS. זה עובד
-- בקנה מידה הנוכחי אבל גדל לינארית עם מספר הביקורות. ה-view מחזיר שורה אחת
-- לסוכן/ת — ובלי טקסט הביקורות, שלא נחוץ לכרטיס.
--
-- ‏security_invoker לא מופעל כאן במכוון, באותה תבנית של agency_members_public:
-- ה-view נשען על ה-policy "public read published reviews" שממילא חושפת את
-- הביקורות המפורסמות, ומוסיף עליה רק צבירה.
-- ---------------------------------------------------------------------------
create or replace view public.agent_ratings_public as
select
  am.id                                        as agent_id,
  am.agency_id,
  count(r.id)                                  as review_count,
  round(avg(r.rating)::numeric, 2)             as avg_rating,
  round(coalesce(ar.bayesian_rating, 0), 2)    as bayesian_rating,
  ar.composite_score
from public.agency_members am
left join public.reviews r
       on r.agent_id = am.id and r.status = 'published'
left join public.agent_rankings ar on ar.agent_id = am.id
where am.active = true
group by am.id, am.agency_id, ar.bayesian_rating, ar.composite_score;

comment on view public.agent_ratings_public is
  'דירוג מצטבר לסוכן/ת: כמות ביקורות, ממוצע גולמי, ציון בייסיאני וציון משוקלל. ללא טקסט הביקורות.';

revoke all on public.agent_ratings_public from anon, authenticated;
grant select on public.agent_ratings_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. תזמון
--
-- הסריקה רצה יומית ב-04:00 UTC — אחרי חישוב הדירוגים השבועי (03:00 ביום א׳)
-- כדי ששני ה-jobs לא ייפגשו.
-- ---------------------------------------------------------------------------
select cron.unschedule('enqueue-review-requests')
where exists (select 1 from cron.job where jobname = 'enqueue-review-requests');

select cron.schedule('enqueue-review-requests', '0 4 * * *',
  $cron$select public.enqueue_review_requests()$cron$);
