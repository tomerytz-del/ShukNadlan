---
name: new-tier-capability
description: הוספה או שינוי של יכולת שתלויה במסלול בריפו של שוק נדל״ן — הגייט במסד, השורה בטבלת המחירים, והשורה בתיעוד, שלושתם באותו PR. Use when gating a feature by tier, adding a row to the COMPARE table in pricing.html, writing a function that checks free/mid/premium, or when a paid capability turns out not to be enforced.
---

# יכולת חדשה שתלויה במסלול

## שלושה דברים, ואין שניים

יכולת שתלויה במסלול חיה בשלושה מקומות, ו**שלושתם באותו PR**:

| # | מה | איפה |
| --- | --- | --- |
| 1 | **הגייט** | פונקציה במסד, או בדיקת `tier` ב-Edge Function |
| 2 | **ההבטחה** | שורה במערך `COMPARE` ב-`pricing.html` |
| 3 | **המפה** | שורה בטבלת "איפה כל יכולת נאכפת" ב-`docs/pricing-and-tiers.md` |

**שתי הטעויות ההפוכות שקטות שתיהן**, וזה כל הסיפור:

* **הבטחה בלי גייט** — האתר מבטיח מה שאינו אוכף. מי שמשלם על המסלול הגבוה
  מקבל בדיוק את מה שמקבל מי שאינו משלם, **ואיש לא יתלונן**: מי שמקבל יותר
  ממה ששילם אינו פותח קריאת תמיכה.
* **גייט בלי הבטחה** — יכולת שנבנתה, נאכפת, ואיש אינו יודע שהיא קיימת.

שני הצדדים חיים בקבצים שונים, ואף אחד מהם אינו שובר כשהשני משתנה. אין דרך
לראות את זה בקריאת קוד.

**זה כבר קרה.** `pricing.html` הבטיח ב-✓ לשלושת המסלולים "שיתוף נכסים עם כל
המתווכים (Co-Broke)", בזמן שהמנוע לא הבחין בין מסלולים כלל.

```sh
python scripts/check_tier_gates.py
```

הבדיקה חוסמת ב-CI שורה מובחנת ב-`COMPARE` שאין לה גייט רשום, גייט שאינו
מוגדר באמת, וגייט שאינו מתועד. **מי שמוסיף שורה מובחנת מוסיף גם רשומה
ב-`GATES` שבסקריפט** — זו לא בירוקרטיה, זו ההצהרה שנקראת ב-PR.

## המזהים הם `free` / `mid` / `premium`, תמיד

```
free    ->  Pay&GO
mid     ->  PROFESSIONAL
premium ->  Elite
```

`assets/tiers.js` קובע זאת במפורש: **המזהים במסד לא השתנו, רק התצוגה.**
קוד שמשווה מול `'Elite'` יעבוד בבדיקה ידנית אחת וייכשל בשקט על כל מנוי אמיתי.

זו אותה הפרדה בדיוק שחוזרת בריפו: `area`/`region` במסד מול "אזור"/"מחוז"
במסך.

## הגייט במסד, ולא ב-UI

**כפתור מוסתר אינו גייט.** ‏`fetch` מהקונסול עוקף אותו, וגם משתמש/ת שפתח/ה
את הדשבורד בזמן שהמסלול שלו/ה פג.

התבנית שחוזרת תשע פעמים בריפו:

```sql
create or replace function public.my_capability_gate(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.agency_members m
     where m.id = p_agent_id
       and m.active = true
       and m.billing_status = 'active'   -- ‏מסלול שפג אינו מסלול
       and m.tier in ('mid', 'premium')
  );
$$;
```

**`billing_status` ו-`active` אינם קישוט.** בלעדיהם מנוי שפג ממשיך לקבל את
היכולת עד שמישהו ישים לב, והמנגנון שמוריד מסלול (`expire_paid_subscriptions`)
הופך לחסר משמעות.

### ‏`p_agent_id` מפורש מול `current_agent_id()`

ל-Edge Function **אין JWT**, ולכן פונקציה שמשרתת גם את העוזר בוואטסאפ צריכה
שתי חתימות — בדיוק התבנית של `cma_report` מעל `agent_cma_report`:

