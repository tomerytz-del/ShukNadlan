-- תזכורת שבועית על נכסים שלא באוויר.
--
-- הגיל הוא unpublished_at, לא created_at: נכס ישן שירד אתמול לא נספר
-- מיד. מילוי השורות הקיימות מפוזר, כדי שסף 7 הימים לא ייפול על כולן ביום אחד.
-- unpublished_origin מבדיל טיוטה שלא פורסמה מירידה מהמדף. שורות ישנות
-- נשארות בלי מקור, והנוסח לא טוען שהן ירדו.
--
-- שני דגלים נולדים 0. digest מוסיף את הממצא לתזכורת הישנה.
-- nudge כותב התראה אחת לסוכן/ת לפעמון, והדחיפה היא notification-push.
-- שת״פ נרשם תמיד, וההפצה רק כשהדגל דלוק.
--
-- create or replace של findings שומר על ההרשאות הקיימות.
-- אידמפוטנטית.

insert into public.pricing_config (key, value, description) values
  ('agent_reminder_unpublished_days', 7,
   'כמה ימים נכס unpublished בלי המתנה לרישיון נחשב לתזכורת שבועית'),
  ('gabriela_unpublished_nudge_enabled', 0,
   '1 שולח תזכורת שבועית אחת לסוכן/ת דרך הפעמון. 0 סופר ולא כותב.'),
  ('gabriela_unpublished_digest_enabled', 0,
   '1 מוסיף unpublished_listings לתזכורת המייל והוואטסאפ. 0 לא, כדי לא לשלוח פעמיים.'),
  ('gabriela_collab_share_enabled', 0,
   '1 מפיץ שת״פ אחרי שהסוכן/ת ביקש/ה. 0 רק רושם את הבקשה.'),
  ('gabriela_collab_fanout_cap', 5,
   'כמה משרדים לכל היותר מקבלים נכס אחד שנפתח לשת״פ.'),
  ('gabriela_unpublished_nudge_run_cap', 25,
   'כמה סוכנים לכל היותר בסבב אחד של תזכורת הנכסים שלא באוויר.'),
  ('gabriela_unpublished_snooze_days', 30,
   'כמה ימים לא עכשיו שותק על נכס אחד.')
on conflict (key) do nothing;

alter table public.properties
  add column if not exists unpublished_at timestamptz,
  add column if not exists unpublished_origin text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_unpublished_origin_chk'
  ) then
    alter table public.properties
      add constraint properties_unpublished_origin_chk
      check (unpublished_origin is null or unpublished_origin in ('draft', 'taken_down'));
  end if;
end $$;

comment on column public.properties.unpublished_at is
  'מתי הנכס יצא מפרסום, או מתי נוצרה טיוטה. מילוי ראשון מפזר את השעון, לא now() אחיד.';
comment on column public.properties.unpublished_origin is
  'draft = נוצר unpublished. taken_down = היה active וירד. null = שורה ישנה בלי היסטוריה.';

create or replace function public.properties_stamp_unpublished_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      new.unpublished_at := null;
      new.unpublished_origin := null;
    elsif new.status = 'unpublished' then
      new.unpublished_at := coalesce(new.unpublished_at, now());
      if new.unpublished_origin is null then
        new.unpublished_origin := 'draft';
      end if;
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'active' and new.status is distinct from 'active' then
    new.unpublished_at := now();
    if new.status = 'unpublished' then
      new.unpublished_origin := 'taken_down';
    end if;
  elsif new.status = 'active' then
    new.unpublished_at := null;
    new.unpublished_origin := null;
  -- sold/archived שיצאו מ-active כבר חתמו unpublished_at. מעבר אחר כך
  -- ל-unpublished מתחיל את השעון מחדש, אחרת תזכורת יוצאת על יום המכירה.
  elsif new.status = 'unpublished'
        and old.status in ('sold', 'rented', 'archived') then
    new.unpublished_at := now();
    new.unpublished_origin := 'draft';
  elsif new.status = 'unpublished' and new.unpublished_at is null then
    new.unpublished_at := now();
    if new.unpublished_origin is null then
      new.unpublished_origin := 'draft';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists properties_stamp_unpublished_at on public.properties;
create trigger properties_stamp_unpublished_at
  before insert or update of status on public.properties
  for each row execute function public.properties_stamp_unpublished_at();

-- שורות שכבר unpublished. now() אחיד היה מביא את כולן לסף 7 הימים
-- באותו יום, ברגע שהדגל נדלק. updated_at או created_at מהשבועות האחרונים
-- הוא שעון אמיתי ומפוזר. שורה ישנה יותר מקבלת גיל של 0 עד 20 יום לפי
-- hash של המזהה, כך שסף 7 הימים נחצה בימים שונים ולא בגל אחד.
update public.properties p
   set unpublished_at = case
         when p.updated_at is not null
              and p.updated_at <= now()
              and p.updated_at > now() - interval '21 days'
           then p.updated_at
         when p.created_at is not null
              and p.created_at <= now()
              and p.created_at > now() - interval '21 days'
           then p.created_at
         else now() - make_interval(days => abs(hashtext(p.id::text)) % 21)
       end
 where p.status = 'unpublished'
   and p.unpublished_at is null;

