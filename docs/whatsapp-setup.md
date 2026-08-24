# חיבור וואטסאפ (Meta WhatsApp Cloud API)

סוכן/ת שולח/ת הודעה בוואטסאפ — טקסט, תמונות או הקלטה קולית — והנכס נכנס למערכת.
הבוט מזהה מי שלח לפי מספר הטלפון, מבצע את הפעולה במסד הנתונים ומשיב בוואטסאפ.

---

## איך זה עובד

```
סוכן/ת בוואטסאפ
      │
      ▼
Meta WhatsApp Cloud API  ──Webhook (POST)──►  Edge Function: whatsapp-webhook
                                                      │
                                     1. אימות חתימת HMAC מול App Secret
                                     2. 200 מיידי ל-Meta, עיבוד ברקע
                                     3. זיהוי הסוכן/ת לפי agency_members.phone_e164
                                     4. תמונה → Supabase Storage ‏(property-images)
                                        הקלטה → OpenAI Whisper → טקסט
                                     5. Claude עם כלים (יצירה/עדכון/ארכוב נכס)
                                     6. תשובה חזרה דרך Graph API
```

### קבצים

| קובץ | תפקיד |
|---|---|
| `supabase/functions/whatsapp-webhook/index.ts` | נקודת הכניסה: אימות חתימה, ניתוב הודעות, מדיה, מצב שיחה |
| `supabase/functions/whatsapp-webhook/agent.ts` | הכלים שה-LLM יכול להפעיל + לולאת השיחה |
| `supabase/functions/whatsapp-webhook/whatsapp.ts` | עטיפה מעל Graph API (שליחה, הורדת מדיה, אימות חתימה) |
| `supabase/functions/whatsapp-webhook/geocode.ts` | גיאוקוד כתובות בעפולה (העתק של `geocode-address`, בלי דרישת JWT) |
| `supabase/migrations/20260824090000_whatsapp_integration.sql` | טבלאות + זיהוי לפי טלפון |

---

## שלב 1 — הגדרה ב-Meta for Developers

