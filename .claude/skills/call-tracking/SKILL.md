---
name: call-tracking
description: עבודה על המספרים הווירטואליים ויומן השיחות בריפו של שוק נדל״ן - Twilio, twilio-voice, הקלטה, תמלול Whisper וסיכום בוואטסאפ, הזמנת מספר מהארנק, המסלולים (אחד כלול ב-Elite, אחד בתשלום בשאר, ירידת מסלול), תקרת 150 הדקות, ה-caller ID שקובע את המחיר, וחתימת ה-Webhook. Use when touching supabase/functions/twilio-voice, the office calls view (accOfficeCalls, manager listening), agent_phone_lines / agent_calls / phone_line_charges, the lines panel or call rows in assets/crm.js, when a call returns 403 or "אירעה שגיאת יישום", when a transcription or summary fails, when an order fails or charges twice, when changing what a tracking number costs or includes, or when an agent says calls stopped being recorded.
---

# מספרים וירטואליים ויומן שיחות

המסמך המלא: `docs/call-tracking.md`. כאן מה ששובר **בשקט**, ולמה.

## הזרימה בשורה

שיחה למספר שלנו ← `?event=incoming` ← `<Dial>` לנייד (מוקלט) ←
`?event=dial` (נענתה? כמה דקות?) ← `?event=recording` ← הורדה, **מחיקה
מ-Twilio**, Whisper, סיכום של Claude ← וואטסאפ ו-CRM.

## 1. חתימת ה-Webhook: כל שיחה נכשלת יחד

כל בקשה מ-Twilio נבדקת מול `TWILIO_AUTH_TOKEN` ו-`PUBLIC_BASE`. טוקן שגוי
או כתובת שונה (‏`supabase.co` מול דומיין אחר) = **403 לכל שיחה**, והמתקשר/ת
שומע/ת "אירעה שגיאת יישום". הלוג `twilio webhook rejected` מדפיס
`account_sid_matches` ו-`matches_req_url` - שם מתחילים. הסודות עוברים `trim()`
כי הדבקה מהקונסול מביאה רווח. **סוד לא נכתב בצ'אט** - רק ב-Supabase Secrets.

## 2. ה-caller ID קובע את המחיר, פי שלושה

Twilio מתמחרת את הרגל לנייד לפי ה-caller ID: ‏**$0.0646** לדקה ממספר
ישראלי, **$0.1868** מכל מספר אחר. ה-`callerId` הוא המתקשר/ת (כדי שהסוכן/ת
יראה מי מתקשר), **חוץ** ממתקשר/ת מחו"ל או חסוי/ה - אז המספר שלנו. מי שמחזיר
`callerId={from}` לכל שיחה משלם פי שלושה על כל שיחה כזו, ואין לזה סימן.

## 3. הזמנה: מחייבים ואז קונים

`lines-available` (מסלול ואז מספר פנוי) ← `confirmPurchase` ← `lines-order`:
‏`order_phone_line` מנכה ופותחת `pending` בטרנזקציה אחת, **אחר כך** קונים
ב-Twilio, ובכישלון `phone_line_order_failed` מחזירה **מה שנגבה בפועל** (במספר
הכלול - אפס). ההפך היה משאיר מספרים קנויים בלי תשלום.

שחרור מוסיף `#released-<id8>` ל-`twilio_number`, כי Twilio עשויה למכור את
המספר שוב - גם לסוכן/ת אחר/ת אצלנו - וה-`unique` היה חוסם.

## 4. `monthly_price is null` = מספר של הפלטפורמה

הפיילוט (04-3761037) ומספר שניתן ביד: לא מחויב, לא מתחדש, לא נספר במסלול,
לא נכנס לתקרת הדקות, ולא משתחרר מה-CRM. **כל שאילתה חדשה על מספרים צריכה
להחליט במפורש** אם היא כוללת אותם.

## 5. המסלול נאכף במסד, והירידה בסבב ולא בטריגר

| מסלול | |
| --- | --- |
| Elite (`premium` + `billing_status` + `active`) | אחד `included`, נוספים 89 ₪ |
| PROFESSIONAL, Pay&GO | אחד, 89 ₪; שני - `tier_required` |

