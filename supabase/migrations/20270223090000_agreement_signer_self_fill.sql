-- ===========================================================================
-- חותם/ת שמשלים/ה את הפרטים בעצמו/ה בקישור (self_fill)
--
-- עד עכשיו הסכם לא יכול היה לצאת בלי ת.ז. לכל חותם/ת: האשף וה-bot עצרו
-- עליה, כי גוף המסמך ננעל ביצירה (agreements_freeze_body) ושורת הצדדים
-- כותבת את הת.ז. לתוכו. סוכן/ת שאין לו/לה את הת.ז. או את שם המשפחה של
-- הלקוח/ה לא יכול/ה היה/תה לשלוח קישור בכלל.
--
-- עכשיו הסוכן/ת מסמן/ת חותם/ת כ"ישלים/תשלים בקישור". בגוף המסמך השם
-- והת.ז. שלו/ה הם משבצות מסומנות (agreement-doc.js, ‏data-agr-fill), שנמלאות
-- בכל הצגה מהשורה כאן - אותו מקור שממנו בלוק החתימות כבר נבנה. שאר הנוסח
-- נשאר נעול. ‏sign.html פותח את לוח החתימה רק אחרי שהשם המלא והת.ז. הוזנו,
-- ו-agreement-sign כותב אותם רק לשורה שמסומנת self_fill ורק לפני החתימה.
--
-- ‏details_filled_at - מתי החותם/ת השלים/ה (תיעוד: הפרטים הגיעו ממנו/ה ולא
-- מהסוכן/ת). ‏id_confirmed - החותם/ת סימן/ה "המספר נכון" על ת.ז. שספרת
-- הביקורת שלה אינה מתאימה.
-- ===========================================================================

alter table public.agreement_signers
  add column if not exists self_fill         boolean not null default false,
  add column if not exists details_filled_at timestamptz,
  add column if not exists id_confirmed      boolean not null default false;

comment on column public.agreement_signers.self_fill is
  'החותם/ת משלים/ה שם מלא ות.ז. בקישור לחתימה. בגוף המסמך אלה משבצות שנמלאות מהשורה הזו בכל הצגה.';
comment on column public.agreement_signers.details_filled_at is
  'מתי החותם/ת השלים/ה את השם והת.ז. בקישור (רק כש-self_fill).';
comment on column public.agreement_signers.id_confirmed is
  'החותם/ת אישר/ה שת.ז. שנפסלה בספרת הביקורת נכונה ("המספר נכון - לאשר בכל זאת").';
