---
name: property-video
description: הסרטון השיווקי לנכס בריפו של שוק נדל״ן - property-video-create / property-video-callback, fal.ai (Kling), החיוב מראש והזיכוי דרך failVideoJob, ה-reconcile מול fal (falAppPath), ואורך הסצנה. Use when touching _shared/property-video.ts / property_video_jobs, when a video failed and the money did not come back, when a video is stuck "בהפקה", when changing the fal model or merge step, when adding a failure path, or when telling the agent what happened to the charge.
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
| `supabase/functions/reel-producer/index.ts` | הממשק של מפיקי הרילס (Grok והגיבוי), זהות לפי הסוד |
| `supabase/functions/_shared/reel-fallback.ts` | המעברים בין המפיקים, ו-`startFalLegacy` (לולאת fal שיצאה מ-create) |
| `marketing/reel_worker/` + `.github/workflows/reel_render.yml` | הגיבוי של האתר. `tools/` הוא העתק כלשונו של reference_code מהערכה |

## 0. תבנית D: מי מפיק, ומה אסור לשבור

מאז 24.10.2026 הסרטון הוא רילס בתבנית D: ‏Grok (‏`pending_reel` → ‏`rendering`)
→ הגיבוי ב-GitHub Actions (‏`site_reel`) → fal כמוצא אחרון. הפירוט ב-
`docs/property-marketing-video.md`, "תבנית D". שלושה כללים:

- **סטטוס פתוח חדש נכנס לכל המקומות** - האינדקסים, `start`/`quote`/`status`,
  ה-reconcile, התנאי של ה-cron ו-`ops_agent/config.py`.
- **מעבר בין מפיקים הוא update מותנה-סטטוס על `claimed_by`**, ו-
  `complete_property_video_job` עם `p_producer` משלימה רק למחזיק/ה. מעבר ישיר
  בלי התנאי מאפשר לשני מפיקים להשלים את אותה בקשה.
- **`tools/` אינו נערך.** גרסה חדשה של התבנית היא העתקה של ארבעת הקבצים; כל
  התאמה לסביבה ב-`run_job.py`. ‏`grok_daily` אינו בקשה: לא נספר במכסה ולא פתוח.

### עדכון התבנית (גרסה חדשה של reel.py מ-Grok)

1. להעתיק **כלשונם** את `reel.py`, `queue.py`, `cutout.py` ו-`watermark.py` מ-
   `reference_code` של הערכה ל-`marketing/reel_worker/tools/` (וגם `post_image.py`
   כשהוא בערכה: `queue.py` טוען אותו לפוסטים בקבוצות פייסבוק, והגיבוי אינו
   מריץ אותו - לכן התלויות שלו, scipy ו-Heebo, אינן ב-`requirements.txt`). בלי עריכה - כל
   מה שהסביבה דורשת יושב ב-`run_job.py` (‏`snapshot_property`, ‏`azure_tts`,
   ‏`REMBG_PY`, ‏`R.LAYOUT = "D"`). אם הגרסה החדשה קוראת שדה חדש מה-snapshot
   (`p.get("…")`), הוא נכנס ל-`snapshot_property` **ול-`renderData`** ב-
   `reel-producer`, אחרת גם Grok וגם הגיבוי מקבלים `None` בשקט.
2. גם `brand/music/tracks.json`, אם השתנה. קובץ מוזיקה ברישיון Pixabay לא נכנס
   לריפו - רק לדלי הפרטי `reel-assets`.
3. `python marketing/reel_worker/smoke_test.py --kit <template_D_kit>` - רילס מלא
   בלי רשת (תמונות `file://`, קול מדומה). להשוות את השער ואת הפריימים ל-
   `samples/1171/frame_*.jpg`, ואת שורות `VO:` ל-`full_reel_voiceover.txt`.
   דורש ffmpeg, ‏Chromium ב-PATH (בסשן ענן: `/opt/pw-browsers/chromium-*/chrome-linux64/chrome`
   בשם `chromium`) והגופנים מ-`fonts/` מותקנים.

### בדיקה אחרי פריסה, בלי לחייב אף אחד

הפעלה ידנית של `reel_render.yml` (‏workflow_dispatch) עם `job_id` של UUID שאינו
קיים: התוצאה הצפויה היא "job is not ours" ויציאה ירוקה. היא מוכיחה שה-runner
עולה, שהתלויות מותקנות, ש-`REEL_SITE_SECRET` זהה ב-GitHub וב-Supabase, ושה-
`reel-producer` חיה. אדום עם `HTTP 401` = הסוד לא תואם. רינדור אמיתי עם קול
מ-Azure דורש בקשה אמיתית, כלומר חיוב - לשאול לפני.

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

- רץ כל 5 דקות **רק כשיש בקשה פתוחה** (`pending_reel` / `rendering` /
  `generating_clips` / `merging` / `uploading`). אלה גם הסטטוסים שהסוכן התפעולי בודק ב-`ops_agent/config.py`;
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
