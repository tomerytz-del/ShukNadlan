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

## הקבצים

| קובץ | תפקיד |
| --- | --- |
| `supabase/migrations/20260906090000_property_marketing_publish.sql` | התור, הטריגר, פונקציות המשיכה/התפיסה/הסימון, ותזמון ה-cron |
| `supabase/functions/property-marketing-publish/index.ts` | השרת: כותב את הטקסט ב-Claude ומפרסם |
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
פרסום:  Graph API ישיר  או  Make
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
| `FACEBOOK_PAGE_ID` | מסלול Graph | מזהה הדף |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | מסלול Graph | טוקן System User, אינו פג |
| `MAKE_FACEBOOK_WEBHOOK_URL` | מסלול Make | כתובת ה-Webhook מהתרחיש |
| `MAKE_WEBHOOK_SECRET` | ✖️ | נשלח ב-header `x-shuknadlan-secret` |
| `ALERT_CRON_SECRET` | ✖️ | אותו סוד של שרת ההתראות |

צריך **אחד** משני מסלולי הפרסום. אם שניהם מוגדרים — Graph מנצח, כדי
ש-webhook ישן שנשאר בסודות לא יחטוף את הפוסט בשקט. בלי אף אחד
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

## איזה מסלול לבחור

| | Graph API ישיר | Make |
| --- | --- | --- |
| הקמה בפרויקט הזה | קצרה: אפליקציית ה-Meta וה-System User כבר קיימים בזכות בוט הוואטסאפ | בניית תרחיש וחיבור חשבון |
| טוקן | טוקן System User אינו פג | Make מחדש לבד |
| פוסט מרובה תמונות | ממומש בקוד | דורש Iterator + Aggregator בתרחיש |
| ‏`post_url` ביומן | חוזר אוטומטית | רק עם Webhook response |
| תלות חיצונית | אין | נפילה או מיצוי מכסה ב-Make = אין פוסט |
| איפה רואים תקלה | `property_publications.last_error` ולוגים של הפונקציה | ממשק Make, מחוץ למערכת |
| הרחבה לערוצים נוספים | פונקציה/קוד לכל ערוץ | גרירה בתרחיש |

**בפרויקט הזה Graph API הוא ברירת המחדל העדיפה** — פחות חלקים נעים, והחלק
היקר (אפליקציית Meta מאומתת עם System User) כבר קיים. ‏Make מתאים כשרוצים
לפצל את אותו נכס לכמה ערוצים או לשנות את מבנה הפוסט בלי פריסה.

המעבר בין המסלולים הוא שינוי סודות בלבד, בלי נגיעה בקוד.

## מסלול Make

מה שהוא באמת חוסך: התחברות לדף נעשית מרשימה ב-Make, בלי אפליקציית Meta
משלכם ובלי טוקן לתחזק — נוח במיוחד למי שאין לו כבר תשתית Meta.

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

2. **Router / Filter (אופציונלי אך מומלץ)** — תנאי
   `1.headers.x-shuknadlan-secret = <MAKE_WEBHOOK_SECRET>`. בלעדיו כל מי
   שיודע את כתובת ה-webhook יכול לפרסם בדף.

3. **Facebook Pages → Create a Post**
   - **Connection** — התחברות עם החשבון שמנהל את הדף.
   - **Page** — בוחרים את דף shuknadlan מהרשימה.
   - **Message** — `{{1.message}}`.
   - **Photos** — מוסיפים פריט ומכניסים `{{1.images[1]}}`. פוסט מרובה תמונות
     דורש איטרציה (ראו הערה), ותמונה אחת טובה עדיפה על פוסט בלי כלום.

   > **פוסט מרובה תמונות ב-Make:** מוסיפים לפני מודול הפרסום
   > `Facebook Pages → Upload a Photo` עם `Published = No` בתוך **Iterator**
   > על `{{1.images}}`, ואז **Array aggregator** על מזהי התמונות, ומעבירים
   > את התוצאה לשדה `Attached media` של Create a Post. אפשר גם להתחיל
   > מתמונה אחת ולהוסיף את זה בהמשך.

4. **Webhook response (אופציונלי)** — מחזירים
   `{"post_id": "{{3.id}}", "post_url": "https://www.facebook.com/{{3.id}}"}`
   ואז מזהה הפוסט נשמר ביומן שלנו. בלי זה הכול עובד, פשוט בלי הקישור לפוסט.

5. מפעילים את התרחיש (**Scheduling: Immediately**).

> **תזמון:** אין צורך ב-scheduling ב-Make. הקצב נקבע אצלנו — cron כל חמש
> דקות, השהיה של 20 דקות ותקרה יומית. Make רק מפרסם מה שנשלח אליו.

## מסלול Graph API ישיר

בלי מתווך. בפרויקט הזה זה המסלול הקצר יותר, כי התשתית כבר קיימת: בוט
הוואטסאפ רץ על אפליקציית Meta מסוג Business עם System User וטוקן קבוע
(`docs/whatsapp-setup.md` שלב 1). מה שנשאר:

1. **Business Settings → System Users** → אותו System User → **Add Assets**
   → לשייך את דף הפייסבוק בהרשאת ניהול תוכן.
2. **Generate New Token** עם `pages_manage_posts` ו-`pages_read_engagement`.
   טוקן System User אינו פג — זה `FACEBOOK_PAGE_ACCESS_TOKEN`.
3. מזהה הדף (‏Page → About → Page transparency, או
   `GET /me/accounts` עם אותו טוקן) — זה `FACEBOOK_PAGE_ID`.

**אין צורך ב-App Review** כל עוד מפרסמים לדף שנמצא באותו Business שמחזיק
את האפליקציה: ‏Standard Access מכסה נכסים של העסק עצמו. ‏App Review נדרש
רק כדי לפרסם לדפים של משתמשים אחרים.

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
