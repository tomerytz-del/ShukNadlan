-- ============================================================================
-- מקור ליד photo_request - "בקשו תמונות מהמפרסם" בנכס בלי תמונות (PR 1010,
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
-- סבב 4 חלק 3, ‏docs/no-photo.md).
--
-- ‏lead_source_label: תווית "בקשת תמונות" לצד תוויות הרשתות. ‏lead_source_channel
-- אינה משתנה: photo_request נופל ל-else ('other'), כמו swipe.
-- העתק מלא של 20270806090000 ועוד ענף אחד; אידמפוטנטית (create or replace).
-- ============================================================================

create or replace function public.lead_source_label(p_source text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case p_source
    when 'facebook_dm'       then 'פייסבוק · הודעה'
    when 'facebook_comment'  then 'פייסבוק · תגובה'
    when 'instagram_dm'      then 'אינסטגרם · הודעה'
    when 'instagram_comment' then 'אינסטגרם · תגובה'
    when 'photo_request'     then 'בקשת תמונות'
  end;
$$;

comment on function public.lead_source_label(text) is
  'תווית לסוכן/ת למקור של ליד (facebook_dm → פייסבוק · הודעה, photo_request → בקשת תמונות), או null. אותה מפה כמו SOCIAL_SOURCE_LABELS ב-_shared/lead-routing.ts';
revoke all on function public.lead_source_label(text) from public, anon, authenticated;
grant execute on function public.lead_source_label(text) to service_role;
