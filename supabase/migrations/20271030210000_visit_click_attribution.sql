-- ============================================================================
-- קליקים מקישור /go/<code>, וייחוס ביקור ראשון לליד ולהרשמה
--
-- היום GA4 רואה ביקור בדף הבית, ובמסד אין שורת ביקור. סוכן שמדביק קישור
-- בתגובה בקבוצת פייסבוק צריך לדעת כמה לחצו, וכמה מהם השאירו ליד או נרשמו.
--
-- מה נכנס:
--   link_clicks            כל GET ל-/go/<code>. בלי IP ובלי מחרוזת UA.
--   record_link_click      כתיבה מצומצמת. anon קורא לה מה-edge, ואינו
--                          קורא את הטבלה ואינו כותב לה ישירות.
--   attr_*                 חמש עמודות nullable על לידים והרשמות. בלי
--                          מילוי לאחור. טריגר מונע מ-anon ומ-authenticated
--                          לכתוב אותן. service_role בפונקציות הקליטה כותב.
--   link_click_daily       קליקים ליום (בלי בוטים) וספירת בוטים.
--   visit_attribution_daily  לידים והרשמות לפי מקור וקוד ליום.
--   link_clicks_purge      מחיקה ישנה. לא מתוזמנת. ראו ההערה בתחתית.
--
-- לא נוגעים בניתוב לידים, בהתראות, בוואטסאפ, או בטריגר ששולח הודעה.
-- העמודות החדשות nullable, והקוד סובל את היעדרן עד שהמיגרציה רצה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- קליקים
-- ---------------------------------------------------------------------------

create table if not exists public.link_clicks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  code text not null,
  variant text,
  scraped_lead_id uuid,
  is_bot boolean not null default false,
  constraint link_clicks_code_check check (code ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  constraint link_clicks_variant_check check (
    variant is null or variant ~ '^[a-z0-9][a-z0-9-]{0,31}$'
  )
);

comment on table public.link_clicks is
  'קליק על /go/<code>. אין IP ואין מחרוזת דפדפן. is_bot הוא דגל בלבד (תצוגה מקדימה וסורק). scraped_lead_id בלי מפתח זר: מזהה לא קיים לא מפיל את הרישום. docs/click-tracking.md';

comment on column public.link_clicks.scraped_lead_id is
  'מזהה אופציונלי מפרמטר sl. בלי FK כדי שרישום הקליק לא ייכשל על מזהה חסר.';

create index if not exists link_clicks_code_created_idx
  on public.link_clicks (code, created_at desc);

alter table public.link_clicks enable row level security;

revoke all on table public.link_clicks from anon, authenticated;
grant select on table public.link_clicks to service_role;

-- אין policy. anon ו-authenticated לא קוראים ולא כותבים. service_role
-- עוקף RLS, והכתיבה מהאתר עוברת בפונקציה למטה (היא הבעלים של השורה).

