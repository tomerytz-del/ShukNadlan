-- ============================================================================
-- תזכורות לסוכנים: מתג ראשי לערוץ הוואטסאפ, כבוי עד שתאושר תבנית
--
-- ‏20261026090000 הכניסה את התזכורות עם שני ערוצים, ובנתה את הוואטסאפ נכון:
-- תבנית מאושרת כשהיא מוגדרת, ונפילה לטקסט חופשי כשלא. הנפילה הזו היא הבעיה.
--
-- ## למה טקסט חופשי אינו "פחות טוב" אלא לא-עובד
--
-- ‏Meta מרשה לעסק לשלוח טקסט חופשי אך ורק בתוך חלון של 24 שעות מההודעה
-- האחרונה שהנמען/ת שלח/ה. תזכורת שבועית היא בהגדרה הודעה שיוצאת **מחוץ**
-- לחלון הזה: אם הסוכן/ת כתב/ה לבוט לפני שעה, ממילא אין מה להזכיר לו/ה. לכן
-- הנפילה לטקסט חופשי אינה "איכות ירודה" — היא דחייה מ-Meta בכל פעם, שנרשמת
-- כ-`whatsapp_status='failed'` ובמקרה הגרוע נספרת לחובתנו בדירוג האיכות של
-- המספר העסקי.
--
-- ואילו התבנית טרם הוגשה לאישור. הפער הזה נסגר כאן, לא בהערה בתיעוד.
--
-- ## למה מתג ב-pricing_config ולא מחיקת הערוץ
--
-- שקלנו שלוש דרכים:
--
--   1. **להסיר 'whatsapp' מאילוץ ה-channels.** היה עובד, אבל היה גם מוחק את
--      הבחירה של כל מי שסימן/ה אותה, ומחייב מיגרציה שלישית להחזיר. הערוץ
--      אינו שגוי — הוא רק טרם מוכן.
--   2. **לכבות את ה-cron.** היה מכבה גם את המייל, שעובד ומבוקש.
--   3. **מתג** — מה שנבחר. שורה אחת ב-pricing_config שכל שלוש השכבות קוראות
--      ממנה, וההדלקה ביום שהתבנית תאושר היא `update` יחיד בלי פריסה.
--
-- ## שלוש שכבות, ובכוונה
--
-- | שכבה | מה היא מונעת |
-- | --- | --- |
-- | ‏`agent_reminder_due_agents` (כאן) | הוואטסאפ אינו נחשב ערוץ; סוכן/ת שסימן/ה אותו בלבד אינו/ה "בשל/ה" כלל, ולכן גם ה-cron אינו מעיר את השרת בשבילו/ה |
-- | ‏`agent-reminders/index.ts` | אין תבנית → **לא נשלח כלום**, במקום נפילה לטקסט חופשי |
-- | ‏`crm.html` | תיבת הסימון מושבתת ומוסברת, כדי שאיש לא יסמן/תסמן ערוץ שלא יעבוד |
--
-- שכבה אחת הייתה מספיקה כדי לעצור שליחה. שלוש דרושות כדי שגם לא **ייראה**
-- שהערוץ פעיל: תיבת סימון שנשמרת ולא עושה כלום היא באג מדווח.
--
-- ## מה לא משתנה
--
-- ‏`channels` נשארת `text[]` עם אותו אילוץ, והבחירה של מי שסימן/ה וואטסאפ
-- נשמרת כפי שהיא. ברגע שהמתג יידלק, ההעדפה תתחיל לפעול בלי שאיש יצטרך
-- להיכנס ולסמן מחדש. גם המייל, הקצב, התקרה, שעות השקט והממצאים — כולם
-- בדיוק כשהיו.
--
-- **בזמן כתיבת המיגרציה אין אף שורה ב-`agent_reminder_preferences`** ואף
-- שורה ב-`agent_reminder_log`, ולכן אף הודעת וואטסאפ לא יצאה ואין מה לתקן
-- למפרע. ברירת המחדל של `channels` הייתה `{email}` מהרגע הראשון.
--
-- ## ההדלקה, ביום שהתבנית תאושר
--
--   1. ‏`WHATSAPP_REMINDER_TEMPLATE` ב-Edge Functions → Secrets
--   2. ‏`update public.pricing_config set value = 1
--        where key = 'agent_reminder_whatsapp_enabled';`
--
-- בסדר הזה. המתג לבדו בלי התבנית מחזיר בדיוק את המצב שהמיגרציה הזו באה
-- למנוע — אלא שהשרת כבר מסרב לשלוח בלעדיה, ולכן התוצאה תהיה `failed`
-- מנוסח ולא הודעה דחויה.
--
-- אידמפוטנטית.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. המתג
--
-- ‏0 = כבוי. ‏on conflict do nothing כמו כל מפתח אחר בטבלה: הרצה שנייה של
-- המיגרציה לא תדרוס ערך שכבר הודלק ידנית. זה העיקר — מיגרציה שמאפסת מתג
-- שהופעל בכוונה היא מיגרציה שמכבה פיצ'ר בלי שאיש ביקש.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('agent_reminder_whatsapp_enabled', 0,
   'האם ערוץ הוואטסאפ לתזכורות פעיל. 0 = כבוי עד שתאושר תבנית ב-Meta; ‏1 מדליק בלי פריסה. ראו docs/agent-reminders.md.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. השכבה במסד
