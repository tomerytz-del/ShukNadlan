-- ============================================================================
-- עלויות מול תקציב - שלב 7 בשדרוג אזור הניהול (docs/admin-redesign/HANDOFF.md, סעיף 10)
--
-- תקציב חודשי לשלוש קטגוריות - AI, פרסום ותשתית - מול החיובים שכבר נאספים
-- ב-`platform_costs` (קבלות מהמייל והזנה ידנית, docs/platform-costs.md),
-- והתראה לפעמון של מנהלי הפלטפורמה ב-80% וב-100%.
--
-- **ההוצאה היא החיובים, לא הערכת הטוקנים.** הטוקנים כבר נרשמים
-- (`ai_usage_log`, המחירים ב-`ai_model_prices`, ‏`ai_usage_costs`) ומוצגים
-- בפאנל, אבל תקציב הוא כסף שיצא, ומה שיצא הוא הקבלה. כך גם מנוי Claude
-- וטעינות הקרדיט נספרים, ואין ספירה כפולה של אותה הוצאה.
--
-- **הפרסום נמדד מהערוצים, לא מהקבלות** (תומר, 22.10.2026: "סך כל הפרסומים
-- מכל הערוצים, עם פירוט בלחיצה של כל קמפיין - מטא, גוגל ומי שעוד נכניס").
-- הקבלה של מטא מגיעה כ-PDF וממתינה בלי סכום, וגוגל לא שולחת קבלה למייל;
-- ההוצאה היומית לכל קמפיין כבר אצלנו. מטא ב-`ads_insights_daily` (הסנכרון
-- הלילי הקיים), וכל ערוץ אחר ב-`ads_channel_daily` - גוגל מהלילה, וערוץ חדש
-- כותב לשם שורות עם `channel` משלו, בלי מיגרציה.
--
-- **הסכומים הראשונים הם הצעה** (תומר, 22.10.2026: "לפי ההוצאה בפועל"):
-- ממוצע שלושת החודשים האחרונים בכל קטגוריה, מעוגל כלפי מעלה ל-50 ₪. הצעה
-- (`approved_at is null`) מוצגת עם "לאישור" ואינה מתריעה - התראה על סכום
-- שאיש לא קבע היא רעש. שמירה בפאנל מאשרת.
-- ============================================================================

select public.notification_types_add(array['budget_alert']);

-- ---------------------------------------------------------------------------
-- 1. ההגדרות: שלוש קטגוריות ושער הדולר
-- ---------------------------------------------------------------------------

create table if not exists public.platform_budgets (
  key         text primary key check (key in ('ai', 'ads', 'infra', 'usd_rate')),
  amount      numeric check (amount is null or amount >= 0),
  approved_at timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.agency_members(id) on delete set null
);

comment on table public.platform_budgets is
  'תקציב חודשי בשקלים, לפני מע״מ, לכל קטגוריה (ai/ads/infra), ושער הדולר להמרה (usd_rate). approved_at ריק = הצעה שאינה מתריעה. docs/platform-costs.md';

alter table public.platform_budgets enable row level security;
-- נקרא ונכתב רק דרך platform_budget_* (security definer)
revoke all on table public.platform_budgets from anon, authenticated, service_role;
grant select on table public.platform_budgets to service_role;

-- ---------------------------------------------------------------------------
-- 0. ההוצאה על פרסום, מכל הערוצים
-- ---------------------------------------------------------------------------

create table if not exists public.ads_channel_daily (
  channel         text not null check (channel ~ '^[a-z0-9_]{2,30}$'),
  day             date not null,
  campaign_id     text not null,
  campaign_name   text,
  campaign_status text,
  spend           numeric not null default 0,
  currency        text not null default 'ILS' check (currency in ('ILS', 'USD')),
  clicks          bigint not null default 0,
  impressions     bigint not null default 0,
  conversions     numeric not null default 0,
  synced_at       timestamptz not null default now(),
  primary key (channel, day, campaign_id)
);

comment on table public.ads_channel_daily is
  'הוצאה יומית לכל קמפיין בערוצי פרסום שאינם מטא (מטא ב-ads_insights_daily). גוגל נכתבת מ-ads-admin google_sync_insights. ערוץ חדש = channel חדש. docs/platform-costs.md';

alter table public.ads_channel_daily enable row level security;
-- נכתבת מ-ads-admin (service_role) ונקראת דרך admin_ads_spend
revoke all on table public.ads_channel_daily from anon, authenticated, service_role;
grant select, insert, update, delete on table public.ads_channel_daily to service_role;

-- שורה לכל ערוץ וקמפיין בטווח, בשקלים. מטא: חשבון המודעות בשקלים (הקונסולה
-- מציגה ₪), ולכן בלי המרה. ‏leads - לידים במטא, המרות בגוגל.
create or replace function public._ads_spend(p_from date, p_to date, p_rate numeric)
returns table (channel text, campaign_id text, campaign_name text, spend numeric, clicks bigint, leads numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'meta', i.campaign_id, max(i.object_name), sum(coalesce(i.spend, 0)),
         sum(coalesce(i.link_clicks, i.clicks, 0))::bigint, sum(coalesce(i.leads, 0))
    from public.ads_insights_daily i
   where i.level = 'campaign' and i.day between p_from and p_to
   group by i.campaign_id
  union all
  select d.channel, d.campaign_id, max(d.campaign_name),
         sum(case when d.currency = 'USD' then d.spend * p_rate else d.spend end),
         sum(d.clicks)::bigint, sum(d.conversions)
    from public.ads_channel_daily d
   where d.day between p_from and p_to
   group by d.channel, d.campaign_id;
$$;

revoke all on function public._ads_spend(date, date, numeric) from public, anon, authenticated;

create or replace function public.admin_ads_spend(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date);
  v_to   date := coalesce(p_to, (now() at time zone 'Asia/Jerusalem')::date);
  v_rate numeric := coalesce((select b.amount from public.platform_budgets b where b.key = 'usd_rate'), 3.7);
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total', coalesce((select round(sum(s.spend), 2) from public._ads_spend(v_from, v_to, v_rate) s), 0),
    -- לפי חודש, לגרף "לפי חודש" בפאנל העלויות
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', x.m, 'spend', round(x.v, 2)) order by x.m)
      from (select to_char(u.day, 'YYYY-MM') m, sum(u.v) v
              from (select i.day, coalesce(i.spend, 0) v
                      from public.ads_insights_daily i
                     where i.level = 'campaign' and i.day between v_from and v_to
                    union all
                    select d.day, case when d.currency = 'USD' then d.spend * v_rate else d.spend end
                      from public.ads_channel_daily d
                     where d.day between v_from and v_to) u
             group by 1) x), '[]'::jsonb),
    'synced', jsonb_build_object(
      'meta', (select max(i.synced_at) from public.ads_insights_daily i),
      'google', (select max(d.synced_at) from public.ads_channel_daily d where d.channel = 'google')),
    'channels', coalesce((select jsonb_agg(jsonb_build_object(
        'channel', c.channel, 'spend', c.spend, 'clicks', c.clicks, 'leads', c.leads, 'campaigns', c.campaigns)
        order by c.spend desc)
      from (select s.channel, round(sum(s.spend), 2) spend, sum(s.clicks) clicks, sum(s.leads) leads,
                   jsonb_agg(jsonb_build_object('id', s.campaign_id, 'name', s.campaign_name,
                     'spend', round(s.spend, 2), 'clicks', s.clicks, 'leads', s.leads) order by s.spend desc) campaigns
              from public._ads_spend(v_from, v_to, v_rate) s
             group by s.channel) c), '[]'::jsonb));
