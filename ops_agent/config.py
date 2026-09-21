"""ההגדרות והספים של הסוכן התפעולי.

**כל סף מספרי במערכת יושב כאן ולא בתוך ה-probe.** לא מטעמי סדר: סף
שמפוזר בקוד הוא סף שאיש אינו יודע מהו, וממצא שמופיע כל יום בלי שאיש
מתקן אותו הוא ממצא שהסף שלו שגוי. כשכולם במקום אחד, כיול הוא עריכה של
שורה אחת, והוויכוח על "האם 800ms זה איטי" נעשה פעם אחת.

הסביבה שהסוכן צריך:

* ‏`SUPABASE_DB_URL` — **חובה.** קריאה בלבד (ראו `db.py`). אותו סוד
  שכבר משמש את `supabase_migrations.yml` ואת בדיקת הוואטסאפ.
* ‏`SITE_BASE_URL` — לאן לשלוח את בדיקות הזמן החי. ברירת המחדל היא
  הפרודקשן.
* ‏`GITHUB_TOKEN` + `GITHUB_REPOSITORY` — לבדיקת בריאות ה-workflows.
  בלעדיהם ה-probe מדלג ומדווח על כך.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


@dataclass
class Thresholds:
    # ---------------------------------------------------------------- מסד

    # שאילתה שממוצע הריצה שלה מעל זה, והיא נקראת הרבה, היא מה שמייקר את
    # המסד. ‏200ms נבחר כי מתחתיו המשתמש/ת אינו/ה מרגיש/ה, ומעליו כל
    # קריאה נוספת מצטברת.
    slow_query_mean_ms: float = 200.0
    # שאילתה איטית שנקראת פעמיים ביום אינה בעיה. הסף הזה מפריד בין
    # "איטית" ל"איטית ומשמעותית". **ליום ולא "אי פעם"**, כי המונים ב-
    # ‏pg_stat_statements מצטברים ו"50 קריאות" מתקיים בסוף גם על שאילתה
    # שרצה פעם בחודש.
    slow_query_min_calls_per_day: int = 50
    # כמה זמן מסד השאילתה צורכת **ליום**. זה המדד ל"שואב משאבים באופן
    # לא פרופורציונלי" — לא הממוצע, וגם לא הסכום מאז איפוס הסטטיסטיקה:
    # סכום מצטבר רק עולה, ולכן ממצא שנשען עליו אינו יכול להיסגר לעולם
    # (ההסבר המלא ב-`probes/database.py`, ‏`_slow_queries`).
    #
    # דקה של זמן מסד ביום על שאילתה אחת. הכיול: ב-19.9.2026 הצרכנית
    # הגדולה בפרודקשן הייתה `notification_push_ready()` עם 11.6
    # שניות/יום, כלומר הסף יורה בערך פי חמישה מעל הגרוע של היום.
    heavy_query_sec_per_day: float = 60.0

    # טבלה שגדולה מזה ונסרקת ברצף היא אינדקס חסר שממתין לקרות. מתחת לזה
    # ‏Postgres בוחר seq scan בכוונה והוא צודק.
    seq_scan_min_rows: int = 2_000
    seq_scan_min_scans: int = 500

    # אינדקס שלא נקרא אף פעם ותופס מקום — עולה בכל INSERT ולא מחזיר דבר.
    unused_index_min_kb: int = 64
    # ...אבל רק אם המסד אסף מספיק סטטיסטיקה. אינדקס שנוצר אתמול "לא
    # בשימוש" בהגדרה, וממצא עליו הוא רעש.
    unused_index_min_age_days: int = 14

    # שורות מתות ביחס לחיות. מעל זה autovacuum לא מדביק את הקצב.
    dead_tuple_ratio: float = 0.25
    dead_tuple_min_rows: int = 1_000

    # יחס הפגיעה במטמון. מתחת ל-95% המסד קורא מהדיסק יותר מדי.
    cache_hit_min: float = 0.95
    cache_hit_min_blocks: int = 100_000

    # ---------------------------------------------------------------- בריאות

    # תור שיש בו שורה ממתינה יותר מזה — משהו בצד השני לא רץ.
    queue_stuck_hours: int = 6
    queue_stuck_critical_hours: int = 24
    # כמה שורות תקועות הופכות תקלה נקודתית לתקלת מערכת.
    queue_stuck_critical_rows: int = 25
    # הרצפה שמתחתיה תור תקוע הוא מטרד ולא תקלה. שורה אחת שנתקעה היא
    # כנראה שורה אחת רעה (נכס שירד מפרסום, קלט שגוי) — לא מנגנון שבור.
    # בלי הרצפה הזו שורה בודדת בת יומיים פתחה Issue בדרגת "חמור".
    queue_stuck_critical_min_rows: int = 3

    # ‏job של pg_cron שנכשל בחלון הזה. ‏cron הוא איך שרוב האוטומציה כאן
    # רצה — job שנופל בשקט הוא בדיוק סוג התקלה שאין לה שום סימן אחר.
    cron_window_hours: int = 24
    cron_fail_min: int = 1
    # ‏job שאמור לרוץ כל חמש דקות ולא רץ שעה — הוא כבוי או תקוע.
    cron_silent_factor: float = 12.0

    # ברירת מחדל לשקט של מנוע. **הסף האמיתי יושב לכל מנוע בנפרד**
    # ב-`ENGINES` למטה, כי לכל פיד קצב משלו — ראו שם.
    engine_silence_hours: int = 12

    # ---------------------------------------------------------------- חזית

    # משקל ה-HTML **אחרי דחיסה** — מה שבאמת עובר ברשת, כי זה מה שקובע
    # את זמן ההורדה. הסף על הקובץ הלא-דחוס היה שגוי ביחידה בדיוק כמו
    # ‏`heavy_query`: ‏250KB בדיסק הם 72KB ברשת, וממצא שנפתח עליהם הוא
    # רעש (ההסבר ב-`probes/frontend.py`, ‏`_page_weight`).
    #
    # הכיול: החציון של דף ציבורי באתר הוא 13.8KB דחוסים. ‏60 הוא בערך
    # פי ארבעה מזה — חריג אמיתי ולא שונות רגילה — ו-120 הוא הגודל שבו
    # ההורדה עצמה נמדדת בשניות ברשת סלולרית איטית.
    page_wire_kb_warn: int = 60
    page_wire_kb_high: int = 120
    # דף האזור האישי הוא אפליקציה ולא דף תוכן, ולכן מודדים אותו אחרת:
    # נטען פעם אחת ביום עבודה, ומיד אחר כך יושב במטמון.
    app_page_wire_kb_warn: int = 200
    app_page_wire_kb_high: int = 350

    # קובץ js/css ב-`assets/` **אחרי דחיסה**, מאותה סיבה בדיוק כמו
    # `page_wire_kb_*`: ‏Netlify מגיש אותו דחוס, ומדידת הקובץ מהדיסק
    # מודדת מה שאיש אינו מוריד. ‏`crm.js` הוא 1,122KB בדיסק ו-310KB
    # ברשת — ההפרש הוא בין "חריג מפלצתי" ל"חריג".
    #
    # הכיול מהאתר עצמו: 30 קובצי js/css, חציון 5.5KB דחוסים, אחוזון 90
    # על 40.8KB. ‏100KB הוא בערך פי 18 מהחציון, ומבודד את החריג האמיתי
    # היחיד (`crm.js`) בלי לסמן את `home.js` (‏81KB) — באנדל של דף אחד
    # שעושה בדיוק את עבודתו.
    asset_wire_kb_warn: int = 100
    # תמונה נמדדת **בדיסק** ולא דחוסה, וזה הנכון: ‏PNG ו-JPEG כבר דחוסים,
    # ‏Netlify אינו מוסיף עליהם gzip, והקובץ הוא מה שעובר.
    image_kb_warn: int = 200

    # זמן עד הבייט הראשון. מעל זה השרת (או ה-CDN) הוא הצוואר, לא הדף.
    ttfb_warn_ms: int = 800
    ttfb_high_ms: int = 2_000
    # זמן ההורדה המלא של המסמך.
    page_ms_warn: int = 2_500
    page_ms_high: int = 5_000

    # ---------------------------------------------------------------- התנהגות

    # נכס שנצפה הרבה ואיש לא פנה לגביו. זו הצורה שבה "יציאה מדף" נראית
    # במסד שלנו — ראו docs/ops-agent.md על מה שחסר כאן ומה GA4 כן יודע.
    zero_lead_min_views: int = 40
    # שיעור הפנייה הממוצע שמתחתיו הדף נחשב חלש ביחס לעצמו.
    contact_rate_floor: float = 0.01

    # משפך ההתקנה: כמה מאלה שראו את ההצעה לחצו.
    pwa_click_rate_floor: float = 0.03
    pwa_min_impressions: int = 200

    # התראה שנשלחה ונכשלה. מעל האחוז הזה הערוץ שבור ולא "נדיר".
    alert_fail_rate: float = 0.15
    alert_min_attempts: int = 20

    # ---------------------------------------------------------------- אבטחה

    # פונקציית SECURITY DEFINER שאנונימי/ת יכול/ה להריץ. ‏PostgREST חושף
    # כל פונקציה ב-/rest/v1/rpc/ — זו נקודת קצה פתוחה, לא פרט פנימי.
    # אין כאן סף: כל מופע הוא ממצא.

    # ---------------------------------------------------------------- workflows

    workflow_window_runs: int = 20
    workflow_fail_rate: float = 0.25
    # ‏workflow מתוזמן שלא רץ פי כמה מהתדירות שלו — כבוי או תקוע.
    workflow_silent_days: int = 3


@dataclass
class Settings:
    db_url: str = ""
    site_base_url: str = "https://shuknadlan.co.il"
    # ענף ברירת המחדל. בריאות ה-workflows נמדדת עליו בלבד — הרצה על ענף
    # ‏PR שנכשלה היא הבדיקה עובדת, לא האוטומציה שבורה.
    default_branch: str = "main"
    github_token: str = ""
    github_repo: str = ""
    # פרויקט Supabase — לקישורים בדוח בלבד, לא לגישה.
    project_ref: str = "obookujgolazrwycsiyn"

    dry_run: bool = False
    only: tuple[str, ...] = ()
    # שנייה אחת לשאילתת ניטור היא הרבה. הסוכן רץ על מסד הפרודקשן, והוא
    # האחרון שמותר לו להיות הסיבה לעומס.
    statement_timeout_ms: int = 15_000
    http_timeout_s: float = 20.0

    thresholds: Thresholds = field(default_factory=Thresholds)

    @classmethod
    def from_env(cls) -> "Settings":
        only_raw = (os.environ.get("OPS_ONLY") or "").strip()
        return cls(
            db_url=(os.environ.get("SUPABASE_DB_URL") or "").strip(),
            site_base_url=(os.environ.get("SITE_BASE_URL")
                           or "https://shuknadlan.co.il").strip().rstrip("/"),
            github_token=(os.environ.get("GITHUB_TOKEN") or "").strip(),
            github_repo=(os.environ.get("GITHUB_REPOSITORY") or "").strip(),
            dry_run=(os.environ.get("OPS_DRY_RUN") or "").strip().lower()
            in ("1", "true", "yes"),
            only=tuple(p.strip() for p in only_raw.split(",") if p.strip()),
            statement_timeout_ms=_int("OPS_STATEMENT_TIMEOUT_MS", 15_000),
            http_timeout_s=_float("OPS_HTTP_TIMEOUT_S", 20.0),
        )


# הדפים הציבוריים שנמדדים חי. לא כל דף — מדידה של 30 דפים בכל סריקה היא
# 30 בקשות לאתר הפרודקשן כל שש שעות, בלי שהתשובה תשתנה בין רובם. אלה
# הדפים שכל מסע באתר עובר בהם.
LIVE_PAGES = (
    ("/", "דף הבית"),
    ("/property.html", "דף נכס"),
    ("/agencies.html", "מדריך המשרדים"),
    ("/projects.html", "פרויקטים חדשים"),
    ("/articles.html", "כתבות"),
    ("/pricing.html", "מסלולים"),
)

# דפים שהם אפליקציה ולא דף תוכן — נמדדים מול סף אחר.
APP_PAGES = ("crm.html", "developer-crm.html", "professional-manage.html")

# התורים שהסוכן בודק. ‏(טבלה, עמודת סטטוס, הערכים שנחשבים "ממתין",
# עמודת הזמן, שם קריא, מה שבור כשזה נתקע).
QUEUES = (
    ("property_description_jobs", "status", ("pending", "queued"), "created_at",
     "תיאורים שיווקיים", "נכס מתפרסם בלי תיאור"),
    ("property_publications", "status", ("pending", "queued"), "created_at",
     "פרסום לפייסבוק", "המודעה לא יוצאת לפייסבוק"),
    ("visualization_jobs", "status", ("pending", "queued", "running"), "created_at",
     "הדמיות נכס", "ההדמיה לא נוצרת והסוכן/ת ממתין/ה"),
    ("property_video_jobs", "status", ("pending", "queued", "running"), "created_at",
     "סרטוני שיווק", "שולם וסרטון לא הופק"),
    ("media_processing_queue", "status", ("pending", "queued"), "created_at",
     "עיבוד מדיה", "תמונות שהועלו לא נכנסות לנכס"),
    ("saved_search_alerts", "status", ("pending", "queued"), "created_at",
     "התראות הסוכן החכם", "מחפש/ת דירה לא מקבל/ת התראה"),
)

# ---------------------------------------------------------------------------
# נקודות קצה שנועדו להיות פומביות, במוצהר
#
# ‏Edge Function עם `verify_jwt = false` שאינה מאמתת דבר היא **לא בהכרח
# חור**: טופס ציבורי חייב להיות נגיש למי שאינו מחובר/ת, וזו כל מטרתו.
# הבדיקה אינה יכולה להסיק את זה מהקוד, ולכן הרשימה מוצהרת כאן.
#
# **למה רשימה ולא היוריסטיקה:** ברירת המחדל היא חשד. פונקציה חדשה בלי
# אימות תדווח כ-`high` עד שמישהו/י **יחליט/תחליט במודע** להוסיף אותה
# לכאן. היוריסטיקה לפי שם ("כל מה שנגמר ב-intake") הייתה מכסה גם את
# הפונקציה הבאה שתיקרא כך בטעות.
#
# מה שכן נשאר פתוח לגבי כולן: הגבלת קצב. טופס ציבורי בלי rate limit הוא
# הזמנה להצפה, וזה תקף גם כשהוא "אמור" להיות פומבי.
PUBLIC_EDGE_FUNCTIONS = frozenset({
    # טפסי קליטה — הגולש/ת אינו/ה מחובר/ת בהגדרה
    "owner-lead-intake",
    "mortgage-lead-intake",
    "property-inquiry-intake",
    "agent-direct-inquiry-intake",
    "saved-search-intake",
    "project-lead-intake",
    "newsletter-subscribe",
    "open-house-subscribe",
    "submit-review",
    # הרשמות — נקודת הכניסה הראשונה, לפני שיש חשבון
    "agency-signup",
    "developer-signup",
    "professional-signup",
    # שליפות ממרשמים ציבוריים. אין בהן נתון שלנו
    "company-registry-lookup",
    "broker-license-lookup",
})

# דפוסים שמעידים שהפונקציה **כן** מאמתת. הרשימה נבנתה מקריאה בקוד
# בפועל, אחרי שהגרסה הראשונה דיווחה על 31 פונקציות שרובן מוגנות:
# ‏`authorizeInternalCaller` מ-_shared/cron-auth.ts, אסימון ניהול בגוף
# הבקשה, ודחייה מפורשת ב-401/403/429 — כל אחת מהן הייתה "לא מאומת"
# בבדיקה הראשונה.
EDGE_AUTH_PATTERNS = (
    r"authorizeInternalCaller", r"CRON_SECRET", r"WEBHOOK_SECRET",
    r"createHmac", r"\bhmac\b", r"x-hub-signature", r"timingSafeEqual",
    r"manage_token", r"webhook_token", r"view_token", r"verify_code",
    r"unsubscribe_token", r"p_token", r"requirePlatformAdmin",
    r"broker-license-gate",
    # דחייה מפורשת: הפונקציה בודקת משהו ומסרבת
    r"\b401\b", r"\b403\b", r"\b429\b",
)

# מנועים שצריכים להכניס שורות. ‏(טבלה, עמודת זמן, שם קריא, מי מזין).
# המנועים שהסוכן בודק: ‏(טבלה, עמודת זמן, שם קריא, ה-workflow, שעות שקט).
#
# **שעות השקט הן לכל מנוע בנפרד, ומכוילות מהנתונים שלו.** סף אחיד של 12
# שעות ירה על `news_items` ב-20.9.2026 בדרגה גבוהה, בזמן שה-workflow רץ
# והצליח פעמיים באותו חלון — פשוט לא היה מבזק חדש לשמור. הפערים בפועל
# ב-60 יום: חציון 0 שעות (הפריטים נכנסים באצוות), אחוזון 95 על 29.5,
# מקסימום 59, **ו-11 פערים חצו 12 שעות**. כלומר הסף ירה כל כמה ימים על
# מנוע בריא לחלוטין.
#
# ‏48 שעות ל-news_items: מעל אחוזון 95 בבירור, ומתחת למקסימום — כלומר
# שקט חריג באמת ידווח, אבל לא לילה שקט. ‏`rss_leads` נשאר על 12 (ראו
# למטה למה זה לא משנה היום).
#
# **מה שהבדיקה הזו אינה צריכה לתפוס:** ‏workflow כבוי או נכשל. שניהם
# מכוסים ב-`probes/pipeline.py` (`workflow_silent`, `workflow_failing`)
# מהמקור הנכון — ‏GitHub ולא המסד. מה שנשאר לכאן הוא המקרה היחיד ששם
# אינו נראה: ה-workflow ירוק והמנוע בכל זאת אינו כותב.
ENGINES = (
    ("rss_leads", "created_at", "מנוע הלידים מ-RSS", "rss_scraper.yml", 12),
    ("news_items", "created_at", "מנוע מבזקי הנדל\"ן", "news_ticker.yml", 48),
)

# ‏workflows שהתזמון שלהם נותק בכוונה. ‏`workflow_silent` מחפש workflow
# מתוזמן שהפסיק לרוץ — וזה בדיוק מה שקורה כאן, ובכוונה. בלי הרשימה הזו
# הסוכן היה פותח ממצא בדרגה גבוהה שלושה ימים אחרי כל ניתוק, על משהו
# שמישהו עשה במתכוון ותיעד.
#
# **הדרגה של הרשימה הזו: להסיר ממנה, לא להוסיף לה.** שורה כאן היא חוב —
# מנוע שאינו עובד — ולכן היא נושאת את הסיבה ואת התנאי לחזרה. ‏workflow
# שנכשל בהרצה ידנית עדיין מדווח (`workflow_failing`), כי כישלון אינו
# שקט.
PAUSED_WORKFLOWS = {
    "rss_scraper.yml": "מושבת מ-25.8.2026; המקורות כבויים — rss-leads-setup.md",
    "deals_scraper.yml": "nadlan.gov.il חוסם; ממתין למקור מורשה — market-deals-official.md",
}
