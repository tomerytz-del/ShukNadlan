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
    # "איטית" ל"איטית ומשמעותית".
    slow_query_min_calls: int = 50
    # סך הזמן שהשאילתה צרכה מאז איפוס הסטטיסטיקה. זה המדד ל"שואב משאבים
    # באופן לא פרופורציונלי" — לא הממוצע.
    heavy_query_total_sec: float = 120.0

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

    # מנוע שלא הכניס שורה חדשה בחלון הזה — הפיד נשבר, הסוד פג, או
    # ה-workflow כבוי. שלושתם נראים זהה מבחוץ: שקט.
    engine_silence_hours: int = 12

    # ---------------------------------------------------------------- חזית

    # משקל ה-HTML עצמו, בלי תמונות. הסף אינו שרירותי: מעליו הדף אינו
    # מצייר כלום עד שכל הקובץ ירד, וברשת סלולרית זה שניות.
    page_kb_warn: int = 250
    page_kb_high: int = 500
    # דף האזור האישי הוא אפליקציה ולא דף תוכן, ולכן מודדים אותו אחרת.
    app_page_kb_warn: int = 700
    app_page_kb_high: int = 1_200

    asset_kb_warn: int = 120
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
ENGINES = (
    ("rss_leads", "created_at", "מנוע הלידים מ-RSS", "rss_scraper.yml"),
    ("news_items", "created_at", "מנוע מבזקי הנדל\"ן", "news_ticker.yml"),
)