end $$;

comment on function public.admin_ads_spend(date, date) is
  'ההוצאה על פרסום בכל הערוצים (מטא, גוגל ומה שיתווסף), עם פירוט לכל קמפיין, בשקלים. ברירת המחדל: החודש עד היום. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.admin_ads_spend(date, date) from public, anon, authenticated;
grant execute on function public.admin_ads_spend(date, date) to authenticated;

-- השירות → הקטגוריה. ספק שאינו AI ואינו פרסום הוא תשתית: Netlify, Supabase,
-- הדומיין, Twilio, Make, ‏morning ושאר מה שמחזיק את המערכת.
create or replace function public.platform_cost_category(p_service text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_service in ('anthropic_api', 'claude_subscription', 'fal_ai', 'openai', 'replicate', 'gemini') then 'ai'
    when p_service in ('meta', 'google_ads') then 'ads'
    else 'infra'
  end;
$$;

revoke all on function public.platform_cost_category(text) from public, anon, authenticated;

-- ההוצאה בשקלים לקטגוריה בחודש. ‏status = 'confirmed' בלבד: סכום שממתין אינו
-- נספר, כמו בכל הפאנל (docs/platform-costs.md, "שני כללים בטבלה"). הפרסום -
-- מהערוצים (`_ads_spend`), והקבלות של מטא וגוגל אינן נספרות שוב.
create or replace function public._platform_spend(p_month date, p_rate numeric)
returns table (category text, spent numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select public.platform_cost_category(c.service),
         round(sum(case when c.currency = 'USD' then c.amount * p_rate else c.amount end), 2)
    from public.platform_costs c
   where c.status = 'confirmed' and c.amount is not null
     and c.currency in ('USD', 'ILS')
     and public.platform_cost_category(c.service) <> 'ads'
     and c.charged_on >= date_trunc('month', p_month)::date
     and c.charged_on <  (date_trunc('month', p_month) + interval '1 month')::date
   group by 1
  union all
  select 'ads', round(sum(a.spend), 2)
    from public._ads_spend(date_trunc('month', p_month)::date,
                           (date_trunc('month', p_month) + interval '1 month - 1 day')::date, p_rate) a
  having sum(a.spend) is not null;
$$;

revoke all on function public._platform_spend(date, numeric) from public, anon, authenticated;

-- ההצעה הראשונה: ממוצע שלושת החודשים האחרונים (כולל החודש הנוכחי עד היום -
-- ב-10.2026 הוא הגבוה מהשלושה, ובלעדיו התקציב היה נחצה ביום הראשון).
insert into public.platform_budgets (key, amount)
values ('usd_rate', 3.7)
on conflict (key) do nothing;

insert into public.platform_budgets (key, amount)
select k.key,
       nullif(ceil(coalesce((select sum(s.spent) from generate_series(0, 2) g(i)
                              cross join lateral public._platform_spend(
                                (date_trunc('month', now()) - make_interval(months => g.i))::date, 3.7) s
                             where s.category = k.key), 0) / 3 / 50.0) * 50, 0)
  from (values ('ai'), ('ads'), ('infra')) k(key)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. המצב (מנהל/ת) והעדכון
-- ---------------------------------------------------------------------------

create or replace function public._platform_budget_rows(p_month date)
returns table (category text, budget numeric, approved boolean, spent numeric, pct int)
language sql
stable
security invoker
set search_path = ''
as $$
  with rate as (select coalesce((select b.amount from public.platform_budgets b where b.key = 'usd_rate'), 3.7) r)
  select k.key,
         b.amount,
         b.approved_at is not null,
         coalesce(s.spent, 0),
         case when coalesce(b.amount, 0) > 0 then round(100 * coalesce(s.spent, 0) / b.amount)::int end
    from (values ('ai'), ('ads'), ('infra')) k(key)
    left join public.platform_budgets b on b.key = k.key
    left join public._platform_spend(p_month, (select r from rate)) s on s.category = k.key;
$$;

revoke all on function public._platform_budget_rows(date) from public, anon, authenticated;

create or replace function public.platform_budget_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'month', to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM'),
    'usd_rate', coalesce((select b.amount from public.platform_budgets b where b.key = 'usd_rate'), 3.7),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.category, 'budget', r.budget, 'approved', r.approved, 'spent', r.spent, 'pct', r.pct))
      from public._platform_budget_rows((now() at time zone 'Asia/Jerusalem')::date) r), '[]'::jsonb));
