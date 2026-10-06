# מנוע המדיה (ffmpeg)

רינדור וידאו ותמונות שאי אפשר לעשות ב-Edge Function: תמונת פתיחה לסרטון,
ובהמשך דחיסה, Reels עם מחיר ולוגו, וחיתוך קליפים. התכנית המלאה והחלטות
המוצר: [`media-worker-plan.md`](media-worker-plan.md).

**מצב: שלב 0.** הצינור קיים ונבדק, והסוג היחיד שממומש הוא `poster`. אף מקום
באתר עדיין לא קורא את התוצרים, ואין טריגר שמכניס בקשות - בקשה נוצרת ידנית.

---

## איך זה עובד

```
מקור (בשלב 0: SQL ידני)  ──insert──>  media_renders (queued)

pg_cron כל 2 דקות, רק כשיש queued/rendering
  └─> media-render?mode=dispatch
        │  מחזיר לתור ריצה שנתקעה, מכשיל בקשה שאיש לא לקח
        └─> POST workflow_dispatch ל-GitHub  (ריצה אחת לכל התור)

GitHub Actions: media_render.yml → media_render.py
  לולאה:  claim ─> הורדה ─> ffmpeg ─> ffprobe ─> העלאה לכתובת חתומה ─> complete
                                                         (או fail)
```

| חלק | איפה |
| --- | --- |
| התור, ‏`claim_media_render()`, הדלי, ה-cron | `supabase/migrations/20270305090000_media_renders.sql` |
| השיגור, הלקיחה והדיווח | `supabase/functions/media-render/index.ts` |
| המנוע | `media_render.py`, `media_engine/` |
| הריצה | `.github/workflows/media_render.yml` |
| הבדיקות (ffmpeg אמיתי, בלי רשת) | `media_engine/test_media_engine.py`, `media_engine_test.yml` |

### למה GitHub Actions

הריפו ציבורי, ולכן דקות ב-runner רגיל הן בחינם וללא מכסה. ffmpeg ו-Chromium
זמינים שם בלי תשתית חדשה, והמנועים האחרים כבר רצים שם. המחיר הוא 30-60 שניות
של עליית runner, וזה זניח מול הפקה שממילא לוקחת דקות. הממשק (תור + `claim` +
`complete`) אינו תלוי ב-Actions: מעבר לקונטיינר הוא החלפת מי שקורא ל-`claim`.

### מצבי בקשה

| `status` | מה |
| --- | --- |
| `queued` | ממתינה. `dispatched_at` אומר אם כבר הועירה ריצה בשבילה |
| `rendering` | ריצה לקחה אותה. `attempts` עלה, ו-`output_path` נקבע |
| `done` | `output_url` ו-`output_meta` (מה ש-ffprobe מדד) |
| `failed` | `last_error` מסביר |

הספים יושבים בשרת בלבד (`media-render/index.ts`), ולא בתנאי ה-cron:

| סף | ערך | מה קורה |
| --- | --- | --- |
| `STALE_RENDER_MINUTES` | 20 | בקשה ב-`rendering` בלי דיווח חוזרת לתור (עד 3 ניסיונות, ואז `failed`) |
| `REDISPATCH_MINUTES` | 10 | שיגור שלא הוליד ריצה משוגר שוב |
| `ABANDON_HOURS` | 24 | בקשה שאיש לא לקח נכשלת ב-`never_picked_up`, כדי שה-cron לא יירה לנצח |

**כשל `retryable`** (רשת, ‏5xx, זמן) חוזר לתור. כשל של הקלט עצמו (קובץ שאינו
וידאו, ‏404, סוג לא ממומש) נכשל מיד, כי ניסיון נוסף יחזיר את אותה תוצאה.

### האבטחה, ולמה היא בנויה כך

- **למנוע אין `service_role`.** הסוד שלו (`MEDIA_WORKER_SECRET`) מאפשר רק
  `claim`, `complete` ו-`fail`. הריפו ציבורי, ולכן היומנים של Actions ציבוריים,
  וזה מה שמגביל את מה שאפשר להפסיד.
- **הנתיב נבחר בשרת**, נשמר על השורה ב-`claim`, ו-`complete` אינו מקבל נתיב
  מהמנוע בכלל. מנוע שנפרץ אינו יכול לשייך לבקשה קובץ זר.
- **הכתובת החתומה להעלאה לא מודפסת ביומן.**
- **שני מסלולי האימות fail-closed:** סוד שלא הוגדר הוא 503, לא "פתוח"
  (אותו עיקרון כמו ב-`_shared/cron-auth.ts`).

### תוצרים

דלי ציבורי `media-renders`, בנתיב `<kind>/<property_id>/<job_id>-<attempt>.<ext>`.
המספור לפי ניסיון מונע מצב שבו העלאה של ניסיון שנתקע דורסת את התוצר של
הניסיון שהצליח.

---

## הפעלה

1. **סוד משותף.** `openssl rand -hex 32`, ואותו ערך בשני מקומות:
   - Supabase → Edge Functions → Secrets: `MEDIA_WORKER_SECRET`
   - GitHub → Settings → Secrets and variables → Actions: `MEDIA_WORKER_SECRET`
2. **טוקן שיגור.** GitHub → Settings → Developer settings → Fine-grained tokens:
   ריפו `ShukNadlan` בלבד, הרשאה **Actions: Read and write** ותו לא. נשמר
   ב-Supabase כ-`GITHUB_DISPATCH_TOKEN`.
   **לטוקן יש תוקף.** כשהוא פג, השיגור מקבל 401, ובקשות נכשלות אחרי 24 שעות
   ב-`never_picked_up`. כדאי לרשום ביומן תזכורת לחידוש.
3. **מיזוג ל-`main`.** המיגרציה והפונקציה נפרסות בצינור.
4. **בדיקה ראשונה** (כתיבת נתונים, לא DDL):
   ```sql
   insert into media_renders (kind, property_id, agent_id, input)
   select 'poster', id, agent_id, jsonb_build_object('video_url', video_url)
     from properties
    where video_url like '%/storage/v1/object/public/property-videos/%'
    limit 1;
   ```
   תוך כ-2-3 דקות: ריצה ב-Actions, והשורה ב-`done` עם `output_url`.

### כשמשהו לא עובד

| מה רואים | איפה לחפש |
| --- | --- |
| השורה נשארת `queued` בלי `dispatched_at` | יומן ה-Edge Function: `github_dispatch_not_configured` (503) או `github_dispatch_failed` (טוקן פג או חסר הרשאה) |
| יש `dispatched_at` ואין ריצה ב-Actions | `GITHUB_DISPATCH_REF` / `GITHUB_REPO`, או שהקובץ `media_render.yml` עוד לא ב-`main` |
| ריצה ב-Actions נכשלת ב-401 / 503 | `MEDIA_WORKER_SECRET` חסר או שונה בין שני הצדדים |
| `failed` עם `ffmpeg_failed: ...` | `last_error` מחזיק את שורות השגיאה של ffmpeg |
