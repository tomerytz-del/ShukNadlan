-- ============================================================================
-- ארכיון רשומת ההיסטוריה שנמחקה מ-supabase_migrations.schema_migrations
-- בתאריך 2026-09-03, כדי לשחרר את `supabase db push` (הרצה #37).
--
-- מה הייתה הרשומה הזאת
-- --------------------
-- ‏`20260902221109` בשם `news_story_key`. היא **אותה מיגרציה בדיוק** שנמצאת
-- בריפו כ-`supabase/migrations/20260919090000_news_story_key.sql` — אותו
-- ‏`add column story_key`, אותו comment, אותו אינדקס חלקי. ההבדל היחיד הוא
-- ה-version: המיגרציה הוחלה על המסד דרך כלי חיצוני (‏Supabase MCP,
-- ‏`apply_migration`) בזמן פיתוח ה-PR, וכלי כזה רושם את ההחלה תחת חותמת
-- **רגע ההרצה** (2026-09-02 22:11:09) ולא תחת ה-version שבשם הקובץ.
--
-- למה היא חסמה
-- ------------
-- ‏`db push` מסרב לרוץ כשההיסטוריה במסד מכילה version שאין לו קובץ מקומי,
-- ונכשל ב-"Remote migration versions not found in local migrations directory".
-- זו בדיוק אותה חסימה שתועדה ב-2026-09-02 עבור 100 רשומות ההרצה הידנית —
-- הפעם ממקור חדש: כלי MCP במקום הדשבורד.
--
-- ‏PR ‎#137 מוזג ב-22:34, ה-workflow רץ, וכל המיגרציות שאחריו נעצרו — כולל
-- ‏`20260919090000_news_story_key` עצמה, שנשארה לא רשומה למרות שתוכנה כבר
-- הוחל על המסד.
--
-- מה המחיקה עשתה — ומה לא
-- -----------------------
-- היא נגעה **רק בטבלת הרישום**. העמודה `news_items.story_key` והאינדקס
-- ‏`news_items_story_key_idx` נשארו במסד בדיוק כפי שהיו. אחרי המחיקה
-- ‏`db push` הריץ את הקובץ המקומי `20260919090000_news_story_key.sql`,
-- שהוא אידמפוטנטי (`if not exists` בשתי הפקודות) ולכן לא שינה דבר בסכימה —
-- והפעם הרישום נכנס תחת ה-version שבשם הקובץ, כפי שצריך.
--
-- שחזור
-- -----
-- הרצת ה-insert שלמטה מחזירה את הרשומה כפי שהייתה. שימו לב: החזרתה תחסום
-- שוב את `db push` מאותה סיבה.
-- ============================================================================

insert into supabase_migrations.schema_migrations (version, name, statements) values (
  '20260902221109',
  'news_story_key',
  array[$stmt$alter table public.news_items
  add column if not exists story_key text;

comment on column public.news_items.story_key is
  'מזהה מנורמל של האירוע בפורמט נושא|אירוע|תקופה, כפי ש-Claude מחזיר אותו. מפתח מניעת הכפילויות בין אתרים שסיקרו את אותו סיפור — להבדיל מ-source_url שמזהה כתבה בודדת.';

create index if not exists news_items_story_key_idx
  on public.news_items(story_key, published_at desc)
  where story_key is not null;$stmt$]
);
