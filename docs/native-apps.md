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
  כפתור "אימות בוואטסאפ" הוא `https://wa.me` עם `target="_blank"`, וגם
  `window.open` אחרי קריאה אסינכרונית. ב-WebView של Android ניווט כזה לא
  מגיע ל-`shouldOverrideUrlLoading` ונזרק, והדף נשאר במקום בלי לפתוח כלום.
  השלד תופס את החלון, פותח `whatsapp://send` (ביזנס אם הקישור ביקש
  `com.whatsapp.w4b`, אחרת הרגיל), ואם אין וואטסאפ - את הדפדפן או את החנות.
  ה-WebView לא מוחלף, והמסך ממשיך לבדוק שההודעה הגיעה. אותו מסלול ל-`tel:`.
  ב-iOS הסכמה `whatsapp` רשומה ב-`LSApplicationQueriesSchemes`.
- כניסה במייל וסיסמה נשארת בתוך האפליקציה. כניסת Google נפתחת ב-Chrome
  Custom Tabs / `ASWebAuthenticationSession`, כי גוגל חוסמת WebView
  (`disallowed_useragent`). האתר עצמו משתמש ב-flow מסוג implicit (בלי
  `code_challenge`), והאסימונים חוזרים ב-fragment. Android מוריד fragment
  מ-Intent, והדף שממנו יצאו לא נטען מחדש - לכן הכפתור נשאר על
  "מעבירים ל-Google…". השלד מוסיף PKCE בעצמו, מחליף את ה-`code` באסימונים,
  וטוען את הדף עם `#access_token` שהלקוח הקיים באתר כבר קורא. ביטול או כשל
  טוענים את אותו דף עם `error`, ומאפסים את הכפתור עם הסבר בעברית.
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
| כניסת Google מהאפליקציה | ב-Supabase Auth, ב-Redirect URLs, להוסיף בדיוק `il.co.shuknadlan.app://auth-callback`. בלי השורה הזו GoTrue מחזיר ל-Site URL וה-`code` נשאר בדפדפן, לא ב-WebView. |
| חנות | Google Play Console ו-Apple Developer Program. |

קישור מייל עם `#access_token` בסוף הכתובת לא ישרוד כניסה דרך App Link
ב-Android: מערכת ההפעלה מורידה את ה-fragment. כניסה במייל וסיסמה בתוך
האפליקציה לא תלויה בזה. כניסת Google כן הייתה תלויה ב-fragment, ולכן
השלד מחליף אותה ב-PKCE לפני שה-Intent נוצר. קישור אימות שנפתח בדפדפן
ממשיך לעבוד כרגיל.

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
| מיקום | רק אחרי לחיצה על "הפעלה", או על "קרוב אלי" / "אתרו את האזור שלי". משוער, במכשיר, לבחירת האזור | לא בשרת |
| מזהי פרסום / אנליטיקה | ‏GA4 ופיקסל של Meta דרך GTM, כמו באתר. ב-iOS רק אחרי אישור מעקב, ב-Android רק אם המשתמש לא ביטל | אצל גוגל ומטא, לא כרשומת לקוח אצלנו. האפליקציה לא שולחת את מזהה הפרסום עצמו, רק `true`/`false` |
| כרטיס אשראי | תשלום באתר | לא. הפרטים לא עוברים דרך האפליקציה |
| תמונות וקבצים | העלאה ב-CRM, אם המשתמש בוחר | כמו באתר |

לא מסומן מעקב בין אפליקציות מעבר למה שהאתר כבר עושה עם GTM. אין מכירת
מידע. ההתראות אינן חובה כדי לדפדף.

## תשלומים בתוך האפליקציה

בחנות אסור למכור מנוי, ליד או קידום דרך אתר חיצוני (Apple 3.1.1, ומדיניות
התשלומים של Play). לכן **רק בתוך האפליקציה** (סוכן המשתמש `ShukNadlanApp`,
או הגשר שמוזרק ל-WebView) מוסתרים:

- `/pricing` ו-`/checkout`, כולל הסיומת `.html`
- קישורים לעמודי הסליקה של מורנינג (`greeninvoice.co.il`, `morning.co`, `morning.dev`)
- טעינת ארנק, שדרוג מסלול, רכישת ליד וקידום בתשלום

