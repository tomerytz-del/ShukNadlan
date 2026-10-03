# עמדת טעינה לרכב חשמלי (`ev_charger`)

אוקטובר 2026. מאפיין נכס חדש, במגורים ובמסחרי. הוא נשמר כמו כל מאפיין
אחר - קוד במערך `properties.features` - ולכן **אין מיגרציה**: לעמודה אין
`check` על הערכים, וההתאמה ללקוחות (`required_features`), החיפושים השמורים
והחיפוש של הבוט עובדים על הקודים כמו שהם.

## איפה הקוד מופיע

מאפיין נכס חי בהרבה רשימות מקבילות, ומאפיין שנשכח באחת מהן **נעלם בשקט**
שם (נשמר ולא מוצג, או מוצג ולא ניתן לסינון). זו הרשימה המלאה, וגם צ'קליסט
למאפיין הבא:

| מקום | קובץ | מה |
| --- | --- | --- |
| טופס הנכס וטופס הלקוח ב-CRM | `assets/crm.js` - `RESIDENTIAL_/COMMERCIAL_PROPERTY_FEATURES`, `FEATURE_ICONS` | צ'יפ 🔌 |
| ייבוא נכסים מקובץ | `assets/crm.js` - `IMP_FEATURE_SYNONYMS` | "עמדת טעינה", "עמדות טעינה" וכו' |
| סינון מתקדם בדף הבית | `assets/home.js` - אותן שתי רשימות | |
| פאנל "מה אתם מחפשים" בדף הבית | `index.html` - `.hs-check` עם `hs-check-wide` | תיבה חמישית, בשורה מלאה |
| דף הנכס | `assets/property.js` - `FEATURE_LABELS`, `FEATURE_ICONS` (`plug`) | |
| המיניסייט ללקוח/ה | `assets/showcase.js` - `FEATURE_LABELS` | |
| התיאור השיווקי והפוסט | `_shared/marketing-copy.ts` - `FEATURE_LABELS` | |
| העוזרת לסוכנים | `whatsapp-webhook/agent.ts` - `RESIDENTIAL_/COMMERCIAL_FEATURES` | |
| הבוט הציבורי | `whatsapp-webhook/public-agent.ts` - תיאור `features` בכלי החיפוש | |
| הסכמי תיווך (`sell`, `landlord`) | `agreement-templates.js` (שני העותקים), `AGR_FIELD_CHOICES` ו-`AGR_FEATURE_FROM_FIELD` ב-`crm.js` | שדה 41 בטבלת הנכס, מתמלא מ-`feature:ev_charger`, ו"יש" חוזר לכרטיס הנכס |
| הערכת שווי (בעלי נכסים) | `index.html`, `agency.html`, `agent.html` - `.wiz-checks` | נשלח כטקסט ל-`owner-lead-intake` |
| פרויקטים חדשים | `_shared/projects.ts` - `PROJECT_FEATURES`, `assets/project-card.js` | התקרה ב-`project-manage` היא עכשיו אורך הרשימה ולא 16 קבוע |

## מה בכוונה לא נוגע

**השוואת המחירים בדוח ה-CMA** (`cma_price_features()`): עמדת טעינה נדירה
במודעות, ומאפיין שכמעט לאף נכס אין רק מוריד את דמיון ה-Jaccard של כל
נכס שכן יש לו, בלי לומר דבר על המחיר. אם יתברר שיש לו משקל במחיר - זו
מיגרציה נפרדת, עם `create or replace` לפונקציה.
