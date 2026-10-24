-- ============================================================================
-- גבריאלה לומדת מהחיפושים - מה ביקשו, מה לא מצאו, ומה קרה אחרי התוצאות
-- ============================================================================
--
-- ## מה חסר
--
-- ‏`search_events` סופרת כל חיפוש **באתר**, כולל אלה שחזרו ריקים. החיפושים
-- אצל גבריאלה בוואטסאפ - הערוץ שבו הפונים מתארים במילים שלהם מה הם רוצים -
-- לא נרשמו בשום מקום: "דירת 4 חדרים בגבעת המורה עד מיליון וחצי" שחזרה ריקה
-- נעלמה עם סוף השיחה. ולצד השמות של המקומות (‏area_name_misses, ‏20270718090000)
-- גם **מילים** נזרקו בשקט: "עם גינה", "וילה", מאפיין שהמודל המציא קוד בשבילו.
-- ולא ידענו מה קרה **אחרי** התוצאות - האם מישהו לחץ "דומים", שמר חיפוש, ביקש
-- מתווך/ת, או פשוט ניסה שוב במילים אחרות.
--
-- ## מה נכנס
--
--   ‏1. ‏`bot_search_events` - כל חיפוש של גבריאלה מול הגולשים (לא העוזרת
--      לסוכנים: שם מי שמחפש/ת הוא מתווך/ת במאגר, וזה אינו ביקוש). הקריטריונים
--      כשדות, מספר התוצאות וההתאמות הקרובות, ו-`outcome` שנכתב אחר כך.
--   ‏2. ‏`bot_search_outcome()` - הבוט מסמן את החיפוש האחרון של אותו פונה:
--      ‏similar ← saved ← contact (החזק גובר). "ניסה/תה שוב" אינו נכתב - הוא
--      מחושב בדוח מחיפוש נוסף תוך 15 דקות.
--   ‏3. ‏`search_word_misses` - מילים שלא זוהו: מאפיין (‏"עם גינה" באתר, קוד
--      שאינו קיים מהמודל) או סוג נכס (‏"יורט"). אותן הגנות של area_name_misses.
--   ‏4. ‏`_search_learning_report()` - הדוח: ביקוש שאין לו מלאי, מה קרה אחרי
--      התוצאות אצל גבריאלה, ובאתר - כמה חיפושים הובילו לצפייה בנכס באותו ביקור.
--   ‏5. ‏`_search_word_miss_report()` ו-`search_word_miss_dismiss()` - הדוח
--      והדחייה, לדשבורד של מנהל/ת הפלטפורמה.
--
-- ## למה מילה אינה "מאושרת" כמו כינוי
--
-- כינוי הוא נתון: שורה ב-neighborhood_aliases והאתר והבוטים מזהים אותו. מילה
-- של מאפיין או סוג היא **כלל** - היא נוגעת בטופס הנכס, במסד ובחוזה
-- (‏search_feature_cases.json) - ולכן היא נכנסת בקוד, בליבה (‏assets/search-core.js).
-- הדוח מראה מה מבקשים; ההכרעה היא PR, לא כפתור.
--
-- ## פרטיות
--
-- אין טלפון. ‏`visitor_hash` הוא sha-256 של מספר הוואטסאפ (16 התווים
-- הראשונים), כדי להבדיל "עשרה אנשים" מ"אדם אחד עשר פעמים" ולקשור תוצאה
-- לחיפוש - ונקרא רק דרך הדוח, שפתוח למנהל/ת פלטפורמה בלבד.
--
-- הקובץ אידמפוטנטי. ‏docs/search-core.md, "גבריאלה לומדת מהחיפושים".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. החיפושים של גבריאלה
-- ---------------------------------------------------------------------------
create table if not exists public.bot_search_events (
  id               bigint generated always as identity primary key,
  visitor_hash     text,
  city             text,
  area             text,
  -- false = שם האזור לא זוהה (‏area_not_recognized). null = לא ביקשו אזור
  area_recognized  boolean,
  deal_type        text,
  category         text,
  property_types   text[] not null default '{}',
  features         text[] not null default '{}',
  min_price        numeric,
  max_price        numeric,
  min_rooms        numeric,
  max_rooms        numeric,
  result_count     integer not null default 0,
  close_count      integer not null default 0,
  -- similar / saved / contact - נכתב אחר כך ב-bot_search_outcome()
  outcome          text,
  outcome_at       timestamptz,
  occurred_at      timestamptz not null default now()
);

