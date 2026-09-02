-- ============================================================================
-- פרישת news-ticker-crawler
--
-- הפונקציה הזו הייתה המנגנון הראשון שמילא את רצועת המבזקים: cron שבועי
-- (‏weekly-news-ticker-crawler, ראשון ב-06:00) שקרא פיד RSS אחד, סינן לפי
-- המילה "עפולה" וניסח שורה ב-Claude.
--
-- מאז החליף אותה מנוע ה-Python שרץ ב-GitHub Actions כל שעתיים
-- (‏news_scraper.py + news_engine/, ראו docs/news-ticker.md): הוא קורא את
-- ‏news_sources במקום מקור קשיח אחד, מסנן רלוונטיות לפני כל פנייה ל-API,
-- מדדפל ברמת האירוע לפי story_key ומגביל את מכסת החדשות הארציות.
--
-- שתי סיבות לפרוש את הישנה ולא להשאיר אותה רצה במקביל:
--
-- ‏1. היא כותבת ל-news_items בעקיפת כל השכבה הזו. היא ממלאת headline,
--    ‏source_url ו-published_at בלבד, ולכן השורות שלה נוחתות עם ברירות
--    המחדל של הטבלה — ‏status='published', ‏scope='national', בלי story_key
--    ובלי relevance_score אמיתי. כלומר הן עוקפות גם את הדדופ ברמת האירוע
--    וגם את התקרה לחדשות ארציות. שתי שורות כאלה כבר בטבלה.
--
-- ‏2. היא הפונקציה היחידה עם verify_jwt=false שלא אימתה את הקורא בכלל — לא
--    סוד cron, לא service role, ואפילו לא בדיקת method. קריאת GET מהדפדפן
--    הריצה את הזחילה המלאה על חשבון ANTHROPIC_API_KEY.
--
-- שתי השורות ההיסטוריות נשארות בטבלה ולא נמחקות: הן פורסמו ברצועה, ומחיקה
-- רטרואקטיבית של תוכן שכבר נראה אינה חלק מפרישת מנגנון.
-- ============================================================================

do $$
begin
  -- ‏unschedule זורק שגיאה על job שאינו קיים, ולכן ההרצה החוזרת מוגנת.
  if exists (select 1 from cron.job where jobname = 'weekly-news-ticker-crawler') then
    perform cron.unschedule('weekly-news-ticker-crawler');
    raise notice 'weekly-news-ticker-crawler הוסר מהתזמון';
  else
    raise notice 'weekly-news-ticker-crawler כבר אינו מתוזמן — אין מה לעשות';
  end if;
end
$$;
