---
name: whatsapp-bots
description: עבודה על שני הבוטים בוואטסאפ של שוק נדל״ן (גבריאלה) - העוזרת של הסוכנים (agent.ts) והבוט הציבורי (public-agent.ts): הפרסונה והשם בכל המקומות, ההיכרות בהודעה הראשונה, הודעות עם כפתורים (offer_save_search), כרטיס איש הקשר, מטמון הפרומפט, והכפתור באתר (bot-link.js ENABLED, וכרטיס גבריאלה בדף הבית). Use when changing what the bots say or how they introduce themselves, renaming the assistant, adding a WhatsApp interactive/button/contact message, adding a tool to public-agent.ts or agent.ts, when a button message is rejected by Meta, when cache_read_input_tokens drops to 0, when turning the site's "ask Gabriela" button on or off, when changing an opening (hello) message on the site or the "Gabriela inquiries from the site" panel shows zero, or when touching the open-house fair offer / the agent-help question after saving a search.
---

# הבוטים בוואטסאפ - גבריאלה

המסמכים המלאים: `docs/whatsapp-public-bot.md` (הציבורי) ו-`docs/whatsapp-setup.md`
(של הסוכנים). כאן רק מה שנשבר בשקט.

| קובץ | מה |
| --- | --- |
| `supabase/functions/whatsapp-webhook/index.ts` | הניתוב בין שני הענפים, יומן ההודעות, ההיכרות, כרטיס איש הקשר |
| `supabase/functions/whatsapp-webhook/agent.ts` | העוזרת של הסוכנים: `SYSTEM_STATIC`, `sessionContext`, הכלים |
| `supabase/functions/whatsapp-webhook/public-agent.ts` | הבוט הציבורי: הכלים, ההוראות ולולאת השיחה |
| `supabase/functions/whatsapp-webhook/whatsapp.ts` | כל מה שיוצא ל-Meta: טקסט, תמונה, כפתורים, איש קשר, תבנית |
| `assets/bot-link.js` | המספר, הקישור והמתג `ENABLED` של הכפתורים באתר |

## השם חי בהרבה מקומות, ומשתנה בכולם יחד

שני הבוטים הם **גבריאלה**, בלשון נקבה. שינוי שם או מגדר עובר בכל אלה, באותו PR:

| מקום | מה |
| --- | --- |
| `SYSTEM_STATIC` ב-`agent.ts` וב-`public-agent.ts` | הזהות, ושורת "את מדברת על עצמך בלשון נקבה" |
| `sessionContext` בשני הקבצים | נוסח ההיכרות בהודעה הראשונה |
| מחרוזות קבועות ב-`index.ts`, `agent.ts`, `public-agent.ts` | "אני יודעת...", "מצטערת..." - **בלי** מודל, ולכן הפרומפט לא מתקן אותן |
| `CONTACT_CARD_NOTE`, `sendContactCard(...name)` ב-`index.ts` | כרטיס איש הקשר |
| `assistantIntroduced()` ב-`index.ts` | מחפשת את **השם** ביומן (`ilike '%גבריאלה%'`) |
| `crm.html`, `assets/crm.js` | הקטגוריה, הניווט (`label` ב-nav), כרטיס הצ'אט, המדריך |
| `pricing.html`, `assets/tiers.js` | שורות המסלולים |
| `scripts/check_tier_gates.py` | **המפתחות הם טקסט השורה ב-`pricing.html`** - שורה ששונתה בלי המפתח מפילה את הבדיקה |
| `privacy.html` | כל האזכורים |
| `LABEL` ב-`renderEmptyBotLink` (`assets/home.js`) | הכפתור במסך אפס התוצאות |
| `#gabrielaHero` ו-`#gabHowDialog` ב-`index.html` | כרטיס גבריאלה ב-hero של דף הבית: השם, התפקיד, בועות הדוגמה, "איך זה עובד?", ו-`alt` של הדמות |
| `SCENES` ב-`initGabChat` (‏`assets/home.js`) | שיחת הדוגמה המתחלפת בכרטיס. **כל תרחיש חייב כלי אמיתי ב-`public-agent.ts`** - כלי שהוסר מהבוט מוריד גם את התרחיש שלו |
| `GAB_HELLO` ו-`renderGabrielaCta` / `gabrielaMiniLink` ב-`assets/home.js` | הודעת הפתיחה, הכפתור, שורת התפריט הנייד ("גבריאלה תחפש בשבילכם") והשורה שבסוף הרשימה ליד המפה |
| `assets/gabriela-*.webp` | הדמות והאווטאר. **לא חותכים, לא צובעים ולא מחליפים** - שם חדש לעוזרת הוא גם החלטה על התמונה |

