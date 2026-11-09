-- ---------------------------------------------------------------------------
-- שימוש הוגן בגבריאלה ב-PROFESSIONAL: תקרה קשיחה, הודעת 100%, ותפיסה להודעת
-- החסימה (9.11.2026, תומר). docs/whatsapp-setup.md, "שימוש הוגן ב-PROFESSIONAL".
--
-- 1. gabriela_fair_use_hard_monthly = 250. התקרה הרכה (gabriela_fair_use_monthly,
--    200) עוצרת רק פתיחה של שיחה חדשה, כדי ששום פעולה לא תיקטע (PR #1215). המחיר
--    היה שסוכן/ת שעובד/ת בלי הפסקה של חצי שעה לא נעצר/ת לעולם. מעל הקשיחה נעצר
--    הכול, חוץ מלחיצה על כפתור בתוך שיחה פעילה. 250 = רבע מעל הרכה. **ערך
--    פנימי**, כמו הרכה: לא מוצג באתר ולא בהודעה בבוט. בלי השורה הקוד מחשב רכה
--    × 1.25, ולכן הסדר בין המיגרציה לפונקציה אינו משנה.
--
-- 2. gabriela_fair_use_notices מקבלת גם 100: מי שחצה/תה את הרכה בתוך שיחה פעילה
--    ממשיך/ה לעבוד, ובלי הודעה היה/הייתה נעצר/ת בקשיחה באמצע פעולה בלי אזהרה.
--
-- 3. gabriela_fair_use_blocks - התפיסה של הודעת החסימה, **שורה אחת לסוכן/ת**.
--    רצף (אלבום, כמה הודעות ברצף) מגיע כ-webhooks במקביל; insert ... on conflict
--    do nothing כשאין שורה, ו-update מותנה כשיש (נשלחה לפני יותר מ-30 דקות, או
--    נתפסה ולא נשלחה לפני יותר משתי דקות), ורק מי שכתב/ה שולח/ת. שורה אחת ולא
--    משבצות זמן: רצף שחוצה גבול משבצת היה תופס פעמיים, והטבלה אינה גדלה.
--    שליחה שנכשלה משאירה את התפיסה, וההודעה הבאה של הסוכן/ת אחרי שתי דקות
--    מנסה שוב. בלי הטבלה (הפונקציה עולה לפני המיגרציה) הקוד שולח בלי תפיסה.
--    sent_at משמש גם את הודעת ה-100%: מי שכבר נחסם/ה החודש אינו/ה מקבל/ת אותה.
--
-- whatsapp-webhook בלבד (service_role). אידמפוטנטית.
-- ---------------------------------------------------------------------------

insert into public.pricing_config (key, value, description)
values ('gabriela_fair_use_hard_monthly', 250,
        'שימוש הוגן בעוזרת בוואטסאפ במסלול PROFESSIONAL: תקרה קשיחה, הודעות טקסט וקול לחודש (שעון ישראל). מעליה נעצרת גם שיחה פעילה. ערך פנימי - לא מוצג באתר ולא בהודעה. whatsapp-webhook/index.ts')
on conflict (key) do update set description = excluded.description;

alter table public.gabriela_fair_use_notices
  drop constraint if exists gabriela_fair_use_notices_threshold_check;
alter table public.gabriela_fair_use_notices
  add constraint gabriela_fair_use_notices_threshold_check check (threshold in (75, 90, 100));

comment on table public.gabriela_fair_use_notices is
  'הודעות 75%, 90% ו-100% משימוש הוגן בגבריאלה (PROFESSIONAL), פעם אחת לסף לחודש. שורה = נשלחה. whatsapp-webhook בלבד. docs/whatsapp-setup.md';

create table if not exists public.gabriela_fair_use_blocks (
  agent_id   uuid primary key references public.agency_members(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  sent_at    timestamptz
);

comment on table public.gabriela_fair_use_blocks is
  'תפיסה של הודעת החסימה בשימוש הוגן (PROFESSIONAL): שורה אחת לסוכן/ת. sent_at ריק = נתפסה ועוד לא נשלחה (או נכשלה). whatsapp-webhook בלבד (fairUseAnnounce). docs/whatsapp-setup.md';

alter table public.gabriela_fair_use_blocks enable row level security;

revoke all on public.gabriela_fair_use_blocks from anon, authenticated;
grant all on public.gabriela_fair_use_blocks to service_role;
