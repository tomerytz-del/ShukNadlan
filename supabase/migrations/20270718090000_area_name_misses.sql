-- ============================================================================
-- "שמות שלא זוהו" - הלולאה שבה האתר והבוטים לומדים את השמות המקומיים
-- ============================================================================
--
-- ## מה חסר
--
-- שם של מקום שאינו שכונה, כינוי או יישוב שאנחנו מכירים נזרק בשקט: באתר
-- החיפוש ממשיך בלעדיו (כך "במרכז", "בסי 1" ו"ברובע" חיפשו את כל האזור עד
-- 21.10.2026), ואצל גבריאלה הוא נגמר ב"לא הבנתי איפה". שתי התוצאות נראות
-- תקינות, ואיש אינו יודע שאנשים מחפשים בשם הזה. הכינויים
-- (‏neighborhood_aliases) נוספו עד היום רק כשמישהו נתקל במקרה.
--
-- ## מה נכנס
--
--   ‏1. ‏`area_name_misses` - כל שם שלא זוהה: באתר (‏SearchCore.areaCandidate,
--      "דירה ביוקה פארק" ← "יוקה פארק") ובבוט (שדה area שלא זוהה ולא נמצא
--      בו דבר). בלי משתמש/ת, בלי IP; אותן הגנות טקסט של search_events.
--   ‏2. ‏`_area_miss_report()` - מקובץ לפי שם ועיר, בלי מה שכבר מזוהה (שם או
--      כינוי בעיר) ובלי מה שנדחה, עם **הצעה**: השכונה שבה השם מופיע הכי
--      הרבה בטקסט של הנכסים הפעילים (‏sales_area, כותרת, רחוב, כתובת).
--   ‏3. ‏`area_alias_approve()` / ‏`area_miss_dismiss()` - מהדשבורד של מנהל/ת
--      הפלטפורמה ב-CRM. אישור כותב שורה ל-neighborhood_aliases עם מי אישר/ה
--      ומתי בהערה, ומאותו רגע האתר, שני הבוטים ושיוך העסקאות מזהים את השם.
--   ‏4. הסוכן התפעולי מדווח כשיש שמות שחיפשו לפחות שני מבקרים
--      (‏area_names_unrecognized).
--
-- ## למה אישור ב-CRM ולא רק מיגרציה
--
-- כינוי הוא הכרעה של מנהל/ת ולא ניחוש - וזה נשאר: שום דבר כאן אינו כותב
-- כינוי מעצמו. מה שמשתנה הוא שההכרעה אינה מחכה ל-PR. ההערה בשורה אומרת
-- מאיפה היא באה, ומיגרציה עדיין מתאימה לכינוי שנקבע מראש.
--
-- ## ובדרך: neighborhood_aliases סגורה לכתיבה גם בהרשאות
--
-- ל-anon ול-authenticated היו insert/update/delete/truncate על הטבלה. RLS
-- (‏policy של select בלבד) חסם את השלושה הראשונים, אבל **RLS אינו חל על
-- truncate** - אותו לקח של pwa_install_events. הכתיבה עוברת רק דרך
-- service_role ופונקציות security definer, ולכן ההרשאות יורדות.
--
-- הקובץ אידמפוטנטי. ‏docs/search-core.md, "הלולאה".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. השמות שלא זוהו
-- ---------------------------------------------------------------------------
create table if not exists public.area_name_misses (
  id            bigint generated always as identity primary key,
  -- מה שהוקלד, אחרי חילוץ: "יוקה פארק" ולא כל המשפט
  phrase        text not null,
  -- אותו מפתח של neighborhood_aliases.alias_key - כך "מזוהה" נבדק מול אותו דבר
  phrase_key    text generated always as (public.neighborhood_name_key(phrase)) stored,
  -- היישוב העיקרי של השוק באתר, או העיר שהבוט חיפש בה
  city          text,
  -- 'site' - שורת החיפוש; 'whatsapp' - הבוטים (service_role)
  source        text not null,
  result_count  integer not null default 0,
  session_id    text,
  occurred_at   timestamptz not null default now()
);