**שינוי שם הוא גם מה שמאפס את ההיכרות** אצל הסוכנים: `assistantIntroduced`
מחפשת את השם החדש, ולכן כל סוכן/ת יקבל/תקבל אותה שוב פעם אחת. זה הרצוי.

הערות קוד אינן חלק מהרשימה. הן תיעוד, לא טקסט שמוצג.

## ההיכרות בהודעה הראשונה

* **ציבורי:** `conv.history` ריקה = שיחה חדשה (גם אחרי 12 שעות שקט,
  `PUBLIC_IDLE_RESET_HOURS`).
* **סוכנים: ההיסטוריה לעולם אינה מתאפסת**, ולכן "היסטוריה ריקה" הייתה מציגה
  אותה רק לסוכנים חדשים. `index.ts` בודק ביומן אם השם כבר נאמר, ומעביר
  `conv.introduce` (שדה של התור בלבד, לא נשמר).

## מטמון הפרומפט

`SYSTEM_STATIC` נשמר במטמון. **אסור להכניס אליו דבר שמשתנה בין קריאות** -
לא שם הסוכן/ת, לא תאריך, לא "זו ההודעה הראשונה". שורה כזו לא שוברת כלום;
היא רק מאפסת את המטמון בשקט, ו-`cache_read_input_tokens` בלוג חוזר 0. כל
מה שמשתנה הולך ל-`sessionContext`, שיושב אחרי נקודת השבירה.

## הודעה עם כפתורים

`sendButtons` ב-`whatsapp.ts` (`interactive · button`). המגבלות של Meta
**דוחות את ההודעה כולה**, בלי הודעה חלקית:

* עד **3** כפתורים.
* כותרת עד **20 תווים**. "🏘️ תראי לי גם נכסים דומים" (25) קוצר ל-"🏘️ תראי
  נכסים דומים". שתי הכותרות הנוכחיות הן 19 תווים ו-**20 יחידות UTF-16**
  (‏🏘️ הוא שלוש) - על הקצה בכל ספירה, ואין להוסיף להן אפילו רווח. מודדים
  לפני שמשנים: `node -e 'const t="..."; console.log(Array.from(t).length, t.length)'`.
  הקוד חותך ב-`Array.from` ולא ב-`slice`, כי חיתוך באמצע אימוג'י משאיר תו
  שבור.
* גוף עד 1024 תווים.

**הכפתור השלישי, "🏠 צרפי אותי ליריד"** (`FAIR_TITLE`, 17 תווים ו-18
יחידות UTF-16), נוסף רק בחיפוש לקנייה (`for_purchase`) ורק פעם אחת בשיחה
(`fairOffered` בודק בהיסטוריה). עם שלושה כפתורים ההודעה בתקרה של Meta - מי
שמוסיף/ה כפתור רביעי שובר/ת את ההודעה כולה. הכפתור והשורה שמסבירה אותו
(`FAIR_LINE`) נוספים בקוד יחד, ו-`open_house_signup` מבקש מייל כי עדכוני
היריד יוצאים במייל בלבד. ‏`docs/whatsapp-public-bot.md`, "יריד הדירות".

