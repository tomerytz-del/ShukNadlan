-- ============================================================================
-- אימות זהות לפני הצגת ההסכם לחותם/ת מרחוק
--
-- ‏הבעיה שזה פותר קיימת בעיקר בטופס הקונה והשוכר: רשימת ההצעות שבו היא
-- הנכס עצמו — כתובת, מספר דירה ומחיר מבוקש — והיא הסחורה של המשרד. קישור
-- לחתימה שנשלח ללקוח/ה והועבר הלאה בוואטסאפ חושף אותה לכל מי שקיבל אותו.
--
-- לכן: כשההסכם מסומן ‏require_otp, ‏agreement-sign אינו מחזיר את
-- ‏document_html עד שהחותם/ת הזין/ה קוד חד-פעמי שנשלח לכתובת המייל שלו/ה.
-- זה לא מזהה את האדם — הוא מוכיח שליטה בתיבה שאליה נשלח הקישור, וזה בדיוק
-- מה שקישור שהועבר הלאה אינו נותן.
--
-- ‏**הקוד עצמו אינו נשמר.** נשמר ‎sha-256‎ שלו יחד עם מזהה החותם/ת, כדי
-- ששורה שדלפה לא תאפשר להיכנס בשם מישהו, ושאותו קוד אצל שני חותמים לא
-- ייתן אותו האש.
--
-- ‏allow_passport נפרד ממנו לגמרי: יש חותמים שאין להם ת.ז. ישראלית, ובלי
-- השדה הזה הטופס דורש מהם מספר שאין להם.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.agreements
  add column if not exists require_otp    boolean not null default false,
  add column if not exists allow_passport boolean not null default false;

comment on column public.agreements.require_otp is
  'החותם/ת מרחוק חייב/ת להזין קוד חד-פעמי לפני שגוף ההסכם מוצג. ברירת המחדל בטופסי קונה/שוכר, שבהם פרטי הנכס הם עצמם המידע המוגן.';
comment on column public.agreements.allow_passport is
  'מאפשר לחותם/ת להזין מספר דרכון במקום ת״ז — לחותמים שאין להם ת״ז ישראלית.';

alter table public.agreement_signers
  add column if not exists otp_hash        text,
  add column if not exists otp_sent_at     timestamptz,
  add column if not exists otp_expires_at  timestamptz,
  add column if not exists otp_attempts    smallint not null default 0,
  add column if not exists otp_verified_at timestamptz,
  add column if not exists id_kind         text
    check (id_kind is null or id_kind in ('id_card','passport'));

comment on column public.agreement_signers.otp_hash is
  'sha-256 של הקוד החד-פעמי יחד עם מזהה החותם/ת. הקוד עצמו אינו נשמר בשום מקום.';
comment on column public.agreement_signers.otp_attempts is
  'ניסיונות הזנה כושלים. חמישה ניסיונות סוגרים את הקוד ומחייבים לשלוח חדש.';
comment on column public.agreement_signers.id_kind is
  'id_card = ת״ז · passport = דרכון. נקבע לפי מה שהחותם/ת הזין/ה בפועל.';

-- ‏agreements_freeze_body חוסם את גוף המסמך ואת סעיפיו, ובכוונה **אינו**
-- חוסם את שני הדגלים האלה: הם אינם חלק מהנוסח שנחתם אלא מהאופן שבו הוא
-- נמסר, והסוכן/ת מדליק/ה אותם ברגע השליחה — אחרי שההסכם כבר נוצר.

-- ---------------------------------------------------------------------------
-- ‏marketing_actions יצא משימוש
--
-- העמודה נוצרה מתוך הנחה שהסוכן/ת בוחר/ת מראש שתי פעולות שיווק. הטופס
-- שבשימוש בפועל אינו עובד כך: נספח פעולות השיווק מודפס בו **במלואו**,
-- וההתחייבות היא "יבוצעו על ידכם לפחות שתי פעולות שיווק מהאמור כדלקמן".
-- בחירה מראש הייתה מצמצמת את ההסכם ומחייבת דווקא בשתיים שסומנו.
--
-- העמודה נשארת ולא נמחקת: יש בה ‏NOT NULL DEFAULT, מחיקתה אינה הפיכה,
-- ואין לה עלות. מעקב אחרי פעולות שיווק שבוצעו בפועל הוא מנגנון אחר.
-- ---------------------------------------------------------------------------
comment on column public.agreements.marketing_actions is
  'לא בשימוש. נספח פעולות השיווק מודפס בהסכם במלואו ואינו נבחר — ראו docs/client-agreements.md.';