במקומם מופיע המשפט **ניהול המנוי מתבצע באתר**, בלי קישור ובלי כפתור קנייה.
הקפצה חינמית, פתיחת ליד בלי חיוב, ומסלול שכבר פעיל נשארים. בדפדפן אין את
הגשר, ודפי התשלום נשארים כמו שהיו.

ניווט לכתובת רכישה נעצר גם בשכבה הנייטיב, כדי שחלון תשלום לא ייפתח בכרום
אם האתר ינווט אליו ישירות.

## התחברות עם Apple

הכפתור "התחברות עם Apple" יושב ב-`assets/apple-signin.js` ונטען בדפי
הכניסה (`crm`, `developer-crm`, `developer-signup`, `csm`). הוא **כבוי**:

```js
window.SHUK_APPLE_SIGNIN = false;
```

כל עוד השורה הזו false, הסקריפט לא מוסיף כפתור ולא נוגע בטופס. אחרי
שהחשבון של אפל והספק ב-Supabase עובדים, משנים ל-`true`. באפליקציה אותו
כפתור עובר במסלול PKCE שכבר קיים ל-Google: `ASWebAuthenticationSession`
ב-iOS ו-Chrome Custom Tabs ב-Android, והחזרה ל-`il.co.shuknadlan.app://auth-callback`.

המפתחות `APPLE_API_KEY_*` בטבלה למעלה הם מפתח API של App Store Connect
לבניית החנות. **הם לא** מפתח Sign in with Apple. צריך מפתח נפרד.

### מה בעל החשבון מגדיר, אחרי שיש Apple Developer Program

1. **App ID** `il.co.shuknadlan.app` עם היכולת Sign in with Apple.
2. **Services ID** (מזהה נפרד, למשל `il.co.shuknadlan.signin`). בתוכו:
   - Primary App ID: `il.co.shuknadlan.app`
   - Domain: `obookujgolazrwycsiyn.supabase.co`
   - Return URL, במדויק: `https://obookujgolazrwycsiyn.supabase.co/auth/v1/callback`
3. **Key** מסוג Sign in with Apple. מורידים את קובץ ה-`.p8` פעם אחת (אפל
   לא נותנת להוריד שוב), ורושמים את **Key ID**.
4. **Team ID** ממסך Membership.
5. ב-Supabase: Authentication, Providers, Apple. מפעילים וממלאים:
   - Client IDs: ה-Services ID מהסעיף 2 (אם מוסיפים אחר כך כניסה נייטיב
     ישירה, גם את `il.co.shuknadlan.app`)
   - Secret Key: ה-JWT ש-Supabase בונה מ-Team ID, Key ID, Services ID
     וקובץ ה-`.p8`. תוקף הסוד הזה הוא שישה חודשים, ואז מפיקים חדש.
6. ב-Supabase, Redirect URLs, לוודא שקיימות:
   - `il.co.shuknadlan.app://auth-callback` (כבר נדרש ל-Google)
   - `https://shuknadlan.co.il/crm`
   - `https://shuknadlan.co.il/developer-crm`
   - `https://shuknadlan.co.il/csm`
7. רק אחרי כניסה מוצלחת בדפדפן: `window.SHUK_APPLE_SIGNIN = true`
   ב-`assets/apple-signin.js`.

## מעקב ומדידה (הפיקסל נשאר)

הפיקסל של Meta ו-GTM **לא** משתנים כאן. מי שסוגר את הפיקסל לפי האישור
עושה את זה ב-GTM, על האות שהאפליקציה דוחפת.

ב-iOS מוצגת בקשת App Tracking Transparency
(`NSUserTrackingUsageDescription` בעברית). ב-Android הקריאה היא רק לדגל
ה-opt-out של מזהה הפרסום (`isLimitAdTrackingEnabled`), לא למזהה עצמו.
אם הקריאה נכשלת, ב-Android מניחים שהמעקב מותר.

### החוזה כלפי הדף

האובייקט קיים רק בתוך האפליקציה, מרגע שהגשר רץ (תחילת המסמך):

