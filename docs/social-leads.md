# לידים מפייסבוק ומאינסטגרם (גבריאלה דרך Zernio)

גבריאלה עונה לפניות בפייסבוק ובאינסטגרם (‏Zernio), ושולחת כל ליד לנקודת
קליטה אחת: **`social-lead-intake`**. משם הוא עובר לפונקציית הקליטה הקיימת של
אותו מסלול באתר - כמו ליד מטופס של מטא (‏`_shared/meta-leads.ts`) - כך שרוטציה,
ניתוב, מחירים, התראות ויומן הניתוב זהים לליד מהאתר.

**מה היה שבור עד 24.10.2026:** גבריאלה קראה ישירות לפונקציות הקליטה.
‏`normalizeSource` מחק את המקור, ולכן ליד מפייסבוק נספר כ"פנייה מדף נכס" או
כ-`homepage_*`; ושום דבר לא מנע מאותה פנייה להיכנס פעמיים.

## הקריאה

```
POST https://obookujgolazrwycsiyn.supabase.co/functions/v1/social-lead-intake
x-social-lead-secret: <SOCIAL_LEAD_SECRET>
Content-Type: application/json
```

(‏`Authorization: Bearer <SOCIAL_LEAD_SECRET>` מתקבל גם הוא.)

| שדה | חובה | מה |
| --- | --- | --- |
| `zernio_id` | כן | המזהה של הפנייה ב-Zernio. אותו מזהה פעמיים = אותו ליד |
| `channel` | כן | `facebook_dm` · `facebook_comment` · `instagram_dm` · `instagram_comment` |
| `kind` | כן | `property` (שאלה על נכס) · `buyer` (מחפש/ת) · `owner` (מוכר/ת או משכיר/ה) · `mortgage` |
| `name` | | שם הפונה. בלעדיו - "פונה מפייסבוק" / "פונה מאינסטגרם" |
| `phone` | כן, חוץ מ-`buyer` עם מייל | |
| `email` | | |
| `message` | | מה הפונה כתב/ה. נכנס לליד ומוצג לסוכן/ת אחרי פתיחה |
| `property_id` / `listing_number` | ב-`property` | הנכס. אחד מהשניים |
| `city`, `deal_type`, `property_type`, `rooms`, `min_rooms`, `max_rooms`, `min_price`, `max_price`, `neighborhood_id` | | הקריטריונים (‏`buyer`), או פרטי הנכס (‏`owner`: ‏`city` ו-`property_type` חובה) |
| `consent_agent_contact` | ב-`buyer`: כן (`true`) | הסכמה שמתווך/ת יפנה/תפנה. בלעדיה אין ליד |
| `subscribe_alerts` | | `true` = גם התראות על נכסים חדשים בוואטסאפ. ברירת המחדל - בלי |
| `property_price`, `equity`, `owns_property` | | ‏`mortgage` |

**התשובה:** `{ success: true, status: "routed", lead_id, fn, fallback, search_id }`.
שליחה חוזרת של אותו `zernio_id` מחזירה את אותה תשובה עם `duplicate: true`, ולא
יוצרת ליד שני. שגיאה: ‏`401` סוד שגוי, ‏`400` שדה חובה פסול, ‏`422` חסר מה
שצריך למסלול (‏`missing_phone`, ‏`missing_consent`, ‏`missing_search_criteria`,
‏`missing_city`, ‏`missing_property_type`), ‏`409` הפנייה כבר בטיפול, ‏`502` פונקציית
הקליטה נכשלה. אחרי כישלון אפשר לשלוח שוב את אותו `zernio_id` (עד 5 ניסיונות).

## הניתוב

| `kind` | לאן | המקור בליד |
| --- | --- | --- |
| `property`, נכס פעיל | `property-inquiry-intake` - לסוכן/ת שמפרסם/ת | `leads.source` = הערוץ, `source_detail` = "פייסבוק · הודעה" |
| `property`, נכס לא פעיל או לא נמצא | `saved-search-intake` עם `lead_only`, והקריטריונים מהנכס (עיר, סוג, חדרים, עסקה) | `saved_searches.source` |
| `buyer` | `saved-search-intake` - `lead_only` אלא אם `subscribe_alerts` | `saved_searches.source` |
| `owner` | `owner-lead-intake` - הרוטציה הרגילה | `leads.source`, `source_detail` |
| `mortgage` | `mortgage-lead-intake` - מדף היועצים | `mortgage_leads.source` |

