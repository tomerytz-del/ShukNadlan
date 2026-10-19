---
name: email-intake
description: עבודה על קליטה מהמייל בריפו של שוק נדל״ן - מייל שסוכן/ת שולח/ת או מעביר/ה ל-shuknadlan@gmail.com (זיהוי לפי שולח שגוגל אימת) או ל-shuknadlan+<token>@gmail.com, וגבריאלה מזהה מי שלח ומה צריך ועונה בוואטסאפ. email-intake.ts, ‏_shared/imap.ts, ‏EMAIL_TOOLS, ‏verifiedSender, ‏readAttachments (קבצים מצורפים - PDF, ‏Word, ‏Excel, תמונות, הקלטות), הסמן email_intake_cursor, היומן email_intake_messages, וחלון 24 השעות. Use when touching supabase/functions/whatsapp-webhook/email-intake.ts or _shared/imap.ts, adding a tool the email turn may use, changing how the sender is identified, when an agent says Gabriela did not answer a forwarded email, when an attachment was not read, when an email row is stuck in processing or failed with "fetch", or when the +costs receipts path changes.
---

# קליטה מהמייל

סוכן/ת מעביר/ה מייל, גבריאלה קוראת אותו (כולל הקבצים המצורפים), מזהה לקוח/ה
או נכס, ועונה **בוואטסאפ בלבד**. התיעוד המלא: `docs/email-intake.md`.

| קובץ | מה |
| --- | --- |
| `supabase/functions/whatsapp-webhook/email-intake.ts` | הסבב, הזיהוי, ה-claim, הפריסה, הקבצים, התור והמשלוח |
| `supabase/functions/_shared/imap.ts` | לקוח IMAP, קריאה בלבד |
| `supabase/functions/whatsapp-webhook/media-intake.ts` | המחלצים של הקבצים - **משותפים עם קובץ שנשלח בוואטסאפ** |
| `supabase/functions/whatsapp-webhook/cost-mail.ts` | קבלות ל-`+costs` (‏`docs/platform-costs.md`) |

## מה נשבר בשקט

1. **‏`EMAIL_TOOLS` היא רשימה סגורה, ונאכפת גם בלולאה.** מייל מועבר וקבציו
   נכתבו בידי אחרים, וכל משפט בהם יכול להישמע כמו הוראה. כלי שמפרסם (פתיחת
   נכס, עדכון נכס, הסכם, שיתוף) **לא נכנס לרשימה** - העוזר מסכם ושואל, וה"כן"
   מגיע בוואטסאפ בתור רגיל. הוספת כלי כתיבה כאן היא הזרקה, לא פיצ'ר.

2. **זיהוי לפי שולח רק דרך `verifiedSender`.** ‏`From` הוא טקסט חופשי. מה שהופך
   אותו לזהות הוא `dmarc=pass`/`dkim=pass` על הדומיין שלו, ו**רק בכותרת
   `Authentication-Results` העליונה** - כותרת נמוכה יותר יכולה להיות של השולח.
   כתובת של יותר מסוכן/ת אחד/ת אינה מזוהה.

3. **תוכן קובץ עטוף ב-`safe()`.** סוגריים מרובעים בתוכן הופכים לעגולים, כדי
   ששורה בקובץ לא תיראה כמו `[סוף הקובץ]` ו"הוראה" אחריה. כל עטיפה חדשה עוברת
   דרכו.

4. **המחלצים משותפים.** שינוי ב-`documentToText` / `transcribeMedia` /
   `docKind` משנה את המייל ואת הוואטסאפ יחד. הנוסח של `r.reply` מוצג לעוזר
   גם במייל ("לא נקרא: ...") - לנסח אותו כך שיתאים לשני הערוצים.
   וכך גם הייבוא: קובץ נכסים מצורף עובר ב-`prepareImportJob`
   (‏`property-import.ts`). הבלוק `[ייבוא נכסים]` אינו עובר `safe` - הוא נבנה
   בקוד, ומה שבא מהקובץ בתוכו עובר `clip` - ונכנס **לראש** ההיסטוריה (אחרת
   החיתוך ל-`HISTORY_CHARS` חותך את ה-`job_id`). ‏`import_properties_file`
   אינו ב-`EMAIL_TOOLS`: הקליטה רק אחרי "כן" בוואטסאפ.

