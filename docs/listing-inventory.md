# מלאי מודעות מיד2 וממדלן

סורק חיצוני מעדכן פעמיים ביום מה שחי עכשיו באתר, לפי עיר. המסד שומר את
המלאי, מסמן מודעה שירדה, ופותח ליד לסוכנים רק על מודעה חדשה. אין פניה
לבעלים: לא בקשת הסכמה, לא הודעה ולא תזכורת. ליד כזה לא נמכר
(`quota_source` `yad2_free` או `madlan_free`).

המיגרציה: `20271112130000_listing_inventory_yad2.sql`.
הקליטה: `listing-inventory-intake`. הכללים של הליד עצמו:
`docs/scraped-leads.md`.

## מה נשמר, ומה לא

`listing_inventory` - שורה אחת לכל `(source, external_ref)`:

| עמודה | משמעות |
| --- | --- |
| `source` | `yad2` או `madlan` |
| `external_ref` | המזהה הקנוני (`scraped_lead_ref`: בלי `www.`/`m.`, בלי פרמטרי מעקב) |
| `city`, `city_id` | העיר של הסנכרון. `city_id` מ-`city_id_for_name`, או ריק אם השם לא מוכר |
| `deal_type`, `property_type`, `rooms`, `price`, `url` | מה שהסורק ראה |
| `first_seen_at`, `last_seen_at` | מתי נראתה לראשונה, ומתי לאחרונה |
| `removed_at` | מתי ירדה מהאוויר. מתאפס אם חזרה |
| `scraped_lead_id` | הליד שנוצר, אם נוצר. נמחק איתו אחרי 30 יום |
| `from_seed` | נכנסה בזריעה, כולל השלמה של זריעה חלקית, ולא הופכת לליד |
| `lead_offered_at` | מתי נוצר ליד. נשאר אחרי המחיקה, כדי לא להציע שוב לפני 30 יום |
| `lead_skip_reason`, `lead_attempted_at` | למה הקליטה נדחתה, ומתי. לא מנסים שוב 30 יום |
| `lead_attempt_fingerprint` | sha256 של ספרות הטלפון והמחיר בזמן הדחייה. לא הטלפון עצמו |

**אין עמודת טלפון ואין עמודת שם.** הטלפון עובר רק אל `scraped_lead_add`,
ונשמר בשורת `scraped_leads` לפי הכללים שכבר שם (מחיקה אחרי 30 יום מהקליטה,
בלי איחוד של מספר `073` במדלן).

RLS דלוק. אין `grant` ל-`anon` או ל-`authenticated`. הכתיבה היא
`service_role` בלבד, דרך `listing_inventory_sync`.

## הסנכרון

```sql
select public.listing_inventory_sync('yad2', 'עפולה', '[...]'::jsonb);
```

החתימה: `listing_inventory_sync(p_source text, p_city text, p_items jsonb)`.
`p_items` הוא המלאי **החי** של העיר הזו בלבד. קריאה אחת לעיר.

| תוצאה | מתי |
| --- | --- |
| `seeded: true` | זריעה שקטה: הראשונה של העיר, או השלמה (`seed_catchup`) כשבתוך `listing_inventory_seed_catchup_days` (2) התמונה גדולה לפחות פי `listing_inventory_seed_catchup_ratio` (2) מהזריעה האחרונה. בלי לידים ובלי התראות |
| `new_leads` | מודעה שלא הייתה במלאי, אחרי שכבר היה סנכרון מלא. נכנסת ל-`scraped_lead_add` עם `date_known = true` |
| `removed` | שורה פעילה של אותה עיר ומקור שלא בתמונה. `removed_at` מתמלא |
| `removals_skipped: true` | התמונה ריקה, או קטנה מ-`listing_inventory_min_snapshot_ratio` (ברירת מחדל 0.5) מתוך המלאי הפעיל. לא מוחקים |
| `added`, `updated` | שורות חדשות, ושורות שכבר היו (כולל מחיר שעודכן ומודעה שחזרה) |

התשובה: `{added, updated, removed, new_leads, seeded, removals_skipped}`.
שגיאה: `{error}` - `invalid_source`, `missing_city`, `invalid_items`,
`too_many_items` (מעל 2,000).

קריאה חוזרת של אותה תמונה לא פותחת ליד שני. שתי קריאות במקביל לאותה עיר
ננעלות (`pg_advisory_xact_lock`) ורצות אחת אחרי השנייה.

מודעה שהליד שלה נמחק אחרי 30 יום מוצעת שוב רק אם היא **עדיין בתמונה**
ועברו 30 יום מ-`lead_offered_at`. מודעה עם `removed_at` לא מוצעת.

ההתראה לא נשלחת מכאן. `scraped_lead_add` קורא ל-`scraped_lead_notify_demand`,
ותקרת `madlan_notify_daily_cap` (מדלן ויד2 יחד) קובעת כמה מהן נדחפות.
השאר נשארות באתר (`push_site_only`). שעות השקט ותקרת התבניות נשארות
ב-`notification-push`.

