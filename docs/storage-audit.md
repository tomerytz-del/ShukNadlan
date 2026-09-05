# מדידת האחסון — לפני שמוחקים משהו

כל שיחה על "לצמצם אחסון" מתחילה באותה שאלה: **מה בדיוק תופס מקום, ואיזה חלק
ממנו לא צריך להיות שם בכלל.** הדף הזה הוא ארבע שאילתות שרצות ב-SQL Editor של
Supabase ועונות עליה. אין כאן שום פעולה שמוחקת — רק ספירה.

## מה יש בכלל

שלושה דליים ציבוריים, ומה יושב בכל אחד:

| דלי | מה בפנים | נתיב |
| --- | --- | --- |
| `property-images` | תמונות נכס (עד 8), תמונה שיווקית, וגם תמונות פרופיל, מיתוג משרד, כתבות ובעלי מקצוע | `<agent_id>/<property_id>/…` לנכסים, `<agent_id>/profile|branding|articles/…` לשאר |
| `property-videos` | סרטון נכס אחד, עד 50MB (נדחס במכשיר ל-20MB לדקה, עד דקה) | `<agent_id>/<property_id>/video-<uuid>.<ext>` |
| `property-visualizations` | הדמיות AI | נכתב ב-`service_role` בלבד |

סדרי הגודל שקובעים את סדר העדיפויות: תמונה ≈ 150–300KB (WebP, אחרי הקטנה
ל-1600px), נכס מלא ≈ 2.5MB, **סרטון ≈ עד 50MB**. נכס אחד עם סרטון שווה בערך
לעשרים נכסים בלי.

---

## 1. כמה תופס כל דלי

```sql
select bucket_id,
       count(*)                                                as files,
       pg_size_pretty(sum((metadata->>'size')::bigint))        as total
  from storage.objects
 group by bucket_id
 order by sum((metadata->>'size')::bigint) desc;
```

## 2. מדיה של נכסים, לפי סטטוס הנכס

הקטע השני בנתיב הוא `property_id` (רק בהעלאות של נכסים; פרופיל/מיתוג/כתבות
נופלים מה-join כי שם יש שם מילולי במקום UUID).

```sql
with media as (
  select o.bucket_id,
         nullif(split_part(o.name, '/', 2), '')::uuid as property_id,
         (o.metadata->>'size')::bigint                as bytes
    from storage.objects o
   where o.bucket_id in ('property-images', 'property-videos')
     and split_part(o.name, '/', 2) ~ '^[0-9a-f-]{36}$'
)
select p.status,
       m.bucket_id,
       count(*)                        as files,
       pg_size_pretty(sum(m.bytes))    as total
  from media m
  join public.properties p on p.id = m.property_id
 group by p.status, m.bucket_id
 order by sum(m.bytes) desc;
```

**מה מחפשים כאן:** כמה מהאחסון יושב על נכסים ב-`sold` / `rented` / `archived`.
זה הגג של מה שניקוי ארכיון יכול לחסוך — ואם הוא קטן, לא כדאי לבנות אותו.

## 3. קבצים יתומים

קבצים שאף שורה כבר לא מפנה אליהם: העלאות שנכשלו באמצע, תמונות שהוסרו בעריכה
לפני שהמחיקה הרכה הספיקה לרוץ, טיוטות שנזנחו. **זה בדרך כלל הנתח הגדול
והבטוח ביותר למחיקה** — אף אחד לא רואה את הקבצים האלה בשום מסך.

```sql
with used as (
  select unnest(coalesce(images, '{}')) as url from public.properties
  union all select marketing_image from public.properties where marketing_image is not null
  union all select video_url        from public.properties where video_url is not null
  union all select photo_url        from public.agency_members where photo_url is not null
  union all select cover_url        from public.agency_members where cover_url is not null
)
select o.bucket_id,
       count(*)                                          as orphan_files,
       pg_size_pretty(sum((o.metadata->>'size')::bigint)) as orphan_total
  from storage.objects o
 where o.bucket_id in ('property-images', 'property-videos')
   and not exists (
     select 1 from used u where u.url like '%/' || o.bucket_id || '/' || o.name
   )
 group by o.bucket_id;
```

> שימו לב: הרשימה `used` מכסה את הנכסים ואת תמונות הפרופיל. אם נוספו בינתיים
> טבלאות שמחזיקות כתובות בדליים האלה (מיתוג משרד, כתבות, בעלי מקצוע), הוסיפו
> אותן ל-`union` **לפני** שמוחקים משהו — קובץ שנחשב יתום בטעות הוא תמונה
> שנעלמת מהאתר.

להצצה בקבצים עצמם לפני החלטה, החליפו את הבלוק האחרון ב:

```sql
select o.bucket_id, o.name, pg_size_pretty((o.metadata->>'size')::bigint) as size, o.created_at
  from storage.objects o
 where o.bucket_id in ('property-images', 'property-videos')
   and not exists (select 1 from used u where u.url like '%/' || o.bucket_id || '/' || o.name)
 order by (o.metadata->>'size')::bigint desc
 limit 50;
```

## 4. הנכסים הכבדים ביותר

```sql
select p.listing_number, p.status, p.city, p.street, p.house_number,
       count(*) as files,
       pg_size_pretty(sum((o.metadata->>'size')::bigint)) as total
  from storage.objects o
  join public.properties p
    on p.id = nullif(split_part(o.name, '/', 2), '')::uuid
 where o.bucket_id in ('property-images', 'property-videos')
   and split_part(o.name, '/', 2) ~ '^[0-9a-f-]{36}$'
 group by p.id, p.listing_number, p.status, p.city, p.street, p.house_number
 order by sum((o.metadata->>'size')::bigint) desc
 limit 20;
```

---

## איך קוראים את התוצאות

| מה רואים | מה עושים |
| --- | --- |
| היתומים הם עשרות אחוזים | סריקת יתומים תקופתית (pg_cron לילי) — הרווח הגדול, אפס סיכון מוצרי |
| רוב האחסון בסרטונים של נכסים סגורים | ניקוי מדיה בארכיון: מוחקים סרטון והדמיות, משאירים את תמונת השער וכל הפרטים |
| רוב האחסון בנכסים פעילים | אין מה לנקות — הכיוון הוא דחיסה (‏WebP כבר פעיל בהעלאות חדשות) ותקרה לסרטונים |
| הכול קטן ממילא | לא לבנות כלום. מודדים שוב בעוד רבעון |

**‏WebP כבר פעיל**: מאז המיגרציה `20261002090000_storage_webp_uploads.sql` כל
תמונה חדשה נשמרת כ-WebP (‏JPEG רק בדפדפן שלא יודע לקודד), כ-30% פחות מקום
לתמונה. תמונות שכבר בדלי לא הומרו — המרה רטרואקטיבית תדרוש כתיבה מחדש של
הכתובות בכל השורות, וזו עבודה שכדאי לעשות רק אם שאילתה 1 מראה שזה שווה את זה.
