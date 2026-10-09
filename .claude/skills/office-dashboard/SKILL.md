---
name: office-dashboard
description: עבודה על דאשבורד המשרד, הדשבורד האישי ומאמן ה-AI השבועי בריפו של שוק נדל״ן - office_dashboard והליבה _office_dashboard_core, my_dashboard, _agent_period_stats ועזרי _office_*_rows, זמן התגובה (leads.first_response_at, mark_lead_responded, כפתורי "חיוג"/"וואטסאפ" בכרטיס הליד), יעדים (agent_targets), ממוצע המשרד שנעלם מתחת לשלושה סוכנים, והמאמן (office-coach, office_coach_summaries, compactPeriod). Use when adding or changing a metric in either dashboard, when the office and personal dashboards show different numbers for the same agent, when response time looks wrong or "ללא מענה מתועד", when adding a new way to contact a lead, when changing what the weekly coach sends to Claude or which model it uses, when touching assets/crm-office-dashboard.js / crm-my-dashboard.js, or when a dashboard query gets slow.
---

# דאשבורד המשרד, הדשבורד האישי והמאמן השבועי

התיעוד המלא: `docs/office-dashboard.md`, ‏`docs/my-dashboard.md`,
‏`docs/office-coach.md`. כאן - מה שנשבר בשקט.

## ‏1. חישוב אחד, שלושה צרכנים

```
_office_lead_rows / _office_deal_rows / _office_exclusive_rows
        └─ _agent_period_stats(agency, from, to)      ← מדד לכל סוכן/ת
              ├─ _office_dashboard_core(agency, from, to)
              │     ├─ office_dashboard()   ← עטיפה: מנהל/ת בלבד (42501)
              │     └─ office-coach         ← service_role
              └─ my_dashboard()             ← current_agent_id() בלבד
```

- **מדד חדש נכנס ל-`_agent_period_stats`** (או לעזר שמזין אותה), לא לאחד
  הצרכנים. מדד שנוסף רק ב-`my_dashboard` או רק בצד ה-JS מציג לסוכן/ת מספר
  שהמנהל/ת לא רואה/ה, וההבדל מתגלה בשיחה ביניהם.
- **`office_dashboard()` היא עטיפה דקה** מאז `20270407090000_office_coach.sql`.
  הגוף ב-`_office_dashboard_core`. מי שמחזיר גוף ל-`office_dashboard` יוצר
  עותק שני שהמאמן לא קורא.
- **כל גרסה היא העתק מלא** מהמיגרציה האחרונה שמגדירה את הפונקציה:
  `grep -l "function public._office_dashboard_core" supabase/migrations/*.sql | tail -1`.
  ‏`_office_lead_rows` ו-`office_dashboard` הוגדרו מחדש כבר ב-`20270405090000`,
  ולכן `20270404090000` **אינו** המקור להעתקה.
- **הרשאות:** העזרים `security invoker` ובלי הרשאה לאיש; הליבה `security
  invoker` ופתוחה ל-`service_role` בלבד (המאמן); העטיפות `security definer`
  עם בדיקת תפקיד, כי RLS חוסם את המנהל/ת מהשורות של סוכן/ת אחר/ת. ‏`from public, anon,
  authenticated` - כל השלושה (`check_function_grants.py`).
- **בדיקה אחרי שינוי:** אותו/ה סוכן/ת, אותה תקופה, ב-`office_dashboard` וב-
  `my_dashboard` - אותה עמלה ואותו מספר לידים.

## ‏2. זמן תגובה: מה שלא עובר דרך המערכת לא קיים

`leads.first_response_at` נכתב פעם אחת, ונעול לעדכון ישיר (טריגר מחזיר
אותו לערכו כשהמעדכן/ת `authenticated`/`anon` - אחרת מי שנמדד/ת עורך/ת את
המדד). ארבעה מקורות:

1. פתיחת ליד ממוסך (`unlocked_at`) - טריגר על `leads`.
2. "חיוג"/"וואטסאפ" בכרטיס הליד → `mark_lead_responded()` (`assets/crm.js`).
3. שיחה נכנסת שנענתה או סומנה "חזרתי" - טריגר על `agent_calls`, לפי
   `phone_tail9()`.
4. השלמת משימת `lead_followup` ביומן.

**פתח חדש שבו סוכן/ת פונה לליד** (כפתור, כלי בבוט, תבנית הודעה) **חייב
לקרוא ל-`mark_lead_responded`**. בלי זה הליד נספר "ללא מענה", הדשבורד האישי
מציג אותו במשימות, והמנהל/ת רואה/ה סוכן/ת איטי/ת שענה/תה תוך דקה. בדשבורד
מסמנים כוכבית (`odProxy()`) כשחלק גדול מהלידים בקירוב.

## ‏3. פרטיות

- **`my_dashboard` אין לה פרמטר סוכן/ת**, בכוונה. לא מוסיפים.
- **`office_avg` ו-`office_buckets` חוזרים `null` מתחת לשלושה סוכנים
  פעילים.** במשרד של שניים, ממוצע ועוד המספר שלי הם המספר של העמית/ה. לא
  "מתקנים" את זה כשמנהל/ת שואל/ת למה הממוצע נעלם.
- **המאמן שולח לקלוד רשימה סגורה** (`keep` ב-`compactPeriod`,
  ‏`supabase/functions/office-coach/payload.ts`). מדד שנוסף לליבה **לא** יוצא
  למודל מעצמו - וזה הרצוי. מוסיפים ל-`keep` רק מספר, אף פעם טקסט (כותרת,
  שם פונה, הערה), ומריצים
  `node --experimental-strip-types scripts/office_coach_test.ts`.
- `office_coach_summaries` נקראת בידי מנהלי המשרד בלבד (RLS). הסיכום כותב
  שמות סוכנים, ולכן הוא לא מוצג בדשבורד האישי.

## ‏4. המאמן: עלות ומודל

- המודל בסוד `OFFICE_COACH_MODEL`, ברירת מחדל בקוד. לא משנים בשקט.
- הפרומפט יציב (בלי תאריך ובלי שם משרד), כדי שיישמר במטמון בין המשרדים.
  מה שמשתנה עובר בהודעת המשתמש.
- `office_coach_due()` מסננת משרדים בלי תנועה ב-30 יום - כל קריאה עולה כסף.
- העלות האמיתית: `input_tokens`/`output_tokens` ב-`office_coach_summaries`.

## ‏5. ביצועים

שנה של משרד עם 20 סוכנים: 386ms. הגרסה הראשונה, עם תת-שאילתה לכל סוכן/ת,
לקחה 50 שניות. **אגרגציה ב-`group by` פעם אחת**, לא שאילתה לכל שורה, ומדידה
על נתוני שנה לפני מיזוג (`docs/office-dashboard.md`, "ביצועים").

## ‏6. בממשק

- טקסט עם לוכסן (סוכן/ת, את/ה) - אין עמודת מין ב-`agency_members`.
- בלי מקף ארוך (`check_long_dash.py`), בלי d3 - הגרפים בנויים ידנית.
- קישור מתוך הדשבורד פותח את הפריט עצמו (`openLeadFromParam`,
  ‏`openPropertyFromParam`, ‏`openAgreementFromParam`), לא קטגוריה.
- `crm-my-dashboard.js` משתמש בעזרים של `crm-office-dashboard.js` (`od*`),
  ולכן נטען אחריו. שינוי שם של עזר שובר את שני הדשבורדים.
