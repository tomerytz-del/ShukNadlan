#!/usr/bin/env python3
"""
בדיקה מהירה של סינון מילות המפתח של מנוע המבזקים.

רץ בלי רשת, בלי Supabase ובלי מפתח API — הסינון הוא קוד טהור, וזה בדיוק
החלק שמכווננים בו הכי הרבה (מוסיפים מילה, מהדקים סף, ואז רוצים לדעת מיד מה
נשבר). הרצה:

    python scripts/news_filter_test.py

כשמוסיפים מילה ל-REALTY_TERMS או ל-NATIONAL_MARKET_TERMS — הוסיפו כאן שורה
שמדגימה מה היא אמורה לתפוס, ושורה שמדגימה מה היא לא אמורה לתפוס.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from news_engine.relevance import (  # noqa: E402
    classify,
    heuristic_analysis,
    same_story,
    shorten_headline,
)

# (כותרת, גוף, היקף המקור, האם אמור להיכנס, ההיקף הצפוי)
CASES: list[tuple[str, str, str, bool, str]] = [
    (
        'הוועדה המקומית אישרה תב"ע ל-320 יחידות דיור בגבעת המורה',
        "התוכנית כוללת גם שטחי מסחר ומבני ציבור.",
        "afula", True, "afula",
    ),
    (
        "רשות מקרקעי ישראל פרסמה מכרז ל-40 מגרשים בעפולה עילית",
        "המכרז ייסגר בעוד חודשיים.",
        "afula", True, "afula",
    ),
    (
        "מחירי הדירות במגדל העמק עלו ב-4% ברבעון",
        "לפי נתוני הלמ״ס.",
        "national", True, "region",
    ),
    (
        "בנק ישראל הותיר את הריבית ללא שינוי",
        "ההחלטה משפיעה ישירות על מחזיקי משכנתאות.",
        "national", True, "national",
    ),
    # ידיעה מקומית שאינה נדל"ן — עפולה לבדה אינה כרטיס כניסה
    (
        "מכבי עפולה ניצחה 2-0 במשחק הבית",
        "אלפי אוהדים הגיעו לאצטדיון.",
        "afula", False, "afula",
    ),
    # רעש בורסאי ארצי — לא מבזק דיור
    (
        "מניית חברת הנדל״ן ירדה 4% אחרי הדוחות הרבעוניים",
        "אנליסט הוריד את המלצתו.",
        "national", False, "national",
    ),
    # ידיעה ארצית שמזכירה נכס אבל לא את השוק
    (
        "נכס נטוש בתל אביב עלה באש",
        "כבאים פעלו במקום.",
        "national", False, "national",
    ),
    # אותה מילה בשתי צורות הגרשיים — חייבת להיתפס בשתיהן
    ('שוק הנדל"ן בעפולה ער', "", "national", True, "afula"),
    ("שוק הנדל״ן בעפולה ער", "", "national", True, "afula"),
]

# מפתחות האירוע. המקרה הראשון הוא זה שהוליד את הפיצ'ר: ארבעה אתרים סיקרו את
# הורדת הריבית של ספטמבר 2026, וכל הארבעה הופיעו ברצועה כארבעה מבזקים.
_RATE_CUT = "ריבית בנק ישראל|הורדה|2026-09"

# (מפתח א, מפתח ב, האם אותו אירוע, תיאור)
STORY_CASES: list[tuple[str, str, bool, str]] = [
    (_RATE_CUT, "ריבית בנק ישראל|הורדה|2026-09", True, "מפתח זהה"),
    (_RATE_CUT, "בנק ישראל ריבית|הורדה|2026-09", True, "סדר מילים שונה — עדיין אותו אירוע"),
    (_RATE_CUT, "ריבית בנק ישראל|הפחתה|2026-09", True, "מילה נרדפת לאירוע — עדיין אותו אירוע"),
    # התקופה היא תנאי חוסם, לא עוד מילה: בנק ישראל מוריד ריבית שוב ושוב,
    # ובלי המבחן הזה ההורדה של אוקטובר הייתה נחסמת ככפילות של זו של ספטמבר.
    (_RATE_CUT, "ריבית בנק ישראל|הורדה|2026-10", False, "אותו אירוע בחודש אחר — חדשות אמיתיות, לא כפילות"),
    (_RATE_CUT, "ריבית בנק ישראל|הותרה ללא שינוי|2026-09", False, "אותו נושא, אירוע הפוך"),
    (_RATE_CUT, "משכנתאות|עלייה בהיקף הנטילות|2026-09", False, "נושא קרוב אך אירוע אחר"),
    (_RATE_CUT, "התחדשות עירונית עפולה|אישור תבע|2026-09", False, "לא קשור"),
    (_RATE_CUT, "", False, "מפתח ריק לא מתאים לכלום"),
    # מפתח פגום (בלי שלושה חלקים) לא אמור להפיל — פשוט נופל להשוואת מילים.
    ("ריבית בנק ישראל", "ריבית בנק ישראל", True, "מפתח בלי תקופה — עדיין משווה"),
]

HEADLINE_CASES = [
    (
        "עיריית עפולה אישרה תוכנית להקמת שכונת מגורים בת 320 יחידות דיור בגבעת המורה - גלובס",
        "גלובס",  # חתימת האתר בסוף חייבת לרדת
    ),
]


def main() -> int:
    failures = 0

    for title, content, source_scope, expect_keep, expect_scope in CASES:
        verdict = classify(title, content, source_scope)
        ok = verdict["keep"] == expect_keep and verdict["scope"] == expect_scope
        if not ok:
            failures += 1
        mark = "✓" if ok else "✗"
        print(
            f"{mark} keep={verdict['keep']!s:<5} scope={verdict['scope']:<8} "
            f"(ציפינו keep={expect_keep!s:<5} scope={expect_scope:<8}) · {title[:52]}"
        )

    for raw, must_not_contain in HEADLINE_CASES:
        short = shorten_headline(raw)
        ok = must_not_contain not in short and len(short) <= 90
        if not ok:
            failures += 1
        print(f"{'✓' if ok else '✗'} כותרת מקוצרת: {short}")

    # --- מפתח האירוע: אותו סיפור מארבעה אתרים מול אירועים שונים באמת ---
    print()
    for left, right, want, why in STORY_CASES:
        got = same_story(left, right)
        if got != want:
            failures += 1
        print(f"{'✓' if got == want else '✗'} {why}")

    # המסלול ההיוריסטי חייב להחזיר אובייקט תקין גם בלי גוף לידיעה
    analysis = heuristic_analysis("מחירי הדיור בעפולה עלו", "", classify("מחירי הדיור בעפולה עלו", "", "afula"))
    if not analysis.headline or analysis.relevance_score < 1:
        failures += 1
        print("✗ המסלול ההיוריסטי החזיר מבזק ריק")
    else:
        print(f"✓ מסלול היוריסטי: [{analysis.category} · {analysis.relevance_score}] {analysis.headline}")

    print()
    if failures:
        print(f"נכשלו {failures} בדיקות.")
        return 1
    print("כל הבדיקות עברו.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
