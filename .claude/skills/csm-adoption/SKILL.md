---
name: csm-adoption
description: אזור ההטמעה של שוק נדל״ן (/csm) - התפקיד החדש של מנהלת ההדרכות וההטמעה, שאינה סוכנת ואינה מנהלת פלטפורמה. csm_staff וההזמנה לפי מייל (csm_claim, כניסה עם Google), current_is_csm, הצנרת והפגישה (crm-csm.js, משותף ל-csm.html ולתצוגת הפיקוח ב-crm.html דרך CSM_CTX), csm_agents_overview (פרטי קשר ורמת שימוש), הקלטות שיחה (csm_calls, csm-workspace, _shared/csm-call.ts), מנטור ההטמעה (CSM_PLAYBOOK, csm_mentor_questions), וגבריאלה מול הצוות (csm-chat.ts, csm-tools.ts, ההיכרות "מה אפשר לעשות כאן"). Use when touching csm.html / assets/csm-page.js / assets/crm-csm.js / assets/csm-workspace.css / any csm_* table or function / csm-workspace / csm-chat.ts / csm-tools.ts / csm-call*.ts / coach/csm*.ts, when adding a tool or a tab for the adoption team, when the CSM cannot log in or sees "אין גישה", when a recording is stuck in processing or failed, when Gabriela answers the CSM like an agent (or an agent like the CSM), or when someone asks to give the CSM access to more data.
---

# אזור ההטמעה (CSM)

המסמך המלא: `docs/csm-adoption.md`. כאן - מה שנשבר בשקט.

## 1. היא לא סוכנת - ולא מוסיפים לה דגל ב-`agency_members`

זה נבנה כך פעם אחת ונפסל: שורה ב-`agency_members` היא סוכנת של משרד - היא מופיעה
בצוות, מקבלת דף סוכן/ת, נכסים, לידים, ארנק ומסלול, וכל יכולת חדשה לסוכנים מגיעה
אליה. **הזהות היא `csm_staff`**, וההרשאה לכל דבר `csm_*` היא `current_is_csm()`
(הצוות, ומנהל/ת הפלטפורמה שמפקח/ת). טבלה או פונקציה חדשה של האזור - אותה הרשאה,
ותמיד `revoke ... from public, anon, authenticated` (הסקיל `new-migration`).

**ובכיוון ההפוך - היא לא מנהלת פלטפורמה.** אין לה `current_is_platform_admin()`,
ואסור לפתוח לה פונקציה של ניהול "כי זה נוח". מה שהיא צריכה נכנס כ-`csm_*`.

## 2. הכניסה: מייל מאומת, ו-Redirect URL

- ‏`csm_claim()` מחברת `auth.uid()` להזמנה **לפי המייל המאומת** (`email_confirmed_at`),
  פעם אחת. "אין גישה" כמעט תמיד = נכנסה עם מייל אחר מזה שבהזמנה. המסך מראה את
  המייל שאיתו נכנסה - לבדוק אותו מול `csm_staff_list()`.
- ‏`https://shuknadlan.co.il/csm` צריך להיות ב-Redirect URLs של Supabase. בלעדיו
  החזרה נוחתת בדף הבית ו-`auth-return.js` מחזיר אותה - עובד, בסיבוב.
- ‏`csm_staff_save` **דוחה נייד של סוכן/ת**: גבריאלה מזהה סוכנים קודם, ואז היא
  הייתה מקבלת את העוזרת של הסוכנים.

## 3. מודול אחד, שני בתים (`crm-csm.js`)

אותו קובץ רץ ב-`csm.html` (אשת הצוות) וב-`crm.html` (פיקוח של מנהל/ת הפלטפורמה).
מה שמבדיל הוא `window.CSM_CTX` (`isStaff`, `isAdmin`):

- **המנטור וההקלטות - `isStaff` בלבד.** הם רשומים על `csm_staff.id`; ב-CRM אין כזה.
- **"צוות ההטמעה" - `isAdmin` בלבד.**
- **המודול לא נוגע ב-`currentAgent`** מלבד הנפילה של `csmCtx()` ב-CRM. ‏`created_by` /
  `updated_by` מגיעים מ-`csmUserId` (ה-session), כי ב-`/csm` אין `currentAgent`.
- **העיצוב ב-`assets/csm-workspace.css`, לא מוטבע ב-`crm.html`.** ב-CRM `csmEnsureCss()`
  טוען אותו בפתיחה הראשונה - אחרת הוא נוסף לעלייה של כל סוכן/ת (הכלל על CSS מוטבע
  נמדד על העלייה; הסקיל `crm-startup`). ‏`.btn`, `.field`, `.pm-*` והטוקנים באים
  מהדף, ולכן `csm.html` מגדיר אותם בעצמו.
- לשונית חדשה: כפתור ב-**שני** הדפים, ענף ב-`csmRender`, ואם היא של צוות בלבד -
  בתנאי ההסתרה שבראש `csmRender`.

## 4. ‏`csm_agents_overview()` - מה הצוות רואה

