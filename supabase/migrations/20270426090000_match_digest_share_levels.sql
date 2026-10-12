-- =============================================================================
-- סיכום התאמות שלוש פעמים ביום, ושלוש רמות שיתוף לנכסים וללקוחות
--
-- עד היום כל התאמה חדשה בין נכס ללקוח/ה צלצלה מיד: ‏client_match לסוכן/ת של
-- הלקוח/ה, ו-listing_match למפרסם/ת. סוכנים עם קובץ גדול קיבלו עשרות צלצולים
-- ביום על אותו נכס, והפסיקו לקרוא. מעכשיו:
--
--   1. ההתאמות עצמן ממשיכות להיכתב ל-client_match_alerts בזמן אמת - הפאנל
--      "התאמות חכמות", התגית "N לקוחות מתאימים" והבוט לא משתנים. רק
--      ההתראה (notifications) יורדת משתי פונקציות ההתאמה.
--   2. client_match_digest_run() שולחת שלוש פעמים ביום, ב-8:30, ‏12:07 ו-16:07
--      שעון ישראל (pg_cron כל שעה, והפונקציה בודקת את השעה בישראל - כך
--      השעות לא זזות במעבר לשעון חורף), ושולחת לכל סוכן/ת התראה אחת, match_digest, על מה שנכנס
--      מאז הסיכום הקודם: כמה נכסים התאימו לכמה לקוחות, הבולטים, ומי מהסוכנים
--      האחרים מחזיק/ה לקוח/ה שמתאים/ה לנכס שלך. שלוש פעמים ביום ולא פעם
--      בכמה ימים: הסוכנים צריכים להישאר ערניים להתאמות, רק בלי צלצול על כל
--      אחת. סוכן/ת בשעות או ביום שקט - הסיכום מחכה, והחלון נשאר פתוח עד
--      הסבב הראשון שאחרי השקט.
--
-- רמות השיתוף (share_level) - על properties ועל agent_clients:
--
--   private  - פרטי. נכס: רק הלקוחות של הסוכן/ת עצמו/ה מותאמים אליו.
--              לקוח/ה: אף סוכן/ת אחר/ת לא שומע/ת שקיים/ת.
--   office   - שיתוף משרדי, ברירת המחדל לכל מה שקיים ולכל מה שנוצר. נכס:
--              כל לקוחות המשרד. לקוח/ה: מפרסם/ת מהמשרד שהנכס שלו/ה מתאים
--              שומע/ת על כך בסיכום (שם הסוכן/ת והטלפון, לא פרטי הלקוח/ה).
--   network  - שיתוף רשת גלובלי. נכס: מופץ ב-property_shares (שת"פ) לכל
--              המשרדים ברשימת השת"פ. לקוח/ה: גם מפרסמים ממשרדים אחרים שומעים.
--
-- פרטי הלקוח/ה עצמם (שם, טלפון, דרישות) לא נחשפים באף רמה: ה-RLS של
-- agent_clients נשאר agent_id = current_agent_id(). הרמה קובעת רק מי שומע/ת
-- "יש לקוח/ה של X שמתאים/ה לנכס שלך".
--
-- איפה זה נאכף:
--   - נכס פרטי: שורה אחת ב-gate של client_property_match (הסקיל
--     client-matching, סעיף 2) - הפאנל, הספירות, ההתראות, הבוט ומודיעין
--     השוק כולם עוברים שם.
--   - נכס ברשת: share_level = 'network' <=> השת"פ. טריגר על
--     shared_with_partners מיישר את הרמה כשמישהו לוחץ "פתיחה לשת"פ" או
--     "ביטול שת"פ", ו-set_share_level קוראת למנוע השת"פ הקיים.
--   - לקוח/ה: בסיכום בלבד (הצד של המפרסם/ת).
--
-- נכסים שכבר פתוחים לשת"פ מסומנים network ולא office: הורדה שלהם הייתה מבטלת
-- בשקט מאות הפצות קיימות. כל השאר - office.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. העמודות. לפני client_property_match, כי היא מקבלת את השורות כטיפוס.
-- ---------------------------------------------------------------------------
alter table public.properties
  add column if not exists share_level text not null default 'office';
alter table public.agent_clients
  add column if not exists share_level text not null default 'office';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_share_level_check') then
    alter table public.properties
      add constraint properties_share_level_check
      check (share_level in ('private', 'office', 'network'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_clients_share_level_check') then
    alter table public.agent_clients
      add constraint agent_clients_share_level_check
      check (share_level in ('private', 'office', 'network'));
  end if;
end $$;

comment on column public.properties.share_level is
  'רמת השיתוף: private - רק הלקוחות שלי; office - כל המשרד (ברירת מחדל); network - שת"פ עם משרדים אחרים. network מסונכרנת עם shared_with_partners.';
comment on column public.agent_clients.share_level is
  'רמת השיתוף: private - אף סוכן/ת אחר/ת לא שומע/ת על הלקוח/ה; office - מפרסמים מהמשרד שומעים בסיכום ההתאמות (ברירת מחדל); network - גם ממשרדים אחרים. פרטי הלקוח/ה לא נחשפים באף רמה.';

-- נכס שכבר בשת"פ - נשאר בשת"פ. רץ פעם אחת בפועל: אחריה כל שורה כזו כבר network.
update public.properties
   set share_level = 'network'
 where shared_with_partners = true
   and share_level = 'office';

-- ---------------------------------------------------------------------------
-- 2. שת"פ <=> network. הכפתורים הוותיקים ("פתיחה לשת"פ" / "ביטול שת"פ") וכלי
--    הבוט ממשיכים לעבוד כמו שהם, והרמה הולכת אחריהם.
-- ---------------------------------------------------------------------------
create or replace function public.properties_share_level_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.shared_with_partners and not coalesce(old.shared_with_partners, false) then
    new.share_level := 'network';
  elsif coalesce(old.shared_with_partners, false) and not new.shared_with_partners
        and new.share_level = 'network' then
    new.share_level := 'office';
  end if;
  return new;
end;
$$;

drop trigger if exists properties_share_level_sync on public.properties;
create trigger properties_share_level_sync
  before update of shared_with_partners on public.properties
  for each row execute function public.properties_share_level_sync();

-- ---------------------------------------------------------------------------
-- 3. client_property_match - העתק מלא של 20270417090000, ושורה אחת ב-gate:
--    נכס פרטי מותאם רק ללקוחות של הסוכן/ת שלו/ה.
-- ---------------------------------------------------------------------------
create or replace function public.client_property_match(
  p_client         public.agent_clients,
  p_property       public.properties,
  p_waive_features text[]
)
returns table (score int, reasons text[], missing_features text[])
language sql
immutable
set search_path = ''
as $$
  with feats as (
    -- מה שיש בנכס. ממ״ד מסחרי יושב ב-mamad_location ולא במערך
    select coalesce(p_property.features, '{}'::text[])
           || case when p_property.mamad_location = 'unit' then array['mamad'] else '{}'::text[] end
           as have
  ),
  miss as (
    -- מה שהלקוח/ה ביקש/ה ולא קיים בנכס
    select array(select unnest(p_client.required_features)
                 except
                 select unnest(feats.have)) as feats
      from feats
  ),
  gate as (
    select (p_client.client_kind = 'seeker'
        and p_property.status    = 'active'
        -- נכס פרטי: רק הלקוחות של מי שמחזיק/ה בו
        and (p_property.share_level is distinct from 'private'
             or p_property.agent_id = p_client.agent_id)
        and p_property.deal_type = p_client.deal_type
        and p_property.category  = p_client.category
        and (cardinality(p_client.cities) = 0         or p_property.city          = any(p_client.cities))
        and (cardinality(p_client.property_types) = 0 or p_property.property_type = any(p_client.property_types))
        and (p_client.max_price is null or p_property.price <= p_client.max_price * 1.10)
        and (p_client.min_price is null or p_property.price >= p_client.min_price * 0.85)
        and (p_client.min_rooms is null or p_property.rooms is null or p_property.rooms >= p_client.min_rooms)
        and (p_client.max_rooms is null or p_property.rooms is null or p_property.rooms <= p_client.max_rooms)
        and (p_client.max_size_sqm is null or p_property.size_sqm is null or p_property.size_sqm <= p_client.max_size_sqm)
        -- מאפייני חובה: כל מה שחסר חייב להיות ברשימת הוויתור של הקריאה
        and miss.feats <@ coalesce(p_waive_features, '{}'::text[])
           ) as passes
      from miss
  )
  select
    greatest(0, 100
      - case when p_client.max_price is not null and p_property.price > p_client.max_price then 15 else 0 end
      - case when p_client.min_price is not null and p_property.price < p_client.min_price then 5  else 0 end
      - case when p_client.min_size_sqm is not null
              and (p_property.size_sqm is null or p_property.size_sqm < p_client.min_size_sqm) then 10 else 0 end
      - case when p_client.max_size_sqm is not null and p_client.min_size_sqm is null
              and p_property.size_sqm is null then 10 else 0 end
      - case when p_client.max_floor is not null
              and p_property.floor is not null and p_property.floor > p_client.max_floor then 10 else 0 end
      - case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
             then 5 else 0 end
      - least(24, 8 * cardinality(miss.feats))
    )::int,
    array_remove(array[
      case when p_client.max_price is not null and p_property.price > p_client.max_price
           then 'מעל התקציב ב-' || round((p_property.price / p_client.max_price - 1) * 100) || '%' end,
      case when p_client.min_price is not null and p_property.price < p_client.min_price
           then 'מתחת לטווח המחירים שהוגדר' end,
      case when (p_client.min_size_sqm is not null or p_client.max_size_sqm is not null)
            and p_property.size_sqm is null
           then 'גודל הנכס לא מולא במודעה' end,
      case when p_client.min_size_sqm is not null and p_property.size_sqm is not null
            and p_property.size_sqm < p_client.min_size_sqm
           then 'קטן מהמבוקש ב-' || round(p_client.min_size_sqm - p_property.size_sqm) || ' מ״ר' end,
      case when p_client.max_floor is not null and p_property.floor is not null
            and p_property.floor > p_client.max_floor
           then 'קומה ' || p_property.floor || ' - גבוה מהמבוקש' end,
      case when p_property.rooms is null and (p_client.min_rooms is not null or p_client.max_rooms is not null)
           then 'מספר החדרים לא מולא במודעה' end
    ], null),
    miss.feats
  from gate, miss
  where gate.passes;
$$;

comment on function public.client_property_match(public.agent_clients, public.properties, text[]) is
  'ציון ההתאמה בין לקוח/ה לנכס יחיד, עם הסיבות לכל פער. אפס שורות = נפילה בסינון קשיח (כולל מאפיין חובה חסר שאינו ב-p_waive_features, ונכס פרטי של סוכן/ת אחר/ת). p_waive_features רק לקריאה שהסוכן/ת אישר/ה בה ויתור.';

revoke all on function public.client_property_match(public.agent_clients, public.properties, text[]) from public, anon, authenticated;

-- התראות פתוחות על נכס פרטי אצל לקוח/ה של סוכן/ת אחר/ת. אין כאלה ביום
-- המיגרציה (אין עדיין נכס פרטי), אבל set_share_level מנקה באותה צורה.
delete from public.client_match_alerts a
 using public.properties p, public.agent_clients c
 where p.id = a.property_id
   and c.id = a.client_id
   and p.share_level = 'private'
   and p.agent_id is distinct from c.agent_id
   and a.status in ('new', 'seen');

-- ---------------------------------------------------------------------------
-- 4. ההתאמות - כמו 20270320093000, בלי ההתראות. השורות ב-client_match_alerts
--    הן מה שהסיכום קורא.
-- ---------------------------------------------------------------------------
create or replace function public.generate_client_match_alerts(p_property_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop      public.properties%rowtype;
  v_min_score int;
  v_created   int := 0;
begin
  select * into v_prop from public.properties where id = p_property_id;
  if not found or v_prop.status <> 'active' then
    return 0;
  end if;

  v_min_score := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);

  with reach as (
    select m.id as agent_id,
           case when v_prop.agent_id = m.id then 'own' else 'agency' end as source,
           0 as proximity
      from public.agency_members m
     where m.active = true
       and v_prop.agency_id is not null
       and m.agency_id = v_prop.agency_id
    union all
    select m.id, 'shared', 1
      from public.property_shares ps
      join public.agency_members m
        on m.agency_id = ps.shared_with_agency_id
       and m.active = true
     where ps.property_id = v_prop.id
  ),
  audience as (
    select distinct on (agent_id) agent_id, source
      from reach
     order by agent_id, proximity
  ),
  hits as (
    select a.agent_id, c.id as client_id, a.source,
           mt.score, mt.reasons, mt.missing_features
      from audience a
      join public.agent_clients c
        on c.agent_id = a.agent_id
       and c.status = 'active'
      cross join lateral public.client_property_match(c, v_prop) mt
     where mt.score >= v_min_score
  ),
  -- בלי notifications: הסוכנים שומעים על זה ב-client_match_digest_run.
  ins as (
    insert into public.client_match_alerts
      (agent_id, client_id, property_id, source, score, reasons, missing_features)
    select h.agent_id, h.client_id, v_prop.id, h.source, h.score, h.reasons, h.missing_features
      from hits h
    on conflict (client_id, property_id) do nothing
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

create or replace function public.generate_client_match_alerts_for_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client    public.agent_clients%rowtype;
  v_agent     public.agency_members%rowtype;
  v_min_score int;
  v_created   int := 0;
begin
  select * into v_client from public.agent_clients where id = p_client_id;
  if not found or v_client.status <> 'active' then
    return 0;
  end if;

  select * into v_agent from public.agency_members
   where id = v_client.agent_id and active = true;
  if not found or v_agent.agency_id is null then
    return 0;
  end if;

  v_min_score := coalesce(
    (select value::int from public.pricing_config where key = 'client_alert_min_score'), 70);

  with reach as (
    select p.id as pid,
           case when p.agent_id = v_agent.id then 'own' else 'agency' end as source,
           0 as proximity
      from public.properties p
     where p.agency_id = v_agent.agency_id
       and p.status = 'active'
    union all
    select ps.property_id, 'shared', 1
      from public.property_shares ps
     where ps.shared_with_agency_id = v_agent.agency_id
  ),
  pool as (
    select distinct on (pid) pid, source
      from reach
     order by pid, proximity
  ),
  hits as (
    select p.id as property_id, pool.source, mt.score, mt.reasons, mt.missing_features
      from pool
      join public.properties p on p.id = pool.pid
      cross join lateral public.client_property_match(v_client, p) mt
     where mt.score >= v_min_score
  ),
  ins as (
    insert into public.client_match_alerts
      (agent_id, client_id, property_id, source, score, reasons, missing_features)
    select v_agent.id, v_client.id, h.property_id, h.source, h.score, h.reasons, h.missing_features
      from hits h
    on conflict (client_id, property_id) do nothing
    returning 1
  )
  select count(*)::int into v_created from ins;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. סוג ההתראה, ומי שהשתיק/ה את שני הצלצולים הישנים - שקט גם בסיכום
-- ---------------------------------------------------------------------------
do $$ begin perform public.notification_types_add(array['match_digest']); end $$;

update public.agent_notification_preferences
   set muted_types = muted_types || 'match_digest'::text,
       updated_at  = now()
 where 'client_match'  = any(muted_types)
   and 'listing_match' = any(muted_types)
   and not ('match_digest' = any(muted_types));

-- שלוש שעות הסיכום בשעון ישראל, כמספר שעה-ודקה (830 = 8:30). שלוש שורות
-- ולא נוסחה, כי כל אחת נקבעה מסיבה משלה: 8:30 - תחילת יום העבודה;
-- 16:07 ולא 17:00 - בחורף מחשיך ב-16:40, והסוכנים צריכים עוד אור יום
-- לקבוע פגישות. הדקה 7 מרחיקה מהשעה העגולה, שבה רצים הרבה cron-ים.
insert into public.pricing_config (key, value, description)
values ('match_digest_time_1', 830,
        'סיכום ההתאמות (match_digest) הראשון ביום, שעון ישראל, כשעה-ודקה: 830 = 8:30.'),
       ('match_digest_time_2', 1207,
        'סיכום ההתאמות השני ביום, שעון ישראל: 1207 = 12:07.'),
       ('match_digest_time_3', 1607,
        'סיכום ההתאמות השלישי ביום, שעון ישראל: 1607 = 16:07.')
on conflict (key) do nothing;

insert into public.pricing_config (key, value, description)
values ('match_digest_min_hours', 2,
        'מרווח מינימלי בשעות בין שני סיכומי התאמות (match_digest) לאותו/ה סוכן/ת. הסיכום רץ שלוש פעמים ביום; המרווח מונע סיכום כפול מהרצה ידנית או כפולה.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. הסיכום
-- ---------------------------------------------------------------------------
create table if not exists public.agent_match_digest (
  agent_id     uuid primary key references public.agency_members(id) on delete cascade,
  last_sent_at timestamptz not null default now(),
  last_items   int not null default 0
);

comment on table public.agent_match_digest is
  'מתי נשלח לכל סוכן/ת סיכום ההתאמות האחרון. החלון של הסיכום הבא מתחיל כאן. סוכן/ת חדש/ה מקבל/ת שורה בסבב הראשון, והסיכום הראשון בסבב שאחריו.';

alter table public.agent_match_digest enable row level security;
revoke all on table public.agent_match_digest from anon, authenticated;

-- הסיכום הראשון בסבב הבא, על מה שנכנס מעכשיו - לא על כל ההיסטוריה.
insert into public.agent_match_digest (agent_id, last_sent_at)
select m.id, now()
  from public.agency_members m
 where m.active = true
on conflict (agent_id) do nothing;

create or replace function public.client_match_digest_run()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours   int;
  v_il_min  int;
  v_greet   text;
  v_sent    int := 0;
  r         record;
  v_from    timestamptz;
  v_now     timestamptz := now();
  v_props   int;
  v_clients int;
  v_top     text;
  v_lst_n   int;
  v_lst_p   int;
  v_lst_who text;
  v_one_c   uuid;
  v_one_p   uuid;
  v_body    text;
begin
  -- ה-cron רץ כל דקה; שולחים רק בעשר הדקות שמתחילות באחת משעות הסיכום
  -- בשעון ישראל. בתוך החלון, מי שכבר קיבל/ה נעצר/ת ב-match_digest_min_hours
  -- למטה, ולכן ההרצות הבאות באותו חלון לא שולחות שוב.
  v_il_min := extract(hour   from (v_now at time zone 'Asia/Jerusalem'))::int * 60
            + extract(minute from (v_now at time zone 'Asia/Jerusalem'))::int;
  if not exists (
    select 1
      from (values ('match_digest_time_1', 830), ('match_digest_time_2', 1207),
                   ('match_digest_time_3', 1607)) d(key, fallback)
      left join public.pricing_config c on c.key = d.key
      cross join lateral (select coalesce(c.value::int, d.fallback) as hhmm) t
     where v_il_min >= (t.hhmm / 100) * 60 + t.hhmm % 100
       and v_il_min <  (t.hhmm / 100) * 60 + t.hhmm % 100 + 10
  ) then
    return 0;
  end if;

  v_hours := greatest(0, coalesce(
    (select value::int from public.pricing_config where key = 'match_digest_min_hours'), 2));

  -- סוכן/ת חדש/ה: הסיכום הראשון בסבב הבא, ולא על כל מה שהצטבר לפני ההצטרפות
  insert into public.agent_match_digest (agent_id, last_sent_at)
  select m.id, v_now
    from public.agency_members m
   where m.active = true
  on conflict (agent_id) do nothing;

  for r in
    select m.id, m.agency_id, d.last_sent_at,
           -- השם הפרטי לברכה ("בוקר טוב דני")
           nullif(split_part(btrim(coalesce(m.display_name, '')), ' ', 1), '') as first_name
      from public.agency_members m
      join public.agent_match_digest d on d.agent_id = m.id
      left join public.agent_reminder_preferences rp on rp.agent_id = m.id
     where m.active = true
       and d.last_sent_at <= v_now - make_interval(hours => v_hours)
       -- שעות וימים שקטים - אותן ברירות מחדל כמו notification_push_due_agents.
       -- הסיכום מחכה (last_sent_at לא זז), ולכן אחרי סוף השבוע יוצא אחד ולא שישה.
       and not public.agent_reminder_quiet_now(
             coalesce(rp.quiet_from_hour, 21),
             coalesce(rp.quiet_to_hour, 8),
             coalesce(rp.quiet_days, '{5,6}'::smallint[]))
  loop
    v_from := r.last_sent_at;

    -- הצד של הלקוחות שלי: נכסים חדשים שהתאימו
    select count(distinct a.property_id), count(distinct a.client_id),
           case when count(distinct a.client_id) = 1 then (array_agg(a.client_id))[1] end
      into v_props, v_clients, v_one_c
      from public.client_match_alerts a
      join public.agent_clients c on c.id = a.client_id and c.status = 'active'
      join public.properties p    on p.id = a.property_id and p.status = 'active'
     where a.agent_id = r.id
       and a.created_at > v_from
       and a.status <> 'dismissed';

    select string_agg(t.line, ' · ' order by t.score desc)
      into v_top
      from (select c.full_name || ' - "' || p.title || '" ' || a.score || '%' as line, a.score
              from public.client_match_alerts a
              join public.agent_clients c on c.id = a.client_id and c.status = 'active'
              join public.properties p    on p.id = a.property_id and p.status = 'active'
             where a.agent_id = r.id
               and a.created_at > v_from
               and a.status <> 'dismissed'
             order by a.score desc, a.created_at desc
             limit 3) t;

    -- הצד של הנכסים שלי: לקוחות של סוכנים אחרים - רק כשרמת השיתוף של
    -- הלקוח/ה מתירה (office - אותו משרד, network - כולם).
    with lst as (
      select a.property_id, a.agent_id as other_id
        from public.client_match_alerts a
        join public.properties p     on p.id = a.property_id and p.status = 'active'
        join public.agent_clients c  on c.id = a.client_id and c.status = 'active'
        join public.agency_members o on o.id = a.agent_id and o.active = true
       where p.agent_id = r.id
         and a.agent_id <> r.id
         and a.created_at > v_from
         and (c.share_level = 'network'
              or (c.share_level = 'office' and o.agency_id = r.agency_id))
    ),
    who as (
      select l.other_id, count(*) as n
        from lst l
       group by l.other_id
    )
    select (select count(*) from lst),
           (select count(distinct property_id) from lst),
           (select case when count(distinct property_id) = 1 then (array_agg(property_id))[1] end from lst),
           (select string_agg(coalesce(m.display_name, 'סוכן/ת') ||
                              coalesce(' (' || ag.name || ')', '') ||
                              coalesce(', ' || m.phone, ''),
                              ' · ' order by w.n desc)
              from (select * from who order by n desc limit 3) w
              join public.agency_members m on m.id = w.other_id
              left join public.agencies ag on ag.id = m.agency_id)
      into v_lst_n, v_lst_p, v_one_p, v_lst_who;

    if coalesce(v_props, 0) > 0 or coalesce(v_lst_n, 0) > 0 then
      -- ברכה לפי השעה בישראל ולא לפי מספר הסבב, כדי שתישאר נכונה גם כשמשנים
      -- את match_digest_time_*: ‏8:30 בוקר, ‏12:07 צהריים, ‏16:07 אחר הצהריים.
      v_greet := case
                   when v_il_min < 12 * 60 then 'בוקר טוב'
                   when v_il_min < 15 * 60 then 'צהריים טובים'
                   when v_il_min < 18 * 60 then 'אחר צהריים טובים'
                   else 'ערב טוב'
                 end || coalesce(' ' || r.first_name, '') || ', להלן ריכוז ההתאמות';
      -- שורה אחת, בלי ירידות שורה: בתבנית של וואטסאפ Meta דוחה \n בפרמטר
      if v_props > 0 then
        v_body := v_greet || ' ללקוחות שלך: ' ||
                  case when v_props = 1 then 'נכס אחד חדש מתאים' else v_props || ' נכסים חדשים מתאימים' end ||
                  case when v_clients = 1 then ' ללקוח/ה אחד/ת' else ' ל-' || v_clients || ' לקוחות' end ||
                  case when v_props = 1 and v_clients = 1 then '. פרטים: ' else '. הבולטים: ' end ||
                  coalesce(v_top, '') || '.';
      else
        v_body := v_greet || ' לנכסים שלך:';
      end if;
      if v_lst_n > 0 then
        v_body := v_body || ' ' ||
                  case when v_props > 0 then 'ובנכסים שלך: ' else '' end ||
                  case when v_lst_p = 1 then 'נכס אחד שלך מתאים' else v_lst_p || ' מהנכסים שלך מתאימים' end ||
                  ' ללקוחות של סוכנים אחרים: ' || coalesce(v_lst_who, '') ||
                  '. שווה ליצור קשר לשיתוף פעולה.';
      end if;

      -- יעד אחד רק כשיש רק צד אחד ופריט אחד בו (הסקיל agent-notifications)
      insert into public.notifications (agent_id, type, title, body,
                                        related_client_id, related_property_id)
      values (r.id, 'match_digest',
              'ריכוז התאמות ללקוחות' || case when v_now - r.last_sent_at > interval '20 hours'
                                               then ' - מאז הסיכום הקודם' else '' end,
              v_body,
              case when coalesce(v_lst_n, 0) = 0 then v_one_c end,
              case when coalesce(v_props, 0) = 0 then v_one_p end);
      v_sent := v_sent + 1;
    end if;

    insert into public.agent_match_digest (agent_id, last_sent_at, last_items)
    values (r.id, v_now, coalesce(v_props, 0) + coalesce(v_lst_n, 0))
    on conflict (agent_id) do update
      set last_sent_at = excluded.last_sent_at,
          last_items   = excluded.last_items;
  end loop;

  return v_sent;
end;
$$;

comment on function public.client_match_digest_run() is
  'סיכום ההתאמות: ב-8:30, ‏12:07 ו-16:07 שעון ישראל (match_digest_time_1/2/3), לכל סוכן/ת שאינו/ה בשקט - התראת match_digest אחת על מה שנכנס ל-client_match_alerts מאז הסיכום הקודם. במקום client_match / listing_match בזמן אמת. pg_cron כל דקה; מחוץ לעשר הדקות שאחרי כל שעת סיכום מחזירה 0.';

revoke all on function public.client_match_digest_run() from public, anon, authenticated;
grant execute on function public.client_match_digest_run() to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - client_match_digest_run לא תוזמנה';
    return;
  end if;
  perform cron.unschedule('client-match-digest')
    where exists (select 1 from cron.job where jobname = 'client-match-digest');
  -- כל דקה. הפונקציה שולחת רק בשעות שב-match_digest_time_1/2/3 (שעון
  -- ישראל, קיץ וחורף), ובכל דקה אחרת יוצאת בבדיקה אחת. שעות וימים שקטים
  -- נבדקים בה בעצמה. כל דקה ולא שעה קבועה: כך כל שעה-ודקה בהגדרה עובדת.
  perform cron.schedule('client-match-digest', '* * * * *',
                        'select public.client_match_digest_run()');
end $$;

-- ---------------------------------------------------------------------------
-- 7. שינוי רמת השיתוף מהדפדפן (ומהבוט) - נכסים או לקוחות של הסוכן/ת עצמו/ה
-- ---------------------------------------------------------------------------
create or replace function public.set_share_level_for_agent(
  p_agent_id uuid,
  p_kind     text,
  p_ids      uuid[],
  p_level    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_prop    public.properties%rowtype;
  v_res     jsonb;
  v_updated int := 0;
  v_errors  jsonb := '[]'::jsonb;
begin
  if p_level not in ('private', 'office', 'network') then
    return jsonb_build_object('error', 'bad_level');
  end if;
  if p_kind not in ('client', 'property') then
    return jsonb_build_object('error', 'bad_kind');
  end if;
  if not exists (select 1 from public.agency_members where id = p_agent_id and active = true) then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  if p_kind = 'client' then
    update public.agent_clients
       set share_level = p_level
     where id = any(p_ids)
       and agent_id = p_agent_id
       and share_level <> p_level;
    get diagnostics v_updated = row_count;
    return jsonb_build_object('success', true, 'updated', v_updated);
  end if;

  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    select * into v_prop from public.properties
     where id = v_id and agent_id = p_agent_id;
    if not found then
      v_errors := v_errors || jsonb_build_object('id', v_id, 'error', 'not_your_property');
      continue;
    end if;
    if v_prop.share_level = p_level then
      continue;
    end if;

    if p_level = 'network' then
      -- אותו מנוע של "פתיחה לשת"פ"; הטריגר מסעיף 2 מסמן network כשהופץ.
      v_res := public.share_property_for_agent(p_agent_id, v_id);
      if v_res ? 'error' then
        v_errors := v_errors || jsonb_build_object('id', v_id, 'error', v_res->>'error');
        continue;
      end if;
      -- רשימת שת"פ ריקה: הדגל נשאר כבוי, אבל הבחירה של הסוכן/ת נשמרת
      update public.properties set share_level = 'network' where id = v_id;
    else
      if v_prop.shared_with_partners then
        v_res := public.unshare_property_for_agent(p_agent_id, v_id);
        if v_res ? 'error' then
          v_errors := v_errors || jsonb_build_object('id', v_id, 'error', v_res->>'error');
          continue;
        end if;
      end if;
      update public.properties set share_level = p_level where id = v_id;
      if p_level = 'private' then
        delete from public.client_match_alerts a
         using public.agent_clients c
         where a.property_id = v_id
           and c.id = a.client_id
           and c.agent_id is distinct from p_agent_id
           and a.status in ('new', 'seen');
      elsif v_prop.share_level = 'private' then
        -- יצא מפרטי: לקוחות המשרד מקבלים את ההתאמות שנחסמו עד עכשיו
        perform public.generate_client_match_alerts(v_id);
      end if;
    end if;
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('success', true, 'updated', v_updated, 'errors', v_errors);
end;
$$;

comment on function public.set_share_level_for_agent(uuid, text, uuid[], text) is
  'רמת שיתוף (private/office/network) לנכסים או ללקוחות של הסוכן/ת. נכס ל-network עובר דרך share_property_for_agent, וממנה למטה דרך unshare_property_for_agent. service_role בלבד - מהדפדפן דרך set_share_level.';

revoke all on function public.set_share_level_for_agent(uuid, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_share_level_for_agent(uuid, text, uuid[], text) to service_role;

create or replace function public.set_share_level(p_kind text, p_ids uuid[], p_level text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := public.current_agent_id();
begin
  if v_agent is null then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  return public.set_share_level_for_agent(v_agent, p_kind, p_ids, p_level);
end;
$$;

comment on function public.set_share_level(text, uuid[], text) is
  'עטיפה ל-set_share_level_for_agent: הזהות מה-JWT, ולכן רק פריטים של הקורא/ת.';

revoke all on function public.set_share_level(text, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_share_level(text, uuid[], text) to authenticated;
