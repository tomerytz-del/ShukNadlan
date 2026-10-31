---
name: scraped-leads
description: לידים מפוסטים בקבוצות פייסבוק ובמרקטפלייס בריפו של שוק נדל״ן - scraped_leads (pending_consent → consented / open_demand, וסירוב שנמחק), scraped_lead_add / scraped_lead_set_consent / scraped_leads_lifecycle, seeker_inbound ב-leads, הביקוש הפתוח שמופץ חינם לכל הסוכנים בעיר ובסוג הנכס (open_demand), agent_works_city / agent_handles_type, והלשונית "ביקוש פתוח". Use when the scraping agent adds posts, when a consented post did not become a lead or went to the wrong agent, when adding a source (another site, Instagram, Yad2 groups), when changing the 7/30 day windows, when an open demand reached agents in another city or none, or when anyone proposes inserting scraped posts directly into leads.
---

# לידים מפוסטים בפייסבוק

המסמך המלא: `docs/scraped-leads.md`. המיגרציות: `20270812090000_scraped_leads.sql`, ותקופת
ההשקה, "אני פונה" ו"ללא תיווך" ב-`20270823090000_scraped_leads_launch.sql`. ההוראות
לסוכן הסורק (גרוק): `docs/agent-skills/facebook-leads-scanner.md` - **שינוי בקריאות
או בשדות מעדכן גם אותו**, כי הסורק קורא אותו מ-`main` בתחילת כל סריקה.
כאן מה שנשבר בשקט.

## 1. פוסט אינו ליד, ולכן לא נכנס ל-`leads` ישירות

האדם לא השאיר פרטים אצלנו. **insert ישיר ל-`leads` הוא הטעות שכולם יציעו**,
והיא שוברת שלושה דברים בשקט:

