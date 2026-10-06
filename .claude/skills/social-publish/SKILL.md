---
name: social-publish
description: פרסום נכס לדף הפייסבוק ולחשבון האינסטגרם של שוק נדל״ן - פרסום ידני של נכס לערוץ מסוים, מילוי החשבון בכמה פוסטים, בחירת נכסים, ומה עושים כשפרסום נכשל בלי ליצור פוסט כפול (הקפאת השורה, History ב-Make, סימני [make-unconfirmed] ו-[make-scenario-off]). Use when asked to post/publish/share a property to Facebook or Instagram, to "fill" the Instagram account with posts, when a post failed or "Scenario failed to complete", when a post went up twice, or when a property never reached Instagram.
---

# פרסום לרשתות

התור `property_publications` מפרסם לבד כל נכס חדש, בשני ערוצים
(`facebook_page`, `instagram`). הסקיל הזה הוא לכל מה **שאינו** אוטומטי:
פרסום ידני, מילוי חשבון, וטיפול בכישלון. המסמך המלא:
`docs/facebook-auto-publish.md`.

**הכלל שמעל הכול: כישלון אינו הוכחה שלא פורסם.** ‏Make יכול להיכשל
**אחרי** שהפוסט עלה (למשל במודול ה-Webhook response), והתשובה אלינו זהה.
ניסיון חוזר עיוור הוא בדיוק מה שיצר את הפוסטים הכפולים בפייסבוק. לכן:
מקפיאים, מבררים, ורק אז שולחים שוב.

## 1. פרסום נכס לערוץ

אין צורך במפתח service_role. הקריאה יוצאת מהמסד עצמו, עם סוד ה-cron
שב-vault (‏`execute_sql` של Supabase MCP - זו קריאה, לא DDL):

```sql
select net.http_post(
  url := 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/property-marketing-publish',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-alert-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='alert_cron_secret')),
  body := jsonb_build_object('property_id','<uuid>','channel','instagram'),
  timeout_milliseconds := 120000) as req;
```

- בלי `channel` - פייסבוק. ‏`"dry_run": true` מחזיר את הכיתוב בלי לפרסם
  ובלי ליצור שורה בתור.
- פרסום ידני עוקף השהיה, תקרה יומית ומתג כיבוי - ולכן **גם** אינו עוצר
  אם הנכס כבר פורסם בערוץ. זה עליך לבדוק (סעיף 2).
- פוסט לאינסטגרם לוקח **כדקה עד שתיים**. ‏`execute_sql` נחתך אחרי 60
  שניות, ולכן ממתינים בשאילתות קצרות (`select pg_sleep(40); select …`)
  ולא באחת ארוכה.
- **אחד אחרי השני, לא במקביל.** כל אחד נגמר (‏`posted` או שגיאה) לפני
  הבא - כך כשל אחד לא מסתתר בין ארבעה.

התוצאה:

```sql
select channel, status, post_id, attempts, last_error, posted_at
  from property_publications where property_id = '<uuid>';
```

‏`posted` **עם** `post_id` - עלה ואומת. ‏`pending` עם `last_error` - נכשל,
ועובר לסעיף 3 **עכשיו**, לפני ה-cron הבא (כל חמש דקות).

## 2. מילוי החשבון: איזה נכסים

```sql
with c as (
  select p.id, p.listing_number, p.title, m.display_name agent, a.name agency,
         (select count(*) from unnest(p.images) u where u ~* '\.(jpe?g)(\?|$)') jpgs,
         row_number() over (partition by p.agent_id order by p.created_at desc) rn
    from properties p
    left join agency_members m on m.id = p.agent_id
    left join agencies a on a.id = p.agency_id
   where p.status = 'active'
     and not exists (select 1 from property_publications pp
                      where pp.property_id = p.id and pp.channel = 'instagram')
)
select * from c where rn = 1 and jpgs > 0 order by listing_number desc limit 15;
```

- **מתווך/ת אחד/ת לכל פוסט** (`rn = 1`), ועדיף ממשרדים שונים. חשבון
  שכל הפוסטים בו של אותו משרד נראה כמו חשבון של המשרד.
- **JPEG בלבד** - אינסטגרם דוחה PNG/WebP, והקוד מסנן אותם. נכס בלי JPEG
  יסומן `skipped`.
- `not exists` על הערוץ - נכס שכבר עלה לא נשלח שוב.
- נכס של המשתמש/ת עצמו/ה (בעל/ת הפלטפורמה) - לשאול לפני שבוחרים אותו.

## 3. פרסום שנכשל

### א. להקפיא, מיד

השורה נשארת `pending`, וה-cron ינסה שוב תוך דקות. לפני כל בירור:

