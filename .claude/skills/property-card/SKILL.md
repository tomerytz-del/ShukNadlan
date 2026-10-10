---
name: property-card
description: עבודה על קטגוריית "הנכסים שלי" ב-CRM של שוק נדל״ן - שורת הפעולות שבראשה (.prop-actbar, תפריט "⋯ עוד" #propMoreMenu), סרגל הסינון (PROP_FILTER_IDS, propertyFilterState / propertyFilterActive / filterProperties, הרשת ב-#propToolbar), שורת הטאב (buildPropertyTab, ימים בשוק) וכרטיס הנכס הפתוח (buildPropertyCard - אריחי הפעולות וה-tone שלהם, שורת התגיות ו-clampCardTags, בלעדיות מ-property_exclusivities, לקוחות מתאימים מ-client_match_alerts, מונה ודפדוף תמונות). Use when adding a filter or a sort to "הנכסים שלי", when a filter "doesn't reset" or a linked property stays hidden, when adding a tile, tag or button to the property card, when choosing a tile color, when a tag "disappears" behind +N, when adding a manager-only action to the top bar, or when check_long_dash.py suddenly reports dozens of dashes in crm.js after an edit near the card.
---

# "הנכסים שלי" וכרטיס הנכס

התיעוד המלא: `docs/agent-dashboard.md` ("כרטיס הנכס", ו"ייבוא וייצוא"
שבו). הקוד: `assets/crm.js` (‏`buildPropertyTab`, `buildPropertyCard`,
‏`filterProperties`), ה-CSS ב-`crm.html` (‏`.prop-card`, `.pc-*`,
‏`.prop-actbar`, `.toolbar-grid`).

## שישה כללים, וכל אחד נשבר בשקט

1. **פקד סינון חדש נכנס ל-`PROP_FILTER_IDS`.** שלושה מקומות מאפסים את
   הסינון - "איפוס סינונים", קישור לנכס בודד (`?property=`) וקישור
   מהתזכורת (`?filter=`). פקד שחסר ברשימה נשאר מסונן אחרי איפוס, ונכס
   שהגיעו אליו מהתראה פשוט לא נפתח. ובנוסף, באותו PR:
   - שדה ב-`propertyFilterState()`;
   - תנאי ב-`propertyFilterActive()` - היא מזינה גם את "מציג X מתוך Y"
     וגם את תיבת "רק מה שמסונן" בייצוא, ופקד שחסר בה מייצא את כל התיק
     בזמן שהמסך מסונן;
   - מאזין (`input` לשדה טקסט/מספר, `change` לבורר).
   טווח מ-/עד חדש עובר דרך `propRange()` ו-`inPropRange()`, ולא בבדיקה
   משלו: ערך ריק הוא "אין סינון", לא 0 (`Number('')` הוא 0), ו`Number(null)`
   הוא 0 - בלי הבדיקה המפורשת שם, נכס בלי מחיר או שטח עובר כל "עד".
   ופקד נוסף לרשת משנה את מספר השורות: בדקו שהשורה האחרונה מלאה בשני
   הרוחבים (‏`@container` ב-`.toolbar-grid`).

2. **אריח חדש בלי `tone`, אלא אם הוא באמת קריאה לפעולה.** הרשת לבנה עם
   אייקון כחול בכוונה; צבע שמור לשת"פ שעוד לא נפתח (`share`), יריד
   (`fair`/`fair-on`), קידום בתשלום (`gold`) וביטול (`red`, אייקון בלבד).
   הגוונים `teal`/`green`/`sand` ירדו מה-CSS - `tone` כזה פשוט לא יצבע.
   מחיר או "חינם" נאמרים ב-`badge`, לא בצבע.

3. **שורת התגיות היא שורה אחת, והסדר הוא העדיפות.** `clampCardTags(…, 1)`
   מסתיר את מה שלא נכנס מאחורי "+N", מהסוף. תגית שחייבת להיראות נכנסת
   לראש הרשימה (אחרי האזהרות); נתון שנקרא בסריקה של הרשימה הסגורה הולך
   לשורת הטאב ב-`buildPropertyTab` - כך הימים בשוק. אל תשכפלו נתון בין
   השניים. תגית שהיא כפתור: `button:true` ב-`tagsHtml` וחיבור לפי ה-`cls`
   אחרי ה-`innerHTML` (כמו `bindMatchedClients`).

4. **נתון חדש לכרטיס נטען פעם אחת ב-`loadProperties`, לא בכל כרטיס.**
   מפה לפי `property_id` (כמו `propertyExclusivities`,
   `propertyMatchedClients`), שתי קריאות ומעלה ב-`Promise.all`, ושגיאה
   משאירה את התגית בחוץ ולא מפילה את הרשימה. ואפסו את המפה גם בענף "אין
   נכסים", אחרת נשאר בה מה שהיה לפני מחיקת הנכס האחרון.
   - בלעדיות = שורה חיה ב-`property_exclusivities` **או** המאפיין
     `exclusive` (`propertyIsExclusive`) - דשבורד "הנכסים שלי" סופר את
     השני, והסינון חייב להסכים איתו.
   - לקוחות מתאימים = `client_match_alerts` (בלי `dismissed`, בלי לקוח/ה
     `closed`). **לא רטרואקטיבי** - ראו הסקיל `client-matching`; אל
     תכתבו "כל הלקוחות שמתאימים".

5. **פעולה למנהל/ת משרד בלבד נכנסת לתפריט "⋯ עוד", מוסתרת.**
   `style="display:none"` ב-HTML, וה-id ברשימה של
   `syncOfficeExportButtons()` ב-`assets/crm-office.js` - שם גם
   `propMoreMenu`, כדי שסוכן/ת לא יקבל/תקבל תפריט ריק. `hidden` לא יעבוד:
   אין בדף `[hidden]{display:none !important}`. מיקוד שחוזר מחלון שנפתח
   מהתפריט חוזר ל-`#propMoreMenu > summary`, כי הכפתור עצמו בתוך תפריט
   סגור.

6. **עריכה באזור הכרטיס יכולה "לחשוף" מקפים ארוכים ישנים.** הסורק של
   `check_long_dash.py` הוא מכונת מצבים, ובאוקטובר 2026 הוא היה מוסט
   באזור `buildPropertyCard` ב-`main` - 29 מחרוזות מוצגות סווגו כקוד.
   עריכה שמיישרת אותו מחזירה אותן כממצאים. זה **לא** באג שלכם: ודאו
   שההוספות שלכם אינן בהן, ותקנו עם `--fix` (רק טקסט מוצג מוחלף).
   ולהפך - ספירה של `code` שקפצה פתאום אחרי עריכה שלכם היא סימן
   שהזזתם אותו; עדיף תבנית (`` `${a}/${b}` ``) על `'/' +` ליד מחרוזות.

## פריסה: `@container`, לא `@media`

הכרטיס נקרא מ-`.prop-tab-panel` (‏`proptab`), סרגל הסינון מ-`#propToolbar`.
אותו רכיב מוצג ברוחב מלא ובתוך אקורדיון צר, ורוחב החלון לא יודע להבדיל.
בדקו כל שינוי בשני רוחבים - 390px ו-1400px - עם נתוני דמה: אפשר לטעון את
`crm.html` ב-Playwright, להגדיר `window.supabase` מזויף ב-`addInitScript`
(ה-CDN חסום ב-SRI), למלא `myPropertyRows` ולקרוא ל-`renderProperties()`.

**בטלפון בודקים גם עם גופן מוגדל** (‏`document.documentElement.style.fontSize='115%'`):
סוכנים רבים מגדילים את הגופן במכשיר, ושם נולדו "מילה בשורה" בכותרת, אריח
בודד בשורה ובאדג' שמכסה אייקון - שלושתם נראו תקינים בגופן רגיל.

## טופס הנכס: מסך מלא מתחת ל-1024px

`html.pf-sheet-open` הופך את `#addPropertyForm` לשכבה קבועה על כל החלון
(‏`pfSyncSheet()` ב-`crm.js`, ‏`MutationObserver` על ה-`style` של הטופס).
שני כללים:
- **פותחים וסוגרים רק דרך `addForm.style.display`**, כמו ארבעת המקומות
  הקיימים - המשקיף תופס כל אחד מהם. מחלקה או `hidden` במקום זה לא יפתחו את
  המסך המלא, והטופס ייפתח בתוך הרשימה מאחורי הכותרת.
- **שכבה חדשה שנפתחת מתוך הטופס צריכה `z-index` מעל 250** (חלונות הם 400,
  ה-toast עלה ל-260). ‏`pfFitBody` ו-`pfScrollToForm` חוזרות מיד במסך מלא:
  הגוף הוא `flex:1`, ואין דף לגלול.