create index if not exists properties_unpublished_waiting_idx
  on public.properties (agent_id, unpublished_at)
  where status = 'unpublished';

create table if not exists public.unpublished_reminder_snooze (
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  snooze_until timestamptz,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (agent_id, property_id)
);
alter table public.unpublished_reminder_snooze enable row level security;
revoke all on table public.unpublished_reminder_snooze from public, anon, authenticated;
grant select, insert, update, delete on table public.unpublished_reminder_snooze to service_role;

create table if not exists public.unpublished_nudge_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  property_ids uuid[] not null,
  dry_run boolean not null default false
);
create index if not exists unpublished_nudge_log_agent_idx
  on public.unpublished_nudge_log (agent_id, created_at desc);
alter table public.unpublished_nudge_log enable row level security;
revoke all on table public.unpublished_nudge_log from public, anon, authenticated;
grant select, insert, update, delete on table public.unpublished_nudge_log to service_role;

create table if not exists public.unpublished_collab_opt_in (
  property_id uuid primary key references public.properties(id) on delete cascade,
  agent_id uuid not null references public.agency_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  fanout_at timestamptz,
  fanout_count int not null default 0
);
alter table public.unpublished_collab_opt_in enable row level security;
revoke all on table public.unpublished_collab_opt_in from public, anon, authenticated;
grant select, insert, update, delete on table public.unpublished_collab_opt_in to service_role;

select public.notification_types_add(array['unpublished_nudge', 'collab_offer']);

-- Any future create or replace of agent_reminder_findings must keep
-- SECURITY DEFINER and search_path = ''. 20271031180100 switches this
-- function from invoker to definer: unpublished_reminder_snooze and
-- unpublished_nudge_log are service_role-only (RLS, no policies), so an
-- invoker body returns 42501 for every CRM caller. The target CTE below
-- is the gate (own agent, service_role, or a platform admin). Copying
-- this invoker declaration forward brings the empty reminders list back.