### ליד משכנתא מהרשתות, בחינם, כשהדגל דלוק

ברירת המחדל לא משתנה: `kind = mortgage` נכתב ל-`mortgage_leads` ונשאר
`new` על המדף בתשלום. `social-lead-intake` ו-`mortgage-lead-intake` לא
השתנו. נקודת החיבור היא טריגר `after insert` על `mortgage_leads`
(`mortgage_social_route`, מיגרציה `20271029100000`), והוא רץ רק כש-
`pricing_config.mortgage_social_route_enabled = 1`.

כשהדגל דלוק והמקור הוא אחד מארבעת הערוצים החברתיים, הליד מסומן `sold`
ללא חיוב ארנק (`mortgage_lead_purchases.amount = 0`,
`payment_method = 'social_route'`). היועצ/ת נבחר/ת מ-
`agency_members.is_mortgage_advisor` (פעיל/ה, `closed_at` ריק) - הדגל,
לא תפקיד ולא מספר טלפון. אם יש יותר מאחד/ת, מי שקיבל/ה הכי מעט שיוכים,
ואז ה-`id` הנמוך. אין יועצ/ת - הליד נשאר על המדף.

כל שיוך נספר ב-`mortgage_social_routes`. `mortgage_social_route_stats`
מחזיר את המונה ליועצ/ת (ולמנהל/ת פלטפורמה גם פירוט לפי שם פרטי).
`review_due` נדלק מ-10 לידים, והניתוב לא נעצר - ההסכם נבדק ביד. המונה
מוצג במגירת המשכנתאות ב-CRM. ההתראה `mortgage_social` נפתחת לאותה מגירה
(`?goto=accLeadShelf&tab=mortgage`). אין בה שם או טלפון של הפונה.

`lead_routing_log` עדיין רושם `shelf` מתוך `mortgage-lead-intake`, כי
הפונקציה הזו לא נערכה. השיוך החינמי נספר רק ב-`mortgage_social_routes`.

כל ניתוב נרשם ב-`lead_routing_log` בפונקציית הקליטה עצמה (‏`docs/lead-routing.md`),
עם המקור החברתי. ‏`social_leads` שומרת לכל `zernio_id` מה נשלח, לאן, ומה חזר
(‏`target`, ‏`error`) - קריאה למנהל/ת הפלטפורמה בלבד.

**נכס שירד מהאוויר:** הפונה עדיין מחפש/ת נכס כזה, ולכן הוא/היא נכנס/ת למגירת
"מחפשי דירה" בחנות. פנייה על נכס היא בקשה שמתווך/ת יחזור/תחזור - כמו הטופס
בדף הנכס - ולכן ההסכמה נלקחת ממנה, אלא אם גבריאלה שלחה `consent_agent_contact: false`.

## מי רשאי/ת לסמן מקור חברתי

פונקציות הקליטה ציבוריות (‏`verify_jwt = false`). מקור חברתי, `meta_ads_*`
ו-`external_ref` מתקבלים בהן **רק מקורא פנימי** - מי שמחזיק/ה את מפתח
ה-service role (‏`isInternalCaller` ב-`_shared/lead-routing.ts`), כלומר
`social-lead-intake` אחרי שאימתה את הסוד, או `ads-leads-webhook` /
`ads-admin`. מהדפדפן `source: "facebook_dm"` או `source: "meta_ads_owner_form"`
נופל לברירת המחדל של הפונקציה, אחרת כל אחד/ת היה/הייתה יכול/ה לייצר לידים
"מפייסבוק" או "מטא" ולזהם את הדוח. אותו כלל ל-`lead_only` ב-`saved-search-intake`.

## כפילויות - שלוש שכבות

1. **`social_leads.zernio_id`** (מפתח ראשי) ו-`social_lead_claim` - אותה תבנית
   כמו `ads_leads`: השורה נשמרת קודם, וקורא אחד בלבד שולח למסלול.
