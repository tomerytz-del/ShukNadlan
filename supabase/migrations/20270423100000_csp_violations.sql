-- ===========================================================================
-- דיווחי הפרה של ה-CSP
--
-- ה-CSP באתר נמצא ב-Report-Only (‏_headers): הוא מתאר מה מותר, ולא חוסם
-- כלום. כדי להעביר אותו לאכיפה צריך לדעת **מה הוא היה חוסם**, אחרת
-- האכיפה תשבור בשקט משהו שאיש לא זכר (פיקסל שנטען דרך GTM, מפה, וידאו).
-- עד היום לא היה לאן לדווח, ולכן לא היה מאיפה לדעת.
--
-- ‏**מה נשמר:** ספירה ליום לכל צירוף של הנחיה, מקור חסום (origin בלבד)
-- ודף (נתיב בלי query). בלי IP, בלי user-agent, בלי URL מלא - כתובת עם
-- query יכולה לשאת מזהה או טוקן. הקליטה: ‏supabase/functions/csp-report.
--
-- ‏**הגנה מהצפה:** נקודת קליטה ציבורית. לכל היותר 2,000 צירופים שונים ביום;
-- מעבר לזה רק צירופים קיימים נספרים. ‏docs/security-headers.md.
-- ===========================================================================

create table if not exists public.csp_violations (
  day        date not null default current_date,
  directive  text not null,
  blocked    text not null,
  page       text not null,
  hits       integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (day, directive, blocked, page)
);

comment on table public.csp_violations is
  'ספירה יומית של הפרות CSP (Report-Only), לפני מעבר לאכיפה. docs/security-headers.md';

alter table public.csp_violations enable row level security;
revoke all on table public.csp_violations from public, anon, authenticated;
grant select on table public.csp_violations to authenticated;

drop policy if exists "platform admin reads csp violations" on public.csp_violations;
create policy "platform admin reads csp violations"
  on public.csp_violations for select to authenticated
  using (public.current_is_platform_admin());

create or replace function public.csp_report_add(p_directive text, p_blocked text, p_page text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d text := left(coalesce(nullif(p_directive, ''), '?'), 60);
  v_b text := left(coalesce(nullif(p_blocked, ''), '?'), 200);
  v_p text := left(coalesce(nullif(p_page, ''), '?'), 200);
begin
  update public.csp_violations
     set hits = hits + 1, last_seen = now()
   where day = current_date and directive = v_d and blocked = v_b and page = v_p;
  if found then return; end if;

  if (select count(*) from public.csp_violations where day = current_date) >= 2000 then
    return;
  end if;

  insert into public.csp_violations (directive, blocked, page)
  values (v_d, v_b, v_p)
  on conflict (day, directive, blocked, page)
  do update set hits = public.csp_violations.hits + 1, last_seen = now();
end;
$$;

revoke all on function public.csp_report_add(text, text, text) from public, anon, authenticated;
grant execute on function public.csp_report_add(text, text, text) to service_role;