1. היכנסו ל-[developers.facebook.com](https://developers.facebook.com/) עם חשבון שמקושר ל-Meta Business.
2. **Create App** → סוג **Business** → הוסיפו את המוצר **WhatsApp**.
3. במסך **WhatsApp → API Setup** תמצאו:
   - **Phone number ID** — המזהה של המספר העסקי (לא המספר עצמו). זה `WHATSAPP_PHONE_NUMBER_ID`.
   - **Temporary access token** — טוקן ל-24 שעות, טוב לבדיקות בלבד.
4. **טוקן קבוע (חובה לפרודקשן):** Business Settings → **System Users** → צרו System User עם תפקיד Admin →
   **Add Assets** → שייכו את ה-WhatsApp Account → **Generate New Token** עם ההרשאות
   `whatsapp_business_messaging` ו-`whatsapp_business_management`. הטוקן הזה לא פג. זה `WHATSAPP_TOKEN`.
5. **App Secret:** App Settings → Basic → **App Secret** → Show. זה `WHATSAPP_APP_SECRET`.

> בזמן פיתוח, Meta מרשה לשלוח רק למספרים שנוספו ידנית תחת **API Setup → To**.
> כדי לשלוח לכל סוכן/ת צריך להעביר את האפליקציה ל-Live ולעבור Business Verification.

---

## שלב 2 — הגדרת הסודות ב-Supabase

Dashboard → Project Settings → **Edge Functions → Secrets** (או `supabase secrets set`):

| סוד | חובה? | מה זה |
|---|---|---|
| `WHATSAPP_TOKEN` | ✅ | טוקן הגישה הקבוע של ה-System User |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | מזהה המספר העסקי מ-API Setup |
| `WHATSAPP_APP_SECRET` | ✅ | App Secret — משמש לאימות חתימת הוובהוק |
| `WHATSAPP_VERIFY_TOKEN` | ✅ | מחרוזת אקראית שאתם ממציאים; חייבת להיות זהה למה שתזינו ב-Meta |
| `ANTHROPIC_API_KEY` | ✅ | מפתח API מ-[console.anthropic.com](https://console.anthropic.com/) — מפעיל את הבוט |
| `OPENAI_API_KEY` | ⬜ | לתמלול הקלטות קוליות (Whisper). בלעדיו הבוט יבקש טקסט במקום |
| `SITE_BASE_URL` | ⬜ | כתובת הבסיס של האתר, למשל `https://shuknadlan.co.il` — כדי שהבוט יצרף קישור לנכס |
| `WHATSAPP_GRAPH_VERSION` | ⬜ | ברירת מחדל `v23.0` |

`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית — אין צורך להגדיר.

> **בלי `WHATSAPP_APP_SECRET` הפונקציה מסרבת לעבד כל בקשה ומחזירה 500.** זה מכוון:
> הפונקציה חשופה בלי JWT, וחתימת ה-HMAC היא שכבת האימות היחידה שלה.

---

## שלב 3 — חיבור הוובהוק

כתובת הוובהוק:

```
https://obookujgolazrwycsiyn.supabase.co/functions/v1/whatsapp-webhook
```

ב-Meta: **WhatsApp → Configuration → Webhook → Edit**

- **Callback URL** — הכתובת למעלה
- **Verify token** — אותה מחרוזת שהגדרתם ב-`WHATSAPP_VERIFY_TOKEN`
- לחצו **Verify and save** (Meta שולחת GET; הפונקציה מחזירה את ה-challenge)
- תחת **Webhook fields** — סמנו **messages**

הפונקציה כבר פרוסה עם `verify_jwt = false`. אם פורסים מחדש מה-CLI:

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

---

## שלב 4 — זיהוי הסוכנים

הבוט מזהה את הסוכן/ת לפי `agency_members.phone`. כל סוכן/ת מגדיר/ה את המספר בעצמו/ה:

**דשבורד הסוכן (`crm.html`) → "ניהול נכסים בוואטסאפ" → מספר הוואטסאפ שלי**

אפשר גם ידנית:

```sql
update public.agency_members set phone = '050-1234567' where id = '<agent-uuid>';
```

הנרמול נעשה אוטומטית בעמודה המחושבת `phone_e164`, שמטפלת בכל הפורמטים הנפוצים:

| מה שהוזן | `phone_e164` |
|---|---|
| `0521112222` | `972521112222` |
| `+972-52-333-4444` | `972523334444` |
| `521112222` | `972521112222` |
| `00972501234567` | `972501234567` |
| `04-6512345` | `97246512345` |

יש אינדקס ייחודי על `phone_e164` — שני סוכנים לא יכולים לחלוק מספר, אחרת אי אפשר
לדעת בשם מי לפעול. ניסיון לשמור מספר תפוס מחזיר שגיאה ברורה בדשבורד.

**מספר שלא מזוהה מקבל:** "סליחה, איני מזהה את מספר הטלפון שלך כמורשה במערכת."

---

## מה הבוט יודע לעשות

| כלי | מה זה עושה |
|---|---|
| `create_property` | יוצר נכס חדש במצב `active`, מצרף תמונות ממתינות, ומנסה למצוא קואורדינטות |
| `update_property` | מעדכן שדות בנכס קיים |
| `set_property_status` | `active` / `sold` / `rented` / `archived` |
| `list_properties` | מחפש נכס לפי מה שהסוכן/ת מתאר/ת במילים |
| `attach_images` | מצרף תמונות שהגיעו בשיחה לנכס קיים |

### דוגמאות

| הסוכן/ת שולח/ת | מה קורה |
|---|---|
| "תעלה נכס חדש באבן גבירול 10, 3 חדרים, 1.8 מליון" | נוצר נכס למכירה בעפולה, עם פין על המפה |
| מצלם/ת 5 תמונות + כותב/ת "זה הנכס מקודם" | התמונות נשמרות ב-Storage ומתחברות לנכס |
| הקלטה קולית עם פרטי הנכס | תמלול ב-Whisper, ומשם כמו טקסט רגיל |
| "תוריד מהאתר את הדירה בהרצל 5" | הנכס עובר ל-`archived` |
| "תעדכן את המחיר של הדירה האחרונה ל-1.6 מליון" | עדכון על הנכס שנגעו בו לאחרונה בשיחה |

### מה מכוון ולא באג

- **אין מחיקה אמיתית.** "תמחק נכס" מעביר ל-`archived`, בדיוק כמו בדשבורד.
- **תמונה בלי כיתוב לא מייצרת תשובה.** וואטסאפ שולחת אלבום כהודעות נפרדות; תשובה לכל
  תמונה הייתה מציפה את הסוכן/ת ועלולה ליצור נכס כפול. התמונות נשמרות בצד ומתחברות
  לנכס הבא שנוצר (או לנכס האחרון בשיחה, ואז נשלח אישור קצר אחד).
- **גיאוקוד רק בעפולה.** מבוסס על שכבת הכתובות של העירייה. נכס בעיר אחרת נוצר בלי
  פין על המפה, וזה לא חוסם את הפרסום.
- **הסוכן/ת רואה רק את הנכסים שלו/ה.** כל כלי מקבע `agent_id` בעצמו — ה-LLM לא יכול
  לגעת בנכס של סוכן/ת אחר/ת גם אם ינסה.

---

## הטבלאות

| טבלה | תפקיד |
|---|---|
| `whatsapp_conversations` | מצב שיחה פר סוכן/ת: היסטוריה, תמונות ממתינות, הנכס האחרון |
| `whatsapp_messages` | יומן נכנס/יוצא. `wa_message_id` הייחודי מונע עיבוד כפול של משלוחים חוזרים מ-Meta |

שתיהן ב-RLS עם קריאה בלבד לסוכן/ת עצמו/ה; הכתיבה היא רק דרך `service_role` בתוך
ה-Edge Function — אותה תבנית כמו `notifications`.

---

## בדיקה בלי Meta

`scripts/whatsapp_webhook_test.py` בונה payload בפורמט של Cloud API, חותם אותו
ב-HMAC-SHA256 בדיוק כמו Meta, ושולח אותו לפונקציה. זה מאפשר לבדוק את כל הזרימה
עוד לפני שהוובהוק מחובר. ספריית התקן של פייתון בלבד — אין מה להתקין.

מגדירים ב-`.env` את `SUPABASE_URL`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`
ו-`WA_TEST_FROM` (ראו `.env.example`), ואז:

```bash
# רצף בדיקות בטוח: לחיצת יד, דחיית חתימה שגויה, מספר לא מוכר, "שלום"
python scripts/whatsapp_webhook_test.py all --check

# בדיקה אמיתית של יצירת נכס
python scripts/whatsapp_webhook_test.py text "תעלה נכס באבן גבירול 10, 3 חדרים, 1.8 מליון" --check
```

**דגל `--check` הוא העיקר.** הפונקציה מחזירה 200 מיד וממשיכה לעבד ברקע, אז קוד
200 לבדו לא מוכיח כלום. עם `--check` הסקריפט קורא את `whatsapp_messages` ומראה
מי זוהה, מה הבוט ענה ואיפה זה נפל. הוא דורש `SUPABASE_SERVICE_ROLE_KEY` ב-`.env`.

| פקודה | מה נבדק |
|---|---|
| `verify` | לחיצת היד (GET) שמבצעת Meta בהגדרת הוובהוק |
| `badsig` | חתימה שגויה חייבת לחזור 401 — שכבת האבטחה היחידה של הפונקציה |
| `unknown` | מספר שאינו רשום → "איני מזהה את מספר הטלפון שלך" |
| `text "…"` | זרימה מלאה: זיהוי → LLM → כלים → תשובה |
| `image --media-id X` | דורש media id **אמיתי** — הפונקציה מורידה את הקובץ מ-Graph API |
| `all` | הרצף הבטוח, בלי יצירת נכסים |

שימו לב: `text` פועל מול הפרויקט החי. בקשה ליצירת נכס באמת תיצור נכס.

---

## איתור תקלות

| תסמין | סיבה סבירה |
|---|---|
| Meta לא מצליחה לאמת את הוובהוק | `WHATSAPP_VERIFY_TOKEN` לא זהה למה שהוזן ב-Meta |
| הפונקציה מחזירה 401 | חתימת HMAC לא תואמת — `WHATSAPP_APP_SECRET` שגוי |
| הפונקציה מחזירה 500 מיד | `WHATSAPP_APP_SECRET` לא מוגדר בכלל |
| "איני מזהה את מספר הטלפון" לסוכן/ת קיים/ת | `phone` לא מעודכן, או שולחים ממספר אחר |
| ההודעה נקראת אבל אין תשובה | `ANTHROPIC_API_KEY` חסר/לא תקין — לבדוק בלוגים |
| הקלטות לא עובדות | `OPENAI_API_KEY` לא מוגדר |
| תמונות לא נשמרות | הקובץ מעל 3MB או פורמט שאינו JPEG/PNG/WebP (מגבלות ה-bucket) |

לוגים: Supabase Dashboard → Edge Functions → `whatsapp-webhook` → Logs.
בנוסף, `whatsapp_messages.error` שומר כשל בתמלול, בשליחה או בהרצת ה-LLM.

---

## עלויות

- **Meta:** שיחות שהסוכן/ת יוזם/ת (service conversations) — חלון 24 שעות. תמחור מעודכן
  ב-[Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing).
- **Anthropic:** קריאה אחת (או שתיים, כשמופעל כלי) לכל הודעה. הפונקציה מוגדרת
  `effort: "low"` כי חילוץ פרטי נכס הוא משימה פשוטה ולטנטיות חשובה בצ'אט.
  אם מתחילים לראות טעויות חילוץ — להעלות ל-`medium` ב-`agent.ts`.
- **OpenAI Whisper:** רק על הקלטות קוליות.
