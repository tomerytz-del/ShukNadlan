# מנוע לידים מפידי RSS — הפעלה

מנוע שאוסף פוסטים מקבוצות ומלוחות דרך RSS, מסנן ומסווג אותם ב-Claude ושומר
לידים ב-Supabase למכירה באתר (Pay-per-lead). רץ בחינם ב-GitHub Actions כל 30 דקות.

## הקבצים

| קובץ | תפקיד |
| --- | --- |
| `scraper.py` | נקודת הכניסה — מריצה את כל הזרימה |
| `lead_engine/config.py` | קריאת משתני הסביבה |
| `lead_engine/feeds.py` | הורדת פידים וניקוי HTML |
| `lead_engine/analyzer.py` | הפרומפט ל-Claude והפלט המובנה |
| `lead_engine/models.py` | סכמת הפלט (Pydantic) ומבני העזר |
| `lead_engine/store.py` | Supabase — מקורות, מניעת כפילויות, שמירה |
| `schema.sql` | טבלאות `rss_sources` ו-`rss_leads` + RLS + view פומבי |
| `.github/workflows/rss_scraper.yml` | תזמון והרצה ידנית |

## שלב 1 — מסד הנתונים

הריצו את `schema.sql` ב-Supabase (SQL Editor → New query → הדבקה → Run).
הקובץ אידמפוטנטי, אפשר להריץ אותו שוב אחרי שינויים.

הוא יוצר:

- `rss_sources` — הפידים שהמנוע קורא, בניהול מנהל/ת הפלטפורמה בלבד.
- `rss_leads` — הלידים. `source_url` הוא UNIQUE — זו רשת הביטחון מפני כפילויות.
- `rss_leads_public` — view לאתר: תקציר שיווקי בלבד, בלי `source_url` ובלי הטקסט הגולמי.

> טבלת `leads` הקיימת (לידים מטופסי האתר) לא מושפעת — לידי ה-RSS יושבים בטבלה נפרדת.

## שלב 2 — סודות ב-GitHub

Settings → Secrets and variables → Actions → **Secrets**:

| שם | מאיפה |
| --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | אותו מסך, מפתח `service_role` |

> ה-`service_role` עוקף RLS. הוא מוגדר כסוד ב-Actions בלבד ולעולם לא בדפדפן.

באותו מסך, תחת **Variables** (לא סודות), אפשר להוסיף אופציונלית:
`CLAUDE_MODEL`, `RSS_FEED_URLS`, `MAX_NEW_LEADS_PER_RUN`, `MIN_SCORE_TO_PUBLISH`.

## שלב 3 — הוספת מקורות

באזור האישי (`crm.html`) → **ניהול מקורות RSS (מנהל פלטפורמה)**. הטאב מוצג רק
למי שמסומן/ת `is_platform_admin`.

ליצירת פיד מקבוצת פייסבוק או מלוח: ב-[rss.app](https://rss.app) מדביקים את
כתובת הקבוצה, מקבלים כתובת מסוג `https://rss.app/feeds/xxxxx.xml` ומדביקים
אותה בשדה הכתובת. המקור נקרא בהרצה הבאה של המנוע.

לכל מקור מוצגים מתי נקרא לאחרונה, כמה פריטים נסרקו וכמה לידים הופקו ממנו,
ואפשר להשהות אותו בלי למחוק.

## שלב 4 — הרצה

- **אוטומטית:** כל 30 דקות (`cron: "*/30 * * * *"`, לפי UTC).
- **ידנית:** Actions → "מנוע לידים RSS" → Run workflow. אפשר לבחור `dry_run`
  (ניתוח בלי שמירה) ו-`limit` (מספר פוסטים מקסימלי — לבדיקה זולה).

הרצה מקומית:

```bash
pip install -r requirements.txt
cp .env.example .env      # ומלאו את שלושת המפתחות
python scraper.py --dry-run --limit 3 --verbose
```

## איך נמנעות כפילויות

1. בתוך ההרצה — אותו קישור שמופיע בכמה פידים נספר פעם אחת.
2. לפני הפנייה ל-Claude — שאילתה אחת ל-Supabase בודקת אילו `source_url` כבר
   קיימים, והם מסוננים החוצה. פוסט שנותח בעבר לא עולה כסף שוב.
3. באינדקס — `UNIQUE` על `source_url` חוסם גם הרצות חופפות.

פוסט שנדחה (מתווך/ספאם/ציון נמוך) נשמר גם הוא, עם `is_lead=false`, כדי שלא
יישלח שוב לניתוח בהרצה הבאה. הוא לא מופיע ב-view הפומבי.

## עלות

הפרומפט הקבוע נשמר במטמון (`cache_control`), ולכן רק תוכן הפוסט עצמו נטען
מחדש בכל קריאה. ניתוח של פוסט טיפוסי הוא כמה מאיות סנט. `MAX_NEW_LEADS_PER_RUN`
(ברירת מחדל 60) חוסם הרצה חריגה שתסרוק מאות פוסטים בבת אחת.
