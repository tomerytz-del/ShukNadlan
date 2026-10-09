---
name: settlement-deals
description: עבודה על העסקאות לפי יישוב בריפו של שוק נדל״ן - רשימת היישובים deal_settlements (כל עיר בשוק, אוטומטית) ומסך "יישובים לעסקאות" ב-CRM, סוכן הדפדפן (Claude in Chrome) שמושך מ-GovMap בפקודה "עדכן עסקאות" ומחליף את ההדבקה הידנית, מחזור העדכון (sync_every_days, deal_sync_plan במנות, הממצאים deal_sync_stopped / deal_sync_overdue), upsert_deals / deal_sync_fail, ודפי /deals ו-/deals/{slug} (deals.html, deals-page.ts, deals-render.js). Use when running or changing "עדכן עסקאות", when the agent's sync adds duplicates or nothing at all, when the ops dashboard shows deal_sync_stopped or deal_sync_overdue, when a city in a market has no deals or never gets updated, when changing the update cycle, when adding or renaming a settlement or its slug, when touching upsert_deals or market_deals_official keys, when a /deals page shows no numbers, wrong canonical or a house number, when changing what the deals page shows, or when asked to build a deals scraper or call the GovMap API (don't - see the skill).
---

# עסקאות לפי יישוב

התיעוד המלא: `docs/settlement-deals.md`. ההקשר של המאגר: `docs/market-deals-official.md`.

## ארבעה כללים שאסור לשבור

### 1. אין scraper ואין API של GovMap

‏GovMap דורש reCAPTCHA ו-nadlan.gov.il חוסם שליפה תוכניתית. את המשיכה
עושה סוכן דפדפן אצל מנהל/ת הפלטפורמה. בקשה "לבנות scraper" או "לקרוא
ל-API של GovMap" עונים בהפניה לזה, לא בקוד.

### 2. טבלה אחת: `market_deals_official`

לא טבלת עסקאות נוספת. ממנה קוראים דוח ה-CMA (‏`agent_cma_report`),
‏`/prices` (‏`city_price_table`) ו-`/deals`. טבלה שנייה מפצלת את המאגר,
והעסקאות שהסוכן מושך לא מגיעות לדוח שנמכר.

### 3. ‏`external_key` זהה בשלושת המקומות

```
govmap:<גוש>-<חלקה>-<תת>:<YYYY-MM-DD>:<מחיר>:<מ"ר>
```

| איפה | מי |
| --- | --- |
| `dealsExternalKey` ב-`assets/crm.js` | ההדבקה הידנית |
| `upsert_deals()` (‏`20270330090000`) | סוכן הדפדפן |
| `deals_engine/` | הסקרייפר המנותק |

‏`trim_scale` על מחיר ומ"ר: ‏`134.0` מ-JSON חייב לתת `134`, כמו בהדבקה.
מפתח שונה לאותה עסקה הוא כפילות שקטה - הספירה עולה, הדוח מוטה, ואין
שגיאה. **שינוי בפורמט = שינוי בשלושתם באותו PR**, ובדיקה ששורה מוכרת
מהמאגר נופלת על המפתח הקיים (‏`updated`/`unchanged`, לא `added`).

מחיר ומ"ר הם חלק מהמפתח ולכן **אינם מתעדכנים**: שתי עסקאות באותה
תת-חלקה ובאותו יום נבדלות רק בהם.

### 4. הדף הציבורי בלי מספר בית, גוש וחלקה

‏`market_deals_official` סגורה ל-anon. הדף מקבל נתונים רק מ-
`deal_settlement_page()` (‏SECURITY DEFINER), שמחזירה רחוב ושכונה. שדה
חדש בדף נוסף **בפונקציה**, ולעולם לא כ-policy על הטבלה.

## ההרשאות

‏`upsert_deals`, ‏`deal_sync_plan`, ‏`deal_sync_fail` ו-`deal_settlements_admin`
פתוחות ל-`authenticated` עם `current_is_platform_admin()` בפנים (או
`auth.role() = 'service_role'`). **לא** להעביר את הסוכן ל-service_role:
המפתח היה יושב בדפדפן ועוקף כל RLS באתר. ‏`deal_settlement_page` ו-
`deal_settlements_public` פתוחות ל-anon ורשומות ב-`PUBLIC_RPC` ב-
`ops_agent/config.py`.

## המחזור (מיגרציה `20270330090000`)

- **כל עיר פעילה בשוק ברשימה, אוטומטית** - ‏`deal_settlements_sync_cities()`
  מטריגר על `cities`. לא מוסיפים יישוב בשוק ביד; יישוב מחוץ לשוק - כן, במסך.
- **‏`deal_sync_plan(p_limit = 25)` מחזירה רק מי שהגיע תורו** (‏`last_synced_at`
  ישן מ-`sync_every_days`, ברירת מחדל 30), ו-`due_total`. הסדר: לא נוסה מעולם,
  ואז `last_attempt_at` הכי ישן, ובתוך זה אוכלוסייה. כישלון מוריד לסוף התור.
- **יישוב בלי עסקאות ב-GovMap נרשם ב-`upsert_deals(name, [])`.** בלי זה הוא
  נשאר "ממתין" לנצח וחוזר בראש כל מנה.
