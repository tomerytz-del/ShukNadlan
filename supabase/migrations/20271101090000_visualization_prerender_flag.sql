-- ============================================================================
-- הדגל visualization_prerender_all_styles (‏viz-speed, 1.11.2026) - נולד כבוי
-- ----------------------------------------------------------------------------
-- כשהוא 1: נכס פרטי שמתפרסם מקבל את כל ארבעת הסגנונות מראש, ולא רק
-- modern_clean, ובקשה של גולש/ת לסגנון אחד מייצרת ברקע את הסגנונות החסרים.
-- כך לחיצה על כל סגנון מוצגת מיד במקום המתנה של 13-16 שניות.
--
-- **עולה כסף, ולכן נולד 0:** עד 3 סגנונות × עד 3 מטרות לכל נכס פרטי חדש
-- (בערך 7.7 תמונות לנכס). רק תומר מדליק (‏update ... set value = 1).
-- הקוד שקורא אותו: prerenderAllStylesOn ב-supabase/functions/_shared/visualization.ts.
--
-- אידמפוטנטית: on conflict do nothing - לא דורס ערך שתומר כבר קבע.
-- ‏docs/property-visualizations.md, "מהירות ועלות (viz-speed)".
-- ============================================================================

insert into public.pricing_config (key, value, description) values
  ('visualization_prerender_all_styles', 0,
   'הדמיות: 1 = כל ארבעת הסגנונות נוצרים מראש לנכס פרטי (בפרסום וברקע אחרי בקשה). עולה כסף - רק באישור תומר')
on conflict (key) do nothing;

-- ‏viz-1115-fix: פגיעה במטמון ההדמיות נרשמת ביומן ‏ai_usage_log עם model = 'cache' (‏viz_cache_hit),
-- בלי קריאה למודל. בלי שורה במחירון הפאנל "עלויות AI" ב-CRM מציג "בלי מחיר" - כאן היא 0 לתמונה.
insert into public.ai_model_prices
  (model, input_usd_mtok, output_usd_mtok, cache_read_usd_mtok, cache_write_usd_mtok, cache_write_1h_usd_mtok, unit_usd, unit_label) values
  ('cache', 0, 0, 0, 0, 0, 0, 'תמונה')
on conflict (model) do nothing;
