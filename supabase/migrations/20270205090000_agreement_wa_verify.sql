-- ============================================================================
-- אימות חותם/ת בהודעה נכנסת בוואטסאפ — בלי תבנית
--
-- ‏תבנית AUTHENTICATION של Meta דורשת אימות עסק ונפח שליחה שאין לנו עדיין,
-- ובלעדיה העסק אינו יכול **לשלוח** קוד ללקוח/ה שמעולם לא כתב/ה לו. ההיפוך
-- פותר את זה: הלקוח/ה **שולח/ת** לנו הודעה מוכנה ("אימות חתימה 482193")
-- מהטלפון, וה-webhook בודק שהיא הגיעה מהנייד שבכרטיס החותם/ת. זה חזק יותר
-- מקוד: ההודעה עצמה מוכיחה שליטה במספר, וקישור שהועבר הלאה נשלח ממספר אחר.
--
-- ‏wa_verify_nonce הוא שש ספרות שמזהות **איזה** הסכם — לאותו לקוח/ה יכולים
-- להיות שני הסכמים פתוחים. תוקף 30 דקות, ונמחק כשמומש.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.agreement_signers
  add column if not exists wa_verify_nonce        text,
  add column if not exists wa_verify_requested_at timestamptz;

create index if not exists agreement_signers_wa_verify_nonce_idx
  on public.agreement_signers (wa_verify_nonce)
  where wa_verify_nonce is not null;

comment on column public.agreement_signers.wa_verify_nonce is
  'שש ספרות שהחותם/ת שולח/ת לעסק בוואטסאפ ("אימות חתימה NNNNNN"). ה-webhook מאמת רק כשההודעה הגיעה מהנייד שבכרטיס. נמחק כשמומש.';
comment on column public.agreement_signers.wa_verify_requested_at is
  'מתי נוצר wa_verify_nonce. תוקף 30 דקות.';
