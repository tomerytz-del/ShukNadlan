-- ===========================================================================
-- קונסולת השיווק — שלב 1: הטבלאות, ההרשאות וה-cron
-- ===========================================================================
--
-- התוכנית המלאה: docs/marketing-console.md. זה השלב הראשון מתוך שבעה, והוא
-- סכימה בלבד — הפונקציה ads-admin והפאנל ב-crm.html באים ב-PR-ים הבאים.
--
-- **מה אין היום.** הקמפיינים הממומנים במטא מנוהלים כולם ב-Ads Manager. אין
-- בפלטפורמה שום רישום של הוצאה, של ליד שהגיע מטופס מיידי, או של מי השהה
-- מודעה ומתי. ליד מטופס של מטא לא נכנס לשום מקום — הוא נשאר במטא עד
-- שמישהו מוריד CSV.
--
-- ‏**מה נכנס:**
--
--   | טבלה                 | מה                                                      |
--   |----------------------|---------------------------------------------------------|
--   | ads_settings         | מפתח-ערך: הדלקה, שורת הגילוי, רדיוס ברירת מחדל. לא טוקנים |
--   | ads_actions_log      | כל פעולה שנעשתה מהקונסולה, ומה מטא ענתה                   |
--   | ads_insights_daily   | ביצועים ליום, ברמת קמפיין / סט / מודעה                    |
--   | ads_leads            | ליד מטופס מיידי, והקישור לליד בפלטפורמה                   |
--
-- ‏**למה snapshot ולא קריאה חיה.** מטא מגבילה קריאות insights ומעדכנת נתונים
-- באיחור של עד 48 שעות. הדאשבורד קורא מהטבלה, והסנכרון כותב מחדש את שני
-- הימים האחרונים בכל הרצה. לכן המפתח של ads_insights_daily הוא
-- ‏(day, level, object_id) — upsert על אותו יום מחליף ולא מכפיל.
--
-- ‏**הרשאות.** קריאה למנהל/ת הפלטפורמה בלבד (current_is_platform_admin()).
-- כתיבה — רק ב-service_role מהפונקציה: אין policy של insert/update/delete,
-- ולכן RLS חוסם כתיבה מהדפדפן גם למנהל/ת. כל פעולה עוברת דרך ads-admin,
-- שם היא נרשמת ביומן ונבדקת (תקציב עד פי 2, שורת הגילוי בטקסט).
--
-- ‏**טוקנים אינם כאן.** META_ADS_ACCESS_TOKEN ושאר הסודות יושבים בסודות של
-- ה-Edge Functions. ‏ads_settings נקראת מהדפדפן, ולכן אסור שיגיע אליה סוד.
--
-- ‏**ה-cron.** ‏ads-insights-sync רץ כל לילה ב-00:10 UTC, ויורה רק כש-
-- ads_settings.enabled הוא true. ברירת המחדל false: הפונקציה עדיין לא
-- קיימת, והסודות עדיין לא הוגדרו, וקריאה לילית שנופלת על 404 היא רעש
-- שהסוכן התפעולי היה מדווח עליו.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ads_settings
-- ---------------------------------------------------------------------------
create table if not exists public.ads_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

comment on table public.ads_settings is
  'הגדרות קונסולת השיווק (מפתח-ערך). נקראת מהדפדפן של מנהל/ת הפלטפורמה - לעולם לא טוקנים. docs/marketing-console.md';

insert into public.ads_settings (key, value, description) values
  ('enabled',           'false'::jsonb,
   'מדליק את הסנכרון הלילי. נשאר false עד שהסודות של מטא מוגדרים והפונקציה ads-admin באוויר'),
  ('disclosure_line',   '""'::jsonb,
   'שורת הגילוי שחייבת להופיע בכל מודעה: שם המפרסם ומספר רישיון (תקנות האתיקה למתווכים). ריקה = ads-admin מסרבת ליצור מודעה'),
  ('default_radius_km', '15'::jsonb,
   'רדיוס הטירגוט ברירת המחדל סביב הנכס, בק"מ'),
  ('sync_days',         '3'::jsonb,
   'כמה ימים אחורה הסנכרון כותב מחדש בכל הרצה. מטא מעדכנת באיחור של עד 48 שעות')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. ads_actions_log
