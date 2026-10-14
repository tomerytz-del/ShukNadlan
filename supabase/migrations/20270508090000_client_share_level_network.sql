-- =============================================================================
-- לקוחות: ברירת המחדל של רמת השיתוף עוברת ל"שיתוף רשת" (network)
--
-- ב-20270426090000 נקבע office לכל לקוח/ה. בסיכום ההתאמות הראשון (13.10.2026,
-- ‏12:07) התברר המחיר: שלושה לקוחות משלושה משרדים התאימו לאותו פנטהאוז, ואף
-- אחד/ת לא סיפר/ה למפרסם/ת - כי ברמת office רק סוכנים מאותו משרד שומעים על
-- הלקוח/ה. עד אז listing_match סיפר על זה תמיד, ושיתוף הפעולה בין משרדים
-- הוא כל התכלית. ההחלטה (המשתמש, 14.10.2026): ללקוחות ברירת המחדל היא network.
--
-- מה network חושף, ומה לא: רק "יש לקוח/ה של X שמתאים/ה לנכס שלך", עם השם
-- והטלפון של הסוכן/ת. שם הלקוח/ה, הטלפון והדרישות לא נחשפים באף רמה
-- (ה-RLS של agent_clients לא משתנה).
--
-- נכסים לא משתנים: שם network פירושו הפצה לשת"פ, וזו החלטה לכל נכס בנפרד.
--
-- הקיימים: כל 73 הלקוחות ישבו ב-office, ואף סוכן/ת לא בחר/ה private או
-- network. office שנשמר בטופס אינו בחירה - הטופס שלח את מה שהציג. לכן כל
-- office עובר ל-network, **פעם אחת בלבד**: ההעברה רצה רק כשברירת המחדל של
-- העמודה עוד אינה network. ריצה חוזרת אינה דורסת office שסוכן/ת בחר/ה אחר כך.
-- =============================================================================

do $$
declare
  v_default text;
begin
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'agent_clients' and column_name = 'share_level';

  if v_default is null or v_default not like '%network%' then
    update public.agent_clients
       set share_level = 'network'
     where share_level = 'office';
  end if;

  alter table public.agent_clients alter column share_level set default 'network';
end $$;

comment on column public.agent_clients.share_level is
  'רמת השיתוף: private - אף סוכן/ת אחר/ת לא שומע/ת על הלקוח/ה; office - רק מפרסמים מהמשרד שומעים בסיכום ההתאמות; network - גם ממשרדים אחרים (ברירת מחדל מ-20270508090000). פרטי הלקוח/ה לא נחשפים באף רמה.';