create or replace function public.record_link_click(
  p_code text,
  p_variant text,
  p_scraped_lead_id uuid,
  p_is_bot boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_variant text := lower(btrim(coalesce(p_variant, '')));
begin
  if v_code !~ '^[a-z0-9][a-z0-9-]{0,31}$' then
    return;
  end if;
  if v_variant = '' or v_variant !~ '^[a-z0-9][a-z0-9-]{0,31}$' then
    v_variant := null;
  end if;
  insert into public.link_clicks (code, variant, scraped_lead_id, is_bot)
  values (v_code, v_variant, p_scraped_lead_id, coalesce(p_is_bot, false));
end;
$$;

comment on function public.record_link_click(text, text, uuid, boolean) is
  'רושם קליק אחד. כותבת רק code, variant, scraped_lead_id, is_bot. קוד לא תקין יוצא בלי שורה. anon קורא מה-edge של /go. אין קריאה של הטבלה.';

revoke all on function public.record_link_click(text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_link_click(text, text, uuid, boolean) to anon, service_role;

-- ---------------------------------------------------------------------------
-- ייחוס על ליד והרשמה
--
-- anon מחזיק GRANT ישן של insert/update על חלק מהטבלאות (לפני 30.10.2026).
-- עמודה חדשה נכנסת ל-GRANT הזה לבד. ה-revoke מוציא את הכתיבה. ה-RLS
-- ממילא לא נתן ל-anon להכניס ליד (agent_id = current_agent_id()).
-- authenticated נשאר עם ה-GRANT שלו ל-CRM. הטריגר מוחק לו את חמש העמודות
-- כדי שלא יזייף מקור. service_role בפונקציות הקליטה הוא מי שכותב אותן.
-- ---------------------------------------------------------------------------

create or replace function public.visit_attr_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.attr_source := null;
      new.attr_medium := null;
      new.attr_campaign := null;
      new.attr_content := null;
      new.attr_code := null;
    else
      new.attr_source := old.attr_source;
      new.attr_medium := old.attr_medium;
      new.attr_campaign := old.attr_campaign;
      new.attr_content := old.attr_content;
      new.attr_code := old.attr_code;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.visit_attr_lock() is
  'anon ו-authenticated אינם כותבים attr_*. service_role כותב. לא שולח הודעה.';

revoke all on function public.visit_attr_lock() from public, anon, authenticated;

do $$
declare
  t text;
  c text;
  tables text[] := array[
    'leads',
    'mortgage_leads',
    'saved_searches',
    'project_leads',
    'agencies',
    'developers',
    'newsletter_subscribers'
  ];
  cols text[] := array[
    'attr_source',
    'attr_medium',
    'attr_campaign',
    'attr_content',
    'attr_code'
  ];
begin
  foreach t in array tables loop
    foreach c in array cols loop
      execute format('alter table public.%I add column if not exists %I text', t, c);
      if not exists (
        select 1 from pg_catalog.pg_constraint where conname = t || '_' || c || '_fmt'
      ) then
        execute format(
          'alter table public.%I add constraint %I check (%I is null or %I ~ %L)',
          t,
          t || '_' || c || '_fmt',
          c,
          c,
          '^[a-z0-9][a-z0-9_-]{0,39}$'
        );
      end if;
    end loop;
    execute format('drop trigger if exists visit_attr_lock on public.%I', t);
    execute format(
      'create trigger visit_attr_lock before insert or update on public.%I for each row execute function public.visit_attr_lock()',
      t
    );
    execute format('revoke insert, update on table public.%I from anon', t);
  end loop;
end;
$$;

comment on column public.leads.attr_source is
  'ייחוס ביקור ראשון מהאתר: utm_source. nullable, בלי מילוי לאחור. נכתב רק מ-service_role.';
comment on column public.leads.attr_medium is
  'utm_medium של הביקור הראשון.';
comment on column public.leads.attr_campaign is
  'utm_campaign של הביקור הראשון.';
comment on column public.leads.attr_content is
  'utm_content של הביקור הראשון, בדרך כלל קוד ה-/go.';
comment on column public.leads.attr_code is
  'קוד /go של הביקור הראשון. לרוב זהה ל-attr_content.';

-- ---------------------------------------------------------------------------
-- דוחות. security_invoker: אין הרחבת גישה מעבר ל-GRANT.
-- service_role בלבד. execute_sql של מנהל רץ בתפקיד הזה.
-- ---------------------------------------------------------------------------

create or replace view public.link_click_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Jerusalem')::date as day,
  code,
  variant,
  count(*) filter (where not is_bot) as clicks,
  count(*) filter (where is_bot) as bot_clicks
from public.link_clicks
group by 1, 2, 3;

comment on view public.link_click_daily is
  'קליקים ליום לפי קוד. clicks בלי בוטים. bot_clicks בנפרד. service_role בלבד.';

create or replace view public.visit_attribution_daily
with (security_invoker = true) as
select day, kind, attr_source, attr_medium, attr_campaign, attr_content, attr_code, conversions
from (
  select (created_at at time zone 'Asia/Jerusalem')::date as day,
         'lead'::text as kind,
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint as conversions
    from public.leads
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
  union all
  select (created_at at time zone 'Asia/Jerusalem')::date,
         'mortgage_lead',
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint
    from public.mortgage_leads
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
  union all
  select (created_at at time zone 'Asia/Jerusalem')::date,
         'saved_search',
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint
    from public.saved_searches
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
  union all
  select (created_at at time zone 'Asia/Jerusalem')::date,
         'project_lead',
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint
    from public.project_leads
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
  union all
  select (created_at at time zone 'Asia/Jerusalem')::date,
         'office_signup',
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint
    from public.agencies
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
  union all
  select (created_at at time zone 'Asia/Jerusalem')::date,
         'developer_signup',
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint
    from public.developers
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
  union all
  select (created_at at time zone 'Asia/Jerusalem')::date,
         'newsletter',
         attr_source, attr_medium, attr_campaign, attr_content, attr_code,
         count(*)::bigint
    from public.newsletter_subscribers
   where attr_source is not null or attr_medium is not null
      or attr_campaign is not null or attr_content is not null
      or attr_code is not null
   group by 1, 3, 4, 5, 6, 7
) attributed;

comment on view public.visit_attribution_daily is
  'לידים והרשמות עם ייחוס, ליום. שורה בלי attr אינה נספרת. service_role בלבד.';

revoke all on public.link_click_daily from anon, authenticated;
grant select on public.link_click_daily to service_role;

revoke all on public.visit_attribution_daily from anon, authenticated;
grant select on public.visit_attribution_daily to service_role;

-- ---------------------------------------------------------------------------
-- שמירה
--
-- אין בטבלה מידע אישי, ולכן זה לא נכנס ל-data_retention_run (שם נמחקים
-- פרטים אישיים ויוצאת התראה). 400 יום הם הצעה לגודל הטבלה, לא מדיניות
-- פרטיות. הפונקציה אינה ב-cron. להדליק רק בהחלטה נפרדת, למשל:
--   select public.link_clicks_purge(400);
-- רצפה של 30 יום כדי שקריאה עם 0 לא תרוקן את הטבלה בטעות.
-- ---------------------------------------------------------------------------

create or replace function public.link_clicks_purge(p_keep_days integer default 400)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  days integer := greatest(30, least(coalesce(p_keep_days, 400), 3650));
begin
  delete from public.link_clicks
   where created_at < pg_catalog.now() - pg_catalog.make_interval(days => days);
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.link_clicks_purge(integer) is
  'מוחקת קליקים ישנים מ-link_clicks. לא מתוזמנת. ברירת מחדל 400 יום, לא פחות מ-30. service_role בלבד.';

revoke all on function public.link_clicks_purge(integer) from public, anon, authenticated;
grant execute on function public.link_clicks_purge(integer) to service_role;