שני קוראים: הדפדפן (`current_is_csm()`) ו-`service_role` (גבריאלה, המנטור וניתוח
השיחות - דרך `auth.role()`), ולכן בלי עטיפה נפרדת. עמודה חדשה = `drop` + `create`
(‏`returns table`), ובדיקה של כל הצרכנים: `crm-csm.js`, `csm-tools.ts`, `csm-prompt.ts`,
`csm-call.ts`.

- **ת.ז., לקוחות, לידים ונכסים - לא.** רק ספירות. בקשה "לתת לה גישה ל..." היא
  החלטת פרטיות, לא שורה בפונקציה.
- **למודל - שמות בלבד.** ‏`csmPortfolio` (המנטור) ו-`agentCard` ב-`csm-call.ts` לא
  מעבירים טלפון, מייל או כתובת. ‏`office_coach_test` בודק את הראשון.

## 5. גבריאלה מול הצוות: תור נפרד

`index.ts`: סוכן/ת ← `csm_staff` לפי `phone_e164` ← הבוט הציבורי. התור ב-`csm-chat.ts`:
`CSM_BOT_SYSTEM`, היסטוריה ב-`csm_whatsapp_conversations`, והכלים של `csm-tools.ts`.

- **שום דבר של הצוות לא נכנס ל-`agent.ts`** - לא כלי, לא שורה ב-`SYSTEM_STATIC`. זה
  היה משנה את הקידומת במטמון של כל הסוכנים, ופותח לה כלים של סוכנים. הבדיקה חוסמת.
- **כלי חדש ב-`CSM_TOOLS` מקבל שורה ב-`csmCapabilities`** - ההיכרות וה"מה אפשר
  לעשות כאן" הם נוסח קבוע (מדויק, מיידי, בלי עלות), והבדיקה דורשת שכל כלי מופיע בו.
- **ההיכרות** נשלחת כשההיסטוריה ריקה, וכל פעם ש-`isCapabilitiesQuestion`. ברכה או
  השאלה עצמה - ההיכרות היא התשובה; בקשה אמיתית בהודעה הראשונה - ממשיכה לתור.
  ‏`isCapabilitiesQuestion` מעוגנת לסוף ההודעה, כדי ש"מה אפשר לעשות עם יוסי?" יגיע למודל.
- **הודעה קולית = הוראה, קובץ שמע = הקלטת שיחה** - אותה הבחנה של העוזרת לסוכנים.
- כלי שכותב בודק שה-`agent_id` ברשימת `csm_agents_overview` - לא כותבים על מזהה שהמודל המציא.

## 6. הקלטות: שורה אחת, ארבעה מצבים

`pending` ← `processing` ← `done` | `failed`. ‏`processCsmCall` (`_shared/csm-call.ts`)
היא הדרך היחידה, משני הערוצים. כל כשל כותב `failed` עם **הסבר בעברית** ב-`error` -
זה מה שהמסך מציג ליד "לנסות שוב".

- **ברקע** (`EdgeRuntime.waitUntil` ב-`csm-workspace`), והדף קורא את השורה כל 4 שניות.
  תמלול של שעה לא נכנס לבקשה רגילה.
- Whisper עד 25MB; AMR נדחה עם הסבר (אין ffmpeg). התמלול נשמר **לפני** הסיכום, כדי
  שכשל במודל לא יאבד אותו.
- הניתוח ב-`tool_choice` מאולץ, ו-`cleanCallAnalysis` הוא השער: שדה חדש נכנס לסכמה
  **וגם** לניקוי וגם ל-`callAnalysisText` ולמסך, אחרת הוא נזרק בשקט.
- אין מחיקה אוטומטית. מי שמוסיף/ה - כמו `call-recordings` (cron מותנה, 90 יום).

## 7. המנטור

‏`CSM_PLAYBOOK` ב-`playbook.ts`, תחת אותם כללי עריכה של הסקיל `mentor` (כלל אצבע
במקום מספר שלא נמדד, בלי שם רשת, "(מחוץ למערכת)"). **לא נכנס לשלושת המנטורים של
הסוכנים** - והם לא נכנסים אליו. יכולת חדשה של הצוות = שורה ב-`CSM_TOOLS` ב-
`csm-prompt.ts`, אחרת המנטור לא ימליץ עליה (או ימליץ על מה שאין).

## 8. עלות

שלוש יכולות ב-`AiFeature` (`csm_mentor`, `csm_call`, `gabriela_csm`), ולכל אחת שורה ב-
`AI_FEATURES` ב-`crm.js` (`check_ai_usage.py` חוסם). התמלול נרשם כ-`transcribe`.

## בדיקה

```sh
node --experimental-strip-types scripts/office_coach_test.ts   # הפרטיות, ההיכרות, הניתוב, הניקוי
python3 scripts/check_edge_types.py csm-workspace whatsapp-webhook
python3 scripts/check_function_grants.py
python3 scripts/check_canonical.py && python3 scripts/check_pwa.py && python3 scripts/check_events.py   # csm.html פרטי
```
