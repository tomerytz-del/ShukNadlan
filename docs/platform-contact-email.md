# כתובת הקשר של הפלטפורמה, ואיך המייל יוצא ממנה

**‏shuknadlan@gmail.com** היא התיבה של "שוק הנדל״ן של עפולה והסביבה". כל מקום
שבו הפלטפורמה מזמינה אדם לפנות אליה — בפוטר, בקוד האתי, בטופסי ההרשמה — מצביע
לכתובת הזו, וכל מייל שיוצא מהמערכת נשלח **ממנה**.

## למה זה לא היה טריוויאלי

ספק מייל חיצוני (Resend, SendGrid וכל השאר) חותם על ההודעה בשם הדומיין **שלו**.
הודעה שמצהירה `From: …@gmail.com` אבל נחתמה ב-resend.com נכשלת ביישור SPF/DKIM
מול gmail.com — ו-Resend בכלל לא מאפשר להגדיר כשולח דומיין שאינו שלך.

הדרך היחידה לשלוח באמת מהכתובת היא **לשלוח דרך השרתים של Google**: ‏SMTP של
Gmail, עם סיסמת אפליקציה. אז Google הוא שחותם, ה-From הוא הכתובת האמיתית,
וההודעה עוברת אימות אצל הנמען.

## איך זה בנוי

```
      owner-lead-intake ─┐
   mortgage-lead-intake ─┤
    saved-search-intake ─┼──▶  platform-mail  ──▶  ① Gmail SMTP  (smtp.gmail.com:465)
    saved-search-notify ─┤     (Edge Function)     ② Resend       (רשת ביטחון)
        add-team-member ─┘
```

`platform-mail` היא **הפונקציה היחידה** שמכירה את סיסמת האפליקציה ואת מפתח
Resend. עד היום כל פונקציה ששלחה מייל החזיקה עותק משלה של קוד המשלוח — חמישה
עותקים, כלומר כל שינוי במשלוח הוא חמש פריסות ואחת מהן תישכח. עכשיו יש נקודה
אחת, וחמישה קוראים דרך `_shared/platform-mail-client.ts`.

**סדר המסלולים:**

1. **Gmail SMTP** — כשמוגדרים `GMAIL_USER` ו-`GMAIL_APP_PASSWORD`. ‏From הוא
   `שוק הנדל״ן של עפולה והסביבה <shuknadlan@gmail.com>`.
2. **Resend** — אם ה-SMTP נופל (סיסמה שבוטלה, מכסה יומית, תקלה אצל Google).
   יוצא מהשולח המאומת עם `reply_to` לתיבת הפלטפורמה. עדיף מייל מכתובת פחות
   נכונה מאשר התראה שנעלמת.

`platform-mail` אינה פתוחה: שליחה בשם הפלטפורמה למי שמבקש היא ממסר פתוח. הקורא
חייב את מפתח ה-service_role של הפרויקט (או `PLATFORM_MAIL_SECRET`). ה-anon key
אינו מספיק — הוא יושב בדפדפן של כל גולש.

## ההגדרה בפועל — צעד אחר צעד

### ‏1. אימות דו-שלבי בחשבון shuknadlan@gmail.com

בלעדיו Google לא מציג בכלל את מסך סיסמאות האפליקציה.

