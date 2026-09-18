-- ============================================================================
-- ‏pwa_install_events: שכבת הגנה שנייה — כתיבה בלבד גם ברמת ה-GRANT
--
-- הטבלה נולדה ב-20261124090000 עם RLS מופעל ועם policy אחת בלבד, של
-- ‏insert. המשמעות היא שקריאה דרך ה-API מחזירה רשימה ריקה, וזה אכן מה
-- שקורה היום. אבל זו **שכבה אחת**, ושכבת ה-GRANT שמתחתיה פתוחה לרווחה:
--
--     anon, authenticated → DELETE, INSERT, REFERENCES, SELECT,
--                           TRIGGER, TRUNCATE, UPDATE
--
-- אלה הרשאות ברירת המחדל ש-Supabase נותן לכל טבלה חדשה בסכימה public.
-- הן אינן ייחודיות לטבלה הזו, ובכל שאר הטבלאות בפרויקט הן במקומן — שם
-- יש policies שמתירות קריאה ועדכון, וה-RLS הוא שמצמצם אותן לשורות הנכונות.
--
-- **כאן המצב שונה, ולכן גם ההחלטה שונה.** לטבלה הזו אין ולא אמור להיות
-- אף לקוח שקורא ממנה: הדשבורד קורא דרך platform_pwa_report() בלבד, שהיא
-- ‏security definer בבעלות postgres ואינה מושפעת מההרשאות של anon. מה
-- שהלקוח עושה עם הטבלה הוא דבר אחד בדיוק — insert.
--
-- שלוש נקודות שמצדיקות את הצמצום דווקא כאן:
--
--   ‏1. **‏RLS אינו חל על TRUNCATE.** ‏policy חוסמת select/update/delete,
--      אבל ‎truncate‎ נשלט אך ורק בהרשאת הטבלה. היום אין דרך להגיע אליו
--      דרך PostgREST (הוא מנפיק select/insert/update/delete בלבד), ולכן
--      זו אינה חשיפה חיה — אבל זו הרשאה שאין לה שום שימוש.
--   ‏2. **‏policy אחת מפרידה בין "אין קריאה" ל"יש".** ‏policy של select
--      שתתווסף בעתיד בטעות, או ‎alter table … disable row level security‎
--      של מי שמנפה באגים, פותחת את הטבלה כולה. אחרי הקובץ הזה, גם אז
--      לא תהיה קריאה: אין הרשאה.
--   ‏3. זה זול. ‏revoke אחד, ו-grant אחד שמחזיר בדיוק את מה שצריך.
--
-- **למה ה-insert ממשיך לעבוד אחרי revoke all:**
--
--   • ‏`id` הוא ‎generated always as identity‎ ולא ‎serial‎. לעמודת זהות
--     אין צורך בהרשאת ‎usage‎ על רצף — המערכת מייצרת את הערך בעצמה. עם
--     ‏serial זה היה נשבר כאן בשקט.
--   • הלקוח שולח ‎Prefer: return=minimal‎ (ראו assets/pwa-install.js),
--     ולכן PostgREST מנפיק ‎insert‎ בלי ‎returning‎. **‏return=representation
--     היה דורש גם ‎select‎ ונכשל ב-401.** מי שישנה את הכותרת הזו ישבור
--     את הכתיבה, ולכן היא מתועדת בשני הצדדים.
--
-- הקובץ אידמפוטנטי — ‏revoke ו-grant אפשר להריץ שוב ושוב.
-- ============================================================================

-- שלב אחד: מוחקים הכול לשני התפקידים הציבוריים...
revoke all on table public.pwa_install_events from anon, authenticated;

-- ‏...ומחזירים את הדבר היחיד שהאתר באמת עושה.
grant insert on table public.pwa_install_events to anon, authenticated;

comment on table public.pwa_install_events is
  'מונה התקנות האפליקציה (PWA). ספירות בלבד — בלי משתמש/ת, בלי IP ובלי User-Agent. כתיבה בלבד לקהל הציבורי (‏insert), בשתי שכבות: policy של insert בלבד, וגם GRANT של insert בלבד. הקריאה כולה דרך platform_pwa_report().';
