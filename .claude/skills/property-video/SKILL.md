---
name: property-video
description: עבודה על הסרטון השיווקי לנכס בריפו של שוק נדל״ן - property-video-create ו-property-video-callback, ההפקה ב-fal.ai (Kling + merge-videos), החיוב מראש ב-start_property_video_job והזיכוי ב-fail_property_video_job דרך failVideoJob, ה-reconcile מול תור fal (falAppPath), webhook שאבד, המסלולים (MID בתשלום, Premium עם מכסה), אורך הסצנה שאי אפשר לקצר, והכפתור ב-CRM ובבוט. Use when touching _shared/property-video.ts / property-video-create / property-video-callback / property_video_jobs / property_video_clips, when an agent says a video failed and the money did not come back, when a video is stuck "בהפקה", when changing the fal model or the merge step, when adding a new failure path to the pipeline, or when the CRM or the bot tells the agent what happened to the charge.
---

# הסרטון השיווקי לנכס

המסמך המלא: `docs/property-marketing-video.md`. כאן מה ששובר **בשקט** - כל
אחד מהסעיפים נראה תקין בבדיקה ידנית, והכסף של סוכן/ת נתקע רק כשמשהו אצל fal
או במסד נכשל בדיוק ברגע הלא נכון.

## המפה

| קובץ | תפקיד |
| --- | --- |
| `supabase/functions/property-video-create/index.ts` | זכאות + חיוב (`start_property_video_job`), שליחת הקליפים ל-fal עם webhook לכל אחד |
| `supabase/functions/property-video-callback/index.ts` | ה-webhook של fal, `advanceJob` (מכונת המצבים), המיזוג, וה-reconcile ב-cron |
| `supabase/functions/_shared/property-video.ts` | `falSubmit` / `falStatus` / `falResult`, ‏`failVideoJob`, בחירת סצנות, `extractVideoUrl` |
| `assets/crm.js` · `produceMarketingVideo` | הכפתור, `confirmPurchase`, ה-polling והודעות השגיאה |
| `whatsapp-webhook/agent.ts` · `VIDEO_BLOCKERS` | אותה נקודת כניסה מהבוט, עם `agent_id` במסלול הפנימי |

## 1. החיוב קודם, ולכן כל כישלון אחריו חייב זיכוי

`start_property_video_job` מחייבת **לפני** השליחה ל-fal (הסקיל
`wallet-charges`). מכאן שכל מסלול כישלון - שליחה שנדחתה, קליפים מעטים מדי,
מיזוג שנכשל, העלאה שנכשלה, timeout - נגמר ב-`fail_property_video_job`, שמזכה
לפי `amount_charged` ופעם אחת בלבד.

**כל קריאה עוברת דרך `failVideoJob`, לא `supabase.rpc` ישיר.** עד 8.10.2026
תשעה קוראים התעלמו מהתשובה: קריאה שנכשלה ביטלה את הטרנזקציה כולה, גם את
הזיכוי, בלי לוג. ‏`failVideoJob` מנסה שוב (הפונקציה אידמפוטנטית), כותבת
`console.error` כשהזיכוי לא אושר, ומחזירה את מה שזוכה. מסלול כישלון חדש
שקורא ישירות ל-rpc מחזיר את הבאג.

## 2. ההודעה לסוכן/ת אומרת מה קרה לכסף

כשל אחרי החיוב **אינו** "לא בוצע חיוב". ‏`property-video-create` מחזירה
`refunded` ו-`refund_pending`, וה-CRM והבוט אומרים "₪25 הוחזרו לארנק" או
"יוחזר אוטומטית תוך כחצי שעה", ומרעננים את היתרה. "לא נגבה תשלום" נכון רק
לכשל **לפני** `start_property_video_job` (‏`fal_not_configured`, ‏`no_images`)
או ל-Premium שלא חויב.

## 3. ה-reconcile שואל את fal לפי האפליקציה, לא לפי המודל

שולחים לנתיב המלא (`fal-ai/kling-video/v2.5-turbo/pro/image-to-video`), אבל
התור של fal מגיש סטטוס ותוצאה תחת **שני המקטעים הראשונים**
(`fal-ai/kling-video/requests/<id>/status`). ‏`falAppPath` בונה את זה, והנתיב
המלא נשאר ניסיון שני על 404. עד 8.10.2026 נבנה הנתיב המלא, כל בדיקה חזרה
ריקה, וקליף שה-webhook שלו אבד חיכה לתקרת השעתיים. **החלפת מודל** ב-
`FAL_VIDEO_MODEL` / `FAL_MERGE_MODEL` לא דורשת שינוי כאן, כל עוד הוא תחת
`owner/app/...`.

בקשה שנכשלה אצל fal היא `COMPLETED` עם תוצאה של שגיאה, ולכן `falResult`
מחזירה `null` והקליף מסומן `no_video_in_result` - זה הנכון.

## 4. ה-reconcile הוא רשת הביטחון, וצריך לראות אותו

- רץ כל 5 דקות **רק כשיש בקשה פתוחה** (`generating_clips` / `merging` /
  `uploading`). אלה גם הסטטוסים שהסוכן התפעולי בודק ב-`ops_agent/config.py`;
  סטטוס חדש נכנס לשני המקומות.
- בקשה שלא זזה 30 דקות (`STALE_MINUTES`) נבדקת מול fal; בת שעתיים נסגרת
  ככושלת ומזוכה. הקבוע חי רק בשרת, לא בתנאי ה-cron.
- התשובה שלו סופרת `unrefunded` - בקשות שהסגירה שלהן לא אושרה. מספר שאינו
  אפס שם הוא תקלה במסד, לא ב-fal.
- כשל **לפני** `start_property_video_job` לא משאיר שורה, ולכן "אין שורה" אינו
  "איש לא ניסה". הבדיקה הראשונה היא יומני ה-Edge Functions.

## 5. מה שאי אפשר לשנות בקוד

- **אורך הסצנה:** ‏Kling מייצר 5 או 10 שניות, ו-fal אינו יודע לחתוך (נמדד:
  `compose` מתעלם מ-`duration`, ו-`/trim` מחזיר 404). ‏`clip_seconds` שווה ל-
  `source_seconds`. סצנה קצרה יותר דורשת מודל אחר.
- **הסרטון הישן נמחק אחרון**, ורק כשהוא בדלי `property-videos` שלנו.
- **‏`agent_id` מתקבל רק במסלול הפנימי** (`authorizeInternalCaller`), אחרת
  סוכן/ת מחייב/ת ארנק של אחר/ת.

## בדיקה

```sh
python3 scripts/check_edge_types.py   # צריך deno: npx -y deno@latest, ואז ה-binary מ-~/.npm/_npx
python3 scripts/check_long_dash.py && python3 scripts/check_pricing.py
node --check assets/crm.js
```

**התנהגות:** קובץ זמני ב-`supabase/functions/_shared/` שמייבא את
`failVideoJob` / `falStatus` עם `supabase` מדומה (`rpc` שמחזיר רצף תשובות)
ו-`globalThis.fetch` מדומה, `deno run --no-check --allow-env`, ומוחקים אחרי.
המקרים: זיכוי מאושר, שגיאה ואז הצלחה, שתי שגיאות, `already_done`, נתיב
האפליקציה, וחזרה לנתיב המלא על 404. **מול fal עצמו** - רק אחרי פריסה: בקשה
תקועה שה-reconcile מקדם (`advanced`) לפני תקרת השעתיים.
