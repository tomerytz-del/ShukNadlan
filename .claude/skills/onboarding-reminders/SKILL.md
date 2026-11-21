---
name: onboarding-reminders
description: מדריך ההתחלה ותזכורות המייל ליזמים/קבלנים ולבעלי מקצוע בריפו של שוק נדל״ן - developer_onboarding_state / professional_onboarding_state (המצב מחושב במסד בכל קריאה), developer-onboarding-reminders / professional-onboarding-reminders (שלוש ועשרה ימים, א'-ה', בלי חגים), mark_*_onboarding_reminder, קישור ההסרה (reminders-off, onboarding-reminders-unsubscribe, חתימת HMAC) וגיבוי חד-פעמי לחשבונות קיימים. Use when adding or changing a guide step or reminder wording, when a reminder was sent twice, never, on Shabbat or to someone who finished, when touching onboarding_reminders_sent / onboarding_reminder_at / onboarding_attempt_at, when adding a new type of account that gets a guide, or when an unsubscribe link fails. מדריך הסוכנים והמשרדים - הסקיל office-signup.
---

# מדריך ההתחלה ותזכורות המייל (יזמים ובעלי מקצוע)

המסמכים: `docs/new-projects.md` (יזמים, "מדריך ההתחלה"), `docs/professional-cards.md` (בעלי מקצוע), `docs/agent-onboarding.md` (סוכנים ומשרדים,
בסקיל `office-signup`). כאן מה ששובר בשקט: חשבון פתוח ריק אינו שגיאה, ולכן אף אחד לא מדווח על עצמו, ומייל שנשלח פעמיים או בשבת אינו נכשל.

## המצב מחושב במסד, לא מסומן

`developer_onboarding_state(developer_id)` ו-`professional_onboarding_state(placement_id)` קוראות את הנתונים השמורים **בכל קריאה** ומחזירות
`steps`, `done_count`, `total`, `next`, `complete`. אין צ'קליסט ואין עמודה שמסמנת "הושלם": משתמש/ת שמחק/ה תמונה רואה את הצעד נפתח שוב.
שתיהן `security definer`, **`service_role` בלבד** (הקריאה דרך `project-manage` / `professional-manage`, לא מהדפדפן).

* **צעד חדש** נכנס לפונקציית המצב **ולמפת התוויות** (`ONB` ב-`professional-manage.html`, `renderOnboarding` ב-`developer-crm.html`),
  ולמייל אם הוא יכול להופיע ב"חסר:". התווית במייל מגיעה מרשימה סגורה בעברית (`DETAIL_HE`), לא מערך ב-`detail` כמו שהוא.
* **צעד "חסום"** (אצל יזמים: אין פרויקט) אינו נספר כפתוח ואינו נבחר כ-`next`.
* **בנייה בפונקציית PL/pgSQL:** להוסיף איבר למערך `text[]` עם `array_append(arr, 'x'::text)`, לא `arr || '"x"'`. הקוד השני נקרא כמערך פגום, והפונקציה
  נפלה בקריאה הראשונה אחרי הפריסה. **ה-CI מריץ את המיגרציה ואינו קורא לפונקציה**, ולכן פונקציית מסד חדשה נבדקת בקריאה אחת מול המסד אחרי הפריסה.

## מי זכאי לתזכורת, וכל התנאים הם במסד

`*_onboarding_reminders_due(p_no)` מחזירה את הזכאים; הפונקציה (`*-onboarding-reminders`) רק בונה ושולחת. התנאים:

| תנאי | ערך |
| --- | --- |
| מועד | תזכורת 1 אחרי 3 ימים, תזכורת 2 אחרי 10, מהפתיחה |
| רק אם | נשאר **צעד חובה** פתוח (רשות אינו סיבה לכתוב) |
| חלון | 30 יום מהפתיחה (`created_at`), לא יותר |
| מרווח | שבוע בין התזכורות, **נמדד מהשליחה המוצלחת** (`onboarding_reminder_at`) |
| כישלון | ניסיון חוזר אחרי **יום** (`onboarding_attempt_at`, עמודה נפרדת: כישלון לא מזיז את `onboarding_reminder_at`) |
| ימים | **א'-ה' בלבד** (ה-cron `0-4`); שבת וחג נדחים ליום החול הבא (`_shared/il-workday.ts`, חגים מהלוח העברי) |
| רק | יזם: `status = 'active'` ו-`closed_at is null`. בעל מקצוע: כרטיסייה `active` או `pending_approval`, ולא חשבון בדיקה (`test_mode`) |

