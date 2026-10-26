---
name: cma-report
description: דוח ה-CMA (השוואת שוק) בריפו של שוק נדל״ן - cma_report_core / agent_cma_report / agent_cma_report_full / agent_cma_report_address (דוח לכתובת, Elite), הסולם (חדרים, קומה למסחרי, תת-סוג, רדיוס עד 2,000 מ'), ההשתקה מתחת לסף, property_type_class / property_kind, ו-renderCmaReport. Use when touching cma_deal_pool / cma_report / cma_report_address / toolCmaReport / cmaSummary, when Gabriela says a CMA "had a technical fault" or cannot report on an address that is not in the system, when a CMA number looks wrong (a shop at +186%, a penthouse priced like a flat), when adding a property type to the site or deals_engine, or when the report "has no average".
---

# דוח ה-CMA

הדוח שהסוכן/ת מדפיס/ה ושולח/ת ללקוח/ה. התיעוד המלא, עם המספרים שמאחורי
כל החלטה: `docs/cma.md`. כאן - מה שנשבר בשקט, ובאיזה סדר בודקים.

## ‏1. המסד מחליט מה מוצג, לא התצוגה

‏`agent_cma_report` מחזירה ממוצע **רק** כש-`data_coverage.status = 'ok'`.
מתחת לסף (`cma_min_comparables`) השדות פשוט אינם ב-jsonb. אותו כלל לכל
מספר שנוסף: חציון שוק, חציון שכונה, רבעונים ואחוזון (‏`stats.p25_*`,
‏`subject_percentile`) - כולם מושתקים במסד. **אל תוסיפו מספר שהתצוגה
"מחליטה אם להציג"**: תצוגה שמקבלת מספר תציג אותו בסוף.

## ‏2. הפונקציות, ומי קורא למה

| פונקציה | מה | מי קורא |
| --- | --- | --- |
| `cma_report_core(p_agent_id, p_prop)` | הסטטיסטיקה, הסולם, השכבות. 600 שורות, כל גרסה העתק מלא. **הנכס נכנס כשורת `properties`** ויכול להיות בלי `id` | שתי העטיפות |
| `agent_cma_report` | גייט (PROFESSIONAL ומעלה), שליפת הנכס, שכירות - ואז הליבה | `_full` |
| `cma_report_finish(p_r, p_gush, p_helka)` | בעלות (טאבו), רבעונים ואחוזון, **וחיתוך** ל-8 העסקאות להצגה | `_full` ו-`_address` |
| `agent_cma_report_full` | `agent_cma_report` + הגוש/חלקה מהמידע התכנוני + הסיום | `cma_report` (הדשבורד) והבוט |
| `agent_cma_report_address` | **Elite**: דוח לכל כתובת, נכס בזיכרון, מיקום מ-`cma_locate_address` כשאין | `cma_report_address` והבוט |

**בגבריאלה הדוח לכתובת שואל קודם** (`needs_details` → שאלה אחת → `proceed: true`).
פרט חדש שהדוח נשען עליו נכנס גם לרשימת `missing` ב-`toolCmaReportAddress`,
אחרת גבריאלה לא תשאל עליו ותפיק בלעדיו.

**הדוח לכתובת מקבל מאפיינים משתי רשימות סגורות** - `CMA_ADDR_FEATURES` בטופס
ב-CRM וה-`enum` של הכלי בגבריאלה - שתיהן העתק של `cma_price_features()`.
מאפיין שנוסף לפונקציה ולא אליהן אינו ניתן לסימון בדוח לכתובת.

**שינוי בדוח נעשה בליבה או בסיום, ואז תקף לנכס ולכתובת יחד.** בליבה כל
השוואה ל-`v_prop.id` היא `is distinct from` ולא `<>`: בדוח לכתובת ה-`id`
הוא `null`, ו-`<> null` מוחק שכבה שלמה בשקט (`docs/cma.md`, "דוח לכתובת").

**כל מה שנספר - נספר לפני החיתוך.** ספירת הבעלות, הרבעונים והאחוזון רצים
על כל ה-`comparables` ורק אחר כך הרשימה נחתכת ל-`cma_comparables_listed`.
שינוי שמזיז חישוב אל אחרי החיתוך יחשב על 8 עסקאות במקום 180, וזה ייראה
תקין לגמרי.

## ‏3. "אותו סוג" - שלוש פונקציות, ולכל סוג חדש שלושה מקומות

| פונקציה | מה |
| --- | --- |
| `property_type_class` | ‏`dwelling` / `commercial` / `land`, או `null`. **"בנין" של GovMap הוא `null`** - הוא מערבב דירות, משרדים וחנויות |
| `property_kind` | בתוך dwelling: `house` / `garden` / `roof` / `unit` |
| `floor_group`, `floor_num` | טקסט קומה חופשי של רשות המיסים לקבוצה / למספר |

**סוג נכס חדש באתר** (‏`RESIDENTIAL_PTYPE_OPTIONS` / `COMMERCIAL_PTYPE_OPTIONS`
ב-`assets/crm.js`) **או ב-`TYPE_MAP` של `deals_engine/normalize.py`**: הוא
חייב להיכנס לרשימות של `property_type_class` (ואם הוא בית/גן/גג - גם של
`property_kind`) במיגרציה. סוג שאינו מוכר חוזר `null` ונופל מכל דוח בלי
שגיאה. ‏`scripts/check_deals_normalize.py` מצליב את `TYPE_MAP` מול המיגרציה
האחרונה שמגדירה את `property_type_class`; לטופס האתר אין עדיין בדיקה כזו.

## ‏4. הסולם - ולכל נכס סולם אחר

| הנכס | הממד | הקצה |
| --- | --- | --- |
| דירה | חדרים (מדויק, ‎±0.5‎, ‎±1‎) ואז רדיוס עד פי 6 | 4,500 מ' |
| בית | חדרים, בין בתים בלבד, עם שלב 2,000 בכל רמה | 4,500 מ' |
| דירת גן / פנטהאוז | קודם אותו תת-סוג (בקירוב), עד 2,000 מ', ואז כדירה | 4,500 מ' |
| מסחרי | קבוצת קומה, ואז בלי סינון | **2,000 מ', ולא מעבר** |

הסולם הוא מערכים (`v_bands`, `v_radii`, `v_kinds`) והספירה נשענת עליהם -
לא קבועים. שלב חדש = איבר במערכים, לא שורת `count` חדשה.

**תת-סוג לעסקה הוא קירוב.** במאגר אין דירת גן, פנטהאוז או שנת בנייה. גן =
קומת קרקע; גג = הקומה העליונה שנמכרה באותו גוש+חלקה. כל `rooms_band_reason`
חדש מקבל שורה ב-`cmaSampleNote` **וב-`ROOMS_GUIDANCE` של הבוט**, ושני
המצבים שבהם הסינון לא הצליח נאמרים בקול. וכך גם "אין ממוצע" שנובע מהסינון
עצמו: נכס מסחרי ובית פרטי מקבלים ב-`cmaCoverageBlock` ובבוט הסבר משלהם
(אין סיווג מסחרי במאגר; כמעט אין בו בתים), אחרת "אין עסקאות בסביבה" נקרא
כמו דוח שבור. ‏`scripts/cma_gap_test.py` מריץ את
`cmaSampleNote` האמיתית על כל הערכים - מוסיפים לו מקרה.

## ‏5א. הקישור לדוח (`/cma?k=`) ו-`assets/cma-render.js`

גבריאלה שולחת אחרי כל דוח כפתור "📊 דוח CMA" (‏`cmaButton`, ‏`cma_links`, הפונקציה
`cma-link`). **התצוגה אחת:** ‏`renderCmaReport` ועוזריה ב-`assets/cma-render.js`,
שנטען ב-CRM לפני `crm.js` ובדף `cma.html`. שינוי בתצוגה - שם, לא ב-`crm.js`.
‏**ה-CSS בשני עותקים** (`CMA-CSS:BEGIN/END` ב-`crm.html` וב-`cma.html`), ו-
`check_cma_css.py` חוסם הבדל - שינוי CSS בדוח נעשה בשניהם. ובדף אין את רשימות
המאפיינים של ה-CRM: שם חדש מגיע עם הדוח (`subject.feature_labels`). הדוח
בקישור נשמר כמו שהוא; המיתוג נקרא בפתיחה (`cma-link/brand.ts`).

**מה-CRM - "שליחת קישור ללקוח/ה"** (‏`cmaShareReset` / `cmaShareShow` ב-`crm.js`,
‏`cma_link_share` במסד): נשלחת **הבקשה ולא הדוח**, והמסד מחשב אותו שוב עם
אותו גייט מסלול. אל תוסיף/י מסלול שמקבל `report` מהדפדפן - הדף מציג אותו
בשם המשרד. מקור חדש לדוח ב-CRM קורא ל-`cmaShareReset(request, report)` לפני
`renderCmaReport`, אחרת הכפתור שולח את הדוח הקודם.

## ‏5. התצוגה: ממותגת, ונתונים בצבעים של נתונים

- **המיתוג** (`loadCmaBrand`): לוגו, צבעים ופרטי הסוכן/ת שמפיק/ה. צבע רק
  דרך `normalizeHex`, תמונה רק https. כשל בו לא מפיל את הדוח.
- **צבע המשרד צובע כותרות, לא נתונים.** השעונים והפס בסקאלה מתפצלת קבועה
  (כחול `#2a78d6` - אפור - אדום `#e34948`), שנבדקה ב-`validate_palette.js`
  של סקיל `dataviz`. צבע של משרד אינו אומר "יקר".
- **מספר גיבור אחד**, ב-Heebo ולא בסריף. השעון מציג ערך ומשמעות בטקסט -
  הצבע לעולם לא לבד.
- **כיוון:** זול מימין, יקר משמאל - בשעונים ובפס.
- **התוכניות בכרטיס "הקרקע"** הן `mergedPlanningPlans(r.planning)`: שכבת
  העירייה (או `retzefMigrashim`) יחד עם `govmap_plans` משכבות 203/14 -
  ארציות, מתאר והודעות 77-78. ‏`cma_report` מחזירה את השורה הגולמית
  (`to_jsonb(i)`), ולכן האיחוד בדפדפן חייב להתאים ל-`planning_plans_merged`
  במסד שמשרת את דף הנכס ואת גבריאלה. הודעת 77-78 מודגשת ונאמרת כ"ייתכנו
  מגבלות", לא כאיסור (הסקיל `govmap`).
- **הדפסה:** הדוח נשלח כ-PDF. כל כרטיס `break-inside:avoid`, ומעטפת
  טבלה שנגללת חוזרת ל-`overflow:visible` ב-`@media print`.
- **בדיקה ויזואלית:** אין סביבה עם נתונים אמיתיים בלי התחברות. דרך שעבדה:
  מסד Postgres מקומי עם stubs לטבלאות, להריץ את המיגרציות, להוציא את
  ה-JSON של `cma_report`, ולהזריק אותו לדף עם ה-CSS של `crm.html` והקוד
  שבין `const CMA_BASIS` ל-`cmaCloseBtn`. צילום ב-Playwright (‏`/opt/pw-browsers/chromium`)
  ב-860 וב-390 פיקסלים.

## ‏6. ביצועים: כל פונקציה בבריכה מוכפלת פי 2,400

‏`cma_deal_pool` עוברת על כ-1,200 עסקאות ונקראת פעמיים בכל דוח. פונקציית
עזר שנוספת "לכל עסקה" היא 2,400 קריאות לדוח, ופונקציה עם `set search_path`
אינה מוטמעת - כל קריאה עולה. כך `floor_num` עם 40 ביטויי regex לקחה 682ms
לבדה, ודוח של בית עלה ל-3.4 שניות (`docs/cma.md`, "ביצועים").

- מה שתלוי רק בנכס - פעם אחת (CTE `s`), לא בתוך השורה.
- מה שנדרש רק לסוג נכס אחד - ב-`case` על סוג הנכס, כדי שלא ירוץ לשאר.
- שאילתה לפי גוש/חלקה - פעם אחת לבניין (`group by`), לא לכל עסקה.
- **מודדים את הבריכה ישירות:** ‏EXPLAIN ANALYZE על `agent_cma_report` מראה
  ‏`Result` אחד, והזמן מתחבא ב-PL/pgSQL. ‏`select count(*) from
  public.cma_deal_pool(lat, lng, cutoff, 4500, null, type, rooms)` לכל סוג
  נכס, ולפני ואחרי.

## ‏7. לפני מיזוג

```sh
python3 scripts/check_edge_types.py   # כולל שם לא מוגדר ב-agent.ts - זה מה שהפיל את הבוט
python3 scripts/cma_gap_test.py   # רץ על assets/cma-render.js
python3 scripts/check_cma_css.py  # ה-CSS של הדוח זהה ב-crm.html וב-cma.html
python3 scripts/check_deals_normalize.py
python3 scripts/check_migration_versions.py --base-ref origin/main
```

והמיגרציה עצמה - פעמיים, על מסד מקומי נקי (אידמפוטנטיות). ‏`cma_deal_pool`
משנה טיפוס החזרה ולכן `drop` + `create`; ‏`agent_cma_report` היא PL/pgSQL,
כלומר שגיאה בגוף שלה תתגלה רק בקריאה, לא ביצירה - **להריץ אותה** על נכס
מכל סוג (דירה, בית, פנטהאוז, חנות).
