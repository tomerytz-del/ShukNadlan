---
name: cma-report
description: עבודה על דוח ה-CMA (השוואת שוק) בריפו של שוק נדל״ן - agent_cma_report והעטיפה agent_cma_report_full, הסולם (חדרים, קומה לנכס מסחרי, תת-סוג לבית/דירת גן/פנטהאוז, רדיוס עד 2,000 מ'), ההשתקה מתחת לסף, property_type_class / property_kind / floor_group, בחירת 8 העסקאות להצגה, ותצוגת הדוח הממותגת עם לוח המדדים והשעונים (renderCmaReport, loadCmaBrand). Use when touching agent_cma_report / agent_cma_report_full / cma_deal_pool / cma_report, renderCmaReport / cmaSampleNote / cmaGaugeCard in assets/crm.js, toolCmaReport in the WhatsApp bot, when a CMA shows a number that looks wrong (a shop at +186%, a penthouse priced like a regular flat), when adding a property type to the site or to deals_engine, when the report "has no average", or when changing what the client sees in the printed report.
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

## ‏2. שתי פונקציות, ומי קורא למה

| פונקציה | מה | מי קורא |
| --- | --- | --- |
| `agent_cma_report` | הסטטיסטיקה, הסולם, השכבות. 600 שורות, כל גרסה העתק מלא | העטיפה בלבד |
| `agent_cma_report_full` | בעלות (טאבו), רבעונים ואחוזון, **וחיתוך** ל-8 העסקאות להצגה | `cma_report` (הדשבורד) והבוט |

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
המצבים שבהם הסינון לא הצליח נאמרים בקול. ‏`scripts/cma_gap_test.py` מריץ את
`cmaSampleNote` האמיתית על כל הערכים - מוסיפים לו מקרה.

## ‏5. התצוגה: ממותגת, ונתונים בצבעים של נתונים

- **המיתוג** (`loadCmaBrand`): לוגו, צבעים ופרטי הסוכן/ת שמפיק/ה. צבע רק
  דרך `normalizeHex`, תמונה רק https. כשל בו לא מפיל את הדוח.
- **צבע המשרד צובע כותרות, לא נתונים.** השעונים והפס בסקאלה מתפצלת קבועה
  (כחול `#2a78d6` - אפור - אדום `#e34948`), שנבדקה ב-`validate_palette.js`
  של סקיל `dataviz`. צבע של משרד אינו אומר "יקר".
- **מספר גיבור אחד**, ב-Heebo ולא בסריף. השעון מציג ערך ומשמעות בטקסט -
  הצבע לעולם לא לבד.
- **כיוון:** זול מימין, יקר משמאל - בשעונים ובפס.
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
python3 scripts/cma_gap_test.py
python3 scripts/check_deals_normalize.py
python3 scripts/check_migration_versions.py --base-ref origin/main
```

והמיגרציה עצמה - פעמיים, על מסד מקומי נקי (אידמפוטנטיות). ‏`cma_deal_pool`
משנה טיפוס החזרה ולכן `drop` + `create`; ‏`agent_cma_report` היא PL/pgSQL,
כלומר שגיאה בגוף שלה תתגלה רק בקריאה, לא ביצירה - **להריץ אותה** על נכס
מכל סוג (דירה, בית, פנטהאוז, חנות).
