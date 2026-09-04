# תיאור שיווקי אוטומטי ופרסום לדף הפייסבוק

כל נכס שנכנס לפלטפורמה עובר מעכשיו שני שלבים בלי שאיש יזכור ללחוץ על כפתור:

1. **תיאור שיווקי** — נכס בלי `marketing_description` מקבל אחד מ-Claude, יחד
   עם `post_text` קצר לרשתות. שני השדות כבר היו בטבלה (מיגרציה
   `20260827140000`) ופשוט נשארו ריקים ברוב המודעות.
2. **פוסט בדף הפייסבוק של האתר** —
   [‏shuknadlan](https://www.facebook.com/share/19LytY6L6b/) — עם התמונות,
   נתוני הנכס וקישור לעמוד הנכס.

מה שהסוכן/ת כתב/ה **לא נדרס לעולם**: תיאור שיווקי קיים נשאר כמו שהוא, ופוסט
שנכתב ידנית ב-`post_text` הוא זה שיוצא.

> **שלב 1 כאן הוא היום רשת ביטחון בלבד.** מאז מיגרציה `20260925090000`
> לתיאור השיווקי יש מסלול משלו — `property-description` — שרץ על כל נכס בלי
> קשר לפרסום ברשתות, מקדים את הפוסט בעשר דקות, ומטפל גם בנכסים ותיקים
> ובעדכוני נתונים. הפרומפט ועובדות הנכס משותפים לשני המסלולים
> (`supabase/functions/_shared/marketing-copy.ts`), כך שהטקסט זהה בכל דרך
> שבה הוא נכתב. ראו **`docs/marketing-description.md`**.
>
> המשמעות המעשית: ברוב הפעמים הפוסט כאן ימצא תיאור מוכן ולא יקרא ל-Claude
> בכלל.

## הקבצים

| קובץ | תפקיד |
| --- | --- |
| `supabase/migrations/20260906090000_property_marketing_publish.sql` | התור, הטריגר, פונקציות המשיכה/התפיסה/הסימון, ותזמון ה-cron |
| `supabase/functions/property-marketing-publish/index.ts` | השרת: מרכיב את הפוסט ומפרסם |
| `supabase/functions/_shared/marketing-copy.ts` | הפרומפט ועובדות הנכס — משותף עם `property-description` |
| `docs/facebook-auto-publish.md` | הקובץ הזה |

המיגרציה אידמפוטנטית.

## המסלול, מקצה לקצה

```
נכס נשמר כ-active
        │  טריגר properties_queue_publication
        ▼
property_publications (pending, publish_after = +20 דקות)
        │  pg_cron כל 5 דקות → property-marketing-publish
        ▼
claim_property_publication  ← נועל את השורה מפני הרצה חופפת
        │
        ├── אין marketing_description?  →  Claude כותב תיאור + פוסט  →  נשמר על הנכס
        │
        ▼
פרסום:  Make (מומלץ)  או  Graph API ישיר
        │
        ▼
mark_property_publication → posted + post_id + הטקסט שיצא
```

### למה תור ולא קריאה מהטריגר

אותה בחירה כמו בהתראות הסוכן החכם: קריאת HTTP מתוך טריגר הייתה כובלת את זמן
שמירת הנכס לזמן התגובה של Anthropic ושל Meta, ונפילה של ספק חיצוני הייתה
הופכת לנפילה של שמירת מודעה. התור גם נותן ניסיונות חוזרים בחינם.

### למה 20 דקות השהיה

נכס נשמר לרוב לפני שהתמונות עלו ולפני שהטקסט לוטש. פוסט בפייסבוק לא ניתן
"לעדכן" בדיעבד בלי לאבד את התגובות והשיתופים, ולכן עדיף להמתין. הפרמטר
`facebook_autopost_delay_minutes` ניתן לשינוי, ופרסום ידני מדלג עליו לגמרי.

### למה נכס לא יפורסם פעמיים

שלוש שכבות: `unique (property_id, channel)` בטבלה (גם נכס שנמכר וחזר לשוק לא
מקבל פוסט שני), `claim_property_publication` שנועלת את השורה לפני הפרסום
מפני שתי הרצות חופפות, וסטטוס `posted` שמוציא את השורה מהתור.

## הפרמטרים העסקיים

כולם ב-`pricing_config`, כמו כל מספר עסקי בפרויקט:

| מפתח | ברירת מחדל | מה זה |
| --- | --- | --- |
| `facebook_autopost_enabled` | 1 | מתג הכיבוי. `0` עוצר את הפרסום האוטומטי מיד |
| `facebook_autopost_delay_minutes` | 20 | כמה ממתינים אחרי שמירת הנכס |
| `facebook_autopost_daily_cap` | 12 | תקרת פוסטים ליממה. עודף נשאר בתור ויוצא למחרת |
| `facebook_autopost_max_attempts` | 5 | ניסיונות לפני `failed` (‏30 דקות בין ניסיונות) |

```sql
-- לעצור הכול עכשיו
update pricing_config set value = 0 where key = 'facebook_autopost_enabled';
```

## הנכסים שכבר במערכת

המיגרציה מכניסה את כל הנכסים הקיימים לתור בסטטוס `skipped`. זו החלטה: 61
נכסים שיוצאים כפוסטים ברצף הם הצפה של הדף, לא שיווק. המנגנון מתחיל מהנכס
הבא. לפרסם נכס ותיק — ראו "פרסום ידני" למטה.

## הגדרה — פעם אחת

### 1. סודות ב-Supabase → Edge Functions → Secrets

| סוד | חובה? | הערה |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✅ | אותו מפתח של מנוע ה-RSS |
| `CLAUDE_MODEL` | ✖️ | ברירת מחדל `claude-sonnet-5` |
| `SITE_BASE_URL` | ✖️ | ברירת מחדל `https://shuknadlan.co.il` |
| `MAKE_FACEBOOK_WEBHOOK_URL` | מסלול Make | כתובת ה-Webhook מהתרחיש |
| `MAKE_WEBHOOK_SECRET` | ✖️ | נשלח ב-header `x-shuknadlan-secret` |
| `FACEBOOK_PAGE_ID` | מסלול ישיר | מזהה הדף |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | מסלול ישיר | טוקן דף ארוך-טווח |
| `ALERT_CRON_SECRET` | ✖️ | אותו סוד של שרת ההתראות |

צריך **אחד** משני מסלולי הפרסום. אם שניהם מוגדרים — Make מנצח. בלי אף אחד
מהם הפונקציה מחזירה `publish_not_configured` ולא נוגעת בתור, כך שאפשר לפרוס
הכול לפני שהערוץ מחובר בלי לשרוף ניסיונות.

### 2. פריסת הפונקציה

```bash
supabase functions deploy property-marketing-publish --no-verify-jwt \
  --project-ref obookujgolazrwycsiyn
```

`--no-verify-jwt` הכרחי: ‏`pg_cron` קורא בלי JWT. האימות בפועל הוא סוד
ה-cron ב-header, ובמסלול הידני — JWT של מנהל/ת פלטפורמה או ה-service role
key, שנבדקים בקוד.

### 3. סוד ה-cron (מומלץ)

אם `alert_cron_secret` כבר קיים ב-Vault (הוגדר בשרת ההתראות) — אין מה
לעשות, אותה משימה משתמשת בו. אחרת:

```sql
select vault.create_secret('<סוד אקראי>', 'alert_cron_secret',
                           'הידוק הגישה לשרתי ה-cron');
```

ואותו ערך כ-`ALERT_CRON_SECRET` בסודות ה-Edge Functions.

## מסלול א׳ — Make (מומלץ)

למה זה המסלול המומלץ: ל-Make יש אפליקציית פייסבוק מאושרת משלו. אין צורך
לפתוח אפליקציית Meta, לעבור App Review על `pages_manage_posts`, ולתחזק טוקן
שפג. בוחרים את הדף מרשימה, ו-Make מחדש את ההרשאה לבד.

### התרחיש, מודול אחר מודול

1. **Webhooks → Custom webhook** — יוצרים webhook חדש בשם `shuknadlan-facebook`
   ומעתיקים את הכתובת ל-`MAKE_FACEBOOK_WEBHOOK_URL`.
   כדי ש-Make ילמד את מבנה הנתונים: לוחצים **Redetermine data structure**,
   ואז מריצים פרסום ידני אחד (ראו למטה) — המבנה ייקלט מהקריאה האמיתית.

   מה שנשלח:

   ```json
   {
     "property_id": "uuid",
     "listing_number": 1042,
     "message": "הפוסט המלא, מוכן לפרסום",
     "link": "https://shuknadlan.co.il/property.html?id=...",
     "images": ["https://.../1.jpg", "https://.../2.jpg"],
     "title": "...", "price": 1850000, "deal_type": "sale",
     "property_type": "דירה", "rooms": 4, "size_sqm": 98, "floor": 3,
     "city": "עפולה", "neighborhood": "רובע יזרעאל", "street": "הרצל",
     "agent_name": "...", "agency_name": "..."
   }
   ```

   `message` הוא הפוסט המוכן — אפשר להעביר אותו כמו שהוא. שאר השדות נשלחים
   כדי שאפשר יהיה לבנות ב-Make תבנית משלכם או תמונה מעוצבת בלי לפרסר טקסט.

   `images` הוא **עד חמש** כתובות, והראשונה היא התמונה השיווקית המעוצבת אם
   יש כזו. התקרה היא של השרת ולא של Make: לנכס יכולות להיות תשע תמונות,
   ובתרחיש עם Iterator כל תמונה היא איטרציה ומודול העלאה — כלומר פי שלושה
   פעולות בחבילה על נכס אחד, ופוסט שגולל. **המערך יכול להיות ריק** (‏12
   מתוך 60 הנכסים הפעילים היום בלי תמונות), ולכן התרחיש חייב מסלול נפרד
   לנכס בלי תמונות — ראו את ה-Router למטה.

2. **Router / Filter (אופציונלי אך מומלץ)** — תנאי
   `1.headers.x-shuknadlan-secret = <MAKE_WEBHOOK_SECRET>`. בלעדיו כל מי
   שיודע את כתובת ה-webhook יכול לפרסם בדף.

3. **Router** — שני מסלולים, כי מספר התמונות משתנה מנכס לנכס:

   ```
   Webhook (1) ─ Filter: secret ─ Router ─┬─ [images > 0] Iterator (2) → Array aggregator (3) → Create a Post with Photos (4)
                                          └─ [Fallback]   Create a Post עם Link (5)
   ```

   **למה Router ולא Iterator לבד:** ‏Iterator על מערך ריק מייצר אפס
   bundles, וכל מה שאחריו פשוט לא רץ. נכס בלי תמונות היה מקבל 200 מ-Make,
   מסומן `posted` אצלנו — ופוסט שלא קיים בדף. הסתעפות מפורשת הופכת את זה
   לפוסט קישור במקום לשקט.

   על המסלול הראשון מגדירים תנאי: `{{length(1.images)}}` **Greater than**
   `0`. המסלול השני מסומן **Fallback route** (מפתח ברגים על הנתיב).

4. **מסלול א׳ — פוסט מרובה תמונות**

   המודול הוא **Facebook Pages → Create a Post with Photos**. הוא עושה
   בפנים את כל תהליך ה-`published=false` + `attached_media` שהמסלול הישיר
   עושה ביד, ולכן אין צורך במודול העלאה נפרד.

   - **Iterator** (מודול 2) — `Array` = `{{1.images}}`. כל איטרציה מחזירה
     כתובת אחת ב-`{{2.value}}`.
   - **Array aggregator** (מודול 3) — `Source module` = ה-Iterator, ובשדה
     **`Target structure type`** בוחרים
     `Facebook Pages – Create a Post with Photos → Photos`. זו הנקודה
     שהופכת מערך מחרוזות למערך במבנה שהשדה מצפה לו. בתוך המבנה שנפתח:
     `Image input type` = **האפשרות של כתובת URL**, ו-`URL` = `{{2.value}}`.
   - **Create a Post with Photos** (מודול 4) — **Page** = הדף,
     **Message** = `{{1.message}}`, ובשדה **Photos** מדליקים את מתג
     ה-**Map** ומעבירים `{{3.array}}`.

   > **‏`Image input type` הוא המלכודת.** ברירת המחדל
   > `Map from previous module` מתכוונת לקובץ בינארי, ולכן היא דורשת
   > `File name` ו-`Data` ונצבעת אדום. אנחנו שולחים כתובות ציבוריות
   > (‏bucket `property-images` פתוח לקריאה), ולכן צריך את אפשרות ה-URL.

   > **להתחלה מהירה:** לפני שמוסיפים Iterator ו-aggregator, אפשר להשאיר
   > פריט אחד בשדה `Photos` עם `URL` = `{{1.images[1]}}`. זה מאמת חיבור,
   > דף והרשאות בפוסט אחד עם תמונה אחת, ורק אז מרחיבים.

5. **מסלול ב׳ — Fallback, נכס בלי תמונות**

   `Photos` הוא שדה חובה במודול של מסלול א׳, ולכן הוא לא יכול לרוץ על נכס
   בלי תמונות. כאן משתמשים במודול **Create a Post** הרגיל (מודול 5):
   **Message** = `{{1.message}}`, **Link** = `{{1.link}}`. פייסבוק ימשוך
   תצוגה מקדימה מעמוד הנכס — אותה התנהגות בדיוק כמו במסלול הישיר.

6. **Webhook response (אופציונלי)** — מודול `Webhooks → Webhook response`
   בסוף כל מסלול, עם
   `{"post_id": "{{4.id}}", "post_url": "https://www.facebook.com/{{4.id}}"}`
   (ובמסלול ה-fallback `{{5.id}}`). אז מזהה הפוסט נשמר ביומן שלנו. בלי זה
   הכול עובד, פשוט בלי הקישור לפוסט בטבלה.

7. מפעילים את התרחיש (**Scheduling: Immediately**).

> **מספרי המודולים** הם אלה של Make ומשתנים לפי סדר הבנייה. הכלל: `1` הוא
> תמיד ה-Webhook, ומה שמפנים אליו הוא המודול שמייצר את השדה — לא מספר קבוע.

> **תקציב פעולות:** נכס עם חמש תמונות = ‏1 webhook + 1 iterator + 5
> איטרציות + 1 aggregator + 1 פרסום ≈ **9 פעולות**. בתקרה של 12 פוסטים
> ליום זה כ-110 פעולות ביום, בערך 3,300 בחודש — בתוך החבילה החינמית של
> Make (1,000 פעולות) רק אם מורידים את `facebook_autopost_daily_cap`;
> בחבילת Core (10,000) יש מרווח נוח.

> **תזמון:** אין צורך ב-scheduling ב-Make. הקצב נקבע אצלנו — cron כל חמש
> דקות, השהיה של 20 דקות ותקרה יומית. Make רק מפרסם מה שנשלח אליו.

## מסלול ב׳ — Graph API ישיר

בלי מתווך, אבל דורש עבודה מול Meta: אפליקציה עם ההרשאות
`pages_manage_posts` + `pages_read_engagement`, טוקן דף ארוך-טווח (עדיף
System User token מ-Business Manager, שאינו פג), ומעבר App Review לפני
שהדף מפרסם בפרודקשן.

מגדירים `FACEBOOK_PAGE_ID` ו-`FACEBOOK_PAGE_ACCESS_TOKEN` **בלי**
`MAKE_FACEBOOK_WEBHOOK_URL`. הקוד מעלה עד 5 תמונות כ-`published=false`,
ואז יוצר פוסט אחד ב-`/feed` עם `attached_media` — זו הדרך היחידה לפוסט
מרובה תמונות; ‏`/photos` לבדו היה מייצר חמישה פוסטים לאותו נכס. בלי תמונות
נוצר פוסט קישור.

## פרסום ידני, בדיקה יבשה, ופרסום מחדש

```bash
# בדיקה יבשה: מייצר את הטקסט ומחזיר אותו, בלי לפרסם ובלי לגעת בתור
curl -X POST "$SUPABASE_URL/functions/v1/property-marketing-publish" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"property_id":"<uuid>","dry_run":true}'

# פרסום נכס מסוים עכשיו — עוקף השהיה, תקרה יומית ומתג כיבוי
curl -X POST "$SUPABASE_URL/functions/v1/property-marketing-publish" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"property_id":"<uuid>"}'

# ‏force מוסיף כתיבה מחדש של התיאור השיווקי גם אם הוא כבר קיים
  -d '{"property_id":"<uuid>","force":true}'
```

`force` דורס את `marketing_description` בלבד. `post_text` שנכתב ידנית נשאר
גם ב-`force` — המערכת משלימה מה שחסר, לא מחליפה מה שנכתב ביד.

`dry_run` מראה רק נכס שממתין בתור ממילא, ובכוונה: אילו הצצה בטקסט הייתה
מחזירה נכס שכבר פורסם לתור, היא הייתה מזמינה לו פוסט שני בהרצה הבאה. על נכס
שכבר פורסם התשובה תהיה `processed: 0` עם הסבר.

מ-SQL אפשר גם רק להחזיר נכס לתור, בלי לפרסם מיד:

```sql
select queue_property_publication('<property-id>', 'facebook_page', true);
```

## מעקב

```sql
-- מה קרה בשבוע האחרון
select p.title, pub.status, pub.attempts, pub.posted_at, pub.post_url,
       pub.description_generated, pub.last_error
  from property_publications pub
  join properties p on p.id = pub.property_id
 where pub.created_at > now() - interval '7 days'
 order by pub.created_at desc;

-- מה תקוע
select * from property_publications
 where status = 'failed' or (status = 'pending' and attempts > 0);
```

`message` על השורה הוא הטקסט שיצא בפועל — שם בודקים מה באמת פורסם, ולא
משחזרים אותו מהנכס (המודעה יכולה להשתנות מחר, הפוסט לא).

`description_generated` מפריד בין נכס שהגיע עם נוסח של הסוכן/ת לנכס שקיבל
נוסח מ-Claude — השאלה הראשונה בכל בדיקת איכות של הטקסטים.

## מה הפרומפט אוסר

הכלל החשוב הוא "רק מה שכתוב". מודל שמוסיף "קרוב לפארק" לנכס שלא נאמר עליו
דבר יוצר מודעה שקרית, וזו חשיפה משפטית של הפלטפורמה — לא רק טקסט פחות טוב.
לצידו: אין הבטחות תשואה או הצהרות על מגמות מחירים, אין אזכור מוצא/דת/לאום
או הרכב משפחתי (איסור אפליה בדיור), ואין טלפונים או קישורים בטקסט של המודל
— המערכת מוסיפה אותם בעצמה.

## עלות

קריאה אחת ל-Claude לכל נכס חדש שאין לו תיאור, בערך 1,500 טוקנים סך הכול —
שברירי אגורות למודעה. הפרסום עצמו חינם בשני המסלולים (‏Make נספר כשתיים או
שלוש פעולות בחבילה שלכם).

## מה אין כאן, ולמה

- **אין ממשק ב-CRM.** התור מנוהל ב-SQL ובפונקציה. אם יתברר שצריך לפרסם
  ידנית לעיתים קרובות, כפתור "פרסם בפייסבוק" בכרטיס הנכס הוא קריאה אחת
  ל-Edge Function עם `property_id` — האימות ל-JWT של מנהל/ת פלטפורמה כבר
  קיים בקוד.
- **אין אינסטגרם.** העמודה `channel` בטבלה מוכנה לכך, אבל היא עם `check`
  צר בכוונה: ערוץ חדש הוא החלטה מפורשת ולא טעות הקלדה.
- **אין עדכון פוסט קיים כשהמחיר משתנה.** פייסבוק לא מאפשר לערוך פוסט בלי
  לאבד את המעורבות, ופוסט שני על אותו נכס הוא ספאם.