* **הסימון אחרי השליחה**, נבדק ומנוסה פעמיים (`mark`). סימון לפני שליחה שנכשלה מאבד את התזכורת; שליחה בלי סימון שולחת פעמיים.
  `mark_*(id, p_no)`: `sent = greatest(...)`, `reminder_at` רק כש-`p_no` גדול מהנשלח, `attempt_at` תמיד. מי שהשלים את המדריך לפני התזכורת מסומן כמי שקיבל את שתיהן.
* **תנאי ה-cron הוא `exists (select 1 from *_reminders_due(1))`**: הפונקציה לא נקראת סתם. `timeout_milliseconds := 30000`.
* **שינוי כלל** מחייב מיגרציה שמחליפה את הפונקציה **ו**את ה-cron אם התזמון משתנה (`cron.schedule` מחדש), באותו PR. מיגרציה שמשנה רק את ה-cron משאירה את הפונקציה הישנה פועלת.

## קישור ההסרה בתחתית כל מייל

`reminders-off.html` (דף פרטי באתר) ← POST ל-`onboarding-reminders-unsubscribe` ← מסמנת את שתי התזכורות כנשלחו (`p_no = 2`).

* **הטוקן הוא `kind.id.sig`**: HMAC-SHA256 בסוד `ALERT_CRON_SECRET` (`_shared/onboarding-unsub.ts`), בלי עמודה במסד. `kind` = `developer` או `professional`.
* **בלי הסוד לא שולחים אף מייל** (נכשלים סגור). **חידוש הסוד מבטל קישורים שכבר נשלחו.**
* **הדף באתר ולא בפונקציה** (Supabase מגישה HTML כ-`text/plain`), **GET אינו מסיר**, והטוקן ב-fragment ויוצא מהכתובת. כל הפרטים: הסקילים `new-edge-function` ו-`new-page`.
* **תחתית כל מייל חדש** נושאת "לא רוצים לקבל את התזכורות האלה? להסרה", ושורת פרטיות. שינוי נוסח אינו מוריד אותם.

## חשבונות קיימים לא מקבלים תזכורת מהעבר

כשהעמודות נוצרות, **גיבוי חד-פעמי** מסמן את כל החשבונות הקיימים כמי ששתי התזכורות נשלחו להם (`where placement_type = 'professional_card'` אצל בעלי מקצוע,
כל היזמים הקיימים אצל יזמים). החלטה (21.11.2026): לא כותבים בעבר ליוזמה שלא ביקשו. הם רואים את המדריך בדשבורד. **הגיבוי חייב להיות מוגן בכך שהעמודה
נוצרת באותה מיגרציה** (`add column if not exists` + עדכון רק כשהעמודה חדשה), אחרת הרצה חוזרת תסמן גם חשבונות חדשים.

## סוג חשבון חדש שמקבל מדריך

1. פונקציית מצב (`*_onboarding_state`), פונקציית זכאים, פונקציית סימון, שלוש עמודות על הטבלה (`onboarding_reminders_sent`, `onboarding_reminder_at`, `onboarding_attempt_at`) וגיבוי חד-פעמי.
2. פונקציית Edge לשליחה, עם `verify_jwt` ב-`config.toml` ובדיקת שבת/חג ובדיקת הסוד לפני שליחה, וקישור הסרה.
3. `kind` חדש ב-`onboarding-unsub.ts` ו-`onboarding-reminders-unsubscribe`, ושורת cron.
4. כרטיס בדשבורד של הסוג, ושורה במסמך שלו. וואטסאפ לא בשלב הזה: תזכורת יזומה בתבנית עולה כסף ומחייבת אישור תבנית וההסכמה (`docs/whatsapp-deep-links.md`).

## לפני הדחיפה

```sh
python scripts/check_function_grants.py
python scripts/check_migration_versions.py
python scripts/check_events.py
python scripts/check_canonical.py
```

ו-`deno` אינו מותקן בסשן: בדיקת הטיפוסים של פונקציות ה-Edge רצה רק ב-CI (`טיפוסים ב-Edge Functions`), והיא תפסה כבר TS18047 (צמצום טיפוס בתוך closure).
