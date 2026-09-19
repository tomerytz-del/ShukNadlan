"""מה שהגולש/ת מרגיש/ה: משקל הדף, זמן התגובה, והמטמון.

שני מקורות: הקבצים בריפו (משקל, מבנה) והאתר החי (זמנים, כותרות). אף
אחד מהם אינו מספיק לבד — קובץ של 600KB שמוגש דחוס הוא 90KB ברשת, וזמן
תגובה מצוין על דף שמוריד 40 תמונות אינו אומר דבר.

**אין כאן GA4.** שיעור היציאה מדף, זמן שהייה ומסלול הגלישה יושבים שם,
ואין לנו גישת API אליהם — ראו `docs/ops-agent.md` על מה שנמדד במקום.
"""

from __future__ import annotations

import gzip
import re
import time
from pathlib import Path
from typing import Iterator

from ..config import APP_PAGES, LIVE_PAGES
from ..models import Finding

_SCRIPT_SRC = re.compile(r"<script\b[^>]*\bsrc\s*=", re.I)
_IMG = re.compile(r"<img\b[^>]*>", re.I)
_LAZY = re.compile(r"loading\s*=\s*[\"']lazy[\"']", re.I)


def run(ctx) -> Iterator[Finding]:
    yield from _page_weight(ctx)
    yield from _assets(ctx)
    yield from _lazy_images(ctx)
    yield from _cache_rules(ctx)
    yield from _live(ctx)


# ‏Netlify מגיש HTML דחוס — brotli למי שתומך, ‏gzip לשאר. ‏gzip הוא
# הקירוב השמרני מבין השניים (‏brotli קטן ממנו בעוד 15–20%), ולכן
# המדידה כאן מטה כלפי **יותר** דיווח ולא פחות. רמה 6 ולא 9: ההפרש
# ביניהן הוא כאחוז, וזו הרמה שמגישים בפועל.
_GZIP_LEVEL = 6


def _page_weight(ctx) -> Iterator[Finding]:
    """משקל הדף — **מה שעובר ברשת**, לא מה שיושב בדיסק.

    ההערה שבראש הקובץ הזה אומרת את זה בעצמה: "קובץ של 600KB שמוגש דחוס
    הוא 90KB ברשת". הבדיקה בכל זאת מדדה שנים את `stat().st_size`, כלומר
    את הקובץ הלא-דחוס, מול ספים שנוסחו בלשון של זמן הורדה ("שניות של
    מסך לבן"). התוצאה הייתה שלושה ממצאים פתוחים ב-19.9.2026:

    * ‏`property.html` ‏— 250.6KB מול סף של 250. על הרשת: **72KB**.
    * ‏`index.html` ‏— 596.5KB, דרגת "גבוה". על הרשת: **160KB**.
    * ‏`crm.html` ‏— 1,515KB. על הרשת: **401KB**.

    השלישי אמיתי, השני שנוי במחלוקת, והראשון הוא רעש טהור — ממצא
    שנפתח על 0.6KB מעל הסף, על מספר שאף גולש/ת אינו/ה פוגש/ת. ‏**דוח
    שרובו רעש הוא דוח שמפסיקים לפתוח.**

    המשקל הלא-דחוס לא נעלם מהדיווח, כי הוא כן מודד משהו אחר: את מה
    שהדפדפן חייב **לפענח ולהריץ**, ודחיסה אינה מקצרת את זה. הוא מופיע
    ב-`detail` וב-`evidence` לצד מספר הרשת.

    דף האזור האישי נמדד מול סף אחר — הוא אפליקציה שנטענת פעם אחת ביום
    עבודה, לא דף נחיתה שמגיעים אליו מגוגל.
    """
    t = ctx.settings.thresholds
    for path in sorted(ctx.root.glob("*.html")):
        ctx.count()
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        raw_kb = len(raw) / 1024
        wire_kb = len(gzip.compress(raw, _GZIP_LEVEL)) / 1024
        is_app = path.name in APP_PAGES
        warn = t.app_page_wire_kb_warn if is_app else t.page_wire_kb_warn
        high = t.app_page_wire_kb_high if is_app else t.page_wire_kb_high
        if wire_kb < warn:
            continue
        yield Finding(
            area="frontend", code="page_transfer",
            severity="high" if wire_kb >= high else "medium",
            subject=path.name,
            title="דף כבד: %s — %.0f KB ברשת" % (path.name, wire_kb),
            detail="‏%.0f KB דחוסים עוברים ברשת (‏%.0f KB בקובץ עצמו), לפני "
                   "תמונות ולפני assets. הסף לדף %s הוא %d KB."
                   % (wire_kb, raw_kb, "אפליקציה" if is_app else "ציבורי", warn),
            suggestion="הדף אינו מצייר דבר עד שהקובץ ירד במלואו, ואת %.0f ה-KB "
                       "הלא-דחוסים הדפדפן גם חייב לפענח — דחיסה אינה מקצרת את "
                       "זה. רוב המשקל כאן הוא CSS ו-JS מוטבעים, והוצאה שלהם "
                       "ל-assets נותנת גם מטמון בין דפים. ‏**לא** להוציא את "
                       "קטעי ה-GTM וה-PWA: הם חייבים להיות בדף עצמו "
                       "(CLAUDE.md)." % raw_kb,
            metric=round(wire_kb, 1), metric_unit="KB ברשת",
            evidence={"raw_kb": round(raw_kb, 1),
                      "compression": "gzip-%d" % _GZIP_LEVEL,
                      "ratio": round(wire_kb / raw_kb, 3) if raw_kb else None},
        )


