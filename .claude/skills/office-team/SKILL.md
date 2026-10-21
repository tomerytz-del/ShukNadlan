---
name: office-team
description: צוות המשרד ותפקידים בריפו של שוק נדל״ן - role = 'manager' הוא כל ההרשאה ואין "בעלים", מינוי מנהל/ת (setMemberRole), protect_sensitive_agency_member_fields, איחוד שני משרדים, slug של סוכן/ת והחלפת מייל הכניסה. Use when appointing another manager, when someone asks who "owns" an office, when an office was opened twice and needs merging, when moving an agent between offices, when an agent must log in with a different email or sees "מי את/ה?".
---

# צוות המשרד, מנהלים, ואיחוד משרדים

המסמכים: `docs/agent-invitations.md` (סעיף 4, מינוי מנהל/ת), ‏
`docs/account-closure.md` (המנהל/ת האחרון/ה). כאן מה ששובר בשקט.

## אין "בעלים" - יש מנהלים, וכולם שווים

‏`agency_members.role` מקבל שני ערכים בלבד (`agent`, `manager`), וזו כל
ההרשאה. אותה עמודה נבדקת בשלושה מקומות:

| שכבה | הבדיקה |
| --- | --- |
| RLS | ‏`current_member_role() = 'manager'` (למשל העדכון והקריאה ב-`agency_members`) |
| פונקציות Edge | ‏`caller.role !== "manager"` → ‏`managers_only` (‏`add-team-member`, ‏`release-team-member`, ‏`join-agency` decide) |
| CRM | ‏`#managerSection` מוצג לפי `currentAgent.role` |

לכן **"לתת למישהו את כל ההרשאות של מנהל/ת" = `role = 'manager'`**, ושום
דבר נוסף. מי שמוסיף/ה יכולת למנהלים בודק/ת את אותה עמודה, ולא ממציא/ה
דגל "בעלים" חדש - דגל כזה היה מפצל את המנהלים לשתי דרגות בלי שאף מסך יודע.

## צוותים ו"גם סוכן/ת פעיל/ה"

מנהל/ת **צוות** אינו/ה תפקיד: זה `agency_teams.lead_member_id`, וה-`role` נשאר
`agent` או `manager`. ‏`team_id` ו-`is_active_agent` נכתבים בידי מנהל/ת המשרד
(ו-`is_active_agent` גם בידי מנהל/ת לעצמו/ה); הטריגר מחזיר אותם בעדכון עצמי
של סוכן/ת, וטריגר העקביות מוציא מהצוות מי שעובר/ת משרד. **שני FK בין
`agency_members` ל-`agency_teams`** - לא לכתוב embed ביניהן. ‏`docs/teams.md`.

## מינוי והורדה - מה-CRM, לא מהמסד

הכפתור "👑 מינוי למנהל/ת נוסף/ת" (והפוך: "↓ הורדה לסוכן/ת") יושב בכל כרטיס
ב"צוות המשרד", כולל כרטיס שממתין להזמנה. ‏`setMemberRole` מעדכן שורה אחת
דרך RLS.

- **‏RLS שחוסם מחזיר 0 שורות ולא שגיאה.** לכן העדכון נעשה עם
  `.select('id')` ונבדק שחזרה שורה; בלי זה הדפדפן מציג "בוצע" על כלום.
- **אף אחד לא מקדם את עצמו:** `protect_sensitive_agency_member_fields`
  מחזיר `role`, ‏`active` ו-`agency_id` לקדמותם בעדכון עצמי. לא לעקוף את זה
  בפונקציית `security definer` "לנוחות".
- **משרד לא נשאר בלי מנהל/ת** כי מי שלוחץ/ת הוא מנהל/ת ואינו/ה יכול/ה
  להוריד את עצמו/ה. מי שמוסיף/ה דרך חדשה להוריד מנהל/ת (פונקציה, בוט) חייב/ת
  לבדוק שנשאר עוד מנהל/ת פעיל/ה - כמו `last_manager` ב-`release-team-member`.
- **מינוי בהזמנה נשמר:** `add-team-member` כותב `role: 'agent'` רק ביצירה,
  ו-`join-agency` אינו נוגע בתפקיד. מי שמוסיף/ה ל-`join-agency` כתיבה של
  `role` מוחק/ת בשקט מינויים שנעשו לפני ההצטרפות.
- ההרשאות נכנסות לתוקף בטעינה הבאה של ה-CRM אצל מי שמונה/תה.
- חלון האישור הוא `confirmPurchase` עם `hidePrice`, ‏`requireAck` ו-
  **`terms: false`**: מינוי אינו רכישה, ובלי זה מופיעה בו השורה "הרכישה
  כפופה לתקנון". כך גם חלון "השעיה וניתוק מהמשרד" (`releaseMember`), וכל
  חלון אישור חדש שאינו רכישה.

**מינוי מנהל/ת מפעיל אימות דו-שלבי חובה** (‏`_mfa_role_required`, מ-
`20270507090000`): בבקשה הבאה שלו/ה יופיע מסך האימות בוואטסאפ. זה נכון רק
אם יש נייד בכרטיס; בלי נייד אין לאן לשלוח, והחובה מחכה עד שיתווסף.
מי שמוסיף/ה תפקיד חדש עם הרשאה רחבה מוסיף/ה אותו גם לשם. ‏`docs/mfa.md`.

## איחוד שני משרדים שנפתחו בטעות