create or replace function public.agent_reminder_findings(p_agent_id uuid)
returns table (
  kind          text,
  title         text,
  body          text,
  action_acc    text,
  subject_count int,
  sort_order    int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    -- סוכן/ת מחובר/ת רואה רק את עצמו/ה. current_agent_id ריק אצל
    -- משתמש/ת מחובר/ת שאינו/ה סוכן/ת מחזיר כלום: אחרת כל מזהה היה
    -- פותח את הספירות של כל הסוכנים. service_role הוא סבב התזכורות.
    -- מנהל/ת פלטפורמה בלי כרטיס סוכן/ת רשאי/ת לבקש מזהה. שאר המקרים
    -- יוצאים ריקים.
    select case
             when public.current_agent_id() = p_agent_id then p_agent_id
             when public.current_agent_id() is null
                  and coalesce(auth.role(), '') = 'service_role' then p_agent_id
             when public.current_agent_id() is null
                  and public.current_is_platform_admin() then p_agent_id
           end as id
  ),
  cfg as (
    select
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_idle_days'), 7)    as idle_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_stale_days'), 60)   as stale_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_expiry_days'), 14)  as expiry_days,
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_unpublished_days'), 7) as unpublished_days
  ),
  -- ספירה אחת על הנכסים הפעילים, ולא ארבע שאילתות נפרדות. אגרגט בלי
  -- ‏group by מחזיר תמיד שורה אחת, גם כשאין אף נכס — ולכן `agg` בטוחה
  -- לשימוש ישיר גם עבור סוכן/ת בלי נכסים בכלל.
  agg as (
    select
      count(*) filter (
        where coalesce(array_length(p.images, 1), 0) = 0
          and nullif(btrim(coalesce(p.marketing_image, '')), '') is null
      )::int as no_images,
      count(*) filter (
        where nullif(btrim(coalesce(p.video_url, '')), '') is null
          and nullif(btrim(coalesce(p.tour_3d_url, '')), '') is null
          and not p.has_virtual_tour
      )::int as no_video,
      count(*) filter (
        where greatest(coalesce(p.bumped_at, p.created_at),
                       coalesce(p.updated_at, p.created_at))
              < now() - make_interval(days => (select stale_days from cfg))
      )::int as stale,
      count(*) filter (
        where p.listing_expires_at is not null
          and p.listing_expires_at >= current_date
          and p.listing_expires_at <= current_date + (select expiry_days from cfg)
      )::int as expiring
      from public.properties p
     where p.agent_id = (select id from target)
       and p.status = 'active'
  ),
  -- לא בתוך agg: שם נספרים רק פעילים. הגיל הוא unpublished_at.
  -- license_hold_at הוא המתנה לרישיון. snooze ו-muted מוציאים נכס
  -- שהסוכן/ת ביקש/ה לא להזכיר עכשיו, או בכלל.
  waiting as (
    select count(*)::int as n,
           count(*) filter (where p.unpublished_origin = 'draft')::int as n_draft,
           count(*) filter (where p.unpublished_origin = 'taken_down')::int as n_down
      from public.properties p
     where p.agent_id = (select id from target)
       and p.status = 'unpublished'
       and p.license_hold_at is null
       and p.unpublished_at is not null
       and p.unpublished_at < now() - make_interval(days => (select unpublished_days from cfg))
       and not exists (
             select 1 from public.unpublished_reminder_snooze s
              where s.agent_id = p.agent_id
                and s.property_id = p.id
                and (s.muted or s.snooze_until > now())
           )
       and (
             p.unpublished_origin is distinct from 'taken_down'
             or not exists (
               select 1 from public.unpublished_nudge_log l
                where l.agent_id = p.agent_id
                  and not l.dry_run
                  and p.id = any(l.property_ids)
                  and l.created_at > now() - interval '30 days'
             )
           )
  ),
  -- מתי נכנס נכס בפעם האחרונה — בכל סטטוס, כי גם נכס שנכנס ונמכר מיד הוא
  -- עבודה שנעשתה, ולא היה נכון להזכיר "שבוע לא הכנסת נכסים" למי שהכניס/ה
  -- ומכר/ה באותו שבוע.
  activity as (
    select
      (select max(p.created_at) from public.properties p
        where p.agent_id = (select id from target))                      as last_property_at,
      (select m.created_at from public.agency_members m
        where m.id = (select id from target))                            as member_since
  ),
  ratio as (select public.video_uplift_ratio() as x)

  -- 5א. נכסים בלי תמונה. הראשון ברשימה כי הוא הכי יקר: מודעה בלי תמונה
  --     כמעט לא נפתחת, ולכן היא גם לא מייצרת ליד וגם תופסת מקום במדף.
  select 'missing_images'::text,
         'נכסים באוויר בלי תמונה'::text,
         case when g.no_images = 1
              then 'נכס פעיל אחד שלך עדיין בלי תמונה.'
              else g.no_images || ' נכסים פעילים שלך עדיין בלי תמונה.'
         end
         || ' מודעה בלי תמונה כמעט לא נפתחת - העלאת תמונה אחת מחזירה אותה למשחק.',
         'accProperties'::text,
         g.no_images,
         1
    from agg g
   where g.no_images > 0

  union all

  -- 5ב. תוקף ההתקשרות. שנייה בדחיפות, וזו התזכורת היחידה שיש לה תאריך קשה
  --     מבחוץ — ולכן גם היחידה שאי אפשר "לפצות עליה אחר כך".
  select 'expiring_listings'::text,
         'תוקף מודעה שעומד להיגמר'::text,
         case when g.expiring = 1
              then 'תוקף ההתקשרות על מודעה אחת שלך נגמר בתוך ' || c.expiry_days || ' ימים.'
              else 'תוקף ההתקשרות על ' || g.expiring || ' מהמודעות שלך נגמר בתוך ' || c.expiry_days || ' ימים.'
         end
         || ' מודעה שפג תוקפה יורדת מהמדפים - כדאי לחדש את ההתקשרות או לעדכן את התאריך.',
         'accProperties'::text,
         g.expiring,
         2
    from agg g cross join cfg c
   where g.expiring > 0

  union all

  -- 5ג. מודעות שלא נגעו בהן. ‏greatest על bumped_at ועל updated_at: גם
  --     הקפצה וגם עדכון תוכן הם נגיעה, ואין טעם להזכיר על נכס שהוקפץ אתמול.
  select 'stale_listings'::text,
         'מודעות שלא עודכנו מזמן'::text,
         case when g.stale = 1
              then 'מודעה אחת שלך לא עודכנה ולא הוקפצה מעל ' || c.stale_days || ' יום.'
              else g.stale || ' מהמודעות שלך לא עודכנו ולא הוקפצו מעל ' || c.stale_days || ' יום.'
         end
         || ' עדכון מחיר, תמונה חדשה או הקפצה מחזירים אותן לראש המדף.',
         'accProperties'::text,
         g.stale,
         3
    from agg g cross join cfg c
   where g.stale > 0

  union all

  -- 5ד. שתיקה. התזכורת היחידה שאינה על נכס מסוים אלא על היעדר פעילות, ולכן
  --     היא נמדדת מול **כל** נכס שנכנס אי פעם ולא רק מול הפעילים.
  --
  --     שני התנאים ולא אחד: גם הנכס האחרון וגם מועד ההצטרפות חייבים להיות
  --     מעבר לסף. בלי השני, חשבון שנפתח היום וקיבל נכסים בייבוא עם תאריך
  --     היסטורי היה מקבל תזכורת על שתיקה ביום הראשון שלו.
  select 'idle_listings'::text,
         'כבר זמן מה לא נכנס נכס חדש'::text,
         case
           when a.last_property_at is null
             then 'עדיין לא הכנסת נכס למערכת. הנכס הראשון הוא מה שמכניס אותך למדפים ולחיפוש באתר.'
           else 'הנכס האחרון שהכנסת נרשם לפני '
                || (extract(day from (now() - a.last_property_at)))::int || ' ימים. '
                || 'מדף הבית והחיפוש מציגים קודם את מה שטרי - מודעה חדשה מחזירה אותך לראש התור.'
         end,
         'accProperties'::text,
         null::int,
         4
    from activity a cross join cfg c
   where a.member_since is not null
     and a.member_since < now() - make_interval(days => c.idle_days)
     and coalesce(a.last_property_at, a.member_since) < now() - make_interval(days => c.idle_days)

  union all

  -- 5ה. סרטון וסיור. **תזכורת-תובנה ולא תזכורת-משימה**, ולכן היא חוזרת
  --     פעם בחודש בלבד (‏agent_reminder_kind_interval).
  --
  --     הנוסח נחתך לפי `video_uplift_ratio()`: יש מדגם — יוצא מספר; אין
  --     מדגם — יוצא משפט איכותני. אין כאן מספר ברירת מחדל שנשמע טוב.
  select 'video_opportunity'::text,
         'נכסים בלי סרטון או סיור'::text,
         'ל-' || g.no_video || ' מהנכסים הפעילים שלך אין סרטון ואין סיור וירטואלי. '
         || case
              when r.x is not null
                then 'בפלטפורמה, נכס עם סרטון או סיור מקבל פי ' || trim(to_char(r.x, 'FM999990.0'))
                     || ' צפיות מנכס בלעדיהם.'
              else 'סרטון מחזיק את הגולש/ת בדף זמן רב יותר, ומודעה עם סרטון מסומנת כך גם במדף וגם בשיתוף.'
            end,
         'accProperties'::text,
         g.no_video,
         5
    from agg g cross join ratio r
   where g.no_video > 0

  union all

  -- 5ו. לא באוויר מעבר לסף. כבוי עד gabriela_unpublished_digest_enabled,
  -- כדי שמיזוג לא יוסיף את זה לתזכורת הוואטסאפ הישנה. הפעמון הוא המסלול.
  select 'unpublished_listings'::text,
         'נכסים שלא באוויר'::text,
         case
           when w.n_draft = w.n and w.n = 1
             then 'טיוטה אחת שלך לא פורסמה כבר יותר מ-' || c.unpublished_days || ' ימים.'
           when w.n_draft = w.n
             then w.n || ' טיוטות שלך לא פורסמו כבר יותר מ-' || c.unpublished_days || ' ימים.'
           when w.n_down = w.n and w.n = 1
             then 'נכס אחד שלך ירד מפרסום לפני יותר מ-' || c.unpublished_days || ' ימים ועדיין לא חזר לאוויר.'
           when w.n_down = w.n
             then w.n || ' נכסים שלך ירדו מפרסום לפני יותר מ-' || c.unpublished_days || ' ימים ועדיין לא חזרו לאוויר.'
           when w.n_draft = 0 and w.n_down = 0
             then w.n || ' נכסים שלך לא באוויר כבר יותר מ-' || c.unpublished_days || ' ימים.'
           else w.n || ' נכסים שלך לא באוויר כבר יותר מ-' || c.unpublished_days
                || ' ימים. חלקם טיוטות שלא פורסמו, וחלקם ירדו מהמדף.'
         end
         || ' פרסום מחזיר אותם למדף ולחיפוש.',
         'accProperties'::text,
         w.n,
         6
    from waiting w cross join cfg c
   where w.n > 0
     and coalesce((select value::int from public.pricing_config
                    where key = 'gabriela_unpublished_digest_enabled'), 0) = 1;
