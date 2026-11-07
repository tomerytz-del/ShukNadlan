-- ===========================================================================
-- יומן בקשות ל-/crm - לזהות מי פותח את האזור האישי
--
-- למה: ב-GA4 נראו 11 קישורים עמוקים ל-/crm עם אותו UUID אפס, ובלי IP וכותרות
-- אי אפשר לדעת מי שולח אותם. רק השרת רואה את הבקשה עצמה, ו-GA4 רואה רק מי שמריץ JavaScript.
-- הקליטה: netlify/edge-functions/crm-request-log.ts -> supabase/functions/
-- crm-request-log -> crm_request_log_add. docs/crm-request-log.md.
--
-- ‏**מידע אישי:** נשמר IP (נתון אישי לפי חוק הגנת הפרטיות), ולכן נמחק אחרי 30
-- יום. המחיקה כאן ולא ב-data_retention_run: היא מוטמעת בפונקציית הכתיבה,
-- כדי שלא להעתיק פונקציה של מאות שורות שפותחים בכל PR.
--
-- ‏**מה לא נשמר:** ערכי query שאינם ברשימה (code, state, k, טוקנים) - רק שם
-- הפרמטר; וה-referer בלי query. קישור שהוא הרשאה לא נשמר במסד.
--
-- ‏**הגנה מהצפה:** בקשה זהה מאותו IP בדקה לא נרשמת פעמיים; ותקרה של 30,000 שורות ביום. מעבר לה לא נכתב כלום - עדיף
-- יומן שנחתך מהצפה על מסד שמתמלא. הקריאה רק לסוד משותף, ראו הפונקציה.
-- ===========================================================================

create table if not exists public.crm_request_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ip          text,
  country     text,
  city        text,
  method      text,
  path        text,
  query       text,
  status      integer,
  user_agent  text,
  referer     text,
  accept_lang text,
  sec_fetch   text,
  ch_mobile   text,
  ch_platform text
);

comment on table public.crm_request_log is
  'יומן בקשות ל-/crm (IP וכותרות), 30 יום. docs/crm-request-log.md';

create index if not exists crm_request_log_at_idx on public.crm_request_log (at desc);
create index if not exists crm_request_log_ip_idx on public.crm_request_log (ip, at desc);

alter table public.crm_request_log enable row level security;
revoke all on table public.crm_request_log from public, anon, authenticated;
grant select on table public.crm_request_log to authenticated;
grant all on table public.crm_request_log to service_role;

drop policy if exists "platform admin reads crm request log" on public.crm_request_log;
create policy "platform admin reads crm request log"
  on public.crm_request_log for select to authenticated
  using (public.current_is_platform_admin());

create or replace function public.crm_request_log_add(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then return; end if;

  -- מחיקה אחרי 30 יום, בכל עשרים קריאות בקירוב ולא בכל קריאה
  if random() < 0.05 then
    delete from public.crm_request_log where at < now() - interval '30 days';
  end if;

  -- אותה בקשה בדיוק מאותו IP בדקה האחרונה אינה נרשמת שוב: סורק שחוזר על עצמו
  -- לא ממלא את התקרה היומית ומסתיר את מה שחשוב
  if exists (
    select 1 from public.crm_request_log
     where ip = left(p->>'ip', 64) and at > now() - interval '1 minute'
       and path is not distinct from left(p->>'path', 300)
       and query is not distinct from left(p->>'query', 600)
  ) then
    return;
  end if;

  if (select count(*) from public.crm_request_log where at >= date_trunc('day', now())) >= 30000 then
    return;
  end if;

  insert into public.crm_request_log
    (ip, country, city, method, path, query, status, user_agent, referer,
     accept_lang, sec_fetch, ch_mobile, ch_platform)
  values (
    left(p->>'ip', 64), left(p->>'country', 8), left(p->>'city', 80),
    left(p->>'method', 12), left(p->>'path', 300), left(p->>'query', 600),
    nullif(p->>'status', '')::integer, left(p->>'user_agent', 400),
    left(p->>'referer', 400), left(p->>'accept_lang', 120),
    left(p->>'sec_fetch', 120), left(p->>'ch_mobile', 8), left(p->>'ch_platform', 40)
  );
end;
$$;

revoke all on function public.crm_request_log_add(jsonb) from public, anon, authenticated;
grant execute on function public.crm_request_log_add(jsonb) to service_role;
