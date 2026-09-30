-- ============================================================================
-- מחירי המסלולים: PROFESSIONAL ₪750 → ₪399, Elite ₪950 → ₪599
--
-- החלטה מסחרית. הסכום שנגבה חי ב-pricing_config ונקרא ב-subscription_price(),
-- והוא מוצג בעוד מקומות (‏assets/tiers.js, ‏pricing.html, ‏TIER_PRICES
-- ב-_shared/launch-promo.ts, ‏docs/pricing-and-tiers.md) — כולם עודכנו באותו
-- PR. **מחיר שמוצג ומחיר שנגבה שנפרדים זה מזה הם באג של אמון**, לא של קוד.
--
-- הזמנות קיימות אינן מושפעות: subscription_orders שומרת את הסכום שנגבה.
--
-- אידמפוטנטית: ‎update‎ על ערך קיים, בלי DDL.
-- ============================================================================
update public.pricing_config set value = 399 where key = 'tier_mid_monthly_price';
update public.pricing_config set value = 599 where key = 'tier_premium_monthly_price';

insert into public.pricing_config (key, value) values
  ('tier_mid_monthly_price',     399),
  ('tier_premium_monthly_price', 599)
on conflict (key) do nothing;
