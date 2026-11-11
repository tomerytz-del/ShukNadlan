-- ---------------------------------------------------------------------------
-- מודל התמחור החדש (החלטת תומר, 9.11.2026): PROFESSIONAL ₪199, Elite ₪399
-- (docs/pricing-and-tiers.md)
--
-- מה השתנה ולמה. עד היום: Pay&GO ₪0, PROFESSIONAL ₪399, Elite ₪599 - קפיצה
-- מ-0 ל-399 בלי מדרגה באמצע, ו-Elite ב-₪707 כולל מע״מ מול ₪499 כולל מע״מ
-- אצל המתחרה הקרוב. המחירים נקבעו מול עוגן פנימי (₪750/₪950 הישנים) ולא
-- מול השוק. מעכשיו: 0 / 199 / 399, כל מדרגה קונה דבר אחד ברור - גבריאלה
-- בוואטסאפ, ואז שמונה סרטונים בחודש וכלי הגיוס.
--
-- שני מפתחות חדשים, באותו PR:
--   * ppl_price_owner_free - ליד בעלים של הפלטפורמה לסוכן/ת Pay&GO, ₪69 לפני
--     מע״מ (עד היום: חסום לגמרי). הגייט והמחיר ב-claim_lead (המיגרציה הבאה).
--   * gabriela_fair_use_monthly - תקרת "שימוש הוגן" לעוזרת בוואטסאפ ב-PROFESSIONAL,
--     בהודעות נכנסות לחודש. **ערך פנימי**: דף המסלולים אומר "שימוש הוגן" בלי
--     מספר, וגם הודעת התקרה בבוט אינה נוקבת בו. נקרא ב-whatsapp-webhook/index.ts
--     (fairUseExceeded). ב-Elite אין תקרה.
--
-- אף אחד אינו משלם עדיין (0 מנויים ששולמו; ההטבה נגמרת מ-9.3.2027), ולכן
-- הורדת המחיר אינה נוגעת במנוי קיים. המחיר מוצג ב-assets/tiers.js, ב-pricing.html,
-- ב-checkout.html וב-TIER_PRICES ב-_shared/launch-promo.ts - כולם באותו PR,
-- ו-scripts/check_pricing.py מצליב. אידמפוטנטית.
-- ---------------------------------------------------------------------------

update public.pricing_config set value = 199 where key = 'tier_mid_monthly_price';
update public.pricing_config set value = 399 where key = 'tier_premium_monthly_price';

insert into public.pricing_config (key, value, description)
values ('ppl_price_owner_free', 69,
        '₪ לפני מע״מ לפתיחת ליד בעל-נכס של הפלטפורמה לסוכן/ת Pay&GO (free). claim_lead, docs/pricing-and-tiers.md')
on conflict (key) do update set description = excluded.description;

insert into public.pricing_config (key, value, description)
values ('gabriela_fair_use_monthly', 200,
        'שימוש הוגן בעוזרת בוואטסאפ במסלול PROFESSIONAL: הודעות נכנסות לחודש (שעון ישראל). ערך פנימי - לא מוצג באתר ולא בהודעה. whatsapp-webhook/index.ts')
on conflict (key) do update set description = excluded.description;