**אחרי שמירת חיפוש - עוד הודעת כפתורים**: `offer_agent_help` (‏"🤝 כן, אשמח
לעזרה" / "🔔 רק עדכונים, תודה"). השמירה עצמה תמיד בלי הסכמה, ו"כן" מדליק
אותה על אותה שורה (`request_agent_help` → `grant_consent`) לפי
`last_saved_search_id` שבמצב השיחה. כרטיס איש הקשר יוצא בתור של התשובה,
לא בתור של השמירה. ‏`docs/whatsapp-public-bot.md`, "השאלה על מתווך/ת".

**הכותרת היא מה שחוזר לבוט.** `index.ts` מעביר את `button_reply.title` כאילו
נכתב ביד. לכן הכותרת צריכה להיות מובנת למודל גם בלי המסך, וההוראות צריכות
להכיר אותה (`SAVE_TITLE` = הבקשה המפורשת של `save_search_alert`,
`SIMILAR_TITLE` = להציג את `close_matches`).

**כפתור שמבטיח משהו נשלח רק כשיש מאחוריו משהו.** "תראי נכסים דומים" יוצא
רק כש-`has_similar` (חזרו `close_matches`), וההחלטה ב-`offerSaveSearch` ולא
בניסוח של המודל.

**שם הפרופיל בוואטסאפ** מגיע ב-`change.value.contacts[].profile.name`, לא
בהודעה. ‏`index.ts` מצמיד אותו כ-`msg._profile_name`, והוא משמש **רק** את
`save_search_alert` - אינו נכנס לפרומפט (‏`sessionContext` אומר רק אם יש
שם). שימוש נוסף בו הוא נתון אישי חדש, ועובר דרך `privacy.html`.

**הודעת כפתורים סוגרת את התור.** `offer_save_search` מסמן `ctx.offerSent`.
`runPublicTurn` עוצר את הלולאה ומחזיר `text: ""`, ו-`index.ts` לא שולח
דבר. טקסט אחרי הכפתורים היה דוחף אותם למעלה עם שאלה כפולה. בהיסטוריה נרשם
גוף ההודעה עם הכותרות, כדי שהלחיצה בתור הבא תדע על מה היא עונה. כשל
בשליחה מחזיר `sent: false`, והמודל שואל בטקסט.

## המיניסייט מהשיחה: `create_showcase` ו-`showcase_status`

אחרי `client_matches` גבריאלה **מציעה** מיניסייט (לא פותחת בלי "כן"). ‏`create_showcase`
מחזיר `wa_client_url` - קישור לצ'אט של הלקוח/ה עם הודעה מוכנה - **והבוט אינו שולח
ללקוח/ה**. מי שמשנה את ההוראות ב-`SYSTEM_STATIC` שומר על שני אלה: ההצעה אחרי ההתאמות,
והאיסור לומר "שלחתי". פרטי המתווך/ת המקורי/ת ב-`showcase_status` הם לסוכן/ת בלבד.
הפרטים: הסקיל `client-showcase` ו-`docs/client-showcase.md`.

## עסקאות: שכונה אינה רחוב (`market_deals_lookup`)

"עסקאות בגבעת המורה" עובר בשדה `neighborhood`, לא ב-`street`. רחוב שאינו במאגר
ושהוא שם של שכונה מתפרש כשכונה (`neighborhood_from_street`), כרשת ביטחון בלבד.
עסקה נכללת לפי שם השכונה ברשות המיסים, ובלעדיו לפי פין במצולע אחד
(`matched_by`: ‏`name` / `location`). מי שמשנה את ההנחיה ב-`toolMarketDealsLookup`
או את השורה ב-`SYSTEM_STATIC` שומר על שלושה: לא להציג מרחקים במצב שכונה, להציע
מתוך `known_neighborhoods` כשהשם לא נמצא, ולא לנחש שכונה. תוצאה ריקה בשכונה
קיימת היא כמעט תמיד נתונים (מצולע או כינוי חסרים), לא קוד - השאילתות בסקיל
`new-market`, והרקע ב-`docs/market-deals-official.md`.

## המספר שולח גם עדכוני מיניסייט - והתשובות מגיעות לגבריאלה

`client-showcase` (‏`action = wa_notify`) שולח מאותו מספר ללקוחות של סוכנים:
"הסוכן/ת ענה/תה לך", "הסיור אושר" (תבנית `WHATSAPP_SHOWCASE_TEMPLATE`). לקוח/ה
שעונה על ההודעה עצמה מגיע/ה **לבוט הציבורי**, לא לסוכן/ת - ולכן הנוסח מפנה
לכפתור. מי שמשנה את ניתוב ההודעות הנכנסות ב-`index.ts`, או מלמד את הבוט
הציבורי לזהות לקוחות של מיניסייט, צריך לזכור את הזרם הזה. הפרטים: הסקיל
`client-showcase` ו-`docs/client-showcase.md`.

## כרטיס איש הקשר

* **פעם אחת למספר**, לפי היומן (`msg_type = 'contacts'` לאותו `wa_phone`),
  לא עמודה חדשה. גם כשל נרשם (עם `error`), כדי שההזמנה לא תחזור בכל חיפוש.
* **לא באותו תור שבו נשלחו כפתורים.** ‏`shareContact` מ-`runPublicTurn`
  מחליט מתי - בעיקר אחרי שמירת חיפוש. מי שמוסיף/ה כפתורים לתור נוסף בודק/ת
  שהכרטיס עדיין מגיע לאנשהו: כשכל חיפוש עבר לכפתורים, התנאי הקודם ("אחרי
  חיפוש, כשאין כפתורים") הפסיק להתקיים לגמרי, בשקט.
* המספר: `WHATSAPP_DISPLAY_NUMBER`, ואחרת `972532494740` - אותו מספר כמו
  `NUMBER` ב-`bot-link.js` ו-`ASSISTANT_WA_NUMBER` ב-`crm.js`. החלפת מספר
  ב-Meta מעדכנת את שלושתם.

## כל הודעה יוצאת נרשמת ביומן

הודעה שנשלחת ישר מכלי (כרטיס נכס, כפתורים, איש קשר) **לא** עוברת דרך
`reply()`, ולכן הכלי רושם אותה בעצמו ב-`whatsapp_messages` עם `msg_type`
משלה (`image`, `interactive`, `contacts`). בלי הרישום אין מעקב מסירה, וגם
הבדיקות "כבר נשלח?" שנשענות על היומן מפסיקות לעבוד.

וכל טקסט עובר `formatForWhatsapp`: בלי מקף ארוך, והדגשה בכוכבית אחת.

## הכפתור באתר (`ENABLED` ב-`bot-link.js`)

שני מתגים ששומרים על שני דברים שונים: הסוד `WHATSAPP_PUBLIC_BOT` בשרת קובע
אם הבוט **עונה**, והדגל באתר קובע אם האתר **שולח אליו אנשים**.

* **הדלקה:** פריסה → `WHATSAPP_PUBLIC_BOT=on` → בדיקה → `ENABLED = true`.
  הסוד אינו נראה מהריפו. בודקים אותו ביומן: שיחות חדשות ב-
  `whatsapp_public_conversations`, ואין תשובות "איני מזהה" לפונה שאינו
  סוכן/ת (`agent_id is null`). נדלק ב-3.10.2026.
* **כיבוי הפוך באותו יום.** הסוד כבוי והדגל דלוק = הכפתור שולח גולשים
  ל"סליחה, איני מזהה את מספר הטלפון שלך".
* קישור לבוט נושא `data-bot`, אחרת `events.js` סופר אותו כ-`contact_agent`
  (`scripts/check_events.py` חוסם).
* **הכניסה הראשית היא כרטיס גבריאלה בדף הבית** (אוקטובר 2026), בארבעה
  מקומות שכולם עוברים ב-`renderGabrielaCta()`: ה-hero, החלון "איך זה עובד?",
  התפריט הנייד, והרשימה שליד המפה הפתוחה (`data-bot-entry`: `homepage_hero`,
  `homepage_how`, `menu`, `map_list`). **כשהדגל כבוי אין שם אף קישור `wa.me`**:
  אותו כפתור פותח את הסוכן החכם עם `source=homepage_gabriela`, והנוסח משתנה.
  מי שמוסיף/ה נקודת כניסה עוברת דרך אותה פונקציה, ולא בונה `wa.me` בעצמו/ה -
  אחרת כיבוי הדגל משאיר כפתור שמוביל ל"איני מזהה".
  ‏`docs/whatsapp-public-bot.md`, "נקודות כניסה מהאתר".

## הודעת הפתיחה מהאתר היא גם המדידה

הפאנל "פניות לגבריאלה מהאתר" ב-`crm` סופר פניות לפי `whatsapp_messages.public_entry`,
שנחתם בקליטה על ההודעה שפותחת שיחה ציבורית (`siteEntryOf()` ב-`index.ts`). ‏wa.me
אינו מעביר דבר מלבד הטקסט, ולכן **הסיווג הוא ביטוי בהודעת הפתיחה** ("מדף הבית",
"חיפשתי באתר", "הגעתי מהאתר" - `SITE_ENTRY_PHRASES`).

* מנסחים מחדש את `GAB_HELLO`, את ההודעות של `renderEmptyBotLink` או את
  `FALLBACK_HELLO`? הביטוי נשאר, או שהרשימה מתעדכנת. אחרת הכפתור עובד וכל
  הפניות ממנו עוברות בשקט ל-`direct`. ‏`scripts/check_bot_entry.py` חוסם.
* נקודת כניסה חדשה עוברת ב-`ShukBot.link` / `anchorHtml` עם הודעה שמכילה ביטוי.
  משתנה חדש שמחזיק הודעה נכנס ל-`KNOWN_HELLO_VARS` בבדיקה.
* "פנייה" = הודעה עם היסטוריה ריקה (ראשונה, או אחרי 12 שעות שקט). שינוי
  `PUBLIC_IDLE_RESET_HOURS` משנה גם את מה שהפאנל סופר.

‏`docs/whatsapp-public-bot.md`, "כמה פניות מגיעות מהאתר".

## לפני הדחיפה

```sh
python scripts/check_edge_types.py   # טיפוסים מול הרף; CI חוסם שגיאה חדשה
python scripts/check_long_dash.py
python scripts/check_tier_gates.py   # אם נגעת בשורה ב-pricing.html
python scripts/check_events.py       # אם נגעת בקישור לבוט
python scripts/check_bot_entry.py    # אם נגעת בהודעת פתיחה או בקישור לבוט
```

`deno` אינו מותקן בסביבה כברירת מחדל. `npm i -g deno` עובד מאחורי הפרוקסי,
ו-`deno.land/install.sh` חסום.

ואחרי המיזוג: הפריסה של הפונקציה היא `supabase_functions.yml` ב-Actions.
כל עוד הריצה לא ירוקה, הבוט עדיין רץ בגרסה הקודמת.