2. **`leads (source, external_ref)` ייחודי** - ‏`property-inquiry-intake`,
   ‏`agent-direct-inquiry-intake` ו-`owner-lead-intake` מקבלים `external_ref`
   ומחזירים `{ duplicate: true, lead_id }` כשהליד כבר קיים (גם במרוץ, דרך
   ה-unique). טופס מטא שולח `external_ref = meta_lead_id`. **ה-ref אינו
   ב-`source_detail`**: זה מוצג לסוכן/ת בכרטיס הליד (‏`assets/crm-leads.js`),
   ושם יש תווית קריאה - "פייסבוק · הודעה" או "טופס לידים במטא · מוכר/ת".
3. **אותו טלפון בשני מסלולים, רק מקורא פנימי** - ‏`leads.phone_e164`
   (‏`normalize_msisdn`, כמו `saved_searches`) ואינדקס לא ייחודי. לפני
   insert, טופס מטא או פייסבוק/אינסטגרם מחפשים ליד מאותו `phone_e164`
   ואותו `lead_type` מ-30 הימים.

   - **בעל/ת נכס מטופס מטא או מפייסבוק/אינסטגרם אינו מתמזג לפי טלפון.**
     הבקשה לא כוללת רחוב, ובכוונה לא מוסיפים אותו. מיזוג לפי טלפון בפועל
     הוא רק **פנייה על נכס** (אותו `property_id`, אותו `agency_id` ואותו
     `agent_id`). מחשבון תשואה הוא `property_inquiry` בלי נכס, ושם אין מיזוג.
     אותו `external_ref` עדיין מחזיר את הליד הקיים (שכבה 2).
   - אם בכל זאת מגיעה כתובת של בעל/ת נכס, ההצמדה דורשת אותה עיר ואותו
     רחוב, ומספר בית כשאחד הצדדים נושא אותו. בלי כתובת באחד הצדדים אין
     הצמדה. "4 חדרים" אינו רחוב.
   - **ליד פלטפורמה** (מטא או פייסבוק/אינסטגרם, הקריאה בלי `agency_id`
     ובלי `agent_id`) **אינו מתמזג לפי טלפון**. אין יעד אפשרי: ליד גלוי
     דורש `agent_id`, ויעד בלי משרד ובלי סוכן/ת דורש `agent_id` ריק.
     הקליטה חוזרת מיד, בלי שאילתה. אותו `external_ref` עדיין מחזיר את
     הליד הקיים (שכבה 2), וזו הכפילות היחידה של ליד כזה. כשהפנייה עצמה
     הגיעה מדף (יש משרד וסוכן/ת), שניהם חייבים להתאים.
   - ליד מוסתר (`masked`), בלי סוכן/ת, או `pending_charge` אינו בולע פנייה.
   - נמצא ליד `unlocked` אצל סוכן/ת: אין insert ואין רוטציה.
     `lead_phone_touch` מוסיף את ההודעה ל-`raw_message` ואת המקור
     ל-`source_touches` (לא בכרטיס) **באותו update**, בלי לכתוב
     ל-`phone_e164`. חלון ההתראה נבדק לפני העדכון, כדי שכשל ייכתב על
     אותו מגע. רק אם העדכון הצליח והחלון פנוי נכתבת `new_lead` עם הכותרת
     "פנייה נוספת על ליד קיים" ו-`related_lead_id`.
     **לכל היותר התראת `new_lead` אחת לאותו ליד ולאותו/ה סוכן/ת ב-24 שעות.**
     הבדיקה היא שורה ב-`notifications` עם `type = new_lead`,
     `related_lead_id` של הליד, `agent_id` של הסוכן/ת שהליד משויך/ת אליו/ה
     עכשיו, ו-`created_at` מאוחר מ-`now() - 24h`. "ליד חדש" שנכתב ביצירת
     הליד נספר גם הוא. התראה שיצאה לסוכן/ת הקודם/ת אינה חוסמת את מי שקיבל/ה
     את הליד בהעברה. פנייה נוספת בתוך החלון עדיין מריצה את `lead_phone_touch`.
     נמצאה שורה - אין insert להתראה, והמגע נשאר. כשל בשאילתת החלון - אין
     insert להתראה, והמגע נכתב עם `notify_skipped` = `window_lookup_error`.
     כשל ב-insert של ההתראה עצמה אינו פותח ליד שני, ומוסיף מגע שני (בלי
     שורת הודעה נוספת) עם `notify_skipped` = `notify_insert_error`.
     כישלון `lead_phone_touch` מחזיר את הקליטה ל-insert רגיל.

     שני הדילוגים, מ-`leads.source_touches` (לא בכרטיס):

     ```sql
     select l.id, elem->>'notify_skipped' as why, elem->>'at' as at, elem->>'source' as source
     from public.leads l
     cross join lateral jsonb_array_elements(l.source_touches) elem
     where elem->>'notify_skipped' in ('window_lookup_error', 'notify_insert_error');
     ```
   - **אין משימת יומן שנייה.** הטריגר על `new_lead` קורא ל-
     `agent_agenda_add_auto` עם `source_key` = `lead:<id>`, ו-
     `on conflict do nothing` בולע את הפנייה הנוספת (`docs/agent-agenda.md`).
   - התשובה לקורא הפנימי `{ duplicate: true, lead_id }`.
     **מהדפדפן אין מיזוג.** `ownerPhoneAttach` / `propertyPhoneAttach`
     מחזירות null כש-`isInternalCaller` נכשל, `attachToOpenLead` אינו
     נקרא, והטופס מקבל את צורת התשובה הרגילה (`success`, `lead_id` של
     השורה החדשה, ובפנייה על נכס גם `auto_unlocked` ו-`note`) בלי
     `duplicate` ובלי מזהה של ליד אחר.

