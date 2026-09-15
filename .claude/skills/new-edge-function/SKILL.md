---
name: new-edge-function
description: הוספת Edge Function ל-Supabase בריפו של שוק נדל״ן — verify_jwt ב-config.toml, CORS, סודות ופריסה. Use when adding a function under supabase/functions, when a public form or webhook suddenly returns 401, or when wiring a cron job to a function.
---

# ‏Edge Function חדשה

## הדבר שחייבים לעשות, ושכחה שלו מפילה חצי אתר בשקט

`supabase functions deploy` קורא את `verify_jwt` של כל פונקציה מ-
`supabase/config.toml`, וברירת המחדל שלו כשאין ערך היא **`true`**.

פונקציה חדשה בלי סעיף משלה נפרסת עם אימות JWT דלוק, וכל קריאה אליה
מגולש/ת אנונימי/ת מתחילה להחזיר **401** — טופס יצירת הקשר בדף הנכס,
הרשמת משרד, הוובהוק של וואטסאפ, ה-cron של ההתראות.

הכשל שקט משני הצדדים: הפריסה מצליחה, ה-CI ירוק, והדף נראה תקין עד
שמישהו/י מנסה לשלוח את הטופס.

```toml
[functions.my-function]
verify_jwt = false          # למה: נקודת קליטה ציבורית מטופס הנכס
```

| ערך | משמעות |
| --- | --- |
| `false` | הפונקציה מאמתת בעצמה (סוד cron, טוקן חד-פעמי, service role), **או** שהיא נקודת קליטה ציבורית מכוונת |
| `true` | ה-Gateway חוסם כל בקשה בלי JWT תקין, והפונקציה נשענת על זה |

**לכל שורה שם יש הערה שמסבירה את הבחירה.** זו החלטת אבטחה, לא הגדרה
טכנית — ומי שקורא/ת בעוד חצי שנה צריך/ה לדעת למה.

## המבנה

```
supabase/functions/my-function/index.ts
supabase/functions/_shared/…            ← קוד משותף, לא נפרס בנפרד
```

תיקייה בלי `index.ts` אינה נפרסת.

## מה להעתיק מפונקציה קיימת

- **נקודת קליטה ציבורית מטופס** → `owner-lead-intake`
- **קריאה מה-CRM עם JWT של סוכן/ת** → `professional-manage`
- **משימת cron** → `promo-lifecycle` (כולל בדיקת `x-alert-cron-secret`)
- **וובהוק מספק חיצוני** → `whatsapp-webhook`

## CORS

פונקציה שנקראת **מהדפדפן** מחזירה `Access-Control-Allow-Origin: *`
ומטפלת ב-`OPTIONS` (כך ב-46 מתוך 57 הפונקציות). זה בטוח כאן כי האימות
הוא ב-header של `Authorization` (‏bearer) ולא בעוגייה — ולכן `*` אינו
פותח CSRF.

פונקציה שנקראת רק מ-cron או מוובהוק של ספק אינה צריכה CORS כלל.

## סודות

נקראים מ-`Deno.env.get(...)`, ומוגדרים ב-Supabase (‏Settings → Edge
Functions). סוד חדש נרשם גם ב-`.env.example` עם שורת הסבר — בלי הערך.

**אין לכתוב סוד לקוד.** גם לא "זמנית".

## פונקציה שנקראת מ-cron

ה-cron יושב ב-`pg_cron` (מוגדר במיגרציה), קורא ב-`net.http_post`, ומעביר
`x-alert-cron-secret` מה-vault. הפונקציה **חייבת לאמת את הסוד הזה בעצמה**,
כי `verify_jwt` שלה יהיה `false`. ראו `_shared/cron-auth.ts`.

התבנית כוללת תנאי `where` שמונע קריאה כשאין עבודה — זה מה שמונע 720
הרצות ריקות ביום.

## לפני הדחיפה

```sh
python scripts/check_edge_config.py
```

תופס גוש חסר, גוש בלי `verify_jwt`, ורשומה ב-`config.toml` שאין לה
תיקייה. רץ גם ב-CI על ה-PR.

## הפריסה

`.github/workflows/supabase_functions.yml` פורס במיזוג ל-`main` — רק את
מה שהשתנה, או הכול אם `_shared` או `config.toml` נגעו.

**אחרי מיזוג: מבט אחד ב-Actions.** workflow אדום שם הוא תקלת פרודקשן.

הפרטים: `docs/edge-functions-deploy.md`.
