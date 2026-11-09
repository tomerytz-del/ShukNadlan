-- ============================================================================
-- ‏REVOKE של כתיבה על views ההדמיות מ-anon ומ-authenticated (PR 1010, P1-K2, ד-13).
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
--
-- ל-anon ול-authenticated יש היום גם INSERT, UPDATE, DELETE ו-TRUNCATE על שני ה-views.
-- בגלל ה-JOIN הכתיבה נכשלת בפועל, ולכן זה ממצא P2 ולא פרצה - אבל הרשאה שאינה בשימוש
-- נסגרת. לפני הרצת השורה השנייה: לוודא שאין קוד שכותב ל-property_visualizations_public.
-- ============================================================================

revoke insert, update, delete, truncate, trigger, references on public.property_visualizations_recent from anon, authenticated;
revoke insert, update, delete, truncate, trigger, references on public.property_visualizations_public from anon, authenticated;
