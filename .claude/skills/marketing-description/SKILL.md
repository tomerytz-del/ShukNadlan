---
name: marketing-description
description: עבודה על התיאור השיווקי של נכס בריפו של שוק נדל״ן - איזה שדה מוצג בדף הנכס ובבוט (marketing_description מול description), טביעת האצבע וה-stale, התור האוטומטי, כפתור הרענון ב-CRM, הפרומפט המשותף עם פייסבוק, ומיגרציה שנוגעת בטקסט של נכסים. Use when "refreshed the description and nothing changed", when adding a field to the property form that the copy should mention, when touching property-description / marketing-copy.ts / renderDescription, when writing a migration that updates properties.title/description/marketing_description, or when a property is wrongly flagged "כדאי לרענן תיאור".
---

# תיאור שיווקי לנכס

המסמך המלא: `docs/marketing-description.md`. כאן רק מה ששובר בשקט.

## שני שדות, וכלל תצוגה אחד

| שדה | מי כותב | תפקיד |
| --- | --- | --- |
| `description` | הסוכן/ת, בטופס ("תיאור המודעה") | חומר הגלם - נכנס לפרומפט ולטביעת האצבע |
| `marketing_description` | Claude (אוטומטי/רענון) או הסוכן/ת | הנוסח שמוצג לגולשים |

**הכלל:** מציגים את `marketing_description`, אלא אם הוא ריק **או**
`marketing_description_stale` ויש `description` - אז את `description`.

```js
const marketing = p.marketing_description_stale && p.description ? '' : p.marketing_description;
const text = marketing || p.description || '';
```

הכלל חי בארבעה מקומות, **וכולם משתנים יחד**:

| מקום | מה |
| --- | --- |
| `renderDescription` ב-`assets/property.js` | דף הנכס |
| `getProperty` ב-`supabase/functions/whatsapp-webhook/public-agent.ts` | מה שהבוט הציבורי עונה |
| התוויות `npDescription` / `npMarketingDescription` ב-`crm.html` | מה שהסוכן/ת קורא/ת בטופס |
| `marketingCopyState()` ו-toast השמירה ב-`assets/crm.js` | מה שה-CRM מבטיח |

**זה כבר נשבר.** הדף העדיף את `description` בזמן שה-CRM הודיע "התיאור
השיווקי נשמר ומוצג בדף הנכס" - ב-80 מתוך 86 נכסים פעילים רענון נשמר
במסד ולא נראה בשום מקום. שום שגיאה, שום לוג; התגלה מצילום מסך של סוכן.

**ולמה לא פשוט "שיווקי קודם":** 23 נכסים פעילים החזיקו נוסח מתיישן, כלומר
טקסט שנכתב לפני שינוי מחיר - הוא היה מציג לקונים מחיר של אתמול. והחזרה ל-
`description` כשה-stale דולק היא גם מה שהופך עריכה של תיאור המודעה לנראית
מיד (העריכה משנה את טביעת האצבע).

## טביעת האצבע

`property_marketing_fingerprint(p)` היא md5 של כל שדה שנכנס לטקסט.
`marketing_description_stale` = הטביעה השמורה שונה מהנוכחית. מוחזק בטריגר
`properties_track_marketing_copy`, לא בקוד הקורא.

* **שדה חדש שהפרומפט מקבל** (ב-`property_marketing_facts`) **נכנס גם
  לטביעה**, באותה מיגרציה. אחרת שינוי בו לא יסמן stale, והנוסח ימשיך לצטט
  ערך ישן כשהדף מציג אותו כעדכני.
* **ולהפך:** שדה שאינו תוכן (תמונות, הקפצה, קידום, `updated_at`) **לא** נכנס.
  אחרת כל נכס מסומן "כדאי לרענן" תוך יום, והסימון מאבד משמעות.
* **מיגרציה שמשכתבת `title`/`description`/`marketing_description`** (ניקוי
  מקפים, מחיקת פרטי בעלים) משנה את הטביעה. אוספים מי היה טרי **לפני**,
  ומחזירים להם את הטביעה אחרי - אחרת עשרות נכסים מסומנים stale בבת אחת,
  וכל אחד מהם הוא קריאת Claude מיותרת. הדוגמה:
  `supabase/migrations/20261202090000_long_dash_backfill.sql`. וזכרו:
  נכס שנעשה stale עובר בדף לתיאור המודעה.

## מה שלא נוגעים בו

* **המסלול האוטומטי לא דורס טקסט של אדם** - התנאי יושב ב-
  `pending_property_descriptions` (רק `marketing_description` ריק). לא להעביר
  אותו לקוד השרת.
* **`post_text` לא נדרס** ב-`apply_property_marketing_description`.
* **`source = 'ai'`** רק דרך `apply_property_marketing_description` (משתנה
  סשן). שמירה מה-CRM נרשמת `agent` גם כשהטקסט הוצע ע"י Claude.
* **הכפתור ב-CRM הוא `mode: 'preview'`** ואינו שומר. השמירה נפרדת.
* **הגייט במסלול** (`property_description_tier_ok`) הוא במסד - בתור וב-
  `request_property_description`. ה-CRM רק מסביר. שינוי כאן הוא גם
  `new-tier-capability`.
* **מקף ארוך**: הנחיה ב-`SYSTEM_PROMPT` + `noLongDash()` על הפלט. שתי השכבות.

## בדיקה אחרי שינוי

```sql
-- מה כל נכס פעיל מציג עכשיו, לפי הכלל
select listing_number,
       case when nullif(btrim(marketing_description),'') is not null
             and not (marketing_description_stale and nullif(btrim(description),'') is not null)
            then 'marketing' when nullif(btrim(description),'') is not null then 'description'
            else 'none' end as shown,
       marketing_description_source, marketing_description_stale
  from properties where status = 'active' order by shown, listing_number;

-- כמה נכסים stale - קפיצה פתאומית אחרי מיגרציה = טביעה שלא שוחזרה
select count(*) from properties where status = 'active' and marketing_description_stale;
```

ובדפדפן: לרענן תיאור בכרטיס נכס ב-CRM, לשמור, ולפתוח את `/property?id=`.
הטקסט החדש צריך להופיע מיד (אין מטמון - הדף קורא מהמסד בזמן ריצה).

קריאה מהמסד מותרת; שינוי סכימה רק דרך `new-migration`.
