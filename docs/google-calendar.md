# חיבור יומן Google של הסוכן/ת

היומן במערכת ([`agent-agenda.md`](agent-agenda.md)) עובד בלי Google: פגישות,
תזכורות בוואטסאפ ובפעמון, ומשימות אוטומטיות. מי שמחבר/ת יומן Google מקבל/ת
שני דברים נוספים:

1. **הפגישות מופיעות ביומן Google.** פגישה, סיור וחתימה נכתבים ליומן משנה
   בשם "שוק נדל״ן" בחשבון של הסוכן/ת. שינוי, ביטול או הזזה עוברים גם הם.
2. **העוזר בוואטסאפ יודע מתי הסוכן/ת פנוי/ה.** `agenda_free_slots` מצליב את
   היומן במערכת עם הזמינות ביומן הראשי ב-Google (פנוי/תפוס בלבד).

**מסלול:** PROFESSIONAL ו-Elite בחיוב פעיל - אותו גייט של היומן
(`agent_agenda_enabled`).

## תהליך נפרד, שמתחיל רק בלחיצה

החיבור **אינו** הכניסה ל-CRM עם Google (`google-login.md`), משלוש סיבות:

- Supabase אינו שומר בשרת את הטוקן של Google מהכניסה, כך שלא הייתה לנו גישה
  ליומן כשהסוכן/ת אינו/ה מחובר/ת.
- חלק מהסוכנים נכנסים באימייל וסיסמה.
- בקשת הרשאת יומן בכל כניסה הייתה מבהילה גם את מי שלא צריך/ה אותה.

לכן זה OAuth נפרד, שמתחיל רק בלחיצה על **"חבר/י יומן"** בקטגוריית "יומן
ומשימות":

```
CRM  ──POST {action:'start'}──►  google-calendar-connect   (verify_jwt = true)
                                   │  הזהות מה-JWT · גייט · state חתום
                                   ▼
                          accounts.google.com  (מסך ההסכמה)
                                   │
                                   ▼
                  shuknadlan.co.il/auth/google-calendar   (‏_redirects, ‏200 proxy)
                                   │
                                   ▼
                          google-calendar-callback   (verify_jwt = false)
                                   │  אימות state · החלפת קוד · בדיקת הרשאות
                                   │  יצירת יומן "שוק נדל״ן" · שמירת הטוקן מוצפן
                                   │  סימון הפגישות הפתוחות לסנכרון
                                   ▼
                          302 → /crm?goto=accGcal&gcal=<תוצאה>
```

## מי רואה את הכפתור: כל הסוכנים במסלול, מ-30.9.2026

**פתוח לכולם.** ב-30.9.2026 האפליקציה עברה ל-*In production*, ו-Verification
Center הראה: המיתוג אומת ("Your branding has been verified"), ואימות גישה
לנתונים אינו נדרש, כי אף הרשאה אינה רגישה או מוגבלת. לכן `GCAL_PUBLISHED =
true` בשני המקומות:

| איפה | מה הוא עושה |
| --- | --- |
| `supabase/functions/_shared/google-calendar.ts` | **האכיפה**: כש-false, ‏`google-calendar-connect` מחזירה `not_available_yet` לכל מי שאינו/ה מנהל/ת הפלטפורמה |
| `assets/crm.js` | התצוגה: כש-false, כרטיס "יומן Google" מוסתר, חוץ ממנהל/ת הפלטפורמה ומי שכבר מחובר/ת |

**סגירה חזרה** (למשל אם האפליקציה תחזור ל-*Testing*, או אם תתווסף הרשאה רגישה
שתדרוש אימות מלא): ‏`GCAL_PUBLISHED = false` בשני הקבצים, ובאותו PR להוציא את
`", וחיבור ליומן Google"` מהשורה ב-`pricing.html` ומ-`GATES` שב-
`scripts/check_tier_gates.py`, ואת ההפניה לחיבור מ-`googleNote` ומהפרומפט
ב-`whatsapp-webhook/agent.ts`. כך היה בין #511 לפתיחה (30.9.2026).

## ההרשאות - הצרות ביותר שעובדות

| הרשאה | למה |
| --- | --- |
| `calendar.app.created` | ליצור יומן משנה ולנהל את האירועים **שבו בלבד** |
| `calendar.freebusy` | לראות מתי היומן הראשי תפוס - בלי כותרות ובלי משתתפים |
| `openid email` | להציג באיזה חשבון מחובר ("מחובר: x@gmail.com") |

