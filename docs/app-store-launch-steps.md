# העלאת האפליקציה לחנויות - המשימות של תומר, לפי הסדר

עודכן: 5.11.2026. הקוד מוכן (‏`docs/native-apps.md`, ‏`docs/account-closure.md`).
מה שנשאר כאן הוא מה שרק בעל החשבונות יכול לעשות: לפתוח חשבונות, ליצור מפתחות,
להכניס סודות ולמלא את טפסי החנויות.

**איך לקרוא:** כל שלב אומר מה עושים, איפה (קישור), ומה מוסרים לקלוד בסוף - כשיש
דבר כזה. שלבים 1 ו-2 לוקחים ימים בצד של גוגל ואפל, ולכן מתחילים בהם **היום**,
במקביל לכל השאר.

> **כלל ברזל לכל המסמך:** מפתחות, סיסמאות, קובצי `.p8`, ‏`.jks` ו-JSON של
> חשבונות שירות - **לעולם לא** בצ'אט, לא במייל ולא בריפו. הם נכנסים רק לסודות
> של GitHub או של Supabase, ובעותק מוצפן אצלך.

---

## שלב 0 - לאשר ולמזג את הקוד (5 דקות)

1. לבקש מקלוד לפתוח PR מהענף `claude/magical-archimedes-nnlns8`.
2. לוודא שהבדיקות ב-PR ירוקות, ולמזג.
3. אחרי המיזוג: מבט אחד ב-[Actions](https://github.com/tomerytz-del/ShukNadlan/actions) -
   ה-workflow של המיגרציות ושל פריסת פונקציות Supabase צריכים להיות ירוקים.
   אדום שם הוא תקלה בפרודקשן, ולא רעש.
4. בדיקה: [https://shuknadlan.co.il/delete-account](https://shuknadlan.co.il/delete-account) נפתח.

---

## שלב 1 - חשבון Google Play (מתחילים היום, לוקח כמה ימים)

1. נכנסים ל-[Play Console](https://play.google.com/console) עם `tomerytz@gmail.com`.
2. מסיימים את **אימות הזהות** (תעודה מזהה) ואת **אימות הטלפון והכתובת**, אם עוד
   מופיע "בהמתנה". ההסבר של גוגל:
   [אימות חשבון מפתח](https://support.google.com/googleplay/android-developer/answer/10841920).
3. **שימו לב:** בחשבון אישי חדש גוגל מחייבת **בדיקה סגורה עם 12 בודקים לפחות
   במשך 14 יום רצופים** לפני שמותר לפרסם לכולם
   ([ההסבר](https://support.google.com/googleplay/android-developer/answer/14151465)).
   כבר עכשיו כדאי להתחיל לאסוף 12 כתובות Gmail של אנשים שיתקינו ויפתחו את
   האפליקציה - יועצי נדל״ן מהמשרדים, משפחה, חברים. נוסח ההזמנה מתואם עם גבריאלה.

## שלב 2 - חשבון Apple Developer (מתחילים היום, לוקח ימים עד שבועיים)

1. החלטה אחת לפני הכול: **בשם מי החשבון.**
   - **אישי** - מהיר, אבל בחנות יופיע השם הפרטי שלך כמוכר.
   - **ארגוני** (חברה) - בחנות יופיע "שוק נדל״ן", אבל צריך מספר D-U-N-S לחברה.
     בודקים או מבקשים כאן: [D-U-N-S של אפל](https://developer.apple.com/enroll/duns-lookup/)
     (בחינם, עד כשבוע).
2. נרשמים: [Apple Developer Program](https://developer.apple.com/programs/enroll/)
   (‏99$ לשנה). עדיף מהאפליקציה Apple Developer באייפון - מהיר יותר.
3. מחכים לאישור במייל. **שלב 8 מחכה לזה.**

---

## שלב 3 - מפתח החתימה של Android (הכי חשוב לא לאבד)

זה הקובץ שמוכיח לגוגל שכל עדכון עתידי בא ממך. בלי Play App Signing אובדן שלו
אומר שאי אפשר לעדכן את האפליקציה לעולם. איתו - אפשר לבקש איפוס, אבל זה לוקח זמן.

1. במחשב שיש בו Java (ב-Mac: `brew install openjdk`, או להתקין את Android Studio),
   בטרמינל:

   ```bash
   keytool -genkeypair -v -keystore shuknadlan-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```

   הוא ישאל סיסמה (פעמיים) ופרטים (שם, ארגון, עיר - אפשר "Shuk Nadlan", ‏"Afula", ‏"IL").
   **סיסמה ארוכה, ולשמור אותה במנהל סיסמאות.**
2. שומרים את `shuknadlan-upload.jks` בשלושה מקומות: מנהל הסיסמאות (כקובץ מצורף),
   תיקייה מוצפנת ב-Google Drive, ו-USB במגירה. **לא** בריפו ולא במייל.
3. ממירים ל-base64 בשביל GitHub:

   ```bash
   base64 -i shuknadlan-upload.jks | pbcopy
   ```

   (ב-Windows: `certutil -encode shuknadlan-upload.jks out.txt` ומעתיקים את התוכן בלי שורות BEGIN/END.)
4. נכנסים ל-[GitHub Secrets](https://github.com/tomerytz-del/ShukNadlan/settings/secrets/actions)
   ← **New repository secret**, ומוסיפים ארבעה:

   | שם | ערך |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | מה שהועתק בסעיף 3 |
   | `ANDROID_KEYSTORE_PASSWORD` | הסיסמה של הקובץ |
   | `ANDROID_KEY_ALIAS` | `upload` |
   | `ANDROID_KEY_PASSWORD` | אותה סיסמה (אם לא נבחרה אחרת למפתח) |

## שלב 4 - Firebase (התראות ב-Android)

1. [Firebase Console](https://console.firebase.google.com) ← **Add project** ←
   שם: `shuknadlan`. אפשר לכבות את Google Analytics של Firebase (יש לנו GA4 דרך GTM).
2. בפרויקט: סמל Android ← **Package name**: `il.co.shuknadlan.app` ← Register.
3. מורידים את **`google-services.json`**. לא לצרף לריפו.
4. ב-[GitHub Secrets](https://github.com/tomerytz-del/ShukNadlan/settings/secrets/actions):
   `GOOGLE_SERVICES_JSON` = **כל התוכן** של הקובץ (פותחים בעורך טקסט ומעתיקים).
5. ב-Firebase: ⚙️ **Project settings** ← **Service accounts** ← **Generate new private key**.
   יורד קובץ JSON.
6. עוד שני סודות ב-GitHub:

   | שם | ערך |
   | --- | --- |
   | `FCM_PROJECT_ID` | ה-Project ID מ-Project settings (למשל `shuknadlan-1a2b3`) |
   | `FCM_SERVICE_ACCOUNT_JSON` | כל התוכן של קובץ ה-JSON מסעיף 5 |

   ולוודא שקיימים גם `SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` (ה-workflow של
   ההתראות משתמש בהם). את מפתח ה-service role לוקחים מ-
   [Supabase ← API Keys](https://supabase.com/dashboard/project/obookujgolazrwycsiyn/settings/api-keys).
7. למחוק את קובץ ה-JSON מההורדות אחרי ההעתקה.

## שלב 5 - כניסה עם Google מתוך האפליקציה (2 דקות)

1. [Supabase ← Authentication ← URL Configuration](https://supabase.com/dashboard/project/obookujgolazrwycsiyn/auth/url-configuration).
2. ב-**Redirect URLs** ← **Add URL**, בדיוק כך:

   ```
   il.co.shuknadlan.app://auth-callback
   ```

3. לוודא שקיימות גם `https://shuknadlan.co.il/crm`, `https://shuknadlan.co.il/developer-crm`
   ו-`https://shuknadlan.co.il/csm`. ‏Save.

## שלב 6 - בנייה חתומה ובדיקה בטלפון

1. [Actions ← אפליקציות נייטיב](https://github.com/tomerytz-del/ShukNadlan/actions/workflows/native_apps.yml)
   ← **Run workflow** ← ענף `main` ← Run.
2. כשהריצה ירוקה (כ-5 דקות), בתחתית העמוד שלה ← **Artifacts**:
   - `android-debug-apk` - להתקנה ידנית בטלפון ובדיקה.
   - `android-release-aab` - הקובץ לחנות (עכשיו חתום).
3. בדיקה בטלפון Android (רצוי Android 15 או 16), לפי הרשימה:
   - פתיחה, מסך הפתיחה, בחירת אזור ("הפעלה" / "אולי אחר כך").
   - **הכותרת של האתר לא מתחת לשעון, והסרגל התחתון של ה-CRM לא מתחת לפס הניווט.**
   - חיפוש, דף נכס, וואטסאפ וחיוג נפתחים באפליקציות שלהם.
   - שיתוף נכס.
   - כניסה במייל וסיסמה, וכניסה עם Google.
   - ב-CRM: אין מחירים ואין כפתורי תשלום, תגית המסלול פותחת גיליון בלי מחירים.
   - מצב טיסה ← מסך "אין חיבור" ← כפתור "נסו שוב".
   - כפתור חזרה של Android חוזר בדף.
   - התראה: לאשר התראות, ואז לבקש מקלוד לשלוח התראת בדיקה.
   - **מחיקת חשבון** - עם חשבון בדיקה בלבד (לא החשבון שלך!): תמונת הפרופיל ←
     מחיקת החשבון ← שני האישורים ← מסך "החשבון נמחק".

## שלב 7 - Google Play: יצירת האפליקציה והעלאה לבדיקה סגורה

ב-[Play Console](https://play.google.com/console):

1. **Create app** ← שם: `שוק נדל״ן` ← שפה: עברית ← App ← Free ← מאשרים את ההצהרות.
2. **Set up your app** (רשימת המשימות בדשבורד). הטקסטים המוכנים - ב-`docs/native-apps.md`,
   סעיף "טיוטה לחנויות". **כל טקסט שלקוח רואה - קודם לאישור גבריאלה.**

   | משימה | מה עונים |
   | --- | --- |
   | App access | "All or some functionality is restricted" ← פרטי חשבון דמו של יועץ/ת (שלב 9.4) |
   | Ads | **No** (אין SDK פרסום. "נכס מקודם" הוא תוכן שלנו) |
   | Content rating | שאלון IARC, קטגוריה "All Other App Types": הכול "לא", חוץ מ"משתמשים מתקשרים / משתפים תוכן" - כן |
   | Target audience | 18+ |
   | News app | No |
   | Data safety | לפי הטבלה ב-`docs/native-apps.md`. **Advertising ID: כן** (רק דגל ה-opt-out, לאנליטיקה ופרסום). Data deleted on request: כן |
   | Account deletion URL | `https://shuknadlan.co.il/delete-account` |
   | Privacy policy | `https://shuknadlan.co.il/privacy` |
   | Government apps / Financial features / Health | No / None / No |

3. **Store listing:** שם, תיאור קצר ומלא (מהמסמך), אייקון 512×512, תמונת Feature
   ‏1024×500, ולפחות 2 צילומי מסך מהטלפון. **צילומים עם נתוני דמו בלבד** - בלי שם
   פרטי, מספר רישיון או טלפון אמיתי של יועץ/ת. קטגוריה: House & Home.
   אימייל ליצירת קשר: `shuknadlan@gmail.com`. אתר: `https://shuknadlan.co.il`.
4. **Testing ← Closed testing ← Create track** ← **Create new release** ← מעלים את
   ה-AAB משלב 6. בפעם הראשונה גוגל תציע **Play App Signing** - מאשרים.
5. **Testers:** יוצרים רשימת מיילים (או Google Group) עם 12 הבודקים ← שומרים ←
   מעתיקים את **קישור ההצטרפות** ושולחים לבודקים (בנוסח שגבריאלה אישרה).
6. **Send for review.** מאז שאושר - סופרים 14 יום שבהם 12 הבודקים מותקנים ופותחים.
7. **מוסרים לקלוד:** ‏Play Console ← **Test and release ← App integrity ← App signing**
   ← מעתיקים את **SHA-256 certificate fingerprint** של "App signing key certificate"
   (ואם רוצים גם של "Upload key"). זו טביעה ציבורית ולא סוד. קלוד יכניס אותה ל-
   `.well-known/assetlinks.json`, וקישורים מהאתר ייפתחו ישר באפליקציה.
8. אחרי 14 הימים: **Dashboard ← Apply for production** ← עונים על השאלון (מי בדק,
   מה למדנו) ← אחרי האישור: **Production ← Create release** ← אותו AAB (או חדש) ←
   מומלץ פריסה הדרגתית (20%, ואז 100%).

> כל עדכון עתידי לחנות: קלוד מעלה את `versionCode` ב-`mobile/android/app/build.gradle`,
> מריצים את שלב 6 ומעלים את ה-AAB החדש. שינוי באתר עצמו **לא** צריך עדכון בחנות.

---

## שלב 8 - Apple: הגדרות בחשבון המפתח (אחרי שהחשבון אושר)

### 8.1 מזהה האפליקציה

[Identifiers](https://developer.apple.com/account/resources/identifiers/list) ← **+** ←
App IDs ← App ← Bundle ID **Explicit**: `il.co.shuknadlan.app` ← מסמנים:
**Push Notifications**, **Associated Domains**, **Sign in with Apple** ← Register.

### 8.2 מפתח התראות (APNs)

[Keys](https://developer.apple.com/account/resources/authkeys/list) ← **+** ← שם:
`ShukNadlan Push` ← מסמנים **Apple Push Notifications service (APNs)** ← Register ←
**Download** (קובץ `.p8` - **יורד פעם אחת בלבד**). רושמים את **Key ID**.
ה-**Team ID** נמצא ב-[Membership](https://developer.apple.com/account#MembershipDetailsCard).

ב-[GitHub Secrets](https://github.com/tomerytz-del/ShukNadlan/settings/secrets/actions):

| שם | ערך |
| --- | --- |
| `APNS_KEY_P8` | כל התוכן של קובץ ה-`.p8` |
| `APNS_KEY_ID` | ה-Key ID |
| `APNS_TEAM_ID` | ה-Team ID |
| `APNS_BUNDLE_ID` | `il.co.shuknadlan.app` |
| `APNS_PRODUCTION` | `1` |

### 8.3 מפתח API לבנייה (App Store Connect)

[App Store Connect ← Users and Access ← Integrations ← App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
← **Generate API Key** ← שם `GitHub build` ← Access: **App Manager** ← Generate ←
**Download** (‏`.p8`, פעם אחת בלבד). רושמים **Key ID** ו-**Issuer ID** (מופיע מעל הרשימה).

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

| שם | ערך |
| --- | --- |
| `APPLE_TEAM_ID` | ה-Team ID |
| `APPLE_API_KEY_ID` | ה-Key ID של המפתח הזה |
| `APPLE_API_ISSUER_ID` | ה-Issuer ID |
| `APPLE_API_KEY_P8_BASE64` | מה שהועתק |

> זה **לא** אותו מפתח כמו ב-8.2 ולא אותו כמו ב-8.4. שלושה מפתחות נפרדים.

### 8.4 Sign in with Apple (חובה כי יש כניסה עם Google - הנחיה 4.8)

1. [Identifiers](https://developer.apple.com/account/resources/identifiers/list) ← **+** ←
   **Services IDs** ← Identifier: `il.co.shuknadlan.signin` ← Register ← פותחים אותו ←
   מסמנים Sign in with Apple ← **Configure**:
   - Primary App ID: `il.co.shuknadlan.app`
   - Domains: `obookujgolazrwycsiyn.supabase.co`
   - Return URLs: `https://obookujgolazrwycsiyn.supabase.co/auth/v1/callback`
2. [Keys](https://developer.apple.com/account/resources/authkeys/list) ← **+** ← מסמנים
   **Sign in with Apple** ← Configure ← App ID הראשי ← Register ← Download (`.p8`) ←
   רושמים Key ID.
3. [Supabase ← Auth ← Providers ← Apple](https://supabase.com/dashboard/project/obookujgolazrwycsiyn/auth/providers)
   ← Enable ← **Client IDs**: `il.co.shuknadlan.signin` ← **Secret Key**: ‏Supabase
   מציעה מחולל מה-Team ID, ה-Key ID, ה-Services ID וה-`.p8` ← Save.
   **הסוד הזה פג אחרי 6 חודשים** - לשים תזכורת ביומן לחידוש.
4. נכנסים פעם אחת עם Apple בדפדפן ב-`https://shuknadlan.co.il/crm` כדי לוודא שעובד.
5. **מוסרים לקלוד:** "Apple עובד, להדליק" ← קלוד משנה את
   `window.SHUK_APPLE_SIGNIN` ל-`true`.

### 8.5 מוסרים לקלוד את ה-Team ID

ה-Team ID אינו סוד. קלוד יחליף בו את המילה `TEAMID` ב-
`.well-known/apple-app-site-association`, וקישורים מהאתר ייפתחו באפליקציה באייפון.

## שלב 9 - App Store Connect: האפליקציה, TestFlight, ושליחה לביקורת

1. [App Store Connect ← Apps](https://appstoreconnect.apple.com/apps) ← **+ New App** ←
   iOS ← שם: `שוק נדל״ן` ← שפה ראשית: Hebrew ← Bundle ID: `il.co.shuknadlan.app` ←
   SKU: `shuknadlan-ios` ← Full Access.
2. בנייה: [Run workflow](https://github.com/tomerytz-del/ShukNadlan/actions/workflows/native_apps.yml)
   על `main`. עם סודות אפל, ה-job של iOS יוצר ארכיון חתום. **מוסרים לקלוד** כשהריצה
   ירוקה - הוא יוסיף את שלב ההעלאה ל-TestFlight (או: Xcode ב-Mac ← Product ←
   Archive ← Distribute App ← App Store Connect).
3. **TestFlight:** בדיקה פנימית (עד 100 אנשים, בלי ביקורת) - לפחות אתה ועוד שניים,
   לפי רשימת הבדיקה של שלב 6. אחר כך אפשר בדיקה חיצונית.
4. **חשבון דמו לבודקים של אפל** - יוצרים יועץ/ת בדיקה במשרד בדיקה (שם בדוי, בלי
   פרטים אמיתיים), עם כמה נכסים, לקוחות ולידים דמה. אפשר לבקש מקלוד להכין.
5. **App Information / App Privacy / Pricing:**

   | שדה | ערך |
   | --- | --- |
   | Category | Lifestyle (משנית: Business) |
   | Age rating | עונים על השאלון לפי האמת (אין אלימות, הימורים, תוכן למבוגרים). ה-WebView נעול לאתר שלנו, ולכן אין "גלישה חופשית" |
   | Price | Free |
   | Privacy Policy URL | `https://shuknadlan.co.il/privacy` |
   | Support URL | `https://shuknadlan.co.il/about` |
   | App Privacy | לפי הטבלה ב-`docs/native-apps.md`: שם, אימייל, טלפון, User ID, Device ID, תמונות - App Functionality, מקושרים. Product Interaction - Analytics ו-Developer Advertising, **Used to Track You: Yes** (הפיקסל, ורק אחרי אישור ATT) |
   | Export compliance | לא (כבר מוצהר באפליקציה) |

6. **Review notes** (באנגלית), לדוגמה:

   > The app is the mobile client of shuknadlan.co.il, a Hebrew real-estate
   > marketplace. Native features: push notifications for new leads and saved
   > searches, share sheet, deep links, Sign in with Apple/Google, location-based
   > region picker, offline screen. Demo agent account: <email> / <password>.
   > Account deletion: profile photo → מחיקת החשבון. No purchases are offered in
   > the app; subscriptions are managed on the website only. The Meta pixel loads
   > only after the user allows tracking in the ATT prompt.

7. צילומי מסך (iPhone 6.9" ו-6.5"), תיאור ומילות מפתח - מהמסמך, אחרי אישור גבריאלה.
8. **Add for Review ← Submit.** בדרך כלל 24-48 שעות. דחייה מגיעה עם סעיף - מעבירים
   לקלוד את הטקסט ועונים ב-Resolution Center.

> **הסיכון הגדול אצל אפל הוא הנחיה 4.2** ("אפליקציה שהיא אתר עטוף"). ב-Review notes
> מפרטים את היכולות הנייטיב (סעיף 6). אם יש דחייה על 4.2 - קלוד יציע מה להוסיף.

---

## שלב 10 - אחרי שהאפליקציה באוויר

1. **מוסרים לקלוד** להדליק את שליחת ההתראות בלוח זמנים (היום היא ידנית).
2. קישורים לחנויות - קלוד יוסיף לאתר (כפתור "הורידו את האפליקציה") כשתהיה כתובת.
3. כל ביקורת בחנות - תשובה מתואמת עם גבריאלה.
4. תזכורות ביומן:
   - **חידוש סוד Sign in with Apple** - כל 6 חודשים (שלב 8.4).
   - **חידוש Apple Developer Program** - כל שנה (99$).
   - **targetSdk** - גוגל מעלה את הדרישה כל אוגוסט. לבקש מקלוד לעדכן ביולי.
5. החזר לחברה יזמית שמחקה חשבון: מגיעה התראה בפעמון של מנהל/ת הפלטפורמה עם הסכום -
   מבצעים ידנית מול חברת הסליקה (`docs/account-closure.md`).

---

## סיכום: מה מוסרים לקלוד, ומתי

| מתי | מה | למה |
| --- | --- | --- |
| עכשיו | "לפתוח PR" | שלב 0 |
| אחרי שלב 7.4 | ‏SHA-256 של App signing key | ‏`assetlinks.json` - קישורים נפתחים באפליקציה |
| אחרי שלב 8 | ה-Team ID | ‏`apple-app-site-association` |
| אחרי 8.4 | "Apple עובד" | להדליק את כפתור הכניסה עם Apple |
| אחרי 9.2 | "הבנייה ירוקה" | העלאה ל-TestFlight מה-CI |
| אחרי שלב 4 ו-8.2 | "המפתחות בפנים" | התראת בדיקה, ולוח זמנים לשליחה |
| כל דחייה | הטקסט של הדחייה | תיקון ותשובה |
