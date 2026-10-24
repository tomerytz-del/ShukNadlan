# שוק נדל״ן לטלפון

שלד Android ו-iOS תחת `mobile/`. האתר עצמו לא ארוז לתוך החנות: האפליקציה
טוענת את [https://shuknadlan.co.il](https://shuknadlan.co.il) בתוך WebView,
ומסך "אין רשת" מקומי נשאר בחבילה. שינוי באתר מגיע לאפליקציה בלי גרסה חדשה.

מזהה האפליקציה: `il.co.shuknadlan.app`, היפוך של הדומיין
shuknadlan.co.il. השם shuknadlan.co אינו דומיין ואינו נפתר. האתר, קישורי
העומק, מדיניות הפרטיות וטיוטת החנות מצביעים כולם על
https://shuknadlan.co.il. השם: שוק נדל״ן. כיוון: RTL.

## הפשרה

האתר הוא דפי HTML סטטיים ש-Netlify מפרסם, וחלק גדול מהדפים (שווקים, עסקאות,
שכונות, מחירים, תגיות שיתוף) נבנה ב-Edge Functions. אריזת ה-HTML לתוך
האפליקציה הייתה משאירה אותה על גרסה ישנה בכל מיזוג, וכל שינוי באתר היה
מתנגש עם עץ של Capacitor.

לכן השלד מבודד ב-`mobile/`. מהאתר נגענו רק במה שחייב לעלות איתו:
חסימת `/mobile/` כדי שהקוד לא יוגש, סיווג התיקייה כלא-אתר, קובצי
`.well-known` לקישורים, ופסקה במדיניות הפרטיות. הגשר (`native-bridge.js`)
מוזרק ל-WebView ולא נערך לתוך `crm.js` או לדפי ה-HTML.

המחיר: בלי רשת אין קטלוג, רק מסך שמסביר את זה ומציע לנסות שוב. הנחיה 4.2
של אפל (אפליקציה שהיא אתר עטוף) מכוסה ביכולות נייטיב אמיתיות, אבל הביקורת
נשארת שיפוטית. כניסת Google וקישורים אוניברסליים לא עובדים בפרודקשן עד
שמגדירים אותם בחשבונות, כמפורט למטה.

## מה עובד בלי חשבונות מפתחים

- פתיחה של האתר החי, עם סוכן משתמש `ShukNadlanApp/1.0`.
- מסך פתיחה ואייקון מהמותג (`assets/icon-512.png`), רקע `#0e2a6b`.
- מסך אין-רשת בעברית, וחזרה אחורה ב-Android שלא נופלת ללולאה על מסך האתחול.
- שיתוף מודעה דרך גיליון השיתוף של מערכת ההפעלה (האתר כבר קורא ל-`navigator.share`).
- וואטסאפ, טלפון, מייל ומפות נפתחים באפליקציה שלהם, לא בתוך ה-WebView.
- כניסה במייל וסיסמה נשארת בתוך האפליקציה. כניסת Google נפתחת ב-Chrome
  Custom Tabs / `ASWebAuthenticationSession`, כי גוגל חוסמת WebView
  (`disallowed_useragent`). אחרי האישור הקוד חוזר לכתובת
  `il.co.shuknadlan.app://auth-callback` ונטען מחדש באתר, איפה שמאמת ה-PKCE
  כבר שמור.
- קישורי עומק מוכנים לנתיבים `/property`, `/p/`, `/crm`, `/agent`,
  `/agency`, `/project`, `/n/`, `/deals`, `/articles`, `/prices`, `/brokers`.
- צינור התראות: רישום מכשיר, תור, ושליחה ל-FCM (Android) ול-APNs (iOS).
  בלי מפתחות אין שליחה, והאתר לא נחסם: הטריגרים בולעים כשל.
- סגירת חשבון מתווך/ת שכבר קיימת ב-CRM (תמונת הפרופיל, סגירת החשבון)
  מוחקת גם את אסימוני ההתראות של אותו משתמש. מדיניות הפרטיות:
  [https://shuknadlan.co.il/privacy#delete-account](https://shuknadlan.co.il/privacy#delete-account).
- ‏CI: `.github/workflows/native_apps.yml` בונה APK לדיבוג, AAB, ובניית
  iOS. **לא** לסמן אותו כבדיקת חובה.

## מה מחכה לחשבונות

| דבר | איפה מגדירים |
| --- | --- |
| חתימת Android | סודות ה-keystore למטה. בלי זה ה-AAB לא חתום. |
| ‏Play App Signing | טביעת SHA-256 מחליפה את `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` ב-`.well-known/assetlinks.json`. |
| חשבון Firebase | קובץ `google-services.json` אמיתי במקום הקובץ הממלא בריפו. בלי קובץ בכלל ספריית ההתראות מפילה את האפליקציה בהפעלה, ולכן יושב שם ממלא. |
| ‏APNs | מפתח `.p8` בפורטל של אפל. ‏iOS כאן שולח ישירות ל-APNs, לא דרך FCM. |
| צוות אפל | ‏`TEAMID` במקום המילה `TEAMID` ב-`.well-known/apple-app-site-association`, ויכולת Associated Domains. |
| התראות בפרודקשן | אחרי המיגרציה על `main`, להריץ את workflow `שליחת התראות לאפליקציה`. בלי לוח זמנים התור מחכה. |
| כניסת Google מהאפליקציה | ב-Supabase Auth, ב-Redirect URLs, להוסיף בדיוק `il.co.shuknadlan.app://auth-callback`. |
| חנות | Google Play Console ו-Apple Developer Program. |

קישור מייל עם `#access_token` בסוף הכתובת לא ישרוד כניסה דרך App Link
ב-Android: מערכת ההפעלה מורידה את ה-fragment. כניסה במייל וסיסמה בתוך
האפליקציה, וכניסת Google דרך הסכמה, לא תלויות בזה. קישור אימות שנפתח
בדפדפן ממשיך לעבוד כרגיל.

בעלי חשבון שאינם מתווכים (יזם/ית, בעל/ת מקצוע) מבקשים מחיקה במייל
`shuknadlan@gmail.com`, ככתוב במדיניות. אין להם את אותה סגירה עצמית
שב-CRM של המתווכים.

## הרצה מקומית

```sh
cd mobile
npm ci
python3 scripts/generate_icons.py
npx cap sync
cd android && ./gradlew assembleDebug
```

ה-APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

‏iOS נבנה על Mac, אחרי `npx cap sync ios` (זה גם `pod install`):

```sh
cd mobile/ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO build
```

בדיקות הגשר והחתימות של ההתראות: `cd mobile && npm test`.

אין להגדיר `server.url` ב-`capacitor.config.js`. הגדרה כזו טוענת את האתר
החי ומדלגת על `www/`, ומסך אין-הרשת נעלם.

## סודות ב-GitHub

חתימת Android, ל-`bundleRelease` חתום:

| סוד | מה זה |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | קובץ ה-keystore ב-base64 |
| `ANDROID_KEYSTORE_PASSWORD` | סיסמת הקובץ |
| `ANDROID_KEY_ALIAS` | alias של המפתח |
| `ANDROID_KEY_PASSWORD` | סיסמת המפתח |
| `GOOGLE_SERVICES_JSON` | תוכן `google-services.json` מ-Firebase, כטקסט |

אפל, לארכיון חתום (הבנייה בלי חתימה רצה גם בלעדיהם):

| סוד | מה זה |
| --- | --- |
| `APPLE_TEAM_ID` | מזהה הצוות |
| `APPLE_API_KEY_ID` | מזהה מפתח App Store Connect |
| `APPLE_API_ISSUER_ID` | Issuer של המפתח |
| `APPLE_API_KEY_P8_BASE64` | קובץ ה-`.p8` ב-base64 |

שליחת התראות (`native_push.yml`). בלי הזוג הראשון, או בלי מפתח FCM וגם
בלי מפתח APNs, הסקריפט יוצא בהצלחה:

| סוד | מה זה |
| --- | --- |
| `SUPABASE_URL` | `https://obookujgolazrwycsiyn.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | מפתח service role. לא לשים אותו באפליקציה. |
| `FCM_SERVICE_ACCOUNT_JSON` | JSON של חשבון שירות Firebase (Android) |
| `FCM_PROJECT_ID` | אופציונלי אם המזהה כבר בתוך ה-JSON |
| `APNS_KEY_P8` | תוכן מפתח ההתראות של אפל |
| `APNS_KEY_ID` | מזהה המפתח |
| `APNS_TEAM_ID` | צוות אפל |
| `APNS_BUNDLE_ID` | אופציונלי. ברירת המחדל `il.co.shuknadlan.app` |
| `APNS_PRODUCTION` | `1` לשליחה לשרת הייצור של אפל. בלי זה נשלח ל-sandbox. |

‏`GoogleService-Info.plist` לא נדרש: ב-iOS האסימון הוא APNs והשליחה
ישירה. אם בעתיד עוברים ל-FCM גם ב-iOS, מוסיפים את הקובץ לפרויקט ב-Xcode.

יכולת Push Notifications בפורטל של אפל (`aps-environment`) לא נשמרה
בקובץ ה-entitlements שבריפו, כדי שבנייה בלי פרופיל לא תיכשל. מפעילים
אותה בפורטל יחד עם Associated Domains לפני שליחה ל-TestFlight.

## טיוטה לחנויות

הטקסט כאן הוא מה שהגולש רואה בחנות, ולכן הוא במקף רגיל.

- **שם:** שוק נדל״ן
- **כותרת משנה (אפל):** דירות למכירה ולהשכרה
- **תיאור קצר (עד 80, כאן 69):** לוח נדל״ן בעברית: דירות למכירה ולהשכרה, חיפוש שמור והתראה על נכס חדש.
- **קטגוריה:** אפל Lifestyle. גוגל House & Home.
- **מילות מפתח:** נדלן,דירות,עפולה,תיווך,מכירה,השכרה,מפה,חיפוש,משרד
- **מדיניות פרטיות:** https://shuknadlan.co.il/privacy
- **מחיקת חשבון:** https://shuknadlan.co.il/privacy#delete-account

**תיאור מלא:**

שוק נדל״ן הוא לוח הנדל״ן בעברית. מחפשים דירה למכירה או להשכרה, שומרים חיפוש ומקבלים עדכון כשעולה נכס שמתאים, ופונים למתווך בוואטסאפ או בשיחה.

באפליקציה: דפדוף בנכסים ובמפה, שיתוף מודעה, פתיחת וואטסאפ ושיחה באפליקציות של הטלפון, והתראות על פנייה חדשה למתווכים ועל נכס חדש לחיפוש שמור.

החשבון של מתווך או מתווכת נסגר מתוך האפליקציה (תמונת הפרופיל, ואז סגירת החשבון). בקשת מחיקה אחרת נשלחת אל shuknadlan@gmail.com. מדיניות הפרטיות: https://shuknadlan.co.il/privacy

### Data safety / תווית הפרטיות

לפי מה שהאתר והאפליקציה באמת אוספים (`privacy.html`):

| נתון | מתי | נשמר אצלנו? |
| --- | --- | --- |
| שם, טלפון, אימייל | טפסים וחשבון | כן, כמתואר במדיניות |
| אסימון התראה ומזהה מכשיר | אחרי אישור להתראות | כן, ב-`app_push_devices`, עד סגירת החשבון או כיבוי |
| מיקום | רק בלחיצה על "קרוב אלי" | לא בשרת |
| מזהי פרסום / אנליטיקה | ‏GA4 ופיקסל של Meta דרך GTM, כמו באתר | אצל גוגל ומטא, לא כרשומת לקוח אצלנו |
| כרטיס אשראי | תשלום באתר | לא. הפרטים לא עוברים דרך האפליקציה |
| תמונות וקבצים | העלאה ב-CRM, אם המשתמש בוחר | כמו באתר |

לא מסומן מעקב בין אפליקציות מעבר למה שהאתר כבר עושה עם GTM. אין מכירת
מידע. ההתראות אינן חובה כדי לדפדף.

## האתר לא נשבר

`mobile/` חסום ב-`_redirects` (`404!`) ומסווג כלא-אתר ב-
`scripts/netlify_ignore.sh`, כך שקומיט שנוגע רק באפליקציה לא מדליק
דיפלוי. `.well-known` הוא אתר, כי בלי הקבצים שם הקישורים האוניברסליים
לא מאומתים. מיזוג שכולל גם את `privacy.html` או את `_redirects` כן
מפרסם את האתר - פעם אחת.
