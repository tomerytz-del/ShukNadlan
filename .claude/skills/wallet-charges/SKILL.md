---
name: wallet-charges
description: עבודה על הארנק הדיגיטלי בריפו של שוק נדל״ן - הארנק לפני מע״מ (טעינת ₪100 נגבית ₪118, charged_amount, vat_gross), חיוב מהארנק (ליד, קידום, סרטון, מספר וירטואלי, דקות, לידי משכנתא וחנות), חלון האישור confirmPurchase, הסדר "מחייבים ואז קונים", החזר כשהפעולה נכשלה, חידוש חודשי, החזר יתרה, טעינה בסליקה (מורנינג) והמע״מ. Use when adding a new paid action, writing a function that touches credit_balance, when an agent was charged twice or charged for something that failed, when a purchase "went through" without a charge, when touching confirmPurchase / checkout.html / wallet-topup / complete_wallet_topup / request_wallet_refund, or when a question about VAT on wallet charges comes up.
---

# הארנק: כל כסף שיוצא

המסמך המלא על **הטעינה**: `docs/wallet-payments.md`. כאן הצד השני - כל
רכישה שיורדת מ-`agency_members.credit_balance` - ומה שובר בשקט.

## 1. החיוב במסד, בפונקציה אחת, בטרנזקציה אחת

```sql
select * into v_agent from public.agency_members
 where id = p_agent_id and active = true
   for update;                                   -- נעילה: שתי לחיצות, חיוב אחד

update public.agency_members
   set credit_balance = credit_balance - v_charge
 where id = p_agent_id and credit_balance >= v_charge;   -- התנאי, לא רק הבדיקה
if not found then
  return jsonb_build_object('error', 'insufficient_balance',
                            'required', v_charge, 'balance', v_agent.credit_balance);
end if;

insert into public.<x>_charges (..., amount) values (..., v_charge);   -- הסכום בפועל
```

* **המחיר מ-`pricing_config`, לעולם לא מהדפדפן.** הדפדפן שולח מה לקנות, לא
  כמה. ‏`subscription_price()` היא הדוגמה: "מקור האמת היחיד לתמחור".
* **‏`amount` נשמר כפי שחויב**, ולא נגזר מחדש מ-`pricing_config`. שינוי מחיר
  אינו משכתב היסטוריה.
* **ההרשאות:** פונקציה שמקבלת `p_agent_id` - ‏`service_role` בלבד, ו-
  `revoke ... from public, anon, authenticated` (הסקיל `new-migration`).
  אחרת כל סוכן/ת מחייב/ת ארנק של אחר/ת.

## 2. מחייבים ואז קונים, ומחזירים מה שנגבה

פעולה שתלויה בספק חיצוני (‏Twilio, יצירת סרטון) נעשית בסדר הזה:

1. ניכוי + שורה `pending`, באותה טרנזקציה.
2. הקריאה לספק.
3. כישלון - פונקציה שמחזירה **מה שנגבה בפועל** לפי שורת החיוב (במספר הכלול
   ב-Elite - אפס). דוגמה: `phone_line_order_failed`.

ההפך - קונים ואז מחייבים - משאיר אצלנו מספרים או סרטונים קנויים של מי שאין
לו/ה יתרה. ובכל החזר: לפי שורת החיוב, לא לפי המחיר הנוכחי.

שלושה דברים ששוברים את זה בשקט:

* **הקריאה להחזר נבדקת.** ‏`rpc` שנכשל מבטל את כל הטרנזקציה של ההחזר, וקוד
  שמתעלם מהתשובה ממשיך כאילו זוכה. בכישלון - לוג, ניסיון נוסף (פונקציית
  ההחזר אידמפוטנטית), והשורה נשארת פתוחה לסבב הבא.
* **‏timeout מול הספק אינו "נכשל".** הספק אולי קיבל את ההזמנה. השורה
  נשארת `pending` לבירור, וההחלטה אם להחזיר אוטומטית נכתבת במפורש.
* **ההודעה לסוכן/ת אומרת מה קרה לכסף.** "לא בוצע חיוב" אחרי שהחיוב כבר ירד
  מסתירה את הבאג משני הצדדים. נכון: "החיוב הוחזר לארנק" עם הסכום, ורענון
  היתרה.

## 3. חידוש: כשאין יתרה, השירות אינו נעצר מיד

