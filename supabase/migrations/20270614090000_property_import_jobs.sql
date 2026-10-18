-- ============================================================================
-- ייבוא נכסים מקובץ דרך גבריאלה בוואטסאפ, וכינוי "אזור תעשייה ג"
--
-- ## מה נמצא
--
-- קובץ נכסים שסוכן/ת שולח/ת בוואטסאפ נקרא היום כטקסט (‏sheetToText), גבריאלה
-- מסכמת ומפנה לאשף ב-CRM. היא לא יכולה לייבא בעצמה: אחרי "כן" הקובץ כבר אינו
-- בשיחה - ההיסטוריה שומרת ממנו 2,500 תווים (‏HISTORY_MEDIA_CHARS) - ו-114
-- קריאות create_property בתור אחד הן לא דרך לייבא קובץ.
--
-- ## מה נכנס
--
-- 1. ‏`property_import_jobs` - עותק של הקובץ (הכותרות והשורות כטקסט, עד 500)
--    מרגע שהגיע ועד שנקלט. גבריאלה מריצה עליו את ליבת הייבוא המשותפת עם
--    ה-CRM (‏_shared/property-import-core.js) פעמיים: בקבלה - סיכום יבש
--    (כמה חדשים, כמה יעודכנו, כמה ייפסלו ולמה), ואחרי אישור הסוכן/ת - הקליטה
--    עצמה, בכלי import_properties_file. ‏`/crm?goto=accProperties&import=<id>`
--    פותח את אותו קובץ באשף, לתיקון שורות שנפסלו.
--
--    הכתיבה רק מהשרת (‏service_role). הסוכן/ת קורא/ת רק את שלו/ה - לפתיחה
--    באשף.
--
--    **14 יום ונמחק.** זה עותק של מה שנשלח, לא רשומה: הנכסים עצמם כבר
--    ב-properties. ‏cron יומי מוחק עבודות ישנות יותר.
--
-- 2. כינוי (הכרעת מנהל הפלטפורמה, 18.10.2026): "אזור תעשייה ג" ביד2 הוא
--    "אזור התעשייה" בעפולה. עד היום הוא שויך בהתאמה רכה ובאזהרה.
--
-- בטוחה להרצה חוזרת. תיעוד: docs/property-import.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. עבודות ייבוא
-- ---------------------------------------------------------------------------
create table if not exists public.property_import_jobs (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agency_members(id) on delete cascade,
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  source      text not null default 'whatsapp',
  file_name   text,
  headers     jsonb not null,
  rows        jsonb not null,
  summary     jsonb,
  status      text not null default 'pending',
  result      jsonb,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'property_import_jobs_status_check') then
    alter table public.property_import_jobs add constraint property_import_jobs_status_check
      check (status in ('pending', 'running', 'done', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'property_import_jobs_source_check') then
    alter table public.property_import_jobs add constraint property_import_jobs_source_check
      check (source in ('whatsapp', 'email'));
  end if;
end $$;

create index if not exists property_import_jobs_agent_idx
  on public.property_import_jobs (agent_id, created_at desc);

comment on table public.property_import_jobs is
  'קובץ נכסים שסוכן/ת שלח/ה לגבריאלה, מהקבלה עד הקליטה (ליבת הייבוא המשותפת). נמחק אחרי 14 יום.';

alter table public.property_import_jobs enable row level security;
revoke all on table public.property_import_jobs from public, anon, authenticated;
grant select on table public.property_import_jobs to authenticated;
drop policy if exists "agent reads own import jobs" on public.property_import_jobs;
create policy "agent reads own import jobs"
  on public.property_import_jobs for select to authenticated
  using (agent_id = public.current_agent_id());

-- ניקוי: עותק של קובץ, לא רשומה - 14 יום ונמחק
create or replace function public.property_import_jobs_purge()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.property_import_jobs
     where created_at < now() - interval '14 days'
    returning 1
  )
  select count(*)::integer from gone;
$$;

comment on function public.property_import_jobs_purge() is
  'מוחק עבודות ייבוא בנות יותר מ-14 יום. רץ ב-cron יומי.';

revoke all on function public.property_import_jobs_purge() from public, anon, authenticated;
grant execute on function public.property_import_jobs_purge() to service_role;

do $$ begin
  perform cron.unschedule('property-import-jobs-purge')
    where exists (select 1 from cron.job where jobname = 'property-import-jobs-purge');
  perform cron.schedule('property-import-jobs-purge', '41 3 * * *',
                        'select public.property_import_jobs_purge()');
end $$;

-- ---------------------------------------------------------------------------
-- 2. "אזור תעשייה ג" = אזור התעשייה (עפולה)
-- ---------------------------------------------------------------------------
insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
select n.id, v.alias, false, 'שם האזור ביד2 (הכרעת מנהל הפלטפורמה, 18.10.2026)'
  from (values ('אזור תעשייה ג'), ('אזור תעשיה ג'), ('אזור התעשייה ג')) as v(alias)
  join public.cities c on c.name = 'עפולה'
  join public.neighborhoods n on n.city_id = c.id and n.name = 'אזור התעשייה'
on conflict (neighborhood_id, alias_key) do nothing;
