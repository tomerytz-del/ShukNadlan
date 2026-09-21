---
name: new-migration
description: כתיבת מיגרציה ל-Supabase בריפו של שוק נדל״ן — שם קובץ, אידמפוטנטיות, ואיסור החלת DDL מחוץ לצינור. Use when changing the database schema, adding a table/column/index/policy/function/trigger, writing a file under supabase/migrations, or when db push fails with "Remote migration versions not found".
---

# מיגרציה חדשה

## הכלל היחיד שאסור להפר

**שינוי סכימה נכנס רק כקובץ ב-`supabase/migrations/`.**

אסור להחיל DDL דרך `apply_migration` של Supabase MCP, דרך הדשבורד, או דרך
`psql` ידני — גם לא "רק כדי לבדוק", וגם לא כשזה נראה כמו הדרך המהירה.

**למה זה שובר:** כל כלי כזה רושם את ההחלה ב-
`supabase_migrations.schema_migrations` תחת `version` של **רגע ההרצה**,
ולא תחת ה-version שבשם הקובץ. נוצרת רשומה שאין לה קובץ מקומי, ו-`db push`
מסרב לרוץ בגללה — ל**כל** המיגרציות שאחריה, גם החדשות לגמרי:

```
Remote migration versions not found in local migrations directory.
```