חידוש חודשי (‏`claim_due_phone_line_renewals`) עובר ב-`for update skip
locked`, ובלי יתרה מסמן `payment_failed_at`, מתריע בפעמון, ו**ממשיך לעבוד
7 ימים**. שיחה שהולכת לאיבוד עולה לסוכן/ת יותר מהחודש. שירות חדש עם חידוש
מחליט במפורש מה קורה בלי יתרה, ולא נופל לברירת מחדל של ניתוק.

## 4. חלון האישור הוא אחד

כל רכישה ב-CRM עוברת ב-`confirmPurchase` (‏`assets/crm.js`): מחיר, יתרה,
תיבת סימון, וטעינה מהירה שמפנה ל-`checkout.html`. **רכישה בלי החלון היא
רכישה בלי הסכמה** - והתקנון מחייב אותה. הטעינה עצמה תמיד דרך
`checkout.html`, שאוסף פרטי חשבונית ואישור תקנון לפני הסליקה.

## 5. המע״מ: הארנק לפני מע״מ, והמע״מ נגבה בטעינה

**כל מחיר באתר לפני מע״מ** (החלטה מ-6.10.2026, ‏`20270304090000`). הארנק
עובד באותה יחידה:

| שלב | מה קורה |
| --- | --- |
| טעינה של ₪100 | ‏`start_wallet_topup` שומרת `amount = 100` (קרדיט) ו-`charged_amount = vat_gross(100) = 118` |
| הסליקה | ‏`wallet-topup` שולח למורנינג ₪118. החשבונית: 100 + 18 מע״מ |
| האישור | ‏`complete_wallet_topup` משווה את מה שמורנינג דיווחה ל-`charged_amount`, ומזכה `amount` |
| רכישה | יורד המחיר הנקוב - ₪89 על מספר הם ₪89 לפני מע״מ, כמו בדף |
| החזר | ‏`request_wallet_refund` מורידה קרדיט; ‏`money_amount` (טריגר) הוא הכסף להחזיר, לפי הטעינות שבהקצאה |

* **פונקציית רכישה חדשה אינה מוסיפה מע״מ.** הוא כבר נגבה בכסף שנכנס.
  הוספה שם הייתה גובה אותו פעמיים.
* **ארנק היזמים - אותו כלל** (‏`start_developer_topup`/`complete_developer_topup`).
  מנויים וכרטיסיות בעלי מקצוע אינם עוברים בארנק ומוסיפים `vat_rate` בעצמם.
* ‏`complete_*_topup` מקבלת גם את הסכום הנטו - בכוונה, לחלון שבין פריסת
  המיגרציה לפריסת ה-Edge Function. אין פתח: את הסכום שנשלח לסליקה קובע
  רק הקוד שלנו.
* ‏`VAT_RATE` ב-`checkout.html` הוא תצוגה, ו-`check_pricing.py` מצליב אותו
  מול `pricing_config.vat_rate`. שינוי שיעור המע״מ - מיגרציה, ואז שם.

## 5א. מנויים חוזרים: לא דרך הארנק

מסלול (‏`subscription_orders`) וכרטיסיית בעל/ת מקצוע (‏`ad_orders`) **אינם**
יורדים מהארנק: הם נגבים מהכרטיס, וה-`amount` שלהם כולל מע״מ. חידוש חודשי -
`billing_subscriptions` + `billing-renew`, מאחורי `recurring_charging_enabled`
(עדיין 0). שלושה כללים שחוזרים בשני הסוגים:

* **המנוי מתעדכן רק בטריגר על טבלת ההזמנות** - ההזמנה נסגרת בשלושה מקומות.
* **`charging_order_id` נקבע לפני הפנייה למורנינג** - לעולם לא חיוב כפול.
* **מצב ולא אירוע:** חידוש מסלול נעצר כשהמסלול על השורה השתנה או כשהתבקשה
  סגירה (`claim_due_tier_renewals`) - בלי לזכור לבטל בכל נתיב.

הפרטים: `docs/pricing-and-tiers.md` ("מנוי בתשלום"), `docs/professional-cards.md`.

## 6. ההחזר של יתרה שלא מומשה

‏`request_wallet_refund` מורידה את היתרה **בבקשה** ומחזירה בדחייה. התקרה
היא `least(יתרה, טעינות אמיתיות שטרם הוחזרו)` - כסף ממצב בדיקה אינו בר-החזר.
אין API שמוציא כסף בלי אדם; ההחזר מסומן ידנית אחרי ביצוע במורנינג.

## לפני דחיפה

```sh
python scripts/check_function_grants.py
python scripts/check_pricing.py
python scripts/check_migration_versions.py
```
