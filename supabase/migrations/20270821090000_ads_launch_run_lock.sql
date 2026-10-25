-- ===========================================================================
-- מנעול להשקה מושהית: שתי יצירות במקביל לא כותבות אותו אובייקט פעמיים.
--
-- ads_launch_objects נשמרת רק אחרי שמטא החזירה מזהה. שתי בקשות שהתחילו
-- יחד, לפני שהשורה נכתבה, היו שתיהן שולחות POST. המנעול הוא שורה אחת
-- ל-launch_key. מי שמחזיק אותה הוא holder אקראי, והיא משתחררת בסיום.
-- אם ה-worker נקטע בלי שחרור, השורה מתיישנת אחרי 420 שניות (מעל תקרת
-- ה-400 של ה-worker) וההרצה הבאה לוקחת אותה.
--
-- הכתיבה רק מ-ads-admin, דרך שתי פונקציות. אין policy לדפדפן.
-- ===========================================================================

create table if not exists public.ads_launch_runs (
  launch_key text primary key,
  holder     text not null,
  started_at timestamptz not null default now()
);

alter table public.ads_launch_runs enable row level security;

revoke all on table public.ads_launch_runs from anon, authenticated;
grant select, insert, update, delete on table public.ads_launch_runs to service_role;

create or replace function public.ads_launch_try_lock(p_launch_key text, p_holder text, p_stale_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  got boolean;
begin
  if p_launch_key is null or p_holder is null or length(p_holder) < 8 then
    return false;
  end if;
  with upserted as (
    insert into public.ads_launch_runs (launch_key, holder, started_at)
    values (p_launch_key, p_holder, now())
    on conflict (launch_key) do update
      set holder = excluded.holder,
          started_at = excluded.started_at
      where public.ads_launch_runs.started_at < now() - make_interval(secs => p_stale_seconds)
    returning launch_key
  )
  select exists(select 1 from upserted) into got;
  return coalesce(got, false);
end;
$$;

revoke all on function public.ads_launch_try_lock(text, text, integer) from public, anon, authenticated;
grant execute on function public.ads_launch_try_lock(text, text, integer) to service_role;

create or replace function public.ads_launch_unlock(p_launch_key text, p_holder text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ads_launch_runs
  where launch_key = p_launch_key and holder = p_holder;
end;
$$;

revoke all on function public.ads_launch_unlock(text, text) from public, anon, authenticated;
grant execute on function public.ads_launch_unlock(text, text) to service_role;
