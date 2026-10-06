---
name: wallet-charges
description: עבודה על הארנק הדיגיטלי בריפו של שוק נדל״ן - חיוב מהארנק (ליד, קידום, סרטון, מספר וירטואלי, דקות, לידי משכנתא וחנות), חלון האישור confirmPurchase, הסדר "מחייבים ואז קונים", החזר כשהפעולה נכשלה, חידוש חודשי, החזר יתרה, טעינה בסליקה (מורנינג) והמע״מ. Use when adding a new paid action, writing a function that touches credit_balance, when an agent was charged twice or charged for something that failed, when a purchase "went through" without a charge, when touching confirmPurchase / checkout.html / wallet-topup / complete_wallet_topup / request_wallet_refund, or when a question about VAT on wallet charges comes up.
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

## 5. המע״מ - פער פתוח

**הדף מצהיר שכל המחירים לפני מע״מ** (‏"₪89 לחודש + מע״מ"). אבל:

| שלב | מה קורה |
| --- | --- |
| טעינה של ₪100 | נגבים ₪100, ומורנינג מפרקת מתוכם את המע״מ (‏`income` לא נשלח) |
| בארנק | ‏₪100 - כלומר כסף **כולל** מע״מ |
| הזמנת מספר | יורדים ₪89 בדיוק |

כלומר בפועל ₪89 **כולל** מע״מ (‏≈ ₪75.4 + מע״מ), בניגוד לדף. המנויים
עצמם (‏`subscription_price`) כן מוסיפים `vat_rate` - רק החיובים מהארנק לא.
**זו החלטה מוצרית שטרם נסגרה**, ולא תיקון חישוב: הכפלה ב-`1 + vat_rate`
בכל פונקציות הרכישה מייקרת כל ליד, קידום ומספר ב-18%. עד שתוחלט - לא
להוסיף לדף מחיר ארנק חדש עם "+ מע״מ" בלי להזכיר את זה, ולא לשנות פונקציית
רכישה אחת לבד (שתי שיטות במקביל גרועות משתיהן).

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
