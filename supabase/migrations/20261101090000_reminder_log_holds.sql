-- ============================================================================
-- שורת יומן שלא יצאה אינה חוסמת את הבאה אחריה
--
-- ## מה נשבר
--
-- שתי מערכות ההודעות היוצאות — `agent-reminders` ו-`notification-push` —
-- בנויות על **claim לפני שליחה**: שורת היומן נרשמת קודם, ורק אחר כך השרת
-- שולח. הסדר הזה נכון והוא מה שמונע הודעה כפולה כששרת נופל באמצע.
--
-- אבל הקריאה ל-`/rest/v1/rpc/..._claim` נכשלת מדי פעם ב-504 מה-gateway:
-- ‏13 סבבים של agent-reminders ב-24 שעות, 4 מהם 504, וכולם בטווח
-- ‏5026–5455ms. המשפט עצמו רץ ב-131ms בממוצע (‏`pg_stat_statements`)
-- ואין שום שגיאה ב-`postgres_logs` — כלומר הזמן אינו עבודה במסד, והוא
-- מתחלק בין חצי שנייה לשמונה שניות בלי קשר לכמות הנתונים.
--
-- ‏504 אומר שה-gateway ויתר. הוא **אינו** אומר שה-INSERT לא נסגר. מה שנשאר
-- אחריו הוא שורת יומן ב-`pending` שאיש לא ישלח — והיא חוסמת:
--
--   ‏· `agent_reminder_due_agents` — `max(created_at)` חוסם את הסוכן/ת
--     לשישה ימים (‏`weekly`), וגם תופס מקום בתקרת 30 הימים
--   ‏· `agent_reminders_claim` — ה-`not exists` חוסם את אותו סוג לשבוע
--   ‏· `notification_push_claim` ו-`notification_push_ready` — ההתראות
--     שנכנסו לשורה לא ייכללו בשום הודעה עתידית, לנצח
--
-- כלומר סבב אחד שנחתך משתיק סוכן/ת לשבוע, בשקט, בלי ששום דבר נראה אדום.
-- זה טרם קרה בפרודקשן רק במקרה: בכל ארבעת הסבבים שנכשלו לא היו ממצאים,
-- ולכן `claim` לא כתבה כלום.
--
-- ## מה משתנה
--
-- שורת יומן "מחזיקה מקום" רק אם היא **יצאה** (`sent`) או **יוצאת עכשיו**
-- (`pending` שנרשמה בדקות האחרונות). שורה שנכשלה, או שנתקעה ב-`pending`
-- מעבר לחסד — לא חוסמת. הסבב הבא אוסף את מה שהיא השאירה מאחור.
--
-- **החסד הוא זמן ולא סטטוס**, ובכוונה. אילו היה מבוסס על `reconcile` שרץ
-- וכותב `failed`, היינו מקבלים קיפאון: השורה התקועה חוסמת את
-- ‏`..._due_agents`, ‏`..._ready` מחזירה false, ה-cron לא מעיר את הפונקציה,
-- ‏`claim` לא רצה — ולכן ה-reconcile שאמור לשחרר את השורה לא רץ לעולם.
-- פרדיקט תלוי-זמן משחרר את עצמו. ה-reconcile כאן הוא בשביל הרישום בלבד:
-- שורה תקועה תיראה `failed` עם סיבה, ולא `pending` שנראית כמו משלוח חי.
--
-- ## מה מונע סופת ניסיונות
--
-- אם ערוץ שבור באמת — כתובת מייל שמחזירה שגיאה, תבנית שלא אושרה — שחרור
-- החסימה לבדו היה מייצר ניסיון בכל סבב, לנצח. לכן נוסף גג: שלושה כשלים
-- ב-24 שעות מוציאים את הסוכן/ת מ-`..._due_agents` עד שהיממה מתגלגלת.
-- הפעמון בדשבורד ממשיך לעבוד כרגיל — מה שנעצר הוא הערוץ היוצא בלבד.
--
-- ## אסימטריה מכוונת בין שתי המערכות
--
-- ב-`agent_reminder_due_agents` גם `max(created_at)` מסונן, כי המרווח שם
-- הוא **שישה ימים** ושורה תקועה שלא תסונן תשתיק סוכן/ת לשבוע.
-- ב-`notification_push_due_agents` הוא נשאר כפי שהוא, כי המרווח שם הוא
-- **עשר דקות**: שורה תקועה מעכבת עשר דקות ותו לא, והמרווח הזה הוא גם
-- ההפוגה הטבעית בין שני ניסיונות. רק התקרה היומית מסוננת, כדי שכשלים לא
-- יאכלו את שתים-עשרה ההודעות המותרות.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הפרדיקט: מתי שורת יומן מחזיקה מקום
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_log_holds(
  p_email     text,
  p_whatsapp  text,
  p_created   timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_email = 'sent' or p_whatsapp = 'sent'
      or ((p_email = 'pending' or p_whatsapp = 'pending')
          and p_created > now() - make_interval(mins => coalesce(
                (select value::int from public.pricing_config
                  where key = 'reminder_pending_grace_minutes'), 30)));
$$;

comment on function public.agent_reminder_log_holds(text, text, timestamptz) is
  'האם שורת יומן תזכורת חוסמת הודעה נוספת: יצאה בערוץ אחד לפחות, או נרשמה זה עתה ועדיין בדרך. שורה שנכשלה או נתקעה מעבר לחסד אינה חוסמת.';

revoke all on function public.agent_reminder_log_holds(text, text, timestamptz) from public;
revoke all on function public.agent_reminder_log_holds(text, text, timestamptz) from anon, authenticated;
grant execute on function public.agent_reminder_log_holds(text, text, timestamptz) to service_role;

create or replace function public.notification_push_log_holds(
  p_status  text,
  p_created timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'sent'
      or (p_status = 'pending'
          and p_created > now() - make_interval(mins => coalesce(
                (select value::int from public.pricing_config
                  where key = 'notif_push_pending_grace_minutes'), 30)));
$$;

comment on function public.notification_push_log_holds(text, timestamptz) is
  'האם שורת יומן דחיפה חוסמת הודעה נוספת על אותן התראות. אותו היגיון כמו agent_reminder_log_holds, עם ערוץ אחד.';

revoke all on function public.notification_push_log_holds(text, timestamptz) from public;
revoke all on function public.notification_push_log_holds(text, timestamptz) from anon, authenticated;
grant execute on function public.notification_push_log_holds(text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. היישור: שורה תקועה תיראה כמו מה שהיא
--
-- אינה משנה התנהגות — הפרדיקט למעלה כבר שחרר את השורה. היא קיימת כדי
-- שמי שיפתח את היומן יראה `failed` עם סיבה ולא `pending` שנראית כמו
-- משלוח חי מלפני שבוע. נקראת מתוך ה-claim, שרצה ממילא לפני כל סבב.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminders_reconcile()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.agent_reminder_log
     set email_status    = case when email_status    = 'pending' then 'failed' else email_status    end,
         whatsapp_status = case when whatsapp_status = 'pending' then 'failed' else whatsapp_status end,
         last_error      = coalesce(last_error,
                             'הסבב נחתך אחרי רישום השורה ולפני השליחה — ראו 20261101090000')
   where (email_status = 'pending' or whatsapp_status = 'pending')
     and not public.agent_reminder_log_holds(email_status, whatsapp_status, created_at);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.agent_reminders_reconcile() is
  'מסמנת שורות יומן תזכורת שנתקעו ב-pending מעבר לחסד כ-failed. רישום בלבד: החסימה כבר שוחררה על ידי agent_reminder_log_holds.';

revoke all on function public.agent_reminders_reconcile() from public;
revoke all on function public.agent_reminders_reconcile() from anon, authenticated;
grant execute on function public.agent_reminders_reconcile() to service_role;

create or replace function public.notification_push_reconcile()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.notification_push_log
     set whatsapp_status = 'failed',
         last_error      = coalesce(last_error,
                             'הסבב נחתך אחרי רישום השורה ולפני השליחה — ראו 20261101090000')
   where whatsapp_status = 'pending'
     and not public.notification_push_log_holds(whatsapp_status, created_at);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.notification_push_reconcile() is
  'מסמנת שורות יומן דחיפה שנתקעו ב-pending מעבר לחסד כ-failed. רישום בלבד, כמו agent_reminders_reconcile.';

revoke all on function public.notification_push_reconcile() from public;
revoke all on function public.notification_push_reconcile() from anon, authenticated;
grant execute on function public.notification_push_reconcile() to service_role;

-- ---------------------------------------------------------------------------
-- 3. מי בשל/ה לתזכורת — בלי שורות שלא יצאו
--
-- שלושה שינויים ב-`recent`, והתנאי הרביעי הוא הגג. שאר הפונקציה זהה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminder_due_agents()
returns table (
  agent_id        uuid,
  display_name    text,
  email           text,
  phone_e164      text,
  channels        text[],
  muted_kinds     text[],
  cadence         text,
  last_sent_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with dflt as (
    select coalesce((select value::int from public.pricing_config
                      where key = 'agent_reminder_default_cap'), 6) as cap,
           coalesce((select value::int from public.pricing_config
                      where key = 'reminder_max_failures_24h'), 3)  as max_fail
  ),
  agents as (
    select
      m.id, m.display_name,
      nullif(btrim(coalesce(m.email, '')), '')      as email,
      nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
      coalesce(p.channels,        array['email']::text[]) as channels,
      coalesce(p.muted_kinds,     '{}'::text[])           as muted_kinds,
      coalesce(p.cadence,         'weekly')               as cadence,
      coalesce(p.max_per_30_days, d.cap)                  as cap,
      coalesce(p.quiet_from_hour, 21)                     as quiet_from,
      coalesce(p.quiet_to_hour,   8)                      as quiet_to
      from public.agency_members m
      cross join dflt d
      left join public.agent_reminder_preferences p on p.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
  ),
  -- ‏`last_at` ו-`n30` סופרים רק שורות שיצאו או שיוצאות עכשיו. סבב שנחתך
  -- לא ישתיק סוכן/ת לשישה ימים ולא יבזבז מקום בתקרת 30 הימים.
  -- ‏`fails24` הוא הגג מהצד השני: ערוץ ששבר שלוש פעמים ביממה נעצר.
  recent as (
    select l.agent_id,
           max(l.created_at) filter (
             where public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
           ) as last_at,
           count(*) filter (
             where public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '30 days'
           ) as n30,
           count(*) filter (
             where not public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
               and l.created_at > now() - interval '24 hours'
           ) as fails24
      from public.agent_reminder_log l
     group by l.agent_id
  )
  select a.id, a.display_name, a.email, a.phone_e164,
         a.channels, a.muted_kinds, a.cadence, r.last_at
    from agents a
    cross join dflt d
    left join recent r on r.agent_id = a.id
   where a.cadence <> 'off'
     and a.cap > 0
     and coalesce(array_length(a.channels, 1), 0) > 0
     -- ערוץ בלי כתובת אינו ערוץ. בלי הבדיקה הזו היינו מעירים את השרת בכל
     -- שעה בשביל סוכן/ת שביקש/ה וואטסאפ ולא הזין/ה מספר.
     and (('email'    = any(a.channels) and a.email      is not null)
       or ('whatsapp' = any(a.channels) and a.phone_e164 is not null))
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
     and coalesce(r.n30, 0) < a.cap
     and coalesce(r.fails24, 0) < d.max_fail
     -- ‏20 שעות ל"יומי" ולא 24: דייג'סט שיצא ב-9:05 לא אמור לחסום את זה של
     -- מחר ב-9:00 ולהזליג את השעה יום אחר יום. אותו היגיון ל"שבועי".
     and (r.last_at is null
          or r.last_at < now() - case a.cadence
                                   when 'daily' then interval '20 hours'
                                   else              interval '6 days'
                                 end);
$$;

comment on function public.agent_reminder_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן הודעת תזכורת עכשיו — ערוצים, קצב, תקרת 30 יום, שעות שקט וגג הכשלים היומי. סופרת רק שורות יומן שיצאו או שיוצאות עכשיו. אינה בודקת אם יש ממצא; זה החלק היקר ונשאר ב-claim.';

revoke all on function public.agent_reminder_due_agents() from public;
revoke all on function public.agent_reminder_due_agents() from anon, authenticated;
grant execute on function public.agent_reminder_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 4. התפיסה של התזכורות
--
-- שני שינויים: יישור בפתיחה, ו-`holds` ב-`not exists`. שאר הפונקציה זהה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_reminders_claim(p_limit int default 20)
returns table (
  log_id       uuid,
  agent_id     uuid,
  display_name text,
  email        text,
  phone_e164   text,
  channels     text[],
  items        jsonb,
  item_count   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_items  jsonb;
  v_kinds  text[];
  v_log    uuid;
  v_taken  int := 0;
  v_cap    int := least(greatest(coalesce(p_limit, 20), 1), 200);
begin
  -- רישום בלבד; החסימה כבר שוחררה על ידי הפרדיקט.
  perform public.agent_reminders_reconcile();

  for a in select * from public.agent_reminder_due_agents() loop
    exit when v_taken >= v_cap;

    -- הממצאים של הסוכן/ת, בשני סינונים:
    --   · סוג שהוא/היא השתיק/ה — לא נשלח (אבל כן מוצג בדשבורד)
    --   · סוג שיצא לאחרונה בתוך המרווח שלו — לא חוזר
    -- ‏order by f.sort_order ולא לפי שם הסוג: הסדר הוא סדר הדחיפות שנקבע
    -- ב-findings, וההודעה חייבת להציג אותו סדר שהדשבורד מציג.
    select jsonb_agg(jsonb_build_object(
             'kind',   f.kind,
             'title',  f.title,
             'body',   f.body,
             'action', f.action_acc,
             'count',  f.subject_count
           ) order by f.sort_order),
           array_agg(f.kind order by f.sort_order)
      into v_items, v_kinds
      from public.agent_reminder_findings(a.agent_id) f
     where not (f.kind = any(a.muted_kinds))
       and not exists (
             select 1
               from public.agent_reminder_log l
              where l.agent_id = a.agent_id
                and f.kind = any(l.kinds)
                and l.created_at > now() - public.agent_reminder_kind_interval(f.kind)
                -- שורה שלא יצאה אינה מרווח. בלעדיה סבב אחד שנחתך היה
                -- משתיק את הסוג הזה לשבוע.
                and public.agent_reminder_log_holds(l.email_status, l.whatsapp_status, l.created_at)
           );

    continue when v_items is null;

    insert into public.agent_reminder_log
      (agent_id, kinds, items, email_status, whatsapp_status)
    values (
      a.agent_id, v_kinds, v_items,
      case when 'email'    = any(a.channels) and a.email      is not null then 'pending' else 'not_requested' end,
      case when 'whatsapp' = any(a.channels) and a.phone_e164 is not null then 'pending' else 'not_requested' end
    )
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.email, a.phone_e164,
                        a.channels, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.agent_reminders_claim(int) is
  'רושמת שורת יומן לכל סוכן/ת שבשל/ה ויש לו/ה ממצא, ומחזירה אותה לשליחה. הרישום קודם לשליחה — כך נפילה באמצע לא מייצרת הודעה כפולה, ושורה שלא יצאה אינה חוסמת את הסבב הבא.';

revoke all on function public.agent_reminders_claim(int) from public;
revoke all on function public.agent_reminders_claim(int) from anon, authenticated;
grant execute on function public.agent_reminders_claim(int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. מי בשל/ה לדחיפת התראות
--
-- כאן `last_at` נשאר על כל השורות — ראו האסימטריה בראש הקובץ. מסוננים
-- רק `n24`, ונוסף `fails24`.
-- ---------------------------------------------------------------------------
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
                      where key = 'notif_push_max_failures_24h'), 3)  as max_fail
  ),
  agents as (
    select m.id, m.display_name,
           nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
           coalesce(np.whatsapp_types, '{}'::text[])     as whatsapp_types,
           coalesce(rp.quiet_from_hour, 21)              as quiet_from,
           coalesce(rp.quiet_to_hour,   8)               as quiet_to
      from public.agency_members m
      left join public.agent_notification_preferences np on np.agent_id = m.id
      left join public.agent_reminder_preferences     rp on rp.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
       -- העוזר האישי הוא יכולת של PROFESSIONAL ו-Elite. אותו גייט שב-
       -- ‏`TIER_ALLOWED` ב-whatsapp-webhook, ואותם שלושה תנאים של כל יכולת
       -- בתשלום כאן.
       and m.tier in ('mid', 'premium')
       and m.billing_status = 'active'
  ),
  recent as (
    select l.agent_id,
           -- על כל השורות, במכוון: המרווח כאן הוא עשר דקות, ושורה תקועה
           -- שמעכבת עשר דקות היא בדיוק ההפוגה שרצינו בין שני ניסיונות.
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
  )
  select a.id, a.display_name, a.phone_e164, a.whatsapp_types,
         -- חלון 24 השעות של Meta נמדד מההודעה האחרונה ש**הסוכן/ת** שלח/ה
         -- לבוט. בתוכו מותר טקסט חופשי, שהוא גם זול יותר וגם נושא קישורים
         -- אמיתיים; מחוצה לו נדרשת תבנית מאושרת. ‏23 ולא 24 — שוליים לזמן
         -- שלוקח לסבב לצאת.
         coalesce(
           (select c.last_message_at > now() - interval '23 hours'
              from public.whatsapp_conversations c
             where c.agent_id = a.id),
           false)
    from agents a
    cross join cfg
    left join recent r on r.agent_id = a.id
   where coalesce(array_length(a.whatsapp_types, 1), 0) > 0
     -- ערוץ בלי מספר אינו ערוץ
     and a.phone_e164 is not null
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
     and coalesce(r.n24, 0) < cfg.cap
     and coalesce(r.fails24, 0) < cfg.max_fail
     and (r.last_at is null
          or r.last_at < now() - make_interval(mins => cfg.gap_min));
$$;

comment on function public.notification_push_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן עכשיו הודעת וואטסאפ על התראות: מסלול mid/premium בחיוב פעיל, ערוץ דלוק עם מספר, מחוץ לשעות השקט, בתוך התקרה היומית, מתחת לגג הכשלים ואחרי מרווח הקיבוץ. אינה בודקת אם יש התראה — זה החלק היקר ונשאר ב-claim.';

revoke all on function public.notification_push_due_agents() from public;
revoke all on function public.notification_push_due_agents() from anon, authenticated;
grant execute on function public.notification_push_due_agents() to service_role;

-- ---------------------------------------------------------------------------
-- 6. השאלה הזולה של ה-cron
--
-- ה-`not exists` כאן חייב להיות **זהה** לזה שב-claim. אילו היה רחב ממנו
-- היינו מעירים Edge Function לשווא; אילו היה צר ממנו, ה-cron היה שותק
-- כשיש עבודה. לכן אותו `holds` בדיוק, בשני המקומות.
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notification_push_due_agents() a
     where exists (
       select 1
         from public.notifications n
        where n.agent_id = a.agent_id
          and not n.read
          and n.type = any(a.whatsapp_types)
          and n.created_at > now() - make_interval(hours =>
                coalesce((select value::int from public.pricing_config
                           where key = 'notif_push_lookback_hours'), 12))
          and not exists (
            select 1 from public.notification_push_log l
             where l.agent_id = n.agent_id
               and n.id = any(l.notification_ids)
               and public.notification_push_log_holds(l.whatsapp_status, l.created_at))
     )
  );
$$;

comment on function public.notification_push_ready() is
  'האם יש בכלל התראה שממתינה לשליחה בוואטסאפ. נקראת מה-cron לפני net.http_post. התנאי על היומן זהה לזה של notification_push_claim.';

revoke all on function public.notification_push_ready() from public;
revoke all on function public.notification_push_ready() from anon, authenticated;
grant execute on function public.notification_push_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 7. התפיסה של דחיפת ההתראות
-- ---------------------------------------------------------------------------
create or replace function public.notification_push_claim(p_limit int default 20)
returns table (
  log_id       uuid,
  agent_id     uuid,
  display_name text,
  phone_e164   text,
  channel_mode text,
  items        jsonb,
  item_count   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         record;
  v_items   jsonb;
  v_ids     uuid[];
  v_types   text[];
  v_log     uuid;
  v_mode    text;
  v_taken   int := 0;
  v_cap     int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_look    int := coalesce((select value::int from public.pricing_config
                              where key = 'notif_push_lookback_hours'), 12);
begin
  -- רישום בלבד; החסימה כבר שוחררה על ידי הפרדיקט.
  perform public.notification_push_reconcile();

  for a in select * from public.notification_push_due_agents() loop
    exit when v_taken >= v_cap;

    select jsonb_agg(jsonb_build_object(
             'type',  n.type,
             'title', n.title,
             'body',  n.body
           ) order by n.created_at desc),
           array_agg(n.id order by n.created_at desc),
           array_agg(distinct n.type)
      into v_items, v_ids, v_types
      from public.notifications n
     where n.agent_id = a.agent_id
       and not n.read
       and n.type = any(a.whatsapp_types)
       and n.created_at > now() - make_interval(hours => v_look)
       and not exists (
         select 1 from public.notification_push_log l
          where l.agent_id = n.agent_id
            and n.id = any(l.notification_ids)
            -- התראה שנכנסה לשורה שלא יצאה טרם נשלחה. בלי התנאי הזה היא
            -- הייתה נעלמת מכל הודעה עתידית, לנצח.
            and public.notification_push_log_holds(l.whatsapp_status, l.created_at));

    continue when v_items is null;

    v_mode := case when a.in_service_window then 'text' else 'template' end;

    insert into public.notification_push_log
      (agent_id, notification_ids, types, channel_mode, whatsapp_status)
    values (a.agent_id, v_ids, v_types, v_mode, 'pending')
    returning id into v_log;

    v_taken := v_taken + 1;

    return query select v_log, a.agent_id, a.display_name, a.phone_e164,
                        v_mode, v_items, jsonb_array_length(v_items);
  end loop;
end;
$$;

comment on function public.notification_push_claim(int) is
  'רושמת שורת יומן לכל סוכן/ת שיש לו/ה התראות פתוחות שטרם נשלחו, ומחזירה אותן לשליחה. הרישום קודם לשליחה — כך נפילה באמצע לא מייצרת הודעה כפולה, ושורה שלא יצאה אינה מבליעה את ההתראות שבתוכה.';

revoke all on function public.notification_push_claim(int) from public;
revoke all on function public.notification_push_claim(int) from anon, authenticated;
grant execute on function public.notification_push_claim(int) to service_role;