המשמעות: תוכן היומן האישי (פגישה אצל רופא, אירוע משפחתי) לא מגיע אלינו, לא
נשמר, ולא עובר למודל שפה. **המחיר:** אי אפשר להזיז מכאן פגישה שנקבעה ישירות
ב-Google, ואין קריאה של אירועים משם. אם זה יידרש בעתיד, זו החלטה על הרשאה
רחבה יותר (`calendar.events`), ולא שינוי קוד בלבד.

מסך ההסכמה של Google מאפשר להוריד סימון מהרשאה בודדת:

- **בלי `calendar.app.created`** אין מה לחבר. הטוקן מבוטל מיד, והסוכן/ת
  חוזר/ת עם `gcal=scope_missing`.
- **בלי `calendar.freebusy`** החיבור עובד, רק בלי הזמינות. הכרטיס ב-CRM
  וה-`google_note` בבוט אומרים זאת.

## הקבצים

| קובץ | תפקיד |
| --- | --- |
| `supabase/migrations/20270126090000_google_calendar.sql` | החיבור, הטוקן, עמודות הסנכרון על הפריט, הטריגר, ה-claim וה-cron |
| `supabase/functions/_shared/google-calendar.ts` | הצפנה, state חתום, רענון, קריאות ה-API, וניתוק מלא |
| `supabase/functions/google-calendar-connect/` | `start` (כתובת ההסכמה) ו-`disconnect` |
| `supabase/functions/google-calendar-callback/` | החזרה מ-Google |
| `supabase/functions/google-calendar-sync/` | הכתיבה ל-Google, כל דקה, וניתוק חשבונות שנסגרו |
| `supabase/functions/whatsapp-webhook/agent.ts` | `agenda_free_slots` |
| `crm.html` → `#agGcal`, `assets/crm.js` → "יומן Google" | הכרטיס, החיבור, הניתוק, והודעת החזרה (`?gcal=`) |
| `privacy.html#google-calendar` | מה מבקשים, מה כותבים, מה קוראים, מה נשמר |

## הטוקן

- **`agent_calendar_secrets`** - ה-refresh token, מוצפן ב-AES-GCM. אין אליו
  שום גישה מהדפדפן: RLS דלוק, אין policy, ו-`revoke all` מ-`anon` ומ-
  `authenticated`.
- **המפתח במשתני הסביבה ולא במסד** (`GOOGLE_CALENDAR_TOKEN_KEY`): גיבוי של
  המסד לבדו אינו מדליף גישה ליומנים. אותו סוד גם חותם את ה-state (שני מפתחות
  נגזרים, לא אחד לשני האלגוריתמים). **החלפה שלו מנתקת את כל החיבורים.**
- **`agent_calendar_connections`** - מה שהסוכן/ת רואה/ה: חשבון, מצב, שגיאה
  אחרונה, סנכרון אחרון. קריאה בלבד מהדפדפן; החיבור והניתוק עוברים דרך
  `google-calendar-connect`, כי הם דורשים את הסוד של האפליקציה מול Google.

### ה-state

חתום ב-HMAC, נושא את מזהה הסוכן/ת ותוקף של רבע שעה. בלעדיו אפשר היה לשלוח
למישהו קישור ל-callback שמחבר את יומן **שלו/ה** לחשבון של אחר/ת. ה-callback
הוא `verify_jwt = false` בהכרח - זה ניווט של הדפדפן חזרה מ-Google, בלי
Authorization - ולכן ה-state הוא האימות היחיד שלו.

## הסנכרון

כיוון אחד: מהמערכת אל Google.

| מה | מה קורה ב-Google |
| --- | --- |
| פגישה / סיור / חתימה עם מועד | אירוע ביומן "שוק נדל״ן", שעה כברירת מחדל |
| שינוי כותרת, מועד, מיקום, הערות, לקוח/ה או סוג | עדכון האירוע |
| ביטול, מחיקת מועד, או שינוי לשיחה/משימה | מחיקת האירוע |
| בוצע | האירוע נשאר - הפגישה התקיימה |
| שיחה ומשימה | לא עוברות. משימה של 09:00 שנראית כמו פגישה חוסמת את הבוקר בעיני מי שמתאם/ת מולו/ה |