comment on table public.bot_search_events is
  'חיפושי נכסים של גבריאלה מול גולשים בוואטסאפ: הקריטריונים, התוצאות ומה קרה אחריהן. בלי טלפון (visitor_hash בלבד). כתיבה רק מהשרת, קריאה רק דרך search_learning_report(). docs/search-core.md';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bot_search_events_outcome_check') then
    alter table public.bot_search_events
      add constraint bot_search_events_outcome_check
      check (outcome is null or outcome in ('similar','saved','contact'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bot_search_events_visitor_check') then
    alter table public.bot_search_events
      add constraint bot_search_events_visitor_check
      check (visitor_hash is null or visitor_hash ~ '^[0-9a-f]{16,64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bot_search_events_text_check') then
    alter table public.bot_search_events
      add constraint bot_search_events_text_check
      check (coalesce(char_length(city), 0) <= 60 and coalesce(char_length(area), 0) <= 80
             and coalesce(char_length(deal_type), 0) <= 20 and coalesce(char_length(category), 0) <= 20
             and cardinality(property_types) <= 12 and cardinality(features) <= 12
             and coalesce(area, '') !~ '@' and coalesce(area, '') !~ '[0-9]{9,}');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bot_search_events_counts_check') then
    alter table public.bot_search_events
      add constraint bot_search_events_counts_check
      check (result_count between 0 and 100000 and close_count between 0 and 100000);
  end if;
end $$;

create index if not exists bot_search_events_occurred_idx
  on public.bot_search_events (occurred_at desc);
create index if not exists bot_search_events_visitor_idx
  on public.bot_search_events (visitor_hash, occurred_at desc);

alter table public.bot_search_events enable row level security;
revoke all on table public.bot_search_events from anon, authenticated;
grant all on table public.bot_search_events to service_role;

-- ---------------------------------------------------------------------------
-- 2. מה קרה אחרי התוצאות
--
-- החיפוש האחרון של אותו פונה בשעתיים האחרונות. החזק גובר: מי שלחץ/ה "דומים"
-- ואז ביקש/ה מתווך/ת - contact. מי שביקש/ה מתווך/ת ואז "דומים" - נשאר contact.
-- ---------------------------------------------------------------------------
create or replace function public.bot_search_outcome(p_visitor text, p_outcome text)
returns void
language sql
security definer
set search_path = ''
as $$
  with rank_of as (
    select v.o, v.r from (values ('similar', 1), ('saved', 2), ('contact', 3)) v(o, r)
  ),
  target as (
    select e.id
      from public.bot_search_events e
     where e.visitor_hash = p_visitor
       and e.occurred_at >= now() - interval '2 hours'
     order by e.occurred_at desc
     limit 1
  )
  update public.bot_search_events e
     set outcome = p_outcome, outcome_at = now()
    from target t
   where e.id = t.id
     and p_outcome in (select o from rank_of)
     and coalesce((select r from rank_of where o = e.outcome), 0)
         < (select r from rank_of where o = p_outcome);
$$;

comment on function public.bot_search_outcome(text, text) is
  'גבריאלה מסמנת מה קרה אחרי החיפוש האחרון של פונה (similar / saved / contact). service_role בלבד. docs/search-core.md';

revoke all on function public.bot_search_outcome(text, text) from public, anon, authenticated;
grant execute on function public.bot_search_outcome(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. מילים שלא זוהו
-- ---------------------------------------------------------------------------
create table if not exists public.search_word_misses (
  id            bigint generated always as identity primary key,
  -- 'feature' - מאפיין ("עם גינה"); 'type' - סוג נכס ("יורט")
  kind          text not null,
  phrase        text not null,
  phrase_key    text generated always as (public.neighborhood_name_key(phrase)) stored,
  city          text,
  source        text not null,
  -- ‏sess_... באתר (אותו מזהה של search_events), wa_<hash> בבוט
  visitor       text,
  occurred_at   timestamptz not null default now()
);

comment on table public.search_word_misses is
  'מילים של מאפיין או סוג נכס שהוקלדו ולא זוהו - באתר ובגבריאלה. בלי משתמש/ת ובלי IP. כתיבה ציבורית מהאתר (insert בלבד), קריאה רק דרך search_word_miss_report(). docs/search-core.md';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'search_word_misses_kind_check') then
    alter table public.search_word_misses
      add constraint search_word_misses_kind_check check (kind in ('feature','type'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'search_word_misses_source_check') then
    alter table public.search_word_misses
      add constraint search_word_misses_source_check check (source in ('site','whatsapp'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'search_word_misses_phrase_check') then
    alter table public.search_word_misses
      add constraint search_word_misses_phrase_check
      check (char_length(phrase) between 2 and 40 and phrase !~ '@' and phrase !~ '[0-9]{9,}');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'search_word_misses_city_check') then
    alter table public.search_word_misses
      add constraint search_word_misses_city_check check (city is null or char_length(city) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'search_word_misses_visitor_check') then
    alter table public.search_word_misses
      add constraint search_word_misses_visitor_check
      check (visitor is null or visitor ~ '^(sess_[a-z0-9]{1,48}|wa_[0-9a-f]{16,64})$');
  end if;
end $$;

create index if not exists search_word_misses_occurred_idx
  on public.search_word_misses (occurred_at desc);

alter table public.search_word_misses enable row level security;

-- האתר כותב כ-anon, ורק כ-'site' ועם מזהה אתר. הבוט כותב כ-service_role.
drop policy if exists "site inserts search word misses" on public.search_word_misses;
create policy "site inserts search word misses"
  on public.search_word_misses for insert to anon, authenticated
  with check (source = 'site' and (visitor is null or visitor like 'sess\_%'));

revoke all on table public.search_word_misses from anon, authenticated;
grant insert on table public.search_word_misses to anon, authenticated;
grant all on table public.search_word_misses to service_role;

create table if not exists public.search_word_dismissed (
  kind          text not null,
  phrase_key    text not null,
  dismissed_by  uuid,
  dismissed_at  timestamptz not null default now(),
  primary key (kind, phrase_key)
);

comment on table public.search_word_dismissed is
  'מילים מדוח "מילים שלא זוהו" שמנהל/ת הפלטפורמה דחה/תה או טיפל/ה בהן. נכתב רק דרך search_word_miss_dismiss().';

alter table public.search_word_dismissed enable row level security;
revoke all on table public.search_word_dismissed from anon, authenticated;
grant all on table public.search_word_dismissed to service_role;

-- ---------------------------------------------------------------------------
-- 4. דוח המילים
-- ---------------------------------------------------------------------------
create or replace function public._search_word_miss_report(p_days integer default 30)
returns table (
  kind text, phrase_key text, phrase text, searches bigint, people bigint,
  sources text[], last_seen timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.kind, m.phrase_key,
         mode() within group (order by m.phrase),
         count(*),
         count(distinct coalesce(m.visitor, m.source || ':' || m.id)),
         array_agg(distinct m.source),
         max(m.occurred_at)
    from public.search_word_misses m
   where m.occurred_at >= now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30))))
     and m.phrase_key is not null
     and not exists (select 1 from public.search_word_dismissed d
                      where d.kind = m.kind and d.phrase_key = m.phrase_key)
   group by m.kind, m.phrase_key
   order by 5 desc, 4 desc, 7 desc
   limit 100;
