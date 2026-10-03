---
name: whatsapp-bots
description: עבודה על שני הבוטים בוואטסאפ של שוק נדל״ן (גבריאלה) - העוזרת של הסוכנים (agent.ts) והבוט הציבורי (public-agent.ts): הפרסונה והשם בכל המקומות, ההיכרות בהודעה הראשונה, הודעות עם כפתורים (offer_save_search), כרטיס איש הקשר, מטמון הפרומפט, והכפתור באתר (bot-link.js ENABLED). Use when changing what the bots say or how they introduce themselves, renaming the assistant, adding a WhatsApp interactive/button/contact message, adding a tool to public-agent.ts or agent.ts, when a button message is rejected by Meta, when cache_read_input_tokens drops to 0, or when turning the site's "ask Gabriela" button on or off.
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
* כותרת עד **20 תווים**. "לא, תראי לי גם שכונות נוספות" (28) קוצר ל-"לא,
  תראי עוד שכונות". הקוד חותך ב-`Array.from` ולא ב-`slice`, כי אימוג'י הוא
  שתי יחידות UTF-16, וחיתוך באמצע משאיר תו שבור.
* גוף עד 1024 תווים.

**הכותרת היא מה שחוזר לבוט.** `index.ts` מעביר את `button_reply.title` כאילו
נכתב ביד. לכן הכותרת צריכה להיות מובנת למודל גם בלי המסך, וההוראות צריכות
להכיר אותה (`SAVE_YES_TITLE` = ה"כן" המפורש של `save_search_alert`).

**הודעת כפתורים סוגרת את התור.** `offer_save_search` מסמן `ctx.offerSent`.
`runPublicTurn` עוצר את הלולאה ומחזיר `text: ""`, ו-`index.ts` לא שולח
דבר. טקסט אחרי הכפתורים היה דוחף אותם למעלה עם שאלה כפולה. בהיסטוריה נרשם
גוף ההודעה עם הכותרות, כדי שהלחיצה בתור הבא תדע על מה היא עונה. כשל
בשליחה מחזיר `sent: false`, והמודל שואל בטקסט.

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
* **לא באותו תור שבו נשלחו כפתורים.**
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

## לפני הדחיפה

```sh
python scripts/check_edge_types.py   # טיפוסים מול הרף; CI חוסם שגיאה חדשה
python scripts/check_long_dash.py
python scripts/check_tier_gates.py   # אם נגעת בשורה ב-pricing.html
python scripts/check_events.py       # אם נגעת בקישור לבוט
```

`deno` אינו מותקן בסביבה כברירת מחדל. `npm i -g deno` עובד מאחורי הפרוקסי,
ו-`deno.land/install.sh` חסום.

ואחרי המיזוג: הפריסה של הפונקציה היא `supabase_functions.yml` ב-Actions.
כל עוד הריצה לא ירוקה, הבוט עדיין רץ בגרסה הקודמת.