1. **הסימון** - טריגר `before` (`agent_agenda_items_google_mark`) מסמן
   `google_sync_state = 'pending'` רק כשהשתנה משהו שמופיע באירוע, ורק כשיש
   חיבור פעיל. הפונקציה שכותבת את התוצאה נוגעת רק בעמודות `google_*`, ולכן
   אינה מסמנת את עצמה מחדש.
2. **ה-cron** - כל דקה, רק כש-`google_calendar_sync_ready()`.
3. **התפיסה** - `google_calendar_sync_claim` מסמנת `syncing` (`for update skip
   locked`) ומחזירה גם `include`: האם האירוע אמור להתקיים. `syncing` שנתקע
   יותר מחמש דקות חוזר לתור.
4. **התוצאה נכתבת רק אם הפריט עדיין `syncing`.** שינוי שנעשה באמצע מחזיר אותו
   ל-`pending`, והסבב הבא כותב את הגרסה החדשה - במקום שהישנה תדרוס אותה.

**מזהה האירוע נגזר ממזהה הפריט** (`shk` + ה-uuid בלי מקפים - hex, שהוא
תת-קבוצה של base32hex ש-Google דורשת). ניסיון חוזר אחרי נפילה מעדכן את אותו
אירוע ולא יוצר שני.

**אין תזכורות של Google על האירועים** (`reminders.overrides = []`): התזכורות
יוצאות מאיתנו בוואטסאפ ובפעמון, ותזכורת נוספת מ-Google הייתה מצלצלת פעמיים.

### כשמשהו נשבר

| מצב | מה קורה |
| --- | --- |
| הסוכן/ת ביטל/ה את ההרשאה ב-Google (`invalid_grant`) | החיבור `error`, הטוקן נמחק, התראת `system` בפעמון, והפריטים חוזרים ל-`pending` - הם ייכתבו אחרי חיבור מחדש |
| יומן "שוק נדל״ן" נמחק ב-Google | נוצר יומן חדש פעם אחת, והאירוע נכתב אליו |
| כשל של פריט בודד | `google_sync_state = 'error'`, השגיאה ב-`google_sync_error`, ותגית "לא עבר ל-Google" בשורה ב-CRM |
| החשבון במערכת נסגר | `google-calendar-sync` מוחק את היומן ב-Google ומבטל את ההרשאה (`google_calendar_closed_agents`). זה קורה שם ולא ב-`close-account`, כי סגירה מתוזמנת נכנסת לתוקף בריצה של המסד, שאינה יכולה לדבר עם Google |

## ניתוק

בכפתור "ניתוק" בכרטיס, ב-`google-calendar-connect` עם `disconnect`:
מחיקת יומן "שוק נדל״ן" ב-Google (כדי שהאירועים שלנו לא יישארו שם יתומים),
ביטול ההרשאה, מחיקת הטוקן, וניקוי `google_*` מהפריטים. הניתוק מותר גם למי
שהמסלול שלו/ה פג - זו הדרך החוצה, והיא אינה נחסמת.

## ההגדרה ב-Google Cloud

1. **פרויקט נפרד**, `shuknadlan-calendar` (30.9.2026), ולא הפרויקט של
   הכניסה עם Google: הוספת הרשאות לפרויקט שכבר ב-*In production* הייתה
   עלולה להציג "Google hasn't verified this app" לכל מי שנכנס/ת ל-CRM.
   ‏**APIs & Services → Library** → הפעלת **Google Calendar API**.