--
-- ‏create or replace על אותה חתימה בדיוק — אף קורא לא משתנה
-- (‏`agent_reminders_ready`, ‏`agent_reminders_claim`).
--
-- **הגזירה נעשית בערוצים ולא בתנאי**, וזו הנקודה שכדאי לעצור בה. הניסיון
-- הראשון היה להוסיף `and a.wa_on` לתנאי ה-`where` — זה עוצר את השליחה, אבל
-- משאיר את `channels` המוחזרת כוללת `'whatsapp'`. ואז:
--
--   ‏· `agent_reminders_claim` קוראת `'whatsapp' = any(a.channels)` וכותבת
--     ‏`whatsapp_status = 'pending'`,
--   ‏· ה-Edge Function קורא/ת את אותה רשימה, מנסה לשלוח, ונכשל/ת על היעדר
--     תבנית,
--   ‏· והתוצאה היא שורת `failed` ביומן בכל דייג'סט, על ערוץ שאיש לא ביקש
--     לשלוח בו עכשיו.
--
-- לכן המתג מסונן **בתוך `channels` עצמה** (`array_remove`), וכל השאר נובע
-- בלי עוד שורת קוד: ‏claim רושמת `not_requested`, ה-Edge Function אינו מנסה,
-- והתנאי ב-`where` נשאר בדיוק כפי שהיה. שכבה אחת, שלושה קוראים.
--
-- **ההעדפה השמורה אינה משתנה.** ‏`array_remove` פועל על העותק שהפונקציה
-- מחזירה, לא על הטבלה. סוכן/ת שסימן/ה וואטסאפ ימשיך/תמשיך להיות מסומן/ת
-- במסד, וביום שהמתג יידלק ההעדפה תתחיל לפעול בלי שאיש ייכנס לסמן מחדש.
--
-- שתי תוצאות נוספות:
--
--   · סוכן/ת שסימן/ה וואטסאפ **בלבד** נשאר/ת עם רשימת ערוצים ריקה, ולכן
--     אינו/ה "בשל/ה" כלל — וה-cron גם לא מעיר את השרת בשבילו/ה.
--   · סוכן/ת שסימן/ה את שניהם עובר/ת בזכות המייל, ומקבל/ת מייל בלבד.
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
    select
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_default_cap'), 6) as cap,
      -- ברירת המחדל כאן היא **0 ולא 1**: סביבה שהמפתח חסר בה (מסד שקיבל את
      -- הפונקציה ולא את ה-insert) צריכה להתנהג כמו "כבוי". ערוץ שנדלק בגלל
      -- הגדרה חסרה הוא בדיוק סוג התקלה שהמיגרציה הזו באה למנוע.
      coalesce((select value::int from public.pricing_config
                 where key = 'agent_reminder_whatsapp_enabled'), 0) > 0 as wa_on
  ),
  -- ההעדפות כפי שהן שמורות, לפני הגזירה
  stored as (
    select
      m.id, m.display_name,
      nullif(btrim(coalesce(m.email, '')), '')      as email,
      nullif(btrim(coalesce(m.phone_e164, '')), '') as phone_e164,
      coalesce(p.channels,        array['email']::text[]) as channels,
      coalesce(p.muted_kinds,     '{}'::text[])           as muted_kinds,
      coalesce(p.cadence,         'weekly')               as cadence,
      coalesce(p.max_per_30_days, d.cap)                  as cap,
      coalesce(p.quiet_from_hour, 21)                     as quiet_from,
      coalesce(p.quiet_to_hour,   8)                      as quiet_to,
      d.wa_on
      from public.agency_members m
      cross join dflt d
      left join public.agent_reminder_preferences p on p.agent_id = m.id
     where m.active
       and m.closed_at is null
       and m.closure_requested_at is null
  ),
  -- ‏**המקום היחיד שבו המתג מופעל.** מכאן והלאה `channels` היא הרשימה
  -- האפקטיבית, וכל שאר הקוד — התנאי למטה, ‏claim, וה-Edge Function — עובד
  -- עליה בלי לדעת שקיים מתג.
  agents as (
    select s.id, s.display_name, s.email, s.phone_e164,
           case when s.wa_on then s.channels
                else array_remove(s.channels, 'whatsapp')
           end as channels,
           s.muted_kinds, s.cadence, s.cap, s.quiet_from, s.quiet_to
      from stored s
  ),
  recent as (
    select l.agent_id,
           max(l.created_at)                                             as last_at,
           count(*) filter (where l.created_at > now() - interval '30 days') as n30
      from public.agent_reminder_log l
     group by l.agent_id
  )
  select a.id, a.display_name, a.email, a.phone_e164,
         a.channels, a.muted_kinds, a.cadence, r.last_at
    from agents a
    left join recent r on r.agent_id = a.id
   where a.cadence <> 'off'
     and a.cap > 0
     -- רשימה שהתרוקנה בגזירה למעלה נופלת כאן: מי שסימן/ה וואטסאפ בלבד אינו/ה
     -- בשל/ה, ולכן ה-cron גם לא מעיר את השרת בשבילו/ה.
     and coalesce(array_length(a.channels, 1), 0) > 0
     -- ערוץ בלי כתובת אינו ערוץ. בלי זה היינו מעירים את השרת בכל שעה בשביל
     -- סוכן/ת שביקש/ה וואטסאפ ולא הזין/ה מספר.
     and (('email'    = any(a.channels) and a.email      is not null)
       or ('whatsapp' = any(a.channels) and a.phone_e164 is not null))
     and not public.agent_reminder_quiet_now(a.quiet_from, a.quiet_to)
     and coalesce(r.n30, 0) < a.cap
     and (r.last_at is null
          or r.last_at < now() - case a.cadence
                                   when 'daily' then interval '20 hours'
                                   else              interval '6 days'
                                 end);
$$;

comment on function public.agent_reminder_due_agents() is
  'הסוכנים שמותר לשלוח להם/ן הודעת תזכורת עכשיו — ערוצים, קצב, תקרת 30 יום ושעות שקט. ערוץ הוואטסאפ נחשב רק כש-agent_reminder_whatsapp_enabled דלוק. אינה בודקת אם יש ממצא; זה החלק היקר ונשאר ב-claim.';

-- ה-grants נקבעו ב-20261026090000 ונשמרים על פני create or replace, אבל הם
-- נכתבים כאן שוב במפורש: מי שיקרא רק את הקובץ הזה צריך לראות שהפונקציה
-- אינה חשופה ל-anon ול-authenticated.
revoke all on function public.agent_reminder_due_agents() from public;
revoke all on function public.agent_reminder_due_agents() from anon, authenticated;
grant execute on function public.agent_reminder_due_agents() to service_role;
