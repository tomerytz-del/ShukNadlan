-- עסקאות לפי עיר ורחוב: אינדקס על הנרמול ולא על העמודה (4.11.2026).
--
-- ‏agent_market_deals_lookup (‏market_deals_lookup של גבריאלה) מסנן תמיד ב-
-- ‏public.property_text_key(o.city) = ...‏ ולרוב גם ב-property_text_key(o.street).
-- האינדקס הקיים (city, sold_at) הוא על העמודה הגולמית, ולכן לא תפס: כל בדיקה
-- סרקה את כל העסקאות בחלון (~75K) והריצה את הנרמול על כל שורה. נמדד:
-- בדיקת רחוב אחת בעפולה - 2.8 שניות, והפונקציה מריצה 2-4 כאלה בקריאה. ביומן
-- הכלי: חציון 5.3 שניות, 70% מכל זמן הכלים של גבריאלה ביום עבודה.
--
-- ‏property_text_key היא immutable, כך שאינדקס ביטוי מותר. הביטוי כאן זהה
-- לזה שבפונקציה (‏public.property_text_key(city)), אחרת המתכנן לא משתמש בו.
-- אין שינוי בפונקציה ובתוצאות - רק בדרך שבה הן נמצאות.

create index if not exists market_deals_official_city_key_sold_idx
  on public.market_deals_official (public.property_text_key(city), sold_at desc);

create index if not exists market_deals_official_city_street_key_idx
  on public.market_deals_official (public.property_text_key(city), public.property_text_key(street));

analyze public.market_deals_official;
