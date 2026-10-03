---
name: new-property-feature
description: הוספה או שינוי של מאפיין נכס בריפו של שוק נדל״ן (חניה, ממ״ד, עמדת טעינה...) - הקוד במערך properties.features, ושתים-עשרה הרשימות המקבילות שבהן הוא חייב להופיע - CRM, ייבוא, דף הבית ופאנל החיפוש, דף הנכס, המיניסייט, התיאור השיווקי, שני הבוטים, הסכמי התיווך, אשף הערכת השווי ופרויקטים. Use when adding a property feature/amenity checkbox, when a feature is saved but not shown somewhere (property page, showcase, Facebook post), when a feature can't be filtered on, when the bot can't set or search a feature, or when adding a row to the agreement property table that comes from a feature.
---

# מאפיין נכס חדש

מאפיין נכס הוא **קוד** (‏`ev_charger`, ‏`mamad`) במערך `properties.features`.
לעמודה אין `check` על הערכים, ולכן **אין מיגרציה** - וזה בדיוק מה שהופך
את המשימה למלכודת: אין מקור אמת אחד. הקוד מופיע בשתים-עשרה רשימות
מקבילות, ומי שנשכח מאחת מהן **נכשל בשקט**: המאפיין נשמר ולא מוצג, או
מוצג ולא ניתן לסינון, או שהבוט פשוט לא יודע שהוא קיים.

זה כבר קרה: `sun_balcony` היה בטופס, בדף הנכס ובתיאור השיווקי - ונעדר
מרשימות העוזרת לסוכנים (`agent.ts`), כך שהיא לא יכלה לסמן "מרפסת שמש"
ולא לסנן לפיה. התגלה רק כשנבנתה הרשימה שלמטה (אוקטובר 2026).

## הרשימה המלאה

| מקום | קובץ |
| --- | --- |
| טופס הנכס וטופס הלקוח ב-CRM | `assets/crm.js` - `RESIDENTIAL_/COMMERCIAL_PROPERTY_FEATURES`, ואייקון ב-`FEATURE_ICONS` |
| ייבוא מקובץ | `assets/crm.js` - `IMP_FEATURE_SYNONYMS` (כתיבים נפוצים שאינם התווית) |
| סינון מתקדם בדף הבית | `assets/home.js` - **עותק** של אותן שתי רשימות |
| פאנל "מה אתם מחפשים" | `index.html` - `.hs-check` (רק למאפיין שמחפשים לפיו הרבה; ראו הסקיל `home-page`) |
| דף הנכס | `assets/property.js` - `FEATURE_LABELS` ו-`FEATURE_ICONS` (שם אייקון מתוך `ICONS`; בלי - וי) |
| המיניסייט ללקוח/ה | `assets/showcase.js` - `FEATURE_LABELS` |
| התיאור השיווקי והפוסט | `supabase/functions/_shared/marketing-copy.ts` - `FEATURE_LABELS` |
| העוזרת לסוכנים | `supabase/functions/whatsapp-webhook/agent.ts` - `RESIDENTIAL_/COMMERCIAL_FEATURES` |
| הבוט הציבורי | `supabase/functions/whatsapp-webhook/public-agent.ts` - תיאור `features` בכלי החיפוש |
| הסכמי תיווך | `assets/agreement-templates.js` **ו**-`supabase/functions/_shared/agreement-templates.js` (זהים, `check_agreement_assets.py`), ‏`AGR_FIELD_CHOICES` ו-`AGR_FEATURE_FROM_FIELD` ב-`crm.js` |
| אשף הערכת השווי | `.wiz-checks` ב-`index.html`, ‏`agency.html`, ‏`agent.html` (טקסט חופשי, עד 30 תווים) |
| פרויקטים חדשים | `_shared/projects.ts` - `PROJECT_FEATURES`, ו-`assets/project-card.js` - `FEATURES` |

לפני שמסיימים, חיפוש אחד מוכיח שהקוד בכל המקומות:

```sh
grep -rln "sun_balcony" assets supabase/functions index.html   # מאפיין קיים כקנה מידה
grep -rln "<הקוד החדש>" assets supabase/functions index.html
```

## שלוש החלטות שאינן מכניות

1. **מגורים, מסחרי או שניהם.** הרשימות נפרדות בכל מקום שיש בו שתיים.
2. **שדה בהסכם.** טבלת תיאור הנכס בהסכם היא ארבע עמודות; מספר אי-זוגי
   של שדות משאיר תא ריק (‏`td.pad`), והמונה "מולאו X מתוך N" ב-
   `docs/client-agreements.md` מתעדכן. הסכמים קיימים קפואים ואינם משתנים.
3. **דוח ה-CMA** (‏`cma_price_features()`) - בכוונה **לא** אוטומטי. מאפיין
   נדיר מוריד את דמיון ה-Jaccard של כל נכס שיש לו, ומאפיין שלכולם יש
   (‏`ac`) אינו מבדיל. נכנס רק במיגרציה, עם נימוק.

## מה *לא* צריך לגעת בו

- **המסד** - ההתאמה ללקוחות (`required_features`), החיפושים השמורים וחיפוש
  הבוט עובדים על הקודים כמו שהם.
- **טביעת האצבע של התיאור השיווקי** - `features` כבר בתוכה, ולכן סימון
  המאפיין בנכס מסמן אותו כ"כדאי לרענן" כמו שצריך (הסקיל `marketing-description`).
- **המיניסייט** - מאפיין רגיל נשלח לכל הנכסים; רק מאפיין שעלול לחשוף את
  המשרד (כמו `exclusive`) אסור שם (הסקיל `client-showcase`).

## לפני הדחיפה

```sh
python scripts/check_long_dash.py          # התווית היא טקסט שמוצג
python scripts/check_agreement_assets.py   # שני עותקי הנוסח זהים
for f in assets/crm.js assets/home.js assets/property.js assets/showcase.js; do node --check $f; done
```

הדוגמה המלאה: `docs/ev-charger.md`.