2. **Google Auth Platform**:
   - *Branding*: דף בית, `https://shuknadlan.co.il/privacy`,
     `https://shuknadlan.co.il/terms`, ו-Authorized domain
     ‏`shuknadlan.co.il`. **`supabase.co` נדחה** ("must be a top private
     domain") - זו סיומת ציבורית, כמו `co.il`.
   - *Data Access*: ארבע ההרשאות שלמעלה, ולא יותר. ‏Google מציעה שם גם את
     `.../auth/calendar` המלאה (רגישה) - למחוק אותה.
   - *Audience*: ‏External, ‏*Testing*, ו-Test users.
3. *Clients* → **Create client → Web application**, עם Authorized
   redirect URI:
   ```
   https://shuknadlan.co.il/auth/google-calendar
   ```
   הכתובת על הדומיין שלנו ולא על Supabase, כי לפני האימות Google דורשת
   להוכיח בעלות על כל דומיין מורשה, ועל `*.supabase.co` אי אפשר.
   ‏`_redirects` מעביר אותה (‏200) ל-`google-calendar-callback`. עד 30.9.2026
   הכתובת הייתה `https://obookujgolazrwycsiyn.supabase.co/functions/v1/google-calendar-callback`
   - אפשר להשאיר את שתיהן בלקוח בזמן המעבר, ולמחוק את הישנה (ואת
   ‏`obookujgolazrwycsiyn.supabase.co` מ-Authorized domains) אחריו.
4. שלושה סודות ב-Supabase → Edge Functions → Secrets:

   | סוד | מה |
   | --- | --- |
   | `GOOGLE_CALENDAR_CLIENT_ID` | מהלקוח שנוצר בשלב 3 |
   | `GOOGLE_CALENDAR_CLIENT_SECRET` | מאותו לקוח |
   | `GOOGLE_CALENDAR_TOKEN_KEY` | `openssl rand -base64 32` (או ב-PowerShell: `$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`) - 44 תווים, כולל ה-`=` בסוף. לשמור עותק במקום בטוח |

   בלי שלושתם הכפתור מחזיר `not_configured` ומסביר זאת, והיומן במערכת ממשיך
   לעבוד בלי Google.

5. **אימות האפליקציה מול Google.** ‏Google מסווגת את `calendar.app.created`
   ואת `calendar.freebusy` **כלא רגישות** (כך הן מופיעות ב-*Data Access*,
   30.9.2026), ולכן הצפוי הוא אימות מיתוג בלבד - שם, דומיין, מדיניות פרטיות
   - ולא אימות רגיש עם סרטון. עד שהוא עובר האפליקציה ב-*Testing*: רק
   Test users יכולים לחבר, וההרשאה שלהם פגה אחרי שבעה ימים. הסדר: *Audience*
   ← **Publish app** ← *Verification Center*. בפועל (30.9.2026) לא נדרשה הגשה:
   המיתוג אומת מיד, ואימות הגישה לנתונים "not required".

## מלכודות

- **אפליקציה מותקנת באייפון.** הניווט ל-`accounts.google.com` יוצא מתחום
  האפליקציה ונפתח בדפדפן שבתוכה. החזרה ל-`/crm` מגיעה לאותו דפדפן ולא
  לאפליקציה - החיבור נשמר בשרת, ולכן די לחזור לאפליקציה ולרענן.
- **`prompt=consent` הוא חובה.** בלעדיו Google אינה מחזירה refresh token
  בחיבור חוזר, והחיבור היה עובד שעה ונשבר. אם בכל זאת לא חזר אחד, ה-callback
  משתמש בזה שכבר שמור.
- **שעון ישראל.** האירועים נשלחים עם `timeZone: Asia/Jerusalem`, ו-
  `agenda_free_slots` מחשב את גבולות היום באותו אזור זמן (`ilLocalToIso`).

## בדיקה

המיגרציה הורצה פעמיים על Postgres 16 מקומי (אידמפוטנטית), ונבדקו: סימון
הפגישות הקיימות בחיבור, סימון פריט חדש רק כשיש חיבור, שיחה/משימה שאינן
מסומנות, `include = false` לפגישה שבוטלה, סימון מחדש בשינוי הערה, ניתוק
חשבון שנסגר. ההצפנה, ה-state (כולל חתימה שזויפה), מזהה האירוע והאימייל מתוך
ה-id_token נבדקו ב-Deno.

**מה לא נבדק:** השיחה מול Google עצמה - החלפת קוד, יצירת היומן, הכתיבה
והזמינות. היא נבדקת לראשונה אחרי שהסודות מוגדרים, עם חשבון שנוסף כ-Test user:

```sql
select status, google_email, calendar_id, last_error, last_sync_at from agent_calendar_connections;
select title, google_sync_state, google_sync_error from agent_agenda_items
 where google_sync_state is not null order by updated_at desc limit 20;
```

## איפה החיבור ב-CRM

בהגדרות החשבון, בקטגוריה **"יומן Google"** (`#accGcal`) - ולא בראש "יומן ומשימות", שם הוא ישב
עד 10.2026. החיבור הוא פעולה של פעם אחת, וביומן באים לראות את הפגישות. ביומן נשאר רק קישור
"חיבור ליומן Google - בהגדרות" (`agGcalLink`), וגם הוא רק כשעוד אין חיבור. כשהמסלול אינו כולל
את היומן הקטגוריה מוסתרת כולה (`renderGcal`). ההפניה חזרה מ-Google נוחתת עליה (`goto=accGcal`).