קרה עם "טריו נכסים" (מיגרציה `20270417091000_merge_trio_agencies.sql` -
העתיקו ממנה). **מיגרציה, לא SQL ידני**: זה שינוי נתונים, אבל הכלל של
הריפו הוא שהמסד משתנה דרך הצינור, והקובץ הוא גם התיעוד של מה שקרה.

1. **לבחור את המשרד שנשאר** - בדרך כלל זה עם הנכסים, הלוגו והכתובת. לבדוק
   קודם מי בכל משרד ומה מספר הנכסים, ולשאול אם לא ברור.
2. **להעביר את החברים** (`agency_id`). מזהי החברים אינם משתנים, ולכן כל מה
   שנקשר לחבר/ה - נכסים, לקוחות, ארנק, מסלול, רישיון - עובר מעצמו.
3. **להעביר כל טבלה שמפנה ל-`agencies`.** הרשימה משתנה; לשלוף אותה מהמסד
   ולא מהזיכרון:
   ```sql
   select tc.table_name, kcu.column_name, rc.delete_rule
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
     join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
     join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_schema = 'public' and ccu.table_name = 'agencies';
   ```
   ועוד עמודות `agency_id` **בלי** FK (‏`agency_member_claims`,
   ‏`agency_members.released_from_agency_id`) - לחפש ב-`information_schema.columns`.
4. **שלוש טבלאות עם מפתח ייחודי שמתנגש** - מחיקה לפני העברה:
   - ‏`property_shares` - ‏`unique (property_id, shared_with_agency_id)`. שיתוף
     שהמשרד שנשאר כבר קיבל, **או שהנכס הוא של המשרד שנשאר עצמו**, נמחק.
     **ומשרד שנפתח בטעות כבר קיבל הפצות** מרגע היצירה (הטריגר
     `agencies_share_backfill`), כלומר יש לו כמעט תמיד שורות כאלה - לא רק
     כשמישהו שיתף איתו ידנית.
   - ‏`agent_share_exclusions` - ‏`primary key (agent_id, agency_id)`.
   - ‏`agency_rankings` - מפתח `agency_id`; מוחקים, הדירוג מחושב מחדש.
5. **רק אז למחוק את המשרד הישן.** חלק מה-FK הם `cascade` (‏`properties`,
   ‏`reviews`, ‏`property_shares`) - מחיקה לפני ההעברה מוחקת אותם בשקט.
6. **לעטוף ב-`do $$` עם תנאי יציאה** כשהמשרד הישן כבר לא קיים, ו-`raise
   exception` כשהמשרד שנשאר חסר - כך הריצה החוזרת לא עושה כלום.

**מה שאובד ואין לו תיקון:** דף המשרד הישן (`/agency?slug=...`) מפסיק לעבוד.
לומר את זה למי שביקש/ה.

## ‏slug של סוכן/ת

‏`agency_members.slug` הוא הכתובת `/agent?slug=...`, ו-`unique`. משרד שנפתח
דרך ההרשמה נתן לפעמים למנהל/ת slug משם המשרד במקום מהשם. **אין טבלת הפניות
מ-slug ישן**, ולכן שינוי שובר קישורים ששותפו: לשנות כשהחשבון חדש, או לומר
במפורש שהקישור הישן יפסיק לעבוד. במיגרציה - לסנן לפי ה-slug הישן ולבדוק שה-
slug החדש פנוי (`20270417092000_nissim_ben_ezra_slug.sql`).

## החלפת חשבון הכניסה (המייל) של סוכן/ת

הכרטיס (`agency_members`) קשור לחשבון ב-`auth.users` דרך `user_id`, ולא דרך
המייל. סוכן/ת שנכנס/ת עם Google בכתובת אחרת מקבל/ת **משתמש חדש בלי כרטיס**
ומסך "מי את/ה?" - ולא את הכרטיס הקיים. המסלול הרגיל הוא בקשת שיוך לפי
מספר רישיון (`join-agency`, ‏`claim`), שמנהל/ת המשרד מאשר/ת (`decide`).

**המלכודת: המנהל/ת היחיד/ה שמבקש/ת לשייך את הכרטיס של עצמו/ה.** את הבקשה
יכול/ה לאשר רק מנהל/ת מחובר/ת - כלומר החשבון הישן, שבדיוק אליו לא נכנסים.
הבקשה נשארת `pending` לנצח (כך תמיר ברגר, נדל"ן צפון, 19.10.2026 - שלוש
בקשות). התיקון ידני, ועושה **בדיוק** מה ש-`decide` עושה:

1. לוודא ששני המשתמשים קיימים ב-`auth.users`, ושלחשבון החדש אין כרטיס
   משלו (`user_id` ייחודי - התנגשות היא `23505`).
2. לבדוק את הטבלאות שמפנות ל-`auth.users` (‏`pg_constraint` עם
   ‏`confrelid = 'auth.users'::regclass`) - בדרך כלל אין מה להעביר מלבד
   הכרטיס.
3. בעסקה אחת: `update agency_members set user_id = <חדש>, email = <חדש>`
   עם תנאי על ה-`user_id` הישן, וסימון הבקשה הפתוחה `approved`.
   זה DML ולא DDL, ולכן מותר דרך `execute_sql`.
4. לא למחוק את המשתמש הישן - הוא פשוט מפסיק לפתוח את הכרטיס.

**ובצד הלקוח:** כפתורי Google שולחים `prompt: 'select_account'`, אחרת
Google נכנסת בשקט עם החשבון שכבר מחובר בדפדפן ואי אפשר לבחור באחר.
כפתור Google חדש חייב לשלוח אותו גם (`docs/google-login.md`).
