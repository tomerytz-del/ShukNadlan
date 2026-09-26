-- ===========================================================================
-- שמות נרדפים לרחובות - ממאגר רשות האוכלוסין (data.gov.il, bf185c7f-…)
--
-- המאגר המורחב נושא לצד 63 אלף הרחובות הרשמיים 88 אלף שמות נרדפים, כל
-- אחד עם הסמל של הרחוב הרשמי שלו: "הרצל" → "שד הרצל" בקריית ביאליק,
-- "האירוס" → "אירוס" בגן נר, "איינשטיין אריק" → "אריק איינשטיין". בערי
-- השווקים זה כ-5,200 שמות (נמדד על הקובץ מ-20.9.2026).
--
-- **למה זה חשוב ולא קוסמטי:** טופס הנכס אוכף רחוב מרשימה, ו-street_name_key
-- מכסה רק ה"א פותחת/סופית ויו"ד כפולה. "הרצל" שסוכן/ת מקליד/ה בקריית ביאליק
-- אינו "שד הרצל" לפי המפתח - והטופס היה מציע "הוסיפו אותו לרשימה", כלומר
-- רחוב כפול בכתיב שהגיאוקוד לא מכיר. עם הנרדפים הוא מתורגם לשם הרשמי.
--
-- ## מה כאן
--
-- 1. ‏street_registry_aliases - (עיר, שם נרדף) → השם הרשמי ברשימה.
-- 2. ‏street_registry_absorb_gov מקבלת גם את הנרדפים, ומחליפה את אלה של
--    העיר בכל סבב (הם נגזרים מהמאגר; אין בהם החלטה ידנית לשמר).
--
-- ‏**נרדף לעולם אינו דורס רחוב אמיתי**: שם נרדף שהמפתח שלו הוא של רחוב
-- שכבר ברשימה (רשמי או ידני) - לא נכנס. ‏docs/street-registry.md.
-- ===========================================================================

create table if not exists public.street_registry_aliases (
  id         bigint generated always as identity primary key,
  city       text not null,
  alias      text not null,
  alias_key  text generated always as (public.street_name_key(alias)) stored,
  name       text not null,
  source     text not null default 'gov',
  created_at timestamptz not null default now()
);

create unique index if not exists street_registry_aliases_city_key_uniq
  on public.street_registry_aliases (city, alias_key);

comment on table public.street_registry_aliases is
  'שם נרדף לרחוב (מהמאגר של רשות האוכלוסין) → השם הרשמי שב-street_registry. הטופס מתרגם לפיו מה שהוקלד. ראו docs/street-registry.md';

-- קריאה פומבית, כמו street_registry - שם רחוב אינו מידע מוגן, והטופס קורא
-- את שתיהן יחד. כתיבה: service_role בלבד (דרך absorb_gov).
alter table public.street_registry_aliases enable row level security;
drop policy if exists "public read street registry aliases" on public.street_registry_aliases;
create policy "public read street registry aliases"
  on public.street_registry_aliases for select using (true);

-- ---------------------------------------------------------------------------
-- הקליטה - הגרסה מ-20270114093000, ועליה הנרדפים.
--
-- חתימה חדשה, ולכן הישנה נמחקת: create or replace עם פרמטר נוסף היה יוצר
-- פונקציה שנייה (overload), ושתיהן היו נשארות.
-- ---------------------------------------------------------------------------
drop function if exists public.street_registry_absorb_gov(text, text[]);