- ליד בלי `agent_id` מוסתר מכל הסוכנים (ה-RLS של `leads` הוא "שלי או של
  המשרד שלי"), והטריגר `notify_agent_on_new_lead` מדלג עליו. הליד פשוט נעלם.
- אין שיוך אוטומטי לפי עיר במסד. הרוטציה של `owner-lead-intake` היא קוד TS,
  ואינה מסננת לפי עיר כשאין `neighborhood_id`.
- כל דוח, מכסה וספירה סופרים את `leads`. פוסט בלי הסכמה היה נספר כליד.

לכן הסורק קורא רק ל-`scraped_lead_add` (ול-`scraped_lead_enrich` כדי להשלים
שדות אנונימיים בפוסט קיים - לא `update` ישיר), ול-`leads` נכנס רק מה ש-
`scraped_lead_set_consent(id, 'consented')` כותבת. מקור חדש (אתר אחר,
אינסטגרם) עובר באותו מסלול: ערך ב-`v_source not in (...)` של `scraped_lead_add`,
ב-`LEAD_SOCIAL_SOURCES` (`assets/crm-leads.js`), ב-`SOURCE_LABEL` וב-`POST_SOURCES`
(`notification-push/lead-alert.ts`), ובשתי רשימות המקורות בניתוב
(`l.source in (...)` בבחירת הסוכן/ת, ו-`source_detail`). ו-`lead_source_channel()`
אם הוא לא מתחיל ב-`facebook_` - אחרת הוא נספר `other` בבקרת הלידים.

## 2. ביקוש פתוח: בלי פרטים מזהים, וזה נאכף במסד

בביקוש הפתוח מוצג `demand_summary` (‏`summary` מהסורק), **לא `property_details`**,
שמגיע בפועל עם כתובת. עמודה חדשה ב-`open_demand_list` או בהתראה - רק מה שאינו
מזהה.

`scraped_leads_anon` (check) מסרב לשם, טלפון או טקסט בכל מצב חוץ מ-
`pending_consent`. **אל תוסיפו עמודה מזהה** (מייל, שם פרופיל, תמונה) בלי
להכניס אותה לאילוץ ולשני ה-`update` שמאפסים (`scraped_lead_set_consent`,
`scraped_leads_lifecycle`). הקישור לפוסט נשאר בכוונה - דרכו מגיבים - ולכן
`open_demand_list()` היא הדרך היחידה לקרוא, בלי גישה לטבלה מהדפדפן.

בליד שנוצר מהסכמה הקישור יושב ב-`raw_message` (נחשף בפתיחה) ולא ב-
`property_details` (גלוי בליד נעול): הוא מזהה את האדם.

## 3. "עובד/ת בעיר" ו"מתעסק/ת בסוג" - שתי פונקציות, שלושה צרכנים

`agent_works_city` ו-`agent_handles_type` קובעות את הסוכן/ת שמקבל/ת ליד אחרי
הסכמה, את מי שמקבל/ת התראת `open_demand`, ואת מי שרואה את הלשונית. שינוי
בהגדרה משנה את שלושתם, וזו הכוונה - אל תכתבו תנאי עיר מקומי באחד מהם.
סוכן/ת **בלי** העדפות פעילות מתעסק/ת בכל סוג. ליד בעלים נשלח רק ל-`mid`/
`premium`, כי `claim_lead` חוסמת `free` על `owner_inbound` - **חוץ מתקופת
ההשקה**, שבה הליד נולד `unlocked` בלי `claim_lead`, ולכן גם `free` מקבל/ת
אותו (‏`v_launch` בשלושת התנאים ב-`scraped_lead_set_consent`).

עיר שאינה ב-`cities` (`city_id_for_name` מחזירה `null`) נשמרת, ואינה מנותבת
ואינה מוצגת. `scraped_lead_add` מחזירה `city_known: false` - הסורק צריך
לתקן את השם, לא המסד לנחש.

## 4. ההפצה: התראה, וכפתור בוואטסאפ

`open_demand_notify_cap_enabled` נולד 0. כבוי: `open_demand` נכתבת **לכל**
סוכן/ת מתאים/ה. נמדדו 51 עד 54 סוכנים לפוסט. דלוק: עד `open_demand_notify_cap`
(8), קודם מי שלא תפס/ה ליד ב-`open_demand_pull_lookback_days` (14). האות הוא
`claim_lead` (פתיחה אחרי `created_at`) ו-"אני פונה", לא שיוך ולא
`agent_clients`. שובר שוויון: ההתראה האחרונה הישנה, ואז `random()`.
מנותק/ת, `license_status` של `not_found`/`inactive`, והשתקת פעמון יוצאים
מהתקרה רק כשהדגל דלוק. שעות שקט ושמירת ההתפרצות נשארות ב-`notification-push`,
כי `demand_notified_at` נכתב פעם אחת. הלשונית לא נחתכת. היומן:
`open_demand_notify_log`. היא **לא** בעדיפות
(`notification_push_priority_types`) ולא צריכה להיות: אף אחד לא מחכה בצד
השני, והתקרה היומית היא מה שמגן על המספר מול Meta (הסקיל
`agent-notifications`, סעיף 8). וואטסאפ על פוסט אחד יוצא רק ל-
`notif_burst_demand_fanout` הראשונים (ברירת מחדל 15, `0` מבטל), לפי עיר
המשרד ואז פעילות. השאר נשארים בפעמון (`suppress_push`). אין למחוק אותם
מההפצה ואין לדלג עליהם: `demand_notified_at` נכתב פעם אחת לכולם.

אין לה מזהה, ו-`itemPath` מחזיר לכולן `/crm?goto=accLeads&tab=demand`, ולכן
הודעה של כמה ביקושים היא יעד אחד ויוצאת **ככפתור** (`cta_url`, "📣 לביקוש
הפתוח"). **אל תוסיפו מזהה ביקוש לנתיב**: שני ביקושים יהפכו לשני יעדים,
וההודעה תחזור לקישורים. הפעמון (`openNotificationTarget`) ו-`handleGotoParam`
(‏`tab=demand`) פותחים את אותה לשונית.

## 5. כפילויות - שלוש שכבות, ולא אינדקס על טלפון

`(source, external_ref)` ייחודי, ו-`external_ref` קנוני (`scraped_lead_ref`:
בלי `www.`/`m.`, בלי פרמטרי מעקב, ו-hash כשהכתובת מחוץ ל-
`leads_external_ref_format`). פוסט שבעליו סירב/ה - `scraped_lead_blocks`
(hash בלבד, נמחק 30 יום אחרי הפוסט). אותו אדם - `phone_tail9` ב-30 יום, ב-
`scraped_leads` וב-`leads`. **לא אינדקס ייחודי על טלפון**: אותו אדם יכול
להיות מחפש/ת היום ובעלים בעוד חודש.

## 6. תקופת ההשקה - בהגדרה, לא בקוד

`pricing_config.scraped_leads_launch_until` (‏`yyyymmdd`, ‏`0` = כבוי) ו-
`scraped_leads_launch_active()`. בהשקה: ביקוש פתוח מרגע הקליטה (גם
`pending_consent`), וליד אחרי הסכמה נולד `unlocked` עם `quota_source =
'launch_free'`. **אל תכתבו תאריך בפונקציה**, ואל תפתחו בהשקה ליד דרך
`claim_lead` - היא מחייבת. בביקוש הפתוח מוצג `demand_summary` ולא
`property_details` (שמגיע עם כתובת). התראה אחת לפוסט (`demand_notified_at`).

**מה נחשב ביקוש פתוח - `scraped_lead_is_demand`, הגדרה אחת** לרשימה, לתפיסה
ולהתראה. ‏`no_broker` (`post`/`group`): בעלים מוצגים עם הנחיה, מחפשים לא.
"אני פונה" (`open_demand_claim`) - סוכן/ת אחד/ת לביקוש, לא משתחרר, עד
`open_demand_claims_daily` ביום; ואם האדם מסכים/ה הליד הולך למי שתפס/ה, אם
הוא/היא רשאי/ת לסוג.

## 7. החלונות: 72 שעות, 7 ימים, 30 יום

- `scraped_lead_add` דוחה פוסט מלפני יותר מ-72 שעות (`post_too_old`).
- 7 ימים מ-`consent_requested_at` (או מהקליטה) - ביקוש פתוח.
- 30 יום מ-`posted_at` - מחיקה, בכל מצב. **לא `created_at`**: זה מה שהובטח.

`created_at` של הליד ב-`leads` הוא רגע ההסכמה ולא רגע הפוסט, בכוונה: אחרת 12
שעות הבלעדיות של ליד בעלים נגמרות לפני שהוא נולד, וזמן התגובה בדאשבורד
המשרד מתנפח. תאריך הפוסט נכתב ב-`raw_message`.

`scraped_leads_lifecycle` ו-`scraped_lead_matching_rest` חולקות מנעול ייעוץ
`scraped_leads_dispatch` כפקודה הראשונה. מחזור החיים מחכה. הגל השני מוותר
ומחזיר 0. מי שמגדיר/ה אותן מחדש מעתיק/ה את הנעילה: מחזור החיים נועל קודם
את הפוסטים הישנים ואז עובר לפי id, והגל השני עובר לפי id, ושניהם יכולים
לחכות זה לזה. `scraped_lead_matching_enabled` נשאר 0.

## לפני הדחיפה

בדיקה של ממש: Postgres 16 מקומי (`/usr/lib/postgresql/16/bin`, כמשתמש
`nobody`), stub של הטבלאות שהמיגרציה נוגעת בהן, המיגרציה **פעמיים**, ותרחיש
שעובר על כל מצב: הסכמה, סירוב וחסימה, ביקוש פתוח ומי קיבל/ה, סוכן/ת מעיר
אחרת שלא רואה, ומחיקה אחרי 30 יום.

```sh
python3 scripts/check_migration_versions.py --base-ref origin/main
python3 scripts/check_function_grants.py
python3 scripts/check_table_grants.py
python3 scripts/check_notif_links.py
python3 scripts/check_long_dash.py
node --check assets/crm-leads.js
```
