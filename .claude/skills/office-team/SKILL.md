---
name: office-team
description: עבודה על צוות המשרד ותפקידים בריפו של שוק נדל״ן - מנהל/ת מול סוכן/ת (role = 'manager' הוא כל ההרשאה, אין "בעלים"), מינוי מנהל/ת נוסף/ת והורדה (addRoleAction / setMemberRole ב-assets/crm.js), הטריגר protect_sensitive_agency_member_fields שחוסם קידום עצמי, איחוד שני משרדים שנפתחו בטעות לאותו משרד (כל הטבלאות שמפנות ל-agencies, property_shares ו-agent_share_exclusions עם המפתחות הייחודיים), ושינוי slug של סוכן/ת (אין הפניה מהישן). Use when a manager wants to appoint another manager, when someone asks who "owns" an office, when an office was opened twice and needs merging, when moving an agent between offices, when an agent page URL carries the office name instead of the agent's, or when touching loadTeam / updateMemberField / the role column.
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
  כפופה לתקנון". חלון אישור חדש שאינו רכישה עושה אותו דבר.

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