create or replace function public.street_registry_absorb_gov(
  p_city    text,
  p_names   text[],
  p_aliases jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names       text[];
  v_inserted    integer := 0;
  v_updated     integer := 0;
  v_deactivated integer := 0;
  v_seen        integer := 0;
  v_aliases     integer := 0;
begin
  if exists (select 1 from public.street_registry
              where city = p_city and source = 'gis' and active) then
    insert into public.street_registry_syncs (city, ok, names_seen, source, error)
    values (p_city, true, coalesce(array_length(p_names, 1), 0), 'gov', 'skipped: city has a gis registry');
    return jsonb_build_object('city', p_city, 'skipped', 'gis');
  end if;

  select array_agg(v.n order by v.n) into v_names
    from (
      select distinct on (public.street_name_key(c.n)) c.n
        from (
          select btrim(regexp_replace(x, '\s+', ' ', 'g')) as n
            from unnest(coalesce(p_names, '{}'::text[])) as x
        ) c
       where char_length(c.n) between 2 and 80
         and c.n ~ '[א-תa-zA-Z]'
       order by public.street_name_key(c.n), c.n
    ) v;

  v_seen := coalesce(array_length(v_names, 1), 0);

  if v_seen > 0 then
    with upserted as (
      insert into public.street_registry (city, name, source, last_seen_at)
      select p_city, s, 'gov', now() from unnest(v_names) as s
      on conflict (city, name_key) do update
        set name         = excluded.name,
            source       = 'gov',
            last_seen_at = now()
      returning (xmax = 0) as is_insert
    )
    select count(*) filter (where is_insert),
           count(*) filter (where not is_insert)
      into v_inserted, v_updated
      from upserted;

    update public.street_registry
       set active = false
     where city = p_city
       and source = 'legacy'
       and last_seen_at is null
       and active = true;
    get diagnostics v_deactivated = row_count;

    -- הנרדפים: מוחלפים כולם. נכנס רק נרדף שהשם הרשמי שלו ברשימה, ושהמפתח
    -- שלו **אינו** של רחוב שכבר ברשימה - רחוב אמיתי גובר על נרדף, תמיד.
    delete from public.street_registry_aliases where city = p_city;
    insert into public.street_registry_aliases (city, alias, name)
    select distinct on (public.street_name_key(a.alias)) p_city, a.alias, r.name
      from (
        select btrim(regexp_replace(x->>'alias', '\s+', ' ', 'g')) as alias,
               btrim(regexp_replace(x->>'name',  '\s+', ' ', 'g')) as name
          from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb)) x
      ) a
      join public.street_registry r
        on r.city = p_city and r.name_key = public.street_name_key(a.name)
     where char_length(a.alias) between 2 and 80
       and not exists (select 1 from public.street_registry s
                        where s.city = p_city and s.name_key = public.street_name_key(a.alias))
     order by public.street_name_key(a.alias), a.alias
    on conflict (city, alias_key) do nothing;
    get diagnostics v_aliases = row_count;
  end if;

  insert into public.street_registry_syncs (city, ok, names_seen, inserted, updated, deactivated, source)
  values (p_city, true, v_seen, v_inserted, v_updated, v_deactivated, 'gov');

  return jsonb_build_object(
    'city', p_city, 'names_seen', v_seen, 'inserted', v_inserted,
    'updated', v_updated, 'deactivated', v_deactivated, 'aliases', v_aliases);
end $$;

comment on function public.street_registry_absorb_gov(text, text[], jsonb) is
  'קולטת את רחובות עיר אחת ואת השמות הנרדפים שלהם ממאגר רשות האוכלוסין (source=gov). מדלגת על עיר שיש לה רשימת gis. ל-service_role בלבד.';

revoke all on function public.street_registry_absorb_gov(text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.street_registry_absorb_gov(text, text[], jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- הסבב הבא מוקדם: סבב gov שרץ לפני המיגרציה הזו (הלילה שאחרי 20270114093000)
-- קלט רחובות בלי נרדפים. ‏street_registry_gov_sync_due מחכה ארבעה חודשים
-- מסבב מוצלח - לכן הסבבים הקודמים מסומנים כמיושנים, והסבב של הלילה הבא
-- ירוץ ויביא את הנרדפים. (רק סבבי gov; השעון של עפולה לא נוגע.)
-- ---------------------------------------------------------------------------
update public.street_registry_syncs
   set finished_at = least(finished_at, now() - interval '5 months')
 where source = 'gov' and ok;
