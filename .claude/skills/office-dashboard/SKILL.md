---
name: office-dashboard
description: דאשבורד המשרד, הדשבורד האישי ומאמני ה-AI בשוק נדל״ן - _agent_period_stats, _office_dashboard_core / my_dashboard, mark_lead_responded, agent_targets, office-coach, CTA_KINDS ו-coach-ask. Use when adding or changing a dashboard metric, when the office and personal dashboards disagree, when response time looks wrong or "ללא מענה מתועד", when adding a new way to contact a lead, when changing what a coach sends to Claude, or when touching crm-office-dashboard.js.
---

# דאשבורד המשרד, הדשבורד האישי והמאמן השבועי

התיעוד המלא: `docs/office-dashboard.md`, ‏`docs/my-dashboard.md`,
‏`docs/office-coach.md`, ‏`docs/coaches.md` (שלושת המאמנים). כאן - מה שנשבר בשקט.

## ‏1. חישוב אחד, שלושה צרכנים

```
_office_lead_rows / _office_deal_rows / _office_exclusive_rows
        └─ _agent_period_stats(agency, from, to)      ← מדד לכל סוכן/ת
              ├─ _office_dashboard_core(agency, from, to)
              │     ├─ office_dashboard()   ← עטיפה: מנהל/ת בלבד (42501)
              │     ├─ office-coach         ← service_role (משרד; צוות עם p_agent_ids)
              │     └─ team_dashboard()     ← מנהל/ת צוות
              └─ _my_dashboard_core(agent, from, to)
                    ├─ my_dashboard()       ← עטיפה: current_agent_id() בלבד
                    └─ office-coach?kind=agent ← service_role
```

**`my_dashboard()` היא עטיפה מאז `20270601160000_coaches.sql`**, כמו
`office_dashboard()`. הגוף ב-`_my_dashboard_core`, כדי שמאמן הסוכן/ת (cron,
בלי משתמש/ת) יחשב בדיוק את המספרים של "הדשבורד שלי". מי שמשנה את הדשבורד
האישי משנה את הליבה.

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

**מקור הליד** ב-`_office_lead_rows` הוא שרשרת ולא העמודה: `lead_routing_log.source`,
‏`leads.source`, ואז גזירה לפי `lead_type` - בדיוק כמו `lead_analytics`. טפסי
האתר (הדמיה, פנייה על נכס, אשף בעלים) לא כותבים `source`, ומי שיחזיר את
העמודה כמו שהיא יחזיר את כל הלידים שלהם ל"אחר". סוג ליד חדש מקבל שורה בשני
ה-`case`, כאן ובבקרת הלידים.

**הערוץ** נגזר מהמקור ב-`lead_source_channel()`, אחת לכל הדוחות. ערוץ חדש
(כמו `visualization`, ‏`20270409090000`) הוא העתק מלא של הפונקציה עם ענף
**לפני** הקידומת שהיה נבלע בה, תווית ב-`LX_CHANNELS` (‏`assets/crm.js`) ושורה
ב-`docs/lead-analytics.md`. בלי תווית הממשק מציג את המפתח באנגלית.

## ‏3. פרטיות

- **`my_dashboard` אין לה פרמטר סוכן/ת**, בכוונה. לא מוסיפים.
- **`office_avg` ו-`office_buckets` חוזרים `null` מתחת לשלושה סוכנים
  פעילים.** במשרד של שניים, ממוצע ועוד המספר שלי הם המספר של העמית/ה. לא
  "מתקנים" את זה כשמנהל/ת שואל/ת למה הממוצע נעלם.
- **המאמן שולח לקלוד רשימה סגורה** (`keep` ב-`compactPeriod`,
  ‏`supabase/functions/_shared/coach/payload.ts`). מדד שנוסף לליבה **לא** יוצא
  למודל מעצמו - וזה הרצוי. מוסיפים ל-`keep` רק מספר, אף פעם טקסט (כותרת,
  שם פונה, הערה), ומריצים
  `node --experimental-strip-types scripts/office_coach_test.ts`.
- `office_coach_summaries` נקראת בידי מנהלי המשרד בלבד (RLS). הסיכום כותב
  שמות סוכנים, ולכן הוא לא מוצג בדשבורד האישי.
- **מאמן הסוכן/ת** (`compactAgent`) לא שולח את שם הסוכן/ת, שמות עמיתים, שם
  פונה, כותרת נכס, עיר או כותרת של פריט ביומן. פריט שאפשר לפתוח יוצא כאסימון
  (`L1`), לא כמזהה. `agent_coach_summaries` נקראת **רק** בידי הסוכן/ת עצמו/ה.
- **כפתור במאמן רק מ-`CTA_KINDS`** (`payload.ts`), ובאותה רשימה ב-`COACH_CTA`
  (`assets/crm-coach.js`). אין כפתור העברה במאמן. מסירה בהפנייה קיימת
  למנהל/ת המשרד ב-CRM, והמאמן ממליץ עליה בטקסט בלבד.

## ‏4. המאמן: עלות ומודל

- המודל בסוד `OFFICE_COACH_MODEL`, ברירת מחדל בקוד. לא משנים בשקט.
- הפרומפט יציב (בלי תאריך ובלי שם משרד), כדי שיישמר במטמון בין המשרדים.
- **המאמן ממליץ רק על מה שכתוב בפרומפט.** כל כלי מתואר שם במשפט, ויש רשימת
  "אין במערכת" (מענה ללידים, העברת ליד מסוכן/ת לסוכן/ת). מסירה בהפנייה של
  מנהל/ת המשרד כן ברשימה. רשימה של שמות בלבד הובילה
  בריצה הראשונה להמלצות על יכולות שאין. כלי חדש, או כלי שהתנהגותו השתנתה (למשל
  גבריאלה שמתחילה לפנות ללידים), מעדכן את הרשימה **באותו PR**.
