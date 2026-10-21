---
name: search-core
description: ליבת החיפוש המשותפת לאתר ולבוטים בריפו של שוק נדל״ן - assets/search-core.js (ועותק זהה ב-_shared, check_search_core.py), מה נחשב "יש בנכס" (FEATURES), המילים והשלילה (featuresIn), השכונה של נכס (neighborhood_id לפני sales_area), פענוח שם של אזור (findAreas - כינויים, סדר הפוך, מילה מזהה), רחובות (textMatches), החוזה search_feature_cases.json, ו"שמות שלא זוהו" (area_name_misses, area_alias_approve). Use when a search on the site and Gabriela return different properties, when a feature, neighborhood or street "isn't found" or is found wrongly, when adding a feature word, alias or matching rule, when touching sentence-search.js / property-search.ts / saved_search_matches / client_property_match, or when the ops agent reports search_rules_drift or area_names_unrecognized.
---

# ליבת החיפוש

ארבעה מקומות מחליטים "האם הנכס הזה מתאים לבקשה" - ועוד שדות החיפוש של
"הנכסים שלי" ו"נכסים ששותפו" ב-CRM (‏`crmQueryMatches`, שקוראת לאותה
‏`compileQuery` של השדה החכם; סעיף 6): שורת החיפוש באתר
(‏`sentence-search.js` + `home.js`, בדפדפן), שני הבוטים (‏`property-search.ts`,
שאילתה למסד), וההתראות וההתאמות במסד (‏`saved_search_matches`,
‏`client_property_match`). הם נפרדו בעבר בכל כלל שנגעו בו - ובאוקטובר 2026
"3 חדרים עם ממ״ד" החזיר באתר דירות בלי ממ״ד, "מרכז העיר" אצל גבריאלה החזיר
נכסים באזור התעשייה, ו"במרכז" באתר חיפש את כל האזור. התיעוד המלא, עם
המספרים: `docs/search-core.md`.

## 1. כלל חדש נכתב בליבה - לא בצד אחד

`assets/search-core.js` הוא המקום **היחיד** לכללי ההתאמה. **אין לכתוב
פרדיקט, מפענח שמות או רשימת מילים משלך** ב-`home.js`, ‏`sentence-search.js`,
‏`property-search.ts`, ‏`public-agent.ts` או `agent.ts` - כך נוצרו הפערים.

הקובץ קיים פעמיים, **זהה בבית**: עורכים את `assets/` ומעתיקים -

```sh
python3 scripts/check_search_core.py --fix   # העתקה + הבדיקות
```

עותק שנשכח אינו שובר דבר ואינו נראה: האתר והבוט פשוט מחזירים נכסים שונים.

## 2. מה הליבה מחליטה

| | הכלל |
| --- | --- |
| **יש בנכס** (`FEATURES`, `hasFeatures`, `featureFilter`) | מרפסת ← גם `sun_balcony`; ממ״ד ← גם `mamad_location = 'unit'`. ‏`featureFilter` הוא אותו כלל כתנאי PostgREST לבוטים |
| **המילים** (`featuresIn`) | "עם ממד" ← `mamad`. **שלילה ממש לפני המילה אינה בקשה** ("בלי מעלית", "לא צריך חניה") |
| **איפה הנכס** (`propertyAreas`) | `neighborhood_id`. ‏`sales_area` (טקסט חופשי, סותר את השכונה ב-47 נכסים) **רק** לנכס בלי שכונה, ורק דרך מפענח השמות |
| **מה ביקשו** (`findAreas`) | בסדר הזה: שם או כינוי כמילה שלמה (הארוך גובר, ובשוויון השם על הכינוי) ← כל המילים של שם בסדר אחר ← **מילה מזהה אחת** ("ברובע") ← (בבוט בלבד) התאמה חלקית |
| **לא שכונה** (`textMatches`) | רחוב, יישוב, פרויקט: מילים **בכל סדר**, וחלק מהשם מספיק ("רום יעל" = "יעל רום", "הנשיא" = "הנשיא ויצמן") |
| **עסקה מתקציב** (`dealFromPrice`) | עד 30,000 שכירות, מ-200,000 קנייה |

**מילה מזהה** - מילה שמופיעה בשמות ובכינויים של שכונה **אחת** בלבד, אורך 3
ומעלה, ואינה שם העיר (‏`areaIndex(…, { stop })`). בלי ה-`stop` "בעפולה" היה
עפולה עלית. באתר היא נדרשת אחרי מילת מקום ("ב", "מה", "ל") - שם הטקסט הוא
משפט שלם; בבוט ‏`area` הוא שם של אזור.

## 3. החוזה - דוגמה לפני תיקון

