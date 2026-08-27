# מנגנון הדמיות נכסים

הדמיות AI לנכסים מסחריים ופרטיים, זמינות לנכסים של סוכני **Premium** בלבד.
המנגנון יובא מפרויקט `nadlan-afula.co.il` והותאם לסכמה של shuknadlan.

---

## מה יובא ומה שונה

| רכיב באפולה | מה עשה שם | מה נעשה כאן |
|---|---|---|
| `business-visualizer` | הדמיית עסק על נכס מסחרי, Gemini img2img | `property-visualize` — אותו מנוע, אותה דוקטרינת פרומפט |
| `generate-room-renders` | Replicate `adirik/interior-design`, 3 סגנונות × סלון/מטבח, batch קבוע | הוחלף ב-Gemini באותו מנוע כמו המסחרי, עם חוץ הבית ו-4 סגנונות |
| `classify-photos` | סיווג `photo_type`/`space_role` על `property_photos` | `classify-property-images` — מוסיף גם `room_type`, ועובד מעל `properties.images` |

שלושת ההבדלים המהותיים:

1. **אין `property_photos`.** ב-shuknadlan התמונות יושבות במערך `properties.images`
   בלי שום סיווג. לכן נוספה טבלת תיוג דקה (`property_image_tags`) שיושבת *מעל*
   המערך ולא נוגעת בו — אין צורך בשינוי בטפסי ה-CRM.
2. **מנוע אחד במקום שניים.** אפולה הפעילה Replicate לנכסים פרטיים ו-Gemini
   למסחריים. כאן הכל Gemini: מודל ה-`interior-design` של Replicate הוא לפנים
   בלבד ולא יודע לייצר חזית בית, ופרומפט "העריכה השמרנית" של Gemini הוא בדיוק
   מה שמונע ממנו לצייר בניין אחר.
3. **היברידי במקום קבוע.** באפולה כל ההדמיות הפרטיות נוצרו מראש. כאן נוצר סט
   בסיס אחד עם פרסום הנכס, וכל סגנון נוסף נוצר לפי דרישת הגולש/ת תמורת שם
   וטלפון — כלומר ההדמיה היא גם תוכן שיווקי וגם מכונת לידים.

---

## איך זה עובד

### נכס פרטי (`category = 'residential'`)

שלוש מטרות הדמיה:

| מטרה | תמונת המקור | מתי נוצרת |
|---|---|---|
| `exterior` | תמונה שסווגה `facade` (ובהיעדרה `yard`) | **רק** בבית פרטי / קוטג' / דו-משפחתי / וילה / פנטהאוז |
| `living_room` | תמונה שסווגה `living_room` | תמיד |
| `kitchen` | תמונה שסווגה `kitchen` | תמיד |

**למה דירה בבניין לא מקבלת `exterior`:** חזית הבניין היא רכוש משותף. הדמיית
שיפוץ שלה מציגה שדרוג שאיש לא מתחייב אליו ואינו בשליטת המוכר/ת. דירות מקבלות
סלון ומטבח בלבד.

**ארבעה סגנונות**, מכוונים לטעם השוק הישראלי:

| `style_key` | שם | הקו |
|---|---|---|
| `modern_clean` | מודרני נקי | לבן/אפור בהיר/אלון, גרניט פורצלן, ארונות ללא ידיות. ברירת המחדל |
| `mediterranean_white` | ים-תיכוני לבן | טיח גירי, אבן ירושלמית, קשתות, זית ובוגנוויליה, פליז |
| `warm_scandi` | סקנדינבי חמים | Japandi — אלון בהיר, בז' חם, גימורים מטים, צמחייה |
| `modern_luxury` | יוקרה מודרנית | שיש קלקטה, אגוז כהה, פליז מוברש, תאורה דרמטית |

### נכס מסחרי (`category = 'commercial'`)

שתי מטרות: `exterior` (שילוט וויטרינה) ו-`interior_main` (ריהוט וציוד לעסק).
הקלט הוא **סוג העסק** בטקסט חופשי, ולכן **אין סט בסיס** — "משרד רו״ח" ו"חנות
בגדים" באותו נכס נראים אחרת לגמרי, ואין ברירת מחדל הגיונית ל"עסק".

---

## דוקטרינת הפרומפט

זה החלק שקובע אם ההדמיה שימושית או מטעה. כל פרומפט בנוי משני חלקים, באותו סדר:

1. **האיסורים** — רשימה ממוספרת ומפורשת של מה שאסור לגעת בו: מיקום וגודל של
   חלונות ופתחים, קווי מתאר, גובה תקרה, זווית הצילום, אור היום. בחוץ נוסף גם
   איסור להעלים דוד שמש, מזגנים ומתקנים קבועים — הם חלק מהנכס.
2. **ההיתרים** — מה מותר לשנות: ריהוט, גימורים, גינון, תאורה מלאכותית, פינוי
   חפצים ניידים.

כל פרומפט נחתם באותה הוראת ברירת מחדל: *"אם יש לך ספק אם שינוי מסוים משנה את
המבנה — אל תבצע אותו"*. `temperature` מוגדר 0.2 בכוונה — רוצים עריכה צייתנית,
לא יצירתיות.

הקטלוג המלא ב-`supabase/functions/_shared/visualization.ts`.

---

## סכמה

