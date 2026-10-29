-- ============================================================================
-- אזורי פעילות מוצהרים למשרדים (ולא ליועצים) - P1-U2, ד-5. PR 1010.
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
--
-- ליועצי נדל״ן המקור הוא agent_lead_preferences.neighbourhoods (אותו מקור כמו הניתוב
-- ו"הפרופיל שלי", ‏P1-V) - כדי שלא יהיו שני מקורות לאותה שאלה. למשרד אין מקור כזה,
-- ולכן העמודות כאן הן למשרדים בלבד. יועץ/ת או משרד בלי נכסים פעילים מופיעים בסינון
-- אחרי בעלי הנכסים, עם "מתמחה ב…" ובלי מונה.
-- ============================================================================

alter table public.agencies
  add column if not exists service_city_ids uuid[] not null default '{}',
  add column if not exists service_neighborhood_ids uuid[] not null default '{}';

comment on column public.agencies.service_city_ids is
  'אזורי פעילות מוצהרים (ערים) - מיתוג המשרד ב-CRM. לסינון בדף הבית, אחרי מי שיש לו נכסים.';
comment on column public.agencies.service_neighborhood_ids is
  'אזורי פעילות מוצהרים (שכונות) - עד 8, מסומנים מראש לפי הנכסים הפעילים.';

-- ה-RLS של agencies כבר מגביל עדכון למנהל/ת המשרד; אין כאן מדיניות חדשה.
-- לפני ההרצה: לבדוק שה-view הציבורי של המשרדים (אם נדרש) מקבל את העמודות בסוף.
