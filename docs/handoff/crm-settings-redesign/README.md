# שוק נדל״ן CRM - חבילת עיצוב

## מה בתיקייה
- **`HANDOFF.md`** - מסמך העברה מלא ל-Claude Code: כללים, טוקנים, מפרט לכל מסך, שינויים במסד, שאלות פתוחות, סדר ביצוע ובדיקות. **מתחילים כאן.**
- **`design/`** - 22 מסכי מחשב + רכיב `AreaPicker` + `canvas.json` (מבנה הקנבס).
- **`design/mobile/`** - 21 עטיפות נייד (390px). כל אחת מציגה את מסך המחשב התואם; ההתאמה לנייד יושבת בתוך כל מסך.
- **`design/assets/`** - תמונות הדגמה בלבד (נחתכו מצילומי מסך).
- הקנבס החי: https://claude.ai/code/artifact/3478e591-4078-4312-b14e-63c61d50b192

## איך להפעיל ב-Claude Code
1. להעתיק את התיקייה לשורש הריפו `tomerytz-del/ShukNadlan` (למשל `docs/handoff/crm-settings-redesign/`).
2. לבקש:
   > קרא את `docs/handoff/crm-settings-redesign/HANDOFF.md` ואת `docs/handoff/crm-redesign/HANDOFF.md`, ואז בצע את שלב 1 בסעיף 6 (סדר ביצוע) כ-PR אחד. לפני כל שינוי במסד - לאמת מול המסד החי.
3. להמשיך שלב אחרי שלב, PR לכל שורה.

## מפת קבצים

| מסך | קובץ |
| --- | --- |
| ההגדרות שלי | `Main.dc.html` |
| מספרים וירטואליים ויומן | `Numbers.dc.html` |
| הזמנת מספר | `Order-Number.dc.html` |
| הפרופיל שלי | `Agent-Profile.dc.html` |
| דף המשרד | `Office-Branding.dc.html` |
| התראות והודעות | `Notifications.dc.html` |
| הארנק שלי | `Wallet.dc.html` |
| צוותים וסוכנים | `Team.dc.html` |
| שיחות המשרד | `OfficeCalls.dc.html` |
| הלידים שלי | `Leads.dc.html` |
| קובץ הלקוחות | `Clients.dc.html` |
| התאמות חכמות | `Matches.dc.html` |
| נכסים | `Properties.dc.html` |
| עסקאות באזור | `Deals.dc.html` |
| מידע תכנוני | `Planning.dc.html` |
| משרדי שיתוף פעולה | `Partners.dc.html` |
| חנות הלידים | `LeadStore.dc.html` |
| הסכמים והחתמות | `Agreements.dc.html` |
| יומן ומשימות | `Agenda.dc.html` |
| דף הבית | `Home.dc.html` |
| תפריט הצד (מחשב) | `Nav.dc.html` |
| סרגל תחתון ותפריט (נייד) | `mobile/M-Nav*.dc.html` |
| רכיב: תחום ואזורי פעילות | `AreaPicker.dc.html` |

## בריפו
- `design/assets/` (תמונות ההדגמה שנחתכו מצילומי מסך) **לא נכנסה לריפו**: אלה צילומים של סוכנים ומשרדים אמיתיים, והם נועדו להדגמה בקנבס בלבד. בקבצים שמפנים אליהם התמונה פשוט לא תיטען. תמונות המנטור כבר נמצאות באתר: `assets/mentor-avatar.webp` ו-`assets/mentor-cutout.webp`.
- שלב 1 (תשתית העיצוב) בוצע: הרכיבים ב-`crm.html` (תחת "ערכת הרכיבים") וב-`assets/crm-ui.js`, והמדריך ב-`docs/crm-ui-kit.md`.