- **האכיפה היא ממצא, לא workflow** - הסוכן בדפדפן ואין לו תזמון בשרת.
  ‏`_deal_sync_cycle` (‏`ops_agent/probes/behavior.py`, ‏`scripts/ops_deal_sync_test.py`):
  ‏`deal_sync_stopped` כשאף יישוב לא עודכן 14 יום, `deal_sync_overdue` כשיישובים
  חורגים ב-14 יום. שני הקודים תחת `deal_sync_` ב-`PROBE_CODES` (‏`store.py`).
- **דף דל לא לגוגל:** ‏`deal_settlements_public()` רק עם עסקאות (אינדקס ו-sitemap),
  ופחות מ-5 עסקאות - `noindex` מ-`deals-page.ts`.

**ההדבקה הידנית היא גיבוי בלבד** (מקופלת ב"מצב העסקאות"). הודעה, ממצא או טקסט
חדש שאומר "להדביק שוב" - מפנה ל"עדכן עסקאות".

## "עדכן עסקאות" - מה הסוכן עושה

ההוראות המלאות, מוכנות להדבקה אצל הסוכן: `docs/settlement-deals.md`, "הסוכן".
המשפט "עדכן עסקאות" לבדו אינו אומר לו דבר. בקצרה:

1. לשונית `https://shuknadlan.co.il/crm`, מחובר/ת כמנהל/ת. ‏`sb` גלובלי.
2. ‏`await sb.rpc('deal_sync_plan', { p_limit: 25 })` → ‏`[{name, sync_from, last_synced_at, due_total}]`.
3. לכל יישוב: GovMap → חיפוש היישוב → "עסקאות נדל״ן", מהחדשה עד `sync_from`.
4. ‏`await sb.rpc('upsert_deals', { p_settlement: name, p_rows })`, עד 500 שורות במנה.
   שדות: `address, neighborhood, gush, helka, tat_helka` (או `gush_helka`),
   `deal_date, property_type, rooms, floor, area_sqm, price` - כמו שהם
   בטבלה של GovMap. הנרמול במסד.
5. אין עסקאות: `p_rows: []`. כשל: `await sb.rpc('deal_sync_fail', { p_settlement: name, p_error })`, וממשיכים.
6. ‏`due_total` גדול ממה שעבר - מנה נוספת.
7. סיכום לכל יישוב: `added` / `updated` / `rejected_count`.

הרצה שנייה על אותו טווח חייבת להחזיר `added: 0`. אם לא - כלל 3.

**התקרה:** ‏GovMap מחזיר 1,500 עסקאות אחרונות ליישוב.

## יישוב חדש

עיר בשוק - נכנסת לבד. יישוב מחוץ לשווקים - במסך "יישובים לעסקאות" ב-CRM. ‏`name` הוא **השם ב-GovMap**, והוא נכתב ל-
`market_deals_official.city`. ‏`slug` נגזר בתעתיק (‏`dealSlugify` ב-JS ו-
`deal_slugify` במסד - **זהים**, ומי שמשנה אחד משנה את שניהם), אבל עדיף
ה-slug מ-`cities` כשיש. ‏`/prices` מצטרף ל-`cities` לפי שם מדויק, ולכן
"נהרייה" מול "נהריה" מופיעה ב-`/deals` ולא ב-`/prices`.

## הדפים

| חלק | קובץ |
| --- | --- |
| דף אחד לאינדקס ולכל היישובים | `deals.html` (+ `/deals/* /deals 200` ב-`_redirects`) |
| הבנייה - אותו קוד בשרת ובדפדפן | `assets/deals-render.js` |
| השרת | `netlify/edge-functions/deals-page.ts` |
| מילוי בדפדפן ומיון | `assets/deals.js` |
| הבדיקה | `scripts/deals_page_test.ts` (ב-`canonical.yml`) |

שתי מלכודות:

- **‏canonical של יישוב נקבע מהכתובת, לפני המסד.** ב-`deals.html` יש
  canonical סטטי `/deals`; אם ההחלפה תעבור לתלות בתשובת המסד, דקה של
  Supabase איטי מאחדת את כל היישובים לאינדקס. ‏`noindex` רק כשהמסד ענה
  `null`. הבדיקה מכסה את שלושת המצבים.
- **‏`<base href="/">` אחרי GTM.** הדף מוגש גם תחת `/deals/afula`, ושם
  `assets/x.js` יחסי נפתר ל-`/deals/assets/x.js` - הדף נטען בלי עיצוב
  ובלי JS, ובלי שגיאה ברורה. כתובת חדשה בדף - יחסית, כמו בשאר האתר.

**אין build.** הדף מתמלא בכל בקשה ונשמר במטמון שעה; "טריגר build אחרי
עדכון" אינו נדרש.

## לפני הדחיפה

```sh
node --experimental-strip-types scripts/deals_page_test.ts
python3 scripts/check_canonical.py
python3 scripts/check_function_grants.py
python3 scripts/check_migration_versions.py --base-ref origin/main
```

ושינוי ב-`upsert_deals` נבדק על Postgres מקומי (‏`/usr/lib/postgresql/16/bin`)
עם תחליפים ל-`auth.role()` ול-`current_is_platform_admin()` - לא על
הפרודקשן. ‏DDL רק דרך הצינור (הסקיל `new-migration`).
