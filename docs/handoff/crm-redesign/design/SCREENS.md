# מסכי העיצוב

כל קובץ `.dc.html` הוא מסך אחד מקנבס העיצוב. הקבצים לא נפתחים כמו שהם בדפדפן, כי הם תלויים
ב-runtime של הקנבס (`support.js`). **קוראים אותם כטקסט:** המבנה והסגנון ב-HTML (inline styles),
והנתונים וההתנהגות ב-`renderVals()` בסוף הקובץ. לצפייה חיה: הקנבס (הקישור ב-`README.md`).

**תחביר:** `{{x}}` = ערך מ-`renderVals()`. ‏`<sc-for list="{{items}}" as="it">` = לולאה. ‏`<sc-if value="{{cond}}">` = תנאי.
‏`<dc-import name="Sidebar" role="team">` = שילוב של רכיב מקובץ אחר (`Sidebar.dc.html`) עם props.
‏`data-props` = "הגדרות המסך" בקנבס, למשל `role`, `done` ו-`manager`, שמראות מצבים שונים של אותו מסך.

| קובץ | מידות | מצבים (data-props) | HANDOFF |
| --- | --- | --- | --- |
| `Main.dc.html` | 390×844 | `role`: agent / team / office | 2.6 |
| `Mobile-Create.dc.html` | 390×844 | | 2.3 |
| `Mobile-Search.dc.html` | 390×844 | צ'יפים לחיצים | 2.4 |
| `Mobile-Profile.dc.html` | 390×844 | | 2.5 |
| `BottomNav.dc.html` | 390×96 | `active` | 2.2 |
| `Mobile-Coach.dc.html` | 390×844 | `role` | 6.8 |
| `Mobile-Team.dc.html` | 390×844 | | 4 |
| `Desktop-Dashboard.dc.html` | עמוד גמיש, 1440 | | 2.6 |
| `Desktop-Performance.dc.html` | עמוד גמיש, 1440 | תפריט הפרופיל פתוח | 2.5, 6 |
| `Sidebar.dc.html` | 260 (72 מכווץ) | `role`, `active`, `alsoAgent`, `rail`; קבוצות לחיצות | 2.1 |
| `CoachCard.dc.html` | 760 | `role`, `compact`; "סמן כבוצע" לחיץ | 6.1 |
| `Desktop-TeamLead.dc.html` | עמוד גמיש, 1440 | | 4 |
| `Desktop-Office.dc.html` | עמוד גמיש, 1440 | | 5 |
| `Onboarding-Desktop.dc.html` | עמוד גמיש, 1440 | `done` 0-7, `manager` | 7 |
| `Onboarding-Mobile.dc.html` | 390×844 | `done` 0-7; הכפתור מקדם צעד | 7 |

**כל הנתונים במסכים הם נתוני הדגמה.** שמות, סכומים ואחוזים לא מגיעים מהמסד. ערכים בסוגריים מרובעים
(`₪[סכום]`, ‏`[X]%`) הם מקומות שבהם במכוון לא הומצא מספר.
