-- ===========================================================================
-- סיכום לכל עדכון עסקאות תקופתי
-- ===========================================================================
--
-- ## מה חסר
--
-- ‏"עדכן עסקאות" (‏20270329090000, ‏20270330090000) כותב יומן לכל יישוב
-- (‏market_deal_import_runs), אבל אין תמונה של **ההרצה**: כמה יישובים עברו,
-- כמה עסקאות נוספו, מה נכשל ולמה, וכמה עוד ממתינים. מנהל/ת הפלטפורמה ביקש/ה
-- סיכום של כל עדכון תקופתי.
--
-- ## מה נכנס
--
--   ‏1. ‏deal_sync_runs - שורה לכל הרצה, עם items: יישוב → מה קרה בו.
--   ‏2. ‏upsert_deals ו-deal_sync_fail רושמות את עצמן בהרצה הפתוחה
--      (‏deal_sync_log). **הסיכום אינו תלוי בכך שהסוכן זוכר משהו** - הוא
--      נבנה ממה שהוא כבר עושה.
--   ‏3. ‏deal_sync_run_finish() - הסוכן קורא לה בסוף: ההרצה נסגרת, הסיכום
--      חוזר אליו כטקסט, ומנהלי/ות הפלטפורמה מקבלים/ות התראה מסוג
--      deal_sync_summary (פעמון ב-CRM, ווואטסאפ - דלוק כברירת מחדל מ-
--      20270303090000).
--   ‏4. הרצה שהסוכן לא סגר (נתקע, נסגר הדפדפן) נסגרת לבד אחרי שעתיים בלי
--      פעילות - pg_cron כל שעה (‏deal_sync_close_stale), ושולחת את אותו
--      סיכום. כך אין עדכון שעבר בלי סיכום.
--
-- ‏docs/settlement-deals.md, "הסיכום".
--
-- אידמפוטנטית.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ההרצות
-- ---------------------------------------------------------------------------
create table if not exists public.deal_sync_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz,
  finished_by  text,
  towns_ok     int not null default 0,
  towns_failed int not null default 0,
  added        int not null default 0,
  updated      int not null default 0,
  rejected     int not null default 0,
  items        jsonb not null default '{}'::jsonb,
  due_left     int,
  summary      text
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deal_sync_runs_finished_by_check') then
    alter table public.deal_sync_runs
      add constraint deal_sync_runs_finished_by_check check (finished_by in ('agent', 'auto'));
  end if;
end $$;

create index if not exists deal_sync_runs_started_at_idx on public.deal_sync_runs (started_at desc);
create index if not exists deal_sync_runs_open_idx on public.deal_sync_runs (updated_at) where finished_at is null;

comment on table public.deal_sync_runs is
  'הרצה של "עדכן עסקאות": items הוא {יישוב: {ok, added, updated, unchanged, rejected, first, error}}, והסיכום נבנה בסגירה. docs/settlement-deals.md';
comment on column public.deal_sync_runs.finished_by is
  'agent - הסוכן קרא ל-deal_sync_run_finish; auto - נסגרה אחרי שעתיים בלי פעילות (deal_sync_close_stale).';

alter table public.deal_sync_runs enable row level security;

drop policy if exists "deal sync runs admin read" on public.deal_sync_runs;
create policy "deal sync runs admin read" on public.deal_sync_runs
  for select to authenticated
  using (public.current_is_platform_admin());

revoke all on table public.deal_sync_runs from public, anon, authenticated;
grant select on table public.deal_sync_runs to authenticated;
grant all on table public.deal_sync_runs to service_role;

-- ---------------------------------------------------------------------------
-- 2. סוג ההתראה
--
-- מהאילוץ האחרון בפרודקשן (‏20270208090000, נבדק מול pg_constraint), ועוד
-- deal_sync_summary. הסוג דלוק בוואטסאפ מעצמו - notification_known_types()
-- קוראת את האילוץ.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match',
                  'review_new','deal_closed','lead_unrouted','marketing_copy',
                  'agreement_signed','platform_signup','platform_upgrade',
                  'onboarding_property','onboarding_client','onboarding_agreement',
                  'onboarding_lead','exclusivity_taken','deal_data_gap',
                  'listing_match','agenda_reminder','showcase_activity',
                  'deal_sync_summary'));

