-- ===========================================================================
-- עסקאות לפי יישוב: מנות גדולות לסוכן, ובדיקה שהמנה הגיעה שלמה
-- ---------------------------------------------------------------------------
-- ‏פלט javascript_tool של הסוכן נחתך בכ-1,100 תווים, ולכן מנה הייתה 14
-- עסקאות - יישוב גדול לקח כ-100 סבבים. מעכשיו המנה נפתחת כטקסט בטאב
-- משלה (‏blob של עמוד Govmap) ונקראת בשלמותה, כ-150 עסקאות בפעם.
--
-- **מנה גדולה שנחתכה בשקט מאבדת עסקאות בשקט.** קריאת טקסט ארוך יכולה
-- להיחתך בכל שכבה - הקורא, ההעתקה ל-SQL - והשורה האחרונה שנחתכה באמצע
-- נראית כמו עסקה תקינה עם מחיר קצר. לכן המנה נפתחת בשורת כותרת
-- ‏`#rows=N` ונסגרת ב-`#end`, ו-upsert_deals_text משווה: מספר שונה, או
-- ‏`#end` חסר - שום דבר לא נכתב, והתשובה היא ‏{error:'truncated'}. ‏`#end`
-- נדרש כי חיתוך באמצע השורה האחרונה משאיר את הספירה נכונה. שורה שמתחילה
-- ב-`#` אינה עסקה.
--
-- ‏`#rows=` אינו חובה: מנה בלי כותרת (‏__chunk הקטנה) עובדת כמו קודם.
-- ‏docs/settlement-deals.md. אידמפוטנטית.
-- ===========================================================================

create or replace function public.upsert_deals_text(p_settlement text, p_lines text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines  text[];
  v_rows   jsonb;
  v_expect int;
  v_got    int;
  v_end    boolean;
begin
  if not public.deal_sync_caller_ok() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  v_lines := string_to_array(replace(coalesce(p_lines, ''), E'\r', ''), E'\n');

  select (regexp_match(btrim(l), '^#rows=(\d+)$'))[1]::int
    into v_expect
    from unnest(v_lines) as l
   where btrim(l) ~ '^#rows=\d+$'
   limit 1;

  v_end := exists (select 1 from unnest(v_lines) as l where btrim(l) = '#end');

  select coalesce(jsonb_agg(
           (select jsonb_agg(nullif(btrim(f), '') order by n)
              from unnest(string_to_array(l, '|')) with ordinality as t(f, n))
           order by ln), '[]'::jsonb)
    into v_rows
    from unnest(v_lines) with ordinality as x(l, ln)
   where btrim(l) <> ''
     and left(btrim(l), 1) <> '#';

  v_got := jsonb_array_length(v_rows);
  if v_expect is not null and (v_expect <> v_got or not v_end) then
    return jsonb_build_object('error', 'truncated', 'expected', v_expect, 'got', v_got, 'end', v_end);
  end if;

  return public.upsert_deals(p_settlement, v_rows);
end $$;

comment on function public.upsert_deals_text(text, text) is
  'כמו upsert_deals, אבל שורה לעסקה ושדות מופרדים ב-| (gush|helka|tat|date|price|sqm|street|house|neighborhood|type|rooms|floor). שורת #rows=N נבדקת מול מספר השורות ו-#end חובה איתה - מנה שנחתכה אינה נכתבת. docs/settlement-deals.md';

revoke all on function public.upsert_deals_text(text, text) from public, anon, authenticated;
grant execute on function public.upsert_deals_text(text, text) to authenticated, service_role;