הגייט: `phone_line_included_eligible`. הירידה: `phone_line_tier_sweep()` ב-cron
היומי **לפני** `claim_due_phone_line_renewals` - כי הוא שממיר מספר כלול
לבתשלום. סבב ולא טריגר על `agency_members`: המסלול יורד בחמש דרכים (פקיעה,
מנהל/ת, סוף הטבה, בחירה, סגירה), וטריגר היה תופס חלק. 7 ימים לבחור
(`phone_line_keep_on_downgrade`), אחר כך נשאר הנבחר / הכי הרבה שיחות / הוותיק.

שינוי במה שמסלול כולל הוא שלישייה - גייט, `COMPARE` ב-`pricing.html`,
`docs/pricing-and-tiers.md` (הסקיל `new-tier-capability`).

## 6. תקרת הדקות: השיחה לעולם לא נחסמת

150 דקות שנענו בחודש קלנדרי (שעון ישראל), `ceil` לכל שיחה, לכל מספר. מעבר
לזה 0.5 ₪ לדקה (`charge_call_minutes` מ-`onDial`, אידמפוטנטית לפי
`billed_minutes`). **אין יתרה - השיחה עוברת, בלי הקלטה** (`phone_line_recording_allowed`),
כי לקוח/ה שלא נענה/תה עולה לסוכן/ת יותר מכל דקה. מי שמוסיף `<Hangup/>` במקום
זה מאבד/ת לסוכנים לידים.

העלות לדקה (10.2026): קבלה $0.0107 + נייד $0.0646 + הקלטה $0.0025 + Whisper
$0.006 ≈ ‏31 אגורות; מספר $5.5 לחודש. אחסון ב-Twilio אינו עלות - ההקלטה
נמחקת שם מיד אחרי ההורדה. **שינוי מחיר או תקרה - `pricing_config` במיגרציה**,
ולא בקוד.

## 7. תמלול וסיכום

- **Whisper וקובצי m4a:** ‏`3gp4` ו-brands דומים נדחים - `sniff()` ו-
  `rebrandFtyp()` מתקנים. ניסיון חוזר לא עוזר.
- **שמות מקומות:** ‏`prompt` של Whisper נבנה מהערים והשכונות של הסוכן/ת
  (`agentPlaces`, עד 500 תווים).
- **הסיכום:** structured outputs (`output_config.format`) ולא "החזר JSON".
  גרש כפול בתוך ערך סוגר מחרוזת - הפרומפט מבקש ₪ וגרשיים (״).

## 8. וואטסאפ

כפתורים עד 20 תווים, `id` בצורה `call_N`. מחוץ לחלון 24 השעות - תבנית עם
`urlSuffix`. כל הודעה שיוצאת מכאן נכנסת להיסטוריה של גבריאלה
(`rememberForBot`), אחרת "כן" או לחיצה על כפתור מגיעים אליה בלי הקשר.

## 9. מנהל/ת המשרד קורא/ת הכול - ולכן כל שאילתה מסננת `agent_id`

ה-RLS פותח למנהל/ת את השיחות, המספרים וההקלטות של סוכני המשרד
(`20270222090000_office_calls.sql`). שאילתה בדפדפן שנשענת על ה-RLS לבדו
("השיחות שלי") מחזירה למנהל/ת את **כל המשרד**, בשקט. כל שאילתה על
`agent_calls` או `agent_phone_lines` מהקובץ של הסוכן/ת מסננת
`.eq('agent_id', currentAgent.id)`. תצוגת המשרד (`loadOfficeCalls`) היא
המקום היחיד שלא, והיא קריאה בלבד - בלי ארכוב, מחיקה או הוספה לקובץ.

## בדיקה לפני דחיפה

```sh
python scripts/check_edge_types.py      # deno check על twilio-voice
python scripts/check_function_grants.py
python scripts/check_tier_gates.py
python scripts/check_migration_versions.py
```

ובלי Twilio: כפתור "סימולציית שיחה" ב-CRM (מנהל/ת פלטפורמה) מריץ את כל
הצינור על קובץ שמע.