```sql
update property_publications set publish_after = now() + interval '7 days'
 where property_id = '<uuid>' and channel = '<channel>' and status = 'pending';
```

### ב. לברר מה קרה

`last_error` אצלנו מראה רק `make instagram 500: Scenario failed to complete`.
**הסיבה האמיתית נמצאת רק ב-Make**, ואין לנו גישה אליו מכאן - מבקשים
מהמשתמש/ת צילום מסך:

> ‏Make → התרחיש (`shuknadlan-instagram` או הפייסבוק) → **History** → ההרצה
> האדומה → המודול עם סימן הקריאה.

ובמקביל - **האם הפוסט עלה בכל זאת?** מבקשים שיציצו בחשבון.

| השגיאה ב-Make | משמעות | מה עושים |
| --- | --- | --- |
| במודול הפרסום (קרוסלה/תמונה) | לא עלה | מתקנים ושולחים שוב |
| במודול ה-Webhook response, אחרי פרסום | **עלה** | מסמנים `posted` ידנית, לא שולחים |
| `The aspect ratio is not supported (36003)` | תמונה מחוץ ל-4:5..1.91:1 | ‏`fitForInstagram` חותכת; תמונה שאינה ב-Storage שלנו אינה נחתכת |
| `Media ID is not available (9007)` | אינסטגרם עוד עיבדה את התמונות כש-Make פרסם | התור שולח שוב לבד; לוודא בחשבון שאין פוסט כפול. שכיח - ‏Sleep לפני מודול הקרוסלה |
| `Missing value of required parameter 'files'` | האגרגטור לא ממופה | ‏Target structure של האגרגטור, `Files` = `{{5.array}}` |
| פילטר שלא עבר | אופרטור Time במקום Numeric | ‏Numeric: ‏`image_count ≥ 2` / `= 1` |

### ג. לסמן פוסט שעלה

```sql
update property_publications
   set status = 'posted', posted_at = now(), last_error = '[manual] אומת בחשבון'
 where property_id = '<uuid>' and channel = '<channel>';
```

### ד. לשלוח שוב, אחרי תיקון

```sql
update property_publications set publish_after = now(), last_error = null
 where property_id = '<uuid>' and channel = '<channel>' and status = 'pending';
```

ואז הקריאה מסעיף 1.

## 4. הסימנים ב-`last_error`

| סימן | מה קרה | לנסות שוב? |
| --- | --- | --- |
| `[make-scenario-off]` | התרחיש ב-Make כבוי. ‏Make עונה "Accepted" ושומר בתור שלו - וכשידליקו אותו, **הכול יתפרסם בבת אחת** | רק אחרי שהתרחיש דלוק **והתור שלו ב-Make רוקן** |
| `[make-unconfirmed]` | ‏Make ענה בלי `post_id`. ייתכן שעלה | **לעולם לא** בלי לבדוק בחשבון |

והסוכן התפעולי מתריע על תרחיש כבוי בערוץ דלוק (`make_scenario_off`,
קריטי) - `docs/ops-agent.md`.

## 5. מה אינסטגרם לא מאפשרת

- **אין עריכת כיתוב** דרך ה-API. טעות בפוסט שעלה = נוסח מתוקן שהמשתמש/ת
  מדביק/ה ידנית באפליקציה. אותו דבר בפייסבוק דרך Make.
- **קישור בכיתוב אינו לחיץ** - גם לא קצר, וגם לא בטקסט של הביו. לכן
  הכיתוב אינו נושא כתובת בכלל: הוא מפנה לקישור שבביו (הנוסח לפי המסלול, `postCta`) ואת
  מספר המודעה. הקישור בשדה *Links* של הפרופיל מוביל ל-`/instagram` -
  הפוסטים לפי מספר מודעה (`instagram_feed()`). ‏`/p/1162`
  (‏`short-link.ts`) נשאר לקישור ידני: סטורי, וואטסאפ.
- **נכסים ותיקים לא נכנסים לתור** כשמדליקים ערוץ. מפרסמים אותם ידנית,
  לפי סעיף 2.

## 6. מה **לא** עושים

- **לא** `apply_migration` ולא DDL - כל שינוי סכימה בקובץ מיגרציה
  (הסקיל `new-migration`). ‏`update` על שורה בתור הוא נתונים, ומותר.
- **לא** מדליקים `instagram_autopost_enabled` / `facebook_autopost_enabled`
  ולא משנים תקרה יומית בלי בקשה מפורשת.
- **לא** שולחים שוב שורה שנכשלה לפני סעיף 3.
- **לא** מבקשים מהמשתמש/ת את מפתח ה-service_role - הקריאה מסעיף 1 אינה
  צריכה אותו.
