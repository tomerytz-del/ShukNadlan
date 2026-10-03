---
name: client-showcase
description: עבודה על המיניסייט האישי ללקוח/ה בריפו של שוק נדל״ן - showcase.html, ה-Edge Function client-showcase, assets/crm-showcase.js והטבלאות client_showcase_*. הדף ממותג במשרד ובסוכן/ת והנכסים בלי מיתוג וכולם באותו טיפול (כדי שלא יידעו מה הגיע בשת"פ), זיהוי הלוגו בתמונות שנכשל סגור, ניקוי התיאור, המאגר שממנו מותר לשלוח, תיאום השת"פ אחרי "אהבתי", וההסרה בשני שלבים. Use when touching showcase.html / assets/showcase.js / client-showcase / crm-showcase.js / showcase_add_properties, when adding a field to what the client sees, when a property or image "disappeared" from a client's mini-site, when a client could tell a property came from another office, or when changing the first WhatsApp message that sends the link.
---

# המיניסייט האישי ללקוח/ה

המסמך המלא: `docs/client-showcase.md`. כאן רק מה ששובר **בשקט** - כל אחד
מהסעיפים נראה תקין בתצוגה המקדימה ונכשל רק מול לקוח/ה שחשבון אחר שלו/ה
מסגיר את מה שהיה אמור להישאר מוסתר.

## המפה

| קובץ | תפקיד |
| --- | --- |
| `showcase.html` + `assets/showcase.js` | העמוד של הלקוח/ה: מיתוג, לשוניות, תגובה, שיחה, סיור, שיתוף |
| `supabase/functions/client-showcase/index.ts` | ‏`view` / `react` / `message` / `meeting` / `cancel_meeting` (טוקן) · `scan` (‏JWT) |
| `supabase/functions/client-showcase/scrub.ts` | ניקוי התיאור ומיסוך מספר הבית |
| `supabase/functions/client-showcase/branding.ts` | זיהוי לוגו / סימן מים (Gemini) |
| `assets/crm-showcase.js` | תיבות הסימון בהתאמות, חלון השליחה והודעת הפתיחה, הפאנל בכרטיס, תיאום השת"פ |
| `supabase/migrations/20270208090000_client_showcases.sql` | הטבלאות, ה-RLS, `showcase_add_properties`, `showcase_decide_meeting` |

## שישה דברים ששוברים בשקט

### 1. שדה חדש לנכס - לכולם או לאף אחד

`publicItem` ב-`index.ts` בונה **כל** נכס באותו אופן, בלי לדעת אם הוא שלי
או בשת"פ. זו כל ההגנה: אם נכס שלי מגיע עם סרטון ונכס בשת"פ בלעדיו, ההבדל
עצמו מסמן את השני. לכן:

- שדה שמוסיפים לתשובה - נוסף **לכל** הנכסים, או לא נוסף.
- אסור להחזיר `source`, `property_id`, `title` המקורית, `agent_id` או כל
  דבר שנגזר מהמשרד המפרסם. הכותרת נבנית בדף מהשדות.
- שדה שעלול לשאת את המשרד (סרטון, סיור תלת-ממדי, `marketing_image`,
  `post_text`, `agent2_*`, ‏`exclusive` במאפיינים) - לא נשלח לאף נכס.

### 2. תמונה מוצגת רק אחרי `has_branding = false`

`null` (לא נבדק, Gemini נפל, הורדה נכשלה) **מוסתר**, וגם בנכס של המשרד
שלי. מי ש"משפר" ל"הצג אם לא נבדק" מחזיר בדיוק את הלוגו של המשרד השני
ברגע הראשון שהמכסה נגמרת. אם לקוח/ה רואה/ה "תמונות יישלחו בהמשך" - הפתרון
הוא "🔍 בדיקת לוגו" בפאנל (‏`scan`), לא פתיחת המסנן.

`detectBranding` מחזיר `true` רק על `YES` ו-`false` רק על `NO` מפורש. כל
תשובה אחרת היא `null`.

### 3. ניקוי התיאור מוריד שורה, לא מספר

`scrubPartnerText` מוחק **שורה שלמה** שיש בה טלפון, מייל, אתר, שם המשרד או
הסוכן/ת המפרסם/ת, או מילים כמו "בלעדיות" / "לפרטים". "לפרטים: רונית, תיווך
הצפון" בלי המספר עדיין מזהה את המשרד. הוא רץ על **כל** הנכסים (סעיף 1).
שורה תמימה שנתפסת - מחיר מכוון. בדיקה מהירה:

```sh
deno run - <<'EOF'
import { scrubPartnerText } from "./supabase/functions/client-showcase/scrub.ts";
console.log(scrubPartnerText("דירה מרווחת\nלפרטים: רונית 050-1234567\nwww.x.co.il", ["תיווך הצפון", "רונית"]));
EOF
```

### 4. נכס נכנס רק דרך `showcase_add_properties`

היא בודקת את המאגר - אותו מאגר של `match_properties_for_client`: נכסי
המשרד, ומה ששותף עם המשרד ב-`property_shares`. ל-`authenticated` **אין**
`insert` על `client_showcase_items` בכוונה. וגם בצפייה ה-Edge Function
בודקת שוב שהשת"פ קיים - משרד שביטל שת"פ מעלים את הנכס גם ממיניסייט שכבר
נשלח. מי שמוריד את הבדיקה הזו כ"כפילות" שולח ללקוח/ה נכס שהבעלים שלו
משך/ה את ההסכמה.

### 5. פרטי המתווך/ת המקורי/ת - רק לסוכן/ת

"אהבתי" על נכס בשת"פ קובע `coop_status = 'needed'` ושולח התראה עם שם,
משרד וטלפון של המתווך/ת המקורי/ת. הם מגיעים **רק** להתראה ולפאנל ב-CRM
(מ-`shared_properties_for_me`). כל שדה כזה שנכנס לתשובה של `view` - דולף
ללקוח/ה ב-DevTools גם אם הדף לא מציג אותו.

### 6. הטקסט שמוצג - בלי מקף ארוך, ובלי `events.js`

`showcase.html` ב-`PRIVATE_PAGES` של `check_events.py` וב-`PRIVATE` של
`check_canonical.py`: זה הקשר בין סוכן/ת ללקוח/ה **שלו/ה**, וחיוג משם אינו
ליד חדש. הוספת `events.js` הייתה מנפחת את `contact_agent`. הודעת הפתיחה
(`renderShowcaseShare` ב-`crm-showcase.js`) והנוסחים בדף כפופים לכלל המקף
הרגיל (`check_long_dash.py`).

## הודעת הפתיחה

הנוסח ב-`renderShowcaseShare` מסביר שלושה דברים, ושלושתם הבטחות שהקוד מקיים:
הקישור **זמין תמיד** (מיניסייט פעיל אחד ללקוח/ה, אינדקס ייחודי חלקי),
**נכסים חדשים מתווספים לאותו עמוד** (`showcase_add_properties` מוסיפה ולא
פותחת חדש), ו**אפשר לשתף** (הטוקן הוא המפתח; מי שקיבל/ה אותו פועל/ת בשם
הלקוח/ה). מי שמשנה את אחד מהשלושה - משנה גם את ההודעה ואת "🔖 העמוד הזה
שלך וזמין תמיד" בראש הדף.

## לפני הדחיפה

```sh
python3 scripts/check_events.py
python3 scripts/check_canonical.py
python3 scripts/check_long_dash.py
python3 scripts/check_escapers.py
python3 scripts/check_edge_types.py client-showcase
```
