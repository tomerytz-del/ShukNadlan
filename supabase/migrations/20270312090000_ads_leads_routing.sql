-- ===========================================================================
-- קונסולת השיווק, שלב 4 — לידים מטפסי מטא נכנסים לפלטפורמה
-- ===========================================================================
--
-- עד היום ליד מטופס מיידי של מטא נשאר במטא עד שמישהו מוריד CSV. מעכשיו הוא
-- נכנס **דרך אותו מסלול כמו ליד מהאתר** — אותן Edge Functions, אותה רוטציה,
-- אותם מחירים ואותה טריות — והטבלה ads_leads שומרת את ההצלבה לקמפיין.
--
-- ‏**סוג לכל טופס (ads_lead_forms.kind).** מטא אינה יודעת מה הליד אומר; מי
-- שבנה את הטופס יודע. לכן כל טופס משויך פעם אחת בפאנל:
--
--   | kind     | לאן                         | הערה |
--   |----------|-----------------------------|------|
--   | property | property-inquiry-intake      | פנייה על נכס מסוים - property_id חובה |
--   | owner    | owner-lead-intake            | "רוצה למכור/להשכיר" - רוטציה כמו באתר |
--   | buyer    | saved-search-intake          | מחפש/ת - הסכמה לפנייה רק מתשובה מפורשת בטופס |
--   | broker   | נשאר כאן                     | קמפיין הפלטפורמה למתווכים - ליד של תומר, לא של סוכן/ת |
--   | ignore   | נשאר כאן                     | טופס בדיקה או ישן |
--
-- טופס שעוד לא שויך: הלידים שלו ממתינים (status = 'new') ונשלחים ברגע
-- השיוך. שום ליד לא הולך לאיבוד בגלל שהטופס נוצר לפני שהקונסולה ידעה עליו.
--
-- ‏**מניעת כפילות.** ‏meta_lead_id הוא המפתח של ads_leads, וה-webhook
-- והסנכרון השעתי כותבים לאותה שורה. ליד נשלח למסלול רק כשהוא 'new' או
-- 'failed', ובתוך עדכון מותנה (ads_lead_claim) — שתי ריצות מקבילות לא
-- יוצרות שני לידים.
--
-- ‏**הערוץ.** ‏lead_source_channel() ממפה את meta_ads_* לערוץ משלו. בלי זה
-- כל ליד ממטא היה נספר ב"אחר" בבקרת מנוע הלידים — בדיוק הדוח שקיים כדי
-- לראות מאיפה מגיעים לידים.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. שיוך טפסים
-- ---------------------------------------------------------------------------
create table if not exists public.ads_lead_forms (
  form_id                text primary key,
  form_name              text,
  kind                   text not null default 'ignore',
  property_id            uuid references public.properties(id) on delete set null,
  deal_type              text,
  default_city           text,
  default_property_type  text,
  field_map              jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_lead_forms_kind_check') then
    alter table public.ads_lead_forms add constraint ads_lead_forms_kind_check
      check (kind in ('property', 'owner', 'buyer', 'broker', 'ignore'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_lead_forms_deal_check') then
    alter table public.ads_lead_forms add constraint ads_lead_forms_deal_check
      check (deal_type is null or deal_type in ('sale', 'rent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_lead_forms_property_check') then
    alter table public.ads_lead_forms add constraint ads_lead_forms_property_check
      check (kind <> 'property' or property_id is not null);
  end if;
end $$;

comment on table public.ads_lead_forms is
  'לכל טופס לידים במטא: לאיזה מסלול הליד נשלח (property/owner/buyer/broker/ignore), ומה חסר בטופס עצמו (נכס, סוג עסקה, עיר). field_map = איזו שאלה בטופס היא העיר/התקציב/ההסכמה. docs/marketing-console.md';

-- ---------------------------------------------------------------------------
-- 2. מצב הניתוב של כל ליד
-- ---------------------------------------------------------------------------
alter table public.ads_leads add column if not exists kind       text;
alter table public.ads_leads add column if not exists status     text not null default 'new';
alter table public.ads_leads add column if not exists attempts   integer not null default 0;
alter table public.ads_leads add column if not exists routed_at  timestamptz;
alter table public.ads_leads add column if not exists claimed_at timestamptz;
alter table public.ads_leads add column if not exists target     jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_leads_status_check') then
    alter table public.ads_leads add constraint ads_leads_status_check
      check (status in ('new', 'routing', 'routed', 'failed', 'broker', 'skipped'));
  end if;
end $$;

create index if not exists ads_leads_status_idx on public.ads_leads (status, received_at) where status in ('new', 'failed');

comment on column public.ads_leads.status is
  'new = ממתין לשיוך טופס או לשליחה; routing = נלקח לשליחה עכשיו; routed = נכנס לפלטפורמה (target); failed = נכשל (error), ינוסה שוב; broker = ליד מקמפיין המתווכים; skipped = טופס ignore';

alter table public.ads_lead_forms enable row level security;
drop policy if exists "platform admin reads ads lead forms" on public.ads_lead_forms;
create policy "platform admin reads ads lead forms" on public.ads_lead_forms
  for select to authenticated using (public.current_is_platform_admin());
revoke all on public.ads_lead_forms from anon;

-- ---------------------------------------------------------------------------
-- 3. נעילת ליד לשליחה
--
-- ‏webhook וסנכרון יכולים לרוץ באותה שנייה על אותו ליד. העדכון המותנה הוא
-- הנעילה: רק מי שהעביר את השורה מ-new/failed ל-routing שולח אותה. ליד
-- שנתקע ב-routing יותר מ-10 דקות (פונקציה שנפלה באמצע) משוחרר לניסיון חוזר.
-- ---------------------------------------------------------------------------
create or replace function public.ads_lead_claim(p_meta_lead_id text)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with c as (
    update public.ads_leads
       set status = 'routing', attempts = attempts + 1, claimed_at = now()
     where meta_lead_id = p_meta_lead_id
       and (status in ('new', 'failed')
            or (status = 'routing' and claimed_at < now() - interval '10 minutes'))
       and attempts < 5
    returning 1
  )
  select exists (select 1 from c);
$$;

comment on function public.ads_lead_claim(text) is
  'נעילת ליד ממטא לשליחה למסלול הפלטפורמה: true רק לקורא אחד. עד 5 ניסיונות. נקראת מ-ads-admin ומ-ads-leads-webhook בלבד';

revoke all on function public.ads_lead_claim(text) from public, anon, authenticated;
grant execute on function public.ads_lead_claim(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. ערוץ meta_ads בבקרת מנוע הלידים
--
-- אותה פונקציה בדיוק (20261122090000_lead_analytics.sql), ועוד ענף אחד
-- לפני ה-else. ‏create or replace שומר את ההרשאות הקיימות.
-- ---------------------------------------------------------------------------
create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
as $$
  select case
    when p_source is null                       then 'other'
    when p_source like 'whatsapp\_bot%'         then 'whatsapp_bot'
    when p_source = 'rss_engine'                then 'rss_engine'
    when p_source like 'homepage%'              then 'homepage'
    when p_source = 'footer_buyer_wizard'       then 'footer'
    when p_source like 'property\_page%'        then 'property_page'
    when p_source like 'agency\_page%'
      or p_source = 'agency'                    then 'agency_page'
    when p_source like 'agent\_page%'           then 'agent_page'
    when p_source like 'project%'               then 'project_page'
    when p_source = 'open_house_page'           then 'open_house'
    when p_source like 'meta\_ads%'             then 'meta_ads'
    when p_source = 'unattributed'              then 'unattributed'
    else 'other'
  end;
$$;

comment on function public.lead_source_channel(text) is
  'הערוץ שאליו שייך מזהה מקור הליד: whatsapp_bot · homepage · footer · property_page · agency_page · agent_page · project_page · open_house · meta_ads · rss_engine · unattributed · other. המיפוי בקידומת, כדי שמקור חדש ייכנס לערוץ הנכון בלי מיגרציה.';

-- ---------------------------------------------------------------------------
-- 5. סנכרון שעתי - רשת הביטחון של ה-webhook
--
-- ‏webhook שנפל (פריסה, תקלה אצל מטא) לא מאבד ליד: הסנכרון מושך את הלידים
-- של כל טופס משויך מהשעות האחרונות, ו-meta_lead_id מונע כפילות. יורה רק
-- כש-ads_settings.enabled, כמו ads-insights-sync.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/ads-admin';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - אין מה לתזמן';
    return;
  end if;

  perform cron.unschedule('ads-leads-sync')
    where exists (select 1 from cron.job where jobname = 'ads-leads-sync');
  perform cron.schedule('ads-leads-sync', '20 * * * *', format($cron$
    select net.http_post(
      url := %L,
      body := jsonb_build_object('action', 'sync_leads', 'via', 'cron'),
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 120000
    )
    where exists (select 1 from public.ads_settings
                   where key = 'enabled' and value = 'true'::jsonb)
      and exists (select 1 from public.ads_lead_forms where kind <> 'ignore')
  $cron$, v_url));
end $$;
