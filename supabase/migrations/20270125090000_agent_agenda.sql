-- ============================================================================
-- היומן והמשימות של הסוכן/ת - פגישות, תזכורות והתראות בזמן
--
-- ## מה חסר עד היום
--
-- הפעמון מדווח על אירועים שכבר קרו (ליד, חתימה, ביקורת), ו-`agent-reminders`
-- מדווח על מצב (נכס בלי תמונה). אף אחד מהם לא יודע לענות על השאלה הפשוטה
-- ביותר של מתווך/ת: "מה יש לי היום, ותזכיר לי בזמן". פגישה עם לקוח/ה, סיור
-- בנכס, "לחזור לרונית ביום ראשון ב-10" - כל אלה חיו מחוץ למערכת.
--
-- ## מה כאן
--
--   1. ‏`agent_agenda_items` - פריט אחד ביומן: פגישה, סיור, חתימה, שיחה או
--      משימה. מקושר ללקוח/ה, לנכס ולליד. נכתב מה-CRM (RLS), מהעוזר בוואטסאפ
--      (service_role) ומהמערכת עצמה (משימות אוטומטיות).
--   2. ‏`agent_agenda_alerts` - מתי להתריע על כל פריט. נבנית מחדש בטריגר בכל
--      שינוי של זמן, סטטוס או עדיפות, ולכן פגישה שהוזזה לא תתריע על השעה
--      הישנה.
--   3. ‏`agent_agenda_dispatch()` - ה-cron של כל דקה. הופך התראה שהגיע זמנה
--      לשורה ב-`notifications` מסוג `agenda_reminder`, ומשם הכול קיים: הפעמון,
--      ההשתקה לפי סוג, והמשלוח לוואטסאפ דרך `notification-push`.
--   4. משימות אוטומטיות: ליד חדש, הסכם שנחתם, בלעדיות ותוקף מודעה שנגמרים.
--      **דלוקות כברירת מחדל**, וכל סוג ניתן לכיבוי (`agent_agenda_preferences
--      .auto_off` - רשימת מושתקים, כמו `muted_types`).
--   5. וואטסאפ: `agenda_reminder` דלוק כברירת מחדל ולא ברשימת המאושרים, והוא
--      עוקף את שעות השקט ואת מרווח הקיבוץ. ראו סעיף 9.
--
-- ## למה כאן יש תור, כשב-`agent-reminders` הוחלט במפורש שלא
--
-- שם התזכורת נגזרת ממצב המערכת ומחושבת מחדש בכל קריאה. כאן הסוכן/ת **בחר/ה
-- שעה**, והשעה הזו היא נתון שאין ממה לחשב. לכן טבלה של מועדי התראה, ולא
-- פונקציה.
--
-- ## הגייט
--
-- ‏`agent_agenda_enabled` - אותו מסלול של העוזר האישי (mid/premium), פעיל,
-- בחיוב פעיל. הוא נאכף **בטריגר** על כל הוספה שאינה של המערכת, ולכן חל גם
-- על הדפדפן וגם על הבוט (שרץ ב-service_role ועוקף RLS), ושוב ב-dispatch -
-- מנוי שפג לא מקבל התראות על פריטים שנוצרו כשעוד היה פעיל.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הגייט
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_enabled(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members m
     where m.id = p_agent_id
       and m.active = true
       and m.closed_at is null
       and m.billing_status = 'active'
       and m.tier in ('mid', 'premium')
  );
$$;

comment on function public.agent_agenda_enabled(uuid) is
  'האם לסוכן/ת יש יומן ומשימות: מסלול mid/premium, פעיל, בחיוב פעיל. אותו גייט של העוזר האישי בוואטסאפ.';