-- ---------------------------------------------------------------------------
-- 3. סגירת הרצה: הסיכום וההתראה
--
-- ‏items הוא אובייקט ולא מערך, כי יישוב גדול מגיע בכמה מנות של upsert_deals
-- (עד 500 שורות כל אחת), ואותו יישוב צריך שורה אחת בסיכום.
-- ---------------------------------------------------------------------------
create or replace function public.deal_sync_close_run(p_id bigint, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.deal_sync_runs%rowtype;
  v_ok       int;
  v_failed   int;
  v_added    int;
  v_updated  int;
  v_rejected int;
  v_due      int;
  v_first    text;
  v_fails    text;
  v_top      text;
  v_title    text;
  v_body     text;
  v_summary  text;
  v_when     text;
begin
  select * into r from public.deal_sync_runs where id = p_id for update;
  if not found or r.finished_at is not null then
    return null;
  end if;

  select count(*) filter (where (v->>'ok')::boolean),
         count(*) filter (where not (v->>'ok')::boolean),
         coalesce(sum((v->>'added')::int), 0),
         coalesce(sum((v->>'updated')::int), 0),
         coalesce(sum((v->>'rejected')::int), 0)
    into v_ok, v_failed, v_added, v_updated, v_rejected
    from jsonb_each(r.items) e(k, v);

  select string_agg(k || ' (+' || to_char((v->>'added')::int, 'FM999,999') || ')', ', '
                    order by (v->>'added')::int desc)
    into v_first
    from jsonb_each(r.items) e(k, v)
   where (v->>'ok')::boolean and coalesce((v->>'first')::boolean, false);

  select string_agg(k || ' (+' || to_char((v->>'added')::int, 'FM999,999') || ')', ', '
                    order by (v->>'added')::int desc)
    into v_top
    from (select k, v from jsonb_each(r.items) e(k, v)
           where (v->>'ok')::boolean and (v->>'added')::int > 0
             and not coalesce((v->>'first')::boolean, false)
           order by (v->>'added')::int desc limit 5) x;

  select string_agg(k || ' (' || coalesce(v->>'error', 'לא ידוע') || ')', ', ' order by k)
    into v_fails
    from jsonb_each(r.items) e(k, v)
   where not (v->>'ok')::boolean;

  select count(*)::int into v_due
    from public.deal_settlements s
   where s.active
     and (s.last_synced_at is null
          or s.last_synced_at < now() - make_interval(days => s.sync_every_days));

  v_when := to_char(r.started_at at time zone 'Asia/Jerusalem', 'FMDD.FMMM.YYYY, HH24:MI')
         || '-' || to_char(now() at time zone 'Asia/Jerusalem', 'HH24:MI');

  v_title := 'עדכון עסקאות: +' || to_char(v_added, 'FM999,999') || ' עסקאות ב-'
          || v_ok || ' יישובים'
          || case when v_failed > 0 then ', ' || v_failed || ' נכשלו' else '' end;

  -- ‏הגוף בשורה אחת: הוא נכנס לפרמטר של תבנית וואטסאפ, ו-Meta דוחה ‎\n‎
  -- (הסקיל agent-notifications, "התבנית בוואטסאפ").
  v_body := 'נוספו ' || to_char(v_added, 'FM999,999')
         || ', עודכנו ' || to_char(v_updated, 'FM999,999')
         || ', נדחו ' || to_char(v_rejected, 'FM999,999') || '.'
         || coalesce(' עסקאות ראשונות: ' || v_first || '.', '')
         || coalesce(' נכשלו: ' || v_fails || '.', '')
         || case when v_due > 0 then ' ממתינים עוד ' || v_due || ' יישובים - להריץ שוב "עדכן עסקאות".'
                 else ' כל היישובים מעודכנים.' end
         || case when p_by = 'auto' then ' (ההרצה נסגרה אוטומטית - הסוכן לא סיים אותה.)' else '' end;
  v_body := left(v_body, 800);

  v_summary := 'עדכון עסקאות ' || v_when || E'\n'
            || 'יישובים: ' || v_ok || ' עודכנו' || case when v_failed > 0 then ', ' || v_failed || ' נכשלו' else '' end || E'\n'
            || 'עסקאות: ' || to_char(v_added, 'FM999,999') || ' נוספו, '
            || to_char(v_updated, 'FM999,999') || ' עודכנו, '
            || to_char(v_rejected, 'FM999,999') || ' נדחו' || E'\n'
            || coalesce('עסקאות ראשונות: ' || v_first || E'\n', '')
            || coalesce('הכי הרבה חדשות: ' || v_top || E'\n', '')
            || coalesce('נכשלו: ' || v_fails || E'\n', '')
            || case when v_due > 0 then 'ממתינים עוד ' || v_due || ' יישובים - להריץ שוב "עדכן עסקאות".'
                    else 'כל היישובים מעודכנים.' end
            || case when p_by = 'auto' then E'\n(נסגרה אוטומטית אחרי שעתיים בלי פעילות.)' else '' end;

  update public.deal_sync_runs
     set finished_at = now(), finished_by = p_by,
         towns_ok = v_ok, towns_failed = v_failed,
         added = v_added, updated = v_updated, rejected = v_rejected,
         due_left = v_due, summary = v_summary
   where id = p_id;

  -- ‏לכל מנהל/ת פלטפורמה פעיל/ה. בלי related_*: הסיכום מכסה הרבה יישובים,
  -- ואין פריט אחד שהוא היעד (הסקיל agent-notifications, סעיף 1).
  insert into public.notifications (agent_id, type, title, body)
  select m.id, 'deal_sync_summary', v_title, v_body
    from public.agency_members m
   where m.is_platform_admin = true
     and m.active = true;

  return jsonb_build_object(
    'run_id', p_id, 'towns_ok', v_ok, 'towns_failed', v_failed,
    'added', v_added, 'updated', v_updated, 'rejected', v_rejected,
    'due_left', v_due, 'summary', v_summary);
end $$;

comment on function public.deal_sync_close_run(bigint, text) is
  'סוגרת הרצה של "עדכן עסקאות": מסכמת את items, כותבת summary ושולחת התראת deal_sync_summary למנהלי/ות הפלטפורמה. פנימית.';

revoke all on function public.deal_sync_close_run(bigint, text) from public, anon, authenticated;
grant execute on function public.deal_sync_close_run(bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. רישום יישוב בהרצה הפתוחה
--
-- ‏"פתוחה" = לא נסגרה, ופעילה בשעתיים האחרונות. הרצה ישנה שנשארה פתוחה
-- נסגרת כאן (‏auto) לפני שנפתחת חדשה - כך שתי הרצות לא מתערבבות גם אם
-- ה-cron עוד לא הגיע אליה.
-- ---------------------------------------------------------------------------
create or replace function public.deal_sync_log(p_name text, p_item jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   bigint;
  v_old  jsonb;
  v_new  jsonb;
  r      record;
begin
  for r in select id from public.deal_sync_runs
            where finished_at is null and updated_at < now() - interval '2 hours'
  loop
    perform public.deal_sync_close_run(r.id, 'auto');
  end loop;

  select id into v_id from public.deal_sync_runs
   where finished_at is null
   order by updated_at desc limit 1
   for update;
  if v_id is null then
    insert into public.deal_sync_runs default values returning id into v_id;
  end if;

  select items -> p_name into v_old from public.deal_sync_runs where id = v_id;
  -- ‏יישוב בכמה מנות: הספירות מצטברות, המצב (ok/error) של הקריאה האחרונה,
  -- ו-first נשאר אם המנה הראשונה הייתה הראשונה ביישוב.
  v_new := jsonb_build_object(
    'ok',        coalesce((p_item->>'ok')::boolean, false),
    'added',     coalesce((v_old->>'added')::int, 0)     + coalesce((p_item->>'added')::int, 0),
    'updated',   coalesce((v_old->>'updated')::int, 0)   + coalesce((p_item->>'updated')::int, 0),
    'unchanged', coalesce((v_old->>'unchanged')::int, 0) + coalesce((p_item->>'unchanged')::int, 0),
    'rejected',  coalesce((v_old->>'rejected')::int, 0)  + coalesce((p_item->>'rejected')::int, 0),
    'first',     coalesce((v_old->>'first')::boolean, false) or coalesce((p_item->>'first')::boolean, false),
    'error',     case when coalesce((p_item->>'ok')::boolean, false) then null else p_item->>'error' end,
    'at',        now());

  update public.deal_sync_runs
     set items = items || jsonb_build_object(p_name, v_new),
         updated_at = now()
   where id = v_id;
end $$;

comment on function public.deal_sync_log(text, jsonb) is
  'רושמת את התוצאה של יישוב בהרצה הפתוחה של "עדכן עסקאות" (או פותחת אחת). נקראת מ-upsert_deals ו-deal_sync_fail.';

revoke all on function public.deal_sync_log(text, jsonb) from public, anon, authenticated;
grant execute on function public.deal_sync_log(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. מה שהסוכן קורא לו בסוף, ומה ש-cron קורא לו כל שעה
-- ---------------------------------------------------------------------------
create or replace function public.deal_sync_run_finish()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  bigint;
  v_res jsonb;
begin
  if not (public.current_is_platform_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select id into v_id from public.deal_sync_runs
   where finished_at is null order by updated_at desc limit 1;
  if v_id is null then
    -- ‏אין הרצה פתוחה (לא עובד אף יישוב, או שכבר נסגרה): מחזירים את האחרונה,
    -- בלי התראה נוספת.
    select jsonb_build_object('run_id', id, 'already_closed', true, 'summary', summary)
      into v_res
      from public.deal_sync_runs order by started_at desc limit 1;
    return coalesce(v_res, jsonb_build_object('summary', 'לא נרשם עדיין אף עדכון.'));
  end if;
  return public.deal_sync_close_run(v_id, 'agent');
end $$;

comment on function public.deal_sync_run_finish() is
  'הסוכן קורא לה בסוף "עדכן עסקאות": סוגרת את ההרצה, מחזירה את הסיכום ושולחת אותו למנהלי/ות הפלטפורמה. מנהל/ת פלטפורמה או service_role.';

revoke all on function public.deal_sync_run_finish() from public, anon, authenticated;
grant execute on function public.deal_sync_run_finish() to authenticated, service_role;

create or replace function public.deal_sync_close_stale()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in select id from public.deal_sync_runs
            where finished_at is null and updated_at < now() - interval '2 hours'
  loop
    perform public.deal_sync_close_run(r.id, 'auto');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

comment on function public.deal_sync_close_stale() is
  'סוגרת הרצות "עדכן עסקאות" שלא נסגרו ושלא היה בהן דבר שעתיים, ושולחת את הסיכום. pg_cron כל שעה.';

revoke all on function public.deal_sync_close_stale() from public, anon, authenticated;
grant execute on function public.deal_sync_close_stale() to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - deal_sync_close_stale לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('deal-sync-close-stale')
    where exists (select 1 from cron.job where jobname = 'deal-sync-close-stale');
  perform cron.schedule('deal-sync-close-stale', '17 * * * *',
                        'select public.deal_sync_close_stale()');
end $$;

-- ---------------------------------------------------------------------------
-- 6. הכתיבה והדיווח - כמו ב-20270330090000, ועכשיו נרשמות בהרצה
-- ---------------------------------------------------------------------------
create or replace function public.upsert_deals(p_settlement text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- LRM, RLM, LRE..RLO, LRI..PDI
  c_bidi     constant text := chr(8206) || chr(8207) || chr(8234) || chr(8235)
                              || chr(8236) || chr(8237) || chr(8238) || chr(8294)
                              || chr(8295) || chr(8296) || chr(8297);
  v_set      public.deal_settlements%rowtype;
  v_run      uuid;
  v_row      jsonb;
  v_added    int := 0;
  v_updated  int := 0;
  v_same     int := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_reason   text;
  v_addr     text;
  v_street   text;
  v_house    text;
  v_gh       text[];
  v_gush     text;
  v_helka    text;
  v_tat      text;
  v_date_t   text;
  v_sold     date;
  v_price    numeric;
  v_sqm      numeric;
  v_rooms    numeric;
  v_type     text;
  v_floor    text;
  v_hood     text;
  v_key      text;
  v_ins      boolean;
  v_had      boolean;
begin
  if not (public.current_is_platform_admin() or coalesce(auth.role(), '') = 'service_role') then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select * into v_set from public.deal_settlements where name = btrim(coalesce(p_settlement, ''));
  if not found then
    return jsonb_build_object('error', 'unknown_settlement', 'settlement', p_settlement);
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'invalid_payload');
  end if;

  -- ‏"עסקאות ראשונות" בסיכום: היו ליישוב עסקאות לפני ההרצה?
  v_had := exists (select 1 from public.market_deals_official o where o.city = v_set.name);

  insert into public.market_deal_import_runs (city, status, rows_seen)
  values (v_set.name, 'running', jsonb_array_length(p_rows))
  returning id into v_run;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_reason := null;
    v_sold := null; v_price := null; v_sqm := null; v_rooms := null;

    -- ‏ערך ריק, "-" ו"אין מידע" הם null. תווי כיווניות נמחקים קודם.
    v_addr  := nullif(nullif(nullif(btrim(translate(coalesce(v_row->>'address', ''), c_bidi, '')), ''), '-'), 'אין מידע');
    v_hood  := nullif(nullif(btrim(translate(coalesce(v_row->>'neighborhood', ''), c_bidi, '')), ''), '-');
    v_type  := nullif(nullif(btrim(translate(coalesce(v_row->>'property_type', ''), c_bidi, '')), ''), '-');
    v_floor := nullif(nullif(btrim(translate(coalesce(v_row->>'floor', ''), c_bidi, '')), ''), '-');

    v_street := v_addr; v_house := null;
    if v_addr ~ '^.*?\s+[0-9]+[א-ת]?$' then
      v_street := btrim(regexp_replace(v_addr, '\s+[0-9]+[א-ת]?$', ''));
      v_house  := substring(v_addr from '([0-9]+[א-ת]?)$');
    end if;

    v_gush  := btrim(translate(coalesce(v_row->>'gush', ''), c_bidi, ''));
    v_helka := btrim(translate(coalesce(v_row->>'helka', ''), c_bidi, ''));
    v_tat   := btrim(translate(coalesce(v_row->>'tat_helka', ''), c_bidi, ''));
    if v_gush = '' and v_row ? 'gush_helka' then
      v_gh := regexp_match(btrim(translate(v_row->>'gush_helka', c_bidi, '')), '^([0-9]+)-([0-9]+)(?:-([0-9]+))?$');
      if v_gh is not null then
        v_gush := v_gh[1]; v_helka := v_gh[2]; v_tat := coalesce(v_gh[3], '');
      end if;
    end if;

    v_date_t := btrim(translate(coalesce(v_row->>'deal_date', ''), c_bidi, ''));

    begin
      v_sold := case
        when v_date_t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_date_t::date
        when v_date_t ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$' then to_date(v_date_t, 'DD.MM.YYYY')
        else null end;
      v_price := nullif(regexp_replace(translate(coalesce(v_row->>'price', ''), c_bidi, ''), '[,₪\s]', '', 'g'), '')::numeric;
      v_sqm   := nullif(nullif(regexp_replace(translate(coalesce(v_row->>'area_sqm', ''), c_bidi, ''), '[,\s]', '', 'g'), ''), '-')::numeric;
      v_rooms := nullif(nullif(regexp_replace(translate(coalesce(v_row->>'rooms', ''), c_bidi, ''), '\s', '', 'g'), ''), '-')::numeric;
    exception when others then
      v_reason := 'ערך מספרי או תאריך לא תקין';
    end;

    if v_reason is null then
      v_reason := case
        when v_gush !~ '^[0-9]+$' or v_helka !~ '^[0-9]+$' then 'גוש או חלקה לא תקינים'
        when v_tat <> '' and v_tat !~ '^[0-9]+$'           then 'תת-חלקה לא תקינה'
        when v_sold  is null                  then 'חסר תאריך עסקה'
        when v_sold  > current_date           then 'תאריך עסקה בעתיד'
        when v_sold  < date '1990-01-01'      then 'תאריך עסקה מוקדם מדי'
        when v_price is null or v_price <= 0  then 'מחיר לא תקין'
        when v_price < 10000                  then 'מחיר נמוך באופן חשוד'
        when v_price > 500000000              then 'מחיר גבוה באופן חשוד'
        when v_sqm is not null and v_sqm <= 0 then 'שטח לא תקין'
        when v_rooms is not null and (v_rooms < 0 or v_rooms > 50) then 'מספר חדרים לא תקין'
        else null
      end;
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object(
        'row', v_row, 'reason', v_reason);
      continue;
    end if;

    v_key := 'govmap:' || v_gush || '-' || v_helka || '-' || v_tat || ':'
          || to_char(v_sold, 'YYYY-MM-DD') || ':'
          || trim_scale(v_price)::text || ':'
          || coalesce(trim_scale(v_sqm)::text, '');

    v_ins := null;
    insert into public.market_deals_official as t
      (external_key, source, city, neighborhood, street, house_number,
       gush, helka, property_type, rooms, size_sqm, floor, sale_price, sold_at, raw)
    values (
      v_key, 'tax_authority', v_set.name, v_hood, v_street, v_house,
      v_gush, v_helka, v_type, v_rooms, v_sqm, v_floor, v_price, v_sold,
      jsonb_build_object('ingest', 'browser_agent', 'portal', 'govmap',
                         'at', now(), 'tat_helka', nullif(v_tat, '')))
    on conflict (external_key) do update set
      street        = coalesce(excluded.street, t.street),
      house_number  = coalesce(excluded.house_number, t.house_number),
      neighborhood  = coalesce(excluded.neighborhood, t.neighborhood),
      property_type = coalesce(excluded.property_type, t.property_type),
      rooms         = coalesce(excluded.rooms, t.rooms),
      floor         = coalesce(excluded.floor, t.floor)
    where (t.street, t.house_number, t.neighborhood, t.property_type, t.rooms, t.floor)
          is distinct from
          (coalesce(excluded.street, t.street), coalesce(excluded.house_number, t.house_number),
           coalesce(excluded.neighborhood, t.neighborhood), coalesce(excluded.property_type, t.property_type),
           coalesce(excluded.rooms, t.rooms), coalesce(excluded.floor, t.floor))
    returning (t.xmax = 0) into v_ins;

    if v_ins is null then v_same := v_same + 1;
    elsif v_ins then v_added := v_added + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  update public.deal_settlements
     set last_synced_at  = now(),
         last_attempt_at = now(),
         last_status    = case when jsonb_array_length(v_rejected) > 0
                               then 'ok, ' || jsonb_array_length(v_rejected) || ' שורות נדחו'
                               else 'ok' end,
         deals_added    = v_added,
         deals_updated  = v_updated
   where id = v_set.id;

  perform public.deal_sync_log(v_set.name, jsonb_build_object(
    'ok', true, 'added', v_added, 'updated', v_updated, 'unchanged', v_same,
    'rejected', jsonb_array_length(v_rejected),
    'first', (not v_had) and v_added > 0));

  update public.market_deal_import_runs
     set finished_at  = now(),
         status       = 'ok',
         rows_written = v_added + v_updated,
         rows_skipped = v_same + jsonb_array_length(v_rejected),
         error        = case when jsonb_array_length(v_rejected) > 0
                             then jsonb_array_length(v_rejected) || ' rejected (browser_agent)' end
   where id = v_run;

  return jsonb_build_object(
    'added',          v_added,
    'updated',        v_updated,
    'unchanged',      v_same,
    'rejected',       v_rejected,
    'rejected_count', jsonb_array_length(v_rejected));
end $$;

comment on function public.upsert_deals(text, jsonb) is
  'כתיבת עסקאות GovMap של יישוב אחד מסוכן הדפדפן אל market_deals_official. מנרמלת, בונה את external_key של ההדבקה, מעדכנת שדות שהיו ריקים, ומחזירה {added, updated, unchanged, rejected}. מנהל/ת פלטפורמה או service_role. docs/settlement-deals.md';

revoke all on function public.upsert_deals(text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_deals(text, jsonb) to authenticated, service_role;

create or replace function public.deal_sync_fail(p_settlement text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.current_is_platform_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;
  update public.deal_settlements
     set last_attempt_at = now(),
         last_status = 'שגיאה: ' || left(coalesce(nullif(btrim(p_error), ''), 'לא ידוע'), 300)
   where name = btrim(coalesce(p_settlement, ''));
  perform public.deal_sync_log(btrim(coalesce(p_settlement, '')), jsonb_build_object(
    'ok', false, 'error', left(coalesce(nullif(btrim(p_error), ''), 'לא ידוע'), 300)));
  insert into public.market_deal_import_runs (city, status, finished_at, error)
  values (btrim(coalesce(p_settlement, '')), 'failed', now(), left(p_error, 1000));
end $$;

comment on function public.deal_sync_fail(text, text) is
  'הסוכן מדווח על משיכה שנכשלה ביישוב. מנהל/ת פלטפורמה או service_role.';

revoke all on function public.deal_sync_fail(text, text) from public, anon, authenticated;
grant execute on function public.deal_sync_fail(text, text) to authenticated, service_role;