comment on table public.area_name_misses is
  'שמות מקום שהוקלדו ולא זוהו כשכונה, כינוי או יישוב - באתר ובבוטים. בלי משתמש/ת ובלי IP. כתיבה ציבורית מהאתר (insert בלבד), קריאה רק דרך area_miss_report(). docs/search-core.md';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'area_name_misses_source_check') then
    alter table public.area_name_misses
      add constraint area_name_misses_source_check check (source in ('site','whatsapp'));
  end if;
  -- אותן הגנות של search_events: אורך, בלי אימייל, בלי רצף ספרות של טלפון
  if not exists (select 1 from pg_constraint where conname = 'area_name_misses_phrase_check') then
    alter table public.area_name_misses
      add constraint area_name_misses_phrase_check
      check (char_length(phrase) between 2 and 60 and phrase !~ '@' and phrase !~ '[0-9]{9,}');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'area_name_misses_city_check') then
    alter table public.area_name_misses
      add constraint area_name_misses_city_check check (city is null or char_length(city) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'area_name_misses_session_check') then
    alter table public.area_name_misses
      add constraint area_name_misses_session_check
      check (session_id is null or session_id ~ '^sess_[a-z0-9]{1,48}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'area_name_misses_count_check') then
    alter table public.area_name_misses
      add constraint area_name_misses_count_check check (result_count between 0 and 100000);
  end if;
end $$;

create index if not exists area_name_misses_occurred_idx
  on public.area_name_misses (occurred_at desc);

alter table public.area_name_misses enable row level security;

-- האתר כותב כ-anon, ורק כ-'site'. הבוטים כותבים כ-service_role, שעוקף RLS.
drop policy if exists "site inserts area name misses" on public.area_name_misses;
create policy "site inserts area name misses"
  on public.area_name_misses for insert to anon, authenticated
  with check (source = 'site');

revoke all on table public.area_name_misses from anon, authenticated;
grant insert on table public.area_name_misses to anon, authenticated;
grant all on table public.area_name_misses to service_role;

-- ---------------------------------------------------------------------------
-- 2. מה שנדחה ("לא שם של מקום", "רחוב") - לא חוזר לדוח
-- ---------------------------------------------------------------------------
create table if not exists public.area_name_dismissed (
  phrase_key    text not null,
  city          text not null default '',
  dismissed_by  uuid,
  dismissed_at  timestamptz not null default now(),
  primary key (phrase_key, city)
);

comment on table public.area_name_dismissed is
  'שמות מדוח "שמות שלא זוהו" שמנהל/ת הפלטפורמה דחה/תה. נכתב רק דרך area_miss_dismiss().';

alter table public.area_name_dismissed enable row level security;
revoke all on table public.area_name_dismissed from anon, authenticated;
grant all on table public.area_name_dismissed to service_role;

-- ---------------------------------------------------------------------------
-- 3. הדוח
--
-- הליבה בלי בדיקת קורא/ת - לסוכן התפעולי (בעלים) ולעטיפה. "מזוהה" = שם של
-- שכונה או כינוי באותה עיר, באותו מפתח (‏neighborhood_name_key). ההצעה היא
-- הצעה: השכונה שבה השם מופיע הכי הרבה בטקסט של נכסים פעילים בעיר.
-- ---------------------------------------------------------------------------
create or replace function public._area_miss_report(p_days integer default 30)
returns table (
  phrase_key text, phrase text, city text, searches bigint, sessions bigint,
  sources text[], last_seen timestamptz,
  suggestion_id uuid, suggestion_name text, suggestion_hits bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select m.*
      from public.area_name_misses m
     where m.occurred_at >= now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30))))
       and m.phrase_key is not null
  ),
  grouped as (
    select w.phrase_key,
           coalesce(w.city, '') as city,
           mode() within group (order by w.phrase) as phrase,
           count(*) as searches,
           count(distinct coalesce(w.session_id, w.source || ':' || w.id)) as sessions,
           array_agg(distinct w.source) as sources,
           max(w.occurred_at) as last_seen
      from win w
     group by 1, 2
  ),
  open_rows as (
    select g.*
      from grouped g
     where not exists (
             select 1 from public.area_name_dismissed d
              where d.phrase_key = g.phrase_key and d.city = g.city)
       and not exists (
             select 1
               from public.neighborhoods n
               left join public.neighborhood_aliases a on a.neighborhood_id = n.id
              where (g.city = '' or n.city = g.city)
                and (public.neighborhood_name_key(n.name) = g.phrase_key or a.alias_key = g.phrase_key))
  )
  select o.phrase_key, o.phrase, nullif(o.city, ''), o.searches, o.sessions, o.sources, o.last_seen,
         s.neighborhood_id, s.name, s.hits
    from open_rows o
    left join lateral (
      select p.neighborhood_id, n.name, count(*) as hits
        from public.properties p
        join public.neighborhoods n on n.id = p.neighborhood_id
       where p.status = 'active'
         and (o.city = '' or p.city = o.city)
         and strpos(coalesce(public.neighborhood_name_key(
               concat_ws(' ', p.sales_area, p.title, p.street, p.address)), ''), o.phrase_key) > 0
       group by p.neighborhood_id, n.name
       order by count(*) desc
       limit 1
    ) s on true
   order by o.sessions desc, o.searches desc, o.last_seen desc
   limit 100;