revoke all on function public.agent_agenda_enabled(uuid) from public, anon, authenticated;
grant execute on function public.agent_agenda_enabled(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. הטבלאות
-- ---------------------------------------------------------------------------
create table if not exists public.agent_agenda_items (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agency_members(id) on delete cascade,

  kind          text not null default 'task'
                check (kind in ('task','call','meeting','showing','signing')),
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  notes         text check (notes is null or char_length(notes) <= 2000),
  location      text check (location is null or char_length(location) <= 300),

  -- פגישה: שעת ההתחלה. משימה: מועד היעד. ‏null = משימה בלי מועד.
  due_at        timestamptz,
  ends_at       timestamptz,

  priority      text not null default 'normal' check (priority in ('normal','high')),
  status        text not null default 'open' check (status in ('open','done','canceled')),

  -- דקות לפני `due_at` שבהן להתריע. שלילי = אחרי (תזכורת איחור). ‏null =
  -- ברירת המחדל לפי סוג ועדיפות (`agent_agenda_default_offsets`).
  remind_before int[],

  source        text not null default 'crm' check (source in ('crm','whatsapp','system')),
  -- משימה אוטומטית: הסוג (לכיבוי) והמפתח (נגד כפילות).
  auto_kind     text check (auto_kind is null or auto_kind in
                  ('lead_followup','agreement_followup','exclusivity_end','listing_expiry')),
  source_key    text,

  client_id     uuid references public.agent_clients(id) on delete set null,
  property_id   uuid references public.properties(id)    on delete set null,
  -- בלי FK: לידים יושבים בכמה טבלאות.
  lead_id       uuid,

  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint agent_agenda_items_ends_after check (ends_at is null or due_at is null or ends_at >= due_at)
);

comment on table public.agent_agenda_items is
  'היומן והמשימות של הסוכן/ת: פגישות, סיורים, חתימות, שיחות ומשימות. ראו docs/agent-agenda.md.';

create index if not exists agent_agenda_items_agent_due
  on public.agent_agenda_items (agent_id, status, due_at);

create unique index if not exists agent_agenda_items_source_key
  on public.agent_agenda_items (agent_id, source_key)
  where source_key is not null;

create index if not exists agent_agenda_items_client
  on public.agent_agenda_items (client_id) where client_id is not null;

create table if not exists public.agent_agenda_alerts (
  item_id        uuid not null references public.agent_agenda_items(id) on delete cascade,
  offset_minutes int  not null,
  fire_at        timestamptz not null,
  fired_at       timestamptz,
  primary key (item_id, offset_minutes)
);

comment on table public.agent_agenda_alerts is
  'מועדי ההתראה של כל פריט ביומן. נבנית מחדש בטריגר agent_agenda_items_alerts; נקראת ב-agent_agenda_dispatch.';

create index if not exists agent_agenda_alerts_pending
  on public.agent_agenda_alerts (fire_at) where fired_at is null;

create table if not exists public.agent_agenda_preferences (
  agent_id   uuid primary key references public.agency_members(id) on delete cascade,
  -- רשימת מושתקים ולא מאושרים: סוג אוטומטי חדש מגיע לכולם בלי backfill.
  auto_off   text[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.agent_agenda_preferences is
  'העדפות היומן: אילו משימות אוטומטיות כבויות. היעדר שורה = הכול דלוק.';

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- הסוכן/ת מנהל/ת את הפריטים של עצמו/ה בלבד. הגייט אינו כאן אלא בטריגר של
-- סעיף 5, כדי שיחול גם על הבוט.
-- ---------------------------------------------------------------------------
alter table public.agent_agenda_items       enable row level security;
alter table public.agent_agenda_alerts      enable row level security;
alter table public.agent_agenda_preferences enable row level security;

revoke all on public.agent_agenda_items       from anon;
revoke all on public.agent_agenda_alerts      from anon, authenticated;
revoke all on public.agent_agenda_preferences from anon;

drop policy if exists "agent manages own agenda" on public.agent_agenda_items;
create policy "agent manages own agenda"
  on public.agent_agenda_items for all
  to authenticated
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

drop policy if exists "agent reads own agenda preferences" on public.agent_agenda_preferences;
create policy "agent reads own agenda preferences"
  on public.agent_agenda_preferences for select
  to authenticated
  using (agent_id = public.current_agent_id());

drop policy if exists "agent creates own agenda preferences" on public.agent_agenda_preferences;
create policy "agent creates own agenda preferences"
  on public.agent_agenda_preferences for insert
  to authenticated
  with check (agent_id = public.current_agent_id());

drop policy if exists "agent updates own agenda preferences" on public.agent_agenda_preferences;
create policy "agent updates own agenda preferences"
  on public.agent_agenda_preferences for update
  to authenticated
  using (agent_id = public.current_agent_id())
  with check (agent_id = public.current_agent_id());

-- ---------------------------------------------------------------------------
-- 4. עזרים: ברירות המחדל של ההתראה, ושעת עבודה
-- ---------------------------------------------------------------------------

-- פגישה: שעה לפני (ומשימה מיוחדת: גם יום לפני). משימה: בשעת היעד (ומשימה
-- מיוחדת: גם יום לפני, וגם יום אחרי אם עדיין פתוחה).
create or replace function public.agent_agenda_default_offsets(p_kind text, p_priority text)
returns int[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('meeting','showing','signing') then
      case when p_priority = 'high' then array[1440, 60] else array[60] end
    else
      case when p_priority = 'high' then array[1440, 0, -1440] else array[0] end
  end;
$$;

revoke all on function public.agent_agenda_default_offsets(text, text) from public, anon, authenticated;
grant execute on function public.agent_agenda_default_offsets(text, text) to service_role;

-- מועד של משימה אוטומטית אינו אמור ליפול בלילה או בשבת: ליד שנכנס ב-23:40
-- הוא משימה של 09:00 מחר, ולא התראה בחצות.
create or replace function public.agent_agenda_business_time(p_ts timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  l timestamp := p_ts at time zone 'Asia/Jerusalem';
begin
  if extract(hour from l) < 8 then
    l := date_trunc('day', l) + interval '9 hours';
  elsif extract(hour from l) >= 20 then
    l := date_trunc('day', l) + interval '1 day 9 hours';
  end if;
  if extract(dow from l) = 6 then
    l := date_trunc('day', l) + interval '1 day 9 hours';
  end if;
  return l at time zone 'Asia/Jerusalem';
end;
$$;

revoke all on function public.agent_agenda_business_time(timestamptz) from public, anon, authenticated;
grant execute on function public.agent_agenda_business_time(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. הטריגר שלפני: נרמול, גייט ובעלות
--
-- הלקוח/ה והנכס חייבים להיות של אותו/ה סוכן/ת. בלי הבדיקה, מי שמכיר/ה מזהה
-- של לקוח/ה של אחר/ת היה/הייתה מקבל/ת את שמו/ה בגוף ההתראה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_items_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title    := btrim(new.title);
  new.notes    := nullif(btrim(coalesce(new.notes, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');

  if tg_op = 'INSERT' then
    if new.source <> 'system' and not public.agent_agenda_enabled(new.agent_id) then
      raise exception 'tier_required: היומן והמשימות זמינים במסלולים PROFESSIONAL ו-Elite'
        using errcode = 'P0001';
    end if;
  else
    new.agent_id   := old.agent_id;
    new.source     := old.source;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  if new.remind_before is not null then
    new.remind_before := (
      select coalesce(array_agg(distinct o order by o desc), '{}'::int[])
        from unnest(new.remind_before) o
       where o between -10080 and 20160);
    if cardinality(new.remind_before) > 5 then
      new.remind_before := new.remind_before[1:5];
    end if;
  end if;

  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
     and not exists (select 1 from public.agent_clients c
                      where c.id = new.client_id and c.agent_id = new.agent_id) then
    raise exception 'agenda: הלקוח/ה אינו/ה בקובץ שלך' using errcode = 'P0001';
  end if;

  if new.property_id is not null
     and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id)
     and not exists (select 1 from public.properties p
                      where p.id = new.property_id and p.agent_id = new.agent_id) then
    raise exception 'agenda: הנכס אינו שלך' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.agent_agenda_items_before() from public, anon, authenticated;

drop trigger if exists agent_agenda_items_before on public.agent_agenda_items;
create trigger agent_agenda_items_before
  before insert or update on public.agent_agenda_items
  for each row execute function public.agent_agenda_items_before();

-- ---------------------------------------------------------------------------
-- 6. הטריגר שאחרי: בניית מועדי ההתראה
--
-- הזזת מועד מוחקת **את כל** ההתראות, גם אלה שכבר נורו: התראת "שעה לפני"
-- של פגישה שהוזזה ממחר לשבוע הבא צריכה לצאת שוב. כל שינוי אחר מוחק רק את
-- אלה שעוד לא נורו, כדי שעדכון הערה לא יתריע פעמיים.
--
-- התראה שמועדה כבר עבר לא נוצרת: מי שקבע/ה עכשיו פגישה בעוד חצי שעה לא
-- צריך/ה תזכורת "בעוד שעה".
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_items_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.due_at is distinct from old.due_at then
    delete from public.agent_agenda_alerts where item_id = new.id;
  else
    delete from public.agent_agenda_alerts where item_id = new.id and fired_at is null;
  end if;

  if new.status = 'open' and new.due_at is not null then
    insert into public.agent_agenda_alerts (item_id, offset_minutes, fire_at)
    select new.id, o, new.due_at - make_interval(mins => o)
      from unnest(coalesce(new.remind_before,
                           public.agent_agenda_default_offsets(new.kind, new.priority))) o
     where new.due_at - make_interval(mins => o) > now()
    on conflict (item_id, offset_minutes) do nothing;
  end if;

  return null;
end;
$$;

revoke all on function public.agent_agenda_items_alerts() from public, anon, authenticated;

drop trigger if exists agent_agenda_items_alerts on public.agent_agenda_items;
create trigger agent_agenda_items_alerts
  after insert or update of due_at, remind_before, status, kind, priority
  on public.agent_agenda_items
  for each row execute function public.agent_agenda_items_alerts();

-- ---------------------------------------------------------------------------
-- 7. סוג ההתראה, ועמודת הקישור לפריט
--
-- הרשימה המלאה מ-20270115097000 ועוד אחד בסוף.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert','client_match',
                  'review_new','deal_closed','lead_unrouted','marketing_copy',
                  'agreement_signed','platform_signup','platform_upgrade',
                  'onboarding_property','onboarding_client','onboarding_agreement',
                  'onboarding_lead','exclusivity_taken','deal_data_gap',
                  'listing_match','agenda_reminder'));

alter table public.notifications
  add column if not exists related_agenda_item_id uuid
    references public.agent_agenda_items(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 8. ה-dispatch
--
-- כל דקה. ‏`for update skip locked` - שני סבבים חופפים לא יתריעו פעמיים.
-- התראה שאיחרה ביותר משלוש שעות (cron שהיה מושבת) מסומנת ונבלעת: "פגישה
-- בעוד שעה" שמגיעה בערב אחרי הפגישה היא רעש.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_when_text(p_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_ts is null then null else
    'יום ' || (array['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'])
               [extract(dow from p_ts at time zone 'Asia/Jerusalem')::int + 1]
    || ' ' || to_char(p_ts at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI')
  end;
$$;

revoke all on function public.agent_agenda_when_text(timestamptz) from public, anon, authenticated;
grant execute on function public.agent_agenda_when_text(timestamptz) to service_role;

create or replace function public.agent_agenda_alert_title(
  p_kind text, p_title text, p_offset int, p_priority text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select (case when p_priority = 'high' then '❗ ' else '' end)
    || case
         when p_offset < 0 then 'באיחור: '
         when p_offset = 0 and p_kind in ('task','call') then 'הגיע הזמן: '
         else
           (case p_kind
              when 'meeting' then 'פגישה'
              when 'showing' then 'סיור בנכס'
              when 'signing' then 'חתימה'
              when 'call'    then 'שיחה'
              else 'משימה' end)
           || ' ' ||
           (case
              when p_offset = 0    then 'עכשיו'
              when p_offset = 60   then 'בעוד שעה'
              when p_offset = 1440 then 'מחר'
              when p_offset < 60   then 'בעוד ' || p_offset || ' דקות'
              when p_offset % 1440 = 0 then 'בעוד ' || (p_offset / 1440) || ' ימים'
              when p_offset % 60 = 0 then 'בעוד ' || (p_offset / 60) || ' שעות'
              else 'בעוד ' || p_offset || ' דקות' end)
           || ': '
       end
    || p_title;
$$;

revoke all on function public.agent_agenda_alert_title(text, text, int, text) from public, anon, authenticated;
grant execute on function public.agent_agenda_alert_title(text, text, int, text) to service_role;

create or replace function public.agent_agenda_dispatch()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select al.item_id, al.offset_minutes, al.fire_at,
           i.agent_id, i.kind, i.title, i.notes, i.location, i.due_at,
           i.priority, i.status, c.full_name as client_name
      from public.agent_agenda_alerts al
      join public.agent_agenda_items i on i.id = al.item_id
      left join public.agent_clients c on c.id = i.client_id
     where al.fired_at is null
       and al.fire_at <= now()
     order by al.fire_at
     limit 200
     for update of al skip locked
  loop
    update public.agent_agenda_alerts
       set fired_at = now()
     where item_id = r.item_id and offset_minutes = r.offset_minutes;

    continue when r.status <> 'open'
               or r.fire_at < now() - interval '3 hours'
               or not public.agent_agenda_enabled(r.agent_id);

    -- עובר דרך notifications_apply_preferences: סוכן/ת שהשתיק/ה את הסוג
    -- בפעמון לא יקבל/תקבל אותו, וזו בחירה שלו/ה.
    insert into public.notifications (agent_id, type, title, body, related_agenda_item_id)
    values (
      r.agent_id,
      'agenda_reminder',
      left(public.agent_agenda_alert_title(r.kind, r.title, r.offset_minutes, r.priority), 200),
      left(concat_ws(' · ',
             public.agent_agenda_when_text(r.due_at),
             r.location,
             'לקוח/ה: ' || r.client_name,
             left(r.notes, 140)), 400),
      r.item_id);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.agent_agenda_dispatch() is
  'הופכת מועדי התראה שהגיעו לשורות agenda_reminder ב-notifications. מחזירה כמה נוצרו; ה-cron מעיר את notification-push רק כשזה יותר מאפס.';

revoke all on function public.agent_agenda_dispatch() from public, anon, authenticated;
grant execute on function public.agent_agenda_dispatch() to service_role;

-- ---------------------------------------------------------------------------
-- 9. וואטסאפ: דלוק כברירת מחדל, ועוקף שקט ומרווח
--
-- ‏`whatsapp_types` היא רשימת מאושרים, בכוונה: ערוץ יוצא שנדלק בלי בקשה
-- מסכן את דירוג האיכות מול Meta. תזכורת מהיומן היא ההפך - הסוכן/ת ביקש/ה
-- אותה במפורש, לשעה מסוימת. לכן סוג כזה נכנס דרך רשימה הפוכה,
-- ‏`whatsapp_off_types`, ודלוק עד שמכבים אותו.
--
-- ומאותה סיבה הוא עוקף את שעות השקט ואת מרווח הקיבוץ: פגישה ב-07:30
-- מתריעה ב-06:30, ו"תזכיר לי ב-22:00" יוצא ב-22:00. התקרה היומית וגג
-- הכשלים חלים עליו כרגיל.
--
-- החתימה של `notification_push_due_agents` לא השתנתה: `whatsapp_types`
-- שהיא מחזירה הוא עכשיו הרשימה **האפקטיבית** לרגע הזה - בשקט או בתוך
-- המרווח רק הסוגים הדחופים - ולכן `ready` ו-`claim` עובדות בלי שינוי.
-- ---------------------------------------------------------------------------
alter table public.agent_notification_preferences
  add column if not exists whatsapp_off_types text[] not null default '{}';

comment on column public.agent_notification_preferences.whatsapp_off_types is
  'סוגים שדלוקים בוואטסאפ כברירת מחדל (agenda_reminder) וכובו. רשימת מושתקים, הפוכה ל-whatsapp_types.';

create or replace function public.notification_push_due_agents()
returns table (
  agent_id       uuid,
  display_name   text,
  phone_e164     text,
  whatsapp_types text[],
  in_service_window boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_gap_minutes'), 10)      as gap_min,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_per_day'), 12)      as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'notif_push_max_failures_24h'), 3)  as max_fail,
           -- דלוקים כברירת מחדל, ועוקפים שקט ומרווח. ראו סעיף 9 ב-20270125090000.
           array['agenda_reminder']::text[]                            as urgent
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           array(
             select distinct t from unnest(
               coalesce(np.whatsapp_types, '{}'::text[])
               || array(select u from unnest((select urgent from cfg)) u
                         where u <> all (coalesce(np.whatsapp_off_types, '{}'::text[])))
             ) t
           )                                             as whatsapp_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences     rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ),
  recent as (
    select l.agent_id,
           max(l.created_at) as last_at,
           count(*) filter (
             where public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as n24,
           count(*) filter (
             where not public.notification_push_log_holds(l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24
      from public.notification_push_log l
     group by l.agent_id
  ),
  shaped as (
    select a.id, a.display_name, a.phone_e164,
           case
             when public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
               or (r.last_at is not null
                   and r.last_at >= now() - make_interval(mins => cfg.gap_min))
             then array(select t from unnest(a.whatsapp_types) t where t = any(cfg.urgent))
             else a.whatsapp_types
           end as types,
           r.n24, r.fails24, cfg.cap, cfg.max_fail
      from agents a
      cross join cfg
      left join recent r on r.agent_id = a.id
  )
  select s.id, s.display_name, s.phone_e164, s.types,
         coalesce(
           (select c.last_message_at > now() - interval '23 hours'
              from public.whatsapp_conversations c
             where c.agent_id = s.id),
           false)
    from shaped s
   where coalesce(array_length(s.types, 1), 0) > 0
     and s.phone_e164 is not null
     and coalesce(s.n24, 0) < s.cap
     and coalesce(s.fails24, 0) < s.max_fail;
$$;

comment on function public.notification_push_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן עכשיו הודעת וואטסאפ, והסוגים שמותרים ברגע הזה: מסלול mid/premium בחיוב פעיל, מספר, תקרה יומית וגג כשלים. בשעות השקט ובתוך מרווח הקיבוץ - רק הסוגים הדחופים (agenda_reminder).';

revoke all on function public.notification_push_due_agents() from public, anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 10. משימות אוטומטיות
--
-- כל יצירה עוברת דרך `agent_agenda_add_auto`, שבולעת כל שגיאה: משימה
-- אוטומטית היא תוספת, ואסור שכשל בה יפיל את הליד, את החתימה או את הסריקה
-- שהפעילו אותה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_agenda_add_auto(
  p_agent_id    uuid,
  p_auto_kind   text,
  p_source_key  text,
  p_kind        text,
  p_title       text,
  p_notes       text,
  p_due_at      timestamptz,
  p_priority    text default 'normal',
  p_client_id   uuid default null,
  p_property_id uuid default null,
  p_lead_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_agent_id is null or not public.agent_agenda_enabled(p_agent_id) then
    return null;
  end if;
  if exists (select 1 from public.agent_agenda_preferences ap
              where ap.agent_id = p_agent_id and p_auto_kind = any(ap.auto_off)) then
    return null;
  end if;

  insert into public.agent_agenda_items
    (agent_id, kind, title, notes, due_at, priority, source, auto_kind, source_key,
     client_id, property_id, lead_id)
  values
    (p_agent_id, p_kind, left(p_title, 200), left(p_notes, 2000), p_due_at, p_priority,
     'system', p_auto_kind, p_source_key,
     (select c.id from public.agent_clients c where c.id = p_client_id and c.agent_id = p_agent_id),
     (select p.id from public.properties p where p.id = p_property_id and p.agent_id = p_agent_id),
     p_lead_id)
  on conflict (agent_id, source_key) where source_key is not null do nothing
  returning id into v_id;

  return v_id;
exception when others then
  raise warning 'agent_agenda_add_auto(%, %): %', p_agent_id, p_auto_kind, sqlerrm;
  return null;
end;
$$;

revoke all on function public.agent_agenda_add_auto(uuid, text, text, text, text, text, timestamptz, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agent_agenda_add_auto(uuid, text, text, text, text, text, timestamptz, text, uuid, uuid, uuid)
  to service_role;

-- 10א. ליד חדש → "לחזור לליד" בתוך שעה (בשעות עבודה).
--
-- התלייה היא בהתראת `new_lead` ולא בטבלאות הלידים: לידים נכנסים מכמה
-- טבלאות ובכמה מסלולי ניתוב, וההתראה היא המקום האחד שבו כולם כבר
-- מתכנסים לסוכן/ת אחד/ת. המשמעות: מי שהשתיק/ה את `new_lead` בפעמון לא
-- יקבל/תקבל גם את המשימה.
create or replace function public.agent_agenda_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.agent_agenda_add_auto(
    new.agent_id, 'lead_followup',
    'lead:' || coalesce(new.related_lead_id::text, new.id::text),
    'call',
    'לחזור לליד חדש',
    concat_ws(' · ', nullif(btrim(coalesce(new.title, '')), ''), nullif(btrim(coalesce(new.body, '')), '')),
    public.agent_agenda_business_time(now() + interval '1 hour'),
    'high', null, null, new.related_lead_id);
  return null;
end;
$$;

revoke all on function public.agent_agenda_on_new_lead() from public, anon, authenticated;

drop trigger if exists notifications_agenda_new_lead on public.notifications;
create trigger notifications_agenda_new_lead
  after insert on public.notifications
  for each row when (new.type = 'new_lead')
  execute function public.agent_agenda_on_new_lead();

-- 10ב. הסכם שנחתם (כל הצדדים) → "המשך טיפול" מחר בבוקר.
create or replace function public.agent_agenda_on_agreement_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp;
begin
  v_local := date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '1 day 10 hours';
  perform public.agent_agenda_add_auto(
    new.agent_id, 'agreement_followup',
    'agreement:' || new.id::text,
    'task',
    'המשך טיפול אחרי חתימה: ' || coalesce(new.title, 'הסכם'),
    nullif(btrim(coalesce(new.snapshot->>'property_line', '')), ''),
    public.agent_agenda_business_time(v_local at time zone 'Asia/Jerusalem'),
    'normal',
    new.client_ids[1], new.property_ids[1], null);
  return null;
end;
$$;

revoke all on function public.agent_agenda_on_agreement_signed() from public, anon, authenticated;

drop trigger if exists agreements_agenda_signed on public.agreements;
create trigger agreements_agenda_signed
  after update of status on public.agreements
  for each row when (new.status = 'signed' and old.status is distinct from 'signed')
  execute function public.agent_agenda_on_agreement_signed();

-- 10ג. הסריקה השעתית: בלעדיות ותוקף מודעה שנגמרים בתוך 14 יום.
--
-- המפתח כולל את התאריך: הסכם שהוארך מקבל משימה חדשה על התאריך החדש,
-- ואותו תאריך לא מייצר שתיים. מועד המשימה - שבוע לפני הסיום, 10:00, ואם
-- זה כבר עבר אז עכשיו (בשעות עבודה).
create or replace function public.agent_agenda_generate_auto()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select a.id, a.agent_id, a.title, a.exclusive_until,
           a.client_ids[1] as client_id, a.property_ids[1] as property_id,
           nullif(btrim(coalesce(a.snapshot->>'property_line', '')), '') as property_line
      from public.agreements a
     where a.status = 'signed'
       and a.exclusive_until between current_date and current_date + 14
       and public.agent_agenda_enabled(a.agent_id)
  loop
    if public.agent_agenda_add_auto(
         r.agent_id, 'exclusivity_end',
         'excl:' || r.id::text || ':' || r.exclusive_until::text,
         'task',
         'בלעדיות מסתיימת ב-' || to_char(r.exclusive_until, 'DD/MM') || ': ' || coalesce(r.title, 'הסכם'),
         coalesce(r.property_line, 'לחדש את ההתקשרות או לסכם עם הלקוח/ה'),
         public.agent_agenda_business_time(greatest(now(),
           ((r.exclusive_until - 7)::timestamp + interval '10 hours') at time zone 'Asia/Jerusalem')),
         'high', r.client_id, r.property_id, null) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  for r in
    select p.id, p.agent_id, p.title, p.listing_expires_at
      from public.properties p
     where p.status = 'active'
       and p.listing_expires_at between current_date and current_date + 14
       and public.agent_agenda_enabled(p.agent_id)
  loop
    if public.agent_agenda_add_auto(
         r.agent_id, 'listing_expiry',
         'listing:' || r.id::text || ':' || r.listing_expires_at::text,
         'task',
         'תוקף המודעה נגמר ב-' || to_char(r.listing_expires_at, 'DD/MM') || ': ' || coalesce(r.title, 'נכס'),
         'מודעה שפג תוקפה יורדת מהמדפים. לחדש את ההתקשרות עם הבעלים ולעדכן את התאריך.',
         public.agent_agenda_business_time(greatest(now(),
           ((r.listing_expires_at - 7)::timestamp + interval '10 hours') at time zone 'Asia/Jerusalem')),
         'high', null, r.id, null) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

comment on function public.agent_agenda_generate_auto() is
  'יוצרת משימות אוטומטיות על בלעדיות ותוקף מודעה שנגמרים בתוך 14 יום. אידמפוטנטית: המפתח כולל את התאריך.';

revoke all on function public.agent_agenda_generate_auto() from public, anon, authenticated;
grant execute on function public.agent_agenda_generate_auto() to service_role;

-- ---------------------------------------------------------------------------
-- 11. התזמון
--
-- ה-dispatch כל דקה, בתוך המסד בלבד; הוא מעיר את `notification-push` רק
-- כשנוצרה התראה, כדי שתזכורת ל-10:00 לא תחכה לסבב של חמש הדקות.
-- הסריקה פעם בשעה, בדקה 7.
-- ---------------------------------------------------------------------------
do $$
declare
  v_url text := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/notification-push';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - היומן לא תוזמן';
    return;
  end if;

  perform cron.unschedule('agent-agenda-dispatch')
    where exists (select 1 from cron.job where jobname = 'agent-agenda-dispatch');
  perform cron.schedule('agent-agenda-dispatch', '* * * * *', format($cron$
    select net.http_post(
      url := %L,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                 where name = 'alert_cron_secret' limit 1))),
      timeout_milliseconds := 30000
    )
    from (select public.agent_agenda_dispatch() as n) d
    where d.n > 0;
  $cron$, v_url));

  perform cron.unschedule('agent-agenda-auto')
    where exists (select 1 from cron.job where jobname = 'agent-agenda-auto');
  perform cron.schedule('agent-agenda-auto', '7 * * * *',
    'select public.agent_agenda_generate_auto();');
end;
$$;