5. **קריאת קבצים רק אחרי הגייטים** (פעיל, מספר וואטסאפ, מסלול, חיוב, תקרה
   יומית). PDF הוא קריאה ל-Claude והקלטה היא Whisper - לפני הגייט זה כסף
   על מי שאינו זכאי/ת.

6. **לחיבור ה-IMAP יש תקרה של 60 שניות, ומייל שה-fetch שלו נופל אחריה
   מסומן `failed` ואינו חוזר** (ה-claim מונע טיפול כפול, ולכן גם ניסיון
   חוזר). לכן `RUN_BUDGET_MS` (35 שניות) עוצר התחלה של מייל חדש והסמן
   נעצר לפניו. שינוי שמאריך תור (עוד קבצים, מודל איטי) - לבדוק מולו.

7. **‏`readBytes` לא דרך `fill`.** `fill` מעתיק את כל המאגר בכל 16KB; זה טוב
   לשורות, וריבועי בליטרל של 20MB. מי שנוגע בקריאה מהשקע שומר על זה.

8. **‏`+costs` לפני כל זיהוי של סוכן/ת**, ועל משיכה של 2MB
   (`COSTS_FETCH_BYTES`) - קבלה נקראת מהטקסט, ומנהל/ת שמעביר/ה קבלה הוא/היא
   גם סוכן/ת רשום/ה. בלי הסדר הזה הקבלה הופכת לתור של העוזר.
   **והקבלה נקראת מהטקסט וגם מה-HTML** (‏`receiptText(mail.text,
   mail.htmlText)`): הסוכן של תומר מעביר קבלות עם חלק טקסט שהוא רק כותרת
   (‏`מקור: <ספק>`) והקבלה כולה ב-HTML, ו-`parseMail` מעדיף את חלק הטקסט.
   מי שנוגע ב-`parseMail` שומר על `htmlText`; מי שמוסיף צורת כותרת העברה -
   ב-`forwardedSender`, עם שורה ב-`scripts/cost_mail_test.ts`.

9. **ההנחיות בטקסט התור (`buildEmailPrompt`) ולא ב-`SYSTEM_STATIC`** - אחרת
   המטמון של כל התורים הרגילים נשבר בגלל ערוץ שרובם אינם שייכים לו.

10. **שום דבר לא יוצא במייל.** תשובה אוטומטית לכתובת שמגיעים ממנה מיילים
    אוטומטיים היא לולאה. מחוץ לחלון 24 השעות - תבנית ההתראות.

11. **גבריאלה צריכה לדעת שיש לה מייל - וזה כן ב-`SYSTEM_STATIC`.** בלי השורה
    "יש לך מייל: shuknadlan@gmail.com" המודל ענה לסוכן ששאל "מה המייל שלך":
    "אין לי מייל, אני קיימת רק בוואטסאפ" (12.10.2026). זה אינו סותר את סעיף 9:
    סעיף 9 הוא על ההנחיות **לתור של מייל**, וזו שורה סטטית שעונה בתור רגיל.
    מי שמשנה את הכתובת, את שם הכרטיס ב-CRM ("העברת מיילים לגבריאלה") או את
    הדרך לקבל כתובת אישית - מעדכן גם אותה.

## תחקור

```sql
select created_at, agent_id, via, from_addr, subject, status, left(detail, 200)
  from email_intake_messages order by id desc limit 20;
select * from email_intake_cursor;
```

שורה שנשארה `processing` - סבב שנקטע; הסוכן/ת מעביר/ה את המייל שוב. מייל
שלא הגיע בכלל ליומן - לבדוק שהשולח מאומת ורשום, או שהוא בספאם של התיבה
(הקריאה מ-INBOX בלבד).

## בדיקה לפני דחיפה

אין בדיקת CI ייעודית. לבנות מייל MIME עם קבצים (CSV, תמונה מעל ומתחת ל-15KB,
‏`.doc` ישן, ‏message/rfc822) ולהריץ `parseMail` → `readAttachments` →
`buildEmailPrompt` ב-Deno עם `--no-check`; ול-`imap.ts` - שקע מדומה שמחזיר
חתיכות בגודל לא עגול. ‏PDF והקלטה דורשים מפתחות - נבדקים אחרי הפריסה
במייל אמיתי.