- **מין רק מ-`agency_members.gender`, ובלעדיו סביב השם.** השדה נבחר בפרופיל ליד ת.ז.
  (לא חובה). המאמן מעביר `gender` רק כש-`male` / `female` (‏`compactPeriod`, עם בדיקה
  ב-`office_coach_test.ts`), והפרומפט אוסר לנחש: בלי ערך כותבים "לטל אין לידים" ולא
  "אין לו". הלוכסן נשאר לתפקיד ולקבוצה. כל טקסט חדש שהמערכת כותבת על סוכן/ת בשמו/ה
  (בוט, התראה, דשבורד) קורא את אותו שדה, ולא מנחש משם.
  מה שמשתנה עובר בהודעת המשתמש.
- `office_coach_due()` מסננת משרדים בלי תנועה ב-30 יום - כל קריאה עולה כסף.
- העלות האמיתית: `input_tokens`/`output_tokens` ב-`office_coach_summaries`.

## ‏4א. "שאל את המנטור" (`coach-ask`)

- **תשובה בלבד.** אין כלים, אין `cta`, והמודל לא מבצע כלום. מי שמוסיף/ה כאן
  כלי או כפתור הופך/ת את השדה ממקום לשאול למקום לפעול - זו החלטה של תומר, לא
  שינוי קוד.
- **הקורא/ת מה-JWT בלבד** (`verify_jwt = true`), וההרשאה לכל `kind` היא אותה
  הרשאה של הסיכום שלו: `agent` עצמו/ה, `team` רק `agency_teams.lead_member_id`,
  ‏`office` רק `role = 'manager'`. kind חדש מקבל בדיקה ב-`loadContext` לפני
  שהוא מקבל נתונים.
- **מה יוצא למודל עובר באותו צמצום של הסיכום** (`compactPeriod`,
  ‏`compactAgent`, ‏`summaryForAsk` ב-`_shared/coach/payload.ts`). לא מעבירים
  שורות גולמיות "כי השאלה ספציפית" - מנהל/ת צוות לעולם לא מקבל/ת טלפון של ליד
  או את ההודעה החופשית, גם לא דרך שאלה.
- **המכסה נשענת על היומן.** ‏`coach_ask_count_today` סופרת שורות ב-
  ‏`coach_questions` לפי היום בישראל, ולכן תשובה שלא נרשמה ביומן אינה נספרת.
  מי שמשנה את סדר הכתיבה (תשובה ואז יומן) שומר/ת שהיומן נכתב לכל תשובה ששולמה.
- הסודות: `COACH_ASK_DAILY` (ברירת מחדל 10) ו-`COACH_ASK_MODEL`. קוד שגיאה חדש
  מהפונקציה מקבל שורה ב-`RULES` של `assets/friendly-error.js`.
- **השאלה עצמה ב-`askCoach`** (‏`_shared/coach/ask.ts`), משותפת ל-`coach-ask`
  ול-`ask_mentor` של גבריאלה - מכסה ויומן אחד לשני הערוצים.
- **מה המנטור יודע** (‏`playbook.ts` לפי קהל), הטון והוותק (‏`coach_preferences`),
  מנהל/ת שהוא/היא גם סוכן/ת (‏`manages`) והתראת הבוקר (‏`coach_daily`) - בסקיל
  `mentor`.
- הבדיקה: `node --experimental-strip-types scripts/office_coach_test.ts` (כולל
  `cleanQuestion`, ‏`cleanAnswer` והפרומפט). הפרטים: `docs/coaches.md`.

## ‏5. ביצועים

שנה של משרד עם 20 סוכנים: 386ms. הגרסה הראשונה, עם תת-שאילתה לכל סוכן/ת,
לקחה 50 שניות. **אגרגציה ב-`group by` פעם אחת**, לא שאילתה לכל שורה, ומדידה
על נתוני שנה לפני מיזוג (`docs/office-dashboard.md`, "ביצועים").

## ‏6. בממשק

- טקסט עם לוכסן (סוכן/ת, את/ה) - אין עמודת מין ב-`agency_members`.
- **בממשק קוראים להם "מנטור", בקוד "coach" / "מאמן".** כותרת, כפתור, הודעת שגיאה
  או שורה בדף המסלולים - "מנטור" (וכך גם הזהות של המודל בפרומפטים, כי הוא כותב
  את מה שמוצג). הערות, שמות קבצים וטבלאות נשארים. `docs/coaches.md`.
- בלי מקף ארוך (`check_long_dash.py`), בלי d3 - הגרפים בנויים ידנית.
- קישור מתוך הדשבורד פותח את הפריט עצמו (`openLeadFromParam`,
  ‏`openPropertyFromParam`, ‏`openAgreementFromParam`), לא קטגוריה.
- `crm-my-dashboard.js` משתמש בעזרים של `crm-office-dashboard.js` (`od*`),
  ולכן נטען אחריו. שינוי שם של עזר שובר את שני הדשבורדים.

## ‏7. בדף המסלולים

שני הדשבורדים והמאמן **פתוחים לכל המסלולים** - אין להם גייט, והם מופיעים
ב-`pricing.html` כשורות ✓ בשלוש העמודות, ובכרטיס Pay&GO ב-`assets/tiers.js`.
מי שמגביל/ה אחד מהם למסלול (למשל המאמן ל-Elite) עובר/ת בסקיל
`new-tier-capability`: גייט במסד (גם ב-`office_coach_due`, אחרת הסיכום נכתב
ומשולם למשרד שלא יראה אותו), השורה ב-`COMPARE` וב-`GATES`, הכרטיס, והתיעוד.
