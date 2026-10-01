-- ============================================================================
-- הקוד החד-פעמי לחתימה יוצא גם בוואטסאפ
--
-- ‏עד היום הקוד נשלח במייל בלבד, ובטופסי קונה ושוכר — שבהם require_otp דלוק
-- כברירת מחדל — לרוב הלקוחות אין מייל בכרטיס. הקישור נפתח, הגיע לשער
-- האימות, ונתקע שם בלי דרך קדימה. מעכשיו הקוד יוצא קודם כול בוואטסאפ
-- למספר שבכרטיס, ובמייל כשאין מספר או כשהשליחה בוואטסאפ נכשלה.
--
-- ‏otp_channel שומר לאן יצא הקוד האחרון, כדי שמסך האימות יאמר "שלחנו
-- בוואטסאפ ל-***-***-3466" גם אחרי רענון — כשהקוד עדיין בתוקף ולא נשלח
-- מחדש.
--
-- הקובץ אידמפוטנטי.
-- ============================================================================

alter table public.agreement_signers
  add column if not exists otp_channel text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agreement_signers_otp_channel_check'
      and conrelid = 'public.agreement_signers'::regclass
  ) then
    alter table public.agreement_signers
      add constraint agreement_signers_otp_channel_check
      check (otp_channel is null or otp_channel in ('whatsapp','email'));
  end if;
end $$;

comment on column public.agreement_signers.otp_channel is
  'לאן יצא הקוד החד-פעמי האחרון: whatsapp או email. וואטסאפ קודם, מייל כשאין מספר או כשהשליחה נכשלה.';
