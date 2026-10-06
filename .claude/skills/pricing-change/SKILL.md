---
name: pricing-change
description: שינוי מחיר, מכסה או תקרה בריפו של שוק נדל״ן (דמי מנוי, מספר וירטואלי, דקות, ליד, קידום, סרטון) - המיגרציה ל-pricing_config, PRICES ב-scripts/check_pricing.py, ושישה מקומות תצוגה (טבלת ההשוואה, השאלות הנפוצות, הכרטיסים ב-assets/tiers.js, TIER_PRICES, תגית ה-description והתיעוד). Use when changing what anything costs or how much is included, when a price on pricing.html looks different from what the wallet charged, when check_pricing.py fails, when adding a new paid item to the pricing page, or when rewording a pricing row that carries a number.
---

# שינוי מחיר

## מחיר אחד, שבעה מקומות

המחיר שנגבה חי **במסד בלבד**: ‏`pricing_config`, שכל פונקציית חיוב קוראת
ממנו (‏`order_phone_line`, ‏`claim_lead`, ‏`promote_property`,
‏`subscription_price`...). כל השאר הם עותקים לתצוגה, ואף אחד מהם אינו שובר
כשהמסד משתנה:

| # | מה | איפה |
| --- | --- | --- |
| 1 | **מה שנגבה** | מיגרציה שמעדכנת את `pricing_config` |
| 2 | ההצהרה שהבדיקה מצליבה | `PRICES` ב-`scripts/check_pricing.py` |
| 3 | טבלת ההשוואה | `COMPARE` ב-`pricing.html` |
| 4 | השאלות הנפוצות | `<details>` ב-`pricing.html` (מנויים, מע״מ, מספר וירטואלי) |
| 5 | הכרטיסים | `features` ו-`priceMonthly` ב-`assets/tiers.js` - גם מסך בחירת המסלול ב-CRM |
| 6 | השרת | `TIER_PRICES` ב-`supabase/functions/_shared/launch-promo.ts` (מנויים) |
| 7 | שיתוף וחיפוש | `<meta name="description">` ב-`pricing.html` (מנויים) |

ועוד התיעוד: `docs/pricing-and-tiers.md`, והמסמך של היכולת עצמה
(‏`docs/call-tracking.md`, ‏`docs/property-marketing-video.md`...).

**למה זה שקט:** מיגרציה שמעלה את המספר הווירטואלי ל-99 ₪ נפרסת, עוברת ירוק,
והדף ממשיך להבטיח 89. הסוכן/ת לוחץ/ת "הזמנה", חלון האישור (שקורא מהמסד)
אומר 99, והאמון נשבר ברגע הרכישה - לא בבדיקה.

```sh
python scripts/check_pricing.py
```

הבדיקה חוסמת ב-CI שני כיוונים: מיגרציה שכותבת ערך אחר מ-`PRICES`, ומקום
תצוגה שמציג ערך אחר. **ותבנית שלא מוצאת כלום היא כשל** - אחרת ניסוח מחדש
של שורה בטבלה היה מנתק את הבדיקה בלי שאיש ישים לב. מי שמשנה נוסח של שורה
עם מספר מעדכן גם את התבנית ב-`DISPLAY`.

## הסדר שעובד

1. **המיגרציה** (הסקיל `new-migration`): `update public.pricing_config set
   value = ... where key = '...'`. לא בקוד - כל מספר עסקי בריפו יושב שם.
2. **`PRICES`** ב-`check_pricing.py`.
3. **כל מקומות התצוגה** שבטבלה למעלה. ‏`grep -n "₪89"` (המחיר הישן) מוצא
   את רובם.
4. **התיעוד**, כולל נקודות איזון ועלויות שנגזרות מהמחיר (‏`call-tracking.md`
   מחשב כמה דקות מכסה 89 ₪).
5. `python scripts/check_pricing.py && python scripts/check_tier_gates.py`

## מחיר חדש בדף

שורה חדשה ב-`COMPARE` שנושאת מספר מקבלת שתי שורות בבדיקה: המפתח ב-`PRICES`,
ותבנית ב-`DISPLAY` עם קבוצת לכידה אחת למספר. אם המספר שונה בין המסלולים,
זו גם יכולת מובחנת - הסקיל `new-tier-capability`.

## מע״מ: כל מחיר בדף הוא לפני מע״מ

הדף אומר זאת בשורה שמתחת לכרטיסים, ובשורת המספר הווירטואלי במפורש
(‏"₪89 לחודש + מע״מ"). מחיר שנכתב "כולל מע״מ" בדף אחד ו"לפני" באחר הוא שני
מחירים. **אבל הארנק עדיין אינו מוסיף מע״מ לחיובים** - ראו הסקיל
`wallet-charges` לפני שמבטיחים מספר שנגבה מהארנק.

## מנויים קיימים

הורדת מחיר - פשוטה. **העלאה, או צמצום של מה שכלול** (פחות דקות, פחות
סרטונים), נוגעת במי שנרשם/ה על הנוסח הישן. זו החלטה מסחרית ומשפטית ולא
הנדסית - ‏`docs/pricing-and-tiers.md`. לשאול לפני שכותבים את המיגרציה.
