"""סינון מילות מפתח — השער שלפני Claude.

תפקידו כפול:

1. **לחסוך כסף.** פיד חדשות כללי מחזיר בעיקר ידיעות שאינן נדל"ן. השער הזה
   רץ על טקסט בלבד, בלי קריאת API, ומעביר הלאה רק פריטים שנוגעים לדיור —
   וכך רק הם נשלחים לניתוח.
2. **לקבוע היקף.** ידיעה שמזכירה את עפולה או את יישובי העמק היא מבזק מקומי,
   ומקבלת עדיפות ברצועה על פני ידיעה ארצית. הקביעה כאן היא ברירת המחדל;
   ‏Claude יכול לדייק אותה, אבל גם בלעדיו (כשאין מפתח API) יש תשובה סבירה.

הפונקציות כאן טהורות ובלי תלות ברשת — אפשר לבדוק אותן בלי Supabase ובלי
מפתחות.
"""

from __future__ import annotations

import re
import unicodedata

from .models import MAX_HEADLINE_CHARS, NewsAnalysis, NewsScope

# עפולה עצמה. "עפולה עילית" מכוסה על ידי "עפולה", והיא כאן רק לתיעוד הכוונה.
AFULA_TERMS = (
    "עפולה",
    "גבעת המורה",
    "עפולה עילית",
)

# הסביבה הקרובה — עדיין מבזק מקומי בעיני גולש/ת מעפולה, אבל לא העיר עצמה.
REGION_TERMS = (
    "עמק יזרעאל",
    "מגדל העמק",
    "בית שאן",
    "עמק חרוד",
    "כפר תבור",
    "מרחביה",
    "גלבוע",
    "יזרעאל",
    "עמק המעיינות",
    "נצרת",
    "מחוז הצפון",
    "צפון הארץ",
)

# מילות הנדל"ן. פריט חייב לפחות אחת מהן — בלעדיה זו לא ידיעת דיור, גם אם
# עפולה מוזכרת בה (תאונה, ספורט, פוליטיקה מקומית).
REALTY_TERMS = (
    "נדל\"ן", "נדלן", "נדל״ן",
    "דיור", "דירה", "דירות", "מגורים", "דיירים", "שכירות", "שכר דירה",
    "משכנתא", "משכנתאות", "מחירי הדיור", "מחיר למשתכן", "דירה בהנחה",
    "תב\"ע", "תב״ע", "תבע", "היתר בנייה", "היתרי בנייה", "ועדה מקומית",
    "ועדה מחוזית", "תוכנית בניין עיר", "תכנון ובנייה", "התחדשות עירונית",
    "פינוי בינוי", "פינוי-בינוי", "תמ\"א 38", "תמ״א 38",
    "מכרז קרקע", "שיווק קרקעות", "רשות מקרקעי ישראל", "רמ\"י", "רמ״י",
    "מגרש", "מגרשים", "יחידות דיור", "פרויקט מגורים", "מגדל מגורים",
    "אכלוס", "קבלן", "יזם", "התחלות בנייה", "עסקאות", "מס רכישה",
    "שמאי", "שמאות", "ארנונה", "נכס", "נכסים", "מסחרי", "משרדים",
)

# ידיעה ארצית נכנסת רק אם היא נוגעת לשוק עצמו ולא לחברה בודדת בבורסה.
NATIONAL_MARKET_TERMS = (
    "מחירי הדיור", "מדד מחירי הדירות", "בנק ישראל", "ריבית", "הריבית",
    "משכנתא", "משכנתאות", "מס רכישה", "מחיר למשתכן", "דירה בהנחה",
    "התחלות בנייה", "היצע הדירות", "שוק הדיור", "שוק הנדל\"ן", "שוק הנדל״ן",
    "הלמ\"ס", "הלמ״ס", "רשות מקרקעי ישראל", "התחדשות עירונית", "משרד השיכון",
)

# רעש שחוזר בפידים של אתרי חדשות כלכליים ואינו מבזק לגולש/ת שלנו.
NOISE_TERMS = (
    "מניית", "המניה", "אג\"ח", "אג״ח", "דוחות כספיים", "רבעון",
    "הנפקה", "תשקיף", "אנליסט", "המלצת קנייה", "מדד ת\"א", "מדד ת״א",
)

_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """
    מיישר את הטקסט לצורה אחת לפני ההשוואה.

    שלוש הצורות של הגרשיים בעברית — ‎"‎ (מרכאה), ‎״‎ (גרשיים עבריים) ו-‎''‎ —
    מופיעות באותה מילה בפידים שונים ("נדל"ן" מול "נדל״ן"), ובלי יישור
    ההשוואה מפספסת בדיוק את המילה המרכזית.
    """
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("״", '"').replace("”", '"').replace("“", '"')
    text = text.replace("׳", "'").replace("’", "'").replace("‘", "'")
    return _WS_RE.sub(" ", text)


def _hits(haystack: str, terms: tuple[str, ...]) -> list[str]:
    return [t for t in terms if normalize(t) in haystack]