* היכנסו לחשבון → [myaccount.google.com/security](https://myaccount.google.com/security)
* **אימות דו-שלבי (2-Step Verification)** → הפעלה, לפי ההוראות במסך.

### ‏2. יצירת סיסמת אפליקציה

* [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
* שם האפליקציה: `shuknadlan-platform` (השם הוא רק תווית — אפשר כל דבר).
* Google מציג **16 תווים בארבע רביעיות מופרדות ברווח**. זו הפעם היחידה שהיא
  מוצגת.

זו אינה הסיסמה של החשבון, והיא מוגבלת לשליחת מייל בלבד. אפשר לבטל אותה בכל רגע
מאותו מסך, ואז המערכת נופלת חזרה ל-Resend.

### ‏3. הזנת שני משתני סביבה ב-Supabase

‏Dashboard → הפרויקט → **Edge Functions → Secrets** → Add new secret:

| שם | ערך |
| --- | --- |
| `GMAIL_USER` | `shuknadlan@gmail.com` |
| `GMAIL_APP_PASSWORD` | 16 התווים מהשלב הקודם |

הרווחים אינם מפריעים — הקוד מסיר אותם. זו התקלה הנפוצה ביותר בהגדרה הזו: מי
שמעתיק את הסיסמה כפי שהיא מקבל 19 תווים במקום 16, ו-Gmail דוחה עם
"Username and Password not accepted" — שגיאה שנראית כמו סיסמה שגויה ואינה כזו.

**אין צורך לפרוס מחדש.** משתני סביבה נקראים בהרצה הבאה של הפונקציה.

### ‏4. בדיקה

קריאה ל-`platform-mail` עם מפתח ה-service_role מחזירה `{"sent":true,"via":"gmail"}`
כשהמסלול עובד, ו-`"via":"resend"` כשהוא נפל ל-רשת הביטחון.

## משתני הסביבה

| משתנה | חובה? | מה הוא עושה |
| --- | --- | --- |
| `GMAIL_USER` | למסלול Gmail | חשבון השליחה. גם ברירת המחדל של כתובת הקשר |
| `GMAIL_APP_PASSWORD` | למסלול Gmail | סיסמת אפליקציה בת 16 תווים |
| `PLATFORM_FROM_NAME` | ⬜ | שם התצוגה. ברירת מחדל: שוק הנדל״ן של עפולה והסביבה |
| `PLATFORM_CONTACT_EMAIL` | ⬜ | הכתובת שמופיעה **בגוף** ההודעות. ברירת מחדל: `GMAIL_USER` |
| `RESEND_API_KEY` + `ALERTS_FROM_EMAIL` | ⬜ | רשת הביטחון. בלעדיהם יש רק מסלול אחד |
| `PLATFORM_MAIL_SECRET` | ⬜ | דרך קריאה נוספת ל-`platform-mail`, מלבד ה-service_role |

## מכסות Gmail — הגבול שכן קיים

חשבון Gmail רגיל מוגבל ל-**500 נמענים ביום** ול-100 נמענים להודעה. בנפח הנוכחי
זה רחוק מאוד, אבל זו הסיבה ש-`platform-mail` גוזרת `to` ל-40, וזו הנקודה שבה
כדאי יהיה לעבור לדומיין מאומת: ביום שבו התראות הסוכן החכם יוצאות למאות
מחפשי דירה, המכסה תיגמר לפני שהתור יתרוקן — והמערכת תתחיל ליפול ל-Resend
בשקט. ‏`via` בתשובה הוא מה שמגלה את זה.

## איפה הכתובת מופיעה

### באתר

| מקום | מה יש שם |
| --- | --- |
| פוטר `index.html`, `agencies.html`, `articles.html`, `article.html`, `ethics-code.html` | קישור "צור קשר" |
| `index.html` — ‏JSON-LD מסוג `Organization` | `email` + `contactPoint.email`, כדי שגוגל יציג את הכתובת בכרטיס הידע |
| `article.html` — ‏JSON-LD, `publisher` | `email` של המוציא לאור |
| `ethics-code.html` | דיווח על הפרת הקוד האתי |
| `agency-signup.html` | תקלה בהרשמת משרד — מי שנכשל/ה נשאר/ת בלי חשבון וללא דרך אחרת לספר |
| `professional-signup.html`, `professional-manage.html` | שחזור קישור העריכה, שאין לו חלופה |
| `crm.html` — `SUPPORT_EMAIL` | תיבת התמיכה של מסכי הניהול |

### במיילים היוצאים

| פונקציה | ההודעה |
| --- | --- |
| `_shared/lead-routing.ts` | התראת "ליד ללא יעד" למנהל/ת הפלטפורמה |
| `saved-search-notify` | התראת נכס חדש למחפש/ת דירה |
| `add-team-member` | הזמנת סוכן/ת לצוות |

## פריסה

`_shared/platform-mail-client.ts` ו-`_shared/lead-routing.ts` **נצרבים לתוך כל
פונקציה שמייבאת אותם** — הייבוא יחסי, ואין רישום מרכזי. לכן שינוי בהם מחייב
פריסה מחדש של כל הקוראים:

```
supabase functions deploy platform-mail
supabase functions deploy owner-lead-intake mortgage-lead-intake saved-search-intake
supabase functions deploy saved-search-notify add-team-member
```

שינוי ב-`platform-mail` עצמה — לרבות החלפת ספק המשלוח — הוא פריסה אחת. זו כל
הנקודה.

## מה לא שונה, ובכוונה

`agency_members.email` של מנהל/ת הפלטפורמה נשאר החשבון האישי. זו כתובת
ההתחברות והזהות כסוכן/ת בתוך המערכת, ולא כתובת הקשר של הפלטפורמה; שינוי שלה
היה מנתק את החשבון מעצמו. ההתראות למנהל/ת ממשיכות להגיע אליה, וזה נכון —
היא הנמענת, לא השולחת.