$$;

comment on function public._area_miss_report(integer) is
  'הליבה של דוח "שמות שלא זוהו", בלי בדיקת קורא/ת - לסוכן התפעולי ול-area_miss_report(). docs/search-core.md';

revoke all on function public._area_miss_report(integer) from public, anon, authenticated;
grant execute on function public._area_miss_report(integer) to service_role;

create or replace function public.area_miss_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'הדוח פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(r)) from public._area_miss_report(p_days) r), '[]'::jsonb);
end;
$$;

comment on function public.area_miss_report(integer) is
  'דוח "שמות שלא זוהו" לדשבורד של מנהל/ת הפלטפורמה. docs/search-core.md';

revoke all on function public.area_miss_report(integer) from public, anon, authenticated;
grant execute on function public.area_miss_report(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. אישור ודחייה
-- ---------------------------------------------------------------------------
create or replace function public.area_alias_approve(p_phrase text, p_neighborhood_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alias text := btrim(regexp_replace(coalesce(p_phrase, ''), '\s+', ' ', 'g'));
  v_n     integer;
begin
  if not public.current_is_platform_admin() then
    raise exception 'אישור כינוי פתוח למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;
  if char_length(v_alias) < 2 or char_length(v_alias) > 60 then
    raise exception 'כינוי צריך להיות באורך 2 עד 60 תווים' using errcode = '22023';
  end if;
  if not exists (select 1 from public.neighborhoods n where n.id = p_neighborhood_id) then
    raise exception 'השכונה לא נמצאה' using errcode = '22023';
  end if;

  insert into public.neighborhood_aliases (neighborhood_id, alias, shared, note)
  values (p_neighborhood_id, v_alias, false,
          'אושר ב-CRM מתוך "שמות שלא זוהו", '
          || to_char(now() at time zone 'Asia/Jerusalem', 'DD.MM.YYYY')
          || coalesce(', ' || auth.uid()::text, ''))
  on conflict (neighborhood_id, alias_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.area_alias_approve(text, uuid) is
  'מנהל/ת פלטפורמה מאשר/ת שם שלא זוהה ככינוי של שכונה. מאותו רגע האתר, הבוטים ושיוך העסקאות מזהים אותו. docs/search-core.md';

revoke all on function public.area_alias_approve(text, uuid) from public, anon, authenticated;
grant execute on function public.area_alias_approve(text, uuid) to authenticated;

create or replace function public.area_miss_dismiss(p_phrase_key text, p_city text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'דחייה פתוחה למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;
  if coalesce(btrim(p_phrase_key), '') = '' then
    raise exception 'חסר שם' using errcode = '22023';
  end if;
  insert into public.area_name_dismissed (phrase_key, city, dismissed_by)
  values (p_phrase_key, coalesce(p_city, ''), auth.uid())
  on conflict (phrase_key, city) do nothing;
end;
$$;

comment on function public.area_miss_dismiss(text, text) is
  'מנהל/ת פלטפורמה דוחה שם מדוח "שמות שלא זוהו" (לא מקום, רחוב, טעות הקלדה). docs/search-core.md';

revoke all on function public.area_miss_dismiss(text, text) from public, anon, authenticated;
grant execute on function public.area_miss_dismiss(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. neighborhood_aliases - קריאה לכולם, כתיבה רק מהשרת
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on table public.neighborhood_aliases from anon, authenticated;