| אובייקט | תפקיד |
|---|---|
| `property_image_tags` | סיווג AI לכל תמונה: `photo_type`, `space_role`, `room_type`. `properties.images` נשאר מקור האמת |
| `visualization_jobs` | בקשת הדמיה. `trigger_source` = `base` (סוכן/ת) או `ondemand` (גולש/ת) |
| `property_visualizations` | התמונות שנוצרו. `is_base=true` = מוצג פומבית בדף הנכס |
| `property_visualizations_public` | View ל-anon — סט הבסיס בלבד, של נכסי Premium פעילים |
| `property_visualizations_enabled(uuid)` | מקור האמת היחיד לזכאות. גם ה-RLS וגם ה-Edge Functions נשענים עליו |
| `visualization_job_status(uuid)` | מעקב אחרי בקשה. ה-`job_id` הוא הרשאת הגישה |
| bucket `property-visualizations` | ציבורי לקריאה, כתיבה ל-`service_role` בלבד |

**ייחודיות:** אינדקס חלקי על `(property_id, target, style_key) where kind='private_room'`.
הדמיה פרטית זהה לא נוצרת פעמיים — שני גולשים שביקשו "סלון ים-תיכוני" מקבלים את
אותה תמונה, נרשמים כשני לידים, ו-Gemini נקרא פעם אחת. זה מה שהופך את המודל
ההיברידי לזול יותר מ-batch מראש.

---

## Edge Functions

### `property-visualize` — `verify_jwt = false`

הדמיה לפי דרישת הגולש/ת.

```
POST { property_id, style?, business_type?, business_description?, name, phone }
→ { ok, job_id, lead_id, ready: [{target, style_key, result_url}], pending_targets }
```

- `name`+`phone` **חובה** — הם המוצר, לא אימות. הליד נוצר לפני ההדמיה ונכנס
  לאותו מסלול tier של `property-inquiry-intake` (Mid/Premium נפתח מידית).
- `lead_type = 'visualization'`.
- העיבוד ממשיך ברקע ב-`EdgeRuntime.waitUntil`; הפרונט עושה polling דרך
  `rpc('visualization_job_status', { p_job_id })`.
- בלם קצב: `visualization_ondemand_daily_cap` בקשות ל-24 שעות **פר נכס**
  (לא פר גולש/ת — אין לנו זהות אמינה בצד הזה).

### `property-visualize-base` — `verify_jwt = true`

סט הבסיס. הסוכן/ת נגזר/ת מה-JWT בלבד, לעולם לא מה-body.

```
POST { property_id, style?, force? }   Authorization: Bearer <agent JWT>
→ { ok, job_id, style, targets, skipped_targets }
```

נכס פרטי בלבד. מסמן `is_base = true` — אלה ההדמיות שמופיעות בדף הנכס לכל
מבקר/ת. `force: true` מייצר מחדש גם מה שכבר קיים.

### `classify-property-images` — `verify_jwt = false`

```
POST { property_id }   |   POST { limit: 100 }
```

מסנכרן `properties.images` → `property_image_tags` ומסווג את מה שממתין.

**לא חובה להריץ:** שתי פונקציות ההדמיה קוראות ל-`ensureTagged` ומסוות מה שחסר
להן תוך כדי. הפונקציה קיימת למילוי לאחור ולהרצה תקופתית שמפזרת את עלות הסיווג
מראש, כדי שהגולש/ת לא יחכה לה בזמן אמת.

---

## התקנה

1. **מיגרציה:** `supabase/migrations/20260827180000_property_visualizations.sql`
2. **סוד:** ב-Supabase → Edge Functions → Secrets להוסיף `GEMINI_API_KEY`.
   אופציונלי: `GEMINI_IMAGE_MODEL`, `GEMINI_VISION_MODEL`.
3. **פריסה:**
   ```
   supabase functions deploy classify-property-images --no-verify-jwt
   supabase functions deploy property-visualize        --no-verify-jwt
   supabase functions deploy property-visualize-base
   ```
4. **מילוי לאחור:** `POST /functions/v1/classify-property-images { "limit": 200 }`
5. **סט בסיס לנכס:** `POST /functions/v1/property-visualize-base { "property_id": "..." }`
   עם JWT של הסוכן/ת.

---

## גילוי נאות

כל תמונה בסקציה מסומנת בתגית **"הדמיה"** *על גבי התמונה עצמה* ולא לידה — מי
שישמור או ישתף את התמונה ייקח את התווית איתו. מתחת לגלריה יושבת הבהרה מלאה
שההדמיות נועדו להמחשת פוטנציאל עיצובי בלבד, אינן מהוות התחייבות לביצוע עבודות
או לתוצאה, ואינן מתעדות את מצב הנכס כיום.

זו לא קישוטיות: הצגת נכס באופן שעלול להטעות קונה היא חשיפה ממשית, ותגית
שמתנתקת מהתמונה ברגע השיתוף אינה מגנה על אף אחד.

---

## עלויות

לכל הדמיה קריאת Gemini אחת (`gemini-3.1-flash-image-preview`), ולכל תמונה חדשה
קריאת סיווג אחת (`gemini-3.1-flash-lite`, זולה משמעותית).

- **סט בסיס לנכס פרטי:** 2–3 קריאות חד-פעמיות.
- **בקשת גולש/ת בסגנון שכבר נוצר:** אפס קריאות — הליד נרשם, התמונה מהקאש.
- **בקשה בסגנון חדש:** 2–3 קריאות, ואז הסגנון הזה בקאש לכל שאר הגולשים.

התקרה התאורטית לנכס פרטי היא 4 סגנונות × 3 מטרות = 12 קריאות לאורך כל חיי
המודעה. נכס מסחרי אינו נהנה מקאש (סוג העסק חופשי), ולכן בלם הקצב היומי הוא
ההגנה שם.