סריקה חלקית שנדחתה לא נספרת כסנכרון הראשון. העיר נזרעת רק מתמונה שאינה
קטנה מדי.

יומן בלי טלפון: `listing_inventory_sync_log` (`note` הוא `seed`,
`seed_catchup`, `empty_snapshot`, `snapshot_too_small` או `ok`).

זריעה של קומץ מודעות ואז המלאי המלא, בתוך יומיים ולפחות פי שניים, נחשבת
אותה זריעה. המודעות הנוספות מסומנות `from_seed` ולא נפתח עליהן ליד. אחרי
החלון, או כשהתמונה גדלה בפחות מהיחס, מודעה חדשה כן נפתחת. `0` בימי החלון
מכבה את ההשלמה.

קליטה שנדחתה (`missing_phone`, כפילות טלפון וכדומה) נרשמת ב-
`lead_skip_reason`. אותו טלפון ואותו מחיר לא מנוסים שוב עד 30 יום. שינוי
בספרות הטלפון או במחיר מנסה מיד. הצלחה מוחקת את הדחייה.

## הקליטה

`POST /functions/v1/listing-inventory-intake`

```
x-listing-intake-secret: <LISTING_INTAKE_SECRET>
Content-Type: application/json
```

הסוד מוגדר ב-Supabase → Edge Functions → Secrets בשם
`LISTING_INTAKE_SECRET`. בלי הסוד הפונקציה עונה 503. הסוד לא נכתב לריפו
(שורה ב-`.env.example` בלבד). ההשוואה היא בזמן קבוע. `verify_jwt = false`
כי לסורק אין JWT.

גוף הבקשה, עד 1,000,000 בתים (לא תווים) ועד 2,000 מודעות. `Content-Length`
מעל התקרה נדחה לפני הקריאה. בלי הכותרת, או כשהיא קטנה מהגוף, הקריאה
נעצרת ברגע שהבתים עוברים את התקרה:

```json
{
  "source": "yad2",
  "city": "עפולה",
  "items": [
    {
      "url": "https://www.yad2.co.il/realestate/item/abc123",
      "deal_type": "sale",
      "property_type": "דירה",
      "rooms": 4,
      "price": 1500000,
      "raw_phone": "052-111-1111",
      "summary": "דירת 4 חדרים, בעלים פרטיים"
    }
  ]
}
```

`url` חייב להתחיל ב-`https://`. `external_ref` מתקבל אם אין `url`, וגם הוא
חייב להיות `https://`. `deal_type` הוא `sale` או `rent`. `raw_phone` נדרש
כדי שייווצר ליד. בלי מספר, או כשהמספר כבר מוכר, המודעה נשמרת במלאי והדחייה
נרשמת. אותו מספר ואותו מחיר לא מנוסים שוב עד 30 יום.
`summary` עד 160 תווים, בלי שם, טלפון או כתובת. `raw_name` אופציונלי ולא
נשמר במלאי.

פריט בלי כתובת תקינה מדולג. אם אחרי הדילוג התמונה קטנה מדי, המחיקות
מודלגות והיומן רושם את זה.

תשובה 200 היא תשובת ה-RPC. תשובה 400 היא שגיאת צורה (`invalid_source`,
`missing_city`, `invalid_items`, `too_many_items`, `invalid_json`,
`invalid_payload`). 401 בלי הסוד הנכון, 413 מעל הגודל, 503 אם הסוד לא
הוגדר, 405 לכל מתודה שאינה POST.

## גבריאלה מצביעה על המודעה

כשגבריאלה מחפשת נכס לסוכן/ת (`search_properties`) או מתאימה ללקוח/ה
(`client_matches`), היא קוראת גם את המלאי החי. זה מקור שלישי, אחרי
הנכסים של הסוכן/ת ושל המשרד (`source = agency` כבר מכסה את המשרד).

התוצאה היא `board_listings`, לא שורה בתוך הנכסים שלו/ה. הכותרת:
"מודעות מהלוחות יד 2 / מדלן". הקישור יוצא ככפתור CTA בלבד, עד 5, עם
כמה עוד יש. אין טלפון ואין שם, אין פנייה לבעלים, אין חיוב, ואין ליד
או התראה מהחיפוש הזה. התראות על מודעה חדשה נשארות ב-`scraped_lead_add`
עם התקרה היומית המשותפת.

הסינון: `city_id` (קבוצת יישובים מתרחבת), `deal_type`, `property_type`,
`rooms`, `price`, ורק `removed_at is null`. בלי עיר בבקשה - ערי השוק
של המשרד. כשל או מלאי ריק נבלעים. אין במלאי כתובת רחוב.

האינדקס לחיפוש: `listing_inventory_active_city_deal_idx`
(`20271112170000`). הקריאה היא `service_role` מ-Edge Function.
אין RPC פתוח.
