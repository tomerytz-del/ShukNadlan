-- ============================================================================
-- רישום זמני תור: גם תור שהגיע מהמייל (kind = 'email').
--
-- version 20271201120000: מעל 20271201110000 שב-main.
--
-- email-intake.ts קורא ל-runAgentTurn כמו הוובהוק, ונשאר מחוץ לרישום. הסוג החדש נכנס לאילוץ.
-- ב-'email': wait_ms הוא מתחילת הטיפול במייל (אחרי ה-claim) עד תחילת התור, ו-transcribe_ms הוא
-- קריאת הקבצים המצורפים. אידמפוטנטית. docs/gabriela-turn-timing.md
-- ============================================================================

alter table public.gabriela_turn_timings
  drop constraint if exists gabriela_turn_timings_kind_chk;
alter table public.gabriela_turn_timings
  add constraint gabriela_turn_timings_kind_chk
  check (kind in ('text', 'voice', 'audio_file', 'image', 'document', 'button', 'email', 'other'));