## ליד בלי התראות (`lead_only`)

`saved-search-intake` תמיד רשם את הפונה להתראות. ‏`lead_only: true` (קורא פנימי
בלבד) שומר את החיפוש `status = 'paused'`: מנוע ההתראות עובר רק על `active`,
והמדף (‏`saved_search_leads_public`) מסנן רק `unsubscribed`. בלי
`consent_agent_contact` אין בזה כלום - לא התראות ולא ליד - ולכן נדחה
(‏`lead_only_requires_consent`).

**סף הכוונה (45):** ליד מינימלי - טלפון ועיר - מקבל 40 + 4 (עיר) + 4 (טלפון) =
‏48, ונכנס למדף. **בלי עיר הוא 44 ונשאר מחוץ למדף**, ולכן `social-lead-intake`
דורשת לפחות קריטריון אחד. כמו כל ליד במדף, הציון דועך: אחרי 14 יום בלי
פעילות הוא יורד ל-40 ויוצא. מחיר עונה, תקציב (+15) וחדרים (+8) מחזיקים אותו.

## בחנות: המקור עובר לליד שנקנה

`saved_searches.source` (‏20270806090000) נשמר בכל חיפוש חדש. כשסוכן/ת קונה ליד
מהמגירה, ‏`store_purchase_to_lead` כותבת `source_detail = 'מחפשי דירה · פייסבוק · הודעה'`
במקום `'מחפשי דירה'` בלבד (‏`lead_source_label()` במסד, אותה מפה כמו
`SOCIAL_SOURCE_LABELS`). ‏`leads.source` נשאר `'store'` - הליד נקנה.

## ב-CRM

- **"הלידים שלי":** צ'יפ "רשתות חברתיות" (‏`leadSrcKey` → `social`). ליד בעלים
  מהרשתות נשאר תחת "לידי בעלים" (הבלעדיות שלו דחופה יותר), וליד שנקנה בחנות -
  תחת "חנות הלידים", עם התווית ב-`source_detail`.
- **בקרת הלידים:** ערוץ `social` ב-`lead_source_channel()` (‏`docs/lead-analytics.md`).

## להגדיר

1. **הסוד:** Supabase → Edge Functions → Secrets → `SOCIAL_LEAD_SECRET` (מחרוזת
   אקראית ארוכה). בלעדיו כל בקשה נענית `503`.
2. **ב-Zernio / אצל גבריאלה:** הכתובת למעלה, וה-header `x-social-lead-secret`
   עם אותו ערך. מפסיקים לקרוא ישירות ל-`property-inquiry-intake` ולחבריה: משם
   המקור החברתי כבר אינו מתקבל.