$$;


comment on function public.agent_reminder_findings(uuid) is
  'כל מה שיש להזכיר לסוכן/ת כרגע. unpublished_listings לפי unpublished_at, בלי רישיון ובלי snooze, ורק כש-gabriela_unpublished_digest_enabled=1.';


create or replace function public.agent_reminder_kind_interval(p_kind text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_kind
           when 'missing_images'    then interval '7 days'
           when 'idle_listings'     then interval '7 days'
           when 'stale_listings'    then interval '14 days'
           when 'expiring_listings' then interval '7 days'
           when 'video_opportunity' then interval '30 days'
           when 'unpublished_listings' then interval '7 days'
           -- סוג שטרם נרשם כאן מקבל את הקצב השמרני. עדיף שתזכורת חדשה תצא
           -- פעם בשבועיים מדי מאשר בכל סבב עד שמישהו יבחין.
           else interval '14 days'
         end;
$$;


comment on function public.agent_reminder_kind_interval(text) is
  'המרווח המינימלי בין שתי הופעות של אותו סוג תזכורת אצל אותו/ה סוכן/ת. משימה - שבוע; תובנה - חודש. unpublished_listings - שבוע.';

-- ---------------------------------------------------------------------------
-- לא עכשיו (30 יום) ובלי תזכורת. רק בעל/ת הנכס.
-- service_role מעביר את הסוכן/ת (וואטסאפ). דפדפן משתמש ב-current_agent_id.
-- ---------------------------------------------------------------------------
create or replace function public.unpublished_reminder_snooze(
  p_property_id uuid,
  p_mode text,
  p_agent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid;
  v_days int;
begin
  v_agent := case
               when coalesce(auth.role(), '') = 'service_role' then p_agent_id
               else public.current_agent_id()
             end;
  if v_agent is null then
    return jsonb_build_object('ok', false, 'error', 'not_agent');
  end if;
  if not exists (
    select 1 from public.properties p
     where p.id = p_property_id and p.agent_id = v_agent
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_your_property');
  end if;

  if p_mode = 'clear' then
    delete from public.unpublished_reminder_snooze
     where agent_id = v_agent and property_id = p_property_id;
    return jsonb_build_object('ok', true, 'mode', 'clear');
  end if;

  if p_mode = 'mute' then
    insert into public.unpublished_reminder_snooze (agent_id, property_id, muted, snooze_until, updated_at)
    values (v_agent, p_property_id, true, null, now())
    on conflict (agent_id, property_id) do update
      set muted = true, snooze_until = null, updated_at = now();
    return jsonb_build_object('ok', true, 'mode', 'mute');
  end if;

  if p_mode is distinct from 'snooze' then
    return jsonb_build_object('ok', false, 'error', 'bad_mode');
  end if;

  select coalesce(value::int, 30) into v_days
    from public.pricing_config where key = 'gabriela_unpublished_snooze_days';
  v_days := greatest(coalesce(v_days, 30), 1);

  insert into public.unpublished_reminder_snooze (agent_id, property_id, muted, snooze_until, updated_at)
  values (v_agent, p_property_id, false, now() + make_interval(days => v_days), now())
  on conflict (agent_id, property_id) do update
    set muted = false,
        snooze_until = excluded.snooze_until,
        updated_at = now();
  return jsonb_build_object('ok', true, 'mode', 'snooze', 'days', v_days);
end $$;

revoke all on function public.unpublished_reminder_snooze(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.unpublished_reminder_snooze(uuid, text, uuid) to authenticated, service_role;

create or replace function public.unpublished_reminder_hidden_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.property_id
    from public.unpublished_reminder_snooze s
   where s.agent_id = public.current_agent_id()
     and public.current_agent_id() is not null
     and (s.muted or s.snooze_until > now());
$$;

revoke all on function public.unpublished_reminder_hidden_ids() from public, anon, authenticated;
grant execute on function public.unpublished_reminder_hidden_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- שת״פ: נרשם רק אחרי בקשה. ההפצה מוגבלת, בלי טלפון, ורק כשהדגל דלוק
-- והנכס כבר active (השיתוף באתר ממילא מציג רק מודעה באוויר).
-- ---------------------------------------------------------------------------
create or replace function public.unpublished_collab_fanout(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop public.properties%rowtype;
  v_agent public.agency_members%rowtype;
  v_on int;
  v_cap int;
  v_agency_name text;
  v_n int := 0;
begin
  select coalesce(value::int, 0) into v_on
    from public.pricing_config where key = 'gabriela_collab_share_enabled';
  if coalesce(v_on, 0) <> 1 then
    return jsonb_build_object('ok', true, 'shared', false, 'reason', 'flag_off');
  end if;
  -- מול בקשה מהכרטיס וסבב שמרוקן בקשות שנרשמו כשהדגל היה כבוי.
  perform pg_advisory_xact_lock(281900002);

  select * into v_prop from public.properties where id = p_property_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;
  if v_prop.status is distinct from 'active' then
    return jsonb_build_object('ok', true, 'shared', false, 'reason', 'waiting_for_publish');
  end if;
  if not exists (
    select 1 from public.unpublished_collab_opt_in o
     where o.property_id = p_property_id and o.agent_id = v_prop.agent_id
  ) then
    return jsonb_build_object('ok', true, 'shared', false, 'reason', 'no_opt_in');
  end if;
  if exists (
    select 1 from public.unpublished_collab_opt_in o
     where o.property_id = p_property_id and o.fanout_at is not null
  ) then
    return jsonb_build_object('ok', true, 'shared', false, 'reason', 'already_sent');
  end if;

  select * into v_agent from public.agency_members where id = v_prop.agent_id and active;
  if not found or v_agent.agency_id is null then
    return jsonb_build_object('ok', false, 'error', 'agent_not_found');
  end if;

  select coalesce(value::int, 5) into v_cap
    from public.pricing_config where key = 'gabriela_collab_fanout_cap';
  v_cap := least(greatest(coalesce(v_cap, 5), 1), 20);
  select name into v_agency_name from public.agencies where id = v_agent.agency_id;

  -- לא agent_share_fit: שם משרד בלי שווקים מתאים לכל עיר, והסדר
  -- לפי uuid נתן תמיד לאותם משרדים. כאן חובה שוק של העיר, ואז מי
  -- שקיבל הכי מזמן, ואז הגרלה. בתוך משרד נבחרת סוכן/ת אחת בהגרלה.
  with eligible as (
    select m.id as agent_id,
           m.agency_id,
           coalesce(off.last_offer, '-infinity'::timestamptz) as last_offer
      from public.agency_members m
      join public.agencies g on g.id = m.agency_id
      left join lateral (
        select max(ps.created_at) as last_offer
          from public.property_shares ps
         where ps.shared_with_agency_id = m.agency_id
      ) off on true
     where m.agency_id is distinct from v_agent.agency_id
       and m.active
       and m.license_status in ('verified', 'manual')
       and v_prop.city_id is not null
       and exists (
             select 1
               from public.cities c
              where c.id = v_prop.city_id
                and c.market_slug is not null
                and c.market_slug = any (
                  coalesce(m.service_markets, '{}'::text[])
                  || coalesce(g.service_markets, '{}'::text[])
                )
           )
       and (
             coalesce(m.property_scope, g.property_scope, 'all') = 'all'
             or (
               coalesce(m.property_scope, g.property_scope, 'all') = 'private'
               and v_prop.category is distinct from 'commercial'
             )
             or (
               coalesce(m.property_scope, g.property_scope, 'all') = 'commercial'
               and v_prop.category = 'commercial'
             )
           )
       and not exists (
             select 1 from public.agent_share_exclusions ex
              where ex.agent_id = v_agent.id and ex.agency_id = m.agency_id
           )
  ),
  ranked as (
    select agent_id, agency_id, last_offer,
           row_number() over (partition by agency_id order by random()) as rn
      from eligible
  ),
  picked as materialized (
    select agent_id, agency_id
      from ranked
     where rn = 1
     order by last_offer, random()
     limit v_cap
  ),
  ins as (
    insert into public.property_shares
      (property_id, owner_agent_id, owner_agency_id, shared_with_agency_id)
    select p_property_id, v_agent.id, v_agent.agency_id, p.agency_id from picked p
    on conflict (property_id, shared_with_agency_id) do nothing
    returning shared_with_agency_id
  ),
  noted as (
    -- ההתראה רק למשרד שהשורה שלו נכתבה עכשיו. בלי ה-join ה-insert
    -- של השיתוף אינו חלק מהשאילתה, ושיתוף קיים לא מקבל הודעה שנייה.
    insert into public.notifications (agent_id, type, title, body, related_property_id, suppress_push)
    select p.agent_id,
           'collab_offer',
           'נכס נפתח לשת״פ',
           left(coalesce(v_agency_name, 'משרד')
             || ' פתח/ה נכס לשת״פ: '
             || coalesce(nullif(btrim(v_prop.title), ''), 'נכס')
             || case when nullif(btrim(v_prop.city), '') is not null
                     then ' ב' || btrim(v_prop.city) else '' end
             || '. הפרטים בכרטיס המשותף, בלי מספר טלפון בהודעה.', 500),
           p_property_id,
           false
      from picked p
      join ins i on i.shared_with_agency_id = p.agency_id
    returning 1
  )
  select count(*) into v_n from noted;

  update public.properties
     set shared_with_partners = true,
         shared_at = coalesce(shared_at, now()),
         updated_at = now()
   where id = p_property_id
     and v_n > 0;

  update public.unpublished_collab_opt_in
     set fanout_at = case when v_n > 0 then now() else fanout_at end,
         fanout_count = v_n
   where property_id = p_property_id;

  return jsonb_build_object('ok', true, 'shared', v_n > 0, 'notified', v_n);
end $$;

revoke all on function public.unpublished_collab_fanout(uuid) from public, anon, authenticated;
grant execute on function public.unpublished_collab_fanout(uuid) to service_role;

create or replace function public.unpublished_collab_request(
  p_property_id uuid,
  p_agent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid;
  v_status text;
  v_fan jsonb;
begin
  v_agent := case
               when coalesce(auth.role(), '') = 'service_role' then p_agent_id
               else public.current_agent_id()
             end;
  if v_agent is null then
    return jsonb_build_object('ok', false, 'error', 'not_agent');
  end if;
  select status into v_status from public.properties
   where id = p_property_id and agent_id = v_agent;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_your_property');
  end if;

  insert into public.unpublished_collab_opt_in (property_id, agent_id)
  values (p_property_id, v_agent)
  on conflict (property_id) do update
    set agent_id = excluded.agent_id
  where public.unpublished_collab_opt_in.fanout_at is null;

  v_fan := public.unpublished_collab_fanout(p_property_id);
  return v_fan || jsonb_build_object('recorded', true, 'status', v_status);
end $$;

revoke all on function public.unpublished_collab_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unpublished_collab_request(uuid, uuid) to authenticated, service_role;

create or replace function public.properties_unpublished_collab_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- גם מעבר ל-active, וגם בחירת יעד שמוסיפה מתווכים על נכס שכבר באוויר.
  -- רושמים לפני ההפצה: כשהדגל כבוי fanout חוזר מיד, והשורה נשארת לסבב.
  if tg_op = 'UPDATE'
     and new.status = 'active'
     and new.agent_id is not null
     and coalesce(new.share_with_brokers, false)
     and (
       old.status is distinct from 'active'
       or not coalesce(old.share_with_brokers, false)
     ) then
    insert into public.unpublished_collab_opt_in (property_id, agent_id)
    values (new.id, new.agent_id)
    on conflict (property_id) do update
      set agent_id = excluded.agent_id
    where public.unpublished_collab_opt_in.fanout_at is null;
    perform public.unpublished_collab_fanout(new.id);
  end if;
  return new;
end $$;

revoke all on function public.properties_unpublished_collab_after() from public, anon, authenticated;
grant execute on function public.properties_unpublished_collab_after() to service_role;

drop trigger if exists properties_unpublished_collab_after on public.properties;
create trigger properties_unpublished_collab_after
  after update of status, publish_channels, share_with_brokers on public.properties
  for each row execute function public.properties_unpublished_collab_after();

-- בקשות שנרשמו כשהדגל כבוי נשארות בלי fanout_at. כשהדגל נדלק הסבב
-- מפיץ אותן, בתקרה לסבב, ולא מוחק אותן בשקט. עיר בלי שוק לא תופסת
-- מקום בתקרה: אין למי לשלוח עד שיהיה שוק.
create or replace function public.unpublished_collab_drain(p_limit int default 20)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on int;
  v_n int := 0;
  v_cap int;
  r record;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not public.current_is_platform_admin() then
    return 0;
  end if;
  select coalesce(value::int, 0) into v_on
    from public.pricing_config where key = 'gabriela_collab_share_enabled';
  v_cap := least(greatest(coalesce(p_limit, 20), 1), 50);
  -- נכס באוויר עם share_with_brokers ובלי שורת בקשה (הכרטיס כתב את
  -- העמודה). הרישום קודם, גם כשהדגל כבוי. ההפצה עצמה נשארת מאחורי הדגל,
  -- ועד v_cap נכסים בסבב. לכל נכס התקרה היא בתוך fanout.
  insert into public.unpublished_collab_opt_in (property_id, agent_id)
  select p.id, p.agent_id
    from public.properties p
   where p.status = 'active'
     and p.share_with_brokers
     and p.agent_id is not null
     and not exists (
       select 1 from public.unpublished_collab_opt_in o where o.property_id = p.id
     )
     and exists (
       select 1 from public.cities c
        where c.id = p.city_id and c.market_slug is not null
     )
   order by p.created_at
   limit v_cap
  on conflict (property_id) do nothing;
  if coalesce(v_on, 0) <> 1 then
    return 0;
  end if;
  for r in
    select o.property_id
      from public.unpublished_collab_opt_in o
      join public.properties p on p.id = o.property_id and p.agent_id = o.agent_id
     where o.fanout_at is null
       and p.status = 'active'
       and exists (
             select 1 from public.cities c
              where c.id = p.city_id and c.market_slug is not null
           )
     order by o.created_at
     limit v_cap
  loop
    perform public.unpublished_collab_fanout(r.property_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.unpublished_collab_drain(int) from public, anon, authenticated;
grant execute on function public.unpublished_collab_drain(int) to service_role;

-- ---------------------------------------------------------------------------
-- תזכורת אחת לסוכן/ת לשבוע, דרך הפעמון. הדגל 0 מחזיר ספירה ולא כותב.
-- מילוי unpublished_at=now() אומר שסבב ראשון אחרי המיגרציה יוצא 0.
-- taken_down מוזכר לכל היותר פעם ב-30 יום. טיוטה נשארת שבועית.
-- ---------------------------------------------------------------------------
create or replace function public.unpublished_nudge_enqueue(p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on int;
  v_days int;
  v_cap int;
  v_agents int := 0;
  v_props int := 0;
  v_sent int := 0;
  r record;
  v_lines text;
  v_body text;
  v_title text;
  v_one uuid;
  v_drained int := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
     and not public.current_is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- שני סבבים במקביל לא שולחים פעמיים. הנעילה יורדת בסוף התנועה.
  perform pg_advisory_xact_lock(281900001);
  v_drained := public.unpublished_collab_drain(20);

  select coalesce(value::int, 0) into v_on
    from public.pricing_config where key = 'gabriela_unpublished_nudge_enabled';
  select coalesce(value::int, 7) into v_days
    from public.pricing_config where key = 'agent_reminder_unpublished_days';
  select coalesce(value::int, 25) into v_cap
    from public.pricing_config where key = 'gabriela_unpublished_nudge_run_cap';
  v_days := greatest(coalesce(v_days, 7), 1);
  v_cap := least(greatest(coalesce(v_cap, 25), 1), 200);
  v_cap := least(v_cap, least(greatest(coalesce(p_limit, 25), 1), 200));

  with cand as (
    select p.id, p.agent_id
      from public.properties p
      join public.agency_members m on m.id = p.agent_id
     where p.status = 'unpublished'
       and p.license_hold_at is null
       and p.unpublished_at is not null
       and p.unpublished_at < now() - make_interval(days => v_days)
       and m.active
       and m.license_status in ('verified', 'manual')
       and not exists (
             select 1 from public.unpublished_reminder_snooze s
              where s.agent_id = p.agent_id and s.property_id = p.id
                and (s.muted or s.snooze_until > now())
           )
       -- taken_down הוא ירידה מכוונת: לכל היותר פעם ב-30 יום.
       -- draft ומקור ריק (מילוי) נשארים על הקצב השבועי.
       and (
             p.unpublished_origin is distinct from 'taken_down'
             or not exists (
               select 1 from public.unpublished_nudge_log l
                where l.agent_id = p.agent_id
                  and not l.dry_run
                  and p.id = any(l.property_ids)
                  and l.created_at > now() - interval '30 days'
             )
           )
       and not exists (
             select 1 from public.unpublished_nudge_log l
              where l.agent_id = p.agent_id
                and not l.dry_run
                and l.created_at > now() - interval '7 days'
           )
  )
  select count(distinct agent_id), count(*) into v_agents, v_props from cand;

  if coalesce(v_on, 0) <> 1 then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'enabled', false,
      'agents', v_agents, 'properties', v_props, 'sent', 0,
      'collab_drained', v_drained);
  end if;

  for r in
    select m.id as agent_id,
           (array_agg(p.id order by p.unpublished_at))[1:8] as ids,
           count(*)::int as n,
           count(*) filter (where p.unpublished_origin = 'draft')::int as n_draft,
           count(*) filter (where p.unpublished_origin = 'taken_down')::int as n_down
      from public.properties p
      join public.agency_members m on m.id = p.agent_id
     where p.status = 'unpublished'
       and p.license_hold_at is null
       and p.unpublished_at is not null
       and p.unpublished_at < now() - make_interval(days => v_days)
       and m.active
       and m.license_status in ('verified', 'manual')
       and not exists (
             select 1 from public.unpublished_reminder_snooze s
              where s.agent_id = p.agent_id and s.property_id = p.id
                and (s.muted or s.snooze_until > now())
           )
       -- taken_down הוא ירידה מכוונת: לכל היותר פעם ב-30 יום.
       -- draft ומקור ריק (מילוי) נשארים על הקצב השבועי.
       and (
             p.unpublished_origin is distinct from 'taken_down'
             or not exists (
               select 1 from public.unpublished_nudge_log l
                where l.agent_id = p.agent_id
                  and not l.dry_run
                  and p.id = any(l.property_ids)
                  and l.created_at > now() - interval '30 days'
             )
           )
       and not exists (
             select 1 from public.unpublished_nudge_log l
              where l.agent_id = p.agent_id
                and not l.dry_run
                and l.created_at > now() - interval '7 days'
           )
     group by m.id
     order by min(p.unpublished_at)
     limit v_cap
  loop
    select string_agg(
             left(coalesce(nullif(btrim(p.title), ''), 'נכס'), 50)
             || case when nullif(btrim(p.city), '') is not null then ' · ' || btrim(p.city) else '' end
             || case p.unpublished_origin
                  when 'draft' then ' - טיוטה'
                  when 'taken_down' then ' - ירד מפרסום'
                  else ''
                end,
             E'\n' order by p.unpublished_at)
      into v_lines
      from public.properties p
     where p.id = any(r.ids);

    v_title := 'נכסים שלא באוויר';
    v_body := case
      when r.n_draft = r.n and r.n = 1
        then 'טיוטה אחת לא פורסמה כבר יותר מ-' || v_days || ' ימים.'
      when r.n_draft = r.n
        then r.n || ' טיוטות לא פורסמו כבר יותר מ-' || v_days || ' ימים.'
      when r.n_down = r.n and r.n = 1
        then 'נכס אחד ירד מפרסום לפני יותר מ-' || v_days || ' ימים.'
      when r.n_down = r.n
        then r.n || ' נכסים ירדו מפרסום לפני יותר מ-' || v_days || ' ימים.'
      when r.n_draft = 0 and r.n_down = 0
        then r.n || ' נכסים לא באוויר כבר יותר מ-' || v_days || ' ימים.'
      else r.n || ' נכסים לא באוויר כבר יותר מ-' || v_days
           || ' ימים. חלקם טיוטות, וחלקם ירדו מהמדף.'
    end
    || E'\n' || coalesce(v_lines, '')
    || case when r.n > 8 then E'\nועוד.' else '' end
    || E'\nבכל נכס באזור האישי: לפרסם, שת״פ, או לא עכשיו.';

    v_one := case when r.n = 1 then r.ids[1] else null end;
    insert into public.notifications (agent_id, type, title, body, related_property_id, suppress_push)
    values (r.agent_id, 'unpublished_nudge', v_title, left(v_body, 900), v_one, false);
    insert into public.unpublished_nudge_log (agent_id, property_ids, dry_run)
    values (r.agent_id, r.ids, false);
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'enabled', true,
    'agents', v_agents, 'properties', v_props, 'sent', v_sent,
    'collab_drained', v_drained);
end $$;

revoke all on function public.unpublished_nudge_enqueue(int) from public, anon, authenticated;
grant execute on function public.unpublished_nudge_enqueue(int) to service_role;