הכשל ערמומי כי הסכימה עצמה **נכונה**: העמודה נמצאת שם, האתר עובד, ורק
הצינור מת. כך זה קרה ב-2.9.2026 (PR #137), וההרצה הבאה נפלה.

**קריאה מותרת ומומלצת** — `execute_sql` עם `select`, בדיקת סכימה, שמות
עמודות, ספירת שורות. הגבול הוא בכתיבת DDL בלבד.

זו גם הדרך הנכונה לאמת מיגרציה לפני שדוחפים: להריץ את גוף ה-`select`
שבתוכה כשאילתה רגילה ולראות שהתוצאה נכונה.

## שם הקובץ

```
supabase/migrations/YYYYMMDDHHMMSS_שם_קצר.sql
```

ה-version חייב להיות **ייחודי וגדול מהאחרון**. version כפול — קורה בין
שני PR-ים מקבילים — מפיל את כל ה-job **בצעד השלישי, לפני שהוא נוגע
במסד**, ולכן גם המיגרציות התקינות של אותו מיזוג דולגות וכל push עתידי
ל-main נכשל עד שזה נפתר. זה קרה כאן ארבע פעמים.

```sh
ls supabase/migrations | tail -3     # ממה להמשיך
python3 scripts/check_migration_versions.py --base-ref origin/main
```

הבדיקה חוסמת ב-CI. **ומה שהיא אינה תופסת:** ‏PR אחר שמוזג אחרי שה-PR
שלכם עבר ירוק ולוקח את אותו מספר — בדיוק מה שקרה ב-`20261225090000`,
‏25 שניות לפני המיזוג. לכן לפני מיזוג, כשיש עוד PR פתוח שנוגע
במיגרציות, שווה למשוך את הבסיס ולהריץ שוב.

## חמישה כללי כתיבה

### 1. אידמפוטנטית — היא עלולה לרוץ שוב

```sql
alter table x add column if not exists y text;
create or replace function …
create index if not exists …

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'my_check') then
    alter table x add constraint my_check check (…);
  end if;
end $$;
```

### 2. `create or replace view` — עמודה חדשה **בסוף** בלבד

הכנסת עמודה באמצע מפילה את ההחלפה.

### 3. הקוד והמיגרציה באותו PR

זו כל הנקודה. אחרת ה-HTML באוויר והסכימה לא.

### 4. פונקציה חדשה — להחליט על ההרשאות במפורש

ברירת המחדל של Postgres היא `EXECUTE` ל-`PUBLIC`, ו-PostgREST חושף כל
פונקציה ב-`/rest/v1/rpc/<שם>`. פונקציה `SECURITY DEFINER` שכותבת למסד
ואין בה בדיקת הרשאה היא **נקודת קצה פתוחה לכל אנונימי/ת**:

```sql
-- פונקציה שנקראת רק מ-Edge Function או מ-cron
revoke all on function public.my_fn(uuid) from public, anon, authenticated;
grant execute on function public.my_fn(uuid) to service_role;
```

**‏`from public` לבדו אינו מספיק, וזו המלכודת.** ‏Supabase מגדירה הרשאות
ברירת מחדל שמעניקות `EXECUTE` ל-`anon`, ל-`authenticated` ול-`service_role`
על כל פונקציה חדשה בסכימה `public` — כהרשאות **ישירות**, לא דרך `PUBLIC`.
לכן `revoke ... from public` מוריד את הרשאת ה-`PUBLIC` של Postgres ומשאיר
את שלושתן כפי שהיו, וה-`grant` שאחריו **מוסיף** ואינו מחליף. חייבים למנות
את התפקידים בשם — **את כולם**.

זה קרה שלוש פעמים:

| מיגרציה | מה נשאר פתוח |
| --- | --- |
| ‏`20261112090000` | חמש פונקציות **כתיבה** ל-`anon` |
| ‏`20261226090000` | ‏`city_id_from_address` ועוד ארבע ל-`anon`, חודש אחרי הראשונה |
| ‏`20261227090000` | ‏`order_lead_candidates` ל-**`authenticated`**, כי הסגירה הקודמת מנתה `public` ו-`anon` בלבד |

השורה הבטוחה מונה את שלושתם, וגם כשזה נראה מיותר:

```sh
python3 scripts/check_function_grants.py
```

הבדיקה חוסמת ב-CI `grant` שמדיר `anon` או `authenticated` בלי `revoke`
שמוציא אותו בפועל.

ואם היא כן נועדה לדפדפן — עדיף `SECURITY INVOKER` (ברירת המחדל), כדי
ש-RLS ימשיך לחול. `SECURITY DEFINER` רק כשצריך לעקוף אותו במכוון, ואז
עם בדיקת קורא/ת בפנים (`current_is_platform_admin()`, `auth.uid()`).

התקדים: חמש פונקציות כאלה היו פתוחות ל-`anon`, ואחת מהן אפשרה לשנות את
המסלול של כל מנוי/ה בשתי בקשות HTTP בלי התחברות.

### 5. גרש בתוך מחרוזת מוכפל, ולא מוברח בבקסלאש

```sql
-- שבור: הגרש סוגר את המחרוזת, וכל מה שאחריו הוא SQL שבור
comment on function f() is 'ג\'ת אינה גת';

-- נכון: הכפלה
comment on function f() is 'ג''ת אינה גת';
```

ב-PostgreSQL עם `standard_conforming_strings = on` — ברירת המחדל, ונבדק
בפרודקשן — **בקסלאש אינו תו בריחה**.

**זה כבר הפיל את הפרודקשן.** ‏`20261210090000` נפלה על התו הראשון של
ההערה הראשונה שלה (`syntax error at or near "ת"`), ומכיוון ש-`db push`
מריץ לפי סדר — **שבע המיגרציות של אותו מיזוג נעצרו יחד**. הסכימה לא
השתנתה כלל, וה-HTML כבר היה באוויר.

הטעות שקטה לגמרי בכתיבה: הקובץ נראה תקין ושום עורך לא מתלונן.

```sh
python3 scripts/check_migration_quotes.py
```

הבדיקה חוסמת ב-CI מחרוזת שלא נסגרה ובקסלאש לפני גרש. בתוך גוף
מצוטט ב-`$$` היא אינה מתלוננת, כי שם יושבים regex-ים עם גרשים בכוונה.

## כתיבת ההערה בראש הקובץ

מיגרציות בריפו הזה נפתחות בהסבר — מה שבור היום, למה זה שובר, ומה נכנס.
המסמך הזה הוא מה שקוראים בעוד חצי שנה. `20261109090000_street_registry.sql`
הוא דוגמה טובה.

## אחרי המיזוג

**מבט אחד ב-Actions.** workflow אדום שם הוא **תקלת פרודקשן ולא רעש CI**:
ה-HTML כבר באוויר, והסכימה לא.

אם הרשומה שחוסמת נוצרה מהחלה מחוץ לצינור של מיגרציה שקיימת כקובץ —
ה-workflow מיישר אותה בעצמו ומדווח באזהרה. בכל מקרה אחר הוא נכשל ומדפיס
את ה-DDL של הרשומה, כדי שההחלטה תהיה מבוססת.

הסיפור המלא: `docs/supabase-migrations.md`.