def _assets(ctx) -> Iterator[Finding]:
    """קבצי assets ותמונות כבדות."""
    t = ctx.settings.thresholds
    assets = ctx.root / "assets"
    if not assets.is_dir():
        return
    for path in sorted(assets.rglob("*")):
        if not path.is_file():
            continue
        ctx.count()
        kb = path.stat().st_size / 1024
        suffix = path.suffix.lower()
        if suffix in (".png", ".jpg", ".jpeg", ".webp"):
            if kb < t.image_kb_warn:
                continue
            yield Finding(
                area="frontend", code="heavy_image", severity="low",
                subject=str(path.relative_to(ctx.root)),
                title="תמונה כבדה: %s — %.0f KB" % (path.name, kb),
                detail="קובץ תמונה בתיקיית assets.",
                suggestion="המרה ל-WebP ודחיסה חוסכות בדרך כלל 60–80% בלי הבדל "
                           "נראה לעין.",
                metric=round(kb, 1), metric_unit="KB",
            )
        elif suffix in (".js", ".css") and kb >= t.asset_kb_warn:
            yield Finding(
                area="frontend", code="heavy_asset", severity="low",
                subject=str(path.relative_to(ctx.root)),
                title="קובץ assets כבד: %s — %.0f KB" % (path.name, kb),
                detail="נטען בכל דף שמצהיר עליו.",
                suggestion="לבדוק אם כל הדפים באמת צריכים את כולו.",
                metric=round(kb, 1), metric_unit="KB",
            )


def _lazy_images(ctx) -> Iterator[Finding]:
    """תמונות בלי loading=lazy בדפי רשימה.

    דף רשימה מוריד עשרות תמונות; בלי lazy כולן יורדות מיד, כולל אלה
    שמתחת לקיפול שאיש לא יראה.
    """
    for path in sorted(ctx.root.glob("*.html")):
        text = _read(path)
        if text is None:
            continue
        ctx.count()
        imgs = _IMG.findall(text)
        if len(imgs) < 12:
            continue
        eager = [i for i in imgs if not _LAZY.search(i)]
        if len(eager) < 8:
            continue
        yield Finding(
            area="frontend", code="eager_images", severity="low",
            subject=path.name,
            title="תמונות בלי טעינה עצלה: %s" % path.name,
            detail="%d מתוך %d תגיות img ללא loading=\"lazy\"."
                   % (len(eager), len(imgs)),
            suggestion="התמונה הראשונה שנראית במסך צריכה להישאר eager (היא ה-LCP), "
                       "כל השאר lazy.",
            metric=float(len(eager)), metric_unit="תמונות",
        )


def _cache_rules(ctx) -> Iterator[Finding]:
    """האם ל-assets יש כלל מטמון ארוך ב-_headers."""
    text = _read(ctx.root / "_headers")
    if text is None:
        return
    ctx.count()
    if "/assets/" in text and "max-age" in text:
        return
    yield Finding(
        area="frontend", code="assets_no_cache", severity="medium",
        subject="_headers",
        title="אין כלל מטמון ל-assets",
        detail="לא נמצא בלוק /assets/* עם Cache-Control ב-_headers.",
        suggestion="בלי max-age ארוך, כל דף מוריד מחדש את ה-CSS וה-JS המשותפים. "
                   "זו ההוצאה הגדולה ביותר על ביקור שני, והזולה ביותר לתיקון.",
    )


# ---------------------------------------------------------------- חי

