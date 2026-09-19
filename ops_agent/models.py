"""הממצא — היחידה היחידה שהסוכן התפעולי מייצר.

כל בדיקה במערכת, מאיזה תחום שלא תהיה, מחזירה ממצאים מהטיפוס הזה. הסיבה
שזה טיפוס אחד ולא אחד לכל תחום: הדשבורד מציג רשימה **אחת** ממוינת לפי
חומרה. שאילתה איטית, דף כבד וטבלה בלי RLS מתחרים על אותו זמן קשב, ורק
מבנה אחיד מאפשר למיין ביניהם.

## ‏`key` הוא מה שהופך דיווח לניטור

בלי מזהה יציב, כל סריקה מייצרת ממצאים "חדשים" — ואז אי אפשר לדעת מה
נפתר, מה חוזר ומה מחמיר. ‏`key` נגזר מ-(תחום, קוד, נושא) ולכן אותה בעיה
על אותו אובייקט מקבלת את אותו מפתח בכל סריקה. זה מה שמאפשר:

* ‏`first_seen` — מתי זה התחיל (ממצא שקיים חודשיים אינו "חדש")
* ‏`prev_metric` — האם המספר משתפר או מחמיר
* סגירה אוטומטית — ממצא שלא חזר בסריקה נוכחית נסגר, בלי שאיש יסמן דבר

**‏`subject` חייב להיות יציב ולא לכלול מספרים משתנים.** ‏`subject` שהוא
"‏properties (312ms)" ייצור מפתח חדש בכל סריקה, והממצא ייראה כאילו הוא
מתחדש כל שש שעות. המספר שייך ל-`metric`, לא למפתח.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

# סדר החומרות, מהחמור לקל. הסדר הזה הוא גם סדר המיון בדשבורד וגם מה
# שקובע אם נפתח Issue ב-GitHub (ראו config.ISSUE_MIN_SEVERITY).
SEVERITIES = ("critical", "high", "medium", "low", "info")

SEVERITY_RANK = {name: i for i, name in enumerate(SEVERITIES)}

# התחומים. כל אחד מהם הוא לשונית בדשבורד.
AREAS = (
    "health",        # האם זה עובד בכלל — תורים תקועים, cron שנופל, מנועים ששתקו
    "performance",   # כמה זה עולה — שאילתות איטיות, סריקות טבלה, מטמון
    "frontend",      # מה הגולש/ת מרגיש/ה — משקל דף, זמן תגובה, מטמון דפדפן
    "behavior",      # מה הגולש/ת עושה — נשירה, המרה, משפכים
    "security",      # חורי אבטחה — הרשאות, RLS, סודות, כותרות
    "cost",          # משאבים שנשרפים בלי תמורה — אינדקסים מתים, job ריק
)

_KEY_CLEAN = re.compile(r"[^a-z0-9_.:/-]+")


def _slug(value: str) -> str:
    """מנקה מחרוזת למפתח. אותיות עבריות יוצאות — המפתח אינו טקסט לקריאה."""
    return _KEY_CLEAN.sub("_", (value or "").strip().lower()).strip("_") or "-"


@dataclass
class Finding:
    area: str
    code: str
    severity: str
    title: str
    detail: str
    # ‏subject = על מה בדיוק. שם טבלה, שם דף, שם פונקציה. חייב להיות יציב.
    subject: str = ""
    suggestion: str = ""
    # המספר שמייצג את הממצא, אם יש כזה. הוא מה שמאפשר לומר "החמיר ב-40%".
    metric: float | None = None
    metric_unit: str = ""
    # כל מה שלא נכנס לטקסט: שורות, שמות, ערכים. נשמר כ-jsonb ומוצג בפירוט.
    evidence: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.severity not in SEVERITY_RANK:
            raise ValueError("חומרה לא מוכרת: %s" % self.severity)
        if self.area not in AREAS:
            raise ValueError("תחום לא מוכר: %s" % self.area)

    @property
    def key(self) -> str:
        return "%s:%s:%s" % (self.area, _slug(self.code), _slug(self.subject))

    @property
    def rank(self) -> int:
        return SEVERITY_RANK[self.severity]

    def as_row(self) -> dict[str, Any]:
        """שורה לכתיבה ל-ops_findings."""
        return {
            "key": self.key,
            "area": self.area,
            "code": self.code,
            "severity": self.severity,
            "title": self.title,
            "detail": self.detail,
            "subject": self.subject or None,
            "suggestion": self.suggestion or None,
            "metric": self.metric,
            "metric_unit": self.metric_unit or None,
            "evidence": json.dumps(self.evidence, ensure_ascii=False, default=str),
        }


@dataclass
class ProbeResult:
    """תוצאת בדיקה אחת — כולל הכישלון שלה.

    בדיקה שנפלה **אינה** נבלעת. אם probe של אבטחה קרס, המסקנה "אין ממצאי
    אבטחה" שקרית ומסוכנת בדיוק כמו ממצא שפוספס. לכן הכישלון נרשם, מוצג
    בדשבורד ליד תאריך הסריקה, ומונע את הסגירה האוטומטית של ממצאים
    שה-probe הזה אחראי עליהם.
    """

    name: str
    ok: bool
    findings: list[Finding] = field(default_factory=list)
    error: str = ""
    duration_ms: int = 0
    # כמה בדיקות ה-probe הריץ בפועל. ‏0 עם ok=True פירושו "רץ, לא מצא כלום".
    checks: int = 0