-- ---------------------------------------------------------------------------
create table if not exists public.ads_actions_log (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  actor_id     uuid references public.agency_members(id) on delete set null,
  via          text not null default 'console',
  action       text not null,
  object_type  text,
  object_id    text,
  request      jsonb not null default '{}'::jsonb,
  response     jsonb,
  ok           boolean not null default false,
  error        text
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_actions_log_via_check') then
    alter table public.ads_actions_log add constraint ads_actions_log_via_check
      check (via in ('console', 'cron', 'webhook'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_actions_log_object_type_check') then
    alter table public.ads_actions_log add constraint ads_actions_log_object_type_check
      check (object_type is null or object_type in ('account', 'campaign', 'adset', 'ad', 'creative', 'lead_form', 'post'));
  end if;
end $$;

create index if not exists ads_actions_log_created_idx on public.ads_actions_log (created_at desc);
create index if not exists ads_actions_log_object_idx  on public.ads_actions_log (object_id, created_at desc);

comment on table public.ads_actions_log is
  'יומן כל פעולה מקונסולת השיווק: מי, מה, על איזה אובייקט במטא, מה נשלח ומה מטא ענתה. נכתב רק מ-ads-admin';

-- ---------------------------------------------------------------------------
-- 3. ads_insights_daily
--
-- המטבע הוא של חשבון המודעות (ILS), בשקלים ולא באגורות — כך מטא מחזירה
-- את spend. ‏campaign_id ו-adset_id נשמרים גם בשורות של רמה נמוכה יותר,
-- כדי שהדאשבורד יוכל לקבץ מודעות לפי קמפיין בלי join לטבלה נוספת.
-- ---------------------------------------------------------------------------
create table if not exists public.ads_insights_daily (
  day            date not null,
  level          text not null,
  object_id      text not null,
  object_name    text,
  campaign_id    text,
  adset_id       text,
  spend          numeric(12,2) not null default 0,
  impressions    bigint not null default 0,
  reach          bigint not null default 0,
  clicks         bigint not null default 0,
  link_clicks    bigint not null default 0,
  leads          integer not null default 0,
  conversations  integer not null default 0,
  frequency      numeric(8,4),
  cpm            numeric(12,4),
  ctr            numeric(8,4),
  synced_at      timestamptz not null default now(),
  primary key (day, level, object_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_insights_daily_level_check') then
    alter table public.ads_insights_daily add constraint ads_insights_daily_level_check
      check (level in ('campaign', 'adset', 'ad'));
  end if;
end $$;

create index if not exists ads_insights_daily_campaign_idx on public.ads_insights_daily (campaign_id, day desc);

comment on table public.ads_insights_daily is
  'ביצועי הקמפיינים במטא ליום, ברמת campaign/adset/ad. snapshot שנכתב מחדש בכל סנכרון לשני-שלושה הימים האחרונים. spend בשקלים';

-- ---------------------------------------------------------------------------
-- 4. ads_leads
--
-- ‏ads_leads שומרת את ההצלבה לקמפיין בלבד. הליד עצמו נכנס לפלטפורמה דרך
-- המסלול הקיים של ליד מהאתר (שלב 4 בתוכנית), עם מקור meta_ads, ו-lead_id
-- מצביע עליו. ‏null = עוד לא נקלט, או שנכשל — ואז error מסביר.
-- ---------------------------------------------------------------------------
create table if not exists public.ads_leads (
  meta_lead_id   text primary key,
  created_time   timestamptz not null,
  form_id        text,
  form_name      text,
  ad_id          text,
  adset_id       text,
  campaign_id    text,
  property_id    uuid references public.properties(id) on delete set null,
  field_data     jsonb not null default '[]'::jsonb,
  received_via   text not null default 'sync',
  lead_id        uuid references public.leads(id) on delete set null,
  error          text,
  received_at    timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_leads_received_via_check') then
    alter table public.ads_leads add constraint ads_leads_received_via_check
      check (received_via in ('sync', 'webhook'));
  end if;
end $$;

create index if not exists ads_leads_created_idx  on public.ads_leads (created_time desc);
create index if not exists ads_leads_campaign_idx on public.ads_leads (campaign_id, created_time desc);
create index if not exists ads_leads_pending_idx  on public.ads_leads (received_at) where lead_id is null;

comment on table public.ads_leads is
  'לידים מטפסים מיידיים של מטא. meta_lead_id הוא המפתח, כך שה-webhook והסנכרון אינם מכפילים זה את זה. lead_id = הליד שנוצר בפלטפורמה';

-- ---------------------------------------------------------------------------
-- 5. RLS — קריאה למנהל/ת הפלטפורמה, כתיבה רק ב-service_role
-- ---------------------------------------------------------------------------
alter table public.ads_settings       enable row level security;
alter table public.ads_actions_log    enable row level security;
alter table public.ads_insights_daily enable row level security;
alter table public.ads_leads          enable row level security;

drop policy if exists "platform admin reads ads settings" on public.ads_settings;
create policy "platform admin reads ads settings" on public.ads_settings
  for select to authenticated using (public.current_is_platform_admin());

drop policy if exists "platform admin reads ads actions" on public.ads_actions_log;
create policy "platform admin reads ads actions" on public.ads_actions_log
  for select to authenticated using (public.current_is_platform_admin());

drop policy if exists "platform admin reads ads insights" on public.ads_insights_daily;
create policy "platform admin reads ads insights" on public.ads_insights_daily
  for select to authenticated using (public.current_is_platform_admin());

drop policy if exists "platform admin reads ads leads" on public.ads_leads;
create policy "platform admin reads ads leads" on public.ads_leads
  for select to authenticated using (public.current_is_platform_admin());

-- ‏anon לא צריך כלום כאן, גם לא select שה-RLS היה מחזיר עליו ריק.
revoke all on public.ads_settings, public.ads_actions_log,
              public.ads_insights_daily, public.ads_leads from anon;

-- ---------------------------------------------------------------------------
-- 6. ה-cron הלילי
--
-- ‏00:10 UTC — אחרי שמטא סגרה את היום הקודם בשעון ישראל (UTC+2/+3). התנאי
-- ב-where נבדק בכל הרצה, כך שהדלקה וכיבוי הם עדכון של שורה ב-ads_settings
-- ולא מיגרציה.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/ads-admin';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('ads-insights-sync')
    where exists (select 1 from cron.job where jobname = 'ads-insights-sync');
  perform cron.schedule('ads-insights-sync', '10 0 * * *', format($cron$
    select net.http_post(
      url := %L,
      body := jsonb_build_object('action', 'sync_insights', 'via', 'cron'),
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 120000
    )
    where exists (select 1 from public.ads_settings
                   where key = 'enabled' and value = 'true'::jsonb)
  $cron$, v_url));
end $$;