```js
window.ShukNadlanApp.trackingAllowed
```

| ערך | מתי |
| --- | --- |
| `undefined` | עוד אין תשובה (לפני שהמשתמש ענה ב-iOS, או לפני שהבדיקה ב-Android חזרה) |
| `true` | iOS: Authorized. Android: המשתמש לא ביטל מעקב פרסומי |
| `false` | iOS: Denied או Restricted. Android: המשתמש ביטל מעקב פרסומי |

כשהערך הופך ל-`true` או ל-`false` (לא כשהוא עדיין `undefined`) קורים שני
דברים, פעם אחת לכל טעינת מסמך:

```js
window.dispatchEvent(new CustomEvent('shuknadlan:tracking', {
  detail: { trackingAllowed: true } // או false
}));

window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'app_tracking_status',
  tracking_allowed: true // או false, בוליאני
});
```

`dataLayer` נשמר גם אם GTM עוד לא נטען. האירוע יכול להגיע **אחרי**
ש-GTM כבר רץ, ולכן הטריגר ב-GTM צריך להאזין ל-`app_tracking_status` ולא
להניח שהערך קיים ב-`gtm.js`. בדפדפן אין `window.ShukNadlanApp`, ואין
דחיפה של האירוע.

אפשר גם לקרוא ידנית, אחרי שהגשר עלה:

```js
window.ShukNadlanApp.setTrackingAllowed(true);
```

השכבה הנייטיב קוראת לזה בעצמה. אין לקרוא לזה מדף כדי לזייף אישור.

## תיקוני חנות נוספים

- רצועת "הוספה למסך הבית" לא עולה בתוך האפליקציה (`assets/pwa-install.js`).
- ב-iOS יש הסברי שימוש בעברית למיקרופון ולזיהוי דיבור (חיפוש קולי),
  למצלמה ולבחירת תמונות (העלאה), ולבקשת המעקב.
- ב-Android מבוקש רק מיקום משוער (`ACCESS_COARSE_LOCATION`). מיקום מדויק הוסר.
  ב-iOS הבקשה היא בזמן השימוש, וברירת הדיוק היא משוערת
  (`NSLocationDefaultAccuracyReduced`).

## בחירת אזור לפי מיקום

בפתיחה הראשונה של האפליקציה עולה מסך מלא: "באיזה אזור אתם מחפשים?",
כפתור "הפעלה", ומתחתיו תמיד "אולי אחר כך". ההסבר "איך אתם משתמשים במיקום
שלי?" נפתח בלחיצה ומקשר למדיניות הפרטיות. המסך הוא שכבה של הגשר
(`native-bridge.js`), ולכן הוא מופיע רק ב-WebView. בדפדפן אין גשר ואין מסך.

ההרשאה של מערכת ההפעלה נבקשת רק אחרי "הפעלה". דילוג, סירוב, או נקודה
שמחוץ לכל שוק חי משאירים את עפולה והעמק, והמסך לא עולה שוב מעצמו. בחירה
נזכרת במכשיר (`localStorage`, המפתח `shuk_loc_onboard`).

אחרי אישור, אותה `ShukMarkets.locate` של האתר רצה עם שווקים חיים בלבד
(`onlyLive`). שוק חי נשמר כמו בחירה מהאתר: `CityContext.choose(m, 'gps')`,
עוגיית `shuk_market`, ואם הדף הנוכחי הוא דף שוק אחר - מעבר לכתובת שלו.
מחוץ לשוק חי לא נכתבת עוגייה של שוק "בקרוב", ופס "נפתחים בקרוב" לא עולה
בגלל המסך הזה. "אתרו את האזור שלי" בבורר האזור פותח את אותו מסך שוב.

## האתר לא נשבר

`mobile/` חסום ב-`_redirects` (`404!`) ומסווג כלא-אתר ב-
`scripts/netlify_ignore.sh`, כך שקומיט שנוגע רק באפליקציה לא מדליק
דיפלוי. `.well-known` הוא אתר, כי בלי הקבצים שם הקישורים האוניברסליים
לא מאומתים. מיזוג שכולל גם את `privacy.html` או את `_redirects` כן
מפרסם את האתר - פעם אחת.