def _live(ctx) -> Iterator[Finding]:
    """מדידת זמן אמת מול האתר.

    נמדד רק מה שבאמת משתנה בין סריקות: זמן עד הבייט הראשון, זמן ההורדה
    המלא, והאם התשובה דחוסה. שש בקשות בסריקה, לא שלושים — הסוכן לא
    אמור להיות חלק מהעומס שהוא מודד.
    """
    try:
        import requests
    except ImportError:
        return

    base = ctx.settings.site_base_url
    t = ctx.settings.thresholds
    session = requests.Session()
    session.headers["User-Agent"] = "ShukNadlanOpsAgent/1.0 (+ops_agent)"

    for path, label in LIVE_PAGES:
        url = base + path
        ctx.count()

        # ניסיון שני לפני שמכריזים על אתר מת. ‏**זה לא פינוק:** ממצא
        # בדרגת "חמור" פותח Issue, ותקלת רשת חולפת אצל ה-runner נראית
        # בדיוק כמו אתר שנפל. התראת שווא אחת מלמדת להתעלם מהבאות.
        resp = None
        last_err: Exception | None = None
        for attempt in (1, 2):
            try:
                started = time.perf_counter()
                resp = session.get(url, timeout=ctx.settings.http_timeout_s,
                                   stream=True)
                ttfb_ms = (time.perf_counter() - started) * 1000
                body = resp.content
                total_ms = (time.perf_counter() - started) * 1000
                break
            except Exception as err:  # noqa: BLE001
                last_err = err
                resp = None
                if attempt == 1:
                    time.sleep(3)

        if resp is None:
            yield Finding(
                area="health", code="page_unreachable", severity="critical",
                subject=path,
                title="הדף אינו נטען: %s" % label,
                detail="שתי בקשות ל-%s נכשלו: %s" % (url, last_err),
                suggestion="שני ניסיונות שנכשלו אינם תקלת רשת חולפת. לבדוק את "
                           "‏Netlify ואת ה-DNS.",
            )
            continue

        if resp.status_code >= 400:
            yield Finding(
                area="health", code="page_error", severity="critical",
                subject=path,
                title="הדף מחזיר %d: %s" % (resp.status_code, label),
                detail="‏%s החזיר %d." % (url, resp.status_code),
                suggestion="דף שבור בפרודקשן. לבדוק את הפריסה האחרונה ב-Netlify.",
                metric=float(resp.status_code), metric_unit="סטטוס",
            )
            continue

        kb = len(body) / 1024
        encoding = (resp.headers.get("content-encoding") or "").lower()

        if ttfb_ms >= t.ttfb_warn_ms:
            yield Finding(
                area="frontend", code="slow_ttfb",
                severity="high" if ttfb_ms >= t.ttfb_high_ms else "medium",
                subject=path,
                title="תגובה איטית: %s — %.0fms" % (label, ttfb_ms),
                detail="זמן עד הבייט הראשון %.0fms, הורדה מלאה %.0fms, %.0f KB "
                       "ברשת." % (ttfb_ms, total_ms, kb),
                suggestion="‏TTFB גבוה על דף סטטי פירושו שה-CDN לא הגיש מהמטמון. "
                           "לבדוק את כללי המטמון ואת אזור ההגשה.",
                metric=round(ttfb_ms), metric_unit="ms",
                evidence={"url": url, "total_ms": round(total_ms),
                          "kb": round(kb, 1), "encoding": encoding},
            )
        elif total_ms >= t.page_ms_warn:
            yield Finding(
                area="frontend", code="slow_page",
                severity="high" if total_ms >= t.page_ms_high else "medium",
                subject=path,
                title="טעינה איטית: %s — %.1f שניות" % (label, total_ms / 1000),
                detail="‏%.0f KB ברשת, זמן עד הבייט הראשון %.0fms." % (kb, ttfb_ms),
                suggestion="הזמן הולך להורדה ולא להמתנה — כלומר לגודל הדף.",
                metric=round(total_ms), metric_unit="ms",
                evidence={"url": url, "kb": round(kb, 1)},
            )

        if encoding not in ("br", "gzip", "deflate", "zstd") and kb > 30:
            yield Finding(
                area="frontend", code="no_compression", severity="medium",
                subject=path,
                title="תשובה לא דחוסה: %s" % label,
                detail="‏Content-Encoding ריק, %.0f KB עוברים ברשת." % kb,
                suggestion="דחיסה חוסכת 70–85% על HTML. אם Netlify אמור לדחוס "
                           "והוא לא — לבדוק כותרת Content-Type חריגה.",
                metric=round(kb, 1), metric_unit="KB",
            )


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