end $$;

comment on function public.platform_budget_status() is
  'ההוצאה החודשית מול התקציב לכל קטגוריה (ai/ads/infra), בשקלים. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.platform_budget_status() from public, anon, authenticated;
grant execute on function public.platform_budget_status() to authenticated;

create or replace function public.platform_budget_set(p_key text, p_amount numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  if p_key not in ('ai', 'ads', 'infra', 'usd_rate')
     or (p_amount is not null and (p_amount < 0 or p_amount > 1000000))
     or (p_key = 'usd_rate' and (p_amount is null or p_amount < 1 or p_amount > 10)) then
    raise exception 'budget_invalid' using errcode = '22023';
  end if;
  insert into public.platform_budgets (key, amount, approved_at, updated_at, updated_by)
  values (p_key, p_amount, now(), now(), public.current_agent_id())
  on conflict (key) do update
     set amount = excluded.amount, approved_at = now(), updated_at = now(), updated_by = excluded.updated_by;
end $$;

comment on function public.platform_budget_set(text, numeric) is
  'קביעת תקציב חודשי (ai/ads/infra, null = בלי תקציב) או שער הדולר. השמירה היא האישור. מנהל/ת פלטפורמה בלבד (42501).';

revoke all on function public.platform_budget_set(text, numeric) from public, anon, authenticated;
grant execute on function public.platform_budget_set(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ההתראה: 80% ו-100%, פעם אחת לקטגוריה לחודש לכל סף
-- ---------------------------------------------------------------------------

create table if not exists public.platform_budget_alerts (
  category text not null,
  month    date not null,
  level    smallint not null check (level in (80, 100)),
  sent_at  timestamptz not null default now(),
  primary key (category, month, level)
);

alter table public.platform_budget_alerts enable row level security;
revoke all on table public.platform_budget_alerts from anon, authenticated, service_role;

create or replace function public.platform_budget_notify()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date;
  r record;
  v_level smallint;
  v_label text;
  v_n int := 0;
begin
  for r in select * from public._platform_budget_rows(v_month) where approved and budget > 0 loop
    v_level := case when r.pct >= 100 then 100 when r.pct >= 80 then 80 end;
    continue when v_level is null;
    -- 100% שנחצה ישר מתחת ל-80% שולח רק אותו, ו-80% נרשם יחד איתו
    insert into public.platform_budget_alerts (category, month, level)
    select r.category, v_month, l from unnest(array[80, v_level]::smallint[]) l
     where l <= v_level
    on conflict do nothing;
    continue when not found;
    if exists (select 1 from public.platform_budget_alerts a
                where a.category = r.category and a.month = v_month and a.level = v_level
                  and a.sent_at < now() - interval '1 second') then
      continue;
    end if;
    v_label := case r.category when 'ai' then 'AI' when 'ads' then 'פרסום' else 'תשתית' end;
    insert into public.notifications (agent_id, type, title, body)
    select m.id, 'budget_alert',
           case when v_level = 100 then 'תקציב ה' || v_label || ' של החודש נוצל במלואו'
                else 'תקציב ה' || v_label || ' של החודש הגיע ל-80%' end,
           '₪' || to_char(r.spent, 'FM999,999,990') || ' מתוך ₪' || to_char(r.budget, 'FM999,999,990')
             || ' (' || r.pct || '%). הפירוט בעלויות תפעול ו-AI.'
      from public.agency_members m
     where m.is_platform_admin and m.active;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

comment on function public.platform_budget_notify() is
  'התראה לפעמון של מנהלי הפלטפורמה כשקטגוריה עוברת 80% או 100% מהתקציב המאושר. פעם אחת לסף בחודש. pg_cron (platform-budget-notify).';

revoke all on function public.platform_budget_notify() from public, anon, authenticated;
grant execute on function public.platform_budget_notify() to service_role;

-- הסנכרון הלילי של גוגל, רבע שעה אחרי זה של מטא (ads-insights-sync, 00:10).
-- נורה רק כש-ads_settings.enabled, כמו של מטא (הבדיקה ב-ads-admin).
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/ads-admin';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - סנכרון גוגל לא תוזמן';
    return;
  end if;
  perform cron.unschedule('ads-google-sync')
    where exists (select 1 from cron.job where jobname = 'ads-google-sync');
  perform cron.schedule('ads-google-sync', '25 0 * * *', format($cron$
    select net.http_post(
      url := %L,
      body := jsonb_build_object('action', 'google_sync_insights', 'via', 'cron'),
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 60000
    )
    where exists (select 1 from public.ads_settings
                   where key = 'enabled' and value = 'true'::jsonb)
  $cron$, v_url));
end;
$$;

-- קבלות נקלטות כל שתי דקות, אבל תקציב חודשי לא צריך יותר מבדיקה בשעה
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - התראות התקציב לא תוזמנו';
    return;
  end if;
  perform cron.unschedule('platform-budget-notify')
    where exists (select 1 from cron.job where jobname = 'platform-budget-notify');
  perform cron.schedule('platform-budget-notify', '41 * * * *',
    'select public.platform_budget_notify();');
end;
$$;