def classify(title: str, content: str, source_scope: str = "national") -> dict:
    """
    מחליט אם הפריט עובר הלאה, ומה ההיקף הגיאוגרפי שלו.

    ‏source_scope הוא ההיקף שהוגדר למקור עצמו (עמודת scope ב-news_sources).
    הוא משמש כברירת מחדל כשהטקסט לא מזכיר שום יישוב — פיד של עיריית עפולה
    מדבר על עפולה גם כשהמילה לא מופיעה בכותרת.
    """
    text = normalize(f"{title}\n{content}")

    afula = _hits(text, AFULA_TERMS)
    region = _hits(text, REGION_TERMS)
    realty = _hits(text, REALTY_TERMS)
    national = _hits(text, NATIONAL_MARKET_TERMS)
    noise = _hits(text, NOISE_TERMS)

    if afula:
        scope: NewsScope = "afula"
    elif region:
        scope = "region"
    elif source_scope in ("afula", "region"):
        scope = source_scope  # type: ignore[assignment]
    else:
        scope = "national"

    is_local = scope in ("afula", "region")

    # ידיעה מקומית: די במילת נדל"ן אחת. ידיעה ארצית: צריך גם מילת שוק, אחרת
    # כל ידיעה שמזכירה "נכס" או "קבלן" הייתה נכנסת לרצועה של אתר בעפולה.
    keep = bool(realty) and (is_local or bool(national))

    # רעש בורסאי פוסל רק ידיעה ארצית — "מניית קבוצת יזמות" אינה מבזק דיור.
    # ידיעה מקומית שמזכירה הנפקה של יזם שבונה בעפולה כן מעניינת.
    if keep and noise and not is_local:
        keep = False

    return {
        "keep": keep,
        "scope": scope,
        "is_local": is_local,
        "afula_hits": afula,
        "region_hits": region,
        "realty_hits": realty,
        "national_hits": national,
        "noise_hits": noise,
    }


def heuristic_score(verdict: dict) -> int:
    """
    ציון 1–10 בלי Claude.

    מקומיות היא המשקל הכבד: מבזק על עפולה מעניין את קהל האתר יותר מכל ידיעה
    ארצית, וגם אם היא כתובה פחות טוב.
    """
    score = 4
    if verdict["afula_hits"]:
        score += 4
    elif verdict["region_hits"]:
        score += 2
    if len(verdict["realty_hits"]) >= 2:
        score += 1
    if verdict["national_hits"]:
        score += 1
    if verdict["noise_hits"]:
        score -= 2
    return max(1, min(10, score))


def shorten_headline(text: str, limit: int = MAX_HEADLINE_CHARS) -> str:
    """
    מקצר כותרת לשורת מבזק, על גבול מילה ולא באמצעה.

    פיד חדשות מוסיף לעיתים את שם האתר אחרי מקף בסוף הכותרת
    ("... - גלובס") — הרצועה היא של האתר שלנו, ולכן החתימה הזו יורדת.
    """
    clean = normalize(text).strip()
    clean = re.sub(r"\s+[-–|]\s+[^-–|]{1,30}$", "", clean).strip()
    if len(clean) <= limit:
        return clean
    cut = clean[: limit - 1]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,.;:־-") + "…"


def _first_sentences(text: str, limit: int = 220) -> str:
    """שני המשפטים הראשונים של גוף הידיעה, כתקציר כשאין Claude."""
    clean = normalize(text).strip()
    if not clean:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", clean)
    summary = ""
    for part in parts:
        candidate = (summary + " " + part).strip()
        if len(candidate) > limit:
            break
        summary = candidate
        if len(parts) > 1 and summary.count(".") >= 2:
            break
    return (summary or clean[:limit]).strip()


_CATEGORY_BY_HIT = (
    (("תב\"ע", "היתר בנייה", "היתרי בנייה", "ועדה מקומית", "ועדה מחוזית",
      "תוכנית בניין עיר", "תכנון ובנייה", "התחדשות עירונית", "פינוי בינוי",
      "פינוי-בינוי", "תמ\"א 38"), "תכנון ובנייה"),
    (("משכנתא", "משכנתאות", "ריבית", "הריבית", "בנק ישראל"), "משכנתאות וריבית"),
    (("מחירי הדיור", "מדד מחירי הדירות", "עסקאות", "מס רכישה"), "עסקאות ומחירים"),
)


def heuristic_category(verdict: dict, source_type: str = "news") -> str:
    """נושא הידיעה בלי Claude — לפי המילים שנתפסו בסינון."""
    if source_type == "municipality":
        return "עיריית עפולה"
    hits = set(normalize(h) for h in verdict["realty_hits"] + verdict["national_hits"])
    for terms, label in _CATEGORY_BY_HIT:
        if hits & {normalize(t) for t in terms}:
            return label
    return "שוק הדיור"


def heuristic_analysis(
    title: str, content: str, verdict: dict, *, source_type: str = "news"
) -> NewsAnalysis:
    """
    ניסוח מבזק בלי Claude — מסלול הנפילה כשאין ANTHROPIC_API_KEY.

    הכותרת נלקחת כמו שהיא מהפיד (היא כבר נוסחה על ידי עורך/ת) ורק מקוצרת,
    והתקציר הוא תחילת גוף הידיעה. פחות מלוטש מניסוח של המודל, אבל נכון
    עובדתית — ומבזק ריק גרוע ממבזק פשוט.
    """
    return NewsAnalysis(
        is_relevant=bool(verdict["keep"]),
        scope=verdict["scope"],
        category=heuristic_category(verdict, source_type),  # type: ignore[arg-type]
        headline=shorten_headline(title or _first_sentences(content, 90)),
        summary=_first_sentences(content),
        relevance_score=heuristic_score(verdict),
        reasoning="סינון מילות מפתח בלבד (ללא Claude)",
    )