```sql
-- המנוע: מזהה מפורש, service_role בלבד
public.agent_x(p_agent_id uuid, ...)

-- העטיפה לדפדפן: המזהה מה-JWT
create or replace function public.x(...) ... as $$
  select public.agent_x(public.current_agent_id(), ...);
$$;
```

**ההרשאות אינן סימטריות, וזו הנקודה:** פונקציה שמקבלת `p_agent_id` ופתוחה
ל-`authenticated` מאפשרת לכל סוכן/ת לשאול בשם אחר/ת.

```sql
revoke all on function public.agent_x(...) from public, anon, authenticated;
grant execute on function public.agent_x(...) to service_role;

revoke all on function public.x(...) from public, anon;
grant execute on function public.x(...) to authenticated, service_role;
```

## מה חוזר כשאין הרשאה

**לא שגיאה.** ערך מובנה שה-UI יודע לתרגם למסך שדרוג:

```sql
return jsonb_build_object(
  'error',         'tier_required',
  'required_tier', 'premium',
  'detail',        'שאילתת עסקאות היסטוריות זמינה במסלול Elite.');
```

**ובעוזר בוואטסאפ צריך גם הנחיה מפורשת בפרומפט.** מודל שמקבל "אין הרשאה"
בלי הוראה מה לעשות ימלא את החסר באומדן משלו — בדיוק כמו `COVERAGE_GUIDANCE`
בדוח ה-CMA. הנוסח: *אמור/אמרי שזו יכולת של Elite, ואל תמציא/י נתונים.*

## הכפתור שאינו זמין מוצג ולא מוסתר

כפתור חסר אינו מלמד דבר. כפתור שאומר **"זמין ב-Elite"** הוא גם התשובה וגם
המדרג, וזו כל תכליתו.

## תשע נקודות האכיפה הקיימות

הן התקדים, והן גם הדוגמאות הטובות ביותר לקרוא לפני שכותבים אחת חדשה:

| יכולת | הגייט |
| --- | --- |
| לידים | `claim_lead` · `lead_audience_size` |
| מפה ומידע תכנוני | `property_map_enabled` · `agent_property_planning` |
| סרטון שיווקי | `property_video_tier` |
| הדמיות AI | `property_visualizations_enabled` |
| סיור 360° | `property_virtual_tour_eligible` |
| תיאור שיווקי | `property_description_tier_ok` |
| דוח CMA | `agent_cma_report` |
| שאילתת עסקאות | `agent_market_deals_lookup` |
| העוזר בוואטסאפ | `TIER_ALLOWED` ב-`whatsapp-webhook/index.ts` |

## והמסך חייב להיות נגיש

יכולת חדשה שמקבלת קטגוריה ב-CRM חייבת רשומה ב-`NAV_GROUPS`
(`assets/crm.js`). אקורדיון שקיים ב-`crm.html` ואינו בניווט הוא מסך
שנבנה, נפרס, עובד — ואי אפשר להגיע אליו. זה קרה עם "ייבוא עסקאות רשמיות".

```sh
python scripts/check_crm_nav.py
```

## הסדר שעובד

1. **הגייט** במיגרציה (הסקיל `new-migration` — ההרשאות שם הן הסעיף הקריטי).
2. **הצרכנים**: ה-RPC בדפדפן, והכלי ב-`whatsapp-webhook/agent.ts` אם רלוונטי.
3. **`NAV_GROUPS`** אם יש מסך.
4. **`COMPARE`** ב-`pricing.html`, ו-`GATES` ב-`scripts/check_tier_gates.py`.
5. **`docs/pricing-and-tiers.md`**, טבלת האכיפה.
6. `python scripts/check_tier_gates.py && python scripts/check_crm_nav.py`

> **אזהרה מסחרית:** שינוי ששולל יכולת ממסלול שכבר מכר אותה נוגע ב**מנויים
> קיימים שנרשמו על הנוסח הישן**. זה פריט לעורך/ת דין ולא החלטה הנדסית —
> ראו `docs/pricing-and-tiers.md`. מימוש כשהמחיר אפס (כשכל המשתמשים באותו
> מצב ממילא) עדיף על מימוש אחרי שההבדל כבר חי.
