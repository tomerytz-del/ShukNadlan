-- ============================================================================
-- ניטור "שאלה חוזרת": תשובה קצרה של סוכן/ת לשאלה של גבריאלה, שאחריה גבריאלה שואלת שוב את אותה שאלה.
--
-- version 20271202130000: מעל 20271202120000 שב-main.
--
-- למה: ב-25.11.2026 נמצאו שלושה מקרים (שני סוכנים) שבהם הסוכן/ת ענה/תה ("עפולה", "2%") וגבריאלה שאלה
-- שוב. מקרה כזה אינו שגיאה: אין חריגה, אין כשל, וההודעה יוצאת. הוא נראה רק למי שקורא את השיחה. התיקון
-- (answersLastQuestion ב-reply-style.ts, #1426) הוא על סימפטום, והשאלה אם הוא עזר נענית רק מספירה לאורך
-- ימים. התצוגה הזו היא הספירה, ביום, בשעון ישראל.
--
-- איך נספר: הודעה נכנסת (טקסט או קול) של עד 20 תווים, שלפניה הודעה יוצאת עם סימן שאלה ואחריה הודעה
-- יוצאת בתוך 40 שניות, והמילים העבריות (3 אותיות ומעלה) בסוף שתי ההודעות היוצאות חופפות בחמש ומעלה.
-- זו הערכה לפי חפיפת מילים, לא הוכחה: היא עלולה לפספס ניסוח שונה לגמרי ולספור שאלה דומה שנשאלה בכוונה.
-- לכן המספר משמש למגמה (ירידה או עלייה), לא לספירה מדויקת.
--
-- **התצוגה מחזירה ספירות בלבד, בלי תוכן הודעה, טלפון או מזהה סוכן/ת.** היא קוראת את whatsapp_messages
-- ולכן נחשבת לשליפה רגישה: service_role בלבד, security_invoker.
--
-- אידמפוטנטית (create or replace view).
-- ============================================================================

create or replace view public.gabriela_reask_report
with (security_invoker = true) as
with m as (
  select agent_id, created_at, direction, msg_type, body,
         lag(direction) over w as prev_dir,
         lag(body)      over w as prev_body,
         lead(direction)  over w as next_dir,
         lead(body)       over w as next_body,
         lead(created_at) over w as next_at
    from public.whatsapp_messages
   where created_at > now() - interval '14 days'
     and agent_id is not null
  window w as (partition by agent_id order by created_at)
), q as (
  select (created_at at time zone 'Asia/Jerusalem')::date as day,
         (select array_agg(w)
            from unnest(string_to_array(regexp_replace(right(trim(prev_body), 90), '[^א-ת ]', ' ', 'g'), ' ')) w
           where length(w) >= 3) as prev_words,
         (select array_agg(w)
            from unnest(string_to_array(regexp_replace(right(trim(next_body), 90), '[^א-ת ]', ' ', 'g'), ' ')) w
           where length(w) >= 3) as next_words
    from m
   where direction = 'in'
     and msg_type in ('text', 'audio')
     and length(coalesce(body, '')) <= 20
     and prev_dir = 'out' and next_dir = 'out'
     and prev_body like '%?%'
     and next_at - created_at < interval '40 seconds'
     and length(coalesce(next_body, '')) < 260
)
select day,
       count(*)                                                     as short_answers,
       count(*) filter (where cardinality(array(
             select unnest(prev_words) intersect select unnest(next_words))) >= 5) as reasked,
       round(100.0 * count(*) filter (where cardinality(array(
             select unnest(prev_words) intersect select unnest(next_words))) >= 5) / count(*), 1) as reasked_pct
  from q
 group by day
 order by day desc;

comment on view public.gabriela_reask_report is
  'שאלה חוזרת של גבריאלה אחרי תשובה קצרה, לפי יום (שעון ישראל), 14 יום. הערכה לפי חפיפת מילים. ספירות בלבד. docs/gabriela-turn-timing.md';

revoke all on public.gabriela_reask_report from public, anon, authenticated;
grant select on public.gabriela_reask_report to service_role;