$$;

comment on function public._search_word_miss_report(integer) is
  'הליבה של דוח "מילים שלא זוהו", בלי בדיקת קורא/ת - לסוכן התפעולי ול-search_word_miss_report(). docs/search-core.md';

revoke all on function public._search_word_miss_report(integer) from public, anon, authenticated;
grant execute on function public._search_word_miss_report(integer) to service_role;

create or replace function public.search_word_miss_report(p_days integer default 30)
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
  return coalesce((select jsonb_agg(to_jsonb(r)) from public._search_word_miss_report(p_days) r), '[]'::jsonb);
end;
$$;

comment on function public.search_word_miss_report(integer) is
  'דוח "מילים שלא זוהו" לדשבורד של מנהל/ת הפלטפורמה. docs/search-core.md';

revoke all on function public.search_word_miss_report(integer) from public, anon, authenticated;
grant execute on function public.search_word_miss_report(integer) to authenticated;

create or replace function public.search_word_miss_dismiss(p_kind text, p_phrase_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_is_platform_admin() then
    raise exception 'דחייה פתוחה למנהל/ת פלטפורמה בלבד' using errcode = '42501';
  end if;
  if coalesce(p_kind, '') not in ('feature', 'type') or coalesce(btrim(p_phrase_key), '') = '' then
    raise exception 'חסרה מילה' using errcode = '22023';
  end if;
  insert into public.search_word_dismissed (kind, phrase_key, dismissed_by)
  values (p_kind, p_phrase_key, auth.uid())
  on conflict (kind, phrase_key) do nothing;
end;
$$;

comment on function public.search_word_miss_dismiss(text, text) is
  'מנהל/ת פלטפורמה מסיר/ה מילה מדוח "מילים שלא זוהו" (לא בקשה, טעות הקלדה, או שכבר נוספה לליבה). docs/search-core.md';

revoke all on function public.search_word_miss_dismiss(text, text) from public, anon, authenticated;
grant execute on function public.search_word_miss_dismiss(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. מה לומדים מהחיפושים
--
-- ‏**ביקוש בלי מלאי** - חיפושים של גבריאלה שחזרו בלי אף נכס, מקובצים לפי
-- הבקשה עצמה ונספרים באנשים. ‏**מה קרה אחרי** - outcome, ו"ניסה/תה שוב" לחיפוש
-- שאחריו בא חיפוש נוסף של אותו פונה תוך 15 דקות בלי שום פעולה. ‏**באתר** -
-- חיפוש שאחריו צפייה בנכס באותו ביקור, תוך 30 דקות (‏property_views לפי אותו
-- session_id). זה גבול תחתון: נכס שנפתח בלשונית חדשה מקבל לעיתים מזהה חדש.
-- ---------------------------------------------------------------------------
create or replace function public._search_learning_report(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30)))) as since,
           greatest(1, least(365, coalesce(p_days, 30))) as days
  ),
  bot as (
    select e.*,
           lead(e.occurred_at) over (partition by e.visitor_hash order by e.occurred_at) as next_at
      from public.bot_search_events e, params
     where e.occurred_at >= params.since
  ),
  bot_o as (
    select b.*,
           coalesce(b.outcome,
                    case when b.visitor_hash is not null and b.next_at <= b.occurred_at + interval '15 minutes'
                         then 'refined' end,
                    'none') as result
      from bot b
  ),
  demand as (
    select coalesce(b.city, '') as city, coalesce(b.area, '') as area,
           coalesce(b.deal_type, '') as deal_type, coalesce(b.category, '') as category,
           b.property_types, b.features,
           count(*) as searches,
           count(distinct coalesce(b.visitor_hash, 'row:' || b.id)) as people,
           percentile_cont(0.5) within group (order by b.max_price) as median_max_price,
           min(b.min_rooms) as min_rooms, max(b.max_rooms) as max_rooms,
           count(*) filter (where b.close_count > 0) as with_close,
           bool_or(b.area_recognized is false) as area_unrecognized,
           max(b.occurred_at) as last_seen
      from bot b
     where b.result_count = 0
     group by 1, 2, 3, 4, 5, 6
  ),
  site as (
    select s.id, s.result_count,
           exists (select 1 from public.property_views v
                    where v.visitor_session_id = s.session_id
                      and v.viewed_at >= s.occurred_at
                      and v.viewed_at <= s.occurred_at + interval '30 minutes') as viewed
      from public.search_events s, params
     where s.occurred_at >= params.since and s.submitted and s.session_id is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', (select days from params),
    'bot', jsonb_build_object(
      'searches',        (select count(*) from bot),
      'people',          (select count(distinct visitor_hash) from bot where visitor_hash is not null),
      'zero_results',    (select count(*) from bot where result_count = 0),
      'zero_with_close', (select count(*) from bot where result_count = 0 and close_count > 0),
      'area_unrecognized', (select count(*) from bot where area_recognized is false),
      'outcomes', (select coalesce(jsonb_object_agg(r.result, r.n), '{}'::jsonb)
                     from (select result, count(*) as n from bot_o group by result) r)
    ),
    'zero_demand', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.people desc, d.searches desc, d.last_seen desc), '[]'::jsonb)
        from (select * from demand order by people desc, searches desc, last_seen desc limit 20) d
    ),
    'site', jsonb_build_object(
      'searches',           (select count(*) from site),
      'viewed_after',       (select count(*) from site where viewed),
      'with_results',       (select count(*) from site where result_count > 0),
      'viewed_with_results', (select count(*) from site where viewed and result_count > 0)
    )
  );
$$;

comment on function public._search_learning_report(integer) is
  'מה לומדים מהחיפושים: ביקוש בלי מלאי אצל גבריאלה, מה קרה אחרי התוצאות, וחיפושים באתר שהובילו לצפייה. בלי בדיקת קורא/ת - לעטיפה ולסוכן התפעולי. docs/search-core.md';

revoke all on function public._search_learning_report(integer) from public, anon, authenticated;
grant execute on function public._search_learning_report(integer) to service_role;

create or replace function public.search_learning_report(p_days integer default 30)
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
  return public._search_learning_report(p_days);
end;
$$;

comment on function public.search_learning_report(integer) is
  'הבלוק "מה לומדים מהחיפושים" בדשבורד של מנהל/ת הפלטפורמה. docs/search-core.md';

revoke all on function public.search_learning_report(integer) from public, anon, authenticated;
grant execute on function public.search_learning_report(integer) to authenticated;
