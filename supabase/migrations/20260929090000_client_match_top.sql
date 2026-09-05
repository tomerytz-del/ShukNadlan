-- ============================================================================
-- ‏client_match_top() — ההתאמה החזקה ביותר לכל לקוח/ה, לצד הספירה
-- ----------------------------------------------------------------------------
-- ‏client_match_counts() (מיגרציה 20260825140000) מחזירה מספר בלבד, ולכן
-- רשימת הלקוחות ב-CRM יכלה לומר "14 התאמות" ותו לא. הכפתור "הצגת 14 התאמות"
-- הוא מנוע הכסף של המסך הזה, והוא דרש אמונה: לוחצים כדי לגלות אם יש שם
-- משהו אמיתי. אחרי שלוש לחיצות שהחזירו נכסים מחוץ לתקציב מפסיקים ללחוץ.
--
-- הפונקציה כאן מחזירה את אותה ספירה ובנוסף את שורת ההתאמה הראשונה —
-- ‏match_properties_for_client כבר ממוינת לפי ציון יורד, ולכן "הראשונה" היא
-- "החזקה ביותר". ‏CRM מציג ממנה שורה אחת בכרטיס: הציון, סוג הנכס והכתובת.
--
-- ‏count(*) over () ולא שאילתה שנייה: פונקציות חלון מחושבות לפני LIMIT,
-- ולכן קריאה אחת ל-match_properties_for_client לכל לקוח/ה מספיקה לשניהם.
-- הקריאה הקודמת הריצה אותה פעם אחת בלבד גם היא, ולכן העלות זהה.
--
-- הבדיקות ההרשאתיות כולן יושבות בפונקציה הפנימית (היא בודקת שהלקוח/ה שייך/ת
-- לסוכן/ת המחובר/ת), ולכן אין כאן בדיקה כפולה — בדיוק כמו ב-client_match_counts.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב ושוב.
-- ============================================================================

create or replace function public.client_match_top()
returns table (
  client_id          uuid,
  match_count        int,
  top_score          int,
  top_title          text,
  top_property_type  text,
  top_deal_type      text,
  top_price          numeric,
  top_city           text,
  top_street         text,
  top_house_number   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         coalesce(t.n, 0),
         t.score,
         t.title,
         t.property_type,
         t.deal_type,
         t.price,
         t.city,
         t.street,
         t.house_number
    from public.agent_clients c
    left join lateral (
      select (count(*) over ())::int as n,
             m.score, m.title, m.property_type, m.deal_type, m.price,
             m.city, m.street, m.house_number
        from public.match_properties_for_client(c.id) m
       limit 1
    ) t on true
   where c.agent_id = public.current_agent_id()
     and c.status = 'active';
$$;

comment on function public.client_match_top() is
  'לכל לקוח/ה פעיל/ה של הסוכן/ת המחובר/ת: מספר ההתאמות וההתאמה החזקה ביותר — לתצוגה המקדימה בכרטיס הלקוח/ה.';

revoke all on function public.client_match_top() from public;
revoke all on function public.client_match_top() from anon;
grant execute on function public.client_match_top() to authenticated;