`scripts/search_feature_cases.json` רץ ב-CI מול הליבה **ומול** התנאי של הבוטים
(`search_core_test.cjs`), ובסוכן התפעולי מול שתי פונקציות המסד
(‏`search_rules_drift`). כשמשהו "לא נמצא" או "נמצא לא נכון": **קודם דוגמה
שנכשלת שם, ורק אז התיקון.** דוגמה שנכנסה שם נבדקת בכל הארבעה.

ה-SQL אינו מריץ JS. כלל חדש ב-`FEATURES` מחייב מיגרציה ל-`saved_search_matches`
ול-`client_property_match` (ראו `20270716090000`), אחרת הסוכן ידווח.

## 4. כינויים - טבלה אחת, ושתי דרכים להוסיף

`neighborhood_aliases` היא המקור היחיד לאתר (נטען ב-`loadNeighborhoods`),
לשני הבוטים ולשיוך העסקאות. אין רשימת כינויים בקוד.

- **מהדשבורד:** "שמות שלא זוהו" בדשבורד של מנהל/ת הפלטפורמה ב-CRM - שם
  מקום שגולשים כתבו ולא זוהה, עם הצעה. "אישור ככינוי" (‏`area_alias_approve`)
  כותב את השורה עם מי ומתי בהערה.
- **במיגרציה:** לכינוי שנקבע מראש (‏`20270717090000` הוא הדוגמה).

שום דבר אינו כותב כינוי מעצמו - ההכרעה של מנהל/ת. ההרשאות לכתיבה הורדו
מ-anon ו-authenticated; כתיבה רק מהשרת או מפונקציית definer.

## 5. הלולאה - איך האתר והבוטים לומדים

| שלב | איפה |
| --- | --- |
| שם שלא זוהה נרשם | אתר: `SearchCore.areaCandidate` ← `logAreaMiss` (‏home.js, insert בלבד). בוט: `filterByArea` כשלא זוהה ולא נמצא דבר |
| הגולש/ת יודע/ת | השורה "הבנתי" אומרת "את X לא זיהיתי, אז מחפשים בכל..." - לא בשקט |
| הדוח | `_area_miss_report()` - בלי מה שכבר מזוהה ובלי מה שנדחה, עם הצעה |
| ממצא | `area_names_unrecognized` - שם שחיפשו לפחות שני מבקרים |
| הכרעה | CRM ← "שמות שלא זוהו" ← אישור / דחייה |

**מה לא לעשות:** לא להוסיף בקוד מילה למילה שגולש/ת כתב/ה - זה בדיוק מה
שהטבלה והלולאה קיימות בשבילו. מילה **כללית** (סוג נכס, מאפיין, מילת עסקה)
- כן, ב-`KNOWN_WORD` של `areaCandidate` או במפרש של המשפט.

## 6. ב-CRM - אותה פונקציה, ושם קודם לפענוח

שדות החיפוש של "הנכסים שלי" ו"נכסים ששותפו" עוברים ב-`crmQueryMatches`
(‏`assets/crm.js`) ← `SentenceSearch.Core.compileQuery`. שלושה כללים שנשברים
בשקט:

- **שם קודם לפענוח** (‏`namesOf`): טקסט שמתאים לשם של בעלים, משרד, סוכן/ת או
  טלפון בשורה כלשהי - טקסט. "משרד שותף" אינו סוג נכס. **שמות בלבד, לא
  התיאור** - שם בדיוק "ללא ממ״ד" מתאים ל"ממד".
- **משהו זוהה - בלי חזרה לטקסט.** איחוד עם חיפוש טקסט מחזיר את הבאג.
- **שדה חדש בשורה** שהחיפוש צריך (‏`neighborhood_id`, ‏`features`,
  ‏`mamad_location`) - גם ב-`shared_properties_for_me`, בסוף ה-view.

הקבצים נטענים בהקלדה הראשונה (‏`ensureCrmQuery`), לא בפתיחת ה-CRM. בדיקה:
Playwright על `crm.html` עם `myPropertyRows` מדומה (הסקיל `property-card`),
ו-route ל-`/rest/v1/neighborhood_aliases` - בלעדיו הבקשה נכשלת אחרי 7 שניות
והחיפוש עובד בלי כינויים.

## לפני הדחיפה

```sh
python3 scripts/check_search_core.py       # שני העותקים + 70+ דוגמאות
node scripts/sentence_search_test.cjs
python3 scripts/ops_search_rules_test.py && python3 scripts/ops_area_names_test.py
python3 scripts/check_edge_types.py whatsapp-webhook   # אם נגעת ב-property-search.ts
```

ושינוי בהתנהגות - **השוואה על הנתונים האמיתיים** לפני ואחרי (שליפה בקריאה
בלבד של הנכסים, השכונות והכינויים, והרצת הישן והחדש על אותם ביטויים).
כך נמצא שהשינוי של `sales_area` הוציא שבעה נכסים מ"מרכז העיר" - ושהם באמת
לא שם.
