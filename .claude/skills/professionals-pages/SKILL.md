---
name: professionals-pages
description: עבודה על דפי בעלי המקצוע בשוק נדל״ן - professionals.html (הרשימה, אריחי התחומים, הכרטיסייה בשלושה מצבים, כרטיס "התחום פנוי") ו-professional.html (הפרופיל, שורת העובדות, הפסיפס, "עוד בעלי מקצוע", הסרגל הקבוע בטלפון), ו-?type= ב-professional-signup.html. Use when adding a professional field (advertiser_type), changing TYPE_LABELS / TYPE_PLURAL / TYPE_FIELD / PATHS / TILE_TYPES, adding a field to the card or the profile, when a style on these pages "doesn't apply" or a blue button's text disappears on hover, when a fact appears that is not in the database, or when a contact link on these pages is counted as contact_agent.
---

# דפי בעלי המקצוע

המסמך המלא: `docs/professional-cards.md` ("דף הרשימה", "עמוד הפרופיל").
המקור לשני הדפים הוא `professional_cards_public` בלבד.

## תחום חדש: כל הרשימות, בשני הדפים

אין קובץ משותף לשני הדפים, ולכן כל רשימה כאן **משוכפלת**. תחום שנשכח
באחת מהן לא שובר כלום - הוא פשוט מוצג כ"בעל מקצוע", בלי אייקון, או לא
מופיע כאריח.

| מה | `professionals.html` | `professional.html` |
| --- | --- | --- |
| יחיד, בלי לוכסן ("שמאי מקרקעין") | `TYPE_LABELS` | `TYPE_LABELS` |
| רבים ("אדריכלים") - אריחים, כותרות, פירורי לחם | `TYPE_PLURAL` | `TYPE_PLURAL` |
| שם התחום - כרטיס "התחום פנוי" | `TYPE_FIELD` (קצר: "שמאות") | `TYPE_FIELD` (ארוך: "שמאות מקרקעין") |
| האייקון | `PATHS` | `PATHS` |
| הסדר | `TYPE_ORDER` (ומתוכו `TILE_TYPES`) | `TILE_TYPES` |

**ועותק שלישי של `TYPE_LABELS` יושב ב-`netlify/edge-functions/og-tags.ts`**
(‏`professionalMeta`), שבונה בשרת את הכותרת, ה-JSON-LD ואת תוכן הפרופיל
לסורק.

ובנוסף, מחוץ לשני הדפים: ה-check במסד, `VALID_TYPES` בשתי פונקציות הקצה,
וה-`<option>` ב-`professional-signup.html` - שהוא גם מה ש-`?type=` נבדק מולו
(‏`docs/professional-cards.md`, ראש המסמך). ‏`general` ("אחר") **אינו אריח**.

## הכללים

1. **הסגנון יושב אחרי `design-system.css`.** הגיליון נטען אחרי ה-`<style>`
   הראשון של הדף, ומחזיר כותרות ל-Heebo, צובע `a:hover` בספיר, ומעגל
   ב-`!important` כל מחלקה שמכילה `-card`, `-btn`, `-chip` או `-badge`.
   לכן: סגנון חדש נכנס ל-`<style>` שאחריו, שם המחלקה נמנע מהתבניות, ו**כל
   קישור צבעוני מגדיר גם `:hover`** - אחרת כפתור כחול עם טקסט לבן נעלם בריחוף.
2. **לא ממציאים טקסט.** אין `headline` - מקומו ריק (לא `description`). שורת
   העובדות רק מ-`years_experience`, `service_areas`, `license_number`: עובדה
   שכתובה בתיאור ("ביטוח צד ג׳") היא שדה חדש במסד, לא ניתוח טקסט בקוד.
   התיאור מוצג כמו שנכתב; תיקון עובר דרך `professional-manage`.
3. **כל `wa.me` / `tel:` / `mailto:` של בעל מקצוע נושא `data-professional`**,
   כולל בסרגל הקבוע ובכרטיס הצדדי. כפתור השיתוף הוא `<button data-share>`
   שנספר ידנית ב-`shukTrack('share')`, כי `events.js` סופר רק קישורים.
4. **בלי לוכסן ובלי מקף ארוך בטקסט גלוי.** "בעלי מקצוע", "מי שמצטרף".
5. **"התחום פנוי" נבנה מהנתונים**: התחומים הריקים בפועל, לא רשימה קבועה.
6. **שאילתת supabase-js יוצאת רק ב-`then`.** "עוד בעלי מקצוע" עטופה
   ב-`Promise.resolve(...)` כדי לצאת במקביל לפרופיל, וכשל בה לא נוגע בפרופיל.

## הפרופיל מתמלא גם בשרת

‏`og-tags.ts` ממלא לפי id את `profileName` (שם העסק, או שם האדם),
‏`profilePerson`, ‏`profileHeadline` ו-`profileDescription`, ומסיר `hidden`
מ-`profileSub` ומ-`aboutBlock`. **שינוי במבנה או ב-id האלה ב-`professional.html`
מחייב את אותו שינוי ב-`professionalMeta` וב-`scripts/og_tags_test.ts`** -
אחרת הסורק רואה עמוד אחר מהגולש, וה-CI נכשל על המקרה "בעל/ת מקצוע".
המילוי הוא regex על `<tag id="…">טקסט</tag>`: האלמנט חייב להיות ריק או
טקסט בלבד, בלי תגיות בתוכו.

## לפני דחיפה

```sh
python scripts/check_long_dash.py
python scripts/check_events.py
python scripts/check_escapers.py
python scripts/check_canonical.py
node --experimental-strip-types scripts/og_tags_test.ts
grep -nE "/ת|/ה|/ית" professionals.html professional.html   # רק הערות ובאנר הפוטר המשותף
```

ובדפדפן, ב-1440 וב-390: אין גלילה אופקית, כרטיסייה בלי תמונה, בלי
`headline` ובלי שירותים נראית שלמה, ו-`?type=appraiser` פותח את האריח הנכון.
אין גישה ל-CDN בסשן ענן - מדמים את `window.supabase` ב-`addInitScript`
של Playwright וחוסמים את הבקשות החיצוניות.
